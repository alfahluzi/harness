import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { InvalidWorkspaceError } from "../../global/workspace-context";
import { McpService, McpNotFoundError, McpAlreadyInstalledError, McpConfigError } from "./service";
import { RegistryClient, RegistryError, RegistryNotFoundError } from "./registry";
import {
	ConfigDirQuery,
	McpNameParam,
	SearchQuery,
	InstallBody,
	SearchResponse,
	PublicMcpDetail,
	InstalledListResponse,
	InstalledDetailResponse,
	InstallResponse,
	UninstallResponse,
	ErrorResponse,
} from "./schema";

const mcpService = new McpService();
const registry = new RegistryClient();
const app = new OpenAPIHono();

// ---------------------------------------------------------------------------
// Public registry routes
// ---------------------------------------------------------------------------

const RegistryVersionQuery = z.object({
	version: z.string().min(1).optional(),
});

const searchRoute = createRoute({
	method: "get",
	path: "/mcps/search",
	request: { query: SearchQuery },
	responses: {
		200: {
			description: "Search public MCPs in the official MCP Registry",
			content: { "application/json": { schema: SearchResponse } },
		},
		502: {
			description: "Registry unreachable / upstream error",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
	tags: ["mcps"],
});

const registryDetailRoute = createRoute({
	method: "get",
	path: "/mcps/registry/:name",
	request: {
		params: McpNameParam,
		query: RegistryVersionQuery,
	},
	responses: {
		200: {
			description: "Public MCP detail (env vars, runtime args, transport)",
			content: { "application/json": { schema: PublicMcpDetail } },
		},
		404: {
			description: "MCP not found in registry",
			content: { "application/json": { schema: ErrorResponse } },
		},
		502: {
			description: "Registry unreachable / upstream error",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
	tags: ["mcps"],
});

// ---------------------------------------------------------------------------
// Installed routes (workspace-scoped)
// ---------------------------------------------------------------------------

const listInstalledRoute = createRoute({
	method: "get",
	path: "/mcps/installed",
	request: { query: ConfigDirQuery },
	responses: {
		200: {
			description: "List installed MCPs in workspace (local + global, local wins)",
			content: { "application/json": { schema: InstalledListResponse } },
		},
		400: {
			description: "Invalid workspace",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
	tags: ["mcps"],
});

const installedDetailRoute = createRoute({
	method: "get",
	path: "/mcps/installed/:name",
	request: {
		params: McpNameParam,
		query: ConfigDirQuery,
	},
	responses: {
		200: {
			description: "Installed MCP detail (raw conf.json)",
			content: { "application/json": { schema: InstalledDetailResponse } },
		},
		400: {
			description: "Invalid workspace",
			content: { "application/json": { schema: ErrorResponse } },
		},
		404: {
			description: "MCP not installed",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
	tags: ["mcps"],
});

const installRoute = createRoute({
	method: "post",
	path: "/mcps/install",
	request: {
		body: { content: { "application/json": { schema: InstallBody } } },
		query: ConfigDirQuery,
	},
	responses: {
		200: {
			description: "MCP installed",
			content: { "application/json": { schema: InstallResponse } },
		},
		400: {
			description: "Invalid workspace or invalid install body",
			content: { "application/json": { schema: ErrorResponse } },
		},
		404: {
			description: "MCP not found in registry",
			content: { "application/json": { schema: ErrorResponse } },
		},
		409: {
			description: "MCP already installed",
			content: { "application/json": { schema: ErrorResponse } },
		},
		502: {
			description: "Registry unreachable",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
	tags: ["mcps"],
});

const uninstallRoute = createRoute({
	method: "delete",
	path: "/mcps/installed/:name",
	request: {
		params: McpNameParam,
		query: ConfigDirQuery,
	},
	responses: {
		200: {
			description: "MCP uninstalled",
			content: { "application/json": { schema: UninstallResponse } },
		},
		400: {
			description: "Invalid workspace",
			content: { "application/json": { schema: ErrorResponse } },
		},
		404: {
			description: "MCP not installed",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
	tags: ["mcps"],
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

app.openapi(searchRoute, async (c) => {
	const { q, cursor } = c.req.valid("query");
	try {
		const { servers, nextCursor } = await registry.search(q, { cursor });
		return c.json({ query: q, count: servers.length, nextCursor, servers }, 200);
	} catch (e) {
		if (e instanceof RegistryError) return c.json({ error: e.message }, 502);
		throw e;
	}
});

app.openapi(registryDetailRoute, async (c) => {
	const { name } = c.req.valid("param");
	const { version } = c.req.valid("query");
	try {
		const detail = await registry.getLatest(name, { version });
		return c.json(detail, 200);
	} catch (e) {
		if (e instanceof RegistryNotFoundError) return c.json({ error: e.message }, 404);
		if (e instanceof RegistryError) return c.json({ error: e.message }, 502);
		throw e;
	}
});

app.openapi(listInstalledRoute, async (c) => {
	const { configDir } = c.req.valid("query");
	try {
		const result = await mcpService.listInstalled(configDir);
		return c.json(result, 200);
	} catch (e) {
		if (e instanceof InvalidWorkspaceError) return c.json({ error: e.message }, 400);
		throw e;
	}
});

app.openapi(installedDetailRoute, async (c) => {
	const { name } = c.req.valid("param");
	const { configDir } = c.req.valid("query");
	try {
		const result = await mcpService.getInstalled(configDir, name);
		return c.json(result, 200);
	} catch (e) {
		if (e instanceof McpNotFoundError) return c.json({ error: e.message }, 404);
		if (e instanceof McpConfigError) return c.json({ error: e.message }, 400);
		if (e instanceof InvalidWorkspaceError) return c.json({ error: e.message }, 400);
		throw e;
	}
});

app.openapi(installRoute, async (c) => {
	const { name, version, target } = c.req.valid("json");
	const { configDir } = c.req.valid("query");
	try {
		const result = await mcpService.install(configDir, name, { version, target });
		return c.json(result, 200);
	} catch (e) {
		if (e instanceof McpAlreadyInstalledError) return c.json({ error: e.message }, 409);
		if (e instanceof RegistryNotFoundError) return c.json({ error: e.message }, 404);
		if (e instanceof RegistryError) return c.json({ error: e.message }, 502);
		if (e instanceof InvalidWorkspaceError) return c.json({ error: e.message }, 400);
		throw e;
	}
});

app.openapi(uninstallRoute, async (c) => {
	const { name } = c.req.valid("param");
	const { configDir } = c.req.valid("query");
	try {
		const result = await mcpService.uninstall(configDir, name);
		return c.json(result, 200);
	} catch (e) {
		if (e instanceof McpNotFoundError) return c.json({ error: e.message }, 404);
		if (e instanceof InvalidWorkspaceError) return c.json({ error: e.message }, 400);
		throw e;
	}
});

export { app as mcpRoutes };