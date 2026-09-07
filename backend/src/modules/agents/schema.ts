import { z } from "zod";

export const ConfigDirQuery = z.object({
	configDir: z.string().min(1),
});

export const AgentNameParam = z.object({
	name: z.string().min(1),
});

const ToolsSchema = z.object({
	allow: z.array(z.string()),
	deny: z.array(z.string()),
});
export type Tools = z.infer<typeof ToolsSchema>;

export const AgentSummary = z
	.object({
		name: z.string(),
		source: z.enum(["local", "global"]),
		description: z.string().nullable(),
		role: z.string().nullable(),
		temperature: z.number().nullable(),
		called: z.string().nullable(),
		tools: ToolsSchema.nullable(),
	})
	.openapi("AgentSummary");
export type AgentSummary = z.infer<typeof AgentSummary>;

export const AgentsListResponse = z
	.object({
		workspaceId: z.string(),
		globalConfigDir: z.string().nullable(),
		agents: z.array(AgentSummary),
	})
	.openapi("AgentsListResponse");
export type AgentsListResponse = z.infer<typeof AgentsListResponse>;

export const AgentDetailResponse = z
	.object({
		name: z.string(),
		source: z.enum(["local", "global"]),
		resolvedDir: z.string(),
		description: z.string().nullable(),
		role: z.string().nullable(),
		temperature: z.number().nullable(),
		called: z.string().nullable(),
		tools: ToolsSchema.nullable(),
		prompt: z.string(),
	})
	.openapi("AgentDetailResponse");
export type AgentDetailResponse = z.infer<typeof AgentDetailResponse>;

export const ErrorResponse = z.object({ error: z.string() }).openapi("Error");
export type ErrorResponse = z.infer<typeof ErrorResponse>;