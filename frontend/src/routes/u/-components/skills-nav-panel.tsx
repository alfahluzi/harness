import { useState } from "react";
import { useSkills } from "../../../hooks/use-skills";
import type { SkillSummary } from "@/lib/api";

export function SkillsNavPanel() {
	const [localOpen, setLocalOpen] = useState(true);
	const [globalOpen, setGlobalOpen] = useState(true);

	const list = useSkills();
	const skills = list.data?.skills ?? [];
	const local = skills.filter((s) => s.source === "local");
	const global = skills.filter((s) => s.source === "global");

	return (
		<div className="flex flex-col gap-3 p-2 h-full overflow-auto text-xs">
			<header className="flex flex-col gap-1">
				<h2 className="font-semibold text-sm">Skills</h2>
				<p className="text-[10px] text-neutral-500 leading-tight">
					Skills available locally and globally.
				</p>
			</header>

			{list.isLoading && (
				<p className="text-[11px] text-neutral-500 italic">Loading…</p>
			)}
			{list.error && (
				<p className="text-[11px] text-red-600">
					Error: {list.error.message}
				</p>
			)}

			{!list.isLoading && !list.error && (
				<>
					<Section
						title="Local skills"
						count={local.length}
						collapsible
						open={localOpen}
						onToggle={() => setLocalOpen((v) => !v)}
					>
						{local.length === 0 ? (
							<p className="text-[11px] text-neutral-500 italic">
								No local skills.
							</p>
						) : (
							<ul className="flex flex-col gap-1">
								{local.map((s) => (
									<SkillRow key={s.name} skill={s} />
								))}
							</ul>
						)}
					</Section>

					<Section
						title="Global skills"
						count={global.length}
						collapsible
						open={globalOpen}
						onToggle={() => setGlobalOpen((v) => !v)}
					>
						{global.length === 0 ? (
							<p className="text-[11px] text-neutral-500 italic">
								No global skills.
							</p>
						) : (
							<ul className="flex flex-col gap-1">
								{global.map((s) => (
									<SkillRow key={s.name} skill={s} />
								))}
							</ul>
						)}
					</Section>
				</>
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

function SkillRow({ skill }: { skill: SkillSummary }) {
	return (
		<li className="border border-neutral-200 dark:border-neutral-800 rounded p-1.5 bg-white dark:bg-neutral-900">
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-1">
					<span className="font-mono text-[11px] font-medium break-all">
						{skill.name}
					</span>
					<span
						className={`text-[9px] px-1 rounded uppercase tracking-wide font-semibold ${
							skill.source === "local"
								? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
								: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300"
						}`}
					>
						{skill.source}
					</span>
				</div>
				{skill.description ? (
					<p className="mt-0.5 text-[10px] text-neutral-500 leading-snug line-clamp-2">
						{skill.description}
					</p>
				) : (
					<p className="mt-0.5 font-mono text-[10px] text-neutral-500">
						{skill.scriptCount} script(s)
					</p>
				)}
			</div>
		</li>
	);
}
