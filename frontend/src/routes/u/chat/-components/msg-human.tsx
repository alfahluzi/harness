import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import type { ChatMessage } from "@/lib/chat-types";

type MessageHumanProps = {
	msg: ChatMessage;
	model?: string;
	onRestart?: (checkpointId: string, content: string) => void;
	onSwitchBranch?: (checkpointId: string) => void;
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

export function MessageHuman({
	msg,
	model,
	onRestart,
	onSwitchBranch,
}: MessageHumanProps) {
	const time = formatTime(msg.ts);
	const parts = [model, time].filter((p): p is string => Boolean(p));
	const canRestart = Boolean(msg.checkpointId && onRestart);
	const hasSiblings =
		msg.branchTotal !== undefined &&
		msg.branchTotal > 1 &&
		msg.branchIndex !== undefined &&
		Array.isArray(msg.siblingCheckpointIds);

	const goSibling = (dir: -1 | 1) => {
		if (!hasSiblings || !onSwitchBranch || !msg.siblingCheckpointIds) return;
		const idx = (msg.branchIndex ?? 1) - 1;
		const next = idx + dir;
		if (next < 0 || next >= msg.siblingCheckpointIds.length) return;
		const target = msg.siblingCheckpointIds[next];
		if (target) onSwitchBranch(target);
	};

	return (
		<div className="group/msg flex w-full flex-col items-end gap-1">
			<div className="max-w-[85%] rounded-2xl rounded-br-sm bg-neutral-800 px-4 py-2.5 text-sm text-neutral-100">
				<p className="whitespace-pre-wrap wrap-break-word">{msg.content}</p>
			</div>
			<div className="flex items-center gap-2 px-1 text-[10px] text-neutral-500 dark:text-neutral-400">
				{hasSiblings && (
					<div className="flex items-center gap-0.5">
						<button
							type="button"
							onClick={() => goSibling(-1)}
							disabled={(msg.branchIndex ?? 1) <= 1}
							className="rounded p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-800 disabled:opacity-30 disabled:hover:bg-transparent dark:disabled:hover:bg-transparent"
							aria-label="Previous branch"
						>
							<ChevronLeft size={12} />
						</button>
						<span className="tabular-nums">
							{msg.branchIndex}/{msg.branchTotal}
						</span>
						<button
							type="button"
							onClick={() => goSibling(1)}
							disabled={(msg.branchIndex ?? 1) >= (msg.branchTotal ?? 1)}
							className="rounded p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-800 disabled:opacity-30 disabled:hover:bg-transparent dark:disabled:hover:bg-transparent"
							aria-label="Next branch"
						>
							<ChevronRight size={12} />
						</button>
					</div>
				)}
				{canRestart && (
					<button
						type="button"
						onClick={() =>
							onRestart!(msg.checkpointId!, msg.content)
						}
						className="opacity-0 group-hover/msg:opacity-100 transition-opacity rounded p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-800"
						aria-label="Restart from this message"
						title="Restart from this message"
					>
						<RotateCcw size={12} />
					</button>
				)}
				{parts.length > 0 && <span>{parts.join(" · ")}</span>}
			</div>
		</div>
	);
}
