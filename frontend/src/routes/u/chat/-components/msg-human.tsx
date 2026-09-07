import type { ChatMessage } from "@/lib/chat-types";

type MessageHumanProps = {
	msg: ChatMessage;
};

export function MessageHuman({ msg }: MessageHumanProps) {
	return (
		<div className="flex w-full justify-end">
			<div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-neutral-800 px-4 py-2.5 text-sm text-neutral-100">
				<p className="whitespace-pre-wrap break-words">{msg.content}</p>
			</div>
		</div>
	);
}
