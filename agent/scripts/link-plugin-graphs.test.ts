/**
 * Tests for `agent/scripts/link-plugin-graphs.ts` (Fase 6 / F6-T1).
 *
 * Everything runs against throwaway temp dirs; `linkPluginGraphs` is a pure
 * filesystem operation (no backend HTTP), so no mocks are needed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { lstatSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { linkPluginGraphs } from "./link-plugin-graphs.js";

interface Workspace {
	root: string;
	/** Workspace-local config dir, i.e. `<root>/.puna`. */
	localDir: string;
	/** Fake repo `agent/` dir (`.plugins/` + `langgraph.json`). */
	agentDir: string;
}

async function makeWorkspace(): Promise<Workspace> {
	const root = await mkdtemp(join(tmpdir(), "link-plugin-graphs-"));
	const localDir = join(root, ".puna");
	const agentDir = join(root, "agent");
	await mkdir(join(localDir, "plugins"), { recursive: true });
	await mkdir(agentDir, { recursive: true });
	return { root, localDir, agentDir };
}

function validManifest(id: string, graphs: unknown[]): unknown {
	return {
		id,
		name: id,
		version: "0.1.0",
		description: "test plugin",
		engines: { puna: ">=0.1.0" },
		capabilities: { graphs },
	};
}

/**
 * Create `<localDir>/plugins/<dirName>/` with a manifest and optional files.
 * `manifest` may be an object (JSON.stringify'd) or a raw string (invalid JSON).
 */
async function addPlugin(
	ws: Workspace,
	dirName: string,
	manifest: unknown,
	files: Record<string, string> = {},
): Promise<string> {
	const pluginDir = join(ws.localDir, "plugins", dirName);
	await mkdir(pluginDir, { recursive: true });
	for (const [rel, content] of Object.entries(files)) {
		const full = join(pluginDir, rel);
		await mkdir(dirname(full), { recursive: true });
		await writeFile(full, content, "utf8");
	}
	await writeFile(
		join(pluginDir, "plugin.json"),
		typeof manifest === "string" ? manifest : JSON.stringify(manifest, null, 2),
		"utf8",
	);
	return pluginDir;
}

const GRAPH_MODULE = "export const graph = {};\nexport default graph;\n";

function linkOptions(ws: Workspace, extra: Record<string, unknown> = {}) {
	return {
		configDir: ws.localDir,
		agentDir: ws.agentDir,
		workspaceGlobalDir: null,
		systemDir: null,
		...extra,
	};
}

/** Capture console.warn for the duration of `fn`. */
async function captureWarnings<T>(fn: () => Promise<T>): Promise<{ result: T; warnings: string[] }> {
	const warnings: string[] = [];
	const original = console.warn;
	console.warn = (...args: unknown[]) => {
		warnings.push(args.map(String).join(" "));
	};
	try {
		return { result: await fn(), warnings };
	} finally {
		console.warn = original;
	}
}

test("registers two graphs from one plugin and links the plugin directory", async () => {
	const ws = await makeWorkspace();
	try {
		const pluginDir = await addPlugin(
			ws,
			"research-agent",
			validManifest("research-agent", [
				{ id: "research", entry: "./graphs/research.ts", export: "graph" },
				{ id: "summarize", entry: "./graphs/summarize.ts", export: "graph", alias: "summary" },
			]),
			{
				"graphs/research.ts": GRAPH_MODULE,
				"graphs/summarize.ts": GRAPH_MODULE,
			},
		);

		const result = await linkPluginGraphs(linkOptions(ws));

		const config = JSON.parse(
			await readFile(join(ws.agentDir, "langgraph.json"), "utf8"),
		);
		assert.equal(config.graphs.graph, "./src/base/graph.ts:graph");
		assert.equal(
			config.graphs["research-agent.research"],
			"./.plugins/research-agent/graphs/research.ts:graph",
		);
		assert.equal(
			config.graphs["research-agent.summary"],
			"./.plugins/research-agent/graphs/summarize.ts:graph",
		);
		assert.equal(config.env, ".env");
		assert.deepEqual(
			result.registered.map((r) => r.key),
			["research-agent.research", "research-agent.summary"],
		);
		assert.equal(result.skipped, 0);

		const linkPath = join(ws.agentDir, ".plugins", "research-agent");
		assert.ok(lstatSync(linkPath).isSymbolicLink(), ".plugins/<id> must be a symlink");
		assert.equal(realpathSync(linkPath), realpathSync(pluginDir));
	} finally {
		await rm(ws.root, { recursive: true, force: true });
	}
});

test("is idempotent: second run yields byte-identical langgraph.json", async () => {
	const ws = await makeWorkspace();
	try {
		const pluginDir = await addPlugin(
			ws,
			"research-agent",
			validManifest("research-agent", [
				{ id: "research", entry: "./graphs/research.ts", export: "graph" },
			]),
			{ "graphs/research.ts": GRAPH_MODULE },
		);
		const configPath = join(ws.agentDir, "langgraph.json");
		const linkPath = join(ws.agentDir, ".plugins", "research-agent");

		await linkPluginGraphs(linkOptions(ws));
		const first = await readFile(configPath, "utf8");

		await linkPluginGraphs(linkOptions(ws));
		const second = await readFile(configPath, "utf8");

		assert.equal(second, first);
		assert.ok(lstatSync(linkPath).isSymbolicLink());
		assert.equal(realpathSync(linkPath), realpathSync(pluginDir));
	} finally {
		await rm(ws.root, { recursive: true, force: true });
	}
});

