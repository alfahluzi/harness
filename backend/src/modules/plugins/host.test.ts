import { describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginManifest } from "@puna/sdk-shared";
import type { PluginSummary } from "@puna/sdk-shared";
import type { AgentConf } from "./contract";
import { PluginHost, type PluginModuleLoader } from "./host";
import { PermissionDeniedError } from "./permissions";
import { PluginNotFoundError, type PluginDetailResponse, type PluginService } from "./service";

interface DetailOptions {
	capabilities?: PluginManifest["capabilities"];
	permissions?: PluginManifest["permissions"];
}

function makeDetail(id: string, options: DetailOptions = {}): PluginDetailResponse {
	return {
		manifest: PluginManifest.parse({
			id,
			name: `Plugin ${id}`,
			version: "1.0.0",
			description: `${id} fixture`,
			engines: { puna: ">=0.1.0" },
			...(options.capabilities ? { capabilities: options.capabilities } : {}),
			...(options.permissions ? { permissions: options.permissions } : {}),
		}),
		source: "workspace-local",
		resolvedDir: `/tmp/plugins/${id}`,
	};
}

class FakePluginService {
	constructor(private readonly details: PluginDetailResponse[]) {}

	async list(_configDir: string) {
		return {
			workspaceId: "ws_host_test",
			globalConfigDir: null,
			plugins: this.details.map((detail): PluginSummary => ({
				id: detail.manifest.id,
				name: detail.manifest.name,
				version: detail.manifest.version,
				description: detail.manifest.description,
				source: detail.source,
				resolvedDir: detail.resolvedDir,
				kind: detail.manifest.capabilities?.backendHooks ? "agent-hook" : "ui",
			})),
		};
	}

	async get(_configDir: string, id: string): Promise<PluginDetailResponse> {
		const found = this.details.find((detail) => detail.manifest.id === id);
		if (!found) throw new PluginNotFoundError(id);
		return found;
	}
}

function makeHost(
	details: PluginDetailResponse[],
	loader: PluginModuleLoader = async () => null,
): PluginHost {
	return new PluginHost(new FakePluginService(details) as unknown as PluginService, loader);
}

describe("PluginHost.discoverAndLoad", () => {
	test("empty workspace -> zero loaded/errors and empty snapshot", async () => {
		let loaderCalls = 0;
		const host = makeHost([], async () => {
			loaderCalls += 1;
			return null;
		});

		const result = await host.discoverAndLoad("/tmp/ws/.puna");

		expect(result).toEqual({ loaded: 0, errors: 0 });
		expect(host.list()).toEqual([]);
		expect(loaderCalls).toBe(0);
	});

	test("valid backend manifest -> mocked loader instance stored", async () => {
		const detail = makeDetail("alpha", {
			capabilities: { backendHooks: { entry: "backend/index.ts" } },
		});
		const loaderCalls: string[] = [];
		const host = makeHost([detail], async (_dir, manifest) => {
			loaderCalls.push(manifest.id);
			return { id: manifest.id, transformSystemPrompt: (_ctx, prompt) => prompt };
		});

		const result = await host.discoverAndLoad("/tmp/ws/.puna");

		expect(result).toEqual({ loaded: 1, errors: 0 });
		expect(loaderCalls).toEqual(["alpha"]);
		expect(host.getLoaded("alpha")?.instance).not.toBeNull();
		expect(host.list().map((summary) => summary.id)).toEqual(["alpha"]);
	});

	test("loader failure -> loadError stored, instance null, errors counted", async () => {
		const detail = makeDetail("broken", {
			capabilities: { backendHooks: { entry: "backend/index.ts" } },
		});
		const host = makeHost([detail], async () => {
			throw new Error("import exploded");
		});

		const result = await host.discoverAndLoad("/tmp/ws/.puna");

		expect(result).toEqual({ loaded: 0, errors: 1 });
		const loaded = host.getLoaded("broken");
		expect(loaded?.instance).toBeNull();
		expect(loaded?.loadError?.message).toContain("import exploded");
	});

	test("plugin without backend capability -> loader not called", async () => {
		const detail = makeDetail("ui-only", {
			capabilities: { leftBar: { entry: "ui/index.tsx" } },
		});
		let loaderCalls = 0;
		const host = makeHost([detail], async () => {
			loaderCalls += 1;
			return null;
		});

		const result = await host.discoverAndLoad("/tmp/ws/.puna");

		expect(result).toEqual({ loaded: 0, errors: 0 });
		expect(loaderCalls).toBe(0);
		expect(host.getLoaded("ui-only")?.instance).toBeNull();
		expect(host.list()).toHaveLength(1);
	});
});

