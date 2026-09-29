import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { initializeCodexAccountStore } from "./account/auth.ts";
import { registerAccountManager } from "./account/manager.ts";
import { registerSessionAccount } from "./account/session.ts";
import { registerRateLimitsStatus } from "./rate-limit/status.ts";

export default function (pi: ExtensionAPI) {
	initializeCodexAccountStore();
	const sessionAccount = registerSessionAccount(pi);
	const rateLimitsStatus = registerRateLimitsStatus(pi, sessionAccount);
	registerAccountManager(pi, rateLimitsStatus, sessionAccount);
}
