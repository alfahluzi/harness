import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadWorkspaceContext, InvalidWorkspaceError } from "../../global/workspace-context";
import { mergeLayered, type LayeredEntry } from "../../global/workspace-scanner";
import type { AgentSummary, AgentDetailResponse } from "./schema";

const MARKER = "prompt.md";

interface AgentConf {
	name?: string;
	role?: string;
	temperature?: number;
	called?: string;
	tools?: { allow?: string[]; deny?: string[] };
	description?: string;
	providerId?: string;
	modelId?: string;
}

export class AgentNotFoundError extends Error {
	constructor(name: string) {
		super(`Agent not found: ${name}`);
	}
}

export class AgentService {
	async list(configDir: string): Promise<{
		workspaceId: string;
		globalConfigDir: string | null;
		agents: AgentSummary[];
	}> {
		const ctx = await loadWorkspaceContext(configDir, configDir);
		const localDir = join(configDir, "agents");
		const globalDir = ctx.globalConfigDir ? join(ctx.globalConfigDir, "agents") : null;
		const entries = await mergeLayered(localDir, globalDir, MARKER);
		const agents = await Promise.all(entries.map((e) => this.toSummary(e)));
		return {
			workspaceId: ctx.id,
			globalConfigDir: ctx.globalConfigDir,
			agents,
		};
	}

	async get(configDir: string, name: string): Promise<AgentDetailResponse> {
		const ctx = await loadWorkspaceContext(configDir, configDir);
		const localDir = join(configDir, "agents");
		const globalDir = ctx.globalConfigDir ? join(ctx.globalConfigDir, "agents") : null;
		const entries = await mergeLayered(localDir, globalDir, MARKER);
		const found = entries.find((e) => e.name === name);
		if (!found) throw new AgentNotFoundError(name);

		const conf = await this.readConf(found.dir);
		const prompt = await readFile(join(found.dir, MARKER), "utf8");

		return {
			name,
			source: found.source,
			resolvedDir: found.dir,
			description: conf.description ?? null,
			role: conf.role ?? null,
			temperature: conf.temperature ?? null,
			called: conf.called ?? null,
			tools: conf.tools
				? { allow: conf.tools.allow ?? [], deny: conf.tools.deny ?? [] }
				: null,
			providerId: conf.providerId ?? null,
			modelId: conf.modelId ?? null,
			prompt,
		};
	}

	private async toSummary(entry: LayeredEntry): Promise<AgentSummary> {
		const conf = await this.readConf(entry.dir);
		return {
			name: entry.name,
			source: entry.source,
			description: conf.description ?? null,
			role: conf.role ?? null,
			temperature: conf.temperature ?? null,
			called: conf.called ?? null,
			tools: conf.tools
				? { allow: conf.tools.allow ?? [], deny: conf.tools.deny ?? [] }
				: null,
			providerId: conf.providerId ?? null,
			modelId: conf.modelId ?? null,
		};
	}

	private async readConf(dir: string): Promise<AgentConf> {
		const p = join(dir, "conf.json");
		if (!existsSync(p)) return {};
		try {
			return JSON.parse(await readFile(p, "utf8")) as AgentConf;
		} catch {
			return {};
		}
	}
}