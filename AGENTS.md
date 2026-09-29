# AGENTS.md

## Purpose

This repository is the canonical source for the user's global Pi instructions, prompt templates, skills, extensions, themes, third-party package manifest, and versioned support files for its agy workflows. Keep repository guidance specific to managing those resources; do not duplicate general software-engineering instructions from `APPEND_SYSTEM.md`.

## Runtime contract

- `scripts/setup.sh` safely symlinks `~/.pi/agent/APPEND_SYSTEM.md` to this repository's `APPEND_SYSTEM.md` and refuses to replace a different existing path.
- `integrations/agy/statusline.sh` is an optional external-agent integration and is not installed by the main Pi setup.
- Pi loads `prompts/`, `skills/`, `extensions/`, and `themes/` through the local package declared in `package.json`.
- `settings.json` is the portable source of truth for pinned third-party Pi package sources; `scripts/setup.sh` installs them and the current checkout through `pi install` without replacing the user's runtime settings file.
- Do not create duplicate copies of package resources in Pi's auto-discovered user directories.
- After changing or restoring a loaded resource, tell the user to run `/reload`.

## Security boundary

- Never store credentials, OAuth tokens, account data, sessions, model stores, trust decisions, caches, or generated dependencies in this repository.
- Extension runtime state belongs under `~/.pi/agent`, outside this repository.
- Keep committed settings portable: never add absolute local paths or copy the runtime `~/.pi/agent/settings.json` wholesale.
- Keep the npm package private (`"private": true` in `package.json`). Adding or changing a Git remote requires explicit authorization.

## Change discipline

- Keep `APPEND_SYSTEM.md` concise and limited to globally applicable behavior.
- Use prompts for short, user-invoked task templates; use skills for reusable multi-step workflows; use extensions only when runtime APIs, UI, events, or persistent behavior are required.
- Preserve command names and resource paths unless the requested change includes a migration.
- Keep third-party Pi packages out of this package's npm dependencies; declare them in `settings.json` with exact versions or immutable refs and update them deliberately.
- Make the smallest scoped change and avoid unrelated cleanup across resources.
- Add a resource only when ordinary natural-language instructions are not reliable enough; recurring use alone does not justify one.

## Verification

- Run `git diff --check` and inspect the complete diff.
- Validate `package.json` and `settings.json` after manifest changes.
- Test `scripts/setup.sh` with a mock `pi` executable and isolated `HOME` before allowing it to change user settings or symlinks.
- For resource wiring changes, verify `pi list` and command provenance from a fresh Pi process.
- For extension changes, run the smallest relevant behavioral checks and confirm the extension loads without errors.
- Before committing, confirm no sensitive or generated files are tracked.
