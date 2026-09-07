import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUNA_DIR = ".puna";
const REQUIRED_SERVICES = ["backend", "agent", "frontend"];

export async function serve(args) {
	const flags = parseFlags(args);
	const cwd = process.cwd();
	const punaRoot = findPuna(cwd);

	if (!punaRoot) {
		console.error(`No .puna/ found from ${cwd}. Run \`puna init\` first.`);
		process.exit(1);
	}

	const ctx = await loadWorkspaceContext(punaRoot, cwd);
	const workspace = await scanWorkspace(punaRoot, ctx.globalConfigDir);

	printBanner({ ctx, workspace });

	if (flags.check) {
		console.log("--check: validation passed. Skipping service start.");
		return;
	}

	const missing = REQUIRED_SERVICES.filter((s) => !existsSync(join(REPO_ROOT, s)));
	if (missing.length) {
		console.error(
			`Cannot start services. Missing in ${REPO_ROOT}: ${missing.join(", ")}\n` +
			`puna serve needs the full harness repo (agent/ backend/ frontend/ as siblings).\n` +
			`After \`npm i -g\`, only the CLI ships. To run serve:\n` +
			`  - clone https://github.com/aldi-rudexylo/puna and \`node bin/puna.mjs serve\` from it\n` +
			`  - or \`npm link\` from a local clone: \`git clone ... && cd puna && npm link && puna serve\``,
		);
		process.exit(1);
	}

	const services = [
		{ name: "backend", cwd: join(REPO_ROOT, "backend"), cmd: "bun", args: ["run", "dev"], color: "\x1b[36m" },
		{ name: "agent",   cwd: join(REPO_ROOT, "agent"),   cmd: "npm", args: ["run", "dev"], color: "\x1b[33m" },
		{ name: "frontend",cwd: join(REPO_ROOT, "frontend"),cmd: "npm", args: ["run", "dev"], color: "\x1b[35m" },
	];

	console.log(`Starting ${services.length} services from ${REPO_ROOT}...`);
	const procs = services.map((s) => spawnService(s));
	const shutdown = () => {
		console.log("\nShutting down...");
		for (const p of procs) {
			try { p.kill("SIGTERM"); } catch {}
		}
		setTimeout(() => process.exit(0), 500);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	procs.forEach((p, i) => {
		p.on("exit", (code) => {
			if (code !== 0 && code !== null) {
				console.error(`[${services[i].name}] exited with code ${code}`);
				shutdown();
			}
		});
	});

	await new Promise(() => {});
}

function parseFlags(args) {
	const flags = { check: false };
	for (const a of args) {
		if (a === "--check" || a === "-c") flags.check = true;
		else if (a === "--help" || a === "-h") {
			console.log("Usage: puna serve [--check]");
			process.exit(0);
		}
	}
	return flags;
}

function findPuna(start) {
	let dir = resolve(start);
	while (true) {
		if (existsSync(join(dir, PUNA_DIR))) return join(dir, PUNA_DIR);
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

async function loadWorkspaceContext(configDir, cwd) {
	const configPath = join(configDir, "config.json");
	if (!existsSync(configPath)) {
		console.error(`Missing ${configPath}`);
		process.exit(1);
	}
	let cfg;
	try {
		cfg = JSON.parse(await readFile(configPath, "utf8"));
	} catch (e) {
		console.error(`Failed to parse ${configPath}: ${e.message}`);
		process.exit(1);
	}
	if (typeof cfg.id !== "string" || cfg.id.length === 0) {
		console.error(`${configPath}: missing 'id'`);
		process.exit(1);
	}
	return {
		id: cfg.id,
		root: dirname(configDir),
		cwd,
		configDir,
		globalConfigDir:
			typeof cfg.globalConfigDir === "string" ? cfg.globalConfigDir : null,
	};
}

async function scanWorkspace(punaRoot, globalConfigDir) {
	const out = { plans: [], agents: [], skills: [] };

	const planDir = join(punaRoot, "docs/plan");
	if (existsSync(planDir)) {
		const seen = new Set();
		for (const f of await readdir(planDir)) {
			if (!f.endsWith(".md")) continue;
			let base = f.endsWith(".progress.md") ? f.slice(0, -".progress.md".length) : f;
			if (base.endsWith(".md")) base = base.slice(0, -3);
			seen.add(base);
		}
		out.plans = [...seen].sort();
	}

	out.agents = await mergeLayered(
		join(punaRoot, "agents"),
		globalConfigDir ? join(globalConfigDir, "agents") : null,
		"prompt.md",
	);

	out.skills = await mergeLayered(
		join(punaRoot, "skills"),
		globalConfigDir ? join(globalConfigDir, "skills") : null,
		"desc.md",
	);

	return out;
}

async function mergeLayered(localDir, globalDir, marker) {
	const localNames = await scanLayer(localDir, marker);
	const globalNames = await scanLayer(globalDir, marker);

	const merged = new Map();
	for (const name of globalNames) merged.set(name, "global");
	for (const name of localNames) merged.set(name, "local");

	return [...merged.entries()]
		.map(([name, source]) => ({ name, source }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

async function scanLayer(dir, marker) {
	if (!dir || !existsSync(dir)) return new Set();
	const names = new Set();
	for (const e of await readdir(dir, { withFileTypes: true })) {
		if (!e.isDirectory()) continue;
		if (existsSync(join(dir, e.name, marker))) names.add(e.name);
	}
	return names;
}

function printBanner({ ctx, workspace }) {
	const RESET = "\x1b[0m", BOLD = "\x1b[1m", DIM = "\x1b[2m";
	console.log(`${BOLD}puna serve${RESET}`);
	console.log(`${DIM}WorkspaceContext:${RESET}`);
	console.log(`  id:         ${ctx.id}`);
	console.log(`  root:       ${ctx.root}`);
	console.log(`  cwd:        ${ctx.cwd}`);
	console.log(`  configDir:  ${ctx.configDir}`);
	console.log("");
	console.log(`${BOLD}workspace contents:${RESET}`);
	console.log(`  plans:  ${workspace.plans.length ? workspace.plans.join(", ") : "(none)"}`);
	const fmtLayered = (arr) => arr.map((a) => `${a.name} (${a.source})`).join(", ");
	console.log(`  agents: ${workspace.agents.length ? fmtLayered(workspace.agents) : "(none)"}`);
	console.log(`  skills: ${workspace.skills.length ? fmtLayered(workspace.skills) : "(none)"}`);
	console.log("");
}

function spawnService({ name, cwd, cmd, args, color }) {
	const RESET = "\x1b[0m";
	console.log(`[${name}] starting: ${cmd} ${args.join(" ")} (cwd=${cwd})`);
	const child = spawn(cmd, args, {
		cwd,
		stdio: ["ignore", "pipe", "pipe"],
		env: process.env,
	});
	const tag = `${color}[${name}]${RESET} `;
	const pipe = (stream, target) => {
		let buf = "";
		stream.on("data", (chunk) => {
			buf += chunk.toString();
			const lines = buf.split("\n");
			buf = lines.pop();
			for (const line of lines) target.write(tag + line + "\n");
		});
	};
	pipe(child.stdout, process.stdout);
	pipe(child.stderr, process.stderr);
	return child;
}
