#!/usr/bin/env bash
set -euo pipefail

readonly DEFAULT_MODEL="gemini-3.8-flash-high"
readonly AGENT_NAME="design-consultant"
readonly MARKER_NAME=".design-consult-workspace"
readonly MARKER_CONTENT="pi-design-consult-v1"

usage() {
  cat <<'EOF'
Usage:
  launch-consultation.sh start --session NAME [--model MODEL]
  launch-consultation.sh cleanup --session NAME --workspace PATH

The start command reads an approved consultation brief from standard input,
creates an isolated temporary workspace, and starts interactive agy in a
detached tmux session. The cleanup command removes only a marked consultation
workspace after its tmux session has ended.
EOF
}

fail() {
  printf 'design-consult: %s\n' "$*" >&2
  exit 1
}

[[ $# -gt 0 ]] || {
  usage >&2
  exit 2
}

command_name=$1
shift
[[ "$command_name" == "start" || "$command_name" == "cleanup" ]] || fail "command must be 'start' or 'cleanup'"

session=
workspace=
model=$DEFAULT_MODEL
model_set=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --session)
      [[ $# -ge 2 ]] || fail "--session requires a name"
      session=$2
      shift 2
      ;;
    --workspace)
      [[ $# -ge 2 ]] || fail "--workspace requires a path"
      workspace=$2
      shift 2
      ;;
    --model)
      [[ $# -ge 2 ]] || fail "--model requires a model slug"
      model=$2
      model_set=true
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

[[ -n "$session" ]] || fail "--session is required"
[[ "$session" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$ ]] || fail "session must match [A-Za-z0-9][A-Za-z0-9_-]{0,79}"

session_exists() {
  tmux list-sessions -F '#{session_name}' 2>/dev/null | grep -Fxq "$session"
}

if [[ "$command_name" == "cleanup" ]]; then
  [[ "$model_set" == false ]] || fail "--model is valid only when starting a consultation"
  [[ -n "$workspace" ]] || fail "--workspace is required for cleanup"
  command -v tmux >/dev/null 2>&1 || fail "required command not found: tmux"
  session_exists && fail "tmux session is still running: $session"
  [[ -d "$workspace" ]] || fail "workspace does not exist: $workspace"

  tmp_root=$(cd "${TMPDIR:-/tmp}" && pwd -P)
  workspace=$(cd "$workspace" && pwd -P)
  case "$workspace" in
    "$tmp_root"/design-consult.*) ;;
    *) fail "refusing to remove path outside the design-consult temp root: $workspace" ;;
  esac

  marker="$workspace/$MARKER_NAME"
  [[ -f "$marker" && ! -L "$marker" ]] || fail "workspace marker is missing or invalid: $marker"
  [[ "$(<"$marker")" == "$MARKER_CONTENT" ]] || fail "workspace marker content is invalid: $marker"

  rm -rf -- "$workspace"
  printf 'Removed design consultation workspace: %s\n' "$workspace"
  exit 0
fi

[[ -z "$workspace" ]] || fail "--workspace is valid only for cleanup"
for required_command in tmux agy mktemp; do
  command -v "$required_command" >/dev/null 2>&1 || fail "required command not found: $required_command"
done

agent_path="$HOME/.gemini/config/agents/$AGENT_NAME/agent.md"
[[ -r "$agent_path" ]] || fail "custom agent not found or unreadable: $agent_path"
session_exists && fail "tmux session already exists: $session"
[[ ! -t 0 ]] || fail "read the approved consultation brief from standard input"

prompt=$(cat)
[[ -n "${prompt//[[:space:]]/}" ]] || fail "consultation brief is empty"

workspace=$(mktemp -d "${TMPDIR:-/tmp}/design-consult.XXXXXX")
workspace=$(cd "$workspace" && pwd -P)
runner="$workspace/.launch-consultation"
started=false
cleanup_failed_start() {
  if [[ "$started" == false ]]; then
    rm -rf -- "$workspace"
  fi
}
trap cleanup_failed_start EXIT

chmod 700 "$workspace"
printf '%s\n' "$MARKER_CONTENT" >"$workspace/$MARKER_NAME"
mkdir -p "$workspace/references" "$workspace/prototype"

agy_bin=$(command -v agy)
agy_args=(
  "$agy_bin"
  --agent "$AGENT_NAME"
  --model "$model"
  --mode accept-edits
  --sandbox
  --prompt-interactive "$prompt"
)

{
  printf '#!/usr/bin/env bash\n'
  printf 'set -euo pipefail\n'
  printf 'rm -f -- %q\n' "$runner"
  printf 'exec'
  printf ' %q' "${agy_args[@]}"
  printf '\n'
} >"$runner"
chmod 700 "$runner"

printf -v runner_command 'exec %q' "$runner"
tmux new-session -d -s "$session" -c "$workspace" "$runner_command"
started=true

sleep 0.2
if ! session_exists; then
  started=false
  fail "agy exited before the interactive consultation became ready"
fi

printf 'Started design consultation in tmux session %q.\n' "$session"
printf 'Workspace: %s\n' "$workspace"
printf 'Design brief: %s/design-brief.md\n' "$workspace"
printf 'Prototype directory: %s/prototype\n' "$workspace"
printf 'Attach: tmux attach-session -t %q\n' "$session"
