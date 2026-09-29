#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  send-followup.sh --session NAME --prompt-file ABSOLUTE_PATH

Sends one literal instruction to an idle Pi tmux pane telling it to read the
approved follow-up contract from a file. Keep the file until Pi returns
ready_for_review or blocked.
EOF
}

fail() {
  printf 'send-followup: %s\n' "$*" >&2
  exit 1
}

session=
prompt_file=

while [[ $# -gt 0 ]]; do
  case "$1" in
    --session)
      [[ $# -ge 2 ]] || fail "--session requires a name"
      session=$2
      shift 2
      ;;
    --prompt-file)
      [[ $# -ge 2 ]] || fail "--prompt-file requires a path"
      prompt_file=$2
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
[[ -n "$prompt_file" ]] || fail "--prompt-file is required"
[[ "$prompt_file" == /* ]] || fail "--prompt-file must be an absolute path"
[[ -f "$prompt_file" && -r "$prompt_file" ]] || fail "prompt file does not exist or is not readable: $prompt_file"
[[ -s "$prompt_file" ]] || fail "prompt file is empty: $prompt_file"
LC_ALL=C grep -q '[^[:space:]]' "$prompt_file" || fail "prompt file contains only whitespace: $prompt_file"
for command_name in tmux ps awk; do
  command -v "$command_name" >/dev/null 2>&1 || fail "required command not found: $command_name"
done
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

instruction="Read $prompt_file completely and follow it as the approved follow-up contract. When finished, report ready_for_review or blocked and remain idle."
tmux send-keys -t "$pane" -l "$instruction"
tmux send-keys -t "$pane" Enter

printf 'Sent a one-line file instruction to Pi session %q.\n' "$session"
printf 'Keep the prompt file until Pi returns: %s\n' "$prompt_file"
