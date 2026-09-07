import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { callModel } from "./call-llm.js";
import { ensureConfiguration } from "../.libs/configuration.js";

// Test 1 — end-to-end callModel vs mock OpenAI-compatible HTTP server
test("callModel: end-to-end vs mock OpenAI server", async () => {
	let captured: { authorization: string | undefined; body: any } = {
		authorization: undefined,
		body: undefined,
	};

	const server: Server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk) => chunks.push(chunk));
		req.on("end", () => {
			captured.authorization = req.headers.authorization;
			captured.body = JSON.parse(Buffer.concat(chunks).toString("utf8"));

			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					id: "test",
					object: "chat.completion",
					model: captured.body.model,
					choices: [
						{
							index: 0,
							message: {
								role: "assistant",
								content: "pong",
							},
							finish_reason: "stop",
						},
					],
					usage: {
						prompt_tokens: 1,
						completion_tokens: 1,
						total_tokens: 2,
					},
				}),
			);
		});
	});

	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address() as import("node:net").AddressInfo;
	const port = address.port;

	try {
		const state = { messages: [{ role: "user", content: "ping" }] };
		const config = {
			configurable: {
				agent_name: "test-agent",
				provider_name: "test-provider",
				provider_url: `http://127.0.0.1:${port}/v1`,
				api_key: "test-key-123",
				model_name: "test-model-xyz",
				system_prompt: "SYSTEM_PROMPT_TEST",
			},
			store: { search: async () => [] },
		};

		const result = await callModel(state as any, config as any);

		// 1. Result content
		const first = result.messages[0];
		const content =
			typeof first.content === "string"
				? first.content
				: ((first as any).text as string);
		assert.equal(content, "pong");

		// 2. Request received by server
		assert.equal(captured.authorization, "Bearer test-key-123");
		assert.equal(captured.body.model, "test-model-xyz");

		// 3. Messages sent
		assert.equal(captured.body.messages[0].role, "system");
		assert.equal(captured.body.messages[0].content, "SYSTEM_PROMPT_TEST");
		assert.equal(captured.body.messages[1].role, "user");
		assert.equal(captured.body.messages[1].content, "ping");
	} finally {
		await new Promise<void>((resolve, reject) =>
			server.close((err) => (err ? reject(err) : resolve())),
		);
	}
});

// Test 2 — ensureConfiguration defaults (pure unit, without server)
test("ensureConfiguration: defaults", () => {
	const cfg: any = ensureConfiguration({} as any);
	assert.equal(cfg.agentName, "main-agent");
	assert.equal(cfg.providerName, "openrouter");
	assert.equal(cfg.modelName, "ocg/deepseek-v4-flash");
	assert.equal(cfg.providerUrl, "https://9router.ljosalfar.cloud/v1");
	assert.equal(cfg.apiKey, "sk-c4f4e23515e229a5-fijmyr-fc1cda87");
	assert.equal(
		cfg.systemPrompt,
		"You are a helpful assistant with memory. Use the available tools to store memories about the user when they share personal information. Always respond in the same language the user uses.",
	);
	assert.equal(cfg.userId, "default");
});

test("ensureConfiguration: override via camelCase configurable", () => {
	const cfg: any = ensureConfiguration({
		configurable: { agentName: "X", modelName: "Y", apiKey: "Z" },
	} as any);
	assert.equal(cfg.agentName, "X");
	assert.equal(cfg.modelName, "Y");
	assert.equal(cfg.apiKey, "Z");
});

// Test 3 — custom field mapping: snake_case configurable -> camelCase
test("ensureConfiguration: snake_case configurable maps to camelCase", () => {
	const cfg: any = ensureConfiguration({
		configurable: {
			agent_name: "a",
			provider_name: "p",
			provider_url: "u",
			api_key: "k",
			model_name: "m",
			system_prompt: "s",
		},
	} as any);
	assert.deepEqual(
		{
			agentName: cfg.agentName,
			providerName: cfg.providerName,
			providerUrl: cfg.providerUrl,
			apiKey: cfg.apiKey,
			modelName: cfg.modelName,
			systemPrompt: cfg.systemPrompt,
		},
		{
			agentName: "a",
			providerName: "p",
			providerUrl: "u",
			apiKey: "k",
			modelName: "m",
			systemPrompt: "s",
		},
	);
});
