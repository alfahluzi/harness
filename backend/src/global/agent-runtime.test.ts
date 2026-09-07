import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderRepository } from "../modules/providers/provider-repository";
import { ProviderModelRepository } from "../modules/providers/repository";
import { GLOBAL_WORKSPACE_ID } from "../models/providers";
import { resolveAgentRuntimeConfig, AgentRuntimeError } from "./agent-runtime";

const CREATE_PROVIDERS_SQL = `
CREATE TABLE providers (
	id TEXT NOT NULL,
	workspace_id TEXT NOT NULL,
	type TEXT NOT NULL,
	name TEXT NOT NULL,
	base_url TEXT NOT NULL,
	api_key TEXT NOT NULL,
	default_model TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	PRIMARY KEY (id, workspace_id)
);
`;

const CREATE_PROVIDER_MODELS_SQL = `
CREATE TABLE provider_models (
	workspace_id TEXT NOT NULL,
	provider_id TEXT NOT NULL,
	model_id TEXT NOT NULL,
	name TEXT,
	created_at INTEGER NOT NULL,
	PRIMARY KEY (workspace_id, provider_id, model_id)
);
`;

function insertModel(
	db: Database,
	workspaceId: string,
	providerId: string,
	modelId: string,
) {
	db.query(
		`INSERT INTO provider_models (workspace_id, provider_id, model_id, created_at)
		 VALUES (?, ?, ?, ?)`,
	).run(workspaceId, providerId, modelId, Date.now());
}

