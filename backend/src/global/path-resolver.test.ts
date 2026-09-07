import { describe, expect, test } from "bun:test";
import { PathResolver } from "./path-resolver";

describe("PathResolver", () => {
	const r = new PathResolver("/home/user/project");

	describe("resolve", () => {
		test("relative path → absolute under root", () => {
			expect(r.resolve("src/index.ts")).toBe("/home/user/project/src/index.ts");
		});

		test("nested relative path", () => {
			expect(r.resolve("src/components/Button.tsx")).toBe(
				"/home/user/project/src/components/Button.tsx",
			);
		});

		test("absolute path is normalized against root (not concatenated)", () => {
			expect(r.resolve("/etc/passwd")).toBe("/etc/passwd");
		});

		test("dot segments collapse", () => {
			expect(r.resolve("src/../README.md")).toBe("/home/user/project/README.md");
		});
	});

	describe("relative", () => {
		test("absolute under root → relative", () => {
			expect(r.relative("/home/user/project/src/index.ts")).toBe("src/index.ts");
		});

		test("absolute == root → ''", () => {
			expect(r.relative("/home/user/project")).toBe("");
		});

		test("absolute outside root → starts with '..'", () => {
			expect(r.relative("/etc/passwd").startsWith("..")).toBe(true);
		});
	});

	describe("isInside", () => {
		test("path under root → true", () => {
			expect(r.isInside("/home/user/project/src/index.ts")).toBe(true);
		});

		test("path == root → true", () => {
			expect(r.isInside("/home/user/project")).toBe(true);
		});

		test("path outside root → false", () => {
			expect(r.isInside("/etc/passwd")).toBe(false);
		});

		test("sibling directory sharing prefix → false", () => {
			expect(r.isInside("/home/user/project-other/foo")).toBe(false);
		});
	});
});