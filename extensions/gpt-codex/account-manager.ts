import { spawn } from "node:child_process";
import {
	DynamicBorder,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	getSettingsListTheme,
} from "@earendil-works/pi-coding-agent";
import {
	Key,
	matchesKey,
	type SelectItem,
	SelectList,
	type SettingItem,
	SettingsList,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import type { AuthInteraction } from "@earendil-works/pi-ai";

import {
	loginCodex,
	refreshCodexCredential,
	registerCodexProvider,
	removeCodexAccount,
	restoreActiveCodexCredential,
	selectCodexCredential,
} from "./codex-auth.ts";
import {
	RATE_LIMIT_REFRESH_INTERVAL_OPTIONS,
	type AccountStore,
	type CodexCredential,
	rateLimitRefreshIntervalFromLabel,
	rateLimitRefreshIntervalLabel,
	readAccountStore,
	readRateLimitsStatusSettings,
	saveRateLimitsStatusSettings,
} from "./account-store.ts";
import {
	describeGptRateLimitError,
	fetchGptRateLimits,
	formatGptRateLimitDescription,
	shortenAccountId,
} from "./rate-limits.ts";
import type { RateLimitsStatusController } from "./rate-limits-status.ts";

const PRIMARY_COMMAND = "gpt-codex";

function openUrl(url: string): void {
	const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
	const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
	try {
		const child = spawn(command, args, { detached: true, stdio: "ignore" });
		child.unref();
	} catch {
		// The prompt still shows the URL for manual opening.
	}
}

function requireTui(ctx: ExtensionCommandContext): boolean {
	if (ctx.mode === "tui") return true;
	if (ctx.hasUI) ctx.ui.notify("gpt-codex account UI requires TUI mode.", "warning");
	return false;
}

function statusSettingsItems(): SettingItem[] {
	const settings = readRateLimitsStatusSettings();
	return [
		{
			id: "enabled",
			label: "Rate-limit status",
			currentValue: settings.enabled ? "enabled" : "disabled",
			values: ["enabled", "disabled"],
		},
		{
			id: "periodicRefresh",
			label: "Periodic refresh",
			currentValue: settings.periodicRefresh ? "on" : "off",
			values: ["on", "off"],
		},
		{
			id: "intervalMs",
			label: "Refresh interval",
			currentValue: rateLimitRefreshIntervalLabel(settings.intervalMs),
			values: RATE_LIMIT_REFRESH_INTERVAL_OPTIONS.map((option) => option.label),
		},
		{
			id: "refreshOnAgentEnd",
			label: "After agent completes",
			currentValue: settings.refreshOnAgentEnd ? "on" : "off",
			values: ["on", "off"],
		},
		{
			id: "refreshOnTurnEnd",
			label: "After each turn completes",
			currentValue: settings.refreshOnTurnEnd ? "on" : "off",
			values: ["on", "off"],
		},
		{
			id: "refreshOnToolExecutionEnd",
			label: "After each tool completes",
			currentValue: settings.refreshOnToolExecutionEnd ? "on" : "off",
			values: ["on", "off"],
		},
	];
}

function saveStatusSetting(id: string, value: string, status: RateLimitsStatusController, ctx: ExtensionContext): void {
	const settings = readRateLimitsStatusSettings();
	const next = { ...settings };

	if (id === "enabled") next.enabled = value === "enabled";
	else if (id === "periodicRefresh") next.periodicRefresh = value === "on";
	else if (id === "intervalMs") next.intervalMs = rateLimitRefreshIntervalFromLabel(value) ?? next.intervalMs;
	else if (id === "refreshOnAgentEnd") next.refreshOnAgentEnd = value === "on";
	else if (id === "refreshOnTurnEnd") next.refreshOnTurnEnd = value === "on";
	else if (id === "refreshOnToolExecutionEnd") next.refreshOnToolExecutionEnd = value === "on";
	else return;

	saveRateLimitsStatusSettings(next);
	status.reconfigure(ctx);
}

function accountLoginInteraction(ctx: ExtensionCommandContext): AuthInteraction {
	return {
		async prompt(prompt) {
			if (prompt.type === "select") {
				const labels = prompt.options.map((option) => option.label);
				const selected = await ctx.ui.select(prompt.message, labels, { signal: prompt.signal });
				if (selected === undefined) throw new Error("Login cancelled");
				const option = prompt.options.find((option) => option.label === selected);
				if (!option) throw new Error("Invalid login method selected");
				return option.id;
			}

			const value = await ctx.ui.input(prompt.message, prompt.placeholder, { signal: prompt.signal });
			if (value === undefined) throw new Error("Login cancelled");
			return value;
		},
		notify(event) {
			if (event.type === "auth_url") {
				openUrl(event.url);
				ctx.ui.notify(event.instructions ?? "OpenAI OAuth login started in your browser.", "info");
				return;
			}
			if (event.type === "device_code") {
				openUrl(event.verificationUri);
				ctx.ui.notify(`Open ${event.verificationUri} and enter code ${event.userCode}.`, "info");
				return;
			}
			if (event.type === "progress") {
				ctx.ui.notify(event.message, "info");
				return;
			}
			const links = event.links?.map((link) => link.url).join(" · ");
			ctx.ui.notify(links ? `${event.message} ${links}` : event.message, "info");
		},
	};
}

async function addAccount(ctx: ExtensionCommandContext, status: RateLimitsStatusController): Promise<void> {
	try {
		const credential = await loginCodex(accountLoginInteraction(ctx));
		selectCodexCredential(credential);
		status.reconfigure(ctx);
		ctx.ui.notify(`Added and selected ${shortenAccountId(credential.accountId)}.`, "info");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message !== "Login cancelled") ctx.ui.notify(`Failed to add account: ${message}`, "error");
	}
}

