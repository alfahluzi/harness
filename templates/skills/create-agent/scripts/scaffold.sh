#!/bin/sh
# scaffold.sh — create a new agent profile in the active workspace
#
# Usage:   scaffold.sh <name>
# Env:     PUNA_TARGET (default: ./.puna/agents/<name>)
#          PUNA_AGENT_ROLE         (default: empty)
#          PUNA_AGENT_DESCRIPTION  (default: empty)

set -eu

NAME="${1:?usage: scaffold.sh <name>}"
TARGET="${PUNA_TARGET:-./.puna/agents/$NAME}"
ROLE="${PUNA_AGENT_ROLE:-}"
DESCRIPTION="${PUNA_AGENT_DESCRIPTION:-}"

if [ -e "$TARGET" ]; then
	echo "Refusing to overwrite existing $TARGET" >&2
	echo "Remove it first or set PUNA_TARGET to a different path." >&2
	exit 1
fi

mkdir -p "$TARGET"

cat > "$TARGET/conf.json" <<EOF
{
  "name": "$NAME",
  "role": "$ROLE",
  "temperature": 0.5,
  "called": "",
  "tools": {
    "allow": ["read", "glob", "grep"],
    "deny": ["bash"]
  },
  "description": "$DESCRIPTION"
}
EOF

cat > "$TARGET/prompt.md" <<EOF
# $NAME

[Describe the agent's role, tasks, and constraints here. See the global profiles
under ~/.config/.puna/agents/ for reference — Semar/Cepot/Dawala/Gareng.]
EOF

echo "Created agent scaffold at $TARGET"
echo "Next:"
echo "  1. Edit $TARGET/conf.json (set tools.allow/deny, role, called, description)"
echo "  2. Write the system prompt in $TARGET/prompt.md"