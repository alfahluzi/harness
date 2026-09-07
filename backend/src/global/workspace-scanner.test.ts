import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeLayered, resolveSource, scanLayer } from "./workspace-scanner";

let tmpRoot: string;

beforeEach(async () => {
	tmpRoot = await mkdtemp(join(tmpdir(), "puna-scanner-"));
});

afterEach(async () => {
	await rm(tmpRoot, { recursive: true, force: true });
});

async function makeEntry(baseDir: string, name: string, marker = "desc.md") {
	const dir = join(baseDir, name);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, marker), `# ${name}\ndesc`);
}

describe("scanLayer", () => {
	test("returns empty set when dir is null", async () => {
		const result = await scanLayer(null, "desc.md");
		expect(result.size).toBe(0);
	});

	test("returns empty set when dir does not exist", async () => {
		const result = await scanLayer("/nonexistent/path", "desc.md");
		expect(result.size).toBe(0);
	});

	test("includes only entries with marker file", async () => {
		const dir = join(tmpRoot, "skills");
		await mkdir(join(dir, "with-marker"), { recursive: true });
		await writeFile(join(dir, "with-marker", "desc.md"), "x");
		await mkdir(join(dir, "no-marker"), { recursive: true });

		const result = await scanLayer(dir, "desc.md");
		expect([...result].sort()).toEqual(["with-marker"]);
	});

	test("ignores stray files", async () => {
		const dir = join(tmpRoot, "skills");
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "stray.txt"), "x");
		await mkdir(join(dir, "real"), { recursive: true });
		await writeFile(join(dir, "real", "desc.md"), "y");

		const result = await scanLayer(dir, "desc.md");
		expect([...result]).toEqual(["real"]);
	});
});

describe("mergeLayered", () => {
	test("empty when both layers null", async () => {
		const result = await mergeLayered(null, null, "desc.md");
		expect(result).toEqual([]);
	});

	test("global-only entries", async () => {
		const globalDir = join(tmpRoot, "global", "skills");
		await makeEntry(globalDir, "alpha");
		await makeEntry(globalDir, "beta");

		const result = await mergeLayered(null, globalDir, "desc.md");
		expect(result).toEqual([
			{ name: "alpha", source: "global", dir: join(globalDir, "alpha") },
			{ name: "beta", source: "global", dir: join(globalDir, "beta") },
		]);
	});

	test("local-only entries", async () => {
		const localDir = join(tmpRoot, "local", "skills");
		await makeEntry(localDir, "alpha");

		const result = await mergeLayered(localDir, null, "desc.md");
		expect(result).toEqual([
			{ name: "alpha", source: "local", dir: join(localDir, "alpha") },
		]);
	});

	test("collision → local wins", async () => {
		const localDir = join(tmpRoot, "local", "skills");
		const globalDir = join(tmpRoot, "global", "skills");
		await makeEntry(localDir, "shared");
		await makeEntry(globalDir, "shared");
		await makeEntry(globalDir, "global-only");

		const result = await mergeLayered(localDir, globalDir, "desc.md");
		const shared = result.find((r) => r.name === "shared");
		expect(shared?.source).toBe("local");
		expect(shared?.dir).toBe(join(localDir, "shared"));
		expect(result).toHaveLength(2);
	});

	test("additive for different names", async () => {
		const localDir = join(tmpRoot, "local", "skills");
		const globalDir = join(tmpRoot, "global", "skills");
		await makeEntry(localDir, "local-only");
		await makeEntry(globalDir, "global-only");

		const result = await mergeLayered(localDir, globalDir, "desc.md");
		expect(result).toHaveLength(2);
		expect(result.map((r) => r.source).sort()).toEqual(["global", "local"]);
	});

	test("sorted alphabetically regardless of layer", async () => {
		const localDir = join(tmpRoot, "local", "skills");
		const globalDir = join(tmpRoot, "global", "skills");
		await makeEntry(localDir, "zebra");
		await makeEntry(globalDir, "alpha");
		await makeEntry(globalDir, "mike");

		const result = await mergeLayered(localDir, globalDir, "desc.md");
		expect(result.map((r) => r.name)).toEqual(["alpha", "mike", "zebra"]);
	});
});

describe("resolveSource", () => {
	test("returns null when not found in either layer", async () => {
		const result = resolveSource(null, null, "ghost", "desc.md");
		expect(result).toBeNull();
	});

	test("prefers local over global when both have it", async () => {
		const localDir = join(tmpRoot, "local", "skills");
		const globalDir = join(tmpRoot, "global", "skills");
		await makeEntry(localDir, "shared");
		await makeEntry(globalDir, "shared");

		const result = resolveSource(localDir, globalDir, "shared", "desc.md");
		expect(result?.source).toBe("local");
		expect(result?.dir).toBe(join(localDir, "shared"));
	});

	test("falls back to global when local missing", async () => {
		const globalDir = join(tmpRoot, "global", "skills");
		await makeEntry(globalDir, "only-global");

		const result = resolveSource(null, globalDir, "only-global", "desc.md");
		expect(result?.source).toBe("global");
		expect(result?.dir).toBe(join(globalDir, "only-global"));
	});

	test("returns null when local has dir but no marker", async () => {
		const localDir = join(tmpRoot, "local", "skills");
		await mkdir(join(localDir, "broken"), { recursive: true });

		const result = resolveSource(localDir, null, "broken", "desc.md");
		expect(result).toBeNull();
	});
});