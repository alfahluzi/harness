import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginManifest } from "@puna/sdk-shared";
import { loadBackendModule } from "./loader";

let root: string;

async function writeFixture(dir: string, relativePath: string, contents: string): Promise<void> {
	const absoluteDir = join(root, dir, relativePath.split("/").slice(0, -1).join("/"));
	await mkdir(absoluteDir, { recursive: true });
	await writeFile(join(root, dir, relativePath), contents, "utf8");
}

function makeManifest(
	id: string,
	capabilities: PluginManifest["capabilities"],
): PluginManifest {
	return PluginManifest.parse({
		id,
		name: id,
		version: "1.0.0",
		description: `${id} fixture`,
		engines: { puna: ">=0.1.0" },
		capabilities,
	});
}

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), "puna-plugin-loader-"));

	await writeFixture(
		"hooks-object",
		"backend/index.ts",
		`export default {
	id: "hooks-object",
	transformSystemPrompt: (_ctx: unknown, prompt: string) => prompt + "!",
};
`,
	);

	await writeFixture(
		"hooks-factory",
		"backend/index.ts",
		`export default function createPlugin() {
	return {
		id: "hooks-factory",
		extraAgents: async () => [{ name: "factory-agent", description: "from factory" }],
	};
}
`,
	);

	await writeFixture(
		"hooks-named",
		"backend/index.ts",
		`export const plugin = {
	id: "hooks-named",
	transformSystemPrompt: async (_ctx: unknown, prompt: string) => prompt.trim(),
};
`,
	);

	await writeFixture(
		"tools-default",
		"backend/index.ts",
		`export default {
	id: "tools-default",
	tools: () => [
		{ name: "search", description: "Search", invoke: async () => "ok" },
	],
};
`,
	);

	await writeFixture(
		"tools-method",
		"backend/index.ts",
		`export default {
	id: "tools-method",
	prefix: "p",
	tools(config: { workspaceId: string }) {
		return [{ name: this.prefix + "-" + config.workspaceId, invoke: () => null }];
	},
};
`,
	);

	await writeFixture(
		"hooks-throws",
		"backend/index.ts",
		`export default () => {
	throw new Error("factory boom");
};
`,
	);

	await writeFixture(
		"tools-both",
		"backend/index.ts",
		`export default {
	id: "tools-both",
	transformSystemPrompt: (_ctx: unknown, prompt: string) => prompt + "?",
	tools: () => [{ name: "both", invoke: () => "both" }],
};
`,
	);
});

afterAll(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("loadBackendModule", () => {
	test("returns null when no backendHooks or tools capability", async () => {
		const bare = makeManifest("bare", undefined);
		expect(await loadBackendModule(join(root, "bare"), bare)).toBeNull();

		const uiOnly = makeManifest("ui-only", { leftBar: { entry: "ui/index.tsx" } });
		expect(await loadBackendModule(join(root, "ui-only"), uiOnly)).toBeNull();
	});

	test("loads default-exported BackendPlugin object", async () => {
		const manifest = makeManifest("hooks-object", {
			backendHooks: { entry: "backend/index.ts" },
		});

		const instance = await loadBackendModule(join(root, "hooks-object"), manifest);

		expect(instance).not.toBeNull();
		expect(instance?.id).toBe("hooks-object");
		expect(
			await instance?.transformSystemPrompt?.(
				{ agentName: "a", workspaceId: "w", configDir: "/tmp" },
				"hi",
			),
		).toBe("hi!");
	});

	test("loads factory default export", async () => {
		const manifest = makeManifest("hooks-factory", {
			backendHooks: { entry: "backend/index.ts" },
		});

		const instance = await loadBackendModule(join(root, "hooks-factory"), manifest);

		expect(instance).not.toBeNull();
		expect(await instance?.extraAgents?.()).toEqual([
			{ name: "factory-agent", description: "from factory" },
		]);
	});

	test("honors capabilities.export named export", async () => {
		const manifest = makeManifest("hooks-named", {
			backendHooks: { entry: "backend/index.ts", export: "plugin" },
		});

		const instance = await loadBackendModule(join(root, "hooks-named"), manifest);

		expect(instance).not.toBeNull();
		expect(
			await instance?.transformSystemPrompt?.(
				{ agentName: "a", workspaceId: "w", configDir: "/tmp" },
				"  trimmed  ",
			),
		).toBe("trimmed");
	});

	test("tools capability with export default.tools exposes the factory without calling it", async () => {
		const manifest = makeManifest("tools-default", {
			tools: { entry: "backend/index.ts", export: "default.tools" },
		});

		const instance = await loadBackendModule(join(root, "tools-default"), manifest);

		expect(instance).not.toBeNull();
		expect(typeof instance?.tools).toBe("function");
		const tools = instance?.tools?.({ configDir: "/tmp", workspaceId: "tools-default" });
		expect(tools?.map((tool) => tool.name)).toEqual(["search"]);
	});

	test("default.tools preserves the owning object as this", async () => {
		const manifest = makeManifest("tools-method", {
			tools: { entry: "backend/index.ts", export: "default.tools" },
		});

		const instance = await loadBackendModule(join(root, "tools-method"), manifest);

		const tools = instance?.tools?.({ configDir: "/tmp", workspaceId: "tools-method" });
		expect(tools?.[0]?.name).toBe("p-tools-method");
	});

	test("merges backendHooks + tools declared on the same entry", async () => {
		const manifest = makeManifest("tools-both", {
			backendHooks: { entry: "backend/index.ts" },
			tools: { entry: "backend/index.ts", export: "default.tools" },
		});

		const instance = await loadBackendModule(join(root, "tools-both"), manifest);

		expect(instance).not.toBeNull();
		expect(typeof instance?.transformSystemPrompt).toBe("function");
		expect(typeof instance?.tools).toBe("function");
		const tools = instance?.tools?.({ configDir: "/tmp", workspaceId: "tools-both" });
		expect(tools?.[0]?.name).toBe("both");
	});

	test("factory throw is wrapped with plugin id and entry path", async () => {
		const manifest = makeManifest("hooks-throws", {
			backendHooks: { entry: "backend/index.ts" },
		});

		await expect(loadBackendModule(join(root, "hooks-throws"), manifest)).rejects.toThrow(
			/hooks-throws.*factory boom/s,
		);
	});

	test("import failure is wrapped with plugin id and entry path", async () => {
		const manifest = makeManifest("hooks-missing", {
			backendHooks: { entry: "backend/missing.ts" },
		});

		await expect(loadBackendModule(join(root, "hooks-missing"), manifest)).rejects.toThrow(
			/hooks-missing.*backend\/missing\.ts/s,
		);
	});
});
