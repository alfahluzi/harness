export type MessageRole = "human" | "ai" | "tool";

export type ChatMessage = {
	role: MessageRole;
	content: string;
};

export type SseMessageChunk = {
	role?: MessageRole;
	content?: string;
	tool_calls?: unknown;
	[key: string]: unknown;
};

export type SseEvent =
	| { type: "messages"; data: SseMessageChunk[] }
	| { type: "updates"; data: unknown }
	| { type: "metadata"; data: unknown }
	| { type: "error"; data: unknown }
	| { type: "__end__" };
