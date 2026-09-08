import type { ChatMessage, TokenUsage } from "@/lib/chat-types";
import { MessageAi } from "./msg-ai";
import { MessageHuman } from "./msg-human";
import { MessageTool } from "./msg-tool";

type ChatRequestProps = {
	messages: ChatMessage[];
	last: boolean;
	isStreaming: boolean;
	streamContent?: string;
};

function sumUsage(messages: ChatMessage[]): TokenUsage | undefined {
	let acc: TokenUsage | undefined;
	for (const m of messages) {
		if (m.role !== "ai" || !m.usage) continue;
		if (!acc) {
			acc = { ...m.usage };
			continue;
		}
		const add = (x?: number, y?: number): number | undefined =>
			x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0);
		acc = {
			input_tokens: add(acc.input_tokens, m.usage.input_tokens),
			output_tokens: add(acc.output_tokens, m.usage.output_tokens),
			total_tokens: add(acc.total_tokens, m.usage.total_tokens),
			cache_read_input_tokens: add(
				acc.cache_read_input_tokens,
				m.usage.cache_read_input_tokens,
			),
			cache_creation_input_tokens: add(
				acc.cache_creation_input_tokens,
				m.usage.cache_creation_input_tokens,
			),
		};
	}
	return acc;
}

function fmt(n?: number): string {
	return typeof n === "number" ? n.toLocaleString() : "—";
}

function TokenFooter({ usage }: { usage: TokenUsage }) {
	const cache =
		(usage.cache_read_input_tokens ?? 0) +
		(usage.cache_creation_input_tokens ?? 0);
	const hasAny =
		usage.input_tokens !== undefined ||
		usage.output_tokens !== undefined ||
		usage.total_tokens !== undefined ||
		cache > 0;
	if (!hasAny) return null;
	return (
		<div className="mt-1 flex flex-wrap gap-x-1 gap-y-0.5 text-[10px] text-neutral-500 dark:text-neutral-400">
			<span>In {fmt(usage.input_tokens)}</span>
			<span>Out {fmt(usage.output_tokens)}</span>
			<span>Cache {fmt(cache || 0)}</span>
			<span>Tot {fmt(usage.total_tokens)}</span>
		</div>
	);
}

export function ChatRequest({
	messages,
	last,
	isStreaming,
	streamContent = "",
}: ChatRequestProps) {
	const firstAiModel = messages.find((m) => m.role === "ai" && m.model)?.model;
	const usage = sumUsage(messages);

	return (
		<div
			className={
				(last ? "min-h-[calc(100%-2rem)] " : "") +
				"max-w-3xl w-full py-2 flex flex-col gap-4"
			}
		>
			<div className="group w-full h-fit">
				{messages.map((msg, index) => {
					if (msg.role === "human")
						return <MessageHuman key={index} msg={msg} model={firstAiModel} />;
					if (msg.role === "ai")
						return <MessageAi key={index} content={msg.content} />;
					return <MessageTool key={index} msg={msg} />;
				})}
				{last && isStreaming && <MessageAi content={streamContent} streaming />}
				{usage && !isStreaming && <TokenFooter usage={usage} />}
			</div>
		</div>
	);
}
