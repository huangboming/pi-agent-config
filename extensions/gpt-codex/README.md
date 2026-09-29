# gpt-codex

Multi-account ChatGPT OAuth and subscription quota status for Pi's `openai-codex` provider.

## Features

- `/gpt-codex` opens a TUI for adding, removing, refreshing, and switching accounts, plus configuring quota refresh.
- Account switches apply to the running provider without restarting Pi.
- The footer reports the active account's 5-hour and 7-day quota while `openai-codex` is selected.

## Runtime contracts

- `~/.pi/agent/gpt-accounts.json` is the saved-account and extension-settings store. The selected credential is mirrored to Pi's `openai-codex` entry in `auth.json`.
- Startup reconciles the selected account with Pi auth in every mode. Removing the active account clears Pi auth and leaves no implicit replacement.
- Expired credentials are refreshed per account; a refreshed active credential is written to both stores before use.
- Account state is written with `0600` permissions and lock-protected read-modify-write updates. No credentials belong in this repository.
- The management command is TUI-only; provider registration and startup restore are not.
- Quota requests use the selected account, time out after 5 seconds, and back off for 60 seconds after failure. Refresh cancellation is independent of agent cancellation.

`PI_GPT_LIMITS_USAGE_URL` overrides the quota endpoint for testing.
