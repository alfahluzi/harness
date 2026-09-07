# planning

Work with the active workspace's plans under `.puna/docs/plan/`.

Use when the user wants to create a plan, see existing plans, or update a
plan's progress log. Plans are project-local — they live in the workspace, not
in the global config.

## Scripts

| Script | Purpose |
|---|---|
| `list.sh` | Print all plan names (deduplicated, ignoring `.progress.md` files). |
| `create.sh <name>` | Create a new plan file at `docs/plan/<name>.md` with a template body. |
| `advance.sh <name> <message>` | Append a timestamped progress entry to `docs/plan/<name>.progress.md`. |

## Typical flow

```sh
SCRIPTS=.puna/skills/planning/scripts

# 1. See what's there
sh $SCRIPTS/list.sh

# 2. Create a new plan
sh $SCRIPTS/create.sh add-auth-flow

# 3. As work progresses, append progress entries
sh $SCRIPTS/advance.sh add-auth-flow "started: scaffolded JWT middleware"
sh $SCRIPTS/advance.sh add-auth-flow "completed: token issuance endpoint"
sh $SCRIPTS/advance.sh add-auth-flow "blocked: need refresh-token rotation policy"
```

## Overrides (all scripts)

- `PUNA_DIR` — override workspace root (default: `./.puna`).