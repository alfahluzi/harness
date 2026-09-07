import { useState } from "react";
import { useSkill, useSkills } from "../../../../hooks/use-skills";
import type { SkillDetail } from "../../../../types/puna";
import { SourceBadge } from "./source-badge";

export function SkillsPanel() {
	const list = useSkills();
	const [selected, setSelected] = useState<string | null>(null);
	const detail = useSkill(selected);

	if (list.isLoading) {
		return (
			<section className="flex flex-col gap-2 border border-neutral-200 dark:border-neutral-800 rounded-md p-3 bg-white dark:bg-neutral-950">
				<header className="flex items-center justify-between">
					<h3 className="font-semibold">Skills</h3>
					<span className="text-xs text-neutral-500">…</span>
				</header>
				<p className="text-sm text-neutral-500">Loading skills…</p>
			</section>
		);
	}
	if (list.error) {
		return (
			<section className="flex flex-col gap-2 border border-neutral-200 dark:border-neutral-800 rounded-md p-3 bg-white dark:bg-neutral-950">
				<header className="flex items-center justify-between">
					<h3 className="font-semibold">Skills</h3>
					<span className="text-xs text-red-600">error</span>
				</header>
				<p className="text-sm text-red-600">Error: {list.error.message}</p>
			</section>
		);
	}
	if (!list.data) return null;

	const skills = list.data.skills;

	return (
		<section className="flex flex-col gap-2 border border-neutral-200 dark:border-neutral-800 rounded-md p-3 bg-white dark:bg-neutral-950">
			<header className="flex items-center justify-between">
				<h3 className="font-semibold">Skills</h3>
				<span className="text-xs text-neutral-500">{skills.length} total</span>
			</header>

			<div className="grid grid-cols-2 gap-3 min-h-[12rem]">
				<ul className="flex flex-col gap-1 overflow-auto max-h-96">
					{skills.length === 0 && (
						<li className="text-sm text-neutral-500 italic">No skills in this workspace.</li>
					)}
					{skills.map((s) => (
						<li key={s.name}>
							<button
								type="button"
								onClick={() => setSelected(s.name)}
								className={`w-full text-left p-2 rounded border transition-colors ${
									selected === s.name
										? "border-blue-500 bg-blue-50 dark:bg-blue-950/40"
										: "border-neutral-200 dark:border-neutral-800 hover:border-neutral-400 dark:hover:border-neutral-600"
								}`}
							>
								<div className="flex items-center justify-between gap-2">
									<span className="font-mono text-sm font-medium">{s.name}</span>
									<SourceBadge source={s.source} />
								</div>
								<div className="flex items-center gap-2 mt-0.5">
									<span className="text-[10px] text-neutral-500">{s.scriptCount} script(s)</span>
								</div>
							</button>
						</li>
					))}
				</ul>

				<div className="border-l border-neutral-200 dark:border-neutral-800 pl-3 overflow-auto max-h-96">
					{!selected && (
						<p className="text-xs text-neutral-500 italic">Select a skill to see its description and scripts.</p>
					)}
					{selected && detail.isLoading && (
						<p className="text-xs text-neutral-500">Loading {selected}…</p>
					)}
					{selected && detail.error && (
						<p className="text-xs text-red-600">Error: {detail.error.message}</p>
					)}
					{selected && detail.data && <SkillDetailView skill={detail.data} />}
				</div>
			</div>
		</section>
	);
}

function SkillDetailView({ skill }: { skill: SkillDetail }) {
	return (
		<div className="flex flex-col gap-2 text-sm">
			<div className="flex items-center gap-2">
				<span className="font-mono font-semibold">{skill.name}</span>
				<SourceBadge source={skill.source} />
			</div>
			<div className="text-[10px] text-neutral-500 font-mono break-all">{skill.resolvedDir}</div>
			{skill.description ? (
				<pre className="text-xs whitespace-pre-wrap font-sans bg-neutral-100 dark:bg-neutral-900 p-2 rounded">
					{skill.description}
				</pre>
			) : (
				<p className="text-xs text-neutral-500 italic">No description (desc.md missing).</p>
			)}
			<div>
				<p className="text-[10px] uppercase tracking-wide text-neutral-500">scripts</p>
				{skill.scripts.length === 0 ? (
					<p className="text-[10px] text-neutral-400 italic">none</p>
				) : (
					<ul className="flex flex-col gap-0.5">
						{skill.scripts.map((s) => (
							<li key={s.path} className="text-xs font-mono text-neutral-700 dark:text-neutral-300">
								{s.name}
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}