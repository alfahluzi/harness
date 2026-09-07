import { z } from "zod";

export const CreateSessionInput = z.object({
	workspaceId: z.string().min(1),
	parent: z.string().optional(),
	description: z.string().min(1),
	prompt: z.string().min(1),
	agentProfile: z.string().default("main-agent"),
	background: z.boolean().default(true),
	configDir: z.string().min(1),
});

export const SessionIdInput = z.object({
	id: z.string(),
});

export const SendMessageInput = z.object({
	id: z.string(),
	message: z.string().min(1),
	configDir: z.string().min(1),
});
