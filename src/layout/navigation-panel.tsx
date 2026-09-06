interface NavigationPanelProps {
	width: number;
	children?: React.ReactNode;
	onResizeLeftStart?: (e: React.PointerEvent) => void;
	onResizeRightStart?: (e: React.PointerEvent) => void;
}

export function NavigationPanel({
	children,
	width,
	onResizeLeftStart,
	onResizeRightStart,
}: NavigationPanelProps) {
	return (
		<nav
			className="relative flex h-full shrink-0 flex-col bg-neutral-100 dark:bg-neutral-950"
			style={{ width }}
		>
			{onResizeLeftStart && (
				<div
					onPointerDown={onResizeLeftStart}
					className="absolute left-0 top-0 h-[calc(100%-8px)] my-1 w-1 cursor-col-resize hover:bg-neutral-400/30 active:bg-neutral-500/50"
				/>
			)}
			<div className="border m-0.5 rounded-md border-neutral-200 dark:border-neutral-800 h-full">
				{children}
			</div>
			{onResizeRightStart && (
				<div
					onPointerDown={onResizeRightStart}
					className="absolute right-0 top-0 h-[calc(100%-8px)] my-1 w-1 cursor-col-resize hover:bg-neutral-400/30 active:bg-neutral-500/50"
				/>
			)}
		</nav>
	);
}
