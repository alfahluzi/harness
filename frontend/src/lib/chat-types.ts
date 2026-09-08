export type MessageRole = "human" | "ai" | "tool";

export type TokenUsage = {
	input_tokens?: number;
	output_tokens?: number;
	total_tokens?: number;
	cache_read_input_tokens?: number;
	cache_creation_input_tokens?: number;
};

export type MessageMeta = {
	model?: string;
	ts?: string;
	usage?: TokenUsage;
};

export type ChatMessage = {
	role: MessageRole;
	content: string;
} & MessageMeta;

export type SseMessageChunk = {
	role?: MessageRole;
	content?: string;
	tool_calls?: unknown;
	model?: string;
	ts?: string;
	usage?: TokenUsage;
	[key: string]: unknown;
};

export type SseEvent =
	| { type: "messages"; data: SseMessageChunk[] }
	| { type: "updates"; data: unknown }
	| { type: "metadata"; data: unknown }
	| { type: "error"; data: unknown }
	| { type: "__end__" };

// Hand-shared with backend/src/global/stream-bus.ts (audit fix #10): the SSE
// wire format is not represented in the OpenAPI spec, so this envelope type
// must be kept in sync with the backend manually. Verified against the
// backend at Fase 2 write time — field names and types match exactly.
export type StreamEvent = {
	sessionId: string;
	runId: string;
	seq: number; // per-run, resets to 0 for each new run
	type: string; // "messages" | "updates" | "error" | "done" | "cancelled" | ...
	data: unknown;
	ts: number;
};
