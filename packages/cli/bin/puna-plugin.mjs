#!/usr/bin/env bun
/**
 * `puna-plugin` CLI entrypoint.
 *
 * REQUIRES BUN. The sources are TypeScript and `dev`/`build` rely on
 * `Bun.build` + `Bun.gzipSync`, so run this file with `bun`:
 *
 *   bun ./bin/puna-plugin.mjs create my-notes
 *
 * The root `puna` CLI (`bin/puna.mjs`) resolves this file and spawns it with
 * `bun` for `puna plugin <command> …`. Node alone cannot execute it.
 */
try {
	const { runCli } = await import("../src/index.ts");
	const code = await runCli(process.argv.slice(2));
	process.exit(code);
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`[puna plugin] fatal: ${message}`);
	console.error("[puna plugin] this CLI must be run with bun (https://bun.sh).");
	process.exit(1);
}
