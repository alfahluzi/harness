import { useState } from "react";
import { useAgent, useAgents } from "../../../../hooks/use-agents";
import type { AgentDetail } from "../../../../types/puna";
import { SourceBadge } from "./source-badge";

export function AgentsPanel() {
	const list = useAgents();
	const [selected, setSelected] = useState<string | null>(null);
	const detail = useAgent(selected);

	if (list.isLoading) {
		return <PanelShell title="Agents" count="…"><p className="text-sm text-neutral-500">Loading agents…</p></PanelShell>;
	}
	if (list.error) {
		return (
			<PanelShell title="Agents" count="error">
				<p className="text-sm text-red-600">Error: {list.error.message}</p>
			</PanelShell>
		);
	}
	if (!list.data) {
		return <PanelShell title="Agents" count="0"><p className="text-sm text-neutral-500">No data.</p></PanelShell>;
	}

	const agents = list.data.agents;

	return (
		<section className="flex flex-col gap-2 border border-neutral-200 dark:border-neutral-800 rounded-md p-3 bg-white dark:bg-neutral-950">
			<header className="flex items-center justify-between">
				<h3 className="font-semibold">Agents</h3>
				<span className="text-xs text-neutral-500">{agents.length} total</span>
			</header>

			<div className="grid grid-cols-2 gap-3 min-h-[12rem]">
				<ul className="flex flex-col gap-1 overflow-auto max-h-96">
					{agents.length === 0 && (
						<li className="text-sm text-neutral-500 italic">No agents found in this workspace.</li>
					)}
					{agents.map((a) => (
						<li key={a.name}>
							<button
								type="button"
								onClick={() => setSelected(a.name)}
								className={`w-full text-left p-2 rounded border transition-colors ${
									selected === a.name
										? "border-blue-500 bg-blue-50 dark:bg-blue-950/40"
										: "border-neutral-200 dark:border-neutral-800 hover:border-neutral-400 dark:hover:border-neutral-600"
								}`}
							>
								<div className="flex items-center justify-between gap-2">
									<span className="font-mono text-sm font-medium">{a.name}</span>
									<SourceBadge source={a.source} />
								</div>
								{a.description && (
									<p className="text-xs text-neutral-500 dark:text-neutral-400 line-clamp-2 mt-0.5">
										{a.description}
									</p>
								)}
							</button>
						</li>
					))}
				</ul>

				<div className="border-l border-neutral-200 dark:border-neutral-800 pl-3 overflow-auto max-h-96">
					{!selected && (
						<p className="text-xs text-neutral-500 italic">Select an agent to see its prompt and tools.</p>
					)}
					{selected && detail.isLoading && (
						<p className="text-xs text-neutral-500">Loading {selected}…</p>
					)}
					{selected && detail.error && (
						<p className="text-xs text-red-600">Error: {detail.error.message}</p>
					)}
					{selected && detail.data && <AgentDetailView agent={detail.data} />}
				</div>
			</div>
		</section>
	);
}

function PanelShell({
	title,
	count,
	children,
}: {
	title: string;
	count: string | number;
	children: React.ReactNode;
}) {
	return (
		<section className="flex flex-col gap-2 border border-neutral-200 dark:border-neutral-800 rounded-md p-3 bg-white dark:bg-neutral-950">
			<header className="flex items-center justify-between">
				<h3 className="font-semibold">{title}</h3>
				<span className="text-xs text-neutral-500">{count}</span>
			</header>
			{children}
		</section>
	);
}

function AgentDetailView({ agent }: { agent: AgentDetail }) {
	return (
		<div className="flex flex-col gap-2 text-sm">
			<div className="flex items-center gap-2">
				<span className="font-mono font-semibold">{agent.name}</span>
				<SourceBadge source={agent.source} />
			</div>
			<div className="text-[10px] text-neutral-500 font-mono break-all">{agent.resolvedDir}</div>
			{agent.description && <p className="text-xs">{agent.description}</p>}
			<dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
				<dt className="text-neutral-500">role</dt>
				<dd className="font-mono">{agent.role ?? "—"}</dd>
				<dt className="text-neutral-500">temp</dt>
				<dd className="font-mono">{agent.temperature ?? "—"}</dd>
				<dt className="text-neutral-500">called</dt>
				<dd className="font-mono">{agent.called ?? "—"}</dd>
			</dl>
			{agent.tools && (
				<div className="flex flex-col gap-1">
					<div>
						<p className="text-[10px] uppercase tracking-wide text-neutral-500">tools allow</p>
						<div className="flex flex-wrap gap-1">
							{agent.tools.allow.length === 0 && (
								<span className="text-[10px] text-neutral-400 italic">none</span>
							)}
							{agent.tools.allow.map((t) => (
								<span
									key={t}
									className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
								>
									{t}
								</span>
							))}
						</div>
					</div>
					<div>
						<p className="text-[10px] uppercase tracking-wide text-neutral-500">tools deny</p>
						<div className="flex flex-wrap gap-1">
							{agent.tools.deny.length === 0 && (
								<span className="text-[10px] text-neutral-400 italic">none</span>
							)}
							{agent.tools.deny.map((t) => (
								<span
									key={t}
									className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
								>
									{t}
								</span>
							))}
						</div>
					</div>
				</div>
			)}
			<details className="text-xs">
				<summary className="cursor-pointer text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">
					prompt
				</summary>
				<pre className="mt-1 p-2 bg-neutral-100 dark:bg-neutral-900 rounded text-[10px] overflow-auto max-h-64 whitespace-pre-wrap font-mono">
					{agent.prompt}
				</pre>
			</details>
		</div>
	);
}