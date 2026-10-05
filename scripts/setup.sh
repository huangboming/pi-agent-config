#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
settings_file="$repo_dir/settings/settings.json"
keybindings_file="$repo_dir/settings/keybindings.json"
agent_dir="$HOME/.pi/agent"
runtime_settings_file="$agent_dir/settings.json"
runtime_keybindings_file="$agent_dir/keybindings.json"
append_system_source="$repo_dir/APPEND_SYSTEM.md"
append_system_link="$agent_dir/APPEND_SYSTEM.md"

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
	node - "$settings_file" "$keybindings_file" <<'NODE'
const { readFileSync } = require("node:fs");

function readObject(path, name) {
	const value = JSON.parse(readFileSync(path, "utf8"));
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${name} must contain a JSON object`);
	}
	return value;
}

const settings = readObject(process.argv[2], "settings.json");
const keybindings = readObject(process.argv[3], "keybindings.json");
if (!Array.isArray(settings.packages)) {
	throw new Error("settings.json must contain a packages array");
}

for (const source of settings.packages) {
	if (typeof source !== "string" || source.length === 0 || source.includes("\n")) {
		throw new Error("settings.json packages must be non-empty source strings");
	}
}

for (const [action, keys] of Object.entries(keybindings)) {
	const validKeys = typeof keys === "string" || (Array.isArray(keys) && keys.every((key) => typeof key === "string"));
	if (action.length === 0 || !validKeys) {
		throw new Error("keybindings.json must map non-empty action names to strings or string arrays");
	}
}

for (const source of settings.packages) {
	console.log(source);
}
NODE
) || fail "could not validate repository settings"

while IFS= read -r source; do
	[[ -n "$source" ]] || continue
	printf 'Installing %s\n' "$source"
	pi install "$source"
done <<< "$package_sources"

printf 'Installing local package from %s\n' "$repo_dir"
pi install "$repo_dir"

node - "$settings_file" "$keybindings_file" "$runtime_settings_file" "$runtime_keybindings_file" <<'NODE'
const { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } = require("node:fs");
const { basename, dirname, join } = require("node:path");

function readObject(path, name, fallback) {
	if (!existsSync(path)) return fallback;
	const value = JSON.parse(readFileSync(path, "utf8"));
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${name} must contain a JSON object`);
	}
	return value;
}

function writeJsonAtomic(path, value) {
	mkdirSync(dirname(path), { recursive: true });
	const temporaryPath = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
	const mode = existsSync(path) ? statSync(path).mode & 0o777 : 0o600;
	try {
		writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode });
		renameSync(temporaryPath, path);
	} finally {
		if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
	}
}

const sourceSettings = readObject(process.argv[2], "repository settings.json", {});
const sourceKeybindings = readObject(process.argv[3], "repository keybindings.json", {});
const runtimeSettings = readObject(process.argv[4], "runtime settings.json", {});
const runtimeKeybindings = readObject(process.argv[5], "runtime keybindings.json", {});
const { packages: _packages, ...managedSettings } = sourceSettings;

// Remove superseded preferences so Pi's defaults apply.
for (const setting of ["quietStartup"]) delete runtimeSettings[setting];

writeJsonAtomic(process.argv[4], { ...runtimeSettings, ...managedSettings });
writeJsonAtomic(process.argv[5], { ...runtimeKeybindings, ...sourceKeybindings });
NODE
printf 'Synced settings and keybindings into %s\n' "$agent_dir"

if [[ "$create_append_system_link" == true ]]; then
	mkdir -p "$(dirname -- "$append_system_link")"
	ln -s "$append_system_source" "$append_system_link"
	printf 'Linked %s\n' "$append_system_link"
fi

printf 'Setup complete. Run /reload in Pi.\n'
