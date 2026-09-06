import { z } from "zod";

export const CreateSessionInput = z.object({
	parent: z.string().optional(),
	description: z.string().min(1),
	prompt: z.string().min(1),
	agentProfile: z.string().default("main-agent"),
	background: z.boolean().default(true),
});

export const TaskIdInput = z.object({
	id: z.string(),
});

export const SendMessageInput = z.object({
	id: z.string(),
	message: z.string().min(1),
});