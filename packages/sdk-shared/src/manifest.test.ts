import { describe, expect, test } from "bun:test";
import {
	PluginManifest,
	PluginSummary,
	type PluginManifest as PluginManifestType,
} from "./manifest";
import { PluginSource } from "./source";

function minimalManifest(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		id: "com.example.notes",
		name: "Notes",
		version: "0.1.0",
		description: "Sticky notes panel in the left bar.",
		engines: { puna: ">=0.2.0" },
		...overrides,
	};
}

function fullManifest() {
	return {
		$schema: "https://puna.dev/schemas/plugin.v1.json",
		id: "com.example.notes",
		name: "Notes",
		version: "0.1.0-alpha.1",
		description: "Sticky notes panel in the left bar.",
		author: "Aldi",
		license: "MIT",
		engines: { puna: ">=0.2.0" },
		capabilities: {
			leftBar: { entry: "ui/index.js", export: "leftBar" },
			footerBar: { entry: "ui/index.js", export: "footerBar" },
			chatRenderers: { entry: "ui/index.js", export: "chatRenderers" },
			toolUi: { entry: "ui/index.js", export: "toolUi" },
			backendHooks: { entry: "backend/index.ts" },
			tools: { entry: "backend/index.ts", export: "default.tools" },
			graphs: [
				{
					id: "notes-agent",
					entry: "graphs/notes-agent.ts",
					export: "graph",
					alias: "notes",
					namespace: "com.example.notes",
				},
			],
		},
		permissions: {
			fs: {
				read: ["${workspace}/notes"],
				write: ["${workspace}/notes"],
			},
			net: { hosts: ["api.example.com"] },
			shell: [{ command: "git", args: ["status"] }],
		},
	};
}

function parseIssues(result: {
	success: boolean;
	error?: { issues: { message: string }[] };
}): string[] {
	return result.error?.issues.map((issue) => issue.message) ?? [];
}

describe("PluginManifest", () => {
	test("parses a valid minimal manifest", () => {
		const parsed = PluginManifest.parse(minimalManifest());
		expect(parsed.id).toBe("com.example.notes");
		expect(parsed.version).toBe("0.1.0");
		expect(parsed.engines.puna).toBe(">=0.2.0");
	});

	test("parses a valid full manifest with capabilities, graphs, permissions", () => {
		const parsed = PluginManifest.parse(fullManifest());
		expect(parsed.capabilities?.leftBar?.entry).toBe("ui/index.js");
		expect(parsed.capabilities?.tools?.export).toBe("default.tools");
		expect(parsed.capabilities?.graphs?.[0]?.id).toBe("notes-agent");
		expect(parsed.capabilities?.graphs?.[0]?.export).toBe("graph");
		expect(parsed.permissions?.shell?.[0]?.command).toBe("git");
	});

	test("rejects unknown top-level field in strict mode", () => {
		const result = PluginManifest.safeParse(
			minimalManifest({ bogusField: true }),
		);
		expect(result.success).toBe(false);
		expect(parseIssues(result).join(" ")).toContain("bogusField");
	});

	test("rejects unknown field inside capabilities in strict mode", () => {
		const result = PluginManifest.safeParse(
			minimalManifest({
				capabilities: { leftBar: { entry: "ui/index.js" }, nope: true },
			}),
		);
		expect(result.success).toBe(false);
		expect(parseIssues(result).join(" ")).toContain("nope");
	});

	test("semver: 1.2 rejected, 1.2.3 accepted, 1.2.3-alpha.1 accepted", () => {
		expect(PluginManifest.safeParse(minimalManifest({ version: "1.2" })).success).toBe(false);
		expect(PluginManifest.safeParse(minimalManifest({ version: "1.2.3" })).success).toBe(true);
		expect(
			PluginManifest.safeParse(minimalManifest({ version: "1.2.3-alpha.1" })).success,
		).toBe(true);
	});

	test("rejects path traversal in capabilities.leftBar.entry", () => {
		const result = PluginManifest.safeParse(
			minimalManifest({
				capabilities: { leftBar: { entry: "../../etc/passwd" } },
			}),
		);
		expect(result.success).toBe(false);
		expect(parseIssues(result).join(" ")).toContain("..");
	});

	test("rejects absolute POSIX path in entry", () => {
		expect(
			PluginManifest.safeParse(
				minimalManifest({
					capabilities: { leftBar: { entry: "/abs/path" } },
				}),
			).success,
		).toBe(false);
	});

	test("rejects Windows drive-letter path in entry", () => {
		expect(
			PluginManifest.safeParse(
				minimalManifest({
					capabilities: { leftBar: { entry: "C:\\evil" } },
				}),
			).success,
		).toBe(false);
	});

	test("rejects NUL byte in entry", () => {
		expect(
			PluginManifest.safeParse(
				minimalManifest({
					capabilities: { leftBar: { entry: "ui/\0index.js" } },
				}),
			).success,
		).toBe(false);
	});

	test("rejects path traversal in graphs[].entry", () => {
		expect(
			PluginManifest.safeParse(
				minimalManifest({
					capabilities: {
						graphs: [{ id: "evil", entry: "../outside.ts" }],
					},
				}),
			).success,
		).toBe(false);
	});

	test("graphs[].export defaults to 'graph' when omitted", () => {
		const result = PluginManifest.safeParse(
			minimalManifest({
				capabilities: { graphs: [{ id: "notes-agent", entry: "graphs/notes.ts" }] },
			}),
		);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.capabilities?.graphs?.[0]?.export).toBe("graph");
		}
	});

	test("rejects invalid graph id", () => {
		expect(
			PluginManifest.safeParse(
				minimalManifest({
					capabilities: { graphs: [{ id: "Notes_Agent", entry: "graphs/a.ts" }] },
				}),
			).success,
		).toBe(false);
	});

	test("rejects tools.export other than 'default.tools'", () => {
		expect(
			PluginManifest.safeParse(
				minimalManifest({
					capabilities: { tools: { entry: "backend/index.ts", export: "tools" } },
				}),
			).success,
		).toBe(false);
	});
});

describe("PluginSummary", () => {
	const summary = {
		id: "com.example.notes",
		name: "Notes",
		version: "0.1.0",
		description: "Sticky notes.",
		resolvedDir: "/home/u/.puna/plugins/notes",
		kind: "ui",
	};

	test("parses with every valid source value", () => {
		for (const source of PluginSource.options) {
			const parsed = PluginSummary.safeParse({ ...summary, source });
			expect(parsed.success).toBe(true);
		}
	});

	test("rejects unknown source value", () => {
		const result = PluginSummary.safeParse({ ...summary, source: "remote" });
		expect(result.success).toBe(false);
	});

	test("rejects unknown kind value", () => {
		expect(PluginSummary.safeParse({ ...summary, source: "workspace-local", kind: "other" }).success).toBe(
			false,
		);
	});
});

// Type-level smoke check: exported type must align with the inferred schema.
const _typecheck: PluginManifestType = PluginManifest.parse(minimalManifest());
void _typecheck;
