import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerAccountManager } from "./account/account-manager.ts";
import { registerRateLimitsStatus } from "./rate-limit/rate-limits-status.ts";

export default function (pi: ExtensionAPI) {
	const rateLimitsStatus = registerRateLimitsStatus(pi);
	registerAccountManager(pi, rateLimitsStatus);
}
