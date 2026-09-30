# gpt-codex

Session-scoped multi-account ChatGPT OAuth and subscription quota status for Pi's `openai-codex` provider.

## Features

- `/gpt-codex` opens a TUI for adding, naming, removing, refreshing, and selecting ChatGPT accounts, plus configuring quota refresh.
- Selecting an account applies to the current Pi session on its next request without restarting Pi.
- Existing sessions keep their own selections; new sessions start with the most recently selected account.
- The footer reports the current session account's plan plus 5-hour and 7-day quota while `openai-codex` is selected, using forms such as `quota(alias,plan-type)`.

## Runtime contracts

- Only ChatGPT subscription OAuth credentials from Pi's built-in `openai-codex` login flow are supported. API keys, Azure, proxies, and other providers are out of scope.
- `~/.pi/agent/gpt-accounts.json` is the credential, most-recent-selection, and extension-settings store. A valid Pi Codex OAuth credential is imported once for compatibility; session switches do not rewrite `auth.json`.
- Each Pi session persists its selected account in a custom session entry. `/tree` does not change it, while new and forked sessions start with the most recently selected account.
- Selecting or adding an account updates the current session and the seed for future sessions. It never changes another existing session.
- Accounts may have optional, case-insensitively unique local aliases. The `/gpt-codex` add flow offers one after OAuth; `/login` remains unchanged. Named accounts show only their alias, while unnamed accounts fall back to a shortened account ID.
- Removing an account never falls back implicitly. Sessions that reference it must explicitly select another account before making a request.
- Expired credentials are refreshed in the account store before use. Refreshes that return a different account ID are rejected.
- Account state is written with `0600` permissions and lock-protected read-modify-write updates. OAuth credentials are never written to session files or this repository.
- The management command is TUI-only; provider registration and session restoration are not.
- Quota requests use the current session account, time out after 5 seconds, and back off for 60 seconds after failure. Refresh cancellation is independent of agent cancellation.
- Switching models within `openai-codex` preserves the quota display, any in-flight request, refresh schedule, and failure backoff without triggering a new request.

`PI_GPT_LIMITS_USAGE_URL` overrides the quota endpoint for testing.
