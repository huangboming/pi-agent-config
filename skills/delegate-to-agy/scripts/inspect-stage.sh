#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  inspect-stage.sh --repo PATH --session NAME --baseline SHA [--lines COUNT]

Validates the structural preconditions for reviewing a delegated stage and
prints the repository state plus the recent agy pane transcript. A successful
result does not prove that agy is idle; the reviewer must confirm that from the
captured final report before freezing the worktree.
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

for command_name in git tmux; do
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
[[ "$pane_command" == "agy" ]] || fail "tmux pane is not running agy: $session ($pane_command)"

printf 'Repository: %s\n' "$repo"
printf 'Branch: %s\n' "$branch"
printf 'Baseline/HEAD: %s\n' "$head_sha"
printf 'Session: %s\n' "$session"
printf 'Pane: %s (%s)\n' "$pane" "$pane_command"
printf '%s\n' '--- Worktree status ---'
git -C "$repo" status --short
printf '%s\n' '--- Recent agy transcript ---'
tmux capture-pane -p -t "$pane" -S "-$lines"
printf '%s\n' '--- Manual check required: confirm ready_for_review or blocked and an idle prompt ---'
