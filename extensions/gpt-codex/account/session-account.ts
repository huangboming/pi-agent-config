import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { markAccountSelected, readAccountStore, updateAccountStore } from "./account-store.ts";

const SESSION_ACCOUNT_ENTRY = "gpt-codex/account";

type PersistedSelection = {
	found: boolean;
	accountId?: string;
};

export type SessionAccountController = {
	getAccountId(): string | undefined;
	select(accountId: string): void;
};

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function readPersistedSelection(entries: readonly unknown[]): PersistedSelection {
	let selection: PersistedSelection = { found: false };
	for (const entry of entries) {
		if (!isObject(entry) || entry.type !== "custom" || entry.customType !== SESSION_ACCOUNT_ENTRY) continue;
		if (!isObject(entry.data)) continue;
		if (typeof entry.data.accountId === "string") {
			selection = { found: true, accountId: entry.data.accountId };
		} else if (entry.data.accountId === null) {
			selection = { found: true };
		}
	}
	return selection;
}

export function registerSessionAccount(pi: ExtensionAPI): SessionAccountController {
	let accountId: string | undefined;

	function persistSelection(selectedAccountId: string | undefined): void {
		pi.appendEntry(SESSION_ACCOUNT_ENTRY, { accountId: selectedAccountId ?? null });
	}

	pi.on("session_start", (event, ctx) => {
		const persisted = readPersistedSelection(ctx.sessionManager.getEntries());
		if (event.reason !== "new" && event.reason !== "fork" && persisted.found) {
			accountId = persisted.accountId;
			return;
		}

		accountId = readAccountStore().lastSelectedAccountId;
		persistSelection(accountId);
	});

	return {
		getAccountId: () => accountId,
		select(selectedAccountId) {
			updateAccountStore((store) => markAccountSelected(store, selectedAccountId));
			if (accountId === selectedAccountId) return;
			accountId = selectedAccountId;
			persistSelection(selectedAccountId);
		},
	};
}
