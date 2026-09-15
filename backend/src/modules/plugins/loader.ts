/**
 * Backend plugin module loader (Fase 4).
 *
 * `loadBackendModule` dynamically imports the capability entry declared in the
 * manifest (strategy §5.3) and resolves the exported value:
 *
 * - default export is a `BackendPlugin` object, OR
 * - default export is a factory function returning one, OR
 * - `capabilities.tools.export: "default.tools"` points at a bare tool factory.
 *
 * Returns `null` when the plugin declares no backend-side capability. Import
 * and resolution errors are wrapped with the plugin id + entry path so
 * `PluginHost.discoverAndLoad` can store a meaningful `loadError`.
 *
 * Uses `await import(absolutePath)` — Bun resolves runtime TypeScript natively.
 */
import { join } from "node:path";
import type { PluginManifest } from "@puna/sdk-shared";
import type { BackendPlugin, StructuredTool, ToolsConfig } from "./contract";

type ModuleNamespace = Record<string, unknown>;

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function loadError(pluginId: string, entry: string, detail: string, cause?: unknown): Error {
	return new Error(`Plugin "${pluginId}": ${detail} (entry: ${entry})`, { cause });
}

async function importModule(absPath: string, pluginId: string): Promise<ModuleNamespace> {
	try {
		return (await import(absPath)) as ModuleNamespace;
	} catch (error) {
		throw loadError(
			pluginId,
			absPath,
			`failed to import backend entry: ${messageOf(error)}`,
			error,
		);
	}
}

/** Walk a dotted export path (`default`, `plugin`, `default.tools`). */
function resolveExport(
	mod: ModuleNamespace,
	exportSpec: string,
	pluginId: string,
	absPath: string,
): unknown {
	let current: unknown = mod;
	for (const key of exportSpec.split(".")) {
		if (
			current === null ||
			current === undefined ||
			(typeof current !== "object" && typeof current !== "function")
		) {
			throw loadError(
				pluginId,
				absPath,
				`export "${exportSpec}" is not reachable (missing "${key}")`,
			);
		}
		current = (current as Record<string, unknown>)[key];
	}
	if (current === undefined) {
		throw loadError(pluginId, absPath, `export "${exportSpec}" resolved to undefined`);
	}
	return current;
}

/** Normalize an exported value into a `BackendPlugin` instance. */
async function toInstance(
	value: unknown,
	manifest: PluginManifest,
	exportSpec: string,
	absPath: string,
): Promise<BackendPlugin> {
	let candidate = value;
	if (typeof candidate === "function") {
		try {
			candidate = await (candidate as () => unknown)();
		} catch (error) {
			throw loadError(
				manifest.id,
				absPath,
				`factory export "${exportSpec}" threw: ${messageOf(error)}`,
				error,
			);
		}
	}
	if (candidate === null || typeof candidate !== "object") {
		throw loadError(
			manifest.id,
			absPath,
			`export "${exportSpec}" must be a BackendPlugin object or a factory returning one`,
		);
	}
	const instance = candidate as BackendPlugin;
	if (typeof instance.id === "string" && instance.id.length > 0) return instance;
	return { ...instance, id: manifest.id };
}

/**
 * `capabilities.tools` with `export: "default.tools"` names a bare tool
 * factory. The factory is not called here — `PluginHost.getTools()` invokes it
 * per host call. When the factory lives on an object (`default.tools`), the
 * owning object is preserved as `this` so method-style factories keep working.
 */
function toToolsPart(
	value: unknown,
	owner: unknown,
	manifest: PluginManifest,
	exportSpec: string,
	absPath: string,
): BackendPlugin {
	if (typeof value !== "function") {
		throw loadError(
			manifest.id,
			absPath,
			`tools export "${exportSpec}" must be a function returning StructuredTool[]`,
		);
	}
	const factory = value as (config: ToolsConfig) => StructuredTool[];
	const bound =
		owner !== null && typeof owner === "object"
			? (config: ToolsConfig) => factory.call(owner, config)
			: factory;
	return { id: manifest.id, tools: bound };
}

function mergeParts(parts: BackendPlugin[], id: string): BackendPlugin {
	const merged: BackendPlugin = { id };
	for (const part of parts) {
		if (part.transformSystemPrompt) merged.transformSystemPrompt = part.transformSystemPrompt;
		if (part.beforeNode) merged.beforeNode = part.beforeNode;
		if (part.afterNode) merged.afterNode = part.afterNode;
		if (part.extraAgents) merged.extraAgents = part.extraAgents;
		if (part.overrideAgentConf) merged.overrideAgentConf = part.overrideAgentConf;
		if (part.tools) merged.tools = part.tools;
	}
	return merged;
}

/**
 * Load the backend module for `manifest` from `resolvedDir`.
 *
 * @returns the plugin instance, or `null` when neither `capabilities.backendHooks`
 *          nor `capabilities.tools` is declared.
 * @throws Error (message includes plugin id + entry path) on import/factory failure.
 */
export async function loadBackendModule(
	resolvedDir: string,
	manifest: PluginManifest,
): Promise<BackendPlugin | null> {
	const capabilities = manifest.capabilities;
	const hooksCapability = capabilities?.backendHooks;
	const toolsCapability = capabilities?.tools;
	if (!hooksCapability && !toolsCapability) return null;

	const parts: BackendPlugin[] = [];
	const moduleCache = new Map<string, ModuleNamespace>();

	const loadModule = async (absPath: string): Promise<ModuleNamespace> => {
		const cached = moduleCache.get(absPath);
		if (cached) return cached;
		const mod = await importModule(absPath, manifest.id);
		moduleCache.set(absPath, mod);
		return mod;
	};

	if (hooksCapability) {
		const absPath = join(resolvedDir, hooksCapability.entry);
		const exportSpec = hooksCapability.export ?? "default";
		const mod = await loadModule(absPath);
		const value = resolveExport(mod, exportSpec, manifest.id, absPath);
		parts.push(await toInstance(value, manifest, exportSpec, absPath));
	}

	if (toolsCapability) {
		const absPath = join(resolvedDir, toolsCapability.entry);
		const exportSpec = toolsCapability.export ?? "default";
		const mod = await loadModule(absPath);
		const value = resolveExport(mod, exportSpec, manifest.id, absPath);
		if (exportSpec.split(".").pop() === "tools") {
			const parentSpec = exportSpec.slice(0, exportSpec.lastIndexOf("."));
			const owner = parentSpec
				? resolveExport(mod, parentSpec, manifest.id, absPath)
				: undefined;
			parts.push(toToolsPart(value, owner, manifest, exportSpec, absPath));
		} else {
			parts.push(await toInstance(value, manifest, exportSpec, absPath));
		}
	}

	return mergeParts(parts, manifest.id);
}
