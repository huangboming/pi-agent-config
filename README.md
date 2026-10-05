# Pi Agent Config

My opinionated, version-controlled configuration for [Pi](https://pi.dev), published for reference and reuse.

## What is included

- Custom extensions, skills, prompts, and Precision Cockpit themes
- [Managed Pi settings, packages, and fullscreen shortcuts](settings/README.md)
- Global agent instructions in `APPEND_SYSTEM.md`
- An optional [agy status line](integrations/agy/README.md)

## Setup

Requirements: Pi, Node.js, and Git. Some workflows additionally require `tmux`, `agy`, `jq`, specific custom agents, or particular models.

```bash
git clone https://github.com/huangboming/pi-agent-config.git
cd pi-agent-config
./scripts/setup.sh
```

The setup script:

- installs the managed third-party packages;
- registers the current checkout as a local Pi package;
- merges the non-`packages` entries from `settings/settings.json` and all entries from `settings/keybindings.json` into `~/.pi/agent`, preserving unrelated runtime entries;
- links `APPEND_SYSTEM.md` into `~/.pi/agent`, refusing to replace an existing file or a different symlink.

Run the setup script again after changing managed settings, package sources, or keybindings. Run `/reload` in Pi after setup or after changing a loaded resource.

To install only the package resources without the personal setup:

```bash
pi install git:github.com/huangboming/pi-agent-config
```

## Security

Pi packages can execute code. Review the source before installing it. Credentials and runtime state stay outside this repository; see the [`gpt-codex` documentation](extensions/gpt-codex/README.md) for its account storage behavior.

## License

[MIT](LICENSE)
