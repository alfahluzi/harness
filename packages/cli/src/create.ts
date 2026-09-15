/**
 * `puna plugin create <name> [--from <archetype>] [--dir <dir>] [--force]`
 *
 * Copies `templates/plugin/<archetype>/` into `<dir>/.puna/plugins/<name>/`,
 * rewrites `plugin.json` (`id` = directory name, `name` = Title Case), and
 * strict-validates the result with `PluginManifest` before announcing success.
 */
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PluginManifest as PluginManifestSchema } from "@puna/sdk-shared";
import { assertValidPluginName, flagBool, flagString, parseArgs, titleCase } from "./args";
import { CommandError, UsageError } from "./errors";
import {
	assertArchetype,
	copyTree,
	formatManifestIssues,
	pluginsDirOf,
	resolveWorkspaceRoot,
	templateDirFor,
	type Archetype,
} from "./workspace";

interface CreateOptions {
	name: string;
	archetype: Archetype;
	root: string;
	force: boolean;
}

export function parseCreateArgs(argv: readonly string[]): CreateOptions {
	const parsed = parseArgs(argv, {
		boolean: ["force"],
		string: ["from", "dir"],
		maxPositionals: 1,
	});
	const name = parsed.positionals[0];
	if (name === undefined) {
		throw new UsageError("create requires a <name> argument");
	}
	assertValidPluginName(name);

	const archetype = assertArchetype(flagString(parsed, "from") ?? "sticky-notes");
	const root = resolveWorkspaceRoot(flagString(parsed, "dir"));
	return { name, archetype, root, force: flagBool(parsed, "force") };
}

export async function createCommand(argv: readonly string[]): Promise<number> {
	const options = parseCreateArgs(argv);
	const target = join(pluginsDirOf(options.root), options.name);
	const template = templateDirFor(options.archetype);

	if (existsSync(target)) {
		if (!options.force) {
			throw new CommandError(`target already exists: ${target} (use --force to overwrite)`);
		}
		await rm(target, { recursive: true, force: true });
	}

	const manifestPath = join(target, "plugin.json");
	try {
		await copyTree(template, target);

		// Rewrite identity fields while preserving `$schema`, `version`, `engines`,
		// capabilities, permissions, and any author metadata from the archetype.
		const raw = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
		raw.id = options.name;
		raw.name = titleCase(options.name);

		const parsed = PluginManifestSchema.safeParse(raw);
		if (!parsed.success) {
			throw new UsageError(
				`generated plugin.json failed validation: ${formatManifestIssues(parsed.error)}`,
			);
		}

		await writeFile(manifestPath, `${JSON.stringify(parsed.data, null, 2)}\n`, "utf8");
	} catch (error) {
		// Never leave a half-scaffolded directory behind.
		await rm(target, { recursive: true, force: true });
		throw error;
	}

	console.log(`Created plugin "${options.name}" at ${target}`);
	console.log(`  archetype: ${options.archetype}`);
	console.log(`  manifest:  ${manifestPath}`);
	console.log("");
	console.log(`Next: puna plugin dev ${options.name} --dir ${options.root}`);
	console.log(`      puna plugin build ${options.name} --dir ${options.root}`);
	return 0;
}

/** Help text for `puna plugin create --help`. */
export const CREATE_USAGE = `Usage: puna plugin create <name> [options]

Scaffold a plugin from templates/plugin/<archetype> into
<workspace>/.puna/plugins/<name> and validate the generated plugin.json.

Options:
  --from <archetype>  Template to copy: sticky-notes | mermaid-renderer |
                      logging-hook | research-agent (default: sticky-notes)
  --dir <dir>         Workspace root (default: nearest .puna/ ancestor of cwd)
  --force             Overwrite the target directory if it already exists
  -h, --help          Show this help

Exit codes: 0 success · 1 runtime failure · 2 invalid arguments
`;
