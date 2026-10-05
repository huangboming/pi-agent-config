# Managed Pi Settings

This directory is the version-controlled source for the Pi preferences and keybindings applied by [`scripts/setup.sh`](../scripts/setup.sh). You do not need to copy these files manually.

## TUI preferences

The non-`packages` entries in [`settings.json`](settings.json) are merged into `~/.pi/agent/settings.json`.

| Setting | Managed value | Effect |
| --- | --- | --- |
| `theme` | `precision-cockpit-light/precision-cockpit-dark` | Uses the matching Precision Cockpit theme for the terminal's light or dark appearance. |
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

## Package pins

The `packages` array in `settings.json` pins the third-party packages installed by setup:

- `npm:@cortexkit/pi-magic-context@0.44.1`
- `npm:pi-web-access@0.33.0`
- `npm:@narumitw/pi-btw@0.61.1`

The local checkout is installed separately as a Pi package.

## Applying changes

From the repository root, run:

```bash
./scripts/setup.sh
```

Setup preserves unrelated runtime settings and keybindings while merging the entries managed here. Run `/reload` in Pi afterward.
