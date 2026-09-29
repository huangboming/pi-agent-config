#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
settings_file="$repo_dir/settings.json"
append_system_source="$repo_dir/APPEND_SYSTEM.md"
append_system_link="$HOME/.pi/agent/APPEND_SYSTEM.md"

fail() {
	printf 'setup: %s\n' "$*" >&2
	exit 1
}

for command_name in node pi; do
	command -v "$command_name" >/dev/null 2>&1 || fail "required command not found: $command_name"
done

create_append_system_link=true
if [[ -e "$append_system_link" || -L "$append_system_link" ]]; then
	if [[ -L "$append_system_link" && "$append_system_link" -ef "$append_system_source" ]]; then
		create_append_system_link=false
	else
		fail "refusing to replace existing path: $append_system_link"
	fi
fi

package_sources=$(
	node - "$settings_file" <<'NODE'
const { readFileSync } = require("node:fs");

const settingsPath = process.argv[2];
const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
if (!Array.isArray(settings.packages)) {
	throw new Error("settings.json must contain a packages array");
}

for (const source of settings.packages) {
	if (typeof source !== "string" || source.length === 0 || source.includes("\n")) {
		throw new Error("settings.json packages must be non-empty source strings");
	}
	console.log(source);
}
NODE
) || fail "could not read package sources from settings.json"

while IFS= read -r source; do
	[[ -n "$source" ]] || continue
	printf 'Installing %s\n' "$source"
	pi install "$source"
done <<< "$package_sources"

printf 'Installing local package from %s\n' "$repo_dir"
pi install "$repo_dir"

if [[ "$create_append_system_link" == true ]]; then
	mkdir -p "$(dirname -- "$append_system_link")"
	ln -s "$append_system_source" "$append_system_link"
	printf 'Linked %s\n' "$append_system_link"
fi

printf 'Setup complete. Run /reload in Pi.\n'
