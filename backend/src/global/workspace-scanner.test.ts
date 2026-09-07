import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import {
	mergeLayered,
	resolveSource,
	scanLayer,
	findWorkspaceDirs,
	expandTilde,
} from "./workspace-scanner";

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

describe("expandTilde", () => {
	test("expands bare ~ to homedir", () => {
		expect(expandTilde("~")).toBe(homedir());
	});
	test("expands ~/sub to homedir/sub", () => {
		expect(expandTilde("~/projects")).toBe(join(homedir(), "projects"));
	});
	test("leaves absolute paths alone", () => {
		expect(expandTilde("/tmp/x")).toBe("/tmp/x");
	});
	test("leaves bare names alone", () => {
		expect(expandTilde("foo")).toBe("foo");
	});
});

describe("findWorkspaceDirs", () => {
	async function makeWorkspace(parent: string, name: string) {
		const punaDir = join(parent, ".puna");
		await mkdir(punaDir, { recursive: true });
		if (name) await writeFile(join(punaDir, "config.json"), JSON.stringify({ id: name }));
		return punaDir;
	}

	test("returns empty when root does not exist", async () => {
		const result = await findWorkspaceDirs("/nonexistent/path/that/is/not/there");
		expect(result).toEqual([]);
	});

	test("returns empty when no .puna present", async () => {
		await mkdir(join(tmpRoot, "empty-project"), { recursive: true });
		const result = await findWorkspaceDirs(tmpRoot);
		expect(result).toEqual([]);
	});

	test("finds a single .puna at root level", async () => {
		const puna = await makeWorkspace(tmpRoot, "alpha");
		const result = await findWorkspaceDirs(tmpRoot);
		expect(result).toEqual([puna]);
	});

	test("finds nested .puna dirs", async () => {
		const a = await makeWorkspace(join(tmpRoot, "a"), "a");
		const b = await makeWorkspace(join(tmpRoot, "a", "b"), "b");
		const result = await findWorkspaceDirs(tmpRoot);
		expect(result.sort()).toEqual([a, b].sort());
	});

	test("does not descend into a found .puna", async () => {
		const outer = await makeWorkspace(tmpRoot, "outer");
		// place a .puna inside .puna — should NOT be picked up
		await makeWorkspace(join(outer, "sub"), "inner");
		const result = await findWorkspaceDirs(tmpRoot);
		expect(result).toEqual([outer]);
	});

	test("skips node_modules and .git", async () => {
		const real = await makeWorkspace(tmpRoot, "real");
		await makeWorkspace(join(tmpRoot, "node_modules", "pkg"), "nm");
		await makeWorkspace(join(tmpRoot, ".git"), "git");
		const result = await findWorkspaceDirs(tmpRoot);
		expect(result).toEqual([real]);
	});

	test("skips other ignored dirs (dist, build, target, ...)", async () => {
		const real = await makeWorkspace(tmpRoot, "real");
		for (const d of ["dist", "build", "target", ".venv", "__pycache__", ".next", ".cache"]) {
			await makeWorkspace(join(tmpRoot, d), d);
		}
		const result = await findWorkspaceDirs(tmpRoot);
		expect(result).toEqual([real]);
	});

	test("skips hidden (non-marker) dirs", async () => {
		const real = await makeWorkspace(tmpRoot, "real");
		await mkdir(join(tmpRoot, ".hidden"), { recursive: true });
		await writeFile(join(tmpRoot, ".hidden", "x"), "x");
		const result = await findWorkspaceDirs(tmpRoot);
		expect(result).toEqual([real]);
	});

	test("respects maxDepth", async () => {
		await makeWorkspace(join(tmpRoot, "a"), "a");
		await makeWorkspace(join(tmpRoot, "a", "b"), "b");
		await makeWorkspace(join(tmpRoot, "a", "b", "c"), "c");
		const shallow = await findWorkspaceDirs(tmpRoot, ".puna", { maxDepth: 2 });
		const deep = await findWorkspaceDirs(tmpRoot, ".puna", { maxDepth: 4 });
		expect(shallow.length).toBeLessThan(deep.length);
		expect(deep.length).toBe(3);
	});

	test("custom ignoreDirs overrides defaults", async () => {
		const real = await makeWorkspace(tmpRoot, "real");
		const vendorPuna = await makeWorkspace(join(tmpRoot, "vendor"), "vendor");
		const defaultScan = await findWorkspaceDirs(tmpRoot);
		expect(defaultScan.sort()).toEqual([real, vendorPuna].sort());
		const customScan = await findWorkspaceDirs(tmpRoot, ".puna", {
			ignoreDirs: new Set(["vendor"]),
		});
		expect(customScan).toEqual([real]);
	});

	test("does not follow symlinks", async () => {
		const real = await makeWorkspace(tmpRoot, "real");
		// symlink -> real; if followed, the .puna inside would be visited again (no-op)
		// but a symlink named ".puna" itself must not be followed as a directory entry
		try {
			await symlink(join(tmpRoot, "real", ".puna"), join(tmpRoot, ".puna"), "dir");
		} catch {
			// some CI filesystems forbid symlinks; skip silently
			const result = await findWorkspaceDirs(tmpRoot);
			expect(result).toEqual([real]);
			return;
		}
		const result = await findWorkspaceDirs(tmpRoot);
		// The symlinked .puna is NOT counted (we skip symlinks)
		expect(result).toEqual([real]);
	});

	test("returns sorted paths", async () => {
		await makeWorkspace(join(tmpRoot, "z"), "z");
		await makeWorkspace(join(tmpRoot, "a"), "a");
		await makeWorkspace(join(tmpRoot, "m"), "m");
		const result = await findWorkspaceDirs(tmpRoot);
		const sorted = [...result].sort();
		expect(result).toEqual(sorted);
	});

	test("custom marker", async () => {
		await mkdir(join(tmpRoot, "ws1", ".nusa"), { recursive: true });
		await mkdir(join(tmpRoot, "ws2", ".nusa"), { recursive: true });
		const result = await findWorkspaceDirs(tmpRoot, ".nusa");
		expect(result.sort()).toEqual(
			[join(tmpRoot, "ws1", ".nusa"), join(tmpRoot, "ws2", ".nusa")].sort(),
		);
	});
});