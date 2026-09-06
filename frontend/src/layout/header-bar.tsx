import { PanelRight } from "lucide-react";
import { useTheme } from "../hooks/use-theme";

export function HeaderBar() {
	const { theme, toggleTheme } = useTheme();
	const isDark = theme === "dark";

	return (
		<header className="col-span-3 row-start-1 flex h-10 items-center justify-between border-b border-neutral-200 bg-neutral-50/80 px-4 text-sm font-medium text-neutral-700 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/80 dark:text-neutral-300">
			<div className="w-full flex gap-1 justify-start">
				<_HeaderButton>
					<span className="truncate mx-2 text-xs">Models</span>
				</_HeaderButton>
				<_HeaderButton>
					<span className="truncate mx-2 text-xs">Pricing</span>
				</_HeaderButton>
				<_HeaderButton>
					<span className="truncate mx-2 text-xs">Docs</span>
				</_HeaderButton>
			</div>
			<div className="w-full flex gap-1 justify-between">
				<input
					placeholder="Search something.."
					className={
						"h-6 p-1 w-full text-xs " +
						"border border-neutral-300 dark:border-neutral-800 " +
						"focus:border-neutral-400 focus:dark:border-neutral-700 " +
						"focus:outline-none " +
						"rounded-sm"
					}
				></input>
			</div>
			<div className="w-full flex gap-1 justify-end">
				<_HeaderButton
					onClick={toggleTheme}
					aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
					title={isDark ? "Switch to light mode" : "Switch to dark mode"}
				>
					{isDark ? (
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							className="h-4 w-4"
							aria-hidden="true"
						>
							<circle cx="12" cy="12" r="4" />
							<path d="M12 2v2" />
							<path d="M12 20v2" />
							<path d="m4.93 4.93 1.41 1.41" />
							<path d="m17.66 17.66 1.41 1.41" />
							<path d="M2 12h2" />
							<path d="M20 12h2" />
							<path d="m6.34 17.66-1.41 1.41" />
							<path d="m19.07 4.93-1.41 1.41" />
						</svg>
					) : (
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							className="h-4 w-4"
							aria-hidden="true"
						>
							<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
						</svg>
					)}
				</_HeaderButton>
				<_HeaderButton>
					<PanelRight size={18} />
				</_HeaderButton>
			</div>
		</header>
	);
}
type _HeaderButtonProps = React.ComponentProps<"button">;

function _HeaderButton({ className, children, ...props }: _HeaderButtonProps) {
	return (
		<button
			type="button"
			className={
				"inline-flex h-7 min-w-7 items-center justify-center rounded-md " +
				"text-neutral-500 transition-colors " +
				"hover:bg-neutral-200 hover:text-neutral-900 " +
				"focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 " +
				"dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 " +
				{ className }
			}
			{...props}
		>
			{children}
		</button>
	);
}
