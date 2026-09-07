import { useSessions } from "../../../../hooks/use-sessions";
import type { SessionSummary } from "@/lib/api";

const STATUS_STYLES: Record<string, string> = {
	running: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
	pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
	completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
	error: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
	cancelled: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
};

function statusClass(status: string): string {
	return STATUS_STYLES[status] ?? STATUS_STYLES.cancelled!;
}

function formatTime(ms: number): string {
	try {
		const d = new Date(ms);
		return d.toLocaleString();
	} catch {
		return String(ms);
	}
}

function formatDuration(start: number, end?: number): string {
	const finish = end ?? Date.now();
	const ms = Math.max(0, finish - start);
	if (ms < 1000) return `${ms}ms`;
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	const rs = s % 60;
	if (m < 60) return `${m}m ${rs}s`;
	const h = Math.floor(m / 60);
	const rm = m % 60;
	return `${h}h ${rm}m`;
}

export function SessionsPanel() {
	const query = useSessions();

	return (
		<section className="flex flex-col gap-2 border border-neutral-200 dark:border-neutral-800 rounded-md p-3 bg-white dark:bg-neutral-950">
			<header className="flex items-center justify-between">
				<h3 className="font-semibold">Session history</h3>
				<span className="text-xs text-neutral-500">
					{query.isLoading
						? "…"
						: query.error
							? "error"
							: `${query.data?.length ?? 0} total`}
				</span>
			</header>

			{query.isLoading && (
				<p className="text-sm text-neutral-500">Loading sessions…</p>
			)}
			{query.error && (
				<p className="text-sm text-red-600">Error: {query.error.message}</p>
			)}
			{!query.isLoading && !query.error && (query.data?.length ?? 0) === 0 && (
				<p className="text-sm text-neutral-500 italic">
					No sessions yet for this workspace.
				</p>
			)}

			{!query.isLoading && !query.error && (query.data?.length ?? 0) > 0 && (
				<ul className="flex flex-col gap-1 overflow-auto max-h-[28rem]">
					{(query.data ?? []).map((s) => (
						<SessionRow key={s.id} session={s} />
					))}
				</ul>
			)}
		</section>
	);
}

function SessionRow({ session }: { session: SessionSummary }) {
	return (
		<li className="flex flex-col gap-0.5 p-2 rounded border border-neutral-200 dark:border-neutral-800 hover:border-neutral-400 dark:hover:border-neutral-600 transition-colors">
			<div className="flex items-center justify-between gap-2">
				<span className="font-mono text-sm font-medium truncate">
					{session.description || session.id}
				</span>
				<span
					className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-mono ${statusClass(session.status)}`}
				>
					{session.status}
				</span>
			</div>
			<div className="flex items-center justify-between gap-2 text-[10px] text-neutral-500 font-mono">
				<span className="truncate">{session.id}</span>
				<span className="shrink-0">{session.agentProfile}</span>
			</div>
			<div className="flex items-center justify-between gap-2 text-[10px] text-neutral-500">
				<span>{formatTime(session.createdAt)}</span>
				<span>{formatDuration(session.createdAt, session.completedAt)}</span>
			</div>
		</li>
	);
}
