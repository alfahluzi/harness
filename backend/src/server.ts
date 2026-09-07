import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { StreamableHTTPTransport } from "@hono/mcp";
import { buildMcpServer } from "./server.mcp";
import { sessionRoutes } from "./modules/sessions/route";
import { SessionService } from "./modules/sessions/service";
import { agentRoutes } from "./modules/agents/route";
import { skillRoutes } from "./modules/skills/route";
import { mcpRoutes } from "./modules/mcps/route";
import { workspaceRoutes } from "./modules/workspaces/route";
import { providerRoutes } from "./modules/providers/route";

const app = new OpenAPIHono();

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

app.doc("/doc", {
	openapi: "3.0.0",
	info: { title: "backend", version: "0.1.0", description: "Hono API" },
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

process.on("SIGINT", async () => {
	const sessionService = new SessionService();
	await sessionService.cancelAll();
	process.exit(0);
});

process.on("SIGTERM", async () => {
	const sessionService = new SessionService();
	await sessionService.cancelAll();
	process.exit(0);
});

const port = Number(process.env.PORT ?? 3001);

export default {
	port,
	fetch: app.fetch,
};

console.log(`backend listening on http://localhost:${port} (docs: /doc)`);
