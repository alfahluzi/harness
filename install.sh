#!/usr/bin/env bash
# Unified install since 2026-09-14:
#   - root: `bun install` covers packages/* + backend + frontend (root workspaces)
#   - agent/: standalone npm install (native better-sqlite3 binding)
#
# Pre-2026-09-14 this script ran per-dir in parallel with mixed bun/npm runners.

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

c_red=$'\033[31m'; c_grn=$'\033[32m'; c_ylw=$'\033[33m'; c_off=$'\033[0m'

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
      echo "  --force            : pass --force to installer"
      exit 0
      ;;
  esac
done

OVERALL=0

# 1) root workspaces (packages/* + backend + frontend)
mkdir -p "$ROOT/.puna"
if [[ $SKIP_IF_INSTALLED -eq 1 && -d "$ROOT/node_modules" && $FORCE -eq 0 ]]; then
  echo "${c_grn}[root]${c_off}${c_grn} node_modules present - skipping${c_off}"
else
  echo "${c_ylw}[root]${c_off} bun install (packages/* + backend + frontend)..."
  local_args=(install)
  [[ $FORCE -eq 1 ]] && local_args+=(--force)
  if ! (cd "$ROOT" && bun "${local_args[@]}" >"$ROOT/.puna/install-root.log" 2>&1); then
    echo "${c_red}[root] failed (log: $ROOT/.puna/install-root.log)${c_off}" >&2
    tail -n 20 "$ROOT/.puna/install-root.log" | sed "s/^/${c_red}[root]${c_off} /" >&2
    OVERALL=1
  else
    echo "${c_grn}[root]${c_off}${c_grn} done${c_off}"
  fi
fi

# 2) agent/ standalone (native better-sqlite3 binding)
if [[ -d "$ROOT/agent" ]]; then
  if [[ $SKIP_IF_INSTALLED -eq 1 && -d "$ROOT/agent/node_modules" && $FORCE -eq 0 ]]; then
    echo "${c_grn}[agent]${c_off}${c_grn} node_modules present - skipping${c_off}"
  else
    echo "${c_ylw}[agent]${c_off} npm install (native binding)..."
    local_args=(install)
    [[ $FORCE -eq 1 ]] && local_args+=(--force)
    if ! (cd "$ROOT/agent" && npm "${local_args[@]}" >"$ROOT/.puna/install-agent.log" 2>&1); then
      echo "${c_red}[agent] failed (log: $ROOT/.puna/install-agent.log)${c_off}" >&2
      tail -n 20 "$ROOT/.puna/install-agent.log" | sed "s/^/${c_red}[agent]${c_off} /" >&2
      OVERALL=1
    else
      echo "${c_grn}[agent]${c_off}${c_grn} done${c_off}"
    fi
  fi
fi

echo
if [[ $OVERALL -eq 0 ]]; then
  echo "${c_grn}all installs succeeded${c_off}"
else
  echo "${c_red}one or more installs failed${c_off}"
fi

exit $OVERALL