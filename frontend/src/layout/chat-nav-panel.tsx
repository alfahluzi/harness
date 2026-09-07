import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useActiveWorkdir } from "../hooks/use-active-workdir";
import { useSessions } from "../hooks/use-sessions";
import type { SessionSummary } from "@/lib/api";

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

function formatAgo(ms: number): string {
	const seconds = Math.floor((Date.now() - ms) / 1000);
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

export function ChatNavPanel() {
	const { configDir } = useActiveWorkdir();
	const query = useSessions();

	return (
		<div className="flex h-full flex-col gap-2 p-2 text-sm text-neutral-900 dark:text-neutral-100">
			<header className="flex flex-col gap-1 px-1 pt-1">
				<div className="flex items-center justify-between">
					<h2 className="font-semibold">Chat history</h2>
				</div>
				{configDir && (
					<span
						title={configDir}
						className="truncate text-xs text-neutral-500 dark:text-neutral-400"
					>
						{configDir}
					</span>
				)}
			</header>

			<Link
				to="/u/chat"
				search={{}}
				className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-500/20 dark:bg-slate-500/10 dark:text-slate-300 dark:hover:bg-slate-500/20"
			>
				<Plus className="h-4 w-4" />
				New chat
			</Link>

			{!configDir ? (
				<EmptyWorkspace />
			) : query.isLoading ? (
				<LoadingSkeleton />
			) : (query.data?.length ?? 0) === 0 ? (
				<div className="px-1 py-4 text-center text-xs text-neutral-500 dark:text-neutral-400">
					No sessions yet.
					<br />
					Start a new chat to create one.
				</div>
			) : (
				<ul className="flex flex-1 flex-col gap-1 overflow-y-auto pr-0.5">
					{(query.data ?? [])
						.slice()
						.sort((a, b) => b.createdAt - a.createdAt)
						.map((session) => (
							<SessionRow key={session.id} session={session} />
						))}
				</ul>
			)}
		</div>
	);
}

function EmptyWorkspace() {
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-2 px-2 text-center text-xs text-neutral-500 dark:text-neutral-400">
			<p>No workspace selected.</p>
			<Link
				to="/u/workspace"
				className="rounded-md border border-neutral-200 px-3 py-1.5 text-neutral-700 transition-colors hover:bg-neutral-200 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-800"
			>
				Open workspace
			</Link>
		</div>
	);
}

function LoadingSkeleton() {
	return (
		<ul className="flex flex-1 flex-col gap-2 px-1 py-1">
			{Array.from({ length: 5 }).map((_, i) => (
				<li
					key={i}
					className="flex flex-col gap-1.5 rounded-md border border-neutral-200 p-2 dark:border-neutral-800"
				>
					<div className="h-4 w-3/4 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
					<div className="h-3 w-1/2 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
				</li>
			))}
		</ul>
	);
}

function SessionRow({ session }: { session: SessionSummary }) {
	const title = session.description?.trim() || session.id.slice(0, 8);

	return (
		<li>
			<Link
				to="/u/chat"
				search={{ sessionId: session.id }}
				className="flex flex-col gap-1 rounded-md border border-transparent p-2 transition-colors hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50"
			>
				<div className="flex items-center gap-2">
					<span
						className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass(session.status)}`}
						aria-hidden="true"
					/>
					<span className="truncate font-medium">{title}</span>
				</div>
				<div className="flex items-center justify-between gap-2 pl-4 text-xs text-neutral-500 dark:text-neutral-400">
					<span className="truncate font-mono text-[10px]">
						{session.agentProfile || "—"}
					</span>
					<span className="shrink-0">{formatAgo(session.createdAt)}</span>
				</div>
			</Link>
		</li>
	);
}
