#!/bin/sh
# create.sh — create a new plan file
#
# Usage: create.sh <name>
# Env:   PUNA_DIR (default: ./.puna)

set -eu

NAME="${1:?usage: create.sh <name>}"
PUNA_DIR="${PUNA_DIR:-./.puna}"
TARGET="$PUNA_DIR/docs/plan/$NAME.md"

if [ -e "$TARGET" ]; then
	echo "Plan already exists at $TARGET" >&2
	exit 1
fi

mkdir -p "$PUNA_DIR/docs/plan"

cat > "$TARGET" <<EOF
# $NAME

## Goal

[One or two sentences describing the outcome this plan delivers.]

## Steps

- [ ] step 1
- [ ] step 2
- [ ] step 3

## Notes

[Free-form notes, links, decisions.]
EOF

echo "Created plan at $TARGET"
echo "Next: sh $PUNA_DIR/skills/planning/scripts/advance.sh $NAME \"started: <what you did>\""