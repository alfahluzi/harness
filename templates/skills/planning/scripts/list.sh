#!/bin/sh
# list.sh — print all plan names in the active workspace
#
# Env: PUNA_DIR (default: ./.puna)

set -eu

PUNA_DIR="${PUNA_DIR:-./.puna}"
PLAN_DIR="$PUNA_DIR/docs/plan"

if [ ! -d "$PLAN_DIR" ]; then
	echo "(no plans yet — PUNA_DIR=$PUNA_DIR has no docs/plan/)" >&2
	exit 0
fi

# Strip .md and .progress.md suffixes, dedupe, sort.
ls -1 "$PLAN_DIR" 2>/dev/null \
	| sed -e 's/\.progress\.md$//' -e 's/\.md$//' \
	| sort -u