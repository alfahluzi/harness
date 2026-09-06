import { createFileRoute, Outlet } from "@tanstack/react-router";
import { FooterBar } from "../../layout/footer-bar";
import { HeaderBar } from "../../layout/header-bar";
import { LeftBar, type NavigationLeftItem } from "../../layout/left-dock";
import { MainPanel } from "../../layout/main-panel";
import { NavigationPanel } from "../../layout/navigation-panel";
import { useRef, useState } from "react";

function UsersIcon({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
			<circle cx="9" cy="7" r="4" />
			<path d="M22 21v-2a4 4 0 0 0-3-3.87" />
			<path d="M16 3.13a4 4 0 0 1 0 7.75" />
		</svg>
	);
}

function ShieldIcon({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
		</svg>
	);
}

function ChatIcon({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
		</svg>
	);
}

function SettingsIcon({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<circle cx="12" cy="12" r="3" />
			<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
		</svg>
	);
}

const DOCK_ITEMS: NavigationLeftItem[] = [
	{
		id: "chat",
		label: "Chat",
		icon: ChatIcon,
	},
	{
		id: "users",
		label: "Users",
		icon: UsersIcon,
	},
	{
		id: "roles",
		label: "Roles",
		icon: ShieldIcon,
	},
	{
		id: "settings",
		label: "Settings",
		icon: SettingsIcon,
	},
];

export const Route = createFileRoute("/u")({
	component: UsersLayout,
});
function UsersLayout() {
	const [navWidth, setNavWidth] = useState(240);
	const isResizingRef = useRef(false);

	const handleResizeStart = (e: React.PointerEvent) => {
		e.preventDefault();
		isResizingRef.current = true;
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";

		const startX = e.clientX;
		const startWidth = navWidth;

		const handlePointerMove = (moveEvent: PointerEvent) => {
			if (!isResizingRef.current) return;
			const delta = startX - moveEvent.clientX;
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
		<div className="flex h-screen w-screen flex-col overflow-hidden bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
			<HeaderBar />
			<div className="flex flex-1 overflow-hidden">
				<LeftBar items={DOCK_ITEMS} />
				<MainPanel>
					<Outlet />
				</MainPanel>
				<NavigationPanel
					onResizeLeftStart={handleResizeStart}
					width={navWidth}
				></NavigationPanel>
			</div>
			<FooterBar />
		</div>
	);
}
