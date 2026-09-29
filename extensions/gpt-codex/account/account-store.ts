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

export const RATE_LIMIT_REFRESH_INTERVAL_OPTIONS = [
	{ label: "1m", intervalMs: 60_000 },
	{ label: "5m", intervalMs: 5 * 60_000 },
	{ label: "10m", intervalMs: 10 * 60_000 },
	{ label: "30m", intervalMs: 30 * 60_000 },
	{ label: "1h", intervalMs: 60 * 60_000 },
] as const;

export type RateLimitsStatusSettings = {
	enabled: boolean;
	periodicRefresh: boolean;
	intervalMs: number;
	refreshOnAgentEnd: boolean;
	refreshOnTurnEnd: boolean;
	refreshOnToolExecutionEnd: boolean;
};

export const DEFAULT_RATE_LIMITS_STATUS_SETTINGS: RateLimitsStatusSettings = {
	enabled: true,
	periodicRefresh: true,
	intervalMs: 5 * 60_000,
	refreshOnAgentEnd: true,
	refreshOnTurnEnd: false,
	refreshOnToolExecutionEnd: true,
};

type GptCodexSettings = {
	rateLimitsStatus?: RateLimitsStatusSettings;
	[key: string]: unknown;
};

type StoredAccount = {
	credential: CodexCredential;
	createdAt: string;
	updatedAt: string;
	lastSelectedAt?: string;
};

export type AccountStore = {
	lastSelectedAccountId?: string;
	accounts: Record<string, StoredAccount>;
	settings?: GptCodexSettings;
	piAuthImported?: boolean;
};

function nowIso(): string {
	return new Date().toISOString();
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function errorCode(error: unknown): string | undefined {
	return isObject(error) && typeof error.code === "string" ? error.code : undefined;
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
	if (!isObject(value)) return false;
	return (
		value.type === "oauth" &&
		typeof value.access === "string" &&
		typeof value.refresh === "string" &&
		typeof value.expires === "number" &&
		typeof value.accountId === "string"
	);
}

function booleanSetting(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function intervalSetting(value: unknown): number {
	return RATE_LIMIT_REFRESH_INTERVAL_OPTIONS.some((option) => option.intervalMs === value)
		? (value as number)
		: DEFAULT_RATE_LIMITS_STATUS_SETTINGS.intervalMs;
}

function parseRateLimitsStatusSettings(value: unknown): RateLimitsStatusSettings {
	const input = isObject(value) ? value : {};
	return {
		enabled: booleanSetting(input.enabled, DEFAULT_RATE_LIMITS_STATUS_SETTINGS.enabled),
		periodicRefresh: booleanSetting(input.periodicRefresh, DEFAULT_RATE_LIMITS_STATUS_SETTINGS.periodicRefresh),
		intervalMs: intervalSetting(input.intervalMs),
		refreshOnAgentEnd: booleanSetting(input.refreshOnAgentEnd, DEFAULT_RATE_LIMITS_STATUS_SETTINGS.refreshOnAgentEnd),
		refreshOnTurnEnd: booleanSetting(input.refreshOnTurnEnd, DEFAULT_RATE_LIMITS_STATUS_SETTINGS.refreshOnTurnEnd),
		refreshOnToolExecutionEnd: booleanSetting(
			input.refreshOnToolExecutionEnd,
			DEFAULT_RATE_LIMITS_STATUS_SETTINGS.refreshOnToolExecutionEnd,
		),
	};
}

function parseSettings(value: unknown): GptCodexSettings | undefined {
	if (!isObject(value)) return undefined;
	const settings: GptCodexSettings = { ...value };
	if ("rateLimitsStatus" in value) settings.rateLimitsStatus = parseRateLimitsStatusSettings(value.rateLimitsStatus);
	return settings;
}

export function rateLimitRefreshIntervalLabel(intervalMs: number): string {
	return RATE_LIMIT_REFRESH_INTERVAL_OPTIONS.find((option) => option.intervalMs === intervalMs)?.label ?? "5m";
}

export function rateLimitRefreshIntervalFromLabel(label: string): number | undefined {
	return RATE_LIMIT_REFRESH_INTERVAL_OPTIONS.find((option) => option.label === label)?.intervalMs;
}

function readStore(): AccountStore {
	if (!existsSync(STORE_PATH)) return { accounts: {} };
	const parsed = JSON.parse(readFileSync(STORE_PATH, "utf-8")) as unknown;
	if (!isObject(parsed) || !isObject(parsed.accounts)) return { accounts: {} };

	const accounts: Record<string, StoredAccount> = {};
	for (const [accountId, account] of Object.entries(parsed.accounts)) {
		if (!isObject(account) || !isCodexCredential(account.credential)) continue;
		if (account.credential.accountId !== accountId) continue;
		accounts[accountId] = {
			credential: account.credential,
			createdAt: typeof account.createdAt === "string" ? account.createdAt : nowIso(),
			updatedAt: typeof account.updatedAt === "string" ? account.updatedAt : nowIso(),
			lastSelectedAt: typeof account.lastSelectedAt === "string" ? account.lastSelectedAt : undefined,
		};
	}

	const selectedAccountId =
		typeof parsed.lastSelectedAccountId === "string"
			? parsed.lastSelectedAccountId
			: typeof parsed.activeAccountId === "string"
				? parsed.activeAccountId
				: undefined;
	const lastSelectedAccountId = selectedAccountId && accounts[selectedAccountId] ? selectedAccountId : undefined;
	const settings = parseSettings(parsed.settings);
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

export function updateAccountStore<T>(mutate: (store: AccountStore) => T): T {
	return withStoreLock(() => {
		const store = readStore();
		const result = mutate(store);
		writeStore(store);
		return result;
	});
}

export function readRateLimitsStatusSettings(): RateLimitsStatusSettings {
	return readAccountStore().settings?.rateLimitsStatus ?? { ...DEFAULT_RATE_LIMITS_STATUS_SETTINGS };
}

export function saveRateLimitsStatusSettings(settings: RateLimitsStatusSettings): void {
	updateAccountStore((store) => {
		store.settings = {
			...(store.settings ?? {}),
			rateLimitsStatus: parseRateLimitsStatusSettings(settings),
		};
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
	};
	if (markSelected) store.lastSelectedAccountId = credential.accountId;
}

export function markAccountSelected(store: AccountStore, accountId: string): void {
	const account = store.accounts[accountId];
	if (!account) throw new Error(`ChatGPT account is not saved: ${accountId}`);
	account.lastSelectedAt = nowIso();
	store.lastSelectedAccountId = accountId;
}
