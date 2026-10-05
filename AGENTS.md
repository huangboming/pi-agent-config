# AGENTS.md

This repository is the canonical source for the user's Pi instructions, package resources, pinned third-party packages, and optional agy integrations. Keep this file specific to those resources; general engineering guidance belongs in `APPEND_SYSTEM.md`.

## Runtime

- Pi loads `prompts/`, `skills/`, `extensions/`, and `themes/` through `package.json`.
- `settings/settings.json` pins third-party Pi packages and declares managed user preferences; `settings/keybindings.json` declares managed shortcuts.
- `scripts/setup.sh` installs the packages and this checkout, then merges managed preferences and shortcuts into the runtime files without replacing unrelated entries.
- The setup script safely links `APPEND_SYSTEM.md` into `~/.pi/agent` and never replaces a different existing path.
- `integrations/agy/` is optional and is not installed by the main setup.

## Rules

- Never commit credentials, OAuth or account data, sessions, model stores, trust decisions, caches, generated dependencies, unmanaged runtime settings, or absolute local paths.
- Runtime state belongs under `~/.pi/agent`; only intentionally managed preferences and shortcuts belong in the repository, and package resources must not be duplicated in Pi's auto-discovered user directories.
- Keep the npm package private. Changing a Git remote requires explicit authorization.
- Keep third-party Pi packages out of npm dependencies; pin them in `settings/settings.json` and update deliberately.
- Keep `settings/README.md` synchronized with managed preferences, keybindings, and package pins.
- Use prompts for short invoked templates, skills for reusable workflows, and extensions only for runtime behavior.
- Preserve public command names and resource paths unless the task includes a migration.
- After changing a loaded resource, tell the user to run `/reload`.

## Verification

- Run `git diff --check` and inspect the complete diff.
- Validate changed manifests; test setup changes and settings/keybinding merges with a mock `pi` and isolated `HOME`.
- For wiring changes, verify `pi list`; for extension changes, run the smallest behavioral or load check.
- Before committing, confirm no sensitive or generated files are tracked.
