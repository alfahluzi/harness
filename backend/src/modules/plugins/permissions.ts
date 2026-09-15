/**
 * Permission enforcement for plugin backend modules (Fase 4, strategy §8).
 *
 * The manifest declares the allow-list; `PermissionEnforcer` is the runtime
 * check. v1 trust model is "plugin = user-installed = trusted", so enforcement
 * is opt-in per tool (`PluginHost.enforceTools()`); this module provides the
 * mechanism, `host.ts` decides when to consult it.
 */
import type { PluginManifest } from "@puna/sdk-shared";

export type PermissionAction = "fs.read" | "fs.write" | "net" | "shell";

export class PermissionDeniedError extends Error {
	readonly pluginId: string;
	readonly action: PermissionAction;
	readonly target: string;

	constructor(pluginId: string, action: PermissionAction, target: string) {
		super(`Plugin "${pluginId}" not permitted: ${action} on "${target}"`);
		this.name = "PermissionDeniedError";
		this.pluginId = pluginId;
		this.action = action;
		this.target = target;
	}
}

/**
 * Manifest path patterns are `safeRelativePath` (no leading `/`, no `..`).
 * Normalize cwd-relative spellings (`./docs`, `docs/`) before matching so the
 * declared pattern and the runtime target compare on the same form.
 */
function normalizePath(value: string): string {
	let out = value;
	while (out.startsWith("./")) out = out.slice(2);
	while (out.endsWith("/") && out.length > 1) out = out.slice(0, -1);
	return out;
}

function matchesPath(patterns: string[] | undefined, target: string): boolean {
	if (!patterns || patterns.length === 0) return false;
	const normalizedTarget = normalizePath(target);
	return patterns.some((pattern) => {
		const normalizedPattern = normalizePath(pattern);
		return (
			normalizedTarget === normalizedPattern ||
			normalizedTarget.startsWith(`${normalizedPattern}/`)
		);
	});
}

function matchesExact(allowed: string[] | undefined, target: string): boolean {
	if (!allowed || allowed.length === 0) return false;
	return allowed.includes(target);
}

export class PermissionEnforcer {
	private readonly manifest: PluginManifest;

	constructor(manifest: PluginManifest) {
		this.manifest = manifest;
	}

	/** Throws `PermissionDeniedError` when `action` on `target` is not declared. */
	check(action: PermissionAction, target: string): void {
		if (this.isAllowed(action, target)) return;
		throw new PermissionDeniedError(this.manifest.id, action, target);
	}

	private isAllowed(action: PermissionAction, target: string): boolean {
		const permissions = this.manifest.permissions;
		switch (action) {
			case "fs.read":
				return matchesPath(permissions?.fs?.read, target);
			case "fs.write":
				return matchesPath(permissions?.fs?.write, target);
			case "net":
				return matchesExact(permissions?.net?.hosts, target);
			case "shell":
				return (
					permissions?.shell?.some((entry) => entry.command === target) ?? false
				);
		}
	}
}