describe("PluginHost prompt transformers", () => {
	test("getSystemPromptTransformers sorts by plugin id", async () => {
		const details = [
			makeDetail("zeta", { capabilities: { backendHooks: { entry: "backend/index.ts" } } }),
			makeDetail("alpha", { capabilities: { backendHooks: { entry: "backend/index.ts" } } }),
		];
		const order: string[] = [];
		const host = makeHost(details, async (_dir, manifest) => ({
			id: manifest.id,
			transformSystemPrompt: (_ctx, prompt) => {
				order.push(manifest.id);
				return prompt;
			},
		}));
		await host.discoverAndLoad("/tmp/ws/.puna");

		const transformers = host.getSystemPromptTransformers();
		expect(transformers).toHaveLength(2);
		const ctx = { agentName: "agent", workspaceId: "ws", configDir: "/tmp/ws/.puna" };
		const out = await host.applySystemPromptTransforms(ctx, "base");
		expect(out).toBe("base");
		expect(order).toEqual(["alpha", "zeta"]);
	});

	test("applySystemPromptTransforms chains and skips throwing transformer", async () => {
		const details = [
			makeDetail("alpha", { capabilities: { backendHooks: { entry: "backend/index.ts" } } }),
			makeDetail("beta", { capabilities: { backendHooks: { entry: "backend/index.ts" } } }),
			makeDetail("gamma", { capabilities: { backendHooks: { entry: "backend/index.ts" } } }),
		];
		const host = makeHost(details, async (_dir, manifest) => ({
			id: manifest.id,
			transformSystemPrompt: (_ctx, prompt) => {
				if (manifest.id === "alpha") return `${prompt}+alpha`;
				if (manifest.id === "beta") throw new Error("beta exploded");
				return `${prompt}+gamma`;
			},
		}));
		await host.discoverAndLoad("/tmp/ws/.puna");

		const out = await host.applySystemPromptTransforms(
			{ agentName: "agent", workspaceId: "ws", configDir: "/tmp/ws/.puna" },
			"base",
		);
		expect(out).toBe("base+alpha+gamma");
	});
});

describe("PluginHost agent extensions", () => {
	test("getExtraAgents collects in plugin-id order and skips throws", async () => {
		const details = [
			makeDetail("beta", { capabilities: { backendHooks: { entry: "backend/index.ts" } } }),
			makeDetail("alpha", { capabilities: { backendHooks: { entry: "backend/index.ts" } } }),
		];
		const host = makeHost(details, async (_dir, manifest) => ({
			id: manifest.id,
			extraAgents: async () => {
				if (manifest.id === "beta") throw new Error("no agents for beta");
				return [{ name: "alpha-agent", description: "from alpha" }];
			},
		}));
		await host.discoverAndLoad("/tmp/ws/.puna");

		expect(await host.getExtraAgents()).toEqual([
			{ name: "alpha-agent", description: "from alpha" },
		]);
	});

	test("applyAgentConfOverrides chains in plugin-id order", async () => {
		const details = [
			makeDetail("zeta", { capabilities: { backendHooks: { entry: "backend/index.ts" } } }),
			makeDetail("alpha", { capabilities: { backendHooks: { entry: "backend/index.ts" } } }),
		];
		const host = makeHost(details, async (_dir, manifest) => ({
			id: manifest.id,
			overrideAgentConf: (_agentName, conf: AgentConf) => {
				if (manifest.id === "alpha") return { ...conf, role: `alpha(${conf.role ?? "none"})` };
				return { ...conf, role: `zeta(${conf.role ?? "none"})` };
			},
		}));
		await host.discoverAndLoad("/tmp/ws/.puna");

		const result = host.applyAgentConfOverrides("agent", { role: "base" });
		expect(result.role).toBe("zeta(alpha(base))");
	});

	test("applyAgentConfOverrides keeps current conf when override throws", async () => {
		const detail = makeDetail("alpha", {
			capabilities: { backendHooks: { entry: "backend/index.ts" } },
		});
		const host = makeHost([detail], async (_dir, manifest) => ({
			id: manifest.id,
			overrideAgentConf: () => {
				throw new Error("override exploded");
			},
		}));
		await host.discoverAndLoad("/tmp/ws/.puna");

		expect(host.applyAgentConfOverrides("agent", { temperature: 0.2 })).toEqual({
			temperature: 0.2,
		});
	});
});