function insertProvider(
	db: Database,
	opts: {
		id: string;
		workspaceId: string;
		name: string;
		baseUrl: string;
		apiKey: string;
		defaultModel: string;
	},
) {
	db.query(
		`INSERT INTO providers (id, workspace_id, type, name, base_url, api_key, default_model, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		opts.id,
		opts.workspaceId,
		opts.id,
		opts.name,
		opts.baseUrl,
		opts.apiKey,
		opts.defaultModel,
		Date.now(),
		Date.now(),
	);
}

describe("resolveAgentRuntimeConfig", () => {
	let base: string;
	let configDir: string;
	let db: Database;
	let repo: ProviderRepository;

	beforeEach(async () => {
		base = await mkdtemp(join(tmpdir(), "agent-runtime-"));
		configDir = join(base, ".puna");
		await mkdir(configDir, { recursive: true });
		db = new Database(":memory:");
		db.run(CREATE_PROVIDERS_SQL);
		db.run(CREATE_PROVIDER_MODELS_SQL);
		repo = new ProviderRepository(db);
	});

	afterEach(async () => {
		db.close();
		await rm(base, { recursive: true, force: true });
	});

	async function writeWorkspace(
		dir: string,
		opts: { id: string; globalConfigDir?: string },
	) {
		await mkdir(dir, { recursive: true });
		const cfg: Record<string, unknown> = { id: opts.id, version: 1 };
		if (opts.globalConfigDir) cfg.globalConfigDir = opts.globalConfigDir;
		await writeFile(
			join(dir, "config.json"),
			JSON.stringify(cfg, null, 2),
		);
	}

	async function writeProfile(
		dir: string,
		profile: string,
		conf: unknown,
		prompt = "You are a helpful agent.",
	) {
		const agentDir = join(dir, "agents", profile);
		await mkdir(agentDir, { recursive: true });
		await writeFile(join(agentDir, "prompt.md"), prompt);
		await writeFile(join(agentDir, "conf.json"), JSON.stringify(conf, null, 2));
	}

	test("local happy path maps all configurable fields", async () => {
		await writeWorkspace(configDir, { id: "ws-local" });
		insertProvider(db, {
			id: "openai",
			workspaceId: "ws-local",
			name: "OpenAI (name dari row)",
			baseUrl: "https://api.openai.com/v1",
			apiKey: "sk-test-123",
			defaultModel: "gpt-4o",
		});
		await writeProfile(configDir, "coder", { providerId: "openai", modelId: "gpt-test" }, "You are a coder.\nBe precise.");

		const cfg = await resolveAgentRuntimeConfig(configDir, "coder", repo);
		expect(cfg.configurable.agent_name).toBe("coder");
		expect(cfg.configurable.provider_name).toBe("OpenAI (name dari row)");
		expect(cfg.configurable.provider_url).toBe("https://api.openai.com/v1");
		expect(cfg.configurable.api_key).toBe("sk-test-123");
		expect(cfg.configurable.model_name).toBe("gpt-test");
		expect(cfg.configurable.system_prompt).toBe("You are a coder.\nBe precise.");
	});

	test("global fallback provider resolves when only a global row exists", async () => {
		await writeWorkspace(configDir, { id: "ws-a" });
		insertProvider(db, {
			id: "anthropic",
			workspaceId: GLOBAL_WORKSPACE_ID,
			name: "Anthropic Global",
			baseUrl: "https://api.anthropic.com",
			apiKey: "sk-global-1",
			defaultModel: "claude-sonnet-4",
		});
		await writeProfile(configDir, "writer", { providerId: "anthropic", modelId: "claude-x" });

		const cfg = await resolveAgentRuntimeConfig(configDir, "writer", repo);
		expect(cfg.configurable.provider_name).toBe("Anthropic Global");
		expect(cfg.configurable.model_name).toBe("claude-x");
	});

	test("global profile fallback resolves from globalConfigDir agents", async () => {
		const globalDir = await mkdtemp(join(tmpdir(), "agent-runtime-global-"));
		try {
			await writeWorkspace(configDir, { id: "ws-b", globalConfigDir: globalDir });
			insertProvider(db, {
				id: "openai",
				workspaceId: "ws-b",
				name: "OpenAI",
				baseUrl: "https://api.openai.com/v1",
				apiKey: "sk-test-123",
				defaultModel: "gpt-4o",
			});
			// Profile only lives in the global dir — local configDir has none.
			await writeProfile(
				globalDir,
				"writer",
				{ providerId: "openai", modelId: "gpt-global" },
				"Global system prompt line.",
			);

			const cfg = await resolveAgentRuntimeConfig(configDir, "writer", repo);
			expect(cfg.configurable.agent_name).toBe("writer");
			expect(cfg.configurable.model_name).toBe("gpt-global");
			expect(cfg.configurable.system_prompt).toBe("Global system prompt line.");
		} finally {
			await rm(globalDir, { recursive: true, force: true });
		}
	});

	test("agent without providerId resolves provider from model in provider_models", async () => {
		await writeWorkspace(configDir, { id: "ws-local" });
		insertProvider(db, {
			id: "openai",
			workspaceId: "ws-local",
			name: "OpenAI",
			baseUrl: "https://api.openai.com/v1",
			apiKey: "sk-test-123",
			defaultModel: "gpt-4o",
		});
		insertModel(db, "ws-local", "openai", "gpt-from-models");
		await writeProfile(configDir, "coder", {});

		const cfg = await resolveAgentRuntimeConfig(
			configDir,
			"coder",
			repo,
			{ model: "gpt-from-models" },
			new ProviderModelRepository(db),
		);
		expect(cfg.configurable.provider_name).toBe("OpenAI");
		expect(cfg.configurable.model_name).toBe("gpt-from-models");
	});

	test("agent without providerId and no connected provider throws", async () => {
		await writeWorkspace(configDir, { id: "ws-local" });
		await writeProfile(configDir, "bare", {});
		const modelRepo = new ProviderModelRepository(db);
		await expect(
			resolveAgentRuntimeConfig(configDir, "bare", repo, undefined, modelRepo),
		).rejects.toThrow(/no provider is connected/);
		await expect(
			resolveAgentRuntimeConfig(configDir, "bare", repo, undefined, modelRepo),
		).rejects.toThrow(AgentRuntimeError);
	});

	test("agent without providerId falls back to first model of first provider", async () => {
		await writeWorkspace(configDir, { id: "ws-local" });
		insertProvider(db, {
			id: "openai",
			workspaceId: "ws-local",
			name: "OpenAI",
			baseUrl: "https://api.openai.com/v1",
			apiKey: "sk-test-123",
			defaultModel: "gpt-4o",
		});
		insertModel(db, "ws-local", "openai", "m-b");
		insertModel(db, "ws-local", "openai", "m-a");
		await writeProfile(configDir, "coder", {});

		const cfg = await resolveAgentRuntimeConfig(
			configDir,
			"coder",
			repo,
			undefined,
			new ProviderModelRepository(db),
		);
		expect(cfg.configurable.model_name).toBe("m-a");
	});

	test("provider not connected throws AgentRuntimeError", async () => {
		await writeWorkspace(configDir, { id: "ws-local" });
		await writeProfile(configDir, "ghost", { providerId: "openai" });
		await expect(resolveAgentRuntimeConfig(configDir, "ghost", repo)).rejects.toThrow(
			/not connected/,
		);
		await expect(resolveAgentRuntimeConfig(configDir, "ghost", repo)).rejects.toThrow(
			AgentRuntimeError,
		);
	});

	test("modelId falls back to provider defaultModel", async () => {
		await writeWorkspace(configDir, { id: "ws-local" });
		insertProvider(db, {
			id: "openai",
			workspaceId: "ws-local",
			name: "OpenAI",
			baseUrl: "https://api.openai.com/v1",
			apiKey: "sk-test-123",
			defaultModel: "gpt-4o",
		});
		await writeProfile(configDir, "coder", { providerId: "openai" });

		const cfg = await resolveAgentRuntimeConfig(configDir, "coder", repo);
		expect(cfg.configurable.model_name).toBe("gpt-4o");
	});

	test("request model override wins over conf modelId", async () => {
		await writeWorkspace(configDir, { id: "ws-local" });
		insertProvider(db, {
			id: "openai",
			workspaceId: "ws-local",
			name: "OpenAI",
			baseUrl: "https://api.openai.com/v1",
			apiKey: "sk-test-123",
			defaultModel: "gpt-4o",
		});
		await writeProfile(configDir, "coder", {
			providerId: "openai",
			modelId: "gpt-from-conf",
		});

		const cfg = await resolveAgentRuntimeConfig(configDir, "coder", repo, {
			model: "gpt-from-request",
		});
		expect(cfg.configurable.model_name).toBe("gpt-from-request");

		// without override the conf modelId still applies
		const noOverride = await resolveAgentRuntimeConfig(configDir, "coder", repo);
		expect(noOverride.configurable.model_name).toBe("gpt-from-conf");
	});

	test("missing agent profile throws AgentRuntimeError", async () => {
		await writeWorkspace(configDir, { id: "ws-local" });
		await expect(resolveAgentRuntimeConfig(configDir, "ghost", repo)).rejects.toThrow(
			/not found/,
		);
		await expect(resolveAgentRuntimeConfig(configDir, "ghost", repo)).rejects.toThrow(
			AgentRuntimeError,
		);
	});
});