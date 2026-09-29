import {
	chmodSync,
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { errorCode } from "../common/errors.ts";
import { isRecord } from "../common/guards.ts";

const STORE_PATH = join(getAgentDir(), "gpt-accounts.json");
const LOCK_PATH = `${STORE_PATH}.lock`;
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 25;

export type CodexCredential = {
	type: "oauth";
	access: string;
	refresh: string;
	expires: number;
	accountId: string;
	[key: string]: unknown;
};

type StoredAccount = {
	credential: CodexCredential;
	createdAt: string;
	updatedAt: string;
	lastSelectedAt?: string;
	alias?: string;
};

export type AccountStore = {
	lastSelectedAccountId?: string;
	accounts: Record<string, StoredAccount>;
	settings?: Record<string, unknown>;
	piAuthImported?: boolean;
};

function nowIso(): string {
	return new Date().toISOString();
}

function normalizeAccountAlias(alias: string): string | undefined {
	return alias.trim() || undefined;
}

function sleepSync(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireStoreLock(): number {
	mkdirSync(dirname(STORE_PATH), { recursive: true, mode: 0o700 });
	const startedAt = Date.now();

	for (;;) {
		try {
			return openSync(LOCK_PATH, "wx", 0o600);
		} catch (error) {
			if (errorCode(error) !== "EEXIST") throw error;

			try {
				if (Date.now() - statSync(LOCK_PATH).mtimeMs > LOCK_STALE_MS) {
					unlinkSync(LOCK_PATH);
					continue;
				}
			} catch {
				continue;
			}

			if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
				throw new Error(`Timed out waiting for account store lock: ${LOCK_PATH}`);
			}
			sleepSync(LOCK_RETRY_MS);
		}
	}
}

function withStoreLock<T>(fn: () => T): T {
	const fd = acquireStoreLock();
	try {
		return fn();
	} finally {
		try {
			closeSync(fd);
		} finally {
			try {
				unlinkSync(LOCK_PATH);
			} catch {
				// Another process may have cleared a stale lock.
			}
		}
	}
}

export function isCodexCredential(value: unknown): value is CodexCredential {
	if (!isRecord(value)) return false;
	return (
		value.type === "oauth" &&
		typeof value.access === "string" &&
		typeof value.refresh === "string" &&
		typeof value.expires === "number" &&
		typeof value.accountId === "string"
	);
}

function readStore(): AccountStore {
	if (!existsSync(STORE_PATH)) return { accounts: {} };
	const parsed = JSON.parse(readFileSync(STORE_PATH, "utf-8")) as unknown;
	if (!isRecord(parsed) || !isRecord(parsed.accounts)) return { accounts: {} };

	const accounts: Record<string, StoredAccount> = {};
	for (const [accountId, account] of Object.entries(parsed.accounts)) {
		if (!isRecord(account) || !isCodexCredential(account.credential)) continue;
		if (account.credential.accountId !== accountId) continue;
		accounts[accountId] = {
			credential: account.credential,
			createdAt: typeof account.createdAt === "string" ? account.createdAt : nowIso(),
			updatedAt: typeof account.updatedAt === "string" ? account.updatedAt : nowIso(),
			lastSelectedAt: typeof account.lastSelectedAt === "string" ? account.lastSelectedAt : undefined,
			alias: typeof account.alias === "string" ? normalizeAccountAlias(account.alias) : undefined,
		};
	}

	const selectedAccountId =
		typeof parsed.lastSelectedAccountId === "string"
			? parsed.lastSelectedAccountId
			: typeof parsed.activeAccountId === "string"
				? parsed.activeAccountId
				: undefined;
	const lastSelectedAccountId = selectedAccountId && accounts[selectedAccountId] ? selectedAccountId : undefined;
	const settings = isRecord(parsed.settings) ? { ...parsed.settings } : undefined;
	return {
		lastSelectedAccountId,
		accounts,
		...(settings ? { settings } : {}),
		...(parsed.piAuthImported === true ? { piAuthImported: true } : {}),
	};
}

function writeStore(store: AccountStore): void {
	mkdirSync(dirname(STORE_PATH), { recursive: true, mode: 0o700 });
	const tempPath = `${STORE_PATH}.${process.pid}.tmp`;
	writeFileSync(tempPath, JSON.stringify(store, null, 2), "utf-8");
	chmodSync(tempPath, 0o600);
	renameSync(tempPath, STORE_PATH);
	chmodSync(STORE_PATH, 0o600);
}

export function readAccountStore(): AccountStore {
	return readStore();
}

export function readAccountAlias(accountId: string): string | undefined {
	return readStore().accounts[accountId]?.alias;
}

export function updateAccountStore<T>(mutate: (store: AccountStore) => T): T {
	return withStoreLock(() => {
		const store = readStore();
		const result = mutate(store);
		writeStore(store);
		return result;
	});
}

export function saveAccount(store: AccountStore, credential: CodexCredential, markSelected: boolean): void {
	const now = nowIso();
	const existing = store.accounts[credential.accountId];
	store.accounts[credential.accountId] = {
		credential,
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
		lastSelectedAt: markSelected ? now : existing?.lastSelectedAt,
		alias: existing?.alias,
	};
	if (markSelected) store.lastSelectedAccountId = credential.accountId;
}

export function saveAccountAlias(accountId: string, alias: string | undefined): string | undefined {
	const normalized = normalizeAccountAlias(alias ?? "");
	return updateAccountStore((store) => {
		const account = store.accounts[accountId];
		if (!account) throw new Error(`ChatGPT account is not saved: ${accountId}`);

		if (normalized) {
			const aliasKey = normalized.toLowerCase();
			const duplicate = Object.entries(store.accounts).find(
				([otherAccountId, other]) =>
					otherAccountId !== accountId && other.alias?.toLowerCase() === aliasKey,
			);
			if (duplicate) throw new Error(`Alias "${normalized}" is already in use.`);
			account.alias = normalized;
		} else {
			delete account.alias;
		}
		return normalized;
	});
}

export function markAccountSelected(store: AccountStore, accountId: string): void {
	const account = store.accounts[accountId];
	if (!account) throw new Error(`ChatGPT account is not saved: ${accountId}`);
	account.lastSelectedAt = nowIso();
	store.lastSelectedAccountId = accountId;
}
