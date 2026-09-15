/**
 * Focused mtime-revalidation test for `GET /plugins/:id/ui-bundle` (Fase 10
 * task 4). Drives the real mounted app in-process against a temp workspace so
 * both bundle branches are exercised:
 *
 * - `.ts` entry  → Bun.build transpile path
 * - `.mjs` entry → pre-built serve-as-is path
 *
 * Asserts `X-Plugin-Bundle-Cached` toggles 0 → 1 → 0 after a source change and
 * that a deleted entry returns the existing 500 error even with a warm cache.
 */
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pluginRoutes } from "./route";

interface UiPluginFixture {
	id: string;
	entry: string;
	content: string;
}

async function makeWorkspace(plugins: UiPluginFixture[]): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "puna-ui-bundle-"));
	const configDir = join(root, ".puna");
	await mkdir(configDir, { recursive: true });
	await writeFile(
		join(configDir, "config.json"),
		JSON.stringify({ id: "ui-bundle-test", version: 1 }),
		"utf8",
	);
	for (const plugin of plugins) {
		const pluginDir = join(configDir, "plugins", plugin.id);
		const entryPath = join(pluginDir, plugin.entry);
		await mkdir(dirname(entryPath), { recursive: true });
		await writeFile(
			join(pluginDir, "plugin.json"),
			JSON.stringify({
				id: plugin.id,
				name: plugin.id,
				version: "1.0.0",
				description: `${plugin.id} fixture`,
				engines: { puna: ">=0.1.0" },
				capabilities: { leftBar: { entry: plugin.entry } },
			}),
			"utf8",
		);
		await writeFile(entryPath, plugin.content, "utf8");
	}
	return root;
}

function bundleUrl(configDir: string, id: string): string {
	return `http://x/plugins/${id}/ui-bundle?configDir=${encodeURIComponent(configDir)}`;
}

/** Content change + explicit mtime bump: same-ms writes are ambiguous. */
async function rewriteAndBump(entryPath: string, content: string): Promise<void> {
	await writeFile(entryPath, content, "utf8");
	const bumped = new Date(Date.now() + 5000);
	await utimes(entryPath, bumped, bumped);
}

describe("GET /plugins/:id/ui-bundle mtime revalidation", () => {
	test(".ts entry: cache hit, then rebuild after source change", async () => {
		const root = await makeWorkspace([
			{
				id: "ts-ui",
				entry: "ui/index.ts",
				content: 'export const marker = "v1";\n',
			},
		]);
		const configDir = join(root, ".puna");
		const entryPath = join(configDir, "plugins", "ts-ui", "ui", "index.ts");
		const url = bundleUrl(configDir, "ts-ui");
		try {
			const first = await pluginRoutes.request(url);
			expect(first.status).toBe(200);
			expect(first.headers.get("X-Plugin-Bundle-Cached")).toBe("0");
			const firstBody = await first.text();
			expect(firstBody).toContain("v1");

			const second = await pluginRoutes.request(url);
			expect(second.status).toBe(200);
			expect(second.headers.get("X-Plugin-Bundle-Cached")).toBe("1");
			expect(await second.text()).toBe(firstBody);

			await rewriteAndBump(entryPath, 'export const marker = "v2";\n');

			const third = await pluginRoutes.request(url);
			expect(third.status).toBe(200);
			expect(third.headers.get("X-Plugin-Bundle-Cached")).toBe("0");
			const thirdBody = await third.text();
			expect(thirdBody).toContain("v2");
			expect(thirdBody).not.toBe(firstBody);

			const fourth = await pluginRoutes.request(url);
			expect(fourth.status).toBe(200);
			expect(fourth.headers.get("X-Plugin-Bundle-Cached")).toBe("1");
			expect(await fourth.text()).toBe(thirdBody);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test(".mjs entry: pre-built branch revalidates the same way", async () => {
		const root = await makeWorkspace([
			{
				id: "prebuilt-ui",
				entry: "ui/bundle.mjs",
				content: 'export const marker = "m1";\n',
			},
		]);
		const configDir = join(root, ".puna");
		const entryPath = join(configDir, "plugins", "prebuilt-ui", "ui", "bundle.mjs");
		const url = bundleUrl(configDir, "prebuilt-ui");
		try {
			const first = await pluginRoutes.request(url);
			expect(first.status).toBe(200);
			expect(first.headers.get("X-Plugin-Bundle-Cached")).toBe("0");
			expect(await first.text()).toBe('export const marker = "m1";\n');

			const second = await pluginRoutes.request(url);
			expect(second.headers.get("X-Plugin-Bundle-Cached")).toBe("1");

			await rewriteAndBump(entryPath, 'export const marker = "m2";\n');

			const third = await pluginRoutes.request(url);
			expect(third.status).toBe(200);
			expect(third.headers.get("X-Plugin-Bundle-Cached")).toBe("0");
			expect(await third.text()).toBe('export const marker = "m2";\n');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("deleted entry still 500s with the existing error body (warm cache)", async () => {
		const root = await makeWorkspace([
			{
				id: "gone-ui",
				entry: "ui/index.ts",
				content: 'export const marker = "alive";\n',
			},
		]);
		const configDir = join(root, ".puna");
		const entryPath = join(configDir, "plugins", "gone-ui", "ui", "index.ts");
		const url = bundleUrl(configDir, "gone-ui");
		try {
			const warm = await pluginRoutes.request(url);
			expect(warm.status).toBe(200);

			await rm(entryPath, { force: true });

			const res = await pluginRoutes.request(url);
			expect(res.status).toBe(500);
			expect(await res.json()).toEqual({ error: "ui bundle entry not found: ui/index.ts" });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
