import { createFileRoute } from "@tanstack/react-router";
import { Composer } from "./-components/composer";
import { ChatPanel } from "./-components/chat-panel";

export const Route = createFileRoute("/u/chat/")({
	component: RouteComponent,
});

function RouteComponent() {
	return (
		<div className="relative flex flex-col gap-1 h-full text-sm">
			<ChatPanel />
			<Composer />
		</div>
	);
}
