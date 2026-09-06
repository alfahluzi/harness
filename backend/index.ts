import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { logger } from "hono/logger";
import { cors } from "hono/cors";

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

const port = Number(process.env.PORT ?? 3001);

export default {
	port,
	fetch: app.fetch,
};

console.log(`backend listening on http://localhost:${port} (docs: /doc)`);
