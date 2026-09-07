import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ProviderRepository } from "../modules/providers/provider-repository";
import { GLOBAL_WORKSPACE_ID } from "../models/providers";

export class AgentRuntimeError extends Error {}

export interface AgentRuntimeConfig {
	configurable: {
		agent_name: string;
		provider_name: string;
		provider_url: string;
		api_key: string;
		model_name: string;
		system_prompt: string;
	};
}

interface AgentConf {
	providerId?: string;
	modelId?: string;
}

async function readProfile(
	configDir: string,
	agentProfile: string,
): Promise<{ prompt: string; conf: AgentConf }> {
	const dir = join(configDir, "agents", agentProfile);
	const prompt = await readFile(join(dir, "prompt.md"), "utf8");
	let conf: AgentConf = {};
	try {
		conf = JSON.parse(
			await readFile(join(dir, "conf.json"), "utf8"),
		) as AgentConf;
	} catch {
		conf = {};
	}
	return { prompt, conf };
}

export async function resolveAgentRuntimeConfig(
	configDir: string,
	agentProfile: string,
	workspaceId: string,
	repo: ProviderRepository = new ProviderRepository(),
): Promise<AgentRuntimeConfig> {
	const { prompt, conf } = await readProfile(configDir, agentProfile);

	const providerId = conf.providerId?.trim();
	if (!providerId) {
		throw new AgentRuntimeError(
			`agent profile ${agentProfile} missing providerId`,
		);
	}

	const provider =
		repo.get(providerId, workspaceId) ??
		repo.get(providerId, GLOBAL_WORKSPACE_ID);
	if (!provider) {
		throw new AgentRuntimeError(`provider not connected: ${providerId}`);
	}

	const modelName = conf.modelId?.trim() || provider.defaultModel;

	return {
		configurable: {
			agent_name: agentProfile,
			provider_name: provider.name,
			provider_url: provider.baseUrl,
			api_key: provider.apiKey,
			model_name: modelName,
			system_prompt: prompt,
		},
	};
}
