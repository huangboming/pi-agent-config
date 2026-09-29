#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  inspect-stage.sh --repo PATH --session NAME --baseline SHA [--lines COUNT]

Validates the structural preconditions for reviewing a delegated Pi stage and
prints repository state, persisted Pi session evidence, and the recent pane
transcript. Success does not prove Pi is idle; the reviewer must manually
confirm the final report and editor state.
EOF
}

fail() {
  printf 'inspect-stage: %s\n' "$*" >&2
  exit 1
}

repo=
session=
baseline=
lines=100

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
    --lines)
      [[ $# -ge 2 ]] || fail "--lines requires a count"
      lines=$2
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
[[ "$session" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$ ]] || fail "session must match [A-Za-z0-9][A-Za-z0-9_-]{0,79}"
[[ -n "$baseline" ]] || fail "--baseline is required"
[[ "$lines" =~ ^[1-9][0-9]{0,3}$ ]] || fail "--lines must be an integer from 1 to 9999"

for command_name in git tmux jq ps awk; do
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

tmux has-session -t "=$session" 2>/dev/null || fail "tmux session does not exist: $session"
pane_count=$(tmux list-panes -t "=$session" -F '#{pane_id}' | wc -l | tr -d '[:space:]')
[[ "$pane_count" == "1" ]] || fail "tmux session must contain exactly one pane: $session"
pane=$(tmux list-panes -t "=$session" -F '#{pane_id}')
pane_dead=$(tmux display-message -p -t "$pane" '#{pane_dead}')
[[ "$pane_dead" == "0" ]] || fail "tmux pane is not live: $session"
pane_command=$(tmux display-message -p -t "$pane" '#{pane_current_command}')
pane_pid=$(tmux display-message -p -t "$pane" '#{pane_pid}')
pane_process=$(ps -p "$pane_pid" -o comm= 2>/dev/null | awk '{$1=$1; print}')
[[ "$pane_process" == "pi" ]] || fail "tmux pane is not running Pi: $session (tmux command: $pane_command, process: ${pane_process:-unknown})"

executor=$(tmux show-options -v -t "$session" @delegate_executor 2>/dev/null || true)
[[ "$executor" == "pi" ]] || fail "tmux session is not marked as a delegated Pi stage: $session"
recorded_repo=$(tmux show-options -v -t "$session" @delegate_repo 2>/dev/null || true)
recorded_baseline=$(tmux show-options -v -t "$session" @delegate_baseline 2>/dev/null || true)
pi_session_id=$(tmux show-options -v -t "$session" @delegate_pi_session_id 2>/dev/null || true)
[[ "$recorded_repo" == "$repo" ]] || fail "tmux repository metadata does not match: $recorded_repo"
[[ "$recorded_baseline" == "$baseline_sha" ]] || fail "tmux baseline metadata does not match: $recorded_baseline"
[[ -n "$pi_session_id" ]] || fail "tmux session lacks the Pi session ID"

session_root=${PI_CODING_AGENT_SESSION_DIR:-$HOME/.pi/agent/sessions}
session_file=
if [[ -d "$session_root" ]]; then
  while IFS= read -r candidate; do
    [[ -z "$session_file" ]] || fail "multiple Pi session files found for ID $pi_session_id"
    session_file=$candidate
  done < <(find "$session_root" -type f -name "*${pi_session_id}*.jsonl" -print 2>/dev/null)
fi

printf 'Repository: %s\n' "$repo"
printf 'Branch: %s\n' "$branch"
printf 'Baseline/HEAD: %s\n' "$head_sha"
printf 'Tmux session: %s\n' "$session"
printf 'Pi session ID: %s\n' "$pi_session_id"
printf 'Pane: %s (tmux command: %s, process: %s)\n' "$pane" "$pane_command" "$pane_process"
printf '%s\n' '--- Worktree status ---'
git -C "$repo" status --short
printf '%s\n' '--- Persisted Pi final response ---'
if [[ -n "$session_file" ]]; then
  printf 'Session file: %s\n' "$session_file"
  jq -rs '
    [.[] | select(.type == "message" and .message.role == "assistant")] | last |
    if . == null then
      {status: "no_assistant_response"}
    else
      {
        provider: .message.provider,
        model: .message.model,
        stopReason: .message.stopReason,
        text: ([.message.content[]? | select(.type == "text") | .text] | join("\n"))
      }
    end
  ' "$session_file"
else
  printf 'No persisted session file found yet under %s\n' "$session_root"
fi
printf '%s\n' '--- Recent Pi transcript ---'
tmux capture-pane -p -t "$pane" -S "-$lines"
printf '%s\n' '--- Manual check required: confirm ready_for_review or blocked and an idle editor ---'
