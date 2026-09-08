import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";
import { useActiveWorkdir } from "../../../../hooks/use-active-workdir";
import { useSessions } from "../../../../hooks/use-sessions";
import type { SessionSummary } from "@/lib/api";
import type { ChatMessage } from "@/lib/chat-types";
import { ChatRequest } from "./chat-request";

function groupByHuman(messages: ChatMessage[]): ChatMessage[][] {
	const groups: ChatMessage[][] = [];
	for (const msg of messages) {
		if (msg.role === "human" || groups.length === 0) groups.push([msg]);
		else groups[groups.length - 1]!.push(msg);
	}
	return groups;
}

type ChatPanelProps = {
	sessionId?: string;
	messages: ChatMessage[];
	isStreaming: boolean;
	streamContent: string;
};

const STATUS_DOT: Record<string, string> = {
	running: "bg-blue-500",
	pending: "bg-amber-500",
	completed: "bg-emerald-500",
	error: "bg-red-500",
	cancelled: "bg-neutral-400",
};

function statusDotClass(status: string): string {
	return STATUS_DOT[status] ?? STATUS_DOT.cancelled!;
}

export function ChatPanel({
	sessionId,
	messages,
	isStreaming,
	streamContent,
}: ChatPanelProps) {
	const { configDir } = useActiveWorkdir();
	const sessions = useSessions();
	const scrollRef = useRef<HTMLDivElement>(null);

	const session = sessionId
		? sessions.data?.find((s) => s.id === sessionId)
		: undefined;

	const groups = useMemo(() => groupByHuman(messages), [messages]);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
	}, [messages, streamContent]);

	return (
		<div
			ref={scrollRef}
			className="h-full w-full flex flex-col gap-2 items-center justify-start my-2 overflow-y-auto scrollbar-thin"
		>
			<header className="sticky top-0 z-10 w-full max-w-3xl px-4 py-2 bg-neutral-50/90 dark:bg-neutral-950/90 backdrop-blur">
				{!configDir ? (
					<WorkspaceGuard />
				) : sessionId && session ? (
					<SessionHeader session={session} />
				) : sessionId ? (
					<div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
						<span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
						Starting session…
					</div>
				) : (
					<div className="flex flex-col gap-0.5">
						<h1 className="font-medium text-neutral-900 dark:text-neutral-100">
							New chat
						</h1>
						<p className="text-xs text-neutral-500 dark:text-neutral-400">
							Start a chat by sending a message below.
						</p>
					</div>
				)}
			</header>

			<div className="max-w-3xl w-full px-4 flex-1 flex flex-col gap-4">
				{sessionId && (
					<div className="mb-1 text-xs text-neutral-500 dark:text-neutral-400">
						Session {sessionId.slice(0, 8)}
					</div>
				)}
				{groups.map((group, i) => {
					const isLast = i === groups.length - 1;
					return (
						<ChatRequest
							key={i}
							messages={group}
							last={isLast}
							isStreaming={isLast && isStreaming}
							streamContent={isLast ? streamContent : ""}
						/>
					);
				})}
			</div>
		</div>
	);
}

function WorkspaceGuard() {
	return (
		<div className="flex flex-col gap-2">
			<p className="text-xs text-neutral-500 dark:text-neutral-400">
				Select a workspace to start chatting.
			</p>
			<Link
				to="/u/workspace"
				className="self-start rounded-md border border-neutral-200 px-3 py-1.5 text-xs text-neutral-700 transition-colors hover:bg-neutral-200 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-800"
			>
				Open workspace
			</Link>
		</div>
	);
}

function SessionHeader({ session }: { session: SessionSummary }) {
	const title = session.description?.trim() || session.id.slice(0, 8);

	return (
		<div className="flex items-center justify-between gap-2">
			<div className="flex items-center gap-2 min-w-0">
				<span
					className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass(session.status)}`}
					aria-hidden="true"
				/>
				<span className="truncate font-medium text-neutral-900 dark:text-neutral-100">
					{title}
				</span>
			</div>
			<span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-700 dark:border-slate-500/20 dark:bg-slate-500/10 dark:text-slate-300">
				active
			</span>
		</div>
	);
}
