// Side-effect import: `@hono/zod-openapi` registers the `.openapi()` extension
// on the zod prototype. Importing for side effects ensures the extension is
// available whenever this module is loaded (including in tests that import
// this file directly without going through a `route.ts`).
import "@hono/zod-openapi";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared / path / param schemas (mirror mcps conventions)
// ---------------------------------------------------------------------------

export const ConfigDirQuery = z.object({
	configDir: z.string().min(1),
});

export const ProviderIdParam = z.object({
	id: z.string().min(1),
});

export const ProviderKind = z.enum(["openai", "anthropic", "google", "openrouter", "custom"]);
export type ProviderKind = z.infer<typeof ProviderKind>;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export const ProviderConnectBody = z.object({
	type: ProviderKind,
	apiKey: z.string().min(1),
	name: z.string().min(1).optional(),
	baseUrl: z.string().min(1).optional(),
	target: z.enum(["local", "global"]).optional(),
});
export type ProviderConnectInput = z.infer<typeof ProviderConnectBody>;

export const ProviderUpdateBody = z.object({
	name: z.string().min(1).optional(),
	apiKey: z.string().min(1).optional(),
	baseUrl: z.string().min(1).optional(),
});
export type ProviderUpdateInput = z.infer<typeof ProviderUpdateBody>;

export const ProviderTestBody = z.object({
	type: ProviderKind,
	apiKey: z.string().min(1).optional(),
	baseUrl: z.string().min(1).optional(),
});
export type ProviderTestInput = z.infer<typeof ProviderTestBody>;

// ---------------------------------------------------------------------------
// Public surface (raw apiKey never exposed)
// ---------------------------------------------------------------------------

export const ProviderSummary = z
	.object({
		id: z.string(),
		type: ProviderKind,
		name: z.string(),
		source: z.enum(["local", "global"]),
		baseUrl: z.string(),
		defaultModel: z.string(),
		hasApiKey: z.boolean(),
		createdAt: z.string(),
		updatedAt: z.string(),
	})
	.openapi("ProviderSummary");
export type ProviderSummary = z.infer<typeof ProviderSummary>;

export const ProviderDetail = ProviderSummary.extend({
	apiKeyMasked: z.string(),
}).openapi("ProviderDetail");
export type ProviderDetail = z.infer<typeof ProviderDetail>;

export const ProvidersListResponse = z
	.object({
		workspaceId: z.string(),
		globalConfigDir: z.string().nullable(),
		providers: z.array(ProviderSummary),
	})
	.openapi("ProvidersListResponse");
export type ProvidersListResponse = z.infer<typeof ProvidersListResponse>;

export const ProviderModel = z
	.object({
		providerId: z.string(),
		modelId: z.string(),
		name: z.string().nullable(),
	})
	.openapi("ProviderModel");
export type ProviderModel = z.infer<typeof ProviderModel>;

export const ProviderModelsResponse = z
	.object({
		providerId: z.string(),
		models: z.array(ProviderModel),
	})
	.openapi("ProviderModelsResponse");
export type ProviderModelsResponse = z.infer<typeof ProviderModelsResponse>;

export const ProviderTestResult = z
	.object({
		id: z.string(),
		ok: z.boolean(),
		latencyMs: z.number().nullable(),
		error: z.string().nullable(),
	})
	.openapi("ProviderTestResult");
export type ProviderTestResult = z.infer<typeof ProviderTestResult>;

export const ProviderDisconnectResponse = z
	.object({
		id: z.string(),
		disconnected: z.literal(true),
	})
	.openapi("ProviderDisconnectResponse");
export type ProviderDisconnectResponse = z.infer<typeof ProviderDisconnectResponse>;

export const ErrorResponse = z.object({ error: z.string() }).openapi("Error");
export type ErrorResponse = z.infer<typeof ErrorResponse>;
