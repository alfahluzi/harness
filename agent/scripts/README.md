# agent/scripts

Build/dev scripts invoked by `dev.sh` and Fase 6 plugin graph linker.

| Script | Purpose | Fase |
|--------|---------|------|
| `link-plugin-graphs.ts` | Merge plugin graphs into `agent/langgraph.json` + symlink `agent/.plugins/<pluginId>/` | Fase 6 (F6-T1) |