import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { getAgentDir, ModelRuntime, readStoredCredential, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	lazyStream,
	type AuthInteraction,
	type OAuthCredentials,
	type OAuthLoginCallbacks,
	type Provider,
} from "@earendil-works/pi-ai";

import {
	isCodexCredential,
	readAccountStore,
	saveAccount,
	updateAccountStore,
	type CodexCredential,
} from "./account-store.ts";

export const CODEX_PROVIDER = "openai-codex";

const AUTH_PATH = join(getAgentDir(), "auth.json");
const AUTH_LOCK_PATH = `${AUTH_PATH}.lock`;
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 20;
const REFRESH_MARGIN_MS = 60_000;
const BRIDGE_API_KEY = "gpt-codex-extension";

let providerPromise: Promise<Provider> | undefined;
const refreshes = new Map<string, Promise<CodexCredential>>();

async function getProvider(): Promise<Provider> {
	providerPromise ??= ModelRuntime.create({ modelsPath: null, allowModelNetwork: false }).then((runtime) => {
		const provider = runtime.getProvider(CODEX_PROVIDER);
		if (!provider?.auth.oauth) throw new Error("OpenAI Codex OAuth provider is unavailable");
		return provider;
	});
	return providerPromise;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function errorCode(error: unknown): string | undefined {
	return isObject(error) && typeof error.code === "string" ? error.code : undefined;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Pi uses the same sibling lock directory for auth.json writes.
function acquireAuthLock(): void {
	mkdirSync(dirname(AUTH_PATH), { recursive: true, mode: 0o700 });
	if (!existsSync(AUTH_PATH)) {
		writeFileSync(AUTH_PATH, "{}", { encoding: "utf-8", mode: 0o600 });
		chmodSync(AUTH_PATH, 0o600);
	}

	const startedAt = Date.now();
	for (;;) {
		try {
			mkdirSync(AUTH_LOCK_PATH, { mode: 0o700 });
			return;
		} catch (error) {
			if (errorCode(error) !== "EEXIST") throw error;
			try {
				if (Date.now() - statSync(AUTH_LOCK_PATH).mtimeMs > LOCK_STALE_MS) {
					rmSync(AUTH_LOCK_PATH, { recursive: true, force: true });
					continue;
				}
			} catch {
				continue;
			}
			if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
				throw new Error(`Timed out waiting for auth store lock: ${AUTH_LOCK_PATH}`);
			}
			sleep(LOCK_RETRY_MS);
		}
	}
}

function readPiCredential(): CodexCredential | undefined {
	const credential = readStoredCredential(CODEX_PROVIDER);
	return isCodexCredential(credential) ? credential : undefined;
}

function writePiCredential(credential: CodexCredential | undefined): void {
	acquireAuthLock();
	try {
		const auth = JSON.parse(readFileSync(AUTH_PATH, "utf-8")) as unknown;
		if (!isObject(auth)) throw new Error(`Invalid auth store: ${AUTH_PATH}`);
		if (credential) auth[CODEX_PROVIDER] = credential;
		else delete auth[CODEX_PROVIDER];
		writeFileSync(AUTH_PATH, JSON.stringify(auth, null, 2), { encoding: "utf-8", mode: 0o600 });
		chmodSync(AUTH_PATH, 0o600);
	} finally {
		rmSync(AUTH_LOCK_PATH, { recursive: true, force: true });
	}
}

function asCodexCredential(credentials: OAuthCredentials): CodexCredential {
	if (typeof credentials.accountId !== "string") {
		throw new Error("OpenAI OAuth credentials did not include an accountId");
	}
	return { ...credentials, type: "oauth", accountId: credentials.accountId };
}

export function readActiveCodexCredential(): CodexCredential | undefined {
	const store = readAccountStore();
	return store.activeAccountId ? store.accounts[store.activeAccountId]?.credential : readPiCredential();
}

export function selectCodexCredential(credential: CodexCredential): void {
	updateAccountStore((store) => saveAccount(store, credential, true));
	writePiCredential(credential);
}

export function removeCodexAccount(accountId: string): { existed: boolean; removedActive: boolean } {
	const result = updateAccountStore((store) => {
		const existed = !!store.accounts[accountId];
		const removedActive = store.activeAccountId === accountId;
		delete store.accounts[accountId];
		if (removedActive) store.activeAccountId = undefined;
		return { existed, removedActive };
	});
	if (result.removedActive) writePiCredential(undefined);
	return result;
}

export function restoreActiveCodexCredential(): boolean {
	const store = readAccountStore();
	if (!store.activeAccountId) {
		const credential = readPiCredential();
		if (!credential) return false;
		updateAccountStore((current) => saveAccount(current, credential, true));
		return true;
	}

	const active = store.accounts[store.activeAccountId]!.credential;
	const current = readPiCredential();
	if (current?.accountId !== active.accountId) {
		writePiCredential(active);
		return true;
	}
	if (current.access !== active.access || current.refresh !== active.refresh || current.expires !== active.expires) {
		updateAccountStore((store) => saveAccount(store, current, true));
	}
	return false;
}

export async function refreshCodexCredential(
	credential: CodexCredential,
	signal?: AbortSignal,
): Promise<CodexCredential> {
	if (Date.now() < credential.expires - REFRESH_MARGIN_MS) return credential;

	let refresh = refreshes.get(credential.accountId);
	if (!refresh) {
		refresh = getProvider()
			.then((provider) => provider.auth.oauth!.refresh(credential, signal))
			.then(asCodexCredential)
			.then((refreshed) => {
				if (refreshed.accountId !== credential.accountId) {
					throw new Error(`Refreshed token account mismatch: ${credential.accountId} -> ${refreshed.accountId}`);
				}
				return refreshed;
			})
			.finally(() => refreshes.delete(credential.accountId));
		refreshes.set(credential.accountId, refresh);
	}

	const refreshed = await refresh;
	const isActive = updateAccountStore((store) => {
		if (!store.accounts[credential.accountId]) return false;
		saveAccount(store, refreshed, false);
		return store.activeAccountId === credential.accountId;
	});
	if (isActive) writePiCredential(refreshed);
	return refreshed;
}

export async function getActiveCodexCredential(signal?: AbortSignal): Promise<CodexCredential> {
	const credential = readActiveCodexCredential();
	if (!credential) {
		throw new Error("ChatGPT subscription auth missing. Open /gpt-codex and press a, or run /login.");
	}
	try {
		return await refreshCodexCredential(credential, signal);
	} catch (error) {
		throw new Error(`token refresh failed: ${errorMessage(error)}`);
	}
}

function loginInteraction(callbacks: OAuthLoginCallbacks): AuthInteraction {
	return {
		signal: callbacks.signal,
		async prompt(prompt) {
			if (prompt.type === "select") {
				const selected = await callbacks.onSelect({
					message: prompt.message,
					options: prompt.options.map(({ id, label }) => ({ id, label })),
				});
				if (!selected) throw new Error("Login cancelled");
				return selected;
			}
			if (prompt.type === "manual_code" && callbacks.onManualCodeInput) {
				return callbacks.onManualCodeInput();
			}
			return callbacks.onPrompt({ message: prompt.message, placeholder: prompt.placeholder });
		},
		notify(event) {
			switch (event.type) {
				case "auth_url":
					callbacks.onAuth({ url: event.url, instructions: event.instructions });
					break;
				case "device_code":
					callbacks.onDeviceCode(event);
					break;
				case "progress":
					callbacks.onProgress?.(event.message);
					break;
				case "info": {
					const links = event.links?.map(({ url }) => url).join(" · ");
					callbacks.onProgress?.(links ? `${event.message} ${links}` : event.message);
				}
			}
		},
	};
}

export async function loginCodex(interaction: AuthInteraction): Promise<CodexCredential> {
	const provider = await getProvider();
	return asCodexCredential(await provider.auth.oauth!.login(interaction));
}

export function registerCodexProvider(pi: ExtensionAPI): void {
	pi.registerProvider(CODEX_PROVIDER, {
		api: "openai-codex-responses",
		// The bridge must be considered configured before it can resolve the selected account in streamSimple.
		apiKey: BRIDGE_API_KEY,
		streamSimple: (model, context, options) =>
			lazyStream(model, async () => {
				const [credential, provider] = await Promise.all([getActiveCodexCredential(options?.signal), getProvider()]);
				return provider.streamSimple(model, context, { ...options, apiKey: credential.access });
			}),
		oauth: {
			name: "OpenAI (ChatGPT Plus/Pro)",
			async login(callbacks) {
				const credential = await loginCodex(loginInteraction(callbacks));
				selectCodexCredential(credential);
				return credential;
			},
			async refreshToken(credentials) {
				return refreshCodexCredential(readActiveCodexCredential() ?? asCodexCredential(credentials));
			},
			getApiKey: (credentials) => credentials.access,
		},
	});
}
