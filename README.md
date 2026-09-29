# Pi Agent Config

My opinionated, version-controlled configuration for [Pi](https://pi.dev), published for reference and reuse.

## What is included

- Custom extensions, skills, prompts, and Precision Cockpit themes
- Pinned third-party Pi packages in `settings.json`
- Global agent instructions in `APPEND_SYSTEM.md`
- An optional [agy status line](integrations/agy/README.md)

## Setup

Requirements: Pi, Node.js, and Git. Some workflows additionally require `tmux`, `agy`, `jq`, specific custom agents, or particular models.

```bash
git clone https://github.com/huangboming/pi-agent-config.git
cd pi-agent-config
./scripts/setup.sh
```

The setup script installs the pinned third-party packages, registers the current checkout as a local Pi package, and links `APPEND_SYSTEM.md` into `~/.pi/agent`. It refuses to replace an existing file or a different symlink.

Run `/reload` in Pi after setup or after changing a loaded resource.

To install only the package resources without the personal setup:

```bash
pi install git:github.com/huangboming/pi-agent-config
```

## Security

Pi packages can execute code. Review the source before installing it. Credentials and runtime state stay outside this repository; see the [`gpt-codex` documentation](extensions/gpt-codex/README.md) for its account storage behavior.

## License

[MIT](LICENSE)
