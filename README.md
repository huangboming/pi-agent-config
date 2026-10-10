# Pi Agent Config

An opinionated, version-controlled [Pi](https://pi.dev) setup for a compact TUI, reusable workflows, and Codex account management.

## What is included

- Custom extensions, skills, prompts, and Precision Cockpit themes
- [Managed Pi settings, packages, and fullscreen shortcuts](settings/README.md)
- Global agent instructions in `APPEND_SYSTEM.md`
- An optional [agy status line](integrations/agy/README.md)

## Quick start

Requirements: Git, Make, curl, and Node.js.

```bash
git clone https://github.com/huangboming/pi-agent-config.git
cd pi-agent-config
make install  # Skip if Pi is already installed
make setup
```

Run `/reload` in an open Pi session after setup.

## Commands

| Command | Purpose |
| --- | --- |
| `make install` | Install Pi using the official `pi.dev` installer. |
| `make setup` | Install the managed packages, register this checkout, and apply the managed configuration. |
| `make update` | Update Pi and all installed Pi packages. |

`make setup` is safe to rerun after changing this repository. It:

- installs the unversioned third-party package sources from `settings/settings.json`;
- installs this checkout as a local Pi package;
- merges managed settings, keybindings, and non-secret extension configuration into their runtime locations without replacing unrelated entries;
- links `APPEND_SYSTEM.md` into `~/.pi/agent` and refuses to overwrite a different existing path.

To install only the extensions, skills, prompts, and themes—without the personal settings or third-party packages—run:

```bash
pi install git:github.com/huangboming/pi-agent-config
```

## Security

Pi packages can execute code, so review package sources before installing them. Credentials, account data, and runtime state stay outside this repository; see the [`gpt-codex` documentation](extensions/gpt-codex/README.md) for its storage behavior.

[MIT License](LICENSE)
