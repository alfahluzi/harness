#!/usr/bin/env bash
# Run dev servers concurrently. Ctrl-C kills all.
# Since 2026-09-14 (unified bun workspace): bun runs backend+frontend, npm runs agent/.

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDS=()

# color helpers
c_red=$'\033[31m'; c_grn=$'\033[32m'; c_ylw=$'\033[33m'
c_blu=$'\033[34m'; c_mag=$'\033[35m'; c_cyn=$'\033[36m'; c_off=$'\033[0m'

# dir → (runner, color)
declare -A RUNNER=([backend]="bun" [frontend]="bun" [agent]="npm")
declare -A COLOR=([agent]="$c_mag" [backend]="$c_cyn" [frontend]="$c_grn")

for d in backend frontend agent; do
  if [[ ! -d "$ROOT/$d" ]]; then
    echo "${c_red}missing dir: $d${c_off}" >&2
    exit 1
  fi
done

# backend + frontend share root node_modules (bun workspace)
if [[ ! -d "$ROOT/node_modules" ]]; then
  echo "${c_ylw}[backend/frontend] root node_modules missing - run: bun install${c_off}" >&2
fi
# agent keeps its own node_modules
if [[ -d "$ROOT/agent" && ! -d "$ROOT/agent/node_modules" ]]; then
  echo "${c_ylw}[agent] node_modules missing - run: (cd agent && npm install)${c_off}" >&2
fi

cleanup() {
  echo
  echo "${c_ylw}stopping...${c_off}"
  for pid in "${PIDS[@]}"; do
    kill -TERM "$pid" 2>/dev/null || true
  done
  sleep 1
  for pid in "${PIDS[@]}"; do
    pkill -P "$pid" 2>/dev/null || true
    kill -KILL "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM EXIT

run_one() {
  local d="$1"
  local color="${COLOR[$d]}"
  local runner="${RUNNER[$d]}"
  local prefix="${color}[$d]${c_off}"
  while true; do
    # Fase 6 (F6-T2): regenerate agent/langgraph.json from installed plugin
    # graphs before every LangGraph server (re)start. Must run from agent/ so
    # `node --import tsx` + the relative sdk-shared import resolve.
    if [[ "$d" == "agent" ]]; then
      local link_rc=0
      ( cd "$ROOT/agent" && node --import tsx scripts/link-plugin-graphs.ts ) 2>&1 \
        | stdbuf -oL awk -v p="$prefix" '{ print p" "$0; fflush() }'
      link_rc=${PIPESTATUS[0]}
      if (( link_rc != 0 )); then
        echo "${prefix}${c_ylw}link-plugin-graphs failed; starting agent anyway${c_off}"
      fi
    fi
    (
      cd "$ROOT/$d" || exit 1
      stdbuf -oL -eL "$runner" run dev 2>&1 \
        | stdbuf -oL awk -v p="$prefix" '{ print p" "$0; fflush() }'
    )
    local rc=$?
    echo "${prefix}${c_red} exited rc=$rc, restarting in 2s (Ctrl-C to quit)${c_off}"
    sleep 2
  done
}

for d in backend frontend agent; do
  run_one "$d" &
  PIDS+=("$!")
done

echo "${c_blu}dev running: backend frontend agent${c_off}"
echo "${c_ylw}Ctrl-C to stop all${c_off}"

wait -n "${PIDS[@]}"
cleanup