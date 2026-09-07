#!/usr/bin/env node
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

function printHelp() {
  console.log(`nusa - harness agent CLI

Usage:
  nusa init    Create .nusa/ workspace in current directory
  nusa serve   Detect .nusa/ workspace and start the harness
  nusa help    Show this help
`);
}