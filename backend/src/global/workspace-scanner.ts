import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type LayerSource = "local" | "global";

export interface LayeredEntry {
	name: string;
	source: LayerSource;
	dir: string;
}

const DEFAULT_IGNORED_DIRS = new Set([
	"node_modules",
	".git",
	".cache",
	"dist",
	"build",
	".next",
	".nuxt",
	"target",
	".venv",
	"venv",
	"__pycache__",
	".pnpm",
	".turbo",
	".parcel-cache",
	".idea",
	".vscode",
]);

export function expandTilde(p: string): string {
	if (p === "~") return homedir();
	if (p.startsWith("~/") || p.startsWith("~\\")) return join(homedir(), p.slice(2));
	return p;
}

export interface FindWorkspaceOptions {
	maxDepth?: number;
	ignoreDirs?: Set<string>;
}

export async function findWorkspaceDirs(
	root: string,
	marker = ".puna",
	opts: FindWorkspaceOptions = {},
): Promise<string[]> {
	const maxDepth = opts.maxDepth ?? 10;
	const ignoreDirs = opts.ignoreDirs ?? DEFAULT_IGNORED_DIRS;
	const expanded = expandTilde(root);
	if (!existsSync(expanded)) return [];

	const results: string[] = [];
	const queue: Array<{ dir: string; depth: number }> = [{ dir: expanded, depth: 0 }];

	while (queue.length > 0) {
		const { dir, depth } = queue.shift()!;
		if (depth >= maxDepth) continue;

		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			// permission denied, EIO, ENOTDIR, etc. — skip this branch silently
			continue;
		}

		for (const e of entries) {
			// Symlinks are skipped to avoid loops; users wanting symlink-following
			// can opt-in later. A .puna symlink still won't be followed.
			if (e.isSymbolicLink()) continue;
			if (!e.isDirectory()) continue;

			const full = join(dir, e.name);

			if (e.name === marker) {
				results.push(full);
				continue; // do not descend into a found workspace
			}

			if (e.name.startsWith(".")) continue;
			if (ignoreDirs.has(e.name)) continue;

			queue.push({ dir: full, depth: depth + 1 });
		}
	}

	return results.sort();
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