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
  console.log(`puna - harness agent CLI

Usage:
  puna init    Create .puna/ workspace in current directory
  puna serve   Detect .puna/ workspace and start the harness
  puna help    Show this help
`);
}
