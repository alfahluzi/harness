#!/bin/sh
# scaffold.sh — create a new skill package in the active workspace
#
# Usage: scaffold.sh <name>
# Env:   PUNA_TARGET (default: ./.puna/skills/<name>)

set -eu

NAME="${1:?usage: scaffold.sh <name>}"
TARGET="${PUNA_TARGET:-./.puna/skills/$NAME}"

if [ -e "$TARGET" ]; then
	echo "Refusing to overwrite existing $TARGET" >&2
	echo "Remove it first or set PUNA_TARGET to a different path." >&2
	exit 1
fi

mkdir -p "$TARGET/scripts"

cat > "$TARGET/desc.md" <<EOF
# $NAME

[Describe the skill's purpose here. When should an agent invoke this skill?
What inputs does it take, what does it produce?]
EOF

cat > "$TARGET/scripts/example.sh" <<'INNER_EOF'
#!/bin/sh
# example.sh — replace this with the real behavior for the skill
#
# Usage: example.sh [args]
set -eu
echo "Hello from skill: $NAME"
INNER_EOF

chmod +x "$TARGET/scripts/example.sh"

echo "Created skill scaffold at $TARGET"
echo "Next:"
echo "  1. Edit $TARGET/desc.md (purpose, when to use)"
echo "  2. Replace $TARGET/scripts/example.sh with the real script(s)"