import { tool, type ToolRuntime } from "@langchain/core/tools";
import { ensureConfiguration } from "../.libs/configuration.js";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { getStoreFromConfigOrThrow } from "../.libs/utils.js";

/**
 * Upsert a memory in the database.
 * Reads runtime context (store, configurable) from ToolRuntime so the tool
 * can be instantiated once and reused by ToolNode.
 */
async function upsertMemory(
	opts: {
		content: string;
		context: string;
		memoryId?: string;
	},
	runtime: ToolRuntime,
): Promise<string> {
	const { content, context, memoryId } = opts;
	const store = getStoreFromConfigOrThrow(runtime.config);
	const configurable = ensureConfiguration(runtime.config);
	const memId = memoryId || uuidv4();

	await store.put(["memories", configurable.userId], memId, {
		content,
		context,
	});

	return `Stored memory ${memId}`;
}

export const upsertMemoryTool = tool(upsertMemory, {
	name: "upsertMemory",
	description:
		"Upsert a memory in the database. If a memory conflicts with an existing one, \
    update the existing one by passing in the memory_id instead of creating a duplicate. \
    If the user corrects a memory, update it. Can call multiple times in parallel \
    if you need to store or update multiple memories.",
	schema: z.object({
		content: z.string().describe(
			"The main content of the memory. For example: \
      'User expressed interest in learning about French.'",
		),
		context: z.string().describe(
			"Additional context for the memory. For example: \
      'This was mentioned while discussing career options in Europe.'",
		),
		memoryId: z
			.string()
			.optional()
			.describe(
				"The memory ID to overwrite. Only provide if updating an existing memory.",
			),
	}),
});
