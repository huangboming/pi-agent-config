import { ModelRuntime, readStoredCredential, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	lazyStream,
	type AuthInteraction,
	type OAuthCredentials,
	type OAuthLoginCallbacks,
	type Provider,
} from "@earendil-works/pi-ai";

import { errorMessage } from "../common/errors.ts";
import {
	isCodexCredential,
	readAccountStore,
	saveAccount,
	updateAccountStore,
	type CodexCredential,
} from "./store.ts";
import type { SessionAccountController } from "./session.ts";

export const CODEX_PROVIDER = "openai-codex";

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

function readPiCredential(): CodexCredential | undefined {
	const credential = readStoredCredential(CODEX_PROVIDER);
	return isCodexCredential(credential) ? credential : undefined;
}

function asCodexCredential(credentials: OAuthCredentials): CodexCredential {
	if (typeof credentials.accountId !== "string") {
		throw new Error("OpenAI OAuth credentials did not include an accountId");
	}
	return { ...credentials, type: "oauth", accountId: credentials.accountId };
}

export function initializeCodexAccountStore(): void {
	if (readAccountStore().piAuthImported) return;
	const credential = readPiCredential();
	updateAccountStore((store) => {
		if (store.piAuthImported) return;
		if (credential) saveAccount(store, credential, store.lastSelectedAccountId === undefined);
		store.piAuthImported = true;
	});
}

export function saveCodexCredential(credential: CodexCredential): void {
	updateAccountStore((store) => saveAccount(store, credential, false));
}

export function removeCodexAccount(accountId: string): { existed: boolean } {
	return updateAccountStore((store) => {
		const existed = !!store.accounts[accountId];
		delete store.accounts[accountId];
		if (store.lastSelectedAccountId === accountId) store.lastSelectedAccountId = undefined;
		return { existed };
	});
}

function readCodexCredential(accountId: string): CodexCredential | undefined {
	return readAccountStore().accounts[accountId]?.credential;
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
	updateAccountStore((store) => {
		if (store.accounts[credential.accountId]) saveAccount(store, refreshed, false);
	});
	return refreshed;
}

export async function getSessionCodexCredential(
	sessionAccount: SessionAccountController,
	signal?: AbortSignal,
): Promise<CodexCredential> {
	const accountId = sessionAccount.getAccountId();
	if (!accountId) {
		throw new Error("ChatGPT subscription auth missing. Open /gpt-codex and press a, or run /login.");
	}
	const credential = readCodexCredential(accountId);
	if (!credential) {
		throw new Error("This session's ChatGPT account is no longer saved. Open /gpt-codex and select an account.");
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

export function registerCodexProvider(pi: ExtensionAPI, sessionAccount: SessionAccountController): void {
	pi.registerProvider(CODEX_PROVIDER, {
		api: "openai-codex-responses",
		// The bridge must be considered configured before it can resolve the session account in streamSimple.
		apiKey: BRIDGE_API_KEY,
		streamSimple: (model, context, options) =>
			lazyStream(model, async () => {
				const [credential, provider] = await Promise.all([
					getSessionCodexCredential(sessionAccount, options?.signal),
					getProvider(),
				]);
				return provider.streamSimple(model, context, { ...options, apiKey: credential.access });
			}),
		oauth: {
			name: "OpenAI (ChatGPT Plus/Pro)",
			async login(callbacks) {
				const credential = await loginCodex(loginInteraction(callbacks));
				saveCodexCredential(credential);
				sessionAccount.select(credential.accountId);
				return credential;
			},
			async refreshToken(credentials) {
				const credential = asCodexCredential(credentials);
				return refreshCodexCredential(readCodexCredential(credential.accountId) ?? credential);
			},
			getApiKey: (credentials) => credentials.access,
		},
	});
}
