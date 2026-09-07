# Frontend Rules

## API Client Is Auto-Generated

The frontend API client under `src/lib/api/` is **auto-generated** by
[`@hey-api/openapi-ts`](https://heyapi.vercel.app/). Never edit the generated
files by hand — they get overwritten on every regeneration.

**Pipeline:**

1. Backend serves the OpenAPI spec at `/doc`.
2. `bun run openapi:dump` (in `backend/`) writes it to `backend/openapi.json`.
3. `npm run openapi-ts` (in `frontend/`) regenerates `src/lib/api/` from that spec.

**Regenerate after any backend route/schema change:**

```bash
cd backend  && bun run openapi:dump   # refresh backend/openapi.json
cd frontend && npm run openapi-ts     # regenerate src/lib/api/
```

**Gotchas:**

- The backend normalizes path params to OpenAPI curly syntax (`{id}`) when
  serving `/doc` (see `backend/src/server.ts` — `toCurlyPathParams`). This
  works around an upstream `@hono/zod-openapi` bug where mounted sub-apps keep
  colon-style paths. Do not "fix" that normalization away, or the frontend
  client breaks again (path params stop interpolating → literal `:id` in URLs
  → 404).
- Regeneration may rename SDK functions (e.g. `getApiProvidersId` →
  `getApiProvidersById`). After regen, update hand-written callers in
  `src/hooks/` to the new names.
- Generated files are gitignored/untracked. Commit only the regenerated output
  plus any caller updates.
- `openapi-ts` **wipes** the `src/lib/api/` output directory on every run
  (default `clean: true`). Never put hand-written files there — they will be
  silently deleted. Hand-written helpers that talk to backend endpoints (e.g.
  SSE streaming) live in `src/lib/` instead (see `src/lib/stream.ts`).