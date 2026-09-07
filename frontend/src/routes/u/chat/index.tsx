import { createFileRoute, useNavigate } from "@tanstack/react-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChatPanel } from "./-components/chat-panel";
import { Composer } from "./-components/composer";
import { useActiveWorkdir } from "@/hooks/use-active-workdir";
import { useCreateSession } from "@/hooks/use-create-session";
import { fetchMessages, streamChatMessage, API_BASE_URL } from "@/lib/stream";
import type { ChatMessage } from "@/lib/chat-types";
import { useAgentModelSelection } from "./-hooks/use-agent-model";

export const Route = createFileRoute("/u/chat/")({
	validateSearch: (search: Record<string, unknown>) => {
		const result: { sessionId?: string; prompt?: string } = {};
		if (typeof search.sessionId === "string") result.sessionId = search.sessionId;
		if (typeof search.prompt === "string") result.prompt = search.prompt;
		return result;
	},
	component: RouteComponent,
});

const MAX_HEIGHT = 200;

function RouteComponent() {
	const { sessionId, prompt: pendingPrompt } = Route.useSearch();
	const navigate = useNavigate();
	const { configDir } = useActiveWorkdir();
	const createSession = useCreateSession();
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const abortControllerRef = useRef<AbortController | null>(null);
	const autoSubmittedRef = useRef<Set<string>>(new Set());
	const {
		agentProfile,
		setAgentProfile,
		model,
		setModel,
		agents,
		models,
		modelStatus,
		isLoadingAgents,
		hasProvider,
	} = useAgentModelSelection();

	const [text, setText] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [info, setInfo] = useState<string | null>(null);
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [isStreaming, setIsStreaming] = useState(false);
	const [streamContent, setStreamContent] = useState("");
	const [historyLoaded, setHistoryLoaded] = useState(false);

	const trimmed = text.trim();
	const isPending = createSession.isPending || isStreaming;
	const canSubmit =
		trimmed.length > 0 &&
		!isStreaming &&
		!createSession.isPending &&
		configDir.length > 0 &&
		hasProvider;

	const resize = () => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.style.height = "auto";
		const nextHeight = Math.min(textarea.scrollHeight, MAX_HEIGHT);
		textarea.style.height = `${nextHeight}px`;
		textarea.style.overflowY =
			textarea.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
	};

	const handleChange = (next: string) => {
		setText(next);
		setError(null);
		setInfo(null);
	};

	const finalizeStream = useCallback(
		(aiText: string, stopped: boolean) => {
			setMessages((prev) => {
				if (!aiText) return prev;
				return [...prev, { role: "ai", content: aiText }];
			});
			setStreamContent("");
			setIsStreaming(false);
			abortControllerRef.current = null;
			if (stopped) setInfo("Stopped.");
		},
		[],
	);

	const startStream = useCallback(
		async (
			targetSessionId: string,
			message: string,
			streamAgent?: string,
			streamModel?: string,
		) => {
			if (!configDir || isStreaming) return;

			setMessages((prev) => {
				const last = prev[prev.length - 1];
				if (last && last.role === "human" && last.content === message) {
					return prev;
				}
				return [...prev, { role: "human", content: message }];
			});

			setText("");
			resize();
			setError(null);
			setInfo(null);
			setIsStreaming(true);
			setStreamContent("");

			let aiText = "";
			const controller = new AbortController();
			abortControllerRef.current = controller;

			try {
				for await (const event of streamChatMessage(
					API_BASE_URL,
					targetSessionId,
					{
						message,
						configDir,
						agentProfile: streamAgent || undefined,
						model: streamModel || undefined,
					},
					controller.signal,
				)) {
					if (event.type === "messages") {
						const deltas = Array.isArray(event.data) ? event.data : [];
						const chunk = deltas
							.map((d) =>
								typeof d.content === "string" ? d.content : "",
							)
							.join("");
						if (chunk) {
							aiText += chunk;
							setStreamContent(aiText);
						}
					} else if (event.type === "error") {
						const msg =
							typeof event.data === "object" &&
							event.data &&
							"message" in event.data
								? String(event.data.message)
								: JSON.stringify(event.data);
						setError(msg);
					} else if (event.type === "__end__") {
						break;
					}
				}
				finalizeStream(aiText, false);
			} catch (err) {
				if (err instanceof DOMException && err.name === "AbortError") {
					finalizeStream(aiText, true);
				} else {
					finalizeStream(aiText, false);
					setError(err instanceof Error ? err.message : String(err));
				}
			}
		},
		[configDir, finalizeStream, isStreaming],
	);

	useEffect(() => {
		setMessages([]);
		setHistoryLoaded(false);
		setError(null);
		setInfo(null);
		if (!sessionId) return;

		let cancelled = false;
		fetchMessages(API_BASE_URL, sessionId)
			.then((msgs) => {
				if (cancelled) return;
				setMessages(msgs);
				setHistoryLoaded(true);
			})
			.catch((err) => {
				if (cancelled) return;
				setError(err instanceof Error ? err.message : String(err));
				setHistoryLoaded(true);
			});

		return () => {
			cancelled = true;
		};
	}, [sessionId]);

	useEffect(() => {
		if (
			!sessionId ||
			!pendingPrompt ||
			!historyLoaded ||
			isStreaming ||
			createSession.isPending ||
			configDir.length === 0
		) {
			return;
		}

		const key = `${sessionId}:${pendingPrompt}`;
		if (autoSubmittedRef.current.has(key)) return;
		autoSubmittedRef.current.add(key);

		void startStream(
			sessionId,
			pendingPrompt,
			agentProfile || undefined,
			model || undefined,
		);
		void navigate({
			to: "/u/chat",
			search: { sessionId },
			replace: true,
		});
	}, [
		sessionId,
		pendingPrompt,
		historyLoaded,
		isStreaming,
		createSession.isPending,
		configDir,
		navigate,
		startStream,
	]);

	const handleSubmit = () => {
		if (!trimmed) return;
		if (configDir.length === 0) return;
		if (isStreaming) return;

		if (sessionId) {
			void startStream(
				sessionId,
				trimmed,
				agentProfile || undefined,
				model || undefined,
			);
			return;
		}

		setError(null);
		setInfo(null);
		createSession.mutate(
			{
				workspaceId: configDir,
				configDir,
				description: trimmed.slice(0, 80),
				prompt: trimmed,
				agentProfile: agentProfile || undefined,
				model: model || undefined,
			},
			{
				onSuccess: (created) => {
					setText("");
					resize();
					void navigate({
						to: "/u/chat",
						search: { sessionId: created.sessionId, prompt: trimmed },
						replace: true,
					});
				},
				onError: (err) => {
					setError(
						err instanceof Error ? err.message : "Failed to start session",
					);
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
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
		}
		if (createSession.isPending) {
			createSession.reset();
			setInfo("Stopped.");
		}
	};

	useEffect(() => {
		resize();
	}, [text]);

	return (
		<div className="relative flex flex-col h-full text-sm">
			<ChatPanel
				sessionId={sessionId}
				messages={messages}
				isStreaming={isStreaming}
				streamContent={streamContent}
			/>
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
				agentProfile={agentProfile}
				model={model}
				agents={agents}
				models={models}
				onAgentChange={setAgentProfile}
				onModelChange={setModel}
				modelStatus={modelStatus}
				isLoadingAgents={isLoadingAgents}
			/>
		</div>
	);
}
