#!/usr/bin/env bash
# npm install in agent/ + backend/ + frontend/ concurrently.

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIRS=(agent backend frontend)

c_red=$'\033[31m'; c_grn=$'\033[32m'; c_ylw=$'\033[33m'
c_mag=$'\033[35m'; c_cyn=$'\033[36m'; c_off=$'\033[0m'

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

# parse flags
SKIP_IF_INSTALLED=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --skip-if-installed) SKIP_IF_INSTALLED=1 ;;
    --force) FORCE=1 ;;
    -h|--help)
      echo "usage: $0 [--skip-if-installed] [--force]"
      echo "  --skip-if-installed : skip dirs that already have node_modules"
      echo "  --force            : pass --force to npm"
      exit 0
      ;;
  esac
done

declare -A PIDS
declare -A STATUS
LOCK_DIR="/tmp/install.sh.lock.$$"

cleanup() {
  rm -rf "$LOCK_DIR" 2>/dev/null
}
trap cleanup EXIT

for d in "${DIRS[@]}"; do
  if [[ ! -d "$ROOT/$d" ]]; then
    echo "${c_red}missing dir: $d${c_off}" >&2
    exit 1
  fi
done

run_install() {
  local d="$1"
  local color="${col[$d]}"
  local prefix="${color}[$d]${c_off}"
  local logfile="$ROOT/.puna/install-$d.log"
  local runner
  runner="$(runner_for "$d")"

  if [[ $SKIP_IF_INSTALLED -eq 1 && -d "$ROOT/$d/node_modules" && $FORCE -eq 0 ]]; then
    echo "${prefix}${c_grn} node_modules present - skipping${c_off}"
    STATUS[$d]=0
    return
  fi

  echo "${prefix} installing with $runner..."
  (
    cd "$ROOT/$d" || exit 1
    if [[ "$runner" == "bun" ]]; then
      local args=(install)
      [[ $FORCE -eq 1 ]] && args+=(--force)
      bun "${args[@]}" >"$logfile" 2>&1
    else
      local args=(install)
      [[ $FORCE -eq 1 ]] && args+=(--force)
      npm "${args[@]}" >"$logfile" 2>&1
    fi
  )
  local rc=$?
  STATUS[$d]=$rc

  if [[ $rc -eq 0 ]]; then
    echo "${prefix}${c_grn} done${c_off}"
  else
    echo "${prefix}${c_red} failed rc=$rc (log: $logfile)${c_off}"
    # tail last 20 lines for context
    tail -n 20 "$logfile" | sed "s/^/${prefix} /" >&2
  fi
}

mkdir -p "$ROOT/.puna"

for d in "${DIRS[@]}"; do
  run_install "$d" &
  PIDS[$d]=$!
done

OVERALL=0
for d in "${DIRS[@]}"; do
  wait "${PIDS[$d]}"
  rc=${STATUS[$d]}
  [[ $rc -ne 0 ]] && OVERALL=$rc
done

echo
if [[ $OVERALL -eq 0 ]]; then
  echo "${c_grn}all installs succeeded${c_off}"
else
  echo "${c_red}one or more installs failed${c_off}"
fi

exit $OVERALL