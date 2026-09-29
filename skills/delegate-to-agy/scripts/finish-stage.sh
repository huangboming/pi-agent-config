#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  finish-stage.sh --session NAME [--timeout SECONDS]

Sends /exit to the sole live agy pane for an approved stage and waits for the
tmux session to terminate gracefully. It never kills the process or session.
EOF
}

fail() {
  printf 'finish-stage: %s\n' "$*" >&2
  exit 1
}

session=
timeout=15

while [[ $# -gt 0 ]]; do
  case "$1" in
    --session)
      [[ $# -ge 2 ]] || fail "--session requires a name"
      session=$2
      shift 2
      ;;
    --timeout)
      [[ $# -ge 2 ]] || fail "--timeout requires seconds"
      timeout=$2
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
[[ "$timeout" =~ ^[1-9][0-9]{0,2}$ ]] || fail "--timeout must be an integer from 1 to 999"
command -v tmux >/dev/null 2>&1 || fail "required command not found: tmux"
tmux has-session -t "=$session" 2>/dev/null || fail "tmux session does not exist: $session"

pane_count=$(tmux list-panes -t "=$session" -F '#{pane_id}' | wc -l | tr -d '[:space:]')
[[ "$pane_count" == "1" ]] || fail "tmux session must contain exactly one pane: $session"
pane=$(tmux list-panes -t "=$session" -F '#{pane_id}')
pane_dead=$(tmux display-message -p -t "$pane" '#{pane_dead}')
[[ "$pane_dead" == "0" ]] || fail "tmux pane is not live: $session"
pane_command=$(tmux display-message -p -t "$pane" '#{pane_current_command}')
[[ "$pane_command" == "agy" ]] || fail "tmux pane is not running agy: $session ($pane_command)"

tmux send-keys -t "$pane" -l '/exit'
tmux send-keys -t "$pane" Enter

attempts=$((timeout * 5))
for ((attempt = 0; attempt < attempts; attempt++)); do
  if ! tmux has-session -t "=$session" 2>/dev/null; then
    printf 'Delegated stage session exited cleanly: %s\n' "$session"
    exit 0
  fi
  sleep 0.2
done

fail "agy did not exit within ${timeout}s; session remains available for inspection and was not killed: $session"
