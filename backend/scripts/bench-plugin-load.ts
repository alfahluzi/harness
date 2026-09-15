// Fase 10 task 4: plugin load-time bench against the ≤100ms p95 budget.
//
// Each iteration constructs a FRESH `PluginHost`, so the per-configDir cache in
// `getPluginHostForWorkspace` is bypassed and `discoverAndLoad` performs a real
// 3-layer scan + backend-module import every time. Note: iterations share the
// Bun ESM module cache, so iteration 1 is the cold-import run; later iterations
// measure warm re-resolution. (Production loads each plugin once per process,
// which is what the first iteration approximates.)
//
// Usage:
//   bun run scripts/bench-plugin-load.ts [workspaceRootOrConfigDir] [iterations]
//
// Defaults: workspace = repo root (its `.puna` dir), iterations = 30.
// The path arg may be a workspace root (contains `.puna/config.json`) or the
// `.puna` config dir itself (contains `config.json`).
//
// Exit codes: 0 = p95 within budget, 1 = over budget or load failure, 2 = usage.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { PluginHost } from "../src/modules/plugins/host";

const BUDGET_MS = 100;
const DEFAULT_ITERATIONS = 30;

function fail(code: number, message: string): never {
	console.error(`[bench:plugin-load] ${message}`);
	process.exit(code);
}

function resolveConfigDir(arg: string): string {
	const candidate = resolve(arg);
	if (existsSync(join(candidate, "config.json"))) return candidate;
	const nested = join(candidate, ".puna");
	if (existsSync(join(nested, "config.json"))) return nested;
	return fail(2, `no workspace config.json at ${candidate} or ${nested}`);
}

const workspaceArg = process.argv[2] ?? join(import.meta.dir, "..", "..");
const configDir = resolveConfigDir(workspaceArg);

const parsedIterations = Number.parseInt(process.argv[3] ?? "", 10);
const iterations =
	Number.isFinite(parsedIterations) && parsedIterations > 0
		? parsedIterations
		: DEFAULT_ITERATIONS;

const samples: number[] = [];
let pluginCount = 0;

for (let i = 0; i < iterations; i++) {
	const host = new PluginHost();
	const startedAt = performance.now();
	try {
		await host.discoverAndLoad(configDir);
	} catch (error) {
		fail(
			1,
			`discoverAndLoad failed on iteration ${i + 1}/${iterations}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
	samples.push(performance.now() - startedAt);
	pluginCount = host.list().length;
}

samples.sort((a, b) => a - b);
/** Nearest-rank quantile, clamped for small sample counts. */
const quantile = (q: number): number =>
	samples[Math.min(samples.length - 1, Math.floor(q * samples.length))] ?? 0;

const min = samples[0] ?? 0;
const p50 = quantile(0.5);
const p95 = quantile(0.95);
const max = samples[samples.length - 1] ?? 0;

const ms = (value: number) => `${value.toFixed(2)}ms`;
console.log(
	`[bench:plugin-load] configDir=${configDir} iterations=${iterations} plugins=${pluginCount} min=${ms(min)} p50=${ms(p50)} p95=${ms(p95)} max=${ms(max)} budget=${BUDGET_MS}ms status=${p95 <= BUDGET_MS ? "ok" : "over-budget"}`,
);

if (p95 > BUDGET_MS) {
	console.error(
		`[bench:plugin-load] OVER BUDGET: p95=${ms(p95)} > ${BUDGET_MS}ms (Fase 10 task 4 p95 budget)`,
	);
	process.exit(1);
}
