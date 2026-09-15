/**
 * Error taxonomy for the `puna plugin` CLI.
 *
 * Exit codes (stable contract, see packages/cli/README-less doc in src/index.ts):
 *   0 — success
 *   1 — runtime failure (missing dir, invalid manifest, build failure, …)
 *   2 — invalid invocation (unknown flag, bad plugin name, bad `--from`, …)
 */

/** Invalid invocation: unknown/invalid arguments. Exit code 2. */
export class UsageError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UsageError";
	}
}

/** Operational failure: runtime problem while executing a valid command. Exit code 1. */
export class CommandError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CommandError";
	}
}
