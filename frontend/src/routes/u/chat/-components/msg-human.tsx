import type { ChatMessage } from "@/lib/chat-types";

type MessageHumanProps = {
	msg: ChatMessage;
	model?: string;
};

function formatTime(ts?: string): string | undefined {
	if (!ts) return undefined;
	const d = new Date(ts);
	if (Number.isNaN(d.getTime())) return undefined;
	return d.toLocaleTimeString(undefined, {
		hour: "2-digit",
		minute: "2-digit",
	});
}

export function MessageHuman({ msg, model }: MessageHumanProps) {
	const time = formatTime(msg.ts);
	const parts = [model, time].filter((p): p is string => Boolean(p));

	return (
		<div className="flex w-full flex-col items-end gap-1">
			<div className="max-w-[85%] rounded-2xl rounded-br-sm bg-neutral-800 px-4 py-2.5 text-sm text-neutral-100">
				<p className="whitespace-pre-wrap wrap-break-word">{msg.content}</p>
			</div>
			{parts.length > 0 && (
				<div className="px-1 text-[10px] text-neutral-500 dark:text-neutral-400">
					{parts.join(" · ")}
				</div>
			)}
		</div>
	);
}
