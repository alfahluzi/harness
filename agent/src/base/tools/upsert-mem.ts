import { LangGraphRunnableConfig } from "@langchain/langgraph";
import { ensureConfiguration } from "../.libs/configuration.js";
import { v4 as uuidv4 } from "uuid";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getStoreFromConfigOrThrow } from "../.libs/utils.js";

/**
 * Upsert a memory in the database.
 * @param content The main content of the memory.
 * @param context Additional context for the memory.
 * @param memoryId Optional ID to overwrite an existing memory.
 * @returns A string confirming the memory storage.
 */
async function upsertMemory(
	opts: {
		content: string;
		context: string;
		memoryId?: string;
	},
	config: LangGraphRunnableConfig,
): Promise<string> {
	const { content, context, memoryId } = opts;
	const store = getStoreFromConfigOrThrow(config);
	const configurable = ensureConfiguration(config);
	const memId = memoryId || uuidv4();

	await store.put(["memories", configurable.userId], memId, {
		content,
		context,
	});

	return `Stored memory ${memId}`;
}

export function upsertMemoryTool(config: LangGraphRunnableConfig) {
	return tool(
		(opts: { content: string; context: string; memoryId?: string }) =>
			upsertMemory(opts, config),
		{
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
		},
	);
}