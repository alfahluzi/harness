import type { ChatMessage } from "@/lib/chat-types";

type MessageAiProps = {
	msg: ChatMessage;
};

export function MessageAi({ msg }: MessageAiProps) {
	return (
		<div className="flex w-full justify-start">
			<div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-neutral-200 bg-neutral-100 px-4 py-2.5 text-sm text-neutral-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100">
				<p className="whitespace-pre-wrap break-words">{msg.content}</p>
			</div>
		</div>
	);
}

export function MessageAiStreaming({ content }: { content: string }) {
	return (
		<div className="flex w-full justify-start">
			<div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-neutral-200 bg-neutral-100 px-4 py-2.5 text-sm text-neutral-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100">
				<p className="whitespace-pre-wrap break-words">
					{content}
					<span className="ml-1 inline-block h-4 w-2 animate-pulse bg-current align-middle" />
				</p>
			</div>
		</div>
	);
}
