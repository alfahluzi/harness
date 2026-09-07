# @aldi-rudexylo/puna

CLI for the puna harness agent system.

## Install

```bash
npm i -g @aldi-rudexylo/puna
```

## Usage

```bash
# In the project you want to harness:
cd /path/to/your-project
puna init      # generates .puna/ workspace
# edit .puna/agents/, .puna/skills/, .puna/docs/plan/
puna serve     # starts agent + backend + frontend (requires harness repo locally)
```

## Commands

- `puna init` — create `.puna/` workspace in the current directory
- `puna serve` — detect `.puna/` workspace and start the harness (agent, backend, frontend)
- `puna serve --check` — validate the workspace without starting services

## `puna serve` requires the harness repo

The `serve` command expects the agent, backend, and frontend packages to live alongside
the CLI (sibling `agent/`, `backend/`, `frontend/` directories). After a global install,
those aren't included.

Options to make `serve` work:

1. Clone the harness repo and run `node bin/puna.mjs serve` from inside it
2. `npm link` the repo: `git clone ... && cd puna && npm link && puna serve`

See https://github.com/aldi-rudexylo/puna for full docs.
