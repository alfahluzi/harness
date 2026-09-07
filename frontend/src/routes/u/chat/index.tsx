import { createFileRoute, useNavigate } from "@tanstack/react-router";
import React, { useEffect, useRef, useState } from "react";
import { ChatPanel } from "./-components/chat-panel";
import { Composer } from "./-components/composer";
import { useActiveWorkdir } from "@/hooks/use-active-workdir";
import { useCreateSession } from "@/hooks/use-create-session";

export const Route = createFileRoute("/u/chat/")({
	validateSearch: (search: Record<string, unknown>) => ({
		sessionId: typeof search.sessionId === "string" ? search.sessionId : undefined,
	}),
	component: RouteComponent,
});

const MAX_HEIGHT = 200;

function RouteComponent() {
	const { sessionId } = Route.useSearch();
	const navigate = useNavigate();
	const { configDir } = useActiveWorkdir();
	const createSession = useCreateSession();
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const [text, setText] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [info, setInfo] = useState<string | null>(null);

	const trimmed = text.trim();
	const isPending = createSession.isPending;
	const canSubmit = trimmed.length > 0 && !isPending && configDir.length > 0;

	const resize = () => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.style.height = "auto";
		const nextHeight = Math.min(textarea.scrollHeight, MAX_HEIGHT);
		textarea.style.height = `${nextHeight}px`;
		textarea.style.overflowY = textarea.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
	};

	const handleChange = (next: string) => {
		setText(next);
		setError(null);
		setInfo(null);
	};

	const handleSubmit = () => {
		if (!trimmed) return;
		if (configDir.length === 0) return;
		if (sessionId) {
			setText("");
			resize();
			setInfo("Message API not wired yet.");
			return;
		}

		setError(null);
		setInfo(null);
		createSession.mutate(
			{
				workspaceId: configDir,
				description: trimmed.slice(0, 80),
				prompt: trimmed,
			},
			{
				onSuccess: (created) => {
					setText("");
					resize();
					void navigate({ to: "/u/chat", search: { sessionId: created.sessionId } });
				},
				onError: (err) => {
					setError(err instanceof Error ? err.message : "Failed to start session");
				},
			},
		);
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSubmit();
		}
	};

	const handleStop = () => {
		if (createSession.isPending) {
			createSession.reset();
			setInfo("Stopped.");
		}
	};

	useEffect(() => {
		resize();
	}, [text]);

	return (
		<div className="relative flex flex-col gap-1 h-full text-sm">
			<ChatPanel sessionId={sessionId} />
			<Composer
				text={text}
				error={error}
				info={info}
				onTextChange={handleChange}
				onSubmit={handleSubmit}
				onKeyDown={handleKeyDown}
				onStop={handleStop}
				isPending={isPending}
				canSubmit={canSubmit}
				textareaRef={textareaRef}
				onAutoResize={resize}
			/>
		</div>
	);
}
