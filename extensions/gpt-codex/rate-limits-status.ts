import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
	DEFAULT_RATE_LIMITS_STATUS_SETTINGS,
	readRateLimitsStatusSettings,
	type RateLimitsStatusSettings,
} from "./account-store.ts";
import { CODEX_PROVIDER, getActiveCodexCredential } from "./codex-auth.ts";
import {
	describeGptRateLimitError,
	fetchGptRateLimits,
	formatGptRateLimitSnapshot,
} from "./rate-limits.ts";

const STATUS_KEY = "gpt-rate-limits";
const FAILURE_RETRY_INTERVAL_MS = 60_000;

type RefreshOptions = {
	force?: boolean;
	notify?: boolean;
};

export type RateLimitsStatusController = {
	reconfigure(ctx: ExtensionContext): void;
	refresh(ctx: ExtensionContext, options?: RefreshOptions): Promise<void>;
};

type StatusResult = {
	text: string;
	warning: boolean;
};

function isLimitWarning(limit?: { percentLeft: number }): boolean {
	return limit !== undefined && limit.percentLeft <= 20;
}

async function fetchStatusData(signal: AbortSignal): Promise<StatusResult> {
	const credential = await getActiveCodexCredential(signal);
	const snapshot = await fetchGptRateLimits({
		accessToken: credential.access,
		accountId: credential.accountId,
		signal,
	});
	const text = formatGptRateLimitSnapshot(snapshot);
	const warning = isLimitWarning(snapshot.fiveHourLimit) || isLimitWarning(snapshot.weeklyLimit);
	return { text, warning };
}

function setStatus(ctx: ExtensionContext, text: string, warning = false): void {
	ctx.ui.setStatus(STATUS_KEY, warning ? ctx.ui.theme.fg("warning", text) : ctx.ui.theme.fg("dim", text));
}

export function registerRateLimitsStatus(pi: ExtensionAPI): RateLimitsStatusController {
	let timer: ReturnType<typeof setInterval> | undefined;
	let inFlight: Promise<void> | undefined;
	let refreshController: AbortController | undefined;
	let generation = 0;
	let settings: RateLimitsStatusSettings = { ...DEFAULT_RATE_LIMITS_STATUS_SETTINGS };
	let lastFailure = 0;
	let lastStatusText: string | undefined;

	function clearTimer(): void {
		if (timer) clearInterval(timer);
		timer = undefined;
	}

	function reset(): number {
		generation++;
		refreshController?.abort();
		refreshController = undefined;
		inFlight = undefined;
		lastFailure = 0;
		lastStatusText = undefined;
		clearTimer();
		return generation;
	}

	function clearStatus(ctx: ExtensionContext): void {
		if (ctx.mode === "tui") ctx.ui.setStatus(STATUS_KEY, undefined);
	}

	function startTimer(ctx: ExtensionContext, activeGeneration: number): void {
		if (!settings.periodicRefresh) return;
		timer = setInterval(() => void refreshStatus(ctx, activeGeneration), settings.intervalMs);
		timer.unref?.();
	}

	function errorText(): string {
		return lastStatusText ? `${lastStatusText} · stale` : "quota unavailable";
	}

	async function refreshStatus(
		ctx: ExtensionContext,
		activeGeneration = generation,
		options: RefreshOptions = {},
	): Promise<void> {
		if (activeGeneration !== generation || ctx.mode !== "tui") return;

		const force = options.force === true;
		if (!force && (!settings.enabled || ctx.model?.provider !== CODEX_PROVIDER)) return;
		if (!force && lastFailure && Date.now() - lastFailure < FAILURE_RETRY_INTERVAL_MS) return;
		if (inFlight) {
			if (options.notify) ctx.ui.notify("GPT limits refresh already in progress.", "info");
			return inFlight;
		}

		const controller = new AbortController();
		refreshController = controller;
		const refresh = (async () => {
			try {
				const { text, warning } = await fetchStatusData(controller.signal);
				if (activeGeneration !== generation) return;
				if (!force && (!settings.enabled || ctx.model?.provider !== CODEX_PROVIDER)) return;
				if (text !== "quota unavailable") {
					lastStatusText = text;
				}
				lastFailure = 0;
				setStatus(ctx, text, warning);
				if (options.notify) ctx.ui.notify(`GPT limits: ${text}`, "info");
			} catch (error) {
				if (controller.signal.aborted || activeGeneration !== generation) return;
				if (!force) lastFailure = Date.now();
				setStatus(ctx, errorText(), true);
				if (options.notify) {
					ctx.ui.notify(`GPT limits refresh failed: ${describeGptRateLimitError(error)}`, "error");
				}
			}
		})();

		inFlight = refresh;
		try {
			await refresh;
		} finally {
			if (inFlight === refresh) inFlight = undefined;
			if (refreshController === controller) refreshController = undefined;
		}
	}

	function start(ctx: ExtensionContext): void {
		const activeGeneration = reset();
		settings = readRateLimitsStatusSettings();
		if (ctx.mode !== "tui") return;
		if (!settings.enabled || ctx.model?.provider !== CODEX_PROVIDER) {
			clearStatus(ctx);
			return;
		}

		setStatus(ctx, "quota …");
		void refreshStatus(ctx, activeGeneration);
		startTimer(ctx, activeGeneration);
	}

	pi.on("session_start", (_event, ctx) => start(ctx));
	pi.on("model_select", (_event, ctx) => start(ctx));
	pi.on("tool_execution_end", (_event, ctx) => {
		if (settings.refreshOnToolExecutionEnd) void refreshStatus(ctx);
	});
	pi.on("turn_end", (_event, ctx) => {
		if (settings.refreshOnTurnEnd) void refreshStatus(ctx);
	});
	pi.on("agent_end", (_event, ctx) => {
		if (settings.refreshOnAgentEnd) void refreshStatus(ctx);
	});
	pi.on("session_shutdown", (_event, ctx) => {
		reset();
		clearStatus(ctx);
	});

	return {
		reconfigure: start,
		refresh: (ctx, options) => refreshStatus(ctx, generation, options),
	};
}
