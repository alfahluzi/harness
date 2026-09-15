import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { withPluginHooks, resetPluginHookCache } from "./plugin-bridge.js";

// Each test runs against a mock backend on 127.0.0.1:<random port>.
// Descriptor discovery is cached per `${backendUrl}|${configDir}`, so tests
// reset the cache in beforeEach.

beforeEach(() => {
	resetPluginHookCache();
});

type Handler = (
	req: import("node:http").IncomingMessage,
	res: import("node:http").ServerResponse,
	body: any,
) => void;

async function startServer(handler: Handler): Promise<{ server: Server; port: number }> {
	const server: Server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk) => chunks.push(chunk));
		req.on("end", () => {
			const raw = Buffer.concat(chunks).toString("utf8");
			let body: any = undefined;
			try {
				body = raw ? JSON.parse(raw) : undefined;
			} catch {
				body = raw;
			}
			handler(req, res, body);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as import("node:net").AddressInfo).port;
	return { server, port };
}

async function stopServer(server: Server): Promise<void> {
	server.closeAllConnections?.();
	await new Promise<void>((resolve, reject) =>
		server.close((err) => (err ? reject(err) : resolve())),
	);
}

function makeConfig(port: number, configDir = "/tmp/x") {
	return {
		configurable: {
			config_dir: configDir,
			backend_url: `http://127.0.0.1:${port}`,
			hook_timeout_ms: 50,
		},
	};
}

// Test 1 — descriptor GET happens once per (backendUrl, configDir), even across
// two wrapped-node invocations; hooks trigger POSTs per phase.
test("withPluginHooks: GET descriptors once for two invocations", async () => {
	let getCount = 0;
	const phases: string[] = [];

	const { server, port } = await startServer((req, res, body) => {
		if (req.method === "GET") {
			getCount++;
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					configDir: "/tmp/x",
					timeoutMs: 5000,
					plugins: [{ id: "p1", beforeNode: true, afterNode: true }],
				}),
			);
			return;
		}
		phases.push(body.phase);
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ patch: null, invoked: 1, dropped: 0 }));
	});

	try {
		const wrapped = withPluginHooks("call_model", async () => ({ ok: true }));
		const config = makeConfig(port);

		const first = await wrapped({ messages: [] }, config);
		const second = await wrapped({ messages: [] }, config);

		assert.deepEqual(first, { ok: true });
		assert.deepEqual(second, { ok: true });
		assert.equal(getCount, 1, "descriptor GET must be cached");
		assert.deepEqual(phases, [
			"beforeNode",
			"afterNode",
			"beforeNode",
			"afterNode",
		]);
	} finally {
		await stopServer(server);
	}
});

// Test 2 — descriptor with no node hooks: fn runs, zero POSTs.
test("withPluginHooks: no-hook descriptors skip POSTs", async () => {
	let getCount = 0;
	let postCount = 0;
	let fnRuns = 0;

	const { server, port } = await startServer((req, res) => {
		if (req.method === "GET") {
			getCount++;
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					configDir: "/tmp/x",
					timeoutMs: 5000,
					plugins: [{ id: "p1", beforeNode: false, afterNode: false }],
				}),
			);
			return;
		}
		postCount++;
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ patch: null, invoked: 0, dropped: 0 }));
	});

	try {
		const wrapped = withPluginHooks("call_model", async () => {
			fnRuns++;
			return { ok: true };
		});
		const result = await wrapped({}, makeConfig(port));

		assert.deepEqual(result, { ok: true });
		assert.equal(fnRuns, 1);
		assert.equal(getCount, 1);
		assert.equal(postCount, 0, "no descriptors with hooks => no POSTs");
	} finally {
		await stopServer(server);
	}
});

