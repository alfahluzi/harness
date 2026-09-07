import type { ChatMessage } from "@/lib/chat-types";

type MessageToolProps = {
	msg: ChatMessage;
};

export function MessageTool({ msg }: MessageToolProps) {
	return (
		<div className="flex w-full justify-start">
			<div className="max-w-[90%] rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
				<p className="whitespace-pre-wrap break-words">{msg.content}</p>
			</div>
		</div>
	);
}
