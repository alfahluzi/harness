# packages/

Bun workspaces for plugin SDK + CLI.

| Package | Scope | Status |
|---------|-------|--------|
| `@puna/sdk-shared` | Zod `PluginManifest`, `PluginSummary`, source-layer enum, graph-key naming | Fase 1; build/publish Fase 7 |
| `@puna/sdk-frontend` | `<PluginHostProvider>`, `<PluginSlot>`/error boundary, registry loader, badge | Fase 2 + Fase 3 |
| `@puna/sdk-backend` | Contract surface only today (`SDK_BACKEND_VERSION`). Planned host/scanner/routes ship from `backend/src/modules/plugins/` | Fase 7 (v1 deviation, see below) |
| `@puna/sdk-agent` | Contract surface only today: version + hook contract types (`NodeLifecyclePhase`, `LifecycleHookDescriptor`, `HookRunResponse`). Runtime bridge lives in `agent/src/base/.libs/plugin-bridge.ts` | Fase 7 (v1 deviation, see below) |
| `@puna/cli` | `puna plugin create`, `dev`, `build` | owned by a separate lane; not part of this SDK publish flow |

All packages use `type: "module"`. Workspace consumers resolve the SDKs through `workspace:*` symlinks.

## Build, dev vs publish

Each SDK package has a `build` script that emits `dist/`:

- ESM JS via `bun build` (target `node`, or `browser` for `sdk-frontend` with React/TanStack externals).
- `.d.ts` declarations via `tsc -p tsconfig.build.json` (`--emitDeclarationOnly`).

**Dev-vs-publish split (intentional):**

- **Runtime `exports` keep pointing at `./src/*.ts`.** The workspace (`bun` and Vite) keeps resolving TypeScript sources, so nothing needs to be built before `bun run dev`, `typecheck`, or tests.
- **`main` / `module` / `types` point at `dist/`** — the publish artifact. `prepublishOnly` runs `bun run build`, and `files: ["src", "dist"]` ships both source and built output.
- `dist/` is gitignored. Running `bun run build` per package (or `prepublishOnly` during `bun publish`) is what materialises it.

Notes:

- `sdk-frontend` dist is minified: `--production` is required to select the production JSX runtime (`react/jsx-runtime`). Bun 1.3.14 ignores `NODE_ENV=production` for JSX runtime selection when the package `tsconfig.json` uses `extends`.
- Packages without a package-local `typescript` devDependency installed (`sdk-backend`, `sdk-agent` until the next `bun install`) can still run `bun run build:js`; `build:types` / `typecheck` need the install.

## Known v1 deviations

- `@puna/sdk-backend` ships contract types + version only. The real backend `PluginHost`, scanner, service, and `/api/plugins` routes live in `backend/src/modules/plugins/` (they import `@puna/sdk-shared` directly). Subpath exports (`./host`, `./scanner`, `./service`, `./routes`) were removed because those files do not exist in the package; re-add them if the logic is ever extracted here.
- `@puna/sdk-agent` ships contract types + version only. The runtime bridge that talks to the backend RPC lives in `agent/src/base/.libs/plugin-bridge.ts`. Subpath exports (`./bridge`, `./hooks`) were removed for the same reason.
