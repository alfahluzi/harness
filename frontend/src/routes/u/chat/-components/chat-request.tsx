import type { ChatMessage } from "@/lib/chat-types";
import { MessageAi, MessageAiStreaming } from "./msg-ai";
import { MessageHuman } from "./msg-human";
import { MessageTool } from "./msg-tool";

type ChatRequestProps = {
	messages: ChatMessage[];
	last: boolean;
	isStreaming: boolean;
	streamContent?: string;
};

export function ChatRequest({
	messages,
	last,
	isStreaming,
	streamContent = "",
}: ChatRequestProps) {
	return (
		<div
			className={
				(last ? "min-h-[calc(100%-2rem)] " : "") +
				"max-w-3xl w-full py-2 flex flex-col gap-4"
			}
		>
			{messages.map((msg, index) => {
				if (msg.role === "human") return <MessageHuman key={index} msg={msg} />;
				if (msg.role === "ai") return <MessageAi key={index} msg={msg} />;
				return <MessageTool key={index} msg={msg} />;
			})}
			{last && isStreaming && <MessageAiStreaming content={streamContent} />}
		</div>
	);
}
