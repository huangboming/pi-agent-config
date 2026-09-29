import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerAccountManager } from "./account/account-manager.ts";
import { initializeCodexAccountStore } from "./account/codex-auth.ts";
import { registerSessionAccount } from "./account/session-account.ts";
import { registerRateLimitsStatus } from "./rate-limit/rate-limits-status.ts";

export default function (pi: ExtensionAPI) {
	initializeCodexAccountStore();
	const sessionAccount = registerSessionAccount(pi);
	const rateLimitsStatus = registerRateLimitsStatus(pi, sessionAccount);
	registerAccountManager(pi, rateLimitsStatus, sessionAccount);
}
