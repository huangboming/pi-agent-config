# precision-cockpit

A compact editor and footer for Pi's interactive TUI.

## Features

- Embeds Pi's working status in the editor.
- Shows the project and Git branch, model and thinking level, context usage, cache hit rate, and GPT quota in one footer line.
- Adapts to narrow terminals by retaining context and quota before lower-priority groups.

## Runtime contracts

- Runs only in TUI mode and owns Pi's editor and footer slots; do not combine it with another extension that expects to own either slot.
- Reads the optional `gpt-rate-limits` extension status published by `gpt-codex`; it works without that extension.
- Cache hit rate reflects the latest assistant usage after cache activity is observed and is reconstructed from the current session on startup.
- It exposes no commands, performs no network requests, and persists no state.
