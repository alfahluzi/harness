import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { sessionTracker, useChatSessionStore } from "@/store/chat-session-store";
import { connectStream } from "@/lib/stream";

type StreamProviderProps = {
	baseUrl: string;
	children: ReactNode;
};

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const IDLE_CLOSE_MS = 5_000;

/**
 * Single global SSE firehose for the whole app lifetime (audit fix #12:
 * lazily connected — only open while at least one session is subscribed).
 * Reconnects with exponential backoff + ±20% jitter on drop (audit fix #11).
 */
export function StreamProvider({ baseUrl, children }: StreamProviderProps) {
	const count = useSyncExternalStore(
		sessionTracker.subscribe,
		() => sessionTracker.count,
		() => 0,
	);

	const disposedRef = useRef(false);
	const controllerRef = useRef<AbortController | null>(null);
	const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const backoffRef = useRef(INITIAL_BACKOFF_MS);
	const connectRef = useRef<() => void>(() => {});

	const scheduleReconnect = useCallback(() => {
		if (disposedRef.current) return;
		if (reconnectTimerRef.current !== null) return;
		if (controllerRef.current) return;
		const delay = backoffRef.current * (0.8 + Math.random() * 0.4);
		reconnectTimerRef.current = setTimeout(() => {
			reconnectTimerRef.current = null;
			connectRef.current();
		}, delay);
		backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
	}, []);

	const connect = useCallback(() => {
		if (disposedRef.current) return;
		if (controllerRef.current) return;

		const controller = new AbortController();
		controllerRef.current = controller;
		let opened = false;

		void connectStream(
			baseUrl,
			(e) => {
				opened = true;
				backoffRef.current = INITIAL_BACKOFF_MS;
				useChatSessionStore.getState().applyEvent(e);
			},
			controller.signal,
		)
			.then(() => {
				if (controllerRef.current !== controller) return;
				controllerRef.current = null;
				if (controller.signal.aborted || disposedRef.current) return;
				// Clean server-side close after a successful open → reconnect.
				if (opened) backoffRef.current = INITIAL_BACKOFF_MS;
				scheduleReconnect();
			})
			.catch(() => {
				if (controllerRef.current !== controller) return;
				controllerRef.current = null;
				if (controller.signal.aborted || disposedRef.current) return;
				scheduleReconnect();
			});
	}, [baseUrl, scheduleReconnect]);

	useEffect(() => {
		connectRef.current = connect;
	}, [connect]);

	const closeConnection = useCallback(() => {
		if (reconnectTimerRef.current !== null) {
			clearTimeout(reconnectTimerRef.current);
			reconnectTimerRef.current = null;
		}
		controllerRef.current?.abort();
		controllerRef.current = null;
		backoffRef.current = INITIAL_BACKOFF_MS;
	}, []);

	useEffect(() => {
		if (count > 0) {
			if (closeTimerRef.current !== null) {
				clearTimeout(closeTimerRef.current);
				closeTimerRef.current = null;
			}
			if (reconnectTimerRef.current !== null) {
				clearTimeout(reconnectTimerRef.current);
				reconnectTimerRef.current = null;
			}
			connect();
		} else {
			if (closeTimerRef.current !== null) return;
			closeTimerRef.current = setTimeout(() => {
				closeTimerRef.current = null;
				closeConnection();
			}, IDLE_CLOSE_MS);
		}
	}, [count, connect, closeConnection]);

	useEffect(() => {
		disposedRef.current = false;
		return () => {
			disposedRef.current = true;
			if (reconnectTimerRef.current !== null) {
				clearTimeout(reconnectTimerRef.current);
				reconnectTimerRef.current = null;
			}
			if (closeTimerRef.current !== null) {
				clearTimeout(closeTimerRef.current);
				closeTimerRef.current = null;
			}
			controllerRef.current?.abort();
			controllerRef.current = null;
		};
	}, []);

	return children;
}