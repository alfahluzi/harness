/**
 * Minimal, dependency-free argument parser for the `puna plugin` subcommands.
 *
 * Supported syntax: `--flag`, `--flag=value`, `--flag value`, `--` terminator.
 * Anything undeclared is a `UsageError` (exit code 2), keeping the CLI strict.
 */
import { UsageError } from "./errors";

export interface FlagSpec {
	/** Flags that take no value (`--force`, `--no-warm`, …). */
	boolean?: readonly string[];
	/** Flags that require a value (`--dir`, `--backend`, …). */
	string?: readonly string[];
	/** Maximum accepted positional arguments; extras raise a `UsageError`. */
	maxPositionals?: number;
}

export interface ParsedArgs {
	positionals: string[];
	flags: Map<string, string | boolean>;
}

export function parseArgs(argv: readonly string[], spec: FlagSpec): ParsedArgs {
	const booleanFlags = new Set(spec.boolean ?? []);
	const stringFlags = new Set(spec.string ?? []);
	const positionals: string[] = [];
	const flags = new Map<string, string | boolean>();

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === undefined) continue;

		if (arg === "--") {
			positionals.push(...argv.slice(i + 1));
			break;
		}

		if (arg.startsWith("--")) {
			const eq = arg.indexOf("=");
			const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
			if (key.length === 0) throw new UsageError(`malformed flag: ${arg}`);

			if (booleanFlags.has(key)) {
				if (eq !== -1) throw new UsageError(`flag --${key} does not take a value`);
				flags.set(key, true);
				continue;
			}
			if (stringFlags.has(key)) {
				let value: string | undefined;
				if (eq !== -1) {
					value = arg.slice(eq + 1);
				} else {
					i += 1;
					value = argv[i];
				}
				if (value === undefined || value.length === 0) {
					throw new UsageError(`flag --${key} requires a value`);
				}
				flags.set(key, value);
				continue;
			}
			throw new UsageError(`unknown flag: --${key}`);
		}

		if (arg.startsWith("-") && arg.length > 1) {
			// `-h`/`--help` are intercepted by the dispatcher before parsing.
			throw new UsageError(`unknown flag: ${arg}`);
		}

		positionals.push(arg);
	}

	if (spec.maxPositionals !== undefined && positionals.length > spec.maxPositionals) {
		throw new UsageError(
			`too many arguments: ${positionals.slice(spec.maxPositionals).join(" ")}`,
		);
	}

	return { positionals, flags };
}

export function flagString(parsed: ParsedArgs, name: string): string | undefined {
	const value = parsed.flags.get(name);
	return typeof value === "string" ? value : undefined;
}

export function flagBool(parsed: ParsedArgs, name: string): boolean {
	return parsed.flags.get(name) === true;
}

/** Manifest `id` policy (also used for plugin directory names). */
export const KEBAB_NAME_RE = /^[a-z][a-z0-9-]*$/;

export function isValidPluginName(name: string): boolean {
	return KEBAB_NAME_RE.test(name);
}

export function assertValidPluginName(name: string, label = "plugin name"): void {
	if (!isValidPluginName(name)) {
		throw new UsageError(
			`invalid ${label} "${name}": must be kebab-case matching ${KEBAB_NAME_RE} ` +
				`(lowercase letter first, then lowercase letters/digits/hyphens)`,
		);
	}
}

/** `my-notes` → `My Notes` (manifest display name). */
export function titleCase(name: string): string {
	return name
		.split("-")
		.filter((word) => word.length > 0)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}
