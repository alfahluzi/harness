import { useState } from "react";
import {
	useInstallMcp,
	useInstalledMcps,
	useMcpSearch,
	useUninstallMcp,
} from "../../../hooks/use-mcps";
import type { InstalledMcpSummary, PublicMcpSummary } from "@/lib/api";

type PendingInstall = { name: string };

export function McpNavPanel() {
	const [query, setQuery] = useState("");
	const [pending, setPending] = useState<PendingInstall | null>(null);
	const [installedOpen, setInstalledOpen] = useState(true);

	const search = useMcpSearch(query);
	const installedList = useInstalledMcps();
	const install = useInstallMcp();
	const uninstall = useUninstallMcp();

	const installedNames = new Set((installedList.data?.mcps ?? []).map((m) => m.name));
	const hasQuery = query.trim().length >= 2;

	return (
		<div className="flex flex-col gap-3 p-2 h-full overflow-auto text-xs">
			<header className="flex flex-col gap-1">
				<h2 className="font-semibold text-sm">MCPs</h2>
				<p className="text-[10px] text-neutral-500 leading-tight">
					Search official registry and install to local or global.
				</p>
			</header>

			<div className="flex gap-1 items-center">
				<input
					type="search"
					value={query}
					onChange={(e) => {
						setQuery(e.target.value);
						setPending(null);
					}}
					placeholder="Search registry…"
					className="flex-1 px-1.5 py-1 text-xs rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
				/>
				{search.isFetching && <span className="text-[10px] text-neutral-500">…</span>}
			</div>

			{search.isError && (
				<p className="text-[11px] text-red-600">Search failed: {search.error?.message}</p>
			)}

			{hasQuery && (
				<Section title="Registry" count={search.data?.servers.length}>
					{search.isLoading && (
						<p className="text-[11px] text-neutral-500 italic">Searching…</p>
					)}
					{!search.isLoading && (search.data?.servers ?? []).length === 0 && (
						<p className="text-[11px] text-neutral-500 italic">No results.</p>
					)}
					<ul className="flex flex-col gap-1">
						{(search.data?.servers ?? []).map((s) => (
							<RegistryRow
								key={s.name}
								mcp={s}
								installed={installedNames.has(s.name)}
								pending={pending?.name === s.name ? pending : null}
								onRequestInstall={() => setPending({ name: s.name })}
								onCancelInstall={() => setPending(null)}
								onConfirm={(target) => {
									install.mutate({ name: s.name, target });
									setPending(null);
								}}
								isInstalling={install.isPending}
								installError={
									install.error && install.variables?.name === s.name
										? install.error
										: null
								}
							/>
						))}
					</ul>
				</Section>
			)}

			<Section
				title="Installed"
				count={installedList.data?.mcps.length}
				collapsible
				open={installedOpen}
				onToggle={() => setInstalledOpen((v) => !v)}
			>
				{installedList.isLoading && (
					<p className="text-[11px] text-neutral-500 italic">Loading…</p>
				)}
				{installedList.error && (
					<p className="text-[11px] text-red-600">
						Error: {installedList.error.message}
					</p>
				)}
				{!installedList.isLoading &&
					!installedList.error &&
					(installedList.data?.mcps ?? []).length === 0 && (
						<p className="text-[11px] text-neutral-500 italic">
							None installed in this workspace.
						</p>
					)}
				<ul className="flex flex-col gap-1">
					{(installedList.data?.mcps ?? []).map((m) => (
						<InstalledRow
							key={m.name}
							mcp={m}
							onUninstall={() => uninstall.mutate(m.name)}
							isUninstalling={
								uninstall.isPending && uninstall.variables === m.name
							}
						/>
					))}
				</ul>
			</Section>

			{install.error && !install.variables?.name && (
				<p className="text-[11px] text-red-600">Install failed: {install.error.message}</p>
			)}
		</div>
	);
}

