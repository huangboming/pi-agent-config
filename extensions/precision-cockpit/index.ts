import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PrecisionCockpitEditor } from "./editor.ts";
import { PrecisionCockpitFooter } from "./footer.ts";

type CacheUsage = {
	input?: number;
	cacheRead?: number;
	cacheWrite?: number;
};

type CacheState = {
	hasActivity: boolean;
	latestHitRate?: number;
};

function recordCacheActivity(state: CacheState, usage?: CacheUsage): void {
	if ((usage?.cacheRead ?? 0) > 0 || (usage?.cacheWrite ?? 0) > 0) {
		state.hasActivity = true;
	}
}

function recordAssistantUsage(state: CacheState, usage: CacheUsage): void {
	recordCacheActivity(state, usage);
	const promptTokens = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
	state.latestHitRate = promptTokens > 0 ? ((usage.cacheRead ?? 0) / promptTokens) * 100 : undefined;
}

export default function (pi: ExtensionAPI): void {
	let cacheState: CacheState = { hasActivity: false };
	let requestRender: (() => void) | undefined;

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		cacheState = { hasActivity: false };
		requestRender = undefined;
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "message" && entry.message.role === "assistant") {
				recordAssistantUsage(cacheState, entry.message.usage);
			} else if (entry.type === "message" && entry.message.role === "toolResult") {
				recordCacheActivity(cacheState, entry.message.usage);
			} else if (entry.type === "branch_summary" || entry.type === "compaction") {
				recordCacheActivity(cacheState, entry.usage);
			}
		}

		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			return new PrecisionCockpitEditor(tui, theme, keybindings);
		});

		ctx.ui.setFooter((tui, theme, footerData) => {
			requestRender = () => tui.requestRender();
			return new PrecisionCockpitFooter(tui, theme, footerData, ctx, () =>
				cacheState.hasActivity ? cacheState.latestHitRate : undefined,
			);
		});
	});

	pi.on("message_end", async (event, ctx) => {
		if (ctx.mode !== "tui") return;

		if (event.message.role === "assistant") {
			recordAssistantUsage(cacheState, event.message.usage);
		} else if (event.message.role === "toolResult") {
			recordCacheActivity(cacheState, event.message.usage);
		} else {
			return;
		}
		requestRender?.();
	});

	pi.on("session_compact", async (event, ctx) => {
		if (ctx.mode !== "tui" || !event.compactionEntry.usage) return;
		recordCacheActivity(cacheState, event.compactionEntry.usage);
		requestRender?.();
	});

	pi.on("session_tree", async (event, ctx) => {
		if (ctx.mode !== "tui" || !event.summaryEntry?.usage) return;
		recordCacheActivity(cacheState, event.summaryEntry.usage);
		requestRender?.();
	});
}
