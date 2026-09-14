import { join } from "node:path";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { CapabilityEntry, PluginManifest, PluginSource, PluginSummary } from "@puna/sdk-shared";
import { InvalidWorkspaceError } from "../../global/workspace-context";
import { PluginService, PluginNotFoundError } from "./service";

const pluginService = new PluginService();
const app = new OpenAPIHono();

const ConfigDirQuery = z.object({
	configDir: z.string().min(1),
});

const PluginIdParam = z.object({
	id: z.string().min(1),
});

const ErrorResponse = z.object({ error: z.string() }).openapi("Error");

// Zod schemas come from `@puna/sdk-shared` (single source of truth shared with
// the frontend registry) — intentional deviation from the local `schema.ts`
// convention, per F1-T4. `PluginManifest`/`PluginSummary` are already
// openapi-registered once `@hono/zod-openapi` patches the zod prototype.
const PluginsListResponse = z
	.object({
		workspaceId: z.string(),
		globalConfigDir: z.string().nullable(),
		plugins: z.array(PluginSummary),
	})
	.openapi("PluginsListResponse");

const PluginDetailResponseSchema = z
	.object({
		manifest: PluginManifest,
		source: PluginSource,
		resolvedDir: z.string().min(1),
	})
	.openapi("PluginDetailResponse");

/**
 * In-memory UI bundle cache, keyed by `<configDir>\0<id>\0<entry>`.
 *
 * Invalidation policy: entries live for the process lifetime — invalidation
 * happens only on backend restart. Dev-mode edits to a plugin's UI source are
 * therefore picked up by restarting the backend (F3-T6 scope; a watcher or
 * mtime check is out of scope for this task).
 */
const uiBundleCache = new Map<string, string>();

/** UI capability lookup order (Fase 3 wire-up surface first, then legacy). */
const UI_CAPABILITY_ORDER = ["chatRenderers", "toolUi", "leftBar", "footerBar"] as const;

function pickUiCapability(
	capabilities: PluginManifest["capabilities"],
): CapabilityEntry | undefined {
	if (!capabilities) return undefined;
	for (const key of UI_CAPABILITY_ORDER) {
		const cap = capabilities[key];
		if (cap) return cap;
	}
	return undefined;
}

const listRoute = createRoute({
	method: "get",
	path: "/plugins",
	request: { query: ConfigDirQuery },
	responses: {
		200: {
			description: "List plugins across workspace-local, workspace-global, and system-global layers",
			content: { "application/json": { schema: PluginsListResponse } },
		},
		400: {
			description: "Invalid workspace",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
	tags: ["plugins"],
});

const detailRoute = createRoute({
	method: "get",
	path: "/plugins/:id",
	request: {
		params: PluginIdParam,
		query: ConfigDirQuery,
	},
	responses: {
		200: {
			description: "Plugin detail with full manifest and resolved source",
			content: { "application/json": { schema: PluginDetailResponseSchema } },
		},
		400: {
			description: "Invalid workspace",
			content: { "application/json": { schema: ErrorResponse } },
		},
		404: {
			description: "Plugin not found",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
	tags: ["plugins"],
});

const uiBundleRoute = createRoute({
	method: "get",
	path: "/plugins/:id/ui-bundle",
	request: {
		params: PluginIdParam,
		query: ConfigDirQuery,
	},
	responses: {
		200: {
			description: "ESM bundle",
			content: { "text/javascript": { schema: z.string() } },
		},
		400: {
			description: "Invalid workspace",
			content: { "application/json": { schema: ErrorResponse } },
		},
		404: {
			description: "Plugin not found",
			content: { "application/json": { schema: ErrorResponse } },
		},
		500: {
			description: "Bundle build failed",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
	tags: ["plugins"],
});

app.openapi(listRoute, async (c) => {
	const { configDir } = c.req.valid("query");
	try {
		const result = await pluginService.list(configDir);
		return c.json(result, 200);
	} catch (e) {
		if (e instanceof InvalidWorkspaceError) return c.json({ error: e.message }, 400);
		throw e;
	}
});

app.openapi(detailRoute, async (c) => {
	// `:id` is the manifest `id` field, unlike agents' `:name` (directory name):
	// plugin identity is defined by `plugin.json`, not by the folder name.
	const { id } = c.req.valid("param");
	const { configDir } = c.req.valid("query");
	try {
		const result = await pluginService.get(configDir, id);
		return c.json(result, 200);
	} catch (e) {
		if (e instanceof PluginNotFoundError) return c.json({ error: e.message }, 404);
		if (e instanceof InvalidWorkspaceError) return c.json({ error: e.message }, 400);
		throw e;
	}
});

app.openapi(uiBundleRoute, async (c) => {
	const { id } = c.req.valid("param");
	const { configDir } = c.req.valid("query");

	let detail: Awaited<ReturnType<PluginService["get"]>>;
	try {
		detail = await pluginService.get(configDir, id);
	} catch (e) {
		if (e instanceof PluginNotFoundError) return c.json({ error: e.message }, 404);
		if (e instanceof InvalidWorkspaceError) return c.json({ error: e.message }, 400);
		throw e;
	}

	const capability = pickUiCapability(detail.manifest.capabilities);
	if (!capability) {
		return c.json({ error: "ui bundle build failed: plugin declares no UI capability" }, 500);
	}

	const relPath = capability.entry;
	const absPath = join(detail.resolvedDir, relPath);
	const cacheKey = `${configDir}\0${id}\0${relPath}`;

	const cached = uiBundleCache.get(cacheKey);
	if (cached !== undefined) {
		return c.body(cached, 200, { "Content-Type": "text/javascript; charset=utf-8" });
	}

	const file = Bun.file(absPath);
	if (!(await file.exists())) {
		return c.json({ error: `ui bundle entry not found: ${relPath}` }, 500);
	}

	let bundle: string;
	if (relPath.endsWith(".js") || relPath.endsWith(".mjs")) {
		// Prod mode: plugin author pre-bundled — serve as-is (strategy §6.6).
		bundle = await file.text();
	} else if (relPath.endsWith(".ts") || relPath.endsWith(".tsx")) {
		try {
			const result = await Bun.build({
				entrypoints: [absPath],
				target: "browser",
				format: "esm",
				external: [
					"react",
					"react-dom",
					"react/jsx-runtime",
					"react-dom/client",
					"@tanstack/react-router",
				],
				minify: false,
				sourcemap: "none",
			});
			const artifact = result.outputs[0] as Blob | undefined;
			if (!result.success || !artifact) {
				console.error(`[plugins] ui bundle build failed for ${id} (${relPath})`, result);
				const reason = result.logs.map((log) => log.message).join("; ") || "no output";
				return c.json({ error: `ui bundle build failed: ${reason}` }, 500);
			}
			bundle = await artifact.text();
		} catch (e) {
			console.error(`[plugins] ui bundle build threw for ${id} (${relPath})`, e);
			return c.json(
				{ error: `ui bundle build failed: ${e instanceof Error ? e.message : String(e)}` },
				500,
			);
		}
	} else {
		return c.json({ error: `ui bundle build failed: unsupported entry extension: ${relPath}` }, 500);
	}

	uiBundleCache.set(cacheKey, bundle);
	return c.body(bundle, 200, { "Content-Type": "text/javascript; charset=utf-8" });
});

export { app as pluginRoutes };
