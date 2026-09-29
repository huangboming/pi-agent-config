const USAGE_URL = process.env.PI_GPT_LIMITS_USAGE_URL ?? "https://chatgpt.com/backend-api/wham/usage";
const FETCH_TIMEOUT_MS = 5_000;
const TIMEOUT_ERROR = `usage request timed out after ${FETCH_TIMEOUT_MS / 1000}s`;

const FIVE_HOUR_WINDOW_SECONDS = 5 * 60 * 60;
const WEEKLY_WINDOW_SECONDS = 7 * 24 * 60 * 60;

type UsageWindow = {
	used_percent?: number;
	limit_window_seconds?: number;
	reset_after_seconds?: number;
	reset_at?: number;
};

type UsagePayload = {
	plan_type?: string;
	rate_limit?: {
		primary_window?: UsageWindow | null;
		secondary_window?: UsageWindow | null;
	} | null;
};

type RateLimit = {
	percentLeft: number;
	windowSeconds?: number;
	resetAfterSeconds?: number;
	resetAt?: number;
};

type RateLimitSnapshot = {
	planType?: string;
	fiveHourLimit?: RateLimit;
	weeklyLimit?: RateLimit;
};

type FetchRateLimitsInput = {
	accessToken: string;
	accountId: string;
	signal?: AbortSignal;
};

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function describeGptRateLimitError(error: unknown): string {
	if (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError") {
		return "request aborted";
	}
	return errorMessage(error);
}

function parseWindow(window: UsageWindow | null | undefined): RateLimit | undefined {
	if (typeof window?.used_percent !== "number") return undefined;
	return {
		percentLeft: Math.max(0, Math.min(100, 100 - window.used_percent)),
		windowSeconds: window.limit_window_seconds,
		resetAfterSeconds: window.reset_after_seconds,
		resetAt: window.reset_at,
	};
}

function parsePayload(payload: UsagePayload): RateLimitSnapshot {
	const primaryLimit = parseWindow(payload.rate_limit?.primary_window);
	const secondaryLimit = parseWindow(payload.rate_limit?.secondary_window);
	const limits = [primaryLimit, secondaryLimit].filter((limit): limit is RateLimit => limit !== undefined);
	const fiveHourLimit = limits.find((limit) => limit.windowSeconds === FIVE_HOUR_WINDOW_SECONDS);
	const weeklyLimit =
		limits.find((limit) => limit.windowSeconds === WEEKLY_WINDOW_SECONDS) ??
		(secondaryLimit !== fiveHourLimit ? secondaryLimit : undefined) ??
		(!secondaryLimit && primaryLimit !== fiveHourLimit ? primaryLimit : undefined);

	return {
		planType: payload.plan_type,
		fiveHourLimit,
		weeklyLimit,
	};
}

function httpError(status: number): Error {
	if (status === 401) return new Error("auth rejected by usage endpoint (401)");
	if (status === 403) return new Error("usage endpoint forbidden (403)");
	return new Error(`usage endpoint returned HTTP ${status}`);
}

export async function fetchGptRateLimits(input: FetchRateLimitsInput): Promise<RateLimitSnapshot> {
	const controller = new AbortController();
	let timedOut = false;
	const abort = () => controller.abort(input.signal?.reason);
	if (input.signal?.aborted) abort();
	else input.signal?.addEventListener("abort", abort, { once: true });

	const timeout = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, FETCH_TIMEOUT_MS);

	try {
		let response: Response;
		try {
			response = await fetch(USAGE_URL, {
				headers: {
					Accept: "application/json",
					Authorization: `Bearer ${input.accessToken}`,
					"ChatGPT-Account-ID": input.accountId,
					"User-Agent": "pi-gpt-rate-limits",
				},
				signal: controller.signal,
			});
		} catch (error) {
			if (timedOut) throw new Error(TIMEOUT_ERROR);
			if (input.signal?.aborted) throw error;
			if (error instanceof TypeError) throw new Error("usage endpoint network error");
			throw new Error(`usage endpoint failed: ${errorMessage(error)}`);
		}

		if (!response.ok) throw httpError(response.status);
		try {
			return parsePayload((await response.json()) as UsagePayload);
		} catch (error) {
			if (timedOut) throw new Error(TIMEOUT_ERROR);
			if (input.signal?.aborted) throw error;
			throw new Error(`usage endpoint failed: ${errorMessage(error)}`);
		}
	} finally {
		clearTimeout(timeout);
		input.signal?.removeEventListener("abort", abort);
	}
}

function resetSeconds(limit: RateLimit): number | undefined {
	if (typeof limit.resetAfterSeconds === "number" && limit.resetAfterSeconds > 0) {
		return limit.resetAfterSeconds;
	}
	if (typeof limit.resetAt !== "number") return undefined;
	const seconds = limit.resetAt - Math.floor(Date.now() / 1000);
	return seconds > 0 ? seconds : undefined;
}

type ResetFormat = "hours-minutes" | "days-hours";

function formatReset(seconds: number, format: ResetFormat): string {
	if (format === "hours-minutes") {
		if (seconds < 60) return "0h <1m";
		const totalMinutes = Math.ceil(seconds / 60);
		return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
	}

	if (seconds < 3600) return "0d <1h";
	const totalHours = Math.ceil(seconds / 3600);
	return `${Math.floor(totalHours / 24)}d ${totalHours % 24}h`;
}

function formatLimit(label: string, limit: RateLimit, resetFormat: ResetFormat): string {
	const reset = resetSeconds(limit);
	const usage = `${label} ${limit.percentLeft.toFixed(0)}% left`;
	return reset ? `${usage}/${formatReset(reset, resetFormat)}` : usage;
}

function formatLimits(snapshot: RateLimitSnapshot): string | undefined {
	const limits = [
		snapshot.fiveHourLimit ? formatLimit("5h", snapshot.fiveHourLimit, "hours-minutes") : undefined,
		snapshot.weeklyLimit ? formatLimit("7d", snapshot.weeklyLimit, "days-hours") : undefined,
	].filter((limit): limit is string => limit !== undefined);
	return limits.length ? limits.join(" · ") : undefined;
}

export function shortenAccountId(accountId: string, prefixLength = 6, suffixLength = 4): string {
	if (accountId.length <= prefixLength + suffixLength + 1) return accountId;
	return `${accountId.slice(0, prefixLength)}…${accountId.slice(-suffixLength)}`;
}

export function formatGptRateLimitSnapshot(snapshot: RateLimitSnapshot): string {
	const parts: string[] = [];
	if (snapshot.fiveHourLimit) {
		parts.push(`5h ${snapshot.fiveHourLimit.percentLeft.toFixed(0)}%`);
	}
	if (snapshot.weeklyLimit) {
		parts.push(`7d ${snapshot.weeklyLimit.percentLeft.toFixed(0)}%`);
	}
	if (parts.length === 0) {
		return "quota unavailable";
	}
	return `quota ${parts.join(" · ")}`;
}

export function formatGptRateLimitDescription(snapshot: RateLimitSnapshot): string {
	const limits = formatLimits(snapshot);
	return limits ? `${snapshot.planType ?? "unknown"}: ${limits}` : "unavailable";
}
