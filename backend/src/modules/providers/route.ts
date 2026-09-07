import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { InvalidWorkspaceError } from "../../global/workspace-context";
import {
	ProviderService,
	ProviderNotFoundError,
	ProviderAlreadyConnectedError,
	ProviderConfigError,
} from "./service";
import {
	ConfigDirQuery,
	ProviderIdParam,
	ProviderConnectBody,
	ProviderUpdateBody,
	ProviderTestBody,
	ProviderDetail,
	ProvidersListResponse,
	ProviderModelsResponse,
	ProviderTestResult,
	ProviderDisconnectResponse,
	ErrorResponse,
} from "./schema";

const providerService = new ProviderService();
const app = new OpenAPIHono();

const listRoute = createRoute({
	method: "get",
	path: "/providers",
	request: { query: ConfigDirQuery },
	responses: {
		200: {
			description: "List connected LLM providers (local + global, local wins)",
			content: { "application/json": { schema: ProvidersListResponse } },
		},
		400: {
			description: "Invalid workspace",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
	tags: ["providers"],
});

const detailRoute = createRoute({
	method: "get",
	path: "/providers/:id",
	request: {
		params: ProviderIdParam,
		query: ConfigDirQuery,
	},
	responses: {
		200: {
			description: "Connected provider detail (apiKey masked)",
			content: { "application/json": { schema: ProviderDetail } },
		},
		400: {
			description: "Invalid workspace",
			content: { "application/json": { schema: ErrorResponse } },
		},
		404: {
			description: "Provider not connected",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
	tags: ["providers"],
});

const modelsRoute = createRoute({
	method: "get",
	path: "/providers/:id/models",
	request: {
		params: ProviderIdParam,
		query: ConfigDirQuery,
	},
	responses: {
		200: {
			description: "Available models for a connected provider (from provider_models table)",
			content: { "application/json": { schema: ProviderModelsResponse } },
		},
		400: {
			description: "Invalid workspace",
			content: { "application/json": { schema: ErrorResponse } },
		},
		404: {
			description: "Provider not connected",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
	tags: ["providers"],
});

const testRoute = createRoute({
	method: "post",
	path: "/providers/test",
	request: {
		body: { content: { "application/json": { schema: ProviderTestBody } } },
		query: ConfigDirQuery,
	},
	responses: {
		200: {
			description: "Live credential test result (ok reflects success, never a 5xx)",
			content: { "application/json": { schema: ProviderTestResult } },
		},
		400: {
			description: "Invalid workspace or unknown provider kind",
			content: { "application/json": { schema: ErrorResponse } },
		},
		404: {
			description: "Provider not connected (when testing stored key)",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
	tags: ["providers"],
});

const connectRoute = createRoute({
	method: "post",
	path: "/providers/connect",
	request: {
		body: { content: { "application/json": { schema: ProviderConnectBody } } },
		query: ConfigDirQuery,
	},
	responses: {
		200: {
			description: "Provider connected (models synced from /models endpoint)",
			content: { "application/json": { schema: ProviderDetail } },
		},
		400: {
			description: "Invalid workspace or invalid connect body",
			content: { "application/json": { schema: ErrorResponse } },
		},
		409: {
			description: "Provider of that kind already connected",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
	tags: ["providers"],
});

const updateRoute = createRoute({
	method: "put",
	path: "/providers/:id",
	request: {
		params: ProviderIdParam,
		body: { content: { "application/json": { schema: ProviderUpdateBody } } },
		query: ConfigDirQuery,
	},
	responses: {
		200: {
			description: "Provider updated (models re-synced)",
			content: { "application/json": { schema: ProviderDetail } },
		},
		400: {
			description: "Invalid workspace or invalid update body",
			content: { "application/json": { schema: ErrorResponse } },
		},
		404: {
			description: "Provider not connected",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
	tags: ["providers"],
});

const disconnectRoute = createRoute({
	method: "delete",
	path: "/providers/:id",
	request: {
		params: ProviderIdParam,
		query: ConfigDirQuery,
	},
	responses: {
		200: {
			description: "Provider disconnected (models removed)",
			content: { "application/json": { schema: ProviderDisconnectResponse } },
		},
		400: {
			description: "Invalid workspace",
			content: { "application/json": { schema: ErrorResponse } },
		},
		404: {
			description: "Provider not connected",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
	tags: ["providers"],
});

app.openapi(listRoute, async (c) => {
	const { configDir } = c.req.valid("query");
	try {
		const result = await providerService.list(configDir);
		return c.json(result, 200);
	} catch (e) {
		if (e instanceof InvalidWorkspaceError) return c.json({ error: e.message }, 400);
		throw e;
	}
});

app.openapi(detailRoute, async (c) => {
	const { id } = c.req.valid("param");
	const { configDir } = c.req.valid("query");
	try {
		const result = await providerService.get(configDir, id);
		return c.json(result, 200);
	} catch (e) {
		if (e instanceof ProviderNotFoundError) return c.json({ error: e.message }, 404);
		if (e instanceof ProviderConfigError) return c.json({ error: e.message }, 400);
		if (e instanceof InvalidWorkspaceError) return c.json({ error: e.message }, 400);
		throw e;
	}
});

app.openapi(modelsRoute, async (c) => {
	const { id } = c.req.valid("param");
	const { configDir } = c.req.valid("query");
	try {
		const result = await providerService.models(configDir, id);
		return c.json(result, 200);
	} catch (e) {
		if (e instanceof ProviderNotFoundError) return c.json({ error: e.message }, 404);
		if (e instanceof InvalidWorkspaceError) return c.json({ error: e.message }, 400);
		throw e;
	}
});

app.openapi(testRoute, async (c) => {
	const body = c.req.valid("json");
	const { configDir } = c.req.valid("query");
	try {
		const result = await providerService.testCredentials(configDir, body);
		return c.json(result, 200);
	} catch (e) {
		if (e instanceof ProviderNotFoundError) return c.json({ error: e.message }, 404);
		if (e instanceof ProviderConfigError) return c.json({ error: e.message }, 400);
		if (e instanceof InvalidWorkspaceError) return c.json({ error: e.message }, 400);
		throw e;
	}
});

app.openapi(connectRoute, async (c) => {
	const body = c.req.valid("json");
	const { configDir } = c.req.valid("query");
	try {
		const result = await providerService.connect(configDir, body);
		return c.json(result, 200);
	} catch (e) {
		if (e instanceof ProviderAlreadyConnectedError) return c.json({ error: e.message }, 409);
		if (e instanceof ProviderConfigError) return c.json({ error: e.message }, 400);
		if (e instanceof InvalidWorkspaceError) return c.json({ error: e.message }, 400);
		throw e;
	}
});

app.openapi(updateRoute, async (c) => {
	const { id } = c.req.valid("param");
	const body = c.req.valid("json");
	const { configDir } = c.req.valid("query");
	try {
		const result = await providerService.update(configDir, id, body);
		return c.json(result, 200);
	} catch (e) {
		if (e instanceof ProviderNotFoundError) return c.json({ error: e.message }, 404);
		if (e instanceof ProviderConfigError) return c.json({ error: e.message }, 400);
		if (e instanceof InvalidWorkspaceError) return c.json({ error: e.message }, 400);
		throw e;
	}
});

app.openapi(disconnectRoute, async (c) => {
	const { id } = c.req.valid("param");
	const { configDir } = c.req.valid("query");
	try {
		const result = await providerService.disconnect(configDir, id);
		return c.json(result, 200);
	} catch (e) {
		if (e instanceof ProviderNotFoundError) return c.json({ error: e.message }, 404);
		if (e instanceof InvalidWorkspaceError) return c.json({ error: e.message }, 400);
		throw e;
	}
});

export { app as providerRoutes };