describe("PluginHost tools", () => {
	test("getTools namespaces names and proxies invoke", async () => {
		const details = [
			makeDetail("beta", { capabilities: { tools: { entry: "backend/index.ts" } } }),
			makeDetail("alpha", { capabilities: { tools: { entry: "backend/index.ts" } } }),
		];
		const host = makeHost(details, async (_dir, manifest) => ({
			id: manifest.id,
			tools: () => [
				{
					name: "search",
					description: `${manifest.id} search`,
					schema: { type: "object" },
					invoke: async (input: unknown) => `${manifest.id}:${String(input)}`,
				},
			],
		}));
		await host.discoverAndLoad("/tmp/ws/.puna");

		const tools = host.getTools();
		expect(tools.map((tool) => tool.name)).toEqual(["alpha.search", "beta.search"]);
		expect(tools[0]?.pluginId).toBe("alpha");
		expect(tools[0]?.originalName).toBe("search");
		expect(tools[0]?.description).toBe("alpha search");
		expect(await tools[0]?.invoke("q")).toBe("alpha:q");
	});

	test("getTools skips a plugin whose factory throws", async () => {
		const details = [
			makeDetail("alpha", { capabilities: { tools: { entry: "backend/index.ts" } } }),
			makeDetail("broken", { capabilities: { tools: { entry: "backend/index.ts" } } }),
		];
		const host = makeHost(details, async (_dir, manifest) => ({
			id: manifest.id,
			tools: () => {
				if (manifest.id === "broken") throw new Error("factory exploded");
				return [{ name: "ok", invoke: () => "ok" }];
			},
		}));
		await host.discoverAndLoad("/tmp/ws/.puna");

		expect(host.getTools().map((tool) => tool.name)).toEqual(["alpha.ok"]);
	});

	test("writeToolDescriptors writes descriptors (no implementation) to .runtime", async () => {
		const detail = makeDetail("alpha", { capabilities: { tools: { entry: "backend/index.ts" } } });
		const host = makeHost([detail], async (_dir, manifest) => ({
			id: manifest.id,
			tools: () => [
				{
					name: "search",
					description: "Search things",
					schema: { type: "object", properties: { q: { type: "string" } } },
					invoke: () => "should-not-be-serialized",
				},
			],
		}));
		await host.discoverAndLoad("/tmp/ws/.puna");

		const workspaceDir = await mkdtemp(join(tmpdir(), "puna-plugin-host-"));
		try {
			const path = await host.writeToolDescriptors(workspaceDir);
			expect(path).toBe(join(workspaceDir, ".runtime", "plugin-tools.json"));

			const raw = await readFile(path, "utf8");
			const parsed = JSON.parse(raw) as {
				tools: Array<Record<string, unknown>>;
			};
			expect(parsed.tools).toHaveLength(1);
			expect(parsed.tools[0]).toEqual({
				name: "alpha.search",
				description: "Search things",
				schema: { type: "object", properties: { q: { type: "string" } } },
			});
			expect(parsed.tools[0]).not.toHaveProperty("invoke");
		} finally {
			await rm(workspaceDir, { recursive: true, force: true });
		}
	});
});

describe("PluginHost node lifecycle hooks", () => {
	test("getLifecycleHooks lists only hook-declaring plugins, sorted by id", async () => {
		const details = [
			makeDetail("zeta", { capabilities: { backendHooks: { entry: "backend/index.ts" } } }),
			makeDetail("alpha", { capabilities: { backendHooks: { entry: "backend/index.ts" } } }),
			makeDetail("ui-only", { capabilities: { leftBar: { entry: "ui/index.tsx" } } }),
			makeDetail("after-only", { capabilities: { backendHooks: { entry: "backend/index.ts" } } }),
		];
		const host = makeHost(details, async (_dir, manifest) => {
			if (manifest.id === "zeta") {
				return {
					id: manifest.id,
					beforeNode: async () => {},
					afterNode: async () => ({}),
				};
			}
			if (manifest.id === "alpha") return { id: manifest.id, beforeNode: async () => {} };
			if (manifest.id === "after-only") return { id: manifest.id, afterNode: async () => ({}) };
			return { id: manifest.id };
		});
		await host.discoverAndLoad("/tmp/ws/.puna");

		expect(host.getLifecycleHooks()).toEqual([
			{ id: "after-only", beforeNode: false, afterNode: true },
			{ id: "alpha", beforeNode: true, afterNode: false },
			{ id: "zeta", beforeNode: true, afterNode: true },
		]);
	});

	test("runNodeHook afterNode merges patches in id order, later plugin wins", async () => {
		const details = [
			makeDetail("beta", { capabilities: { backendHooks: { entry: "backend/index.ts" } } }),
			makeDetail("alpha", { capabilities: { backendHooks: { entry: "backend/index.ts" } } }),
		];
		const seen: Array<[string, string, unknown, unknown]> = [];
		const host = makeHost(details, async (_dir, manifest) => ({
			id: manifest.id,
			afterNode: async (nodeName, state, cfg) => {
				seen.push([manifest.id, nodeName, state, cfg]);
				if (manifest.id === "alpha") return { count: 1, fromAlpha: true };
				return { count: 2, fromBeta: true };
			},
		}));
		await host.discoverAndLoad("/tmp/ws/.puna");

		const result = await host.runNodeHook(
			"afterNode",
			"call_model",
			{ messages: [] },
			{ temperature: 0 },
		);

		expect(result).toEqual({
			patch: { count: 2, fromAlpha: true, fromBeta: true },
			invoked: 2,
			dropped: 0,
		});
		expect(seen).toEqual([
			["alpha", "call_model", { messages: [] }, { temperature: 0 }],
			["beta", "call_model", { messages: [] }, { temperature: 0 }],
		]);
	});

	test("runNodeHook drops a throwing afterNode, keeps the healthy patch", async () => {
		const details = [
			makeDetail("beta", { capabilities: { backendHooks: { entry: "backend/index.ts" } } }),
			makeDetail("alpha", { capabilities: { backendHooks: { entry: "backend/index.ts" } } }),
		];
		const host = makeHost(details, async (_dir, manifest) => ({
			id: manifest.id,
			afterNode: async () => {
				if (manifest.id === "beta") throw new Error("beta afterNode exploded");
				return { ok: true };
			},
		}));
		await host.discoverAndLoad("/tmp/ws/.puna");

		const warn = spyOn(console, "warn").mockImplementation(() => {});
		try {
			const result = await host.runNodeHook("afterNode", "call_model", {}, {});
			expect(result).toEqual({ patch: { ok: true }, invoked: 1, dropped: 1 });
			expect(warn).toHaveBeenCalledTimes(1);
			expect(String(warn.mock.calls[0]?.[0])).toContain("beta afterNode");
		} finally {
			warn.mockRestore();
		}
	});

	test("runNodeHook drops a hanging hook after timeoutMs and still resolves", async () => {
		const detail = makeDetail("hang", {
			capabilities: { backendHooks: { entry: "backend/index.ts" } },
		});
		const host = makeHost([detail], async (_dir, manifest) => ({
			id: manifest.id,
			afterNode: () => new Promise<Record<string, unknown>>(() => {}),
		}));
		await host.discoverAndLoad("/tmp/ws/.puna");

		const warn = spyOn(console, "warn").mockImplementation(() => {});
		const started = Date.now();
		try {
			const result = await host.runNodeHook("afterNode", "call_model", {}, {}, 25);
			const elapsed = Date.now() - started;
			expect(result).toEqual({ patch: null, invoked: 0, dropped: 1 });
			expect(elapsed).toBeLessThan(1000);
			expect(String(warn.mock.calls[0]?.[0])).toContain("timed out after 25ms");
		} finally {
			warn.mockRestore();
		}
	});

	test("runNodeHook beforeNode invokes hooks and returns a null patch", async () => {
		const details = [
			makeDetail("beta", { capabilities: { backendHooks: { entry: "backend/index.ts" } } }),
			makeDetail("alpha", { capabilities: { backendHooks: { entry: "backend/index.ts" } } }),
		];
		const calls: string[] = [];
		const host = makeHost(details, async (_dir, manifest) => ({
			id: manifest.id,
			beforeNode: async (nodeName) => {
				calls.push(`${manifest.id}:${nodeName}`);
			},
		}));
		await host.discoverAndLoad("/tmp/ws/.puna");

		const result = await host.runNodeHook("beforeNode", "call_model", { messages: [] }, {});

		expect(result).toEqual({ patch: null, invoked: 2, dropped: 0 });
		expect(calls).toEqual(["alpha:call_model", "beta:call_model"]);
	});
});

describe("PluginHost permissions", () => {
	test("checkPermission allows declared fs.read and denies the rest", async () => {
		const detail = makeDetail("alpha", {
			capabilities: { backendHooks: { entry: "backend/index.ts" } },
			permissions: { fs: { read: ["docs"] }, net: { hosts: ["api.example.com"] } },
		});
		const host = makeHost([detail], async (_dir, manifest) => ({
			id: manifest.id,
			transformSystemPrompt: (_ctx, prompt) => prompt,
		}));
		await host.discoverAndLoad("/tmp/ws/.puna");

		expect(() => host.checkPermission("alpha", "fs.read", "docs/x.md")).not.toThrow();
		expect(() => host.checkPermission("alpha", "fs.write", "docs/x.md")).toThrow(
			PermissionDeniedError,
		);
		expect(() => host.checkPermission("alpha", "net", "api.example.com")).not.toThrow();
		expect(() => host.checkPermission("alpha", "shell", "git")).toThrow(PermissionDeniedError);
	});

	test("checkPermission throws PermissionDeniedError for unknown plugin", () => {
		const host = makeHost([]);
		expect(() => host.checkPermission("ghost", "fs.read", "docs")).toThrow(
			PermissionDeniedError,
		);
	});

	test("enforceTools exposes a bound verify without changing default invoke", async () => {
		const detail = makeDetail("alpha", {
			capabilities: { tools: { entry: "backend/index.ts" } },
			permissions: { fs: { read: ["docs"] } },
		});
		const host = makeHost([detail], async (_dir, manifest) => ({
			id: manifest.id,
			tools: () => [{ name: "reader", invoke: () => "read-ok" }],
		}));
		await host.discoverAndLoad("/tmp/ws/.puna");

		const [tool] = host.enforceTools();
		expect(tool?.name).toBe("alpha.reader");
		expect(tool?.verify).toBeFunction();
		expect(() => tool?.verify?.("fs.read", "docs/a.md")).not.toThrow();
		expect(() => tool?.verify?.("fs.read", "secrets/a.md")).toThrow(PermissionDeniedError);
		expect(await tool?.invoke(undefined)).toBe("read-ok");
	});
});

describe("PluginHost.getGraphs", () => {
	test("returns [] when no plugin declares capabilities", async () => {
		const host = makeHost([makeDetail("alpha")], async () => null);
		await host.discoverAndLoad("/tmp/ws/.puna");

		expect(host.getGraphs()).toEqual([]);
	});

	test("resolves namespaced descriptors without a backend module", async () => {
		const detail = makeDetail("research-agent", {
			capabilities: {
				graphs: [
					{ id: "research", entry: "graphs/research.ts" },
					{ id: "summarize", entry: "graphs/summarize.ts", alias: "summary" },
				],
			},
		});
		const host = makeHost([detail], async () => null);
		await host.discoverAndLoad("/tmp/ws/.puna");

		expect(host.getLoaded("research-agent")?.instance).toBeNull();
		expect(host.getGraphs()).toEqual([
			{
				key: "research-agent.research",
				pluginId: "research-agent",
				id: "research",
				name: "research",
				namespace: "research-agent",
				entry: "/tmp/plugins/research-agent/graphs/research.ts",
				export: "graph",
			},
			{
				key: "research-agent.summary",
				pluginId: "research-agent",
				id: "summarize",
				name: "summary",
				namespace: "research-agent",
				entry: "/tmp/plugins/research-agent/graphs/summarize.ts",
				export: "graph",
			},
		]);
	});

	test("honors explicit namespace and alias overrides", async () => {
		const detail = makeDetail("notes-agent", {
			capabilities: {
				graphs: [
					{
						id: "notes-agent",
						entry: "graphs/notes.ts",
						alias: "notes",
						namespace: "com.example.notes",
					},
				],
			},
		});
		const host = makeHost([detail], async () => null);
		await host.discoverAndLoad("/tmp/ws/.puna");

		const [graph] = host.getGraphs();
		expect(graph?.key).toBe("com.example.notes.notes");
		expect(graph?.name).toBe("notes");
		expect(graph?.namespace).toBe("com.example.notes");
		expect(graph?.id).toBe("notes-agent");
	});

	test("sorts descriptors by pluginId then key", async () => {
		const details = [
			makeDetail("b-plugin", {
				capabilities: {
					graphs: [
						{ id: "beta", entry: "graphs/beta.ts" },
						{ id: "alpha", entry: "graphs/alpha.ts" },
					],
				},
			}),
			makeDetail("a-plugin", {
				capabilities: { graphs: [{ id: "alpha", entry: "graphs/alpha.ts" }] },
			}),
		];
		const host = makeHost(details, async () => null);
		await host.discoverAndLoad("/tmp/ws/.puna");

		expect(host.getGraphs().map((graph) => graph.key)).toEqual([
			"a-plugin.alpha",
			"b-plugin.alpha",
			"b-plugin.beta",
		]);
	});
});