function Section({
	title,
	count,
	collapsible,
	open,
	onToggle,
	children,
}: {
	title: string;
	count?: number;
	collapsible?: boolean;
	open?: boolean;
	onToggle?: () => void;
	children: React.ReactNode;
}) {
	const label = (
		<>
			<span>{title}</span>
			{typeof count === "number" && (
				<span className="text-neutral-400 normal-case">({count})</span>
			)}
		</>
	);

	return (
		<section className="flex flex-col gap-1">
			{collapsible ? (
				<button
					type="button"
					onClick={onToggle}
					aria-expanded={open}
					className="self-start text-left text-[10px] uppercase tracking-wide text-neutral-500 flex items-center gap-1 hover:text-neutral-700 dark:hover:text-neutral-300"
				>
					<span
						aria-hidden
						className={`inline-block transition-transform duration-150 ${open ? "rotate-90" : ""}`}
					>
						▸
					</span>
					{label}
				</button>
			) : (
				<h3 className="text-[10px] uppercase tracking-wide text-neutral-500 flex items-center gap-1">
					{label}
				</h3>
			)}
			{(!collapsible || open) && children}
		</section>
	);
}

function RegistryRow({
	mcp,
	installed,
	pending,
	onRequestInstall,
	onCancelInstall,
	onConfirm,
	isInstalling,
	installError,
}: {
	mcp: PublicMcpSummary;
	installed: boolean;
	pending: PendingInstall | null;
	onRequestInstall: () => void;
	onCancelInstall: () => void;
	onConfirm: (target: "local" | "global") => void;
	isInstalling: boolean;
	installError: Error | null;
}) {
	const isExpanded = !!pending;
	return (
		<li className="border border-neutral-200 dark:border-neutral-800 rounded p-1.5 bg-white dark:bg-neutral-900">
			<div className="flex items-start justify-between gap-1">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1">
						<span className="font-mono text-[11px] font-medium break-all">
							{mcp.name}
						</span>
					</div>
					<div className="flex items-center gap-1 mt-0.5 text-[10px] text-neutral-500">
						<span>v{mcp.version}</span>
						{mcp.packages[0]?.transport && (
							<span className="font-mono">{mcp.packages[0].transport}</span>
						)}
					</div>
				</div>
				{installed ? (
					<span className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
						installed
					</span>
				) : !isExpanded ? (
					<button
						type="button"
						onClick={onRequestInstall}
						aria-label={`Install ${mcp.name}`}
						className="text-[11px] px-1.5 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700"
					>
						+
					</button>
				) : (
					<button
						type="button"
						onClick={onCancelInstall}
						aria-label="Cancel install"
						className="text-[11px] px-1.5 py-0.5 rounded text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
					>
						×
					</button>
				)}
			</div>

			{isExpanded && (
				<div className="mt-1.5 pt-1.5 border-t border-neutral-200 dark:border-neutral-800 flex flex-col gap-1">
					<p className="text-[10px] text-neutral-500">Install to:</p>
					<div className="flex gap-1">
						<button
							type="button"
							disabled={isInstalling}
							onClick={() => onConfirm("local")}
							className="flex-1 text-[11px] px-1.5 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
						>
							Local project
						</button>
						<button
							type="button"
							disabled={isInstalling}
							onClick={() => onConfirm("global")}
							className="flex-1 text-[11px] px-1.5 py-1 rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
						>
							Global (system)
						</button>
					</div>
				</div>
			)}

			{installError && (
				<p className="mt-1 text-[10px] text-red-600">{installError.message}</p>
			)}
		</li>
	);
}

function InstalledRow({
	mcp,
	onUninstall,
	isUninstalling,
}: {
	mcp: InstalledMcpSummary;
	onUninstall: () => void;
	isUninstalling: boolean;
}) {
	return (
		<li className="border border-neutral-200 dark:border-neutral-800 rounded p-1.5 bg-white dark:bg-neutral-900">
			<div className="flex items-start justify-between gap-1">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1">
						<span className="font-mono text-[11px] font-medium break-all">
							{mcp.name}
						</span>
						<span
							className={`text-[9px] px-1 rounded uppercase tracking-wide font-semibold ${
								mcp.source === "local"
									? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
									: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300"
							}`}
						>
							{mcp.source === "local" ? "local" : "global"}
						</span>
					</div>
					<div className="flex items-center gap-1 mt-0.5 text-[10px] text-neutral-500">
						<span>v{mcp.version}</span>
						{mcp.transport && <span className="font-mono">{mcp.transport}</span>}
						{mcp.identifier && (
							<span className="font-mono truncate">{mcp.identifier}</span>
						)}
					</div>
				</div>
				<button
					type="button"
					disabled={isUninstalling}
					onClick={onUninstall}
					aria-label={`Uninstall ${mcp.name}`}
					className="text-[11px] px-1.5 py-0.5 rounded text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50"
				>
					{isUninstalling ? "…" : "×"}
				</button>
			</div>
		</li>
	);
}