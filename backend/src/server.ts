import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { StreamableHTTPTransport } from "@hono/mcp";
import { buildMcpServer } from "./server.mcp";
import {
	sessionRoutes,
	setStreamBusWorkspaceResolver,
} from "./modules/sessions/route";
import { SessionService } from "./modules/sessions/service";
import { agentRoutes } from "./modules/agents/route";
import { skillRoutes } from "./modules/skills/route";
import { mcpRoutes } from "./modules/mcps/route";
import { workspaceRoutes } from "./modules/workspaces/route";
import { providerRoutes } from "./modules/providers/route";

const app = new OpenAPIHono();

// Wire the SSE workspace filter once on boot (stream-bus must not import
// modules, so the session→workspace lookup is injected here).
const sessionService = new SessionService();
setStreamBusWorkspaceResolver((id) => sessionService.getSessionWorkspace(id));

app.use("*", logger());
app.use("*", cors());

const RootSchema = z
	.object({
		name: z.string(),
		runtime: z.string(),
		hono: z.string(),
		ok: z.boolean(),
	})
	.openapi("Root");

const HealthSchema = z
	.object({
		status: z.literal("ok"),
		uptime: z.number(),
	})
	.openapi("Health");

const rootRoute = createRoute({
	method: "get",
	path: "/",
	responses: {
		200: {
			description: "Service metadata",
			content: { "application/json": { schema: RootSchema } },
		},
	},
	tags: ["meta"],
});

const healthRoute = createRoute({
	method: "get",
	path: "/health",
	responses: {
		200: {
			description: "Liveness probe",
			content: { "application/json": { schema: HealthSchema } },
		},
	},
	tags: ["meta"],
});

app.openapi(rootRoute, (c) =>
	c.json({ name: "backend", runtime: "bun", hono: "4.x", ok: true }, 200),
);

app.openapi(healthRoute, (c) =>
	c.json({ status: "ok", uptime: process.uptime() }, 200),
);

// @hono/zod-openapi's `.route()` fails to convert `:param` -> `{param}` for
// routes inside mounted sub-apps, so the raw OpenAPI document uses Hono-style
// colon paths (`/providers/:id`). The frontend @hey-api client only substitutes
// curly-brace params (`{id}`), so those colon paths break path interpolation
// (requests go out as literal `/providers/:id` -> 404). Normalize here.
function toCurlyPathParams(path: string): string {
	return path.replaceAll(/:([^/]+)/g, "{$1}");
}

// Replace app.doc() with a route that normalizes path params to OpenAPI
// curly-brace syntax before serving the spec.
app.get("/doc", (c) => {
	const document = app.getOpenAPIDocument({
		openapi: "3.0.0",
		info: { title: "backend", version: "0.1.0", description: "Hono API" },
	});
	document.paths = Object.fromEntries(
		Object.entries(document.paths).map(([p, v]) => [toCurlyPathParams(p), v]),
	);
	return c.json(document);
});

// REST surface for SessionService (debug / frontend use)
app.route("/api", sessionRoutes);
app.route("/api", agentRoutes);
app.route("/api", skillRoutes);
app.route("/api", mcpRoutes);
app.route("/api", workspaceRoutes);
app.route("/api", providerRoutes);

// MCP Streamable HTTP surface for the same SessionService instance
const mcpServer = buildMcpServer();
const mcpTransport = new StreamableHTTPTransport();
app.all("/mcp", async (c) => {
	if (!mcpServer.isConnected()) {
		await mcpServer.connect(mcpTransport);
	}
	return mcpTransport.handleRequest(c);
});

async function shutdown(signal: string) {
	console.log(`received ${signal}, cancelling active sessions...`);
	try {
		await sessionService.cancelAll();
	} catch (e) {
		console.error(`cancelAll failed during ${signal} shutdown:`, e);
	}
	process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

const port = Number(process.env.PORT ?? 3001);

export default {
	port,
	fetch: app.fetch,
};

console.log(`backend listening on http://localhost:${port} (docs: /doc)`);
