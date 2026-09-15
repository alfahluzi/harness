/**
 * `puna plugin` CLI — entry module.
 *
 * Commands (Fase 7):
 *   puna plugin create <name>   scaffold from templates/plugin/<archetype>
 *   puna plugin dev [<name>]    watch + rebuild/warm UI bundles
 *   puna plugin build [<name>]  production Bun.build bundle
 *
 * Exit-code contract: 0 success · 1 runtime failure · 2 invalid invocation.
 * Requires Bun at runtime (Bun.build / Bun.gzipSync); the root `puna` CLI
 * spawns this package's bin with `bun`.
 */
import { buildCommand, BUILD_USAGE } from "./build";
import { createCommand, CREATE_USAGE } from "./create";
import { devCommand, DEV_USAGE } from "./dev";
import { CommandError, UsageError } from "./errors";

export const CLI_VERSION = "0.1.0";

export { createCommand, parseCreateArgs, CREATE_USAGE } from "./create";
export { devCommand, parseDevArgs, DEV_USAGE } from "./dev";
export { buildCommand, parseBuildArgs, BUILD_USAGE } from "./build";
export { UsageError, CommandError } from "./errors";
export { isValidPluginName, titleCase } from "./args";
export { ARCHETYPES, UI_CAPABILITY_ORDER } from "./workspace";

const ROOT_HELP = `puna plugin ${CLI_VERSION} — plugin authoring CLI

Usage:
  puna plugin create <name> [--from <archetype>] [--dir <dir>] [--force]
  puna plugin dev  [<name>] [--dir <dir>] [--backend <url>] [--no-warm]
  puna plugin build [<name>] [--dir <dir>] [--minify] [--update-manifest] [--budget-kb <n>]

Commands:
  create   Scaffold a plugin into <workspace>/.puna/plugins/<name>
  dev      Watch plugin sources; optionally warm the backend UI-bundle route
  build    Bundle UI capabilities to sibling .js files (React/router external)

Options:
  -h, --help   Show help (also works per command)
  --version    Print CLI version

Exit codes: 0 success · 1 runtime failure · 2 invalid arguments
`;

const SUBCOMMAND_HELP: Record<string, string> = {
	create: CREATE_USAGE,
	dev: DEV_USAGE,
	build: BUILD_USAGE,
};

export function printRootHelp(write: (line: string) => void = console.log): void {
	write(ROOT_HELP);
}

export async function runCli(argv: readonly string[]): Promise<number> {
	try {
		return await dispatch(argv);
	} catch (error) {
		if (error instanceof UsageError) {
			console.error(`[puna plugin] ${error.message}`);
			console.error("Run `puna plugin --help` for usage.");
			return 2;
		}
		if (error instanceof CommandError) {
			console.error(`[puna plugin] ${error.message}`);
			return 1;
		}
		const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
		console.error(`[puna plugin] unexpected error: ${message}`);
		return 1;
	}
}

async function dispatch(argv: readonly string[]): Promise<number> {
	const [command, ...rest] = argv;

	switch (command) {
		case undefined:
			printRootHelp((line) => console.error(line));
			return 2;
		case "-h":
		case "--help":
		case "help":
			printRootHelp();
			return 0;
		case "-v":
		case "--version":
			console.log(CLI_VERSION);
			return 0;
		case "create":
		case "dev":
		case "build": {
			const first = rest[0];
			if (first === "-h" || first === "--help") {
				console.log(SUBCOMMAND_HELP[command]);
				return 0;
			}
			if (command === "create") return createCommand(rest);
			if (command === "dev") return devCommand(rest);
			return buildCommand(rest);
		}
		default:
			console.error(`[puna plugin] unknown command: ${command}`);
			printRootHelp((line) => console.error(line));
			return 2;
	}
}
