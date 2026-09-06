import { useMemo, useRef, useState, type ComponentType } from "react";
import { NavigationPanel } from "./navigation-panel";

export interface NavigationLeftItem {
	id: string;
	label: string;
	icon: ComponentType<{ className?: string }>;
	child?: React.ReactNode;
}

export interface LeftDockProps {
	items: NavigationLeftItem[];
}

export function LeftBar({ items }: LeftDockProps) {
	const [activeItemId, setActiveItemId] = useState<string | null>("users");
	const handleActivate = (id: string) => {
		setActiveItemId((prev) => (prev === id ? null : id));
	};
	const [navWidth, setNavWidth] = useState(240);
	const isResizingRef = useRef(false);

	const activeItem = useMemo(
		() => items.find((item) => item.id === activeItemId) ?? null,
		[activeItemId],
	);

	const handleResizeStart = (e: React.PointerEvent) => {
		e.preventDefault();
		isResizingRef.current = true;
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";

		const startX = e.clientX;
		const startWidth = navWidth;

		const handlePointerMove = (moveEvent: PointerEvent) => {
			if (!isResizingRef.current) return;
			const delta = moveEvent.clientX - startX;
			setNavWidth(Math.min(Math.max(startWidth + delta, 180), 480));
		};

		const handlePointerUp = () => {
			isResizingRef.current = false;
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			document.removeEventListener("pointermove", handlePointerMove);
			document.removeEventListener("pointerup", handlePointerUp);
		};

		document.addEventListener("pointermove", handlePointerMove);
		document.addEventListener("pointerup", handlePointerUp);
	};

	return (
		<div className="flex">
			<aside className="row-start-2 flex w-12 flex-col items-center gap-2 border-neutral-200 bg-neutral-100 py-3 dark:border-neutral-800 dark:bg-neutral-950">
				{items.map((item) => {
					const isActive = item.id === activeItemId;
					const Icon = item.icon;
					return (
						<button
							key={item.id}
							type="button"
							aria-label={item.label}
							aria-pressed={isActive}
							onClick={() => handleActivate(item.id)}
							className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
								isActive
									? "bg-slate-50 text-slate-600 dark:bg-slate-500/10 dark:text-slate-400"
									: "text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
							}`}
						>
							<Icon className="h-5 w-5" />
						</button>
					);
				})}
			</aside>
			{activeItem && (
				<NavigationPanel
					width={navWidth}
					onResizeRightStart={handleResizeStart}
				>
					{activeItem.child}
				</NavigationPanel>
			)}
		</div>
	);
}
