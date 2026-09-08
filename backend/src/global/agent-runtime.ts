import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	ProviderRepository,
	type ProviderRecord,
} from "../modules/providers/provider-repository";
import { ProviderModelRepository } from "../modules/providers/repository";
import { GLOBAL_WORKSPACE_ID } from "../models/providers";
import {
	loadWorkspaceContext,
	InvalidWorkspaceError,
} from "./workspace-context";
import { resolveSource } from "./workspace-scanner";

export class AgentRuntimeError extends Error {}

export interface AgentRuntimeConfig {
	configurable: {
		agent_name: string;
		provider_name: string;
		provider_url: string;
		api_key: string;
		model_name: string;
		system_prompt: string;
		allowed_tools: string[];
		denied_tools: string[];
	};
}

interface AgentConf {
	providerId?: string;
	modelId?: string;
	tools?: { allow?: string[]; deny?: string[] };
}

async function readProfile(dir: string): Promise<{ prompt: string; conf: AgentConf }> {
	let prompt: string;
	try {
		prompt = await readFile(join(dir, "prompt.md"), "utf8");
	} catch {
		// prompt.md is the layer marker, so it should exist; surface a clear
		// error instead of a raw ENOENT 500 if it somehow fails to read.
		throw new AgentRuntimeError(`failed to read agent profile: ${dir}`);
	}
	let conf: AgentConf = {};
	try {
		conf = JSON.parse(await readFile(join(dir, "conf.json"), "utf8")) as AgentConf;
	} catch {
		conf = {};
	}
	return { prompt, conf };
}

function firstConnectedProvider(
	repo: ProviderRepository,
	workspaceId: string,
): ProviderRecord | null {
	const rows = repo.listForWorkspace(workspaceId);
	// local wins: row workspace lebih berhak daripada row global untuk id sama
	const byId = new Map<string, ProviderRecord>();
	for (const r of rows) {
		const existing = byId.get(r.id);
		if (!existing || existing.workspaceId !== GLOBAL_WORKSPACE_ID) {
			byId.set(r.id, r);
		}
	}
	return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))[0] ?? null;
}

function firstModelForProvider(
	modelRepo: ProviderModelRepository,
	provider: ProviderRecord,
): string {
	const records = modelRepo.listByProvider(provider.workspaceId, provider.id);
	return records[0]?.modelId ?? "";
}

export async function resolveAgentRuntimeConfig(
	configDir: string,
	agentProfile: string,
	repo: ProviderRepository = new ProviderRepository(),
	opts?: { model?: string },
	modelRepo: ProviderModelRepository = new ProviderModelRepository(),
): Promise<AgentRuntimeConfig> {
	let ctx;
	try {
		ctx = await loadWorkspaceContext(configDir, configDir);
	} catch (e) {
		if (e instanceof InvalidWorkspaceError) {
			throw new AgentRuntimeError(`invalid workspace: ${e.message}`);
		}
		throw e;
	}

	const localDir = join(configDir, "agents");
	const globalDir = ctx.globalConfigDir
		? join(ctx.globalConfigDir, "agents")
		: null;
	const resolved = resolveSource(localDir, globalDir, agentProfile, "prompt.md");
	if (!resolved) {
		throw new AgentRuntimeError(`agent profile not found: ${agentProfile}`);
	}

	const { prompt, conf } = await readProfile(resolved.dir);

	const confProviderId = conf.providerId?.trim();
	let provider: ProviderRecord | null = null;
	if (confProviderId) {
		provider =
			repo.get(confProviderId, ctx.id) ??
			repo.get(confProviderId, GLOBAL_WORKSPACE_ID);
		if (!provider) {
			throw new AgentRuntimeError(`provider not connected: ${confProviderId}`);
		}
	} else {
		// Agent tidak declare providerId: resolve dari model yang dikirim,
		// lalu fallback ke provider pertama yang connect.
		const modelName = opts?.model?.trim() || conf.modelId?.trim();
		if (modelName) {
			const hits = modelRepo.listProvidersByModel(ctx.id, modelName);
			for (const hit of hits) {
				const candidate = repo.get(hit.providerId, hit.workspaceId);
				if (candidate) {
					provider = candidate;
					break;
				}
			}
		}
		if (!provider) provider = firstConnectedProvider(repo, ctx.id);
		if (!provider) {
			throw new AgentRuntimeError(
				`agent profile ${agentProfile} missing providerId and no provider is connected`,
			);
		}
	}

	const requestedModel = opts?.model?.trim() || conf.modelId?.trim();
	const modelName =
		requestedModel ||
		provider.defaultModel ||
		firstModelForProvider(modelRepo, provider);

	return {
		configurable: {
			agent_name: agentProfile,
			provider_name: provider.name,
			provider_url: provider.baseUrl,
			api_key: provider.apiKey,
			model_name: modelName,
			system_prompt: prompt,
			allowed_tools: conf.tools?.allow ?? [],
			denied_tools: conf.tools?.deny ?? [],
		},
	};
}