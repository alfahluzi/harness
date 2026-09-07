import { createFileRoute, Outlet } from "@tanstack/react-router";
import { FooterBar } from "../../layout/footer-bar";
import { HeaderBar } from "../../layout/header-bar";
import { LeftBar, type NavigationLeftItem } from "../../layout/left-bar";
import { MainPanel } from "../../layout/main-panel";
import { NavigationPanel } from "../../layout/navigation-panel";
import { McpNavPanel } from "./-components/mcp-nav-panel";
import { AgentsNavPanel } from "./-components/agents-nav-panel";
import { SkillsNavPanel } from "./-components/skills-nav-panel";
import { ChatNavPanel } from "../../layout/chat-nav-panel";
import { useRef, useState } from "react";

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

function WorkspaceIcon({ className }: { className?: string }) {
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
			<rect x="3" y="3" width="7" height="9" />
			<rect x="14" y="3" width="7" height="5" />
			<rect x="14" y="12" width="7" height="9" />
			<rect x="3" y="16" width="7" height="5" />
		</svg>
	);
}

function McpIcon({ className }: { className?: string }) {
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
			<rect x="3" y="3" width="18" height="18" rx="2" />
			<path d="M8 12h8" />
			<path d="M12 8v8" />
			<circle cx="8" cy="8" r="0.5" fill="currentColor" />
			<circle cx="16" cy="16" r="0.5" fill="currentColor" />
		</svg>
	);
}

function AgentIcon({ className }: { className?: string }) {
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
			<rect width="16" height="12" x="4" y="8" rx="2" />
			<path d="M12 8V4H8" />
			<path d="M2 14h2" />
			<path d="M20 14h2" />
			<path d="M15 13v2" />
			<path d="M9 13v2" />
		</svg>
	);
}

function SkillIcon({ className }: { className?: string }) {
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
			<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
			<path d="M9 18h6" />
			<path d="M10 22h4" />
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
		id: "workspace",
		label: "Workspace",
		icon: WorkspaceIcon,
		to: "/u/workspace",
	},
	{
		id: "chat",
		label: "Chat",
		icon: ChatIcon,
		child: <ChatNavPanel />,
	},
	{
		id: "mcps",
		label: "MCPs",
		icon: McpIcon,
		child: <McpNavPanel />,
	},
	{
		id: "agents",
		label: "Agents",
		icon: AgentIcon,
		child: <AgentsNavPanel />,
	},
	{
		id: "skills",
		label: "Skills",
		icon: SkillIcon,
		child: <SkillsNavPanel />,
	},
	{
		id: "settings",
		label: "Settings",
		icon: SettingsIcon,
		to: "/u/settings",
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
