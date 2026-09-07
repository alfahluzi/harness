#!/usr/bin/env bash
# Run npm run dev in agent/ + backend/ + frontend/ concurrently.
# Ctrl-C kills all three.

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIRS=(agent backend frontend)
PIDS=()

# color helpers
c_red=$'\033[31m'; c_grn=$'\033[32m'; c_ylw=$'\033[33m'
c_blu=$'\033[34m'; c_mag=$'\033[35m'; c_cyn=$'\033[36m'; c_off=$'\033[0m'

for d in "${DIRS[@]}"; do
  if [[ ! -d "$ROOT/$d" ]]; then
    echo "${c_red}missing dir: $d${c_off}" >&2
    exit 1
  fi
  if [[ ! -d "$ROOT/$d/node_modules" ]]; then
    echo "${c_ylw}[$d] node_modules missing - run: (cd $d && npm install)${c_off}" >&2
  fi
done

# assign color per dir
declare -A col=([agent]="$c_mag" [backend]="$c_cyn" [frontend]="$c_grn")

# pick runner per dir: bun for bun.lock, npm otherwise
runner_for() {
  local d="$1"
  if [[ -f "$ROOT/$d/bun.lock" || -f "$ROOT/$d/bun.lockb" ]]; then
    echo "bun"
  else
    echo "npm"
  fi
}

cleanup() {
  echo
  echo "${c_ylw}stopping...${c_off}"
  for pid in "${PIDS[@]}"; do
    kill -TERM "$pid" 2>/dev/null || true
  done
  # give them a moment, then force
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
  local color="${col[$d]}"
  local prefix="${color}[$d]${c_off}"
  local runner
  runner="$(runner_for "$d")"
  while true; do
    (
      cd "$ROOT/$d" || exit 1
      # prefix every line
      stdbuf -oL -eL "$runner" run dev 2>&1 \
        | stdbuf -oL awk -v p="$prefix" '{ print p" "$0; fflush() }'
    )
    local rc=$?
    echo "${prefix}${c_red} exited rc=$rc, restarting in 2s (Ctrl-C to quit)${c_off}"
    sleep 2
  done
}

for d in "${DIRS[@]}"; do
  run_one "$d" &
  PIDS+=("$!")
done

echo "${c_blu}dev running: ${DIRS[*]}${c_off}"
echo "${c_ylw}Ctrl-C to stop all${c_off}"

# wait on any child; cleanup fires via trap
wait -n "${PIDS[@]}"
cleanup