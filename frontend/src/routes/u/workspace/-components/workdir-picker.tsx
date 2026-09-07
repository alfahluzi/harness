import { useState, type FormEvent } from "react";
import { useActiveWorkdir } from "../../../../hooks/use-active-workdir";
import { useDiscoveredWorkspaces } from "../../../../hooks/use-discovered-workspaces";

function projectLabel(punaPath: string): string {
	const segments = punaPath.split("/").filter(Boolean);
	if (segments.length === 0) return punaPath;
	return (
		segments[segments.length - 2] ?? segments[segments.length - 1] ?? punaPath
	);
}

export function WorkdirPicker() {
	const { configDir, setConfigDir } = useActiveWorkdir();
	const [draft, setDraft] = useState(configDir);
	const discovered = useDiscoveredWorkspaces();

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setConfigDir(draft.trim());
	}

	const list = discovered.data?.workspaces ?? [];

	return (
		<section className="flex flex-col gap-3 border border-neutral-200 dark:border-neutral-800 rounded-md p-3 bg-neutral-50 dark:bg-neutral-900">
			<form onSubmit={handleSubmit} className="flex items-end gap-2">
				<div className="flex-1">
					<label
						htmlFor="workdir-input"
						className="block text-xs uppercase tracking-wide text-neutral-500 mb-1"
					>
						Active workdir (.puna/)
					</label>
					<input
						id="workdir-input"
						type="text"
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						placeholder="/path/to/project/.puna"
						className="w-full px-2 py-1 border border-neutral-300 dark:border-neutral-700 rounded text-sm font-mono bg-white dark:bg-neutral-950"
					/>
				</div>
				<button
					type="submit"
					className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium"
				>
					Set
				</button>
				{configDir && (
					<button
						type="button"
						onClick={() => {
							setConfigDir("");
							setDraft("");
						}}
						className="px-2 py-1 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 text-sm"
						title="Clear active workdir"
					>
						Clear
					</button>
				)}
			</form>

			<div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
				<div className="flex items-center justify-between mb-2">
					<h3 className="text-xs uppercase tracking-wide text-neutral-500">
						Discovered workspaces
					</h3>
					<span className="text-[10px] text-neutral-500">
						{discovered.isLoading
							? "scanning…"
							: discovered.error
								? "scan failed"
								: `${list.length} found`}
					</span>
				</div>

				{discovered.isLoading && (
					<p className="text-xs text-neutral-500 italic">
						Scanning ~ for .puna/ directories…
					</p>
				)}
				{discovered.error && (
					<p className="text-xs text-red-600">
						Error: {discovered.error.message}
					</p>
				)}
				{!discovered.isLoading && !discovered.error && list.length === 0 && (
					<p className="text-xs text-neutral-500 italic">
						No .puna/ workspaces found under {discovered.data?.root ?? "~"}.
					</p>
				)}
				{list.length > 0 && (
					<ul className="flex flex-col gap-1 max-h-64 overflow-auto">
						{list.map((w) => {
							const active = configDir === w.path;
							return (
								<li key={w.path}>
									<button
										type="button"
										onClick={() => {
											setConfigDir(w.path);
											setDraft(w.path);
										}}
										className={`w-full text-left p-2 rounded border transition-colors ${
											active
												? "border-blue-500 bg-blue-50 dark:bg-blue-950/40"
												: "border-neutral-200 dark:border-neutral-800 hover:border-neutral-400 dark:hover:border-neutral-600"
										}`}
									>
										<div className="flex items-center justify-between gap-2">
											<span className="font-mono text-sm font-medium">
												{projectLabel(w.path)}
											</span>
											{active && (
												<span className="text-[10px] uppercase tracking-wide text-blue-600 dark:text-blue-400">
													active
												</span>
											)}
										</div>
										<div className="flex justify-between">
											<div className="text-[10px] text-neutral-500 font-mono break-all mt-0.5">
												{w.path}
											</div>
											<div className="text-[10px] text-neutral-500 font-mono break-all mt-0.5">
												{w.id}
											</div>
										</div>
									</button>
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</section>
	);
}
