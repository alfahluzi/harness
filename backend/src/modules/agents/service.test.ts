import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentService } from "./service";

const SERVICE = new AgentService();

let projectRoot: string;
let configDir: string;

beforeAll(async () => {
	projectRoot = await mkdtemp(join(tmpdir(), "puna-agent-svc-"));
	configDir = join(projectRoot, ".puna");
	await mkdir(configDir, { recursive: true });
	await mkdir(join(configDir, "docs/plan"), { recursive: true });

	const globalConfigDir = await mkdtemp(join(tmpdir(), "puna-agent-global-"));
	await writeFile(
		join(configDir, "config.json"),
		JSON.stringify(
			{
				id: "ws_test123",
				version: 1,
				globalConfigDir,
			},
			null,
			2,
		) + "\n",
	);

	// global: semar, cepot, dawala, gareng
	for (const name of ["semar", "cepot", "dawala", "gareng"]) {
		const dir = join(globalConfigDir, "agents", name);
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "prompt.md"), `# ${name} GLOBAL\n`);
		await writeFile(
			join(dir, "conf.json"),
			JSON.stringify(
				{
					name,
					role: `${name}_global_role`,
					temperature: 0.5,
					called: "test",
					tools: { allow: ["read"], deny: [] },
					description: `GLOBAL ${name}`,
				},
				null,
				2,
			) + "\n",
		);
	}

	// local override for cepot + local additive newagent
	const localCepot = join(configDir, "agents", "cepot");
	await mkdir(localCepot, { recursive: true });
	await writeFile(join(localCepot, "prompt.md"), `# cepot LOCAL\n`);
	await writeFile(
		join(localCepot, "conf.json"),
		JSON.stringify(
			{ name: "cepot", role: "local_role", temperature: 0.9, called: "test", tools: { allow: ["read"], deny: [] }, description: "LOCAL cepot" },
			null,
			2,
		) + "\n",
	);

	const localNew = join(configDir, "agents", "newagent");
	await mkdir(localNew, { recursive: true });
	await writeFile(join(localNew, "prompt.md"), `# newagent LOCAL\n`);
	await writeFile(
		join(localNew, "conf.json"),
		JSON.stringify(
			{ name: "newagent", role: "local_only", temperature: 0.1, called: "test", tools: { allow: ["read"], deny: [] }, description: "LOCAL newagent" },
			null,
			2,
		) + "\n",
	);
});

afterAll(async () => {
	await rm(projectRoot, { recursive: true, force: true });
});

describe("AgentService.list", () => {
	test("merges local + global with local-wins precedence", async () => {
		const result = await SERVICE.list(configDir);
		expect(result.workspaceId).toBe("ws_test123");
		expect(result.agents).toHaveLength(5);

		const byName = new Map(result.agents.map((a) => [a.name, a]));

		// local override
		const cepot = byName.get("cepot");
		expect(cepot?.source).toBe("local");
		expect(cepot?.description).toBe("LOCAL cepot");
		expect(cepot?.role).toBe("local_role");
		expect(cepot?.temperature).toBe(0.9);

		// local additive
		const newagent = byName.get("newagent");
		expect(newagent?.source).toBe("local");
		expect(newagent?.description).toBe("LOCAL newagent");

		// global-only
		expect(byName.get("semar")?.source).toBe("global");
		expect(byName.get("dawala")?.source).toBe("global");
		expect(byName.get("gareng")?.source).toBe("global");

		// sorted alphabetically
		expect(result.agents.map((a) => a.name)).toEqual([
			"cepot",
			"dawala",
			"gareng",
			"newagent",
			"semar",
		]);
	});
});

describe("AgentService.get", () => {
	test("local override wins, returns local prompt + conf", async () => {
		const agent = await SERVICE.get(configDir, "cepot");
		expect(agent.source).toBe("local");
		expect(agent.resolvedDir).toBe(join(configDir, "agents", "cepot"));
		expect(agent.description).toBe("LOCAL cepot");
		expect(agent.prompt).toContain("cepot LOCAL");
	});

	test("global-only agent returns global prompt + conf", async () => {
		const agent = await SERVICE.get(configDir, "semar");
		expect(agent.source).toBe("global");
		expect(agent.resolvedDir).toBe(
			join(
				JSON.parse(await Bun.file(join(configDir, "config.json")).text())
					.globalConfigDir,
				"agents",
				"semar",
			),
		);
		expect(agent.prompt).toContain("semar GLOBAL");
	});

	test("missing agent throws AgentNotFoundError", async () => {
		await expect(SERVICE.get(configDir, "ghost")).rejects.toThrow(/Agent not found/);
	});
});