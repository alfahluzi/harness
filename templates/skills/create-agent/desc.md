# create-agent

Scaffold a new agent profile in the active workspace's `.puna/agents/<name>/`.

Use when the user asks to add a new agent, create an agent profile, or extend
the agent roster for a project.

## What it does

Creates two files at `.puna/agents/<name>/`:

- `conf.json` — runtime config with sensible defaults (temperature 0.5, basic
  read-only tool whitelist the user can edit). Schema mirrors the global agent
  profiles (Semar/Cepot/Dawala/Gareng) so the harness picks it up automatically.
- `prompt.md` — empty system-prompt template with a heading. User fills in role,
  tasks, and constraints.

## How to invoke

```sh
sh .puna/skills/create-agent/scripts/scaffold.sh <agent-name>
```

After scaffolding, edit `conf.json` (especially `tools.allow` / `tools.deny`)
and `prompt.md` to fit the new agent's purpose. The agent becomes active
immediately on the next `puna serve` invocation — local overrides win on name
collision with global defaults.

## Overrides

- `PUNA_TARGET` — override destination directory (default: `./.puna/agents/<name>`)
- `PUNA_AGENT_ROLE` — pre-fill the `role` field in conf.json
- `PUNA_AGENT_DESCRIPTION` — pre-fill the `description` field