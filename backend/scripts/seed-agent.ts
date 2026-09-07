// Seed a workspace + agent profile + connected provider for manual runtime
// testing.
//
// Prereqs:
//   - Jalankan `bun run db:push` dulu supaya tabel providers ada.
//
// Usage (env vars):
//   CONFIG_DIR       (required) path to the .puna config dir
//   AGENT_NAME       (required) agent profile name (folder under agents/)
//   PROVIDER_TYPE    (required) openai | anthropic | google | openrouter | custom
//   API_KEY          (required) provider API key
//   MODEL_ID         (optional) model override; defaults to provider defaultModel
//   BASE_URL         (optional) provider base URL override
//   TARGET           (optional) local | global (default local)
//   DESCRIPTION      (optional) agent description written to conf.json
//   GLOBAL_CONFIG_DIR (optional) globalConfigDir entry written to config.json
//
// Example:
//   CONFIG_DIR=./.puna AGENT_NAME=coder PROVIDER_TYPE=openai \
//   API_KEY=sk-... MODEL_ID=gpt-4o bun run scripts/seed-agent.ts

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadWorkspaceContext } from "../src/global/workspace-context";
import {
	ProviderService,
	ProviderAlreadyConnectedError,
} from "../src/modules/providers/service";

const PROVIDER_TYPES = ["openai", "anthropic", "google", "openrouter", "custom"] as const;

function env(name: string): string | undefined {
	return process.env[name]?.trim() || undefined;
}

function requireEnv(name: string): string {
	const v = env(name);
	if (!v) {
		console.error(`missing ${name}`);
		process.exit(1);
	}
	return v;
}

async function ensureWorkspace(
	configDir: string,
	globalConfigDir: string | undefined,
): Promise<string> {
	await mkdir(configDir, { recursive: true });
	const configPath = join(configDir, "config.json");
	if (existsSync(configPath)) {
		const ctx = await loadWorkspaceContext(configDir, configDir);
		return ctx.id;
	}
	const id = `ws_${crypto.randomUUID().slice(0, 8)}`;
	const cfg: Record<string, unknown> = { id, version: 1 };
	if (globalConfigDir) cfg.globalConfigDir = globalConfigDir;
	await writeFile(configPath, JSON.stringify(cfg, null, 2) + "\n");
	return id;
}

async function writeAgentProfile(
	configDir: string,
	agentName: string,
	providerType: string,
	modelId: string | undefined,
	description: string | undefined,
): Promise<void> {
	const dir = join(configDir, "agents", agentName);
	await mkdir(dir, { recursive: true });

	const promptPath = join(dir, "prompt.md");
	if (!existsSync(promptPath)) {
		await writeFile(promptPath, "You are a helpful agent.\n");
	} else {
		// keep existing prompt, ensure it's readable as utf8 (no-op)
		await readFile(promptPath, "utf8");
	}

	const conf: Record<string, unknown> = { providerId: providerType };
	if (modelId) conf.modelId = modelId;
	if (description) conf.description = description;
	await writeFile(join(dir, "conf.json"), JSON.stringify(conf, null, 2) + "\n");
}

async function connectProvider(
	configDir: string,
	opts: {
		type: string;
		apiKey: string;
		baseUrl?: string;
		target?: "local" | "global";
	},
): Promise<string> {
	const svc = new ProviderService();
	try {
		const detail = await svc.connect(configDir, {
			type: opts.type as (typeof PROVIDER_TYPES)[number],
			apiKey: opts.apiKey,
			baseUrl: opts.baseUrl,
			target: opts.target,
		});
		return detail.defaultModel;
	} catch (e) {
		if (e instanceof ProviderAlreadyConnectedError) {
			console.warn(`[warn] ${e.message} — skipping connect`);
			// Resolve default model from the stored connection for logging.
			const existing = await svc.get(configDir, opts.type);
			return existing.defaultModel;
		}
		throw e;
	}
}

async function main() {
	const configDir = requireEnv("CONFIG_DIR");
	const agentName = requireEnv("AGENT_NAME");
	const providerType = requireEnv("PROVIDER_TYPE");
	const apiKey = requireEnv("API_KEY");

	if (!(PROVIDER_TYPES as readonly string[]).includes(providerType)) {
		console.error(
			`PROVIDER_TYPE must be one of: ${PROVIDER_TYPES.join(", ")} (got "${providerType}")`,
		);
		process.exit(1);
	}

	const modelId = env("MODEL_ID");
	const baseUrl = env("BASE_URL");
	const target = env("TARGET");
	if (target && target !== "local" && target !== "global") {
		console.error(`TARGET must be "local" or "global" (got "${target}")`);
		process.exit(1);
	}
	const description = env("DESCRIPTION");
	const globalConfigDir = env("GLOBAL_CONFIG_DIR");

	const workspaceId = await ensureWorkspace(configDir, globalConfigDir);
	await writeAgentProfile(
		configDir,
		agentName,
		providerType,
		modelId,
		description,
	);
	const defaultModel = await connectProvider(configDir, {
		type: providerType,
		apiKey,
		baseUrl,
		target: target as "local" | "global" | undefined,
	});

	console.log("seed complete");
	console.log(`  workspaceId:   ${workspaceId}`);
	console.log(`  agent dir:     ${join(configDir, "agents", agentName)}`);
	console.log(`  provider id:   ${providerType}`);
	console.log(`  defaultModel:  ${defaultModel}`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
