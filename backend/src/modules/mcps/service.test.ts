import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpService, McpAlreadyInstalledError, McpNotFoundError } from "./service";
import { RegistryClient, RegistryNotFoundError } from "./registry";

// ---------------------------------------------------------------------------
// Fake registry server (Bun-native) — returns canned JSON for search/detail
// ---------------------------------------------------------------------------

const SEARCH_BODY = {
	servers: [
		{
			server: {
				name: "io.example.greet",
				description: "Friendly greeting MCP",
				version: "1.2.3",
				repository: { url: "https://github.com/example/greet", source: "github" },
				packages: [
					{
						registryType: "npm",
						identifier: "greet-mcp",
						version: "1.2.3",
						runtimeHint: "npx",
						transport: { type: "stdio" },
						runtimeArguments: [{ type: "positional", value: "-y" }],
						environmentVariables: [
							{ name: "GREET_API_KEY", description: "API key", isRequired: true, isSecret: true },
							{ name: "GREET_REGION", description: "Region", default: "us-east" },
						],
					},
				],
			},
			_meta: {
				"io.modelcontextprotocol.registry/official": {
					status: "active",
					isLatest: true,
				},
			},
		},
	],
	metadata: { nextCursor: "cursor-abc", count: 1 },
};

const DETAIL_BODY = {
	server: SEARCH_BODY.servers[0]!.server,
	_meta: SEARCH_BODY.servers[0]!._meta,
};

const NOT_FOUND_BODY = { error: "not found" };

let fakeBaseUrl = "";
let server: ReturnType<typeof Bun.serve> | null = null;

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		routes: {
			"/v0.1/servers": (req) => {
				const url = new URL(req.url);
				const search = url.searchParams.get("search") ?? "";
				if (search === "missing") {
					return new Response(JSON.stringify({ servers: [], metadata: { count: 0 } }), {
						status: 200,
						headers: { "content-type": "application/json" },
					});
				}
				return new Response(JSON.stringify(SEARCH_BODY), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			},
			"/v0.1/servers/io.example.greet/versions/latest": () =>
				new Response(JSON.stringify(DETAIL_BODY), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			"/v0.1/servers/io.example.weather/versions/latest": () =>
				new Response(JSON.stringify(DETAIL_BODY), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			"/v0.1/servers/io.example.ghost/versions/latest": () =>
				new Response(JSON.stringify(NOT_FOUND_BODY), { status: 404 }),
		},
		fetch: () => new Response("not found", { status: 404 }),
	});
	fakeBaseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
	server?.stop();
});

// ---------------------------------------------------------------------------
// Workspace fixtures
// ---------------------------------------------------------------------------

let projectRoot: string;
let configDir: string;
let globalConfigDir: string;
let systemMcpDir: string;

beforeAll(async () => {
	projectRoot = await mkdtemp(join(tmpdir(), "puna-mcp-svc-"));
	configDir = join(projectRoot, ".puna");
	await mkdir(configDir, { recursive: true });
	globalConfigDir = await mkdtemp(join(tmpdir(), "puna-mcp-global-"));
	systemMcpDir = await mkdtemp(join(tmpdir(), "puna-mcp-system-"));

	await writeFile(
		join(configDir, "config.json"),
		JSON.stringify({ id: "ws_mcp", version: 1, globalConfigDir }, null, 2) + "\n",
	);

	// global: weather-mcp with required secret env var
	const gDir = join(globalConfigDir, "mcps", "io.global.weather-mcp");
	await mkdir(gDir, { recursive: true });
	await writeFile(
		join(gDir, "conf.json"),
		JSON.stringify(
			{
				name: "io.global.weather-mcp",
				version: "0.5.0",
				source: "official-registry",
				installedAt: "2026-01-01T00:00:00.000Z",
				title: "Weather",
				description: "Weather data",
				repositoryUrl: null,
				status: "active",
				packages: [
					{
						registryType: "npm",
						identifier: "weather-mcp",
						version: "0.5.0",
						transport: "stdio",
						runtimeHint: "npx",
						runtimeArguments: [],
						environmentVariables: [
							{ name: "WEATHER_KEY", description: null, required: true, secret: true },
						],
					},
				],
			},
			null,
			2,
		) + "\n",
	);

	// global additive: harmless-mcp
	const hDir = join(globalConfigDir, "mcps", "io.global.harmless-mcp");
	await mkdir(hDir, { recursive: true });
	await writeFile(
		join(hDir, "conf.json"),
		JSON.stringify(
			{
				name: "io.global.harmless-mcp",
				version: "1.0.0",
				source: "official-registry",
				installedAt: "2026-01-02T00:00:00.000Z",
				title: null,
				description: null,
				repositoryUrl: null,
				status: "active",
				packages: [],
			},
			null,
			2,
		) + "\n",
	);
});

