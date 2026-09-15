/**
 * Smoke tests for the `puna plugin` CLI: argument parsing, name validation,
 * and dispatch/exit codes. No filesystem mutation — scaffolding/bundling are
 * covered by the Fase 7 verification runbook.
 */
import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isValidPluginName, titleCase } from "./args";
import { BUNDLE_EXTERNALS, DEFAULT_BUDGET_KB, parseBuildArgs } from "./build";
import { parseCreateArgs } from "./create";
import { defaultBackendUrl, isIgnored, parseDevArgs, pluginOf } from "./dev";
import { UsageError } from "./errors";
import { CLI_VERSION, runCli } from "./index";

const DIR = tmpdir();

describe("plugin name validation", () => {
	test("accepts kebab-case names", () => {
		for (const name of ["a", "my-notes", "a1", "sticky-notes-2", "x-9-y"]) {
			expect(isValidPluginName(name)).toBe(true);
		}
	});

	test("rejects non-kebab names", () => {
		for (const name of ["My_Notes", "MyNotes", "1notes", "-notes", "", "my notes", "notes_2"]) {
			expect(isValidPluginName(name)).toBe(false);
		}
	});

	test("title-cases for the manifest name", () => {
		expect(titleCase("my-notes")).toBe("My Notes");
		expect(titleCase("sticky-notes-2")).toBe("Sticky Notes 2");
		expect(titleCase("a")).toBe("A");
	});
});

describe("create args", () => {
	test("defaults to sticky-notes and nearest workspace", () => {
		const options = parseCreateArgs(["my-notes", "--dir", DIR]);
		expect(options.name).toBe("my-notes");
		expect(options.archetype).toBe("sticky-notes");
		expect(options.force).toBe(false);
	});

	test("parses --from/--force", () => {
		const options = parseCreateArgs(["my-hook", "--from", "logging-hook", "--dir", DIR, "--force"]);
		expect(options.archetype).toBe("logging-hook");
		expect(options.force).toBe(true);
	});

	test("rejects invalid names with a usage error", () => {
		expect(() => parseCreateArgs(["My_Notes", "--dir", DIR])).toThrow(UsageError);
	});

	test("rejects unknown archetypes and flags", () => {
		expect(() => parseCreateArgs(["notes", "--from", "nope", "--dir", DIR])).toThrow(UsageError);
		expect(() => parseCreateArgs(["notes", "--bogus", "--dir", DIR])).toThrow(UsageError);
	});
});

describe("dev args", () => {
	test("parses name, backend, and --no-warm", () => {
		const options = parseDevArgs(["my-notes", "--dir", DIR, "--backend", "http://localhost:9999/", "--no-warm"]);
		expect(options.name).toBe("my-notes");
		expect(options.backend).toBe("http://localhost:9999");
		expect(options.warm).toBe(false);
	});

	test("omitting name watches all plugins", () => {
		const options = parseDevArgs(["--dir", DIR]);
		expect(options.name).toBeUndefined();
		expect(options.warm).toBe(true);
	});

	test("default backend honours PUNA_BACKEND_URL", () => {
		const previous = process.env.PUNA_BACKEND_URL;
		process.env.PUNA_BACKEND_URL = "http://example.test:1234";
		try {
			expect(defaultBackendUrl()).toBe("http://example.test:1234");
		} finally {
			if (previous === undefined) delete process.env.PUNA_BACKEND_URL;
			else process.env.PUNA_BACKEND_URL = previous;
		}
	});

	test("filters node_modules and resolves the plugin segment", () => {
		expect(isIgnored("my-notes/node_modules/react/index.js")).toBe(true);
		expect(isIgnored("my-notes/ui/index.tsx")).toBe(false);
		expect(pluginOf("my-notes/ui/index.tsx")).toBe("my-notes");
	});
});

describe("build args", () => {
	test("defaults", () => {
		const options = parseBuildArgs(["--dir", DIR]);
		expect(options.name).toBeUndefined();
		expect(options.minify).toBe(false);
		expect(options.updateManifest).toBe(false);
		expect(options.budgetKb).toBe(DEFAULT_BUDGET_KB);
	});

	test("parses all flags", () => {
		const options = parseBuildArgs(["notes", "--dir", DIR, "--minify", "--update-manifest", "--budget-kb", "120"]);
		expect(options.name).toBe("notes");
		expect(options.minify).toBe(true);
		expect(options.updateManifest).toBe(true);
		expect(options.budgetKb).toBe(120);
	});

	test("rejects a non-numeric budget", () => {
		expect(() => parseBuildArgs(["--budget-kb", "big", "--dir", DIR])).toThrow(UsageError);
	});

	test("externals match the backend ui-bundle route", () => {
		expect([...BUNDLE_EXTERNALS]).toEqual([
			"react",
			"react-dom",
			"react/jsx-runtime",
			"react-dom/client",
			"@tanstack/react-router",
		]);
	});
});

describe("dispatch exit codes", () => {
	test("CLI_VERSION is exported", () => {
		expect(CLI_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
	});

	test("--help exits 0", async () => {
		expect(await runCli(["--help"])).toBe(0);
		expect(await runCli(["create", "--help"])).toBe(0);
		expect(await runCli(["dev", "--help"])).toBe(0);
		expect(await runCli(["build", "--help"])).toBe(0);
	});

	test("no args / unknown command exits 2", async () => {
		expect(await runCli([])).toBe(2);
		expect(await runCli(["nope"])).toBe(2);
	});

	test("invalid name exits 2", async () => {
		expect(await runCli(["create", "My_Notes", "--dir", DIR])).toBe(2);
	});
});
