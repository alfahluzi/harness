/**
 * Fase 5 end-to-end: real `PluginHost` + real `loadBackendModule` against the
 * `templates/plugin/logging-hook` sample plugin copied into a temp workspace.
 *
 * The manifest is strict-parsed by `PluginManifest` from `@puna/sdk-shared`
 * before the host loads the plugin with Bun's native TS import.
 */
import { describe, expect, spyOn, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginManifest } from "@puna/sdk-shared";
import { PluginHost } from "./host";

/** `<repo>/templates/plugin/logging-hook` (4 levels up from this test file). */
const TEMPLATE_DIR = join(
	import.meta.dir,
	"..",
	"..",
	"..",
	"..",
	"templates",
	"plugin",
	"logging-hook",
);

describe("plugins hooks integration (real loader + sample template)", () => {
	test("logging-hook template loads and runs beforeNode/afterNode", async () => {
		const raw = await readFile(join(TEMPLATE_DIR, "plugin.json"), "utf8");
		const manifest = PluginManifest.parse(JSON.parse(raw));
		expect(manifest.id).toBe("logging-hook");
		expect(manifest.capabilities?.backendHooks?.entry).toBeTruthy();

		const tmp = await mkdtemp(join(tmpdir(), "punahooks-"));
		const configDir = join(tmp, ".puna");
		const pluginDir = join(configDir, "plugins", "logging-hook");
		try {
			// `loadWorkspaceContext` requires `<configDir>/config.json`.
			await mkdir(pluginDir, { recursive: true });
			await writeFile(
				join(configDir, "config.json"),
				JSON.stringify({ id: "punahooks-integration", version: 1 }),
				"utf8",
			);
			await cp(join(TEMPLATE_DIR, "plugin.json"), join(pluginDir, "plugin.json"));
			await cp(join(TEMPLATE_DIR, "backend", "index.ts"), join(pluginDir, "backend", "index.ts"));

			const host = new PluginHost();
			await host.discoverAndLoad(configDir);

			expect(host.getLifecycleHooks()).toContainEqual({
				id: "logging-hook",
				beforeNode: true,
				afterNode: true,
			});

			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const before = await host.runNodeHook("beforeNode", "call_model", { messages: [] }, {});
				const after = await host.runNodeHook(
					"afterNode",
					"call_model",
					{ messages: [{ role: "user" }] },
					{},
				);

				expect(before).toEqual({ patch: null, invoked: 1, dropped: 0 });
				expect(after).toEqual({ patch: null, invoked: 1, dropped: 0 });

				const lines = logSpy.mock.calls.map((args) => args.map(String).join(" "));
				const hookLines = lines.filter(
					(line) => line.includes("logging-hook") && line.includes("call_model"),
				);
				// Both hook invocations log a line naming the plugin + node.
				expect(hookLines.length).toBeGreaterThanOrEqual(2);
			} finally {
				logSpy.mockRestore();
			}
		} finally {
			await rm(tmp, { recursive: true, force: true });
		}
	});
});
