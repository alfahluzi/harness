import { describe, expect, test } from "bun:test";
import { PluginManifest } from "@puna/sdk-shared";
import { PermissionDeniedError, PermissionEnforcer } from "./permissions";

function makeManifest(permissions?: PluginManifest["permissions"]): PluginManifest {
	return PluginManifest.parse({
		id: "perm-plugin",
		name: "Permission Plugin",
		version: "1.0.0",
		description: "permission fixture",
		engines: { puna: ">=0.1.0" },
		...(permissions ? { permissions } : {}),
	});
}

describe("PermissionEnforcer", () => {
	test("empty permissions deny every action", () => {
		const enforcer = new PermissionEnforcer(makeManifest({}));
		expect(() => enforcer.check("fs.read", "docs")).toThrow(PermissionDeniedError);
		expect(() => enforcer.check("fs.write", "docs")).toThrow(PermissionDeniedError);
		expect(() => enforcer.check("net", "example.com")).toThrow(PermissionDeniedError);
		expect(() => enforcer.check("shell", "git")).toThrow(PermissionDeniedError);
	});

	test("missing permissions block entirely", () => {
		const enforcer = new PermissionEnforcer(makeManifest());
		expect(() => enforcer.check("fs.read", "docs")).toThrow(PermissionDeniedError);
	});

	test("fs.read: exact match allowed", () => {
		const enforcer = new PermissionEnforcer(makeManifest({ fs: { read: ["docs"] } }));
		expect(() => enforcer.check("fs.read", "docs")).not.toThrow();
	});

	test("fs.read: prefix match allowed", () => {
		const enforcer = new PermissionEnforcer(makeManifest({ fs: { read: ["docs"] } }));
		expect(() => enforcer.check("fs.read", "docs/api/readme.md")).not.toThrow();
	});

	test("fs.read: no match denied", () => {
		const enforcer = new PermissionEnforcer(makeManifest({ fs: { read: ["docs"] } }));
		expect(() => enforcer.check("fs.read", "secrets/env")).toThrow(PermissionDeniedError);
	});

	test("fs.write does not inherit fs.read grants", () => {
		const enforcer = new PermissionEnforcer(makeManifest({ fs: { read: ["docs"] } }));
		expect(() => enforcer.check("fs.write", "docs/out.md")).toThrow(PermissionDeniedError);
	});

	test("net: exact hostname allowed", () => {
		const enforcer = new PermissionEnforcer(
			makeManifest({ net: { hosts: ["api.example.com"] } }),
		);
		expect(() => enforcer.check("net", "api.example.com")).not.toThrow();
	});

	test("net: no match denied (subdomain is not a prefix grant)", () => {
		const enforcer = new PermissionEnforcer(
			makeManifest({ net: { hosts: ["api.example.com"] } }),
		);
		expect(() => enforcer.check("net", "evil.com")).toThrow(PermissionDeniedError);
		expect(() => enforcer.check("net", "sub.api.example.com")).toThrow(PermissionDeniedError);
	});

	test("shell: exact command allowed", () => {
		const enforcer = new PermissionEnforcer(
			makeManifest({ shell: [{ command: "git" }] }),
		);
		expect(() => enforcer.check("shell", "git")).not.toThrow();
	});

	test("shell: no match denied", () => {
		const enforcer = new PermissionEnforcer(
			makeManifest({ shell: [{ command: "git" }] }),
		);
		expect(() => enforcer.check("shell", "rm")).toThrow(PermissionDeniedError);
	});

	test("PermissionDeniedError exposes pluginId/action/target", () => {
		const enforcer = new PermissionEnforcer(makeManifest({}));
		try {
			enforcer.check("net", "example.com");
			throw new Error("expected throw");
		} catch (error) {
			expect(error).toBeInstanceOf(PermissionDeniedError);
			const denied = error as PermissionDeniedError;
			expect(denied.pluginId).toBe("perm-plugin");
			expect(denied.action).toBe("net");
			expect(denied.target).toBe("example.com");
		}
	});
});
