import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillService } from "./service";

const SERVICE = new SkillService();

let projectRoot: string;
let configDir: string;

beforeAll(async () => {
	projectRoot = await mkdtemp(join(tmpdir(), "puna-skill-svc-"));
	configDir = join(projectRoot, ".puna");
	await mkdir(configDir, { recursive: true });

	const globalConfigDir = await mkdtemp(join(tmpdir(), "puna-skill-global-"));
	await writeFile(
		join(configDir, "config.json"),
		JSON.stringify({ id: "ws_skill", version: 1, globalConfigDir }, null, 2) + "\n",
	);

	// global skills
	for (const name of ["lint", "format", "test-runner"]) {
		const dir = join(globalConfigDir, "skills", name);
		await mkdir(join(dir, "scripts"), { recursive: true });
		await writeFile(join(dir, "desc.md"), `# ${name} GLOBAL skill`);
		await writeFile(join(dir, "scripts", "run.sh"), `#!/bin/sh\n# ${name} script`);
	}

	// local override for lint
	const localLint = join(configDir, "skills", "lint");
	await mkdir(join(localLint, "scripts"), { recursive: true });
	await writeFile(join(localLint, "desc.md"), "# lint LOCAL override");
	await writeFile(join(localLint, "scripts", "custom.js"), "// local custom");

	// local additive newskill
	const localNew = join(configDir, "skills", "deploy");
	await mkdir(join(localNew, "scripts"), { recursive: true });
	await writeFile(join(localNew, "desc.md"), "# deploy LOCAL");
});

afterAll(async () => {
	await rm(projectRoot, { recursive: true, force: true });
});

describe("SkillService.list", () => {
	test("merges local + global with local-wins precedence", async () => {
		const result = await SERVICE.list(configDir);
		expect(result.workspaceId).toBe("ws_skill");
		expect(result.skills).toHaveLength(4);

		const lint = result.skills.find((s: { name: string }) => s.name === "lint");
		expect(lint?.source).toBe("local");
		expect(lint?.description).toContain("LOCAL override");
		expect(lint?.scriptCount).toBe(1);

		const deploy = result.skills.find((s: { name: string }) => s.name === "deploy");
		expect(deploy?.source).toBe("local");
		expect(deploy?.scriptCount).toBe(0);

		expect(result.skills.find((s) => s.name === "format")?.source).toBe("global");
	});
});

describe("SkillService.get", () => {
	test("returns scripts list for resolved source", async () => {
		const skill = await SERVICE.get(configDir, "lint");
		expect(skill.source).toBe("local");
		expect(skill.scripts.map((s) => s.name)).toEqual(["custom.js"]);
	});

	test("global skill returns global scripts", async () => {
		const skill = await SERVICE.get(configDir, "test-runner");
		expect(skill.source).toBe("global");
		expect(skill.scripts.map((s) => s.name)).toEqual(["run.sh"]);
	});

	test("missing skill throws SkillNotFoundError", async () => {
		await expect(SERVICE.get(configDir, "ghost")).rejects.toThrow(/Skill not found/);
	});
});