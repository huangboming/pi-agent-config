import { basename } from "node:path";
import type { ExtensionContext, ReadonlyFooterDataProvider, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";

function sanitizeStatus(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

function formatModelGroup(theme: Theme, modelId?: string, thinkingLevel?: string): string | undefined {
	const parts: string[] = [];
	if (modelId) {
		parts.push(theme.fg("text", modelId));
	}
	if (thinkingLevel) {
		parts.push(theme.fg("accent", thinkingLevel.toLowerCase()));
	}
	if (parts.length === 0) return undefined;
	return parts.join(theme.fg("dim", " "));
}

function formatContextGroup(theme: Theme, ctxPercent?: number | null, cacheHitRate?: number): string | undefined {
	const parts: string[] = [];
	if (typeof ctxPercent === "number" && !Number.isNaN(ctxPercent)) {
		parts.push(`${theme.fg("dim", "ctx")} ${theme.fg("text", `${ctxPercent.toFixed(1)}%`)}`);
	}
	if (cacheHitRate !== undefined) {
		parts.push(`${theme.fg("dim", "cache")} ${theme.fg("text", `${cacheHitRate.toFixed(1)}%`)}`);
	}
	if (parts.length === 0) return undefined;
	return parts.join(theme.fg("dim", " · "));
}

function formatLocationGroup(theme: Theme, cwd?: string, branch?: string | null): string | undefined {
	if (!cwd) return undefined;
	const project = basename(cwd) || cwd;
	const location = branch ? `${project}(${branch})` : project;
	return theme.fg("dim", location);
}

type StripItem = {
	id: string;
	rendered: string;
	displayIndex: number;
	priority: number;
};

export class PrecisionCockpitFooter implements Component {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly footerData: ReadonlyFooterDataProvider;
	private readonly ctx: ExtensionContext;
	private readonly getCacheHitRate: () => number | undefined;
	private unsubscribeBranch?: () => void;

	constructor(
		tui: TUI,
		theme: Theme,
		footerData: ReadonlyFooterDataProvider,
		ctx: ExtensionContext,
		getCacheHitRate: () => number | undefined,
	) {
		this.tui = tui;
		this.theme = theme;
		this.footerData = footerData;
		this.ctx = ctx;
		this.getCacheHitRate = getCacheHitRate;
		this.unsubscribeBranch = this.footerData.onBranchChange(() => {
			this.tui.requestRender();
		});
	}

	dispose(): void {
		this.unsubscribeBranch?.();
		this.unsubscribeBranch = undefined;
	}

	invalidate(): void {}

	render(width: number): string[] {
		if (width <= 0) return [""];

		const separator = this.theme.fg("dim", " │ ");
		const location = formatLocationGroup(this.theme, this.ctx.cwd, this.footerData.getGitBranch());
		const modelGroup = formatModelGroup(this.theme, this.ctx.model?.id, this.ctx.thinkingLevel);
		const ctxUsage = this.ctx.getContextUsage?.();
		const contextGroup = formatContextGroup(this.theme, ctxUsage?.percent, this.getCacheHitRate());

		const extMap = this.footerData.getExtensionStatuses?.() ?? new Map<string, string>();
		const rawGptStatus = extMap.get("gpt-rate-limits");
		const gptStatus = rawGptStatus ? sanitizeStatus(rawGptStatus) : undefined;

		const items: StripItem[] = [];
		if (contextGroup) {
			items.push({
				id: "context",
				rendered: contextGroup,
				displayIndex: 2,
				priority: 1,
			});
		}
		if (gptStatus) {
			items.push({
				id: "gpt-rate-limits",
				rendered: gptStatus,
				displayIndex: 3,
				priority: 2,
			});
		}
		if (modelGroup) {
			items.push({
				id: "model",
				rendered: modelGroup,
				displayIndex: 1,
				priority: 3,
			});
		}
		if (location) {
			items.push({
				id: "location",
				rendered: location,
				displayIndex: 0,
				priority: 4,
			});
		}

		if (items.length === 0) return [""];

		const prioritized = [...items].sort((a, b) => a.priority - b.priority);
		const first = prioritized[0];
		if (visibleWidth(first.rendered) > width) {
			return [truncateToWidth(first.rendered, width, "")];
		}

		const included: StripItem[] = [first];
		for (let i = 1; i < prioritized.length; i++) {
			const candidate = prioritized[i];
			const testSet = [...included, candidate].sort((a, b) => a.displayIndex - b.displayIndex);
			const testLine = testSet.map((item) => item.rendered).join(separator);
			if (visibleWidth(testLine) <= width) {
				included.push(candidate);
			} else {
				break;
			}
		}

		included.sort((a, b) => a.displayIndex - b.displayIndex);
		const line = included.map((item) => item.rendered).join(separator);
		return [line];
	}
}
