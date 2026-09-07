import type { LayerSource } from "../../../../types/puna";

export function SourceBadge({ source }: { source: LayerSource }) {
	const isLocal = source === "local";
	const styles = isLocal
		? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
		: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300";
	return (
		<span
			className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide ${styles}`}
		>
			{source}
		</span>
	);
}