function sortedAccountIds(store: AccountStore): string[] {
	return Object.keys(store.accounts).sort((a, b) => {
		if (a === store.activeAccountId) return -1;
		if (b === store.activeAccountId) return 1;
		const aTime = Date.parse(store.accounts[a]?.lastSelectedAt ?? store.accounts[a]?.updatedAt ?? "") || 0;
		const bTime = Date.parse(store.accounts[b]?.lastSelectedAt ?? store.accounts[b]?.updatedAt ?? "") || 0;
		return bTime - aTime;
	});
}

function uniqueDisplayIds(accountIds: string[]): Map<string, string> {
	const lengths = [
		[6, 4],
		[8, 6],
		[10, 8],
		[12, 12],
	] as const;

	for (const [prefixLength, suffixLength] of lengths) {
		const labels = accountIds.map((id) => shortenAccountId(id, prefixLength, suffixLength));
		if (new Set(labels).size === labels.length) {
			return new Map(accountIds.map((id, index) => [id, labels[index] ?? id]));
		}
	}
	return new Map(accountIds.map((id) => [id, id]));
}

type AccountRow = {
	accountId: string;
	credential: CodexCredential;
	item: SelectItem;
};

function buildAccountRows(store: AccountStore): AccountRow[] {
	const accountIds = sortedAccountIds(store);
	const displayIds = uniqueDisplayIds(accountIds);

	return accountIds.map((accountId): AccountRow => {
		const entry = store.accounts[accountId];
		if (!entry) throw new Error(`missing account ${accountId}`);

		const displayId = displayIds.get(accountId) ?? accountId;
		const label = accountId === store.activeAccountId ? `● active · ${displayId}` : displayId;
		return {
			accountId,
			credential: entry.credential,
			item: { value: accountId, label, description: "loading limits…" },
		};
	});
}

async function updateAccountRowStatus(row: AccountRow, signal: AbortSignal, onChange: () => void): Promise<void> {
	try {
		row.credential = await refreshCodexCredential(row.credential, signal);
		if (signal.aborted) return;

		const snapshot = await fetchGptRateLimits({
			accessToken: row.credential.access,
			accountId: row.accountId,
			signal,
		});
		if (signal.aborted) return;

		row.item.description = formatGptRateLimitDescription(snapshot);
		onChange();
	} catch (error) {
		if (signal.aborted) return;
		row.item.description = describeGptRateLimitError(error);
		onChange();
	}
}

function switchToAccount(ctx: ExtensionCommandContext, row: AccountRow, status: RateLimitsStatusController): void {
	selectCodexCredential(row.credential);
	status.reconfigure(ctx);
	ctx.ui.notify(`Selected ${shortenAccountId(row.accountId)}.`, "info");
}

function removeStoredAccount(
	ctx: ExtensionCommandContext,
	accountId: string,
	status: RateLimitsStatusController,
): void {
	const result = removeCodexAccount(accountId);
	if (result.removedActive) status.reconfigure(ctx);

	if (!result.existed) {
		ctx.ui.notify(`Account ${shortenAccountId(accountId)} was already removed.`, "warning");
		return;
	}

	ctx.ui.notify(`Removed ${shortenAccountId(accountId)}.`, "info");
}

type AccountHubResult = { type: "switch"; row: AccountRow } | { type: "add" } | { type: "remove"; accountId: string };

