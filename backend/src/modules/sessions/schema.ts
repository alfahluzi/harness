import { z } from "zod";

export const CreateSessionInput = z.object({
	workspaceId: z.string().min(1),
	parent: z.string().optional(),
	description: z.string().min(1),
	prompt: z.string().min(1),
	agentProfile: z.string().default("semar"),
	background: z.boolean().default(true),
	configDir: z.string().min(1),
	model: z.string().optional(),
});

export const SessionIdInput = z.object({
	id: z.string(),
});

export const SendMessageInput = z.object({
	id: z.string(),
	message: z.string().min(1),
	configDir: z.string().min(1),
	agentProfile: z.string().optional(),
	model: z.string().optional(),
});

export const StreamMessageInput = z.object({
	message: z.string().min(1),
	configDir: z.string().min(1),
	agentProfile: z.string().optional(),
	model: z.string().optional(),
});