afterAll(async () => {
	await rm(projectRoot, { recursive: true, force: true });
	await rm(globalConfigDir, { recursive: true, force: true });
	await rm(systemMcpDir, { recursive: true, force: true });
});

let registry: RegistryClient;
let SERVICE: McpService;

// `fakeBaseUrl` is empty at module load and only known after `beforeAll`
// starts the Bun server on port 0. Lazy-construct both inside the hook so
// they bind to the right base URL.
beforeAll(() => {
	registry = new RegistryClient({ base: fakeBaseUrl });
	SERVICE = new McpService({ registry, systemMcpDir });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("McpService.listInstalled", () => {
	test("merges local + global with local-wins precedence", async () => {
		// pre-seed a local override of weather-mcp
		const localDir = join(configDir, "mcps", "io.global.weather-mcp");
		await mkdir(localDir, { recursive: true });
		await writeFile(
			join(localDir, "conf.json"),
			JSON.stringify(
				{
					name: "io.global.weather-mcp",
					version: "0.9.0-LOCAL",
					source: "official-registry",
					installedAt: "2026-09-01T00:00:00.000Z",
					title: "Weather LOCAL",
					description: "LOCAL override",
					repositoryUrl: null,
					status: "active",
					packages: [],
				},
				null,
				2,
			) + "\n",
		);

		const result = await SERVICE.listInstalled(configDir);
		expect(result.workspaceId).toBe("ws_mcp");
		expect(result.mcps).toHaveLength(2);

		const weather = result.mcps.find((m) => m.name === "io.global.weather-mcp");
		expect(weather?.source).toBe("local");
		expect(weather?.version).toBe("0.9.0-LOCAL");
		expect(weather?.title).toBe("Weather LOCAL");

		const harmless = result.mcps.find((m) => m.name === "io.global.harmless-mcp");
		expect(harmless?.source).toBe("global");

		// sorted alphabetically
		expect(result.mcps.map((m) => m.name)).toEqual([
			"io.global.harmless-mcp",
			"io.global.weather-mcp",
		]);
	});

	test("counts required/secret env vars from first package", async () => {
		// remove local override so the global one wins
		await rm(join(configDir, "mcps", "io.global.weather-mcp"), { recursive: true, force: true });

		const result = await SERVICE.listInstalled(configDir);
		const weather = result.mcps.find((m) => m.name === "io.global.weather-mcp");
		expect(weather?.source).toBe("global");
		expect(weather?.requiredEnvCount).toBe(1);
		expect(weather?.secretEnvCount).toBe(1);
	});
});

describe("McpService.install", () => {
	test("writes conf.json with registry detail and returns metadata", async () => {
		const result = await SERVICE.install(configDir, "io.example.greet");
		expect(result.name).toBe("io.example.greet");
		expect(result.version).toBe("1.2.3");
		expect(result.installedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(result.target).toBe("local");

		const dir = join(configDir, "mcps", "io.example.greet");
		const raw = JSON.parse(await readFile(join(dir, "conf.json"), "utf8"));
		expect(raw.source).toBe("official-registry");
		expect(raw.title).toBeNull();
		expect(raw.description).toBe("Friendly greeting MCP");
		expect(raw.packages).toHaveLength(1);
		expect(raw.packages[0].identifier).toBe("greet-mcp");
		expect(raw.packages[0].environmentVariables).toHaveLength(2);
	});

	test("refuses to overwrite an existing local install (409 semantics)", async () => {
		await expect(
			SERVICE.install(configDir, "io.example.greet"),
		).rejects.toThrow(McpAlreadyInstalledError);
	});

	test("refuses to overwrite a global-installed name (409 semantics)", async () => {
		await expect(
			SERVICE.install(configDir, "io.global.harmless-mcp"),
		).rejects.toThrow(McpAlreadyInstalledError);
	});

	test("propagates RegistryNotFoundError when upstream returns 404", async () => {
		await expect(
			SERVICE.install(configDir, "io.example.ghost"),
		).rejects.toThrow(RegistryNotFoundError);
	});

	test("target=global writes to system-wide dir and returns target=global", async () => {
		const result = await SERVICE.install(configDir, "io.example.weather", {
			target: "global",
		});
		expect(result.target).toBe("global");
		expect(result.version).toBe("1.2.3");

		const sysDir = join(systemMcpDir, "io.example.weather");
		const raw = JSON.parse(await readFile(join(sysDir, "conf.json"), "utf8"));
		expect(raw.description).toBe("Friendly greeting MCP");
	});

	test("target=global refuses to overwrite an existing system install", async () => {
		await expect(
			SERVICE.install(configDir, "io.example.weather", { target: "global" }),
		).rejects.toThrow(McpAlreadyInstalledError);
	});
});

describe("McpService.uninstall", () => {
	test("removes the local install directory", async () => {
		const result = await SERVICE.uninstall(configDir, "io.example.greet");
		expect(result.uninstalled).toBe(true);

		const dir = join(configDir, "mcps", "io.example.greet");
		const exists = await Bun.file(join(dir, "conf.json")).exists();
		expect(exists).toBe(false);
	});

	test("removes a system-wide install when no local entry exists", async () => {
		const result = await SERVICE.uninstall(configDir, "io.example.weather");
		expect(result.uninstalled).toBe(true);

		const sysDir = join(systemMcpDir, "io.example.weather");
		const exists = await Bun.file(join(sysDir, "conf.json")).exists();
		expect(exists).toBe(false);
	});

	test("throws when MCP is not installed anywhere", async () => {
		await expect(
			SERVICE.uninstall(configDir, "io.example.weather"),
		).rejects.toThrow(McpNotFoundError);
	});
});

describe("McpService.listInstalled (3-layer merge)", () => {
	test("includes system-wide entries and lists them as source=global", async () => {
		const sysEntryDir = join(systemMcpDir, "io.example.system-mcp");
		await mkdir(sysEntryDir, { recursive: true });
		await writeFile(
			join(sysEntryDir, "conf.json"),
			JSON.stringify(
				{
					name: "io.example.system-mcp",
					version: "9.9.9",
					source: "official-registry",
					installedAt: "2026-09-01T00:00:00.000Z",
					title: null,
					description: null,
					repositoryUrl: null,
					status: "active",
					packages: [],
				},
				null,
				2,
			) + "\n",
		);

		const result = await SERVICE.listInstalled(configDir);
		const sysEntry = result.mcps.find((m) => m.name === "io.example.system-mcp");
		expect(sysEntry).toBeDefined();
		expect(sysEntry?.source).toBe("global");
		expect(sysEntry?.version).toBe("9.9.9");

		await rm(sysEntryDir, { recursive: true, force: true });
	});
});

describe("RegistryClient", () => {
	test("search returns normalized summaries and cursor", async () => {
		const out = await registry.search("greet");
		expect(out.servers).toHaveLength(1);
		const s = out.servers[0]!;
		expect(s.name).toBe("io.example.greet");
		expect(s.version).toBe("1.2.3");
		expect(s.status).toBe("active");
		expect(s.packages).toHaveLength(1);
		expect(s.packages[0]?.transport).toBe("stdio");
		expect(out.nextCursor).toBe("cursor-abc");
	});

	test("getLatest returns full env-var schema", async () => {
		const detail = await registry.getLatest("io.example.greet");
		expect(detail.packages[0]?.environmentVariables).toHaveLength(2);
		const secret = detail.packages[0]?.environmentVariables.find(
			(e) => e.name === "GREET_API_KEY",
		);
		expect(secret?.required).toBe(true);
		expect(secret?.secret).toBe(true);
	});

	test("getLatest throws RegistryNotFoundError on 404", async () => {
		await expect(registry.getLatest("io.example.ghost")).rejects.toThrow(
			RegistryNotFoundError,
		);
	});
});