import {
	DynamicBorder,
	type ExtensionAPI,
	type ExtensionCommandContext,
	getSettingsListTheme,
} from "@earendil-works/pi-coding-agent";
import {
	Key,
	matchesKey,
	type SelectItem,
	SelectList,
	SettingsList,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import type { AuthInteraction } from "@earendil-works/pi-ai";

import {
	loginCodex,
	refreshCodexCredential,
	registerCodexProvider,
	removeCodexAccount,
	saveCodexCredential,
} from "./auth.ts";
import {
	type AccountStore,
	type CodexCredential,
	readAccountStore,
	saveAccountAlias,
} from "./store.ts";
import { shortenAccountId, uniqueAccountDisplayIds } from "../common/account-id.ts";
import { openUrl } from "../common/browser.ts";
import { errorMessage } from "../common/errors.ts";
import { rateLimitsStatusSettingsItems, updateRateLimitsStatusSetting } from "../rate-limit/settings.ts";
import type { RateLimitsStatusController } from "../rate-limit/status.ts";
import {
	describeGptRateLimitError,
	fetchGptRateLimits,
	formatGptRateLimitDescription,
} from "../rate-limit/usage.ts";
import type { SessionAccountController } from "./session.ts";

const PRIMARY_COMMAND = "gpt-codex";

function requireTui(ctx: ExtensionCommandContext): boolean {
	if (ctx.mode === "tui") return true;
	if (ctx.hasUI) ctx.ui.notify("gpt-codex account UI requires TUI mode.", "warning");
	return false;
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

function accountDisplayName(store: AccountStore, accountId: string, fallback?: string): string {
	return store.accounts[accountId]?.alias ?? fallback ?? shortenAccountId(accountId);
}

async function offerAccountAlias(ctx: ExtensionCommandContext, accountId: string): Promise<string | undefined> {
	const existingAlias = readAccountStore().accounts[accountId]?.alias;
	if (existingAlias) return existingAlias;

	const value = await ctx.ui.input(
		`Optional alias for ${shortenAccountId(accountId)}`,
		"Leave blank to use the account ID",
	);
	if (value === undefined || !value.trim()) return undefined;

	try {
		return saveAccountAlias(accountId, value);
	} catch (error) {
		ctx.ui.notify(`Account saved, but alias was not set: ${errorMessage(error)}`, "warning");
		return undefined;
	}
}

async function addAccount(
	ctx: ExtensionCommandContext,
	status: RateLimitsStatusController,
	sessionAccount: SessionAccountController,
): Promise<void> {
	try {
		const credential = await loginCodex(accountLoginInteraction(ctx));
		saveCodexCredential(credential);
		sessionAccount.select(credential.accountId);

		const alias = await offerAccountAlias(ctx, credential.accountId);
		status.reconfigure(ctx);
		const displayName = alias ?? accountDisplayName(readAccountStore(), credential.accountId);
		ctx.ui.notify(`Using ${displayName} in this session. New sessions will start with it.`, "info");
	} catch (error) {
		const message = errorMessage(error);
		if (message !== "Login cancelled") ctx.ui.notify(`Failed to add account: ${message}`, "error");
	}
}

function sortedAccountIds(store: AccountStore, currentAccountId: string | undefined): string[] {
	return Object.keys(store.accounts).sort((a, b) => {
		if (a === currentAccountId) return -1;
		if (b === currentAccountId) return 1;
		const aTime = Date.parse(store.accounts[a]?.lastSelectedAt ?? store.accounts[a]?.updatedAt ?? "") || 0;
		const bTime = Date.parse(store.accounts[b]?.lastSelectedAt ?? store.accounts[b]?.updatedAt ?? "") || 0;
		return bTime - aTime;
	});
}

type AccountRow = {
	accountId: string;
	displayName: string;
	credential: CodexCredential;
	item: SelectItem;
};

function buildAccountRows(store: AccountStore, currentAccountId: string | undefined): AccountRow[] {
	const accountIds = sortedAccountIds(store, currentAccountId);
	const displayIds = uniqueAccountDisplayIds(accountIds);

	return accountIds.map((accountId): AccountRow => {
		const entry = store.accounts[accountId];
		if (!entry) throw new Error(`missing account ${accountId}`);

		const displayName = accountDisplayName(store, accountId, displayIds.get(accountId));
		const label = accountId === currentAccountId ? `● ${displayName}` : displayName;
		return {
			accountId,
			displayName,
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

function switchToAccount(
	ctx: ExtensionCommandContext,
	row: AccountRow,
	status: RateLimitsStatusController,
	sessionAccount: SessionAccountController,
): void {
	sessionAccount.select(row.accountId);
	status.reconfigure(ctx);
	ctx.ui.notify(`Using ${row.displayName} in this session. New sessions will start with it.`, "info");
}

async function editAccountAlias(
	ctx: ExtensionCommandContext,
	accountId: string,
	status: RateLimitsStatusController,
	sessionAccount: SessionAccountController,
): Promise<void> {
	const account = readAccountStore().accounts[accountId];
	if (!account) {
		ctx.ui.notify(`Account ${shortenAccountId(accountId)} is no longer saved.`, "warning");
		return;
	}

	const value = await ctx.ui.input(
		`Alias for ${account.alias ?? shortenAccountId(accountId)}`,
		account.alias ? "Leave blank to clear the alias" : "Enter an alias or leave blank",
	);
	if (value === undefined || (!account.alias && !value.trim())) return;

	try {
		const alias = saveAccountAlias(accountId, value);
		const message = alias ? `Account alias set to ${alias}.` : `Cleared alias for ${shortenAccountId(accountId)}.`;
		ctx.ui.notify(message, "info");
		if (sessionAccount.getAccountId() === accountId) status.reconfigure(ctx);
	} catch (error) {
		ctx.ui.notify(`Failed to update account alias: ${errorMessage(error)}`, "error");
	}
}

function removeStoredAccount(
	ctx: ExtensionCommandContext,
	accountId: string,
	status: RateLimitsStatusController,
	sessionAccount: SessionAccountController,
): void {
	const displayName = accountDisplayName(readAccountStore(), accountId);
	const wasCurrent = sessionAccount.getAccountId() === accountId;
	const result = removeCodexAccount(accountId);
	if (wasCurrent) status.reconfigure(ctx);

	if (!result.existed) {
		ctx.ui.notify(`Account ${displayName} was already removed.`, "warning");
		return;
	}

	const suffix = wasCurrent ? " Select another account before the next request." : "";
	ctx.ui.notify(`Removed ${displayName}.${suffix}`, wasCurrent ? "warning" : "info");
}

type AccountHubResult =
	| { type: "switch"; row: AccountRow }
	| { type: "add" }
	| { type: "edit-alias"; accountId: string }
	| { type: "remove"; accountId: string };

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
				rateLimitsStatusSettingsItems(),
				8,
				getSettingsListTheme(),
				(id, value) => {
					if (updateRateLimitsStatusSetting(id, value)) status.reconfigure(ctx);
				},
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
						: "↵ switch · a add · e alias · d remove · r refresh · tab config · esc";
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
					else if (matchesKey(data, "e")) {
						const accountId = accountList?.getSelectedItem()?.value;
						if (accountId) close({ type: "edit-alias", accountId });
					} else if (matchesKey(data, "d") || matchesKey(data, Key.delete)) {
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

async function showAccountHub(
	ctx: ExtensionCommandContext,
	status: RateLimitsStatusController,
	sessionAccount: SessionAccountController,
): Promise<void> {
	if (!ctx.isIdle()) await ctx.waitForIdle();

	const result = await selectAccountHubAction(
		ctx,
		buildAccountRows(readAccountStore(), sessionAccount.getAccountId()),
		status,
	);
	if (!result) return;
	if (result.type === "switch") return switchToAccount(ctx, result.row, status, sessionAccount);
	if (result.type === "add") return addAccount(ctx, status, sessionAccount);
	if (result.type === "edit-alias") return editAccountAlias(ctx, result.accountId, status, sessionAccount);
	return removeStoredAccount(ctx, result.accountId, status, sessionAccount);
}

export function registerAccountManager(
	pi: ExtensionAPI,
	status: RateLimitsStatusController,
	sessionAccount: SessionAccountController,
): void {
	registerCodexProvider(pi, sessionAccount);

	pi.registerCommand(PRIMARY_COMMAND, {
		description: "Manage ChatGPT OAuth accounts and rate-limit status",
		handler: async (_args, ctx) => {
			try {
				if (!requireTui(ctx)) return;
				return showAccountHub(ctx, status, sessionAccount);
			} catch (error) {
				ctx.ui.notify(`GPT account command failed: ${errorMessage(error)}`, "error");
			}
		},
	});
}
