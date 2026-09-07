# @aldi-rudexylo/nusa

CLI for the nusa harness agent system.

## Install

```bash
npm i -g @aldi-rudexylo/nusa
```

## Usage

```bash
# In the project you want to harness:
cd /path/to/your-project
nusa init      # generates .nusa/ workspace
# edit .nusa/agents/, .nusa/skills/, .nusa/docs/plan/
nusa serve     # starts agent + backend + frontend (requires harness repo locally)
```

## Commands

- `nusa init` — create `.nusa/` workspace in the current directory
- `nusa serve` — detect `.nusa/` workspace and start the harness (agent, backend, frontend)
- `nusa serve --check` — validate the workspace without starting services

## `nusa serve` requires the harness repo

The `serve` command expects the agent, backend, and frontend packages to live alongside
the CLI (sibling `agent/`, `backend/`, `frontend/` directories). After a global install,
those aren't included.

Options to make `serve` work:

1. Clone the harness repo and run `node bin/nusa.mjs serve` from inside it
2. `npm link` the repo: `git clone ... && cd nusa && npm link && nusa serve`

See https://github.com/aldi-rudexylo/nusa for full docs.