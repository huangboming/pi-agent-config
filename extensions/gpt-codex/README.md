# gpt-codex

ChatGPT Codex helpers for Pi's `openai-codex` provider.

This extension combines:

- multiple ChatGPT Plus/Pro OAuth account management
- footer status for the subscription's 5-hour and 7-day rate-limit windows

Pi stores one credential per provider. This extension keeps multiple OpenAI Codex OAuth credentials in `~/.pi/agent/gpt-accounts.json` and copies the selected account into Pi's normal `auth.json` entry for `openai-codex`. On Pi 0.80+, a provider bridge also applies account switches to the running process without requiring a restart.

## Commands

```text
/gpt-codex           # open tabbed account UI
```

Interactive account management and config are TUI-only. `/gpt-codex` opens on the Accounts tab; press Tab/Shift+Tab to switch between Accounts and Config. In Accounts, use `a` to add, `d` to remove, `r` to refresh account limits, and Enter to switch. Saved account restore still runs at startup in every mode.

The account switcher shows each saved account with rate-limit status so you can choose which account to use. Account ids are OpenAI UUIDs and are shortened in the UI.

When the active model provider is `openai-codex`, the footer shows current usage from `https://chatgpt.com/backend-api/wham/usage`, for example:

```text
GPT(123e45…4000, plus): 5h 98% left/3h 57m · 7d 92% left/5d 17h
```

By default, status refreshes after account changes, model changes, tool execution, agent completion, and every 5 minutes. The Config tab can enable/disable the footer status, periodic refresh, refresh interval, and refresh-on-agent/turn/tool triggers. Press `r` in Config for a one-off footer status refresh. Settings are stored with the accounts in `~/.pi/agent/gpt-accounts.json`.

Fetches have a 5s timeout and a 60s failure backoff. Footer refreshes are independent of the current agent run, so stopping the agent does not mark the last status stale. Failure states distinguish missing auth, token refresh failures, usage endpoint 401/403 responses, timeouts, network errors, and account mismatches.

Account data is stored with `0600` permissions and guarded by a lock file during read-modify-write updates. Removing the active account clears `auth.json` for `openai-codex` and leaves no active account until you add or switch again.

`PI_GPT_LIMITS_USAGE_URL` can override the usage endpoint for testing.
