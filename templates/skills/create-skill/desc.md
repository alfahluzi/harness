# create-skill

Scaffold a new skill package in the active workspace's `.puna/skills/<name>/`.

Use when the user wants to add a reusable behavior, automation, or helper that
agents can invoke by name. Skills are layered: local overrides win on name
collision with global skills under `~/.config/.puna/skills/`.

## What it does

Creates at `.puna/skills/<name>/`:

- `desc.md` — short description of what the skill does and when to use it.
  Agents read this to decide whether to invoke the skill.
- `scripts/example.sh` — placeholder executable script (chmod +x). Replace with
  the actual behavior, or add more scripts in `scripts/`.

## How to invoke

```sh
sh .puna/skills/create-skill/scripts/scaffold.sh <skill-name>
```

After scaffolding:

1. Edit `desc.md` — describe purpose, when to invoke, inputs/outputs.
2. Replace `scripts/example.sh` with the real script(s).
3. Add more scripts to `scripts/` as needed.

## Overrides

- `PUNA_TARGET` — override destination directory (default: `./.puna/skills/<name>`)