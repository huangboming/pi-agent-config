# Managed Pi Settings

This directory is the version-controlled source for the Pi preferences, keybindings, and non-secret extension configuration applied by [`scripts/setup.sh`](../scripts/setup.sh). You do not need to copy these files manually.

## TUI preferences

The non-`packages` entries in [`settings.json`](settings.json) are merged into `~/.pi/agent/settings.json`.

| Setting | Managed value | Effect |
| --- | --- | --- |
| `theme` | `precision-cockpit-light/precision-cockpit-dark` | Uses the matching Precision Cockpit theme for the terminal's light or dark appearance. |
| `treeFilterMode` | `user-only` | Opens `/tree` showing user messages by default; other filters remain available in the tree view. |
| `collapseChangelog` | `true` | Shows a condensed changelog after Pi updates. |
| `fullscreenExitOutput` | `resume-hint` | Prints only the resume hint when fullscreen mode exits instead of replaying the transcript into terminal scrollback. |
| `fullscreenWheelScrollLines` | `3` | Scrolls three transcript lines per mouse-wheel event in fullscreen mode. |

`quietStartup` is deliberately not managed. Setup removes any existing value so Pi uses its default startup display.

## Fullscreen keybindings

[`keybindings.json`](keybindings.json) adds four fullscreen navigation shortcuts:

| Action | Shortcut | Effect |
| --- | --- | --- |
| `tui.altScreen.halfPageUp` | `Ctrl+Alt+U` | Scrolls up half a page. |
| `tui.altScreen.halfPageDown` | `Ctrl+Alt+D` | Scrolls down half a page. |
| `tui.altScreen.lineUp` | `Alt+K` | Scrolls up one line. |
| `tui.altScreen.lineDown` | `Alt+J` | Scrolls down one line. |

Only these actions are overridden. Pi's other default keybindings remain unchanged.

## Managed packages

The `packages` array in `settings.json` declares the third-party packages installed by setup:

- `npm:@cortexkit/pi-magic-context`
- `npm:pi-web-access`
- `npm:@narumitw/pi-btw`

Versions are deliberately omitted so the packages can track current releases alongside Pi. Setup installs the latest release available each time it runs; between runs, Pi continues using the installed versions. Run `pi update --extensions` to update them without rerunning the full setup. The local checkout is installed separately as a Pi package.

## Managed extension configuration

[`extensions/web-search.json`](extensions/web-search.json) is deeply merged into `~/.pi/agent/web-search.json`. It allows the `198.18.0.0/15` synthetic range used by TUN/fake-IP proxies such as Surge, so `pi-web-access` can fetch public hosts resolved through that range. Other local fields—including credentials and unrelated `ssrf` options—are preserved.

Only non-secret shared defaults belong in this directory. Keep credentials and machine-specific account data in the runtime file or environment variables.

## Applying changes

From the repository root, run:

```bash
./scripts/setup.sh
```

Setup preserves unrelated runtime settings, keybindings, and extension configuration while merging the entries managed here. Run `/reload` in Pi afterward.