async function selectAccountHubAction(
	ctx: ExtensionCommandContext,
	rows: AccountRow[],
	status: RateLimitsStatusController,
): Promise<AccountHubResult | null> {
	let closed = false;
	let refreshController: AbortController | undefined;
	const rowsById = new Map(rows.map((row) => [row.accountId, row]));

	try {
		const result = await ctx.ui.custom<AccountHubResult | null>((tui, theme, _keybindings, done) => {
			let configTab = false;
			const topBorder = new DynamicBorder((text: string) => theme.fg("accent", text));
			const bottomBorder = new DynamicBorder((text: string) => theme.fg("accent", text));
			const line = (text: string, width: number) => truncateToWidth(text, width, "");
			const close = (result: AccountHubResult | null) => {
				if (closed) return;
				closed = true;
				refreshController?.abort();
				done(result);
			};

			const accountList = rows.length
				? new SelectList(
						rows.map((row) => row.item),
						Math.min(rows.length, 10),
						{
							selectedPrefix: (text: string) => theme.fg("accent", text),
							selectedText: (text: string) => theme.fg("accent", text),
							description: (text: string) => theme.fg("muted", text),
							scrollInfo: (text: string) => theme.fg("dim", text),
							noMatch: (text: string) => theme.fg("warning", text),
						},
					)
				: undefined;
			const configList = new SettingsList(
				statusSettingsItems(),
				8,
				getSettingsListTheme(),
				(id, value) => saveStatusSetting(id, value, status, ctx),
				() => close(null),
			);

			function refreshRows(): void {
				refreshController?.abort();
				const controller = new AbortController();
				refreshController = controller;
				for (const row of rows) {
					row.item.description = "loading limits…";
					void updateAccountRowStatus(row, controller.signal, () => tui.requestRender());
				}
				tui.requestRender();
			}

			accountList?.setSelectedIndex(0);
			if (accountList) {
				accountList.onSelect = (item) => {
					const row = rowsById.get(item.value);
					if (row) close({ type: "switch", row });
				};
				accountList.onCancel = () => close(null);
			}
			refreshRows();

			function renderTab(label: string, active: boolean): string {
				const text = ` ${label} `;
				return active ? theme.bg("selectedBg", theme.fg("accent", theme.bold(text))) : theme.fg("muted", text);
			}

			return {
				render(width: number) {
					const page = configTab
						? configList.render(width)
						: (accountList?.render(width) ?? [
								line(theme.fg("warning", "  No saved ChatGPT accounts."), width),
								line(theme.fg("dim", "  Press a to add one."), width),
							]);
					const help = configTab
						? "↵/space change · r refresh · tab accounts · esc"
						: "↵ switch · a add · d remove · r refresh · tab config · esc";
					return [
						...topBorder.render(width),
						line(theme.fg("accent", theme.bold("ChatGPT accounts")), width),
						line(`${renderTab("Accounts", !configTab)}${theme.fg("dim", " ")}${renderTab("Config", configTab)}`, width),
						"",
						...page,
						"",
						line(theme.fg("dim", help), width),
						...bottomBorder.render(width),
					];
				},
				invalidate() {
					topBorder.invalidate();
					bottomBorder.invalidate();
					accountList?.invalidate();
					configList.invalidate();
				},
				handleInput(data: string) {
					if (matchesKey(data, Key.tab) || matchesKey(data, Key.shift(Key.tab))) {
						configTab = !configTab;
						tui.requestRender();
						return;
					}
					if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) return close(null);

					if (configTab) {
						if (matchesKey(data, "r")) void status.refresh(ctx, { force: true, notify: true });
						else configList.handleInput(data);
					} else if (matchesKey(data, "a")) close({ type: "add" });
					else if (matchesKey(data, "d") || matchesKey(data, Key.delete)) {
						const accountId = accountList?.getSelectedItem()?.value;
						if (accountId) close({ type: "remove", accountId });
					} else if (matchesKey(data, "r")) refreshRows();
					else accountList?.handleInput(data);
					tui.requestRender();
				},
			};
		});
		return result ?? null;
	} finally {
		closed = true;
		refreshController?.abort();
	}
}

async function showAccountHub(ctx: ExtensionCommandContext, status: RateLimitsStatusController): Promise<void> {
	if (!ctx.isIdle()) await ctx.waitForIdle();
	if (restoreActiveCodexCredential()) status.reconfigure(ctx);

	const result = await selectAccountHubAction(ctx, buildAccountRows(readAccountStore()), status);
	if (!result) return;
	if (result.type === "switch") return switchToAccount(ctx, result.row, status);
	if (result.type === "add") return addAccount(ctx, status);
	return removeStoredAccount(ctx, result.accountId, status);
}

export function registerAccountManager(pi: ExtensionAPI, status: RateLimitsStatusController): void {
	registerCodexProvider(pi);

	pi.on("session_start", (_event, ctx) => {
		try {
			if (restoreActiveCodexCredential()) status.reconfigure(ctx);
		} catch (error) {
			if (ctx.mode === "tui") {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`GPT account restore failed: ${message}`, "warning");
			}
		}
	});

	pi.registerCommand(PRIMARY_COMMAND, {
		description: "Manage ChatGPT OAuth accounts and rate-limit status",
		handler: async (_args, ctx) => {
			try {
				if (!requireTui(ctx)) return;
				return showAccountHub(ctx, status);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`GPT account command failed: ${message}`, "error");
			}
		},
	});
}
