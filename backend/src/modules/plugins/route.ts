import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { PluginManifest, PluginSource, PluginSummary } from "@puna/sdk-shared";
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

export { app as pluginRoutes };
