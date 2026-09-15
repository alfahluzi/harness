#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { init } from "../src/init.js";
import { serve } from "../src/serve.js";

const cmd = process.argv[2];

switch (cmd) {
  case "init":
    await init(process.argv.slice(3));
    break;
  case "serve":
    await serve(process.argv.slice(3));
    break;
  case "plugin":
    await runPlugin(process.argv.slice(3));
    break;
  case "-h":
  case "--help":
  case undefined:
    printHelp();
    break;
  default:
    console.error(`Unknown command: ${cmd}`);
    printHelp();
    process.exit(1);
}

/**
 * `puna plugin <command> …` — delegate to @puna/cli.
 *
 * The plugin CLI is TypeScript + Bun APIs, so it is spawned with `bun`
 * (override the binary with PUNA_BUN). stdio is inherited and the child's
 * exit code is propagated. `dev` deploys its own idempotent SIGINT handler;
 * the parent forwards SIGINT/SIGTERM so a scripted `kill -INT` behaves like
 * terminal Ctrl-C.
 */
async function runPlugin(args) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const cliPath = resolve(repoRoot, "packages", "cli", "bin", "puna-plugin.mjs");

  if (!existsSync(cliPath)) {
    console.error(`puna plugin: CLI entrypoint missing: ${cliPath}`);
    process.exit(1);
  }

  const bunBin = process.env.PUNA_BUN ?? "bun";
  const child = spawn(bunBin, [cliPath, ...args], { stdio: "inherit" });

  // Forward signals so `kill -INT <puna pid>` behaves like terminal Ctrl-C,
  // which also delivers to the child directly (the child is idempotent).
  const forward = (signal) => {
    if (child.exitCode === null && !child.killed) {
      try {
        child.kill(signal);
      } catch {
        // child already gone
      }
    }
  };
  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));

  const code = await new Promise((res) => {
    child.on("error", (error) => {
      const hint =
        error.code === "ENOENT"
          ? `"${bunBin}" not found on PATH — install Bun (https://bun.sh) or set PUNA_BUN`
          : error.message;
      console.error(`puna plugin: failed to start CLI: ${hint}`);
      res(1);
    });
    child.on("close", (childCode, signal) => {
      res(childCode ?? (signal ? 1 : 0));
    });
  });

  process.exit(code);
}

function printHelp() {
  console.log(`puna - harness agent CLI

Usage:
  puna init    Create .puna/ workspace in current directory
  puna serve   Detect .puna/ workspace and start the harness
  puna plugin  Plugin authoring: puna plugin <create|dev|build> […]
  puna help    Show this help
`);
}
