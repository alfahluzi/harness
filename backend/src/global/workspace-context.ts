import { dirname } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface WorkspaceContext {
	id: string;
	root: string;
	cwd: string;
	configDir: string;
	globalConfigDir: string | null;
}

interface PunaConfigFile {
	id: string;
	version: number;
	globalConfigDir?: string;
}

export class InvalidWorkspaceError extends Error {}

export async function loadWorkspaceContext(configDir: string, cwd: string): Promise<WorkspaceContext> {
	const configPath = join(configDir, "config.json");
	if (!existsSync(configPath)) {
		throw new InvalidWorkspaceError(`Missing ${configPath}`);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(configPath, "utf8"));
	} catch (e) {
		throw new InvalidWorkspaceError(`Failed to parse ${configPath}: ${(e as Error).message}`);
	}
	const cfg = parsed as Partial<PunaConfigFile>;
	if (typeof cfg.id !== "string" || cfg.id.length === 0) {
		throw new InvalidWorkspaceError(`${configPath}: missing 'id'`);
	}
	if (typeof cfg.version !== "number") {
		throw new InvalidWorkspaceError(`${configPath}: missing 'version'`);
	}
	const globalConfigDir =
		typeof cfg.globalConfigDir === "string" && cfg.globalConfigDir.length > 0
			? cfg.globalConfigDir
			: null;
	return {
		id: cfg.id,
		root: dirname(configDir),
		cwd,
		configDir,
		globalConfigDir,
	};
}