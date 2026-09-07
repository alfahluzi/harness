import { z } from "zod";

export const ConfigDirQuery = z.object({
	configDir: z.string().min(1),
});

export const SkillNameParam = z.object({
	name: z.string().min(1),
});

const ScriptInfo = z.object({
	name: z.string(),
	path: z.string(),
});
export type ScriptInfo = z.infer<typeof ScriptInfo>;

export const SkillSummary = z
	.object({
		name: z.string(),
		source: z.enum(["local", "global"]),
		description: z.string().nullable(),
		scriptCount: z.number(),
	})
	.openapi("SkillSummary");
export type SkillSummary = z.infer<typeof SkillSummary>;

export const SkillsListResponse = z
	.object({
		workspaceId: z.string(),
		globalConfigDir: z.string().nullable(),
		skills: z.array(SkillSummary),
	})
	.openapi("SkillsListResponse");
export type SkillsListResponse = z.infer<typeof SkillsListResponse>;

export const SkillDetailResponse = z
	.object({
		name: z.string(),
		source: z.enum(["local", "global"]),
		resolvedDir: z.string(),
		description: z.string().nullable(),
		scripts: z.array(ScriptInfo),
	})
	.openapi("SkillDetailResponse");
export type SkillDetailResponse = z.infer<typeof SkillDetailResponse>;

export const ErrorResponse = z.object({ error: z.string() }).openapi("Error");
export type ErrorResponse = z.infer<typeof ErrorResponse>;