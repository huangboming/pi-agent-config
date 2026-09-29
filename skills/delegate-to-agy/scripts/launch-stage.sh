#!/usr/bin/env bash
set -euo pipefail

readonly DEFAULT_MODEL="gemini-3.8-flash-medium"
readonly AGENT_NAME="staged-executor"
readonly READY_ATTEMPTS=50
readonly READY_INTERVAL=0.1

usage() {
  cat <<'EOF'
Usage:
  launch-stage.sh new --repo PATH --session NAME --baseline SHA [--model MODEL]
  launch-stage.sh resume --repo PATH --session NAME --baseline SHA

Reads the approved initial-stage or recovery prompt from standard input and
starts an interactive agy process in a detached tmux session. Resume is only
for recovery after the previous agy process and tmux session have exited; use
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
model=$DEFAULT_MODEL
model_set=false

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

[[ -n "$repo" ]] || fail "--repo is required"
[[ -n "$session" ]] || fail "--session is required"
[[ -n "$baseline" ]] || fail "--baseline is required"
[[ "$session" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$ ]] || fail "session must match [A-Za-z0-9][A-Za-z0-9_-]{0,79}"
[[ "$mode" == "new" || "$model_set" == false ]] || fail "--model is valid only for a new stage"

for command_name in git tmux agy; do
  command -v "$command_name" >/dev/null 2>&1 || fail "required command not found: $command_name"
done

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

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
skill_dir=$(cd -- "$script_dir/.." && pwd -P)
expected_agent=$(cd -- "$skill_dir/references" && pwd -P)/staged-executor.md
agent_path="$HOME/.gemini/config/agents/$AGENT_NAME/agent.md"
[[ -L "$agent_path" ]] || fail "custom agent must be a symlink: $agent_path"
agent_link=$(readlink "$agent_path")
if [[ "$agent_link" == /* ]]; then
  agent_target=$agent_link
else
  agent_target=$(dirname -- "$agent_path")/$agent_link
fi
[[ -r "$agent_target" ]] || fail "custom agent target is unreadable: $agent_target"
agent_target=$(cd -- "$(dirname -- "$agent_target")" && pwd -P)/$(basename -- "$agent_target")
[[ "$agent_target" == "$expected_agent" ]] || fail "custom agent symlink does not target $expected_agent"

if tmux has-session -t "=$session" 2>/dev/null; then
  fail "tmux session already exists: $session"
fi

[[ ! -t 0 ]] || fail "read the approved prompt from standard input"
prompt=$(cat)
[[ "$prompt" =~ [^[:space:]] ]] || fail "prompt is empty"

agy_bin=$(command -v agy)
if [[ "$mode" == "new" ]]; then
  agy_args=(
    "$agy_bin"
    --agent "$AGENT_NAME"
    --model "$model"
    --mode accept-edits
    --sandbox
    --prompt-interactive "$prompt"
  )
else
  agy_args=(
    "$agy_bin"
    --continue
    --mode accept-edits
    --sandbox
    --prompt-interactive "$prompt"
  )
fi

runner=$(mktemp "${TMPDIR:-/tmp}/delegate-stage.XXXXXX")
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
  printf ' %q' "${agy_args[@]}"
  printf '\n'
} >"$runner"
chmod 700 "$runner"

printf -v runner_command 'exec %q' "$runner"
tmux new-session -d -s "$session" -c "$repo" "$runner_command"
cleanup_runner=false

ready=false
pane_command=
for ((attempt = 0; attempt < READY_ATTEMPTS; attempt++)); do
  if ! tmux has-session -t "=$session" 2>/dev/null; then
    fail "agy exited before the interactive session became ready"
  fi
  pane_count=$(tmux list-panes -t "=$session" -F '#{pane_id}' | wc -l | tr -d '[:space:]')
  if [[ "$pane_count" == "1" ]]; then
    pane=$(tmux list-panes -t "=$session" -F '#{pane_id}')
    pane_command=$(tmux display-message -p -t "$pane" '#{pane_current_command}')
    if [[ "$pane_command" == "agy" ]]; then
      ready=true
      break
    fi
  fi
  sleep "$READY_INTERVAL"
done
if [[ "$ready" != true ]]; then
  tmux kill-session -t "=$session" 2>/dev/null || true
  fail "tmux session started but agy did not become ready (current command: ${pane_command:-unknown})"
fi

printf 'Started %s stage in tmux session %q.\n' "$mode" "$session"
printf 'Repository: %s\n' "$repo"
printf 'Branch: %s\n' "$branch"
printf 'Baseline: %s\n' "$baseline_sha"
printf 'Attach: tmux attach-session -t %q\n' "$session"
