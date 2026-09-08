import { createFileRoute, useNavigate } from "@tanstack/react-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatPanel } from "./-components/chat-panel";
import { Composer } from "./-components/composer";
import { useActiveWorkdir } from "@/hooks/use-active-workdir";
import { useCreateSession } from "@/hooks/use-create-session";
import { useSessionSubscription, useChatSessionStore } from "@/store/chat-session-store";
import {
	API_BASE_URL,
	cancelRun,
	fetchMessages,
	restartFromCheckpoint,
	startRun,
	switchBranch as apiSwitchBranch,
} from "@/lib/stream";
import { useAgentModelSelection } from "./-hooks/use-agent-model";
import type { ChatMessage } from "@/lib/chat-types";

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
const EMPTY_MESSAGES: ChatMessage[] = [];

function RouteComponent() {
	const { sessionId, prompt: pendingPrompt } = Route.useSearch();
	const navigate = useNavigate();
	const { configDir } = useActiveWorkdir();
	const createSession = useCreateSession();
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const autoSubmittedRef = useRef<Set<string>>(new Set());
	const {
		agentProfile,
		setAgentProfile,
		model,
		setModel,
		agents,
		models,
		providers,
		modelStatus,
		isLoadingAgents,
		isLoadingProviders,
		hasProvider,
	} = useAgentModelSelection();

	const [text, setText] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [info, setInfo] = useState<string | null>(null);
	const [historyLoaded, setHistoryLoaded] = useState(false);
	const [restartCheckpointId, setRestartCheckpointId] = useState<string | null>(
		null,
	);

	// Feed the app-lifetime firehose while this session is being viewed.
	useSessionSubscription(sessionId);

	// Per-session state from the global store. Selectors return stable
	// references, so unrelated sessions' events do not re-render this route.
	const messages = useChatSessionStore(
		(s) => s.sessions.get(sessionId ?? "")?.messages ?? EMPTY_MESSAGES,
	);
	const status = useChatSessionStore(
		(s) => s.sessions.get(sessionId ?? "")?.status ?? "idle",
	);

	const isStreaming = status === "streaming";

	// While streaming, applyEvent merges the in-progress AI text into the last
	// ai message — render it as the "live" bubble instead of as a final one.
	const lastMessage = messages[messages.length - 1];
	const streamContent =
		isStreaming && lastMessage?.role === "ai" ? lastMessage.content : "";
	const panelMessages =
		isStreaming && lastMessage?.role === "ai"
			? messages.slice(0, -1)
			: messages;

	const trimmed = text.trim();
	const isPending = createSession.isPending || isStreaming;
	const canSubmit =
		trimmed.length > 0 &&
		!isStreaming &&
		!createSession.isPending &&
		configDir.length > 0 &&
		hasProvider;

	const composerInfo = useMemo(() => {
		if (info) return info;
		if (
			!isLoadingProviders &&
			providers.length === 0 &&
			configDir.length > 0
		) {
			return "No provider configured. Add a provider to start chatting.";
		}
		return null;
	}, [info, isLoadingProviders, providers.length, configDir]);

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

	const restartFrom = useCallback((checkpointId: string, content: string) => {
		setRestartCheckpointId(checkpointId);
		setText(content);
		setError(null);
		setInfo(null);
		requestAnimationFrame(() => {
			textareaRef.current?.focus();
		});
	}, []);

	const switchBranch = useCallback(
		(checkpointId: string) => {
			if (!sessionId) return;
			apiSwitchBranch(API_BASE_URL, sessionId, checkpointId)
				.then(() => fetchMessages(API_BASE_URL, sessionId))
				.then(({ messages: msgs }) => {
					const store = useChatSessionStore.getState();
					store.reset(sessionId);
					store.applyHistory(sessionId, msgs);
				})
				.catch((err) => {
					setError(err instanceof Error ? err.message : String(err));
				});
		},
		[sessionId],
	);

	// Fire-and-forget run start: the POST returns { runId } immediately; all
	// stream relays arrive via the global firehose.
	const submitMessage = useCallback(
		(
			targetSessionId: string,
			message: string,
			streamAgent: string,
			streamModel?: string,
		) => {
			const store = useChatSessionStore.getState();
			if (store.getSession(targetSessionId)?.status === "streaming") return;
			store.appendHuman(targetSessionId, message);
			store.setStatus(targetSessionId, "streaming");
			setText("");
			resize();
			setError(null);
			setInfo(null);

			void startRun(API_BASE_URL, targetSessionId, {
				message,
				configDir,
				agentProfile: streamAgent,
				model: streamModel || undefined,
			})
				.then(({ runId }) => {
					useChatSessionStore.getState().setActiveRun(targetSessionId, runId);
				})
				.catch((err) => {
					useChatSessionStore.getState().setStatus(targetSessionId, "idle");
					setError(err instanceof Error ? err.message : String(err));
				});
		},
		[configDir],
	);

	useEffect(() => {
		setHistoryLoaded(false);
		setError(null);
		setInfo(null);
		if (!sessionId) return;

		let cancelled = false;
		fetchMessages(API_BASE_URL, sessionId)
			.then(({ messages: msgs }) => {
				if (cancelled) return;
				useChatSessionStore.getState().applyHistory(sessionId, msgs);
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

		submitMessage(sessionId, pendingPrompt, agentProfile, model || undefined);
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
		agentProfile,
		model,
		navigate,
		submitMessage,
	]);

	const handleSubmit = () => {
		if (!trimmed) return;
		if (configDir.length === 0) return;
		if (isStreaming) return;

		if (sessionId && restartCheckpointId) {
			const store = useChatSessionStore.getState();
			store.setStatus(sessionId, "streaming");
			setText("");
			resize();
			setError(null);
			setInfo(null);
			const cpId = restartCheckpointId;
			setRestartCheckpointId(null);
			void restartFromCheckpoint(API_BASE_URL, sessionId, {
				checkpointId: cpId,
				message: trimmed,
				configDir,
				agentProfile,
				model: model || undefined,
			})
				.then(({ runId }) => {
					useChatSessionStore.getState().setActiveRun(sessionId, runId);
					return fetchMessages(API_BASE_URL, sessionId);
				})
				.then(({ messages: msgs }) => {
					const store = useChatSessionStore.getState();
					store.reset(sessionId);
					store.applyHistory(sessionId, msgs);
					store.setStatus(sessionId, "streaming");
				})
				.catch((err) => {
					useChatSessionStore.getState().setStatus(sessionId, "idle");
					setError(err instanceof Error ? err.message : String(err));
				});
			return;
		}

		if (sessionId) {
			submitMessage(sessionId, trimmed, agentProfile, model || undefined);
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
				agentProfile,
				model: model || undefined,
			},
			{
				onSuccess: (created: { sessionId: string }) => {
					setText("");
					resize();
					void navigate({
						to: "/u/chat",
						search: { sessionId: created.sessionId, prompt: trimmed },
						replace: true,
					});
				},
				onError: (err: Error) => {
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
		if (createSession.isPending) {
			createSession.reset();
			setInfo("Stopped.");
			return;
		}
		if (!sessionId) return;
		void cancelRun(API_BASE_URL, sessionId).catch((err) => {
			setError(err instanceof Error ? err.message : String(err));
		});
	};

	useEffect(() => {
		resize();
	}, [text]);

	return (
		<div className="relative flex flex-col h-full text-sm">
			<ChatPanel
				sessionId={sessionId}
				messages={panelMessages}
				isStreaming={isStreaming}
				streamContent={streamContent}
				onRestart={restartFrom}
				onSwitchBranch={switchBranch}
			/>
			<Composer
				text={text}
				error={error}
				info={composerInfo}
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