test("removes stale symlinks from .plugins", async () => {
	const ws = await makeWorkspace();
	try {
		const pluginsRoot = join(ws.agentDir, ".plugins");
		await mkdir(pluginsRoot, { recursive: true });
		const staleLink = join(pluginsRoot, "old-plugin");
		await symlink(join(ws.root, "gone"), staleLink, "dir");

		await addPlugin(
			ws,
			"research-agent",
			validManifest("research-agent", [
				{ id: "research", entry: "./graphs/research.ts", export: "graph" },
			]),
			{ "graphs/research.ts": GRAPH_MODULE },
		);

		await linkPluginGraphs(linkOptions(ws));

		assert.throws(() => lstatSync(staleLink), /ENOENT/, "stale symlink must be removed");
		assert.ok(
			lstatSync(join(pluginsRoot, "research-agent")).isSymbolicLink(),
			"active link must survive",
		);
	} finally {
		await rm(ws.root, { recursive: true, force: true });
	}
});

test("skips a graph whose entry file is missing, keeping the other graph", async () => {
	const ws = await makeWorkspace();
	try {
		await addPlugin(
			ws,
			"partial-agent",
			validManifest("partial-agent", [
				{ id: "good", entry: "./graphs/good.ts", export: "graph" },
				{ id: "bad", entry: "./graphs/missing.ts", export: "graph" },
			]),
			{ "graphs/good.ts": GRAPH_MODULE },
		);

		const { result, warnings } = await captureWarnings(() =>
			linkPluginGraphs(linkOptions(ws)),
		);

		assert.deepEqual(
			result.registered.map((r) => r.key),
			["partial-agent.good"],
		);
		assert.equal(result.skipped, 1);
		assert.ok(
			warnings.some((w) => w.includes("entry file not found") && w.includes("missing.ts")),
			`expected a missing-entry warning, got: ${JSON.stringify(warnings)}`,
		);

		const config = JSON.parse(
			await readFile(join(ws.agentDir, "langgraph.json"), "utf8"),
		);
		assert.equal(config.graphs["partial-agent.good"] !== undefined, true);
		assert.equal(config.graphs["partial-agent.bad"], undefined);
	} finally {
		await rm(ws.root, { recursive: true, force: true });
	}
});

test("invalid plugin manifests do not throw and do not block other plugins", async () => {
	const ws = await makeWorkspace();
	try {
		// Bad JSON.
		await addPlugin(ws, "broken-json", "{ this is not json");
		// Missing capabilities (valid manifest, contributes no graphs).
		await addPlugin(ws, "no-caps", {
			id: "no-caps",
			name: "no-caps",
			version: "0.1.0",
			description: "no capabilities",
			engines: { puna: ">=0.1.0" },
		});
		// Graph entries that fail minimal validation.
		await addPlugin(ws, "bad-graphs", validManifest("bad-graphs", [
			{ id: "", entry: "./graphs/x.ts" },
			{ id: "escape", entry: "../../etc/passwd" },
		]));
		// Healthy plugin.
		await addPlugin(
			ws,
			"good-agent",
			validManifest("good-agent", [
				{ id: "work", entry: "./graphs/work.ts", export: "graph" },
			]),
			{ "graphs/work.ts": GRAPH_MODULE },
		);

		const { result, warnings } = await captureWarnings(() =>
			linkPluginGraphs(linkOptions(ws)),
		);

		assert.deepEqual(
			result.registered.map((r) => r.key),
			["good-agent.work"],
		);
		assert.ok(
			warnings.some((w) => w.includes("broken-json")),
			`expected bad-JSON warning, got: ${JSON.stringify(warnings)}`,
		);
		assert.ok(
			warnings.some((w) => w.includes("bad-graphs")),
			`expected bad-graph warning, got: ${JSON.stringify(warnings)}`,
		);

		const config = JSON.parse(
			await readFile(join(ws.agentDir, "langgraph.json"), "utf8"),
		);
		assert.equal(
			config.graphs["good-agent.work"],
			"./.plugins/good-agent/graphs/work.ts:graph",
		);
	} finally {
		await rm(ws.root, { recursive: true, force: true });
	}
});

test("preserves env from a pre-existing langgraph.json", async () => {
	const ws = await makeWorkspace();
	try {
		await writeFile(
			join(ws.agentDir, "langgraph.json"),
			`${JSON.stringify(
				{ graphs: { graph: "./src/base/graph.ts:graph" }, env: ".env.custom" },
				null,
				"\t",
			)}\n`,
			"utf8",
		);
		await addPlugin(
			ws,
			"research-agent",
			validManifest("research-agent", [
				{ id: "research", entry: "./graphs/research.ts", export: "graph" },
			]),
			{ "graphs/research.ts": GRAPH_MODULE },
		);

		await linkPluginGraphs(linkOptions(ws));

		const config = JSON.parse(
			await readFile(join(ws.agentDir, "langgraph.json"), "utf8"),
		);
		assert.equal(config.env, ".env.custom");
		assert.ok(config.graphs.graph);
		assert.ok(config.graphs["research-agent.research"]);
	} finally {
		await rm(ws.root, { recursive: true, force: true });
	}
});