// Test 3 — ordered before -> fn -> after, patch merges via spread.
test("withPluginHooks: before runs before fn, after runs after; patch merges", async () => {
	const order: string[] = [];
	let afterBody: any;
	let beforeBody: any;

	const { server, port } = await startServer((req, res, body) => {
		if (req.method === "GET") {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					configDir: "/tmp/x",
					timeoutMs: 5000,
					plugins: [{ id: "p1", beforeNode: true, afterNode: true }],
				}),
			);
			return;
		}
		if (body.phase === "beforeNode") {
			order.push("before");
			beforeBody = body;
		} else {
			order.push("after");
			afterBody = body;
		}
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(
			JSON.stringify(
				body.phase === "afterNode"
					? { patch: { injected: "patch-value" }, invoked: 1, dropped: 0 }
					: { patch: null, invoked: 1, dropped: 0 },
			),
		);
	});

	try {
		const wrapped = withPluginHooks("call_model", async (state, _config) => {
			order.push("fn");
			return { messages: ["fn"], keep: true };
		});
		const state = { messages: ["input"] };
		const result = await wrapped(state, makeConfig(port));

		assert.deepEqual(order, ["before", "fn", "after"]);
		assert.deepEqual(result, {
			messages: ["fn"],
			keep: true,
			injected: "patch-value",
		});
		// before phase receives the original state; after receives {...state, ...out}
		assert.deepEqual(beforeBody.state, { messages: ["input"] });
		assert.deepEqual(afterBody.state, { messages: ["fn"], keep: true });
		assert.equal(beforeBody.node, "call_model");
		assert.equal(afterBody.node, "call_model");
	} finally {
		await stopServer(server);
	}
});

// Test 4 — patch OVERRIDES colliding keys of the fn result.
test("withPluginHooks: afterNode patch overrides colliding keys", async () => {
	const { server, port } = await startServer((req, res, body) => {
		if (req.method === "GET") {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					configDir: "/tmp/x",
					timeoutMs: 5000,
					plugins: [{ id: "p1", beforeNode: true, afterNode: true }],
				}),
			);
			return;
		}
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(
			JSON.stringify(
				body.phase === "afterNode"
					? { patch: { messages: ["patched"], keep: "patched" }, invoked: 1, dropped: 0 }
					: { patch: null, invoked: 1, dropped: 0 },
			),
		);
	});

	try {
		const wrapped = withPluginHooks("call_tool", async () => ({
			messages: ["from-fn"],
			keep: "from-fn",
			extra: 1,
		}));
		const result = await wrapped({}, makeConfig(port));

		assert.deepEqual(result, {
			messages: ["patched"],
			keep: "patched",
			extra: 1,
		});
	} finally {
		await stopServer(server);
	}
});

// Test 5 — afterNode timeout: warn, resolve with fn's result, no throw.
test("withPluginHooks: afterNode timeout fails open", async () => {
	const warnings: string[] = [];
	const originalWarn = console.warn;
	console.warn = (...args: any[]) => {
		warnings.push(args.map(String).join(" "));
	};

	const { server, port } = await startServer((req, res, body) => {
		if (req.method === "GET") {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					configDir: "/tmp/x",
					timeoutMs: 5000,
					plugins: [{ id: "p1", beforeNode: true, afterNode: true }],
				}),
			);
			return;
		}
		if (body.phase === "afterNode") {
			setTimeout(() => {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({
						patch: { tooLate: true },
						invoked: 1,
						dropped: 0,
					}),
				);
			}, 300);
			return;
		}
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ patch: null, invoked: 1, dropped: 0 }));
	});

	try {
		const wrapped = withPluginHooks("call_model", async () => ({ ok: "fn" }));
		// hook_timeout_ms: 50 (makeConfig) < 300ms server delay
		const result = await wrapped({}, makeConfig(port));

		assert.deepEqual(result, { ok: "fn" });
		assert.ok(
			warnings.some((w) => w.includes("afterNode")),
			`expected afterNode warning, got: ${JSON.stringify(warnings)}`,
		);
	} finally {
		console.warn = originalWarn;
		await stopServer(server);
	}
});

// Test 6 — backend unreachable: discovery warns and node runs passthrough.
test("withPluginHooks: unreachable backend fails open", async () => {
	const warnings: string[] = [];
	const originalWarn = console.warn;
	console.warn = (...args: any[]) => {
		warnings.push(args.map(String).join(" "));
	};

	// Bind then release a port so nothing is listening on it.
	const probe = await startServer((_req, res) => {
		res.writeHead(200);
		res.end();
	});
	const closedPort = probe.port;
	await stopServer(probe.server);

	try {
		const wrapped = withPluginHooks("call_model", async () => ({ ok: "fn" }));
		const result = await wrapped({}, makeConfig(closedPort));

		assert.deepEqual(result, { ok: "fn" });
		assert.ok(
			warnings.some((w) => w.includes("hook discovery failed")),
			`expected discovery warning, got: ${JSON.stringify(warnings)}`,
		);
	} finally {
		console.warn = originalWarn;
	}
});
