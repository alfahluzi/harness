/**
 * `PluginSourceBadge` — small inline tag for a plugin's origin layer + kind.
 *
 * Source colors: workspace-local → green, workspace-global → blue,
 * system-global → purple. Kind is appended as a muted suffix.
 */
import type { PluginKind, PluginSource } from "@puna/sdk-shared";

const SOURCE_STYLES: Record<PluginSource, string> = {
	"workspace-local":
		"bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
	"workspace-global":
		"bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
	"system-global":
		"bg-purple-100 text-purple-800 dark:bg-purple-500/15 dark:text-purple-300",
};

export type PluginSourceBadgeProps = {
	source: PluginSource;
	kind?: PluginKind;
	className?: string;
};

export function PluginSourceBadge({
	source,
	kind,
	className,
}: PluginSourceBadgeProps) {
	return (
		<span
			title={kind ? `${source} · ${kind}` : source}
			className={
				"inline-flex shrink-0 items-center rounded-sm px-1 py-0.5 " +
				"text-[10px] font-medium uppercase tracking-wide " +
				`${SOURCE_STYLES[source]} ${className ?? ""}`
			}
		>
			{source}
			{kind ? <span className="ml-1 opacity-70">· {kind}</span> : null}
		</span>
	);
}
