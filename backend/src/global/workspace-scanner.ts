import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export type LayerSource = "local" | "global";

export interface LayeredEntry {
	name: string;
	source: LayerSource;
	dir: string;
}

export async function scanLayer(dir: string | null, marker: string): Promise<Set<string>> {
	if (!dir || !existsSync(dir)) return new Set();
	const names = new Set<string>();
	for (const e of await readdir(dir, { withFileTypes: true })) {
		if (!e.isDirectory()) continue;
		if (existsSync(join(dir, e.name, marker))) names.add(e.name);
	}
	return names;
}

export async function mergeLayered(
	localDir: string | null,
	globalDir: string | null,
	marker: string,
): Promise<LayeredEntry[]> {
	const localNames = await scanLayer(localDir, marker);
	const globalNames = await scanLayer(globalDir, marker);

	const merged = new Map<string, LayeredEntry>();
	if (globalDir) {
		for (const name of globalNames) {
			merged.set(name, { name, source: "global", dir: join(globalDir, name) });
		}
	}
	if (localDir) {
		for (const name of localNames) {
			merged.set(name, { name, source: "local", dir: join(localDir, name) });
		}
	}

	return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function resolveSource(
	localDir: string | null,
	globalDir: string | null,
	name: string,
	marker: string,
): { source: LayerSource; dir: string } | null {
	const localPath = localDir ? join(localDir, name) : null;
	if (localPath && existsSync(join(localPath, marker))) {
		return { source: "local", dir: localPath };
	}
	const globalPath = globalDir ? join(globalDir, name) : null;
	if (globalPath && existsSync(join(globalPath, marker))) {
		return { source: "global", dir: globalPath };
	}
	return null;
}