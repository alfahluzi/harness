import { useEffect } from "react";
import { create } from "zustand";
import type {
	ChatMessage,
	MessageRole,
	SseMessageChunk,
	StreamEvent,
} from "@/lib/chat-types";

export type SessionStatus = "idle" | "streaming" | "error" | "cancelled";

export type SessionState = {
	messages: ChatMessage[];
	// Dedup per runId: seq is per-run (resets to 0 for each new run).
	lastSeqByRun: Map<string, number>;
	status: SessionStatus;
	activeRunId?: string;
	// Run that produced the last streamed message — merge guard so a new run
	// starts a fresh ai message instead of continuing the previous turn.
	lastRunId?: string;
	// Last human message we appended optimistically, for content-dedup vs backfill.
	lastHumanContent?: string;
};

type StoreState = {
	sessions: Map<string, SessionState>;
	applyEvent: (e: StreamEvent) => void;
	applyHistory: (sessionId: string, messages: ChatMessage[]) => void;
	setActiveRun: (sessionId: string, runId: string | undefined) => void;
	setStatus: (sessionId: string, status: SessionStatus) => void;
	appendHuman: (sessionId: string, content: string) => void;
	reset: (sessionId: string) => void;
	getSession: (sessionId: string) => SessionState | undefined;
};

function emptySession(): SessionState {
	return { messages: [], lastSeqByRun: new Map(), status: "idle" };
}

function lens(
	sessions: Map<string, SessionState>,
	sessionId: string,
	next: SessionState,
): Pick<StoreState, "sessions"> {
	const copy = new Map(sessions);
	copy.set(sessionId, next);
	return { sessions: copy };
}

/**
 * Session-subscription ref tracker shared by StreamProvider (which opens the
 * firehose while the set is non-empty) and useSessionSubscription.
 */
const trackedSessions = new Set<string>();
const trackerListeners = new Set<() => void>();

export const sessionTracker = {
	add(sessionId: string): void {
		if (trackedSessions.has(sessionId)) return;
		trackedSessions.add(sessionId);
		for (const fn of trackerListeners) fn();
	},
	remove(sessionId: string): void {
		if (!trackedSessions.delete(sessionId)) return;
		for (const fn of trackerListeners) fn();
	},
	get count(): number {
		return trackedSessions.size;
	},
	subscribe(fn: () => void): () => void {
		trackerListeners.add(fn);
		return () => {
			trackerListeners.delete(fn);
		};
	},
};

/**
 * Subscribe the app-lifetime firehose to one session: increments the ref
 * count while the component is mounted, decrements on unmount. Does NOT open
 * a per-session connection — the firehose is global.
 */
export function useSessionSubscription(sessionId: string | undefined): void {
	useEffect(() => {
		if (!sessionId) return;
		sessionTracker.add(sessionId);
		return () => sessionTracker.remove(sessionId);
	}, [sessionId]);
}

export const useChatSessionStore = create<StoreState>()((set, get) => ({
	sessions: new Map(),

	applyEvent: (e) =>
		set((s) => {
			const prev = s.sessions.get(e.sessionId);
			const prevSeq = prev?.lastSeqByRun.get(e.runId) ?? -1;
			if (e.seq <= prevSeq) return s;

			const next: SessionState = {
				messages: prev?.messages ?? [],
				lastSeqByRun: new Map(prev?.lastSeqByRun ?? []).set(e.runId, e.seq),
				status: prev?.status ?? "idle",
				activeRunId: e.runId,
				lastRunId: e.runId,
				lastHumanContent: prev?.lastHumanContent,
			};
			// Streamed deltas of the current run merge into the in-progress ai
			// message; a new run (or a fresh reload where lastRunId is unset)
			// starts a new message.
			const sameRun = prev?.lastRunId === undefined || prev.lastRunId === e.runId;

			switch (e.type) {
				case "messages": {
					if (next.status !== "error" && next.status !== "cancelled") {
						next.status = "streaming";
					}
					const chunks = Array.isArray(e.data)
						? (e.data as SseMessageChunk[])
						: [];
					const messages = [...next.messages];
					for (const chunk of chunks) {
						// Wire messages carry LangGraph `type` ("ai"|"human"|"tool");
						// `role` is the app-level alias. Accept both.
						const rawRole = chunk.role ?? chunk.type;
						const role: MessageRole | undefined =
							rawRole === "ai" || rawRole === "human" || rawRole === "tool"
								? rawRole
								: undefined;
						const content =
							typeof chunk.content === "string" ? chunk.content : "";
						if (role === "ai") {
							if (!content) continue;
							const last = messages[messages.length - 1];
							if (last && last.role === "ai" && sameRun) {
								messages[messages.length - 1] = {
									role: "ai",
									content: last.content + content,
								};
							} else {
								messages.push({ role: "ai", content });
							}
						} else if (role === "human" || role === "tool") {
							if (!content) continue;
							messages.push({ role, content });
						}
					}
					next.messages = messages;
					break;
				}
				case "error":
					next.status = "error";
					break;
				case "cancelled":
					next.status = "cancelled";
					break;
				case "done":
					next.status = "idle";
					next.activeRunId = undefined;
					break;
				default:
					// updates/metadata/... — forward-compat, ignore.
					break;
			}

			return lens(s.sessions, e.sessionId, next);
		}),

	// Backfill from GET /sessions/:id/messages, content-deduped against live
	// events (audit fix #8 — seq can't dedup history vs live).
	applyHistory: (sessionId, history) =>
		set((s) => {
			const prev = s.sessions.get(sessionId);
			if (!prev || prev.messages.length === 0) {
				return lens(s.sessions, sessionId, { ...emptySession(), messages: history });
			}
			const hist = [...history];
			// Drop the backfill copy of a human message we appended optimistically.
			const lastHist = hist[hist.length - 1];
			if (
				prev.lastHumanContent &&
				lastHist?.role === "human" &&
				lastHist.content === prev.lastHumanContent
			) {
				hist.pop();
			}
			// Drop trailing backfilled AI messages whose content the live tail
			// equals or supersedes (reload mid-run: live has the fresher copy).
			const live = prev.messages;
			const liveLast = live[live.length - 1];
			if (liveLast?.role === "ai") {
				while (hist.length > 0) {
					const tail = hist[hist.length - 1];
					if (tail.role !== "ai") break;
					if (liveLast.content.startsWith(tail.content)) hist.pop();
					else break;
				}
			}
			// Re-append the live tail so events applied since (re)load are never
			// lost; concatenate the junction so continuation deltas keep merging
			// into a single ai message.
			const histTail = hist[hist.length - 1];
			const messages: ChatMessage[] =
				histTail?.role === "ai" && live[0]?.role === "ai"
					? [
							...hist.slice(0, -1),
							{ role: "ai", content: histTail.content + live[0].content },
							...live.slice(1),
						]
					: [...hist, ...live];
			return lens(s.sessions, sessionId, { ...prev, messages });
		}),

	setActiveRun: (sessionId, runId) =>
		set((s) => {
			const prev = s.sessions.get(sessionId) ?? emptySession();
			return lens(s.sessions, sessionId, {
				...prev,
				activeRunId: runId,
				status: runId ? "streaming" : prev.status,
			});
		}),

	setStatus: (sessionId, status) =>
		set((s) => {
			const prev = s.sessions.get(sessionId) ?? emptySession();
			return lens(s.sessions, sessionId, { ...prev, status });
		}),

	appendHuman: (sessionId, content) =>
		set((s) => {
			const prev = s.sessions.get(sessionId) ?? emptySession();
			const messages = [...prev.messages];
			const last = messages[messages.length - 1];
			if (last?.role === "human" && last.content === content) return s;
			messages.push({ role: "human", content });
			return lens(s.sessions, sessionId, { ...prev, messages, lastHumanContent: content });
		}),

	reset: (sessionId) =>
		set((s) => {
			if (!s.sessions.has(sessionId)) return s;
			const copy = new Map(s.sessions);
			copy.delete(sessionId);
			return { sessions: copy };
		}),

	getSession: (sessionId) => get().sessions.get(sessionId),
}));