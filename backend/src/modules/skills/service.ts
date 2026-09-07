import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { loadWorkspaceContext, InvalidWorkspaceError } from "../../global/workspace-context";
import { mergeLayered, type LayeredEntry } from "../../global/workspace-scanner";
import type { SkillSummary, SkillDetailResponse } from "./schema";

const MARKER = "desc.md";

export class SkillNotFoundError extends Error {
	constructor(name: string) {
		super(`Skill not found: ${name}`);
	}
}

export class SkillService {
	async list(configDir: string): Promise<{
		workspaceId: string;
		globalConfigDir: string | null;
		skills: SkillSummary[];
	}> {
		const ctx = await loadWorkspaceContext(configDir, configDir);
		const localDir = join(configDir, "skills");
		const globalDir = ctx.globalConfigDir ? join(ctx.globalConfigDir, "skills") : null;
		const entries = await mergeLayered(localDir, globalDir, MARKER);
		const skills = await Promise.all(entries.map((e) => this.toSummary(e)));
		return {
			workspaceId: ctx.id,
			globalConfigDir: ctx.globalConfigDir,
			skills,
		};
	}

	async get(configDir: string, name: string): Promise<SkillDetailResponse> {
		const ctx = await loadWorkspaceContext(configDir, configDir);
		const localDir = join(configDir, "skills");
		const globalDir = ctx.globalConfigDir ? join(ctx.globalConfigDir, "skills") : null;
		const entries = await mergeLayered(localDir, globalDir, MARKER);
		const found = entries.find((e) => e.name === name);
		if (!found) throw new SkillNotFoundError(name);

		const description = await this.readDesc(found.dir);
		const scripts = await this.listScripts(found.dir);

		return {
			name,
			source: found.source,
			resolvedDir: found.dir,
			description,
			scripts,
		};
	}

	private async toSummary(entry: LayeredEntry): Promise<SkillSummary> {
		const description = await this.readDesc(entry.dir);
		const scriptCount = await this.countScripts(entry.dir);
		return {
			name: entry.name,
			source: entry.source,
			description,
			scriptCount,
		};
	}

	private async readDesc(dir: string): Promise<string | null> {
		const p = join(dir, MARKER);
		if (!existsSync(p)) return null;
		return await readFile(p, "utf8");
	}

	private async countScripts(dir: string): Promise<number> {
		const scriptsDir = join(dir, "scripts");
		if (!existsSync(scriptsDir)) return 0;
		const entries = await readdir(scriptsDir, { withFileTypes: true });
		return entries.filter((e) => e.isFile()).length;
	}

	private async listScripts(dir: string): Promise<Array<{ name: string; path: string }>> {
		const scriptsDir = join(dir, "scripts");
		if (!existsSync(scriptsDir)) return [];
		const entries = await readdir(scriptsDir, { withFileTypes: true });
		return entries
			.filter((e) => e.isFile())
			.map((e) => ({ name: e.name, path: join(scriptsDir, e.name) }))
			.sort((a, b) => a.name.localeCompare(b.name));
	}
}