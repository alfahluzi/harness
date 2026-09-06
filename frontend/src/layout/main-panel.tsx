interface MainPanelProps {
	children: React.ReactNode;
}

export function MainPanel({ children }: MainPanelProps) {
	return (
		<main className="h-full w-full p-0.5">
			<div
				className={
					"h-full p-0.5 px-1 " +
					"border rounded-md border-neutral-200 dark:border-neutral-800 " +
					"bg-white dark:bg-neutral-900 " +
					"flex-1 overflow-auto  scrollbar-thumb-black scrollbar-thin"
				}
			>
				{children}
			</div>
		</main>
	);
}
