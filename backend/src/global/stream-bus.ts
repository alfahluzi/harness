import { EventEmitter } from "node:events";

export type StreamEvent = {
	sessionId: string;
	runId: string;
	seq: number; // per-run, resets to 0 for each new run
	type: string; // "messages" | "updates" | "error" | "done" | "cancelled"
	data: unknown;
	ts: number;
};

type StreamBusEventMap = {
	event: [StreamEvent];
};

/**
 * Global in-memory event bus for run stream parts. Runs publish envelopes via
 * `publish()`; every connected `ConnectionMux` relays them to its SSE socket.
 * Knows nothing about modules/sessions — workspace filtering is delegated to an
 * injectable resolver so this file can live in `src/global/` untouched by the
 * module isolation rule.
 */
export class StreamBus extends EventEmitter<StreamBusEventMap> {
	private seqByRun = new Map<string, number>();
	private workspaceResolver?: (sessionId: string) => string | undefined;

	/** Inject a sessionId → workspaceId lookup (set once at server boot). */
	setWorkspaceResolver(
		resolver?: (sessionId: string) => string | undefined,
	): void {
		this.workspaceResolver = resolver;
	}

	/** Resolve a session's workspaceId via the injected resolver (if any). */
	resolveWorkspace(sessionId: string): string | undefined {
		return this.workspaceResolver?.(sessionId);
	}

	publish(sessionId: string, runId: string, type: string, data: unknown): void {
		const seq = this.seqByRun.get(runId) ?? 0;
		this.seqByRun.set(runId, seq + 1);
		// Terminal events close the per-run sequence; the next publish for the
		// same runId (i.e. a new run) restarts at seq 0.
		if (type === "done" || type === "cancelled" || type === "error") {
			this.seqByRun.delete(runId);
		}
		this.emit("event", { sessionId, runId, seq, type, data, ts: Date.now() });
	}
}

export const streamBus = new StreamBus();

export interface ConnectionMuxOptions {
	bus?: StreamBus;
	queueCap?: number;
	heartbeatMs?: number;
}

const DEFAULT_QUEUE_CAP = 1000;
const DEFAULT_HEARTBEAT_MS = 15_000;

/**
 * One SSE connection. Subscribes to the bus, buffers envelopes in a bounded
 * FIFO (drop-oldest on overflow, audit fix #5) and drains them to the
 * ReadableStream controller. Heartbeat keeps idle connections alive through
 * reverse proxies (audit fix #6). Detach on client abort.
 */
export class ConnectionMux {
	private readonly bus: StreamBus;
	private readonly workspaceId?: string;
	private readonly queueCap: number;
	private readonly heartbeatMs: number;
	private readonly listener: (event: StreamEvent) => void;
	private queue: StreamEvent[] = [];
	private controller?: ReadableStreamDefaultController<Uint8Array>;
	private encoder?: TextEncoder;
	private heartbeatTimer?: ReturnType<typeof setInterval>;

	constructor(workspaceId?: string, opts: ConnectionMuxOptions = {}) {
		this.bus = opts.bus ?? streamBus;
		this.workspaceId = workspaceId;
		this.queueCap = opts.queueCap ?? DEFAULT_QUEUE_CAP;
		this.heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
		this.listener = (event) => this.onBusEvent(event);
		// Subscribe eagerly so events published between construction and attach
		// are buffered (bounded, drop-oldest) instead of lost.
		this.bus.on("event", this.listener);
	}

	attach(
		controller: ReadableStreamDefaultController<Uint8Array>,
		encoder: TextEncoder,
	): void {
		if (this.controller) {
			throw new Error("ConnectionMux is already attached");
		}
		this.controller = controller;
		this.encoder = encoder;
		// Flush anything published while not attached yet.
		this.drain();
		this.heartbeatTimer = setInterval(() => this.heartbeat(), this.heartbeatMs);
	}

	detach(): void {
		this.bus.off("event", this.listener);
		if (this.heartbeatTimer !== undefined) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = undefined;
		}
		this.controller = undefined;
		this.encoder = undefined;
		this.queue.length = 0;
	}

	private onBusEvent(event: StreamEvent): void {
		if (this.workspaceId !== undefined) {
			if (this.bus.resolveWorkspace(event.sessionId) !== this.workspaceId) {
				return;
			}
		}
		// Bounded queue: never block the publisher. Drop oldest when full.
		if (this.queue.length >= this.queueCap) {
			this.queue.shift();
		}
		this.queue.push(event);
		this.drain();
	}

	private drain(): void {
		if (!this.controller || !this.encoder) return;
		while (this.queue.length > 0) {
			const event = this.queue.shift()!;
			this.controller.enqueue(
				this.encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
			);
		}
	}

	private heartbeat(): void {
		if (this.controller && this.encoder) {
			this.controller.enqueue(this.encoder.encode(": keepalive\n\n"));
		}
	}
}