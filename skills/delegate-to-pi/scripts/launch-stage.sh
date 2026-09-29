#!/usr/bin/env bash
set -euo pipefail

readonly MODEL="openai-codex/gpt-5.6-luna"
readonly THINKING="max"
readonly READY_ATTEMPTS=100
readonly READY_INTERVAL=0.1

usage() {
  cat <<'EOF'
Usage:
  launch-stage.sh new --repo PATH --session NAME --baseline SHA
  launch-stage.sh resume --repo PATH --session NAME --baseline SHA --pi-session-id UUID

Reads the approved initial-stage or recovery prompt from standard input and
starts an interactive Pi executor in a detached tmux session. Resume is only
for recovery after the previous Pi process and tmux session have exited; use
send-followup.sh for normal checkpoint and correction prompts.
EOF
}

fail() {
  printf 'launch-stage: %s\n' "$*" >&2
  exit 1
}

[[ $# -gt 0 ]] || {
  usage >&2
  exit 2
}
if [[ "$1" == "-h" || "$1" == "--help" ]]; then
  usage
  exit 0
fi

mode=$1
shift
[[ "$mode" == "new" || "$mode" == "resume" ]] || fail "mode must be 'new' or 'resume'"

repo=
session=
baseline=
pi_session_id=

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      [[ $# -ge 2 ]] || fail "--repo requires a path"
      repo=$2
      shift 2
      ;;
    --session)
      [[ $# -ge 2 ]] || fail "--session requires a name"
      session=$2
      shift 2
      ;;
    --baseline)
      [[ $# -ge 2 ]] || fail "--baseline requires a commit"
      baseline=$2
      shift 2
      ;;
    --pi-session-id)
      [[ $# -ge 2 ]] || fail "--pi-session-id requires a UUID"
      pi_session_id=$2
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

[[ -n "$repo" ]] || fail "--repo is required"
[[ -n "$session" ]] || fail "--session is required"
[[ -n "$baseline" ]] || fail "--baseline is required"
[[ "$session" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$ ]] || fail "session must match [A-Za-z0-9][A-Za-z0-9_-]{0,79}"

for command_name in git tmux pi uuidgen ps awk; do
  command -v "$command_name" >/dev/null 2>&1 || fail "required command not found: $command_name"
done

if [[ "$mode" == "new" ]]; then
  [[ -z "$pi_session_id" ]] || fail "--pi-session-id is valid only for resume"
  pi_session_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
else
  [[ -n "$pi_session_id" ]] || fail "resume requires --pi-session-id"
  [[ "$pi_session_id" =~ ^[0-9a-fA-F-]{36}$ ]] || fail "--pi-session-id must be a UUID"
fi

[[ -d "$repo" ]] || fail "repository path does not exist: $repo"
repo=$(git -C "$repo" rev-parse --show-toplevel 2>/dev/null) || fail "not a Git repository: $repo"
repo=$(cd "$repo" && pwd -P)
branch=$(git -C "$repo" symbolic-ref --quiet --short HEAD 2>/dev/null) || fail "detached HEAD is not allowed"
head_sha=$(git -C "$repo" rev-parse HEAD)
baseline_sha=$(git -C "$repo" rev-parse --verify "${baseline}^{commit}" 2>/dev/null) || fail "invalid baseline commit: $baseline"
[[ "$head_sha" == "$baseline_sha" ]] || fail "HEAD $head_sha does not match baseline $baseline_sha"
git -C "$repo" diff --cached --quiet || fail "the Git index contains staged changes"

if [[ "$mode" == "new" ]]; then
  [[ -z "$(git -C "$repo" status --porcelain=v1 --untracked-files=normal)" ]] || fail "a new stage requires a clean worktree"
fi

if tmux has-session -t "=$session" 2>/dev/null; then
  fail "tmux session already exists: $session"
fi

[[ ! -t 0 ]] || fail "read the approved prompt from standard input"
prompt=$(cat)
[[ "$prompt" =~ [^[:space:]] ]] || fail "prompt is empty"

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
skill_dir=$(cd -- "$script_dir/.." && pwd -P)
executor_prompt="$skill_dir/references/staged-executor.md"
[[ -r "$executor_prompt" ]] || fail "executor prompt is unreadable: $executor_prompt"

pi_bin=$(command -v pi)
pi_args=(
  "$pi_bin"
  --model "$MODEL"
  --thinking "$THINKING"
  --session-id "$pi_session_id"
  --name "$session"
  --no-extensions
  --no-skills
  --no-prompt-templates
  --no-approve
  --tools "read,bash,edit,write"
  --append-system-prompt "$executor_prompt"
  --
  "$prompt"
)

runner=$(mktemp "${TMPDIR:-/tmp}/delegate-to-pi-stage.XXXXXX")
cleanup_runner=true
cleanup() {
  if [[ "$cleanup_runner" == true ]]; then
    rm -f -- "$runner"
  fi
}
trap cleanup EXIT

{
  printf '#!/usr/bin/env bash\n'
  printf 'set -euo pipefail\n'
  printf 'rm -f -- %q\n' "$runner"
  printf 'exec'
  printf ' %q' "${pi_args[@]}"
  printf '\n'
} >"$runner"
chmod 700 "$runner"

printf -v runner_command 'exec %q' "$runner"
tmux new-session -d -s "$session" -c "$repo" "$runner_command"
cleanup_runner=false

ready=false
pane_command=
pane_process=
for ((attempt = 0; attempt < READY_ATTEMPTS; attempt++)); do
  if ! tmux has-session -t "=$session" 2>/dev/null; then
    fail "Pi exited before the interactive session became ready"
  fi
  pane_count=$(tmux list-panes -t "=$session" -F '#{pane_id}' | wc -l | tr -d '[:space:]')
  if [[ "$pane_count" == "1" ]]; then
    pane=$(tmux list-panes -t "=$session" -F '#{pane_id}')
    pane_command=$(tmux display-message -p -t "$pane" '#{pane_current_command}')
    pane_pid=$(tmux display-message -p -t "$pane" '#{pane_pid}')
    pane_process=$(ps -p "$pane_pid" -o comm= 2>/dev/null | awk '{$1=$1; print}')
    if [[ "$pane_process" == "pi" ]]; then
      ready=true
      break
    fi
  fi
  sleep "$READY_INTERVAL"
done
if [[ "$ready" != true ]]; then
  tmux kill-session -t "=$session" 2>/dev/null || true
  fail "tmux session started but Pi did not become ready (tmux command: ${pane_command:-unknown}, process: ${pane_process:-unknown})"
fi

tmux set-option -t "$session" @delegate_executor pi
tmux set-option -t "$session" @delegate_repo "$repo"
tmux set-option -t "$session" @delegate_baseline "$baseline_sha"
tmux set-option -t "$session" @delegate_pi_session_id "$pi_session_id"

printf 'Started %s Pi stage in tmux session %q.\n' "$mode" "$session"
printf 'Repository: %s\n' "$repo"
printf 'Branch: %s\n' "$branch"
printf 'Baseline: %s\n' "$baseline_sha"
printf 'Pi session ID: %s\n' "$pi_session_id"
printf 'Model: %s (%s)\n' "$MODEL" "$THINKING"
printf 'Attach: tmux attach-session -t %q\n' "$session"
