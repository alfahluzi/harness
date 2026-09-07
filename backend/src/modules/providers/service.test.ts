import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { Database, type SQLQueryBindings } from "bun:sqlite";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ProviderService,
	ProviderAlreadyConnectedError,
	ProviderNotFoundError,
	ProviderConfigError,
} from "./service";
import { ProviderRepository } from "./provider-repository";
import { ProviderModelRepository } from "./repository";

// Both tables must exist in the test DB before the repository prepared
// statements run. The PK order on provider_models starts with workspace_id so
// the composite FK index is the leftmost prefix of the PK (required by
// SQLite for cascade deletes).
const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS providers (
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
CREATE INDEX IF NOT EXISTS providers_workspace_idx ON providers(workspace_id);

CREATE TABLE IF NOT EXISTS provider_models (
	workspace_id TEXT NOT NULL,
	provider_id TEXT NOT NULL,
	model_id TEXT NOT NULL,
	name TEXT,
	created_at INTEGER NOT NULL,
	PRIMARY KEY (workspace_id, provider_id, model_id),
	FOREIGN KEY (workspace_id, provider_id)
		REFERENCES providers(workspace_id, id)
		ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS provider_models_provider_idx
	ON provider_models(workspace_id, provider_id);
`;

async function makeWorkspace(): Promise<{ base: string; configDir: string }> {
	const base = await mkdtemp(join(tmpdir(), "providers-"));
	const configDir = join(base, ".puna");
	await mkdir(configDir, { recursive: true });
	await writeFile(
		join(configDir, "config.json"),
		JSON.stringify({ id: "test-workspace", version: 1 }, null, 2),
	);
	return { base, configDir };
}

function makeService(): { svc: ProviderService; memDb: Database } {
	const memDb = new Database(":memory:");
	// FK cascade only fires when foreign_keys pragma is on per-connection.
	memDb.run("PRAGMA foreign_keys = ON;");
	memDb.run(CREATE_TABLES_SQL);
	return {
		svc: new ProviderService({
			providerRepo: new ProviderRepository(memDb),
			modelRepo: new ProviderModelRepository(memDb),
		}),
		memDb,
	};
}

const OPENAI_KEY = "sk-test-1234567890abcdef";

// ---------------------------------------------------------------------------
// Fake provider endpoint (Bun-native): test chat + /models list
// ---------------------------------------------------------------------------

let fakePort = 0;
let server: ReturnType<typeof Bun.serve> | null = null;

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		routes: {
			"/v1/chat/completions": () =>
				new Response(JSON.stringify({ id: "fake", choices: [] }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			"/v1/models": () =>
				new Response(
					JSON.stringify({
						data: [
							{ id: "gpt-4o" },
							{ id: "gpt-4o-mini", display_name: "GPT-4o mini" },
						],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			"/v1/*": () => new Response("boom", { status: 500 }),
		},
	});
	fakePort = server.port ?? 0;
});

afterAll(() => {
	server?.stop(true);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowInDb(db: Database, sql: string, ...params: SQLQueryBindings[]): unknown {
	return db.query(sql).get(...params);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProviderService", () => {
	test("list is empty before any connect", async () => {
		const { configDir } = await makeWorkspace();
		const { svc } = makeService();
		const result = await svc.list(configDir);
		expect(result.workspaceId).toBe("test-workspace");
		expect(result.providers).toEqual([]);
	});

	test("connect writes row to providers table and syncs models", async () => {
		const { base, configDir } = await makeWorkspace();
		const { svc, memDb } = makeService();
		const detail = await svc.connect(configDir, {
			type: "openai",
			apiKey: OPENAI_KEY,
			baseUrl: `http://127.0.0.1:${fakePort}/v1`,
		});

		expect(detail.id).toBe("openai");
		expect(detail.source).toBe("local");
		expect(detail.hasApiKey).toBe(true);
		expect(detail.apiKeyMasked).not.toContain(OPENAI_KEY);
		expect(detail.apiKeyMasked).toContain("cdef");
		expect(detail.defaultModel).toBe("gpt-4o");

		// Source of truth is the DB, not the filesystem.
		const row = rowInDb(
			memDb,
			`SELECT id, workspace_id, api_key, default_model FROM providers WHERE id = ? AND workspace_id = ?`,
			"openai",
			"test-workspace",
		) as { api_key: string; default_model: string } | null;
		expect(row).not.toBeNull();
		expect(row!.api_key).toBe(OPENAI_KEY);
		expect(row!.default_model).toBe("gpt-4o");

		const models = await svc.models(configDir, "openai");
		expect(models.models.map((m) => m.modelId)).toEqual(["gpt-4o", "gpt-4o-mini"]);
		expect(models.models[1]!.name).toBe("GPT-4o mini");

		await rm(base, { recursive: true, force: true });
	});

	test("connect same kind twice throws ProviderAlreadyConnectedError", async () => {
		const { configDir } = await makeWorkspace();
		const { svc } = makeService();
		await svc.connect(configDir, { type: "openai", apiKey: OPENAI_KEY });
		expect(
			svc.connect(configDir, { type: "openai", apiKey: OPENAI_KEY }),
		).rejects.toThrow(ProviderAlreadyConnectedError);
	});

	test("connect with target=global stores row under __global__ workspace", async () => {
		const { base, configDir } = await makeWorkspace();
		const { svc, memDb } = makeService();
		await svc.connect(configDir, { type: "openai", apiKey: OPENAI_KEY, target: "global" });

		const row = rowInDb(
			memDb,
			`SELECT workspace_id FROM providers WHERE id = ?`,
			"openai",
		) as { workspace_id: string } | null;
		expect(row?.workspace_id).toBe("__global__");

		const listed = await svc.list(configDir);
		expect(listed.providers[0]!.source).toBe("global");
		await rm(base, { recursive: true, force: true });
	});

	test("workspace-local row shadows the global row of the same id", async () => {
		const { base, configDir } = await makeWorkspace();
		const { svc, memDb } = makeService();
		await svc.connect(configDir, {
			type: "openai",
			apiKey: "sk-global-9999",
			name: "Global OpenAI",
			target: "global",
		});
		// Both rows live side-by-side in the DB; the service dedupes at read time.
		const before = rowInDb(
			memDb,
			`SELECT COUNT(*) AS c FROM providers WHERE id = ?`,
			"openai",
		) as { c: number };
		expect(before.c).toBe(1);

		// Adding a workspace-local row would normally throw (already connected in
		// scope), but we simulate the shadowing by inserting the local row directly
		// and confirming the service picks the local name.
		memDb
			.query(
				`INSERT INTO providers (id, workspace_id, type, name, base_url, api_key, default_model, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				"openai",
				"test-workspace",
				"openai",
				"Local OpenAI",
				"http://127.0.0.1:9999/v1",
				"sk-local-1111",
				"gpt-4o-mini",
				Date.now(),
				Date.now(),
			);

		const listed = await svc.list(configDir);
		expect(listed.providers).toHaveLength(1);
		expect(listed.providers[0]!.source).toBe("local");
		expect(listed.providers[0]!.name).toBe("Local OpenAI");

		await rm(base, { recursive: true, force: true });
	});

	test("testCredentials with a valid key returns ok", async () => {
		const { configDir } = await makeWorkspace();
		const { svc } = makeService();
		const result = await svc.testCredentials(configDir, {
			type: "openai",
			apiKey: "sk-anything",
			baseUrl: `http://127.0.0.1:${fakePort}/v1`,
		});
		expect(result.ok).toBe(true);
		expect(result.error).toBeNull();
		expect(result.latencyMs).toBeGreaterThanOrEqual(0);
	});

	test("testCredentials against failing endpoint returns ok=false", async () => {
		const { configDir } = await makeWorkspace();
		const { svc } = makeService();
		const result = await svc.testCredentials(configDir, {
			type: "openai",
			apiKey: "sk-anything",
			baseUrl: `http://127.0.0.1:${fakePort}/v1/bad`,
		});
		expect(result.ok).toBe(false);
		expect(result.error).toContain("HTTP 500");
	});

	test("testCredentials without key tests the stored connection", async () => {
		const { configDir } = await makeWorkspace();
		const { svc } = makeService();
		await svc.connect(configDir, {
			type: "openai",
			apiKey: OPENAI_KEY,
			baseUrl: `http://127.0.0.1:${fakePort}/v1`,
		});
		const result = await svc.testCredentials(configDir, { type: "openai" });
		expect(result.ok).toBe(true);
	});

	test("testCredentials for unknown provider without key throws NotFound", async () => {
		const { configDir } = await makeWorkspace();
		const { svc } = makeService();
		expect(svc.testCredentials(configDir, { type: "anthropic" })).rejects.toThrow(
			ProviderNotFoundError,
		);
	});

	test("update keeps apiKey when not provided and re-syncs models", async () => {
		const { configDir } = await makeWorkspace();
		const { svc } = makeService();
		await svc.connect(configDir, {
			type: "openai",
			apiKey: OPENAI_KEY,
			baseUrl: `http://127.0.0.1:${fakePort}/v1`,
		});

		const updated = await svc.update(configDir, "openai", { name: "My OpenAI" });
		expect(updated.name).toBe("My OpenAI");
		expect(updated.hasApiKey).toBe(true);
		expect(updated.apiKeyMasked).toContain("cdef");

		const rotated = await svc.update(configDir, "openai", { apiKey: "sk-new-9999" });
		expect(rotated.apiKeyMasked).toContain("9999");
		expect(rotated.apiKeyMasked).not.toContain("cdef");
	});

	test("update unknown provider throws ProviderNotFoundError", async () => {
		const { configDir } = await makeWorkspace();
		const { svc } = makeService();
		expect(svc.update(configDir, "google", {})).rejects.toThrow(ProviderNotFoundError);
	});

	test("disconnect removes row and cascades to provider_models", async () => {
		const { base, configDir } = await makeWorkspace();
		const { svc, memDb } = makeService();
		await svc.connect(configDir, {
			type: "openai",
			apiKey: OPENAI_KEY,
			baseUrl: `http://127.0.0.1:${fakePort}/v1`,
		});

		const before = rowInDb(
			memDb,
			`SELECT COUNT(*) AS c FROM provider_models WHERE provider_id = ?`,
			"openai",
		) as { c: number };
		expect(before.c).toBeGreaterThan(0);

		const result = await svc.disconnect(configDir, "openai");
		expect(result).toEqual({ id: "openai", disconnected: true });

		const afterProvider = rowInDb(
			memDb,
			`SELECT COUNT(*) AS c FROM providers WHERE id = ?`,
			"openai",
		) as { c: number };
		const afterModels = rowInDb(
			memDb,
			`SELECT COUNT(*) AS c FROM provider_models WHERE provider_id = ?`,
			"openai",
		) as { c: number };
		expect(afterProvider.c).toBe(0);
		expect(afterModels.c).toBe(0);

		const listed = await svc.list(configDir);
		expect(listed.providers).toEqual([]);
		expect(svc.disconnect(configDir, "openai")).rejects.toThrow(ProviderNotFoundError);
		await rm(base, { recursive: true, force: true });
	});

	test("models for unknown provider throws ProviderNotFoundError", async () => {
		const { configDir } = await makeWorkspace();
		const { svc } = makeService();
		expect(svc.models(configDir, "anthropic")).rejects.toThrow(ProviderNotFoundError);
	});

	test("connect custom provider with baseUrl syncs models", async () => {
		const { base, configDir } = await makeWorkspace();
		const { svc, memDb } = makeService();
		const detail = await svc.connect(configDir, {
			type: "custom",
			apiKey: OPENAI_KEY,
			name: "My Proxy",
			baseUrl: `http://127.0.0.1:${fakePort}/v1`,
		});

		expect(detail.id).toBe("custom");
		expect(detail.name).toBe("My Proxy");
		expect(detail.source).toBe("local");
		expect(detail.hasApiKey).toBe(true);
		expect(detail.defaultModel).toBe("gpt-4o");

		const row = rowInDb(
			memDb,
			`SELECT name, type, base_url FROM providers WHERE id = ?`,
			"custom",
		) as { name: string; type: string; base_url: string } | null;
		expect(row?.name).toBe("My Proxy");
		expect(row?.type).toBe("custom");
		expect(row?.base_url).toBe(`http://127.0.0.1:${fakePort}/v1`);

		await rm(base, { recursive: true, force: true });
	});

	test("connect custom provider without baseUrl rejects", async () => {
		const { configDir } = await makeWorkspace();
		const { svc } = makeService();
		expect(
			svc.connect(configDir, { type: "custom", apiKey: OPENAI_KEY }),
		).rejects.toThrow(ProviderConfigError);
	});

	test("testCredentials for custom with baseUrl hits GET /models path", async () => {
		const { configDir } = await makeWorkspace();
		const { svc } = makeService();
		const result = await svc.testCredentials(configDir, {
			type: "custom",
			apiKey: OPENAI_KEY,
			baseUrl: `http://127.0.0.1:${fakePort}/v1`,
		});
		expect(result.ok).toBe(true);
		expect(result.error).toBeNull();
	});
});
