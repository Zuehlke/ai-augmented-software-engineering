#!/usr/bin/env bash
# Only needed from Lab 9 (Durable workflows) on: keeps Temporal and the flows worker running in the
# background, so you don't need a terminal for each. `flows watch` shows what they do, `flows logs`
# the worker's output. On branches without the flows harness (.harness/package.json), it starts nothing.
#
#   flows-services.sh start    starts what isn't running yet: `task flows:start`
#   flows-services.sh stop     stops the worker and Temporal: `task flows:stop`
#
# The worker restarts by itself when the code in .harness/src changes, for example when you switch labs, but only
# once no workflow runs anymore: a running one would replay on the new code and get stuck.
set -uo pipefail
workspace="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
flows_dir="$workspace/.harness"
state="$HOME/.flows"
mkdir -p "$state"

# Whether <name>.pid is a running process whose command line contains <what>. The pid files
# survive a container restart, where the same pid can belong to another process.
alive() {
  local pid
  pid="$(cat "$state/$1.pid" 2> /dev/null)" || return 1
  [ -n "$pid" ] && kill -0 "$pid" 2> /dev/null && tr '\0' ' ' < "/proc/$pid/cmdline" 2> /dev/null | grep -q -- "$2"
}

temporal_up() { temporal operator cluster health 2> /dev/null | grep -q SERVING; }

start_temporal() {
  temporal_up && return
  if ! alive temporal 'temporal server'; then
    setsid nohup temporal server start-dev --db-filename "$state/temporal.db" > "$state/temporal.log" 2>&1 < /dev/null &
    echo $! > "$state/temporal.pid"
  fi
  for _ in $(seq 30); do temporal_up && return; sleep 1; done
  echo "flows: Temporal didn't start, see $state/temporal.log" >&2
  return 1
}

# Switching to an earlier lab can leave node_modules/ behind, so it looks for package.json
has_flows() { [ -f "$flows_dir/package.json" ]; }

# The code the worker runs, and the agent tokens in .devcontainer/.env. When they change, the worker restarts.
fingerprint() { find "$flows_dir/src" "$flows_dir/package-lock.json" "$workspace/.devcontainer/.env" -type f -exec md5sum {} + 2> /dev/null | sort | md5sum; }

# How many workflows run on the task queue. 0 if Temporal doesn't answer.
running_workflows() {
  local n
  n="$(temporal workflow count --query 'ExecutionStatus="Running" AND TaskQueue="flows"' 2> /dev/null | awk '/Total:/ {print $2}')"
  echo "${n:-0}"
}

supervise() {
  local worker="" running="" started=0 now busy waiting=""
  log() { echo "== $(date +%H:%M:%S) $*" >> "$state/worker.log"; }
  # worker.pid is there while the worker runs, so `flows watch` sees right away when it stops
  stop_worker() { [ -n "$worker" ] && kill "$worker" 2> /dev/null && wait "$worker" 2> /dev/null; worker=""; running=""; rm -f "$state/worker.pid"; }
  trap 'stop_worker; exit 0' TERM INT
  while true; do
    if ! has_flows; then
      [ -n "$worker" ] && { log "this branch has no flows harness, the worker stops"; stop_worker; }
    else
      now="$(fingerprint)"
      if [ -n "$worker" ] && [ "$now" != "$running" ]; then
        # A running workflow replays its history on the worker's code. If the new code does other steps,
        # the replay fails (a nondeterminism error) and the workflow is stuck. So the worker keeps the old
        # code until no workflow runs anymore.
        busy="$(running_workflows)"
        if [ "$busy" -gt 0 ]; then
          [ "$waiting" != "$now" ] && log "the code changed, but $busy workflow(s) still run on the old code. The worker restarts once they're done, or after flows cleanup"
          waiting="$now"
        else
          log "the code in .harness/src or .devcontainer/.env changed, the worker restarts"
          stop_worker
        fi
      fi
      if [ -n "$worker" ] && ! kill -0 "$worker" 2> /dev/null; then
        worker=""
        rm -f "$state/worker.pid"
        # It stopped right after it started, for example a compile error: don't retry every 3 seconds
        if [ $((SECONDS - started)) -lt 20 ]; then
          log "the worker stopped, see above. It starts again in 30 seconds, or as soon as the code changes"
          for _ in $(seq 10); do sleep 3; [ "$(fingerprint)" != "$running" ] && break; done
        fi
      fi
      if [ -z "$worker" ]; then
        if start_temporal && FLOWS_INSTALL_ONLY=1 "$workspace/.devcontainer/bin/flows" >> "$state/worker.log" 2>&1; then
          # The worker runs the agents, so it needs their tokens. It doesn't start from a terminal that loaded them.
          (
            cd "$workspace" || exit
            if [ -f .devcontainer/.env ]; then set -a; . .devcontainer/.env; set +a; fi
            exec "$flows_dir/bin/flows" worker --foreground
          ) >> "$state/worker.log" 2>&1 &
          worker=$!
          echo "$worker" > "$state/worker.pid"
          running="$(fingerprint)"
          started=$SECONDS
        fi
      fi
    fi
    sleep 3
  done
}

case "${1:-start}" in
  start)
    has_flows || exit 0
    start_temporal || exit 1
    if ! alive supervisor 'flows-services.sh supervise'; then
      setsid nohup "${BASH_SOURCE[0]}" supervise > /dev/null 2>&1 < /dev/null &
      echo $! > "$state/supervisor.pid"
    fi
    ;;
  supervise) supervise ;;
  stop)
    # The supervisor stops the worker before it exits
    alive supervisor 'flows-services.sh supervise' && kill "$(cat "$state/supervisor.pid")"
    alive temporal 'temporal server' && kill "$(cat "$state/temporal.pid")"
    rm -f "$state/supervisor.pid" "$state/temporal.pid"
    ;;
  *) echo "Usage: $0 start|stop" >&2; exit 1 ;;
esac
