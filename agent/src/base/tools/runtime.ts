import type { StructuredTool } from "@langchain/core/tools";
import { getAllToolsAsync, type ToolsConfig } from "./index.js";

const DEFAULT_TOOLS_CONFIG: ToolsConfig = {
	file: { rootDir: process.cwd(), readOnly: false },
	http: { allowedHosts: [] },
	sql: { connectionString: ":memory:", allowedTables: [] },
};

export interface RuntimeConfigLike {
	allowedTools: string[];
	deniedTools: string[];
}

export async function buildRuntimeTools(
	cfg: RuntimeConfigLike,
): Promise<StructuredTool[]> {
	return getAllToolsAsync(DEFAULT_TOOLS_CONFIG, {
		allow: cfg.allowedTools,
		deny: cfg.deniedTools,
	});
}
