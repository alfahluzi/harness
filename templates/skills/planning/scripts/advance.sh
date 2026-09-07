#!/bin/sh
# advance.sh — append a timestamped progress entry to <name>.progress.md
#
# Usage: advance.sh <name> <message>
# Env:   PUNA_DIR (default: ./.puna)

set -eu

NAME="${1:?usage: advance.sh <name> <message>}"
MSG="${2:?usage: advance.sh <name> <message>}"
PUNA_DIR="${PUNA_DIR:-./.puna}"
LOG="$PUNA_DIR/docs/plan/$NAME.progress.md"

mkdir -p "$(dirname "$LOG")"

TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
printf '[%s] %s\n' "$TS" "$MSG" >> "$LOG"

echo "appended to $LOG"