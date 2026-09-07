import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { expandTilde, findWorkspaceDirs } from "../../global/workspace-scanner";
import {
	DiscoverRootQuery,
	WorkspacesDiscoverResponse,
	ErrorResponse,
} from "./schema";

const MAX_DEPTH = 10;

async function readId(punaDir: string): Promise<string | null> {
	const cfgPath = join(punaDir, "config.json");
	if (!existsSync(cfgPath)) return null;
	try {
		const raw = await readFile(cfgPath, "utf8");
		const parsed = JSON.parse(raw) as { id?: unknown };
		return typeof parsed.id === "string" && parsed.id.length > 0 ? parsed.id : null;
	} catch {
		return null;
	}
}

const app = new OpenAPIHono();

const discoverRoute = createRoute({
	method: "get",
	path: "/workspaces/discover",
	request: { query: DiscoverRootQuery },
	responses: {
		200: {
			description: "Recursively scan a root for .puna/ workspaces",
			content: { "application/json": { schema: WorkspacesDiscoverResponse } },
		},
		500: {
			description: "Scan failed",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
	tags: ["workspaces"],
});

app.openapi(discoverRoute, async (c) => {
	const { root: rawRoot } = c.req.valid("query");
	const root = expandTilde(rawRoot ?? "~") || homedir();
	try {
		const paths = await findWorkspaceDirs(root, ".puna", { maxDepth: MAX_DEPTH });
		const workspaces = await Promise.all(
			paths.map(async (path) => ({ path, id: await readId(path) })),
		);
		return c.json({ root, workspaces }, 200);
	} catch (e) {
		return c.json({ error: (e as Error).message ?? "discover failed" }, 500);
	}
});

export { app as workspaceRoutes };