import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderRepository } from "../modules/providers/provider-repository";
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
		repo = new ProviderRepository(db);
	});

	afterEach(async () => {
		db.close();
		await rm(base, { recursive: true, force: true });
	});

	async function writeProfile(
		profile: string,
		conf: unknown,
		prompt = "You are a helpful agent.",
	) {
		const dir = join(configDir, "agents", profile);
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "prompt.md"), prompt);
		await writeFile(join(dir, "conf.json"), JSON.stringify(conf, null, 2));
	}

	test("local happy path maps all configurable fields", async () => {
		insertProvider(db, {
			id: "openai",
			workspaceId: "ws_test",
			name: "OpenAI (name dari row)",
			baseUrl: "https://api.openai.com/v1",
			apiKey: "sk-test-123",
			defaultModel: "gpt-4o",
		});
		await writeProfile("coder", { providerId: "openai", modelId: "gpt-test" }, "You are a coder.\nBe precise.");

		const cfg = await resolveAgentRuntimeConfig(configDir, "coder", "ws_test", repo);
		expect(cfg.configurable.agent_name).toBe("coder");
		expect(cfg.configurable.provider_name).toBe("OpenAI (name dari row)");
		expect(cfg.configurable.provider_url).toBe("https://api.openai.com/v1");
		expect(cfg.configurable.api_key).toBe("sk-test-123");
		expect(cfg.configurable.model_name).toBe("gpt-test");
		expect(cfg.configurable.system_prompt).toBe("You are a coder.\nBe precise.");
	});

	test("global fallback resolves when only a global row exists", async () => {
		insertProvider(db, {
			id: "anthropic",
			workspaceId: GLOBAL_WORKSPACE_ID,
			name: "Anthropic Global",
			baseUrl: "https://api.anthropic.com",
			apiKey: "sk-global-1",
			defaultModel: "claude-sonnet-4",
		});
		await writeProfile("writer", { providerId: "anthropic", modelId: "claude-x" });

		const cfg = await resolveAgentRuntimeConfig(configDir, "writer", "ws_other", repo);
		expect(cfg.configurable.provider_name).toBe("Anthropic Global");
		expect(cfg.configurable.model_name).toBe("claude-x");
	});

	test("missing providerId throws AgentRuntimeError mentioning providerId", async () => {
		await writeProfile("bare", {});
		await expect(
			resolveAgentRuntimeConfig(configDir, "bare", "ws_test", repo),
		).rejects.toThrow(/providerId/);
		await expect(
			resolveAgentRuntimeConfig(configDir, "bare", "ws_test", repo),
		).rejects.toThrow(AgentRuntimeError);
	});

	test("provider not connected throws AgentRuntimeError", async () => {
		await writeProfile("ghost", { providerId: "openai" });
		await expect(
			resolveAgentRuntimeConfig(configDir, "ghost", "ws_test", repo),
		).rejects.toThrow(/not connected/);
		await expect(
			resolveAgentRuntimeConfig(configDir, "ghost", "ws_test", repo),
		).rejects.toThrow(AgentRuntimeError);
	});

	test("modelId falls back to provider defaultModel", async () => {
		insertProvider(db, {
			id: "openai",
			workspaceId: "ws_test",
			name: "OpenAI",
			baseUrl: "https://api.openai.com/v1",
			apiKey: "sk-test-123",
			defaultModel: "gpt-4o",
		});
		await writeProfile("coder", { providerId: "openai" });

		const cfg = await resolveAgentRuntimeConfig(configDir, "coder", "ws_test", repo);
		expect(cfg.configurable.model_name).toBe("gpt-4o");
	});

	test("multiline prompt.md is used verbatim", async () => {
		insertProvider(db, {
			id: "openai",
			workspaceId: "ws_test",
			name: "OpenAI",
			baseUrl: "https://api.openai.com/v1",
			apiKey: "sk-test-123",
			defaultModel: "gpt-4o",
		});
		const multiline = "Line one.\n\nLine two, after blank.\n\tIndented.";
		await writeProfile("coder", { providerId: "openai", modelId: "gpt-test" }, multiline);

		const cfg = await resolveAgentRuntimeConfig(configDir, "coder", "ws_test", repo);
		expect(cfg.configurable.system_prompt).toBe(multiline);
	});
});
