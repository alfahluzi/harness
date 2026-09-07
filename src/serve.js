import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NUSA_DIR = ".nusa";
const REQUIRED_SERVICES = ["backend", "agent", "frontend"];

export async function serve(args) {
	const flags = parseFlags(args);
	const cwd = process.cwd();
	const nusaRoot = findNusa(cwd);

	if (!nusaRoot) {
		console.error(`No .nusa/ found from ${cwd}. Run \`nusa init\` first.`);
		process.exit(1);
	}

	const ctx = await loadWorkspaceContext(nusaRoot, cwd);
	const workspace = await scanWorkspace(nusaRoot);

	printBanner({ ctx, workspace });

	if (flags.check) {
		console.log("--check: validation passed. Skipping service start.");
		return;
	}

	const missing = REQUIRED_SERVICES.filter((s) => !existsSync(join(REPO_ROOT, s)));
	if (missing.length) {
		console.error(
			`Cannot start services. Missing in ${REPO_ROOT}: ${missing.join(", ")}\n` +
			`nusa serve needs the full harness repo (agent/ backend/ frontend/ as siblings).\n` +
			`After \`npm i -g\`, only the CLI ships. To run serve:\n` +
			`  - clone https://github.com/aldi-rudexylo/nusa and \`node bin/nusa.mjs serve\` from it\n` +
			`  - or \`npm link\` from a local clone: \`git clone ... && cd nusa && npm link && nusa serve\``,
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
			console.log("Usage: nusa serve [--check]");
			process.exit(0);
		}
	}
	return flags;
}

function findNusa(start) {
	let dir = resolve(start);
	while (true) {
		if (existsSync(join(dir, NUSA_DIR))) return join(dir, NUSA_DIR);
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
	};
}

async function scanWorkspace(nusaRoot) {
	const out = { plans: [], agents: [], skills: [] };

	const planDir = join(nusaRoot, "docs/plan");
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

	const agentsDir = join(nusaRoot, "agents");
	if (existsSync(agentsDir)) {
		for (const e of await readdir(agentsDir, { withFileTypes: true })) {
			if (!e.isDirectory()) continue;
			if (existsSync(join(agentsDir, e.name, "prompt.md"))) out.agents.push(e.name);
		}
	}

	const skillsDir = join(nusaRoot, "skills");
	if (existsSync(skillsDir)) {
		for (const e of await readdir(skillsDir, { withFileTypes: true })) {
			if (!e.isDirectory()) continue;
			if (existsSync(join(skillsDir, e.name, "desc.md"))) out.skills.push(e.name);
		}
	}

	return out;
}

function printBanner({ ctx, workspace }) {
	const RESET = "\x1b[0m", BOLD = "\x1b[1m", DIM = "\x1b[2m";
	console.log(`${BOLD}nusa serve${RESET}`);
	console.log(`${DIM}WorkspaceContext:${RESET}`);
	console.log(`  id:         ${ctx.id}`);
	console.log(`  root:       ${ctx.root}`);
	console.log(`  cwd:        ${ctx.cwd}`);
	console.log(`  configDir:  ${ctx.configDir}`);
	console.log("");
	console.log(`${BOLD}workspace contents:${RESET}`);
	console.log(`  plans:  ${workspace.plans.length ? workspace.plans.join(", ") : "(none)"}`);
	console.log(`  agents: ${workspace.agents.length ? workspace.agents.join(", ") : "(none)"}`);
	console.log(`  skills: ${workspace.skills.length ? workspace.skills.join(", ") : "(none)"}`);
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