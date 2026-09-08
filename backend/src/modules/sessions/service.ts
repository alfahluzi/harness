import { Client } from "@langchain/langgraph-sdk";
import { config } from "../../global/config";
import { resolveAgentRuntimeConfig } from "../../global/agent-runtime";
import { ThreadBusyError } from "../../global/errors";
import { streamBus } from "../../global/stream-bus";
import { SessionRepository, type SessionRecord } from "./repository";

/**
 * Consume a run's stream in the background and relay every part to the global
 * StreamBus. Detached from any HTTP connection: the run keeps publishing even
 * if the calling client disconnects. Always emits a terminal envelope
 * ("done" / "cancelled" / "error") so frontends never hang on "streaming".
 */
async function consumeRunToBus(
	svc: SessionService,
	record: SessionRecord,
	runId: string,
): Promise<void> {
	try {
		for await (const part of svc.langgraphClient.runs.joinStream(
			record.childThreadId,
			runId,
			{ streamMode: ["messages-tuple", "updates"] },
		)) {
			if (part.event === "error") {
				streamBus.publish(record.id, runId, "error", part.data);
				if (!svc.isDeleted(record.id)) {
					svc.repository.setError(record.id, String(part.data), Date.now());
				}
				return;
			}
			const enriched =
				part.event === "messages" || part.event === "messages/partial"
					? svc.enrichMessagesPayload(part.data)
					: part.data;
			streamBus.publish(record.id, runId, part.event, enriched);
		}
		// Normal completion — persist FIRST, then publish done (audit fix #4).
		// Fetch state and persist inside a try so a getState failure classifies
		// correctly and does not misattribute a network error to the run.
		try {
			const state = await svc.langgraphClient.threads.getState(
				record.childThreadId,
			);
			if (!svc.isDeleted(record.id)) {
				svc.repository.setResult(record.id, state.values, Date.now());
			}
			streamBus.publish(record.id, runId, "done", null);
		} catch (persistErr) {
			// Stream completed successfully but result persistence failed.
			// Publish a distinct terminal so client knows the run completed but
			// the result is unavailable via GET /sessions/:id/result.
			const msg = String(persistErr);
			streamBus.publish(record.id, runId, "error", {
				error: `run completed but result persist failed: ${msg}`,
			});
			if (!svc.isDeleted(record.id)) {
				svc.repository.setError(record.id, msg, Date.now());
			}
		}
	} catch (e) {
		// Distinguish cancel vs error (audit fix #9)
		const msg = String(e);
		const isCancel = /cancel|aborted/i.test(msg);
		if (isCancel) {
			streamBus.publish(record.id, runId, "cancelled", null);
			if (!svc.isDeleted(record.id)) {
				svc.repository.setStatus(record.id, "cancelled");
			}
		} else {
			streamBus.publish(record.id, runId, "error", { error: msg });
			if (!svc.isDeleted(record.id)) {
				svc.repository.setError(record.id, msg, Date.now());
			}
		}
	} finally {
		if (record.parentThreadId && !svc.isDeleted(record.id)) {
			svc.notifyParent(record).catch((err) =>
				console.error(`notifyParent failed for ${record.id}:`, err),
			);
		}
	}
}

export class SessionService {
	private langgraph_client: Client;
	private repo: SessionRepository;
	private activeCount = new Map<string, number>();
	// Per-childThreadId promise chain serializes check-then-act around
	// assertThreadIdle + runs.create (TOCTOU race, audit fix #3).
	private mutexes = new Map<string, Promise<void>>();
	private deletedSessions = new Set<string>();

	constructor(repo: SessionRepository = new SessionRepository(), client?: Client) {
		this.langgraph_client = client ?? new Client({ apiUrl: config.langgraphUrl });
		this.repo = repo;
	}

	private async withThreadLock<T>(
		threadId: string,
		fn: () => Promise<T>,
	): Promise<T> {
		const prev = this.mutexes.get(threadId) ?? Promise.resolve();
		let release!: () => void;
		const next = new Promise<void>((res) => {
			release = res;
		});
		// Store the chain in a local and compare against IT in the delete guard.
		// The map value is `prev.then(() => next)` (a distinct promise object),
		// NOT `next` — a raw `=== next` guard would never fire and leak the map.
		const chain = prev.then(() => next);
		this.mutexes.set(threadId, chain);
		await prev;
		try {
			return await fn();
		} finally {
			release();
			if (this.mutexes.get(threadId) === chain) this.mutexes.delete(threadId);
		}
	}

	/** Read-only accessor for the internal LangGraph client (used by consumeRunToBus). */
	get langgraphClient(): Client {
		return this.langgraph_client;
	}

	/** Read-only accessor for the repository (used by the module-level consumeRunToBus). */
	get repository(): SessionRepository {
		return this.repo;
	}

	async create(opts: {
		workspaceId: string;
		parent?: string;
		description: string;
		prompt: string;
		agentProfile: string;
		background: boolean;
		configDir: string;
		model?: string;
		start?: boolean;
	}) {
		const child = await this.langgraph_client.threads.create();
		const sessionId = `bg_${crypto.randomUUID().slice(0, 8)}`;
		const createdAt = Date.now();

		const record: SessionRecord = {
			id: sessionId,
			workspaceId: opts.workspaceId,
			description: opts.description,
			parentThreadId: opts.parent,
			childThreadId: child.thread_id,
			runId: "",
			agentProfile: opts.agentProfile,
			background: opts.background,
			configDir: opts.configDir,
			model: opts.model,
			status: "pending",
			createdAt,
		};

		this.repo.insert(record);

		if (!opts.background) {
			record.status = "running";
			this.repo.setStatus(sessionId, "running");
			const runtime = await resolveAgentRuntimeConfig(
				opts.configDir,
				opts.agentProfile,
				undefined,
				{ model: opts.model },
			);
			const run = await this.langgraph_client.runs.wait(
				child.thread_id,
				config.graphId,
				{
					input: { messages: [{ role: "human", content: opts.prompt }] },
					config: runtime,
				},
			);
			record.status = "completed";
			record.completedAt = Date.now();
			record.result = run;
			this.repo.setResult(sessionId, run, record.completedAt);
			return {
				sessionId: sessionId,
				thread_id: child.thread_id,
				status: record.status,
				result: run,
			};
		}

		// background=false: run synchronously and return the result.
		// background=true + start=false: create the thread only; the caller
		//   (chat) drives the run via /stream — no launch, so no double-run.
		// background=true + start=true (default): fire the run in background.
		if (opts.start === false) {
			return {
				sessionId: sessionId,
				thread_id: child.thread_id,
				status: record.status,
			};
		}

		void this.launch(record, opts.prompt);
		return {
			sessionId: sessionId,
			thread_id: child.thread_id,
			status: record.status,
		};
	}

	async list(opts: { workspaceId?: string } = {}) {
		const rows = opts.workspaceId
			? this.repo.listByWorkspace(opts.workspaceId)
			: this.repo.list();
		return rows.map((r) => ({
			id: r.id,
			workspaceId: r.workspaceId,
			description: r.description,
			status: r.status,
			agentProfile: r.agentProfile,
			createdAt: r.createdAt,
			completedAt: r.completedAt,
		}));
	}

	private async launch(record: SessionRecord, prompt: string) {
		await this.acquireSlot(record.agentProfile);
		record.status = "running";
		this.repo.setStatus(record.id, "running");

		try {
			const runtime = await resolveAgentRuntimeConfig(
				record.configDir,
				record.agentProfile,
				undefined,
				{ model: record.model },
			);
			const run = await this.withThreadLock(record.childThreadId, async () => {
				await this.assertThreadIdle(record.childThreadId);
				return this.langgraph_client.runs.create(
					record.childThreadId,
					config.graphId,
					{
						input: { messages: [{ role: "human", content: prompt }] },
						config: runtime,
					},
				);
			});
			record.runId = run.run_id;
			this.repo.setRunId(record.id, run.run_id);

			await this.waitForCompletion(record);

			const state = await this.langgraph_client.threads.getState(
				record.childThreadId,
			);
			record.status = "completed";
			record.completedAt = Date.now();
			record.result = state.values;
			this.repo.setResult(record.id, state.values, record.completedAt);
		} catch (e) {
			record.status = "error";
			record.error = String(e);
			record.completedAt = Date.now();
			this.repo.setError(record.id, String(e), record.completedAt);
		} finally {
			this.releaseSlot(record.agentProfile);
			if (record.parentThreadId) {
				await this.notifyParent(record).catch((e) =>
					console.error(`notifyParent failed for ${record.id}:`, e),
				);
			}
		}
	}

	private async waitForCompletion(record: SessionRecord) {
		try {
			for await (const _chunk of this.langgraph_client.runs.joinStream(
				record.childThreadId,
				record.runId,
			)) {
				// no-op for now; can stream tool-call progress later
			}
		} catch {
			while (true) {
				const run = await this.langgraph_client.runs.get(
					record.childThreadId,
					record.runId,
				);
				if (run.status === "success" || run.status === "error") return;
				await new Promise((r) => setTimeout(r, 2000));
			}
		}
	}

	/** Push a reminder into the parent thread once this session settles. */
	async notifyParent(record: SessionRecord) {
		if (!record.parentThreadId) return;

		const siblings = this.repo.listByParent(record.parentThreadId);

		const siblingsStillRunning = siblings.some(
			(r) => r.id !== record.id && r.status === "running",
		);

		const notification = this.renderReminder(record, siblingsStillRunning);

		await this.langgraph_client.threads.updateState(record.parentThreadId, {
			values: { messages: [{ role: "system", content: notification }] },
		});

		if (!siblingsStillRunning) {
			// Wake the parent agent to process the notification. Skip if the
			// parent already has an active run — the updateState message above
			// stays in the thread and will surface on the parent's next turn.
			try {
				await this.withThreadLock(record.parentThreadId, async () => {
					await this.assertThreadIdle(record.parentThreadId!);
					await this.langgraph_client.runs.create(
						record.parentThreadId!,
						config.graphId,
						{
							input: null,
						},
					);
				});
			} catch (e) {
				if (!(e instanceof ThreadBusyError)) throw e;
				console.warn(
					`notifyParent skipped runs.create for ${record.id}: parent thread busy`,
				);
			}
		}
	}

	private renderReminder(record: SessionRecord, stillRunning: boolean) {
		const lines = [
			`[BACKGROUND SESSION ${record.status.toUpperCase()}]`,
			`ID: ${record.id}`,
		];
		if (record.status === "error") lines.push(`Error: ${record.error}`);
		lines.push(
			stillRunning
				? "Other background sessions still running. Do NOT poll."
				: "All background sessions complete.",
		);
		lines.push(`Use get_result(id="${record.id}") to retrieve output.`);
		return lines.join("\n");
	}

	async getStatus(id: string) {
		const r = this.repo.getOrThrow(id);
		return {
			status: r.status,
			createdAt: r.createdAt,
			completedAt: r.completedAt,
		};
	}

	/**
	 * workspaceId for the SSE workspace filter. Returns undefined for unknown
	 * sessions instead of throwing so the bus listener never breaks a publish
	 * for a session that was deleted mid-run.
	 */
	getSessionWorkspace(id: string): string | undefined {
		try {
			return this.repo.getOrThrow(id).workspaceId;
		} catch {
			return undefined;
		}
	}

	/** Called by consumeRunToBus to check if the session was deleted mid-run.
	 * When true, callers should skip DB writes and parent-thread notification. */
	isDeleted(id: string): boolean {
		return this.deletedSessions.has(id);
	}

	async getResult(id: string) {
		const r = this.repo.getOrThrow(id);
		if (r.status !== "completed" && r.status !== "error")
			return { status: r.status };
		return { status: r.status, result: r.result };
	}

	async sendMessage(
		id: string,
		message: string,
		configDir: string,
		opts?: { agentProfile?: string; model?: string },
	) {
		const r = this.repo.getOrThrow(id);
		const agentProfile = opts?.agentProfile?.trim() || r.agentProfile;
		const runtime = await resolveAgentRuntimeConfig(
			configDir,
			agentProfile,
			undefined,
			{ model: opts?.model },
		);
		return this.withThreadLock(r.childThreadId, async () => {
			await this.assertThreadIdle(r.childThreadId);
			let run;
			try {
				run = await this.langgraph_client.runs.wait(
					r.childThreadId,
					config.graphId,
					{
						input: { messages: [{ role: "human", content: message }] },
						config: runtime,
					},
				);
			} catch (e) {
				if (this.isThreadBusy(e)) throw new ThreadBusyError(r.childThreadId);
				throw e;
			}
			this.repo.setResult(id, run, Date.now());
			return run;
		});
	}

	/**
	 * Start a run on an existing session thread and return immediately. All
	 * stream parts are relayed to the global StreamBus by a detached
	 * consumeRunToBus task, so the run survives client disconnects and any
	 * number of SSE connections can watch it.
	 */
	async startRun(
		id: string,
		message: string,
		configDir: string,
		opts?: { agentProfile?: string; model?: string },
	): Promise<{ runId: string; status: "running" }> {
		const r = this.repo.getOrThrow(id);
		const agentProfile = opts?.agentProfile?.trim() || r.agentProfile;
		const runtime = await resolveAgentRuntimeConfig(
			configDir,
			agentProfile,
			undefined,
			{ model: opts?.model },
		);
		let runId!: string;
		await this.withThreadLock(r.childThreadId, async () => {
			await this.assertThreadIdle(r.childThreadId);
			let run;
			try {
				run = await this.langgraph_client.runs.create(
					r.childThreadId,
					config.graphId,
					{
						input: { messages: [{ role: "human", content: message }] },
						config: runtime,
						streamMode: ["messages-tuple", "updates"],
					},
				);
			} catch (e) {
				if (this.isThreadBusy(e)) throw new ThreadBusyError(r.childThreadId);
				throw e;
			}
			this.repo.setRunId(r.id, run.run_id);
			this.repo.setStatus(r.id, "running");
			runId = run.run_id;
			// DETACH: detached task with explicit .catch() (audit fix #2)
			consumeRunToBus(this, r, run.run_id).catch((e) => {
				console.error(`consumeRunToBus unhandled for ${r.id}:`, e);
				streamBus.publish(r.id, run.run_id, "error", { error: String(e) });
				if (!this.isDeleted(r.id)) {
					this.repo.setError(r.id, String(e), Date.now());
				}
			});
		});
		return { runId, status: "running" };
	}

	/** Best-effort cancel of the active run. The consumeRunToBus loop catches
	 * the resulting throw and publishes a "cancelled" envelope (audit fix #9). */
	async cancelRun(id: string): Promise<void> {
		const r = this.repo.getOrThrow(id);
		if (!r.runId) return; // no-op
		try {
			await this.langgraph_client.runs.cancel(r.childThreadId, r.runId);
		} catch (e) {
			// Already done or other benign — cancelRun is best-effort
			console.warn(`cancelRun best-effort ignore: ${e}`);
		}
	}

	private stringifyContent(content: unknown): string {
		if (typeof content === "string") return content;
		if (content == null) return "";
		if (Array.isArray(content)) {
			return content
				.map((p) => {
					if (
						p &&
						typeof p === "object" &&
						(p as { type?: unknown }).type === "text" &&
						typeof (p as { text?: unknown }).text === "string"
					) {
						return (p as { text: string }).text;
					}
					return JSON.stringify(p);
				})
				.join("");
		}
		return JSON.stringify(content);
	}

	/**
	 * Extract model + timestamp + token usage from a LangChain-shaped message.
	 * `response_metadata` and `usage_metadata` are populated automatically by
	 * LangChain chat model wrappers for AI messages. Human messages usually
	 * carry none of these; timestamp for them is filled from the checkpoint
	 * step that wrote the message (see getMessages).
	 */
	private extractMessageMeta(m: unknown): {
		model?: string;
		ts?: string;
		usage?: {
			input_tokens?: number;
			output_tokens?: number;
			total_tokens?: number;
			cache_read_input_tokens?: number;
			cache_creation_input_tokens?: number;
		};
	} {
		if (!m || typeof m !== "object") return {};
		const msg = m as {
			response_metadata?: unknown;
			usage_metadata?: unknown;
			additional_kwargs?: unknown;
		};
		const meta: {
			model?: string;
			ts?: string;
			usage?: {
				input_tokens?: number;
				output_tokens?: number;
				total_tokens?: number;
				cache_read_input_tokens?: number;
				cache_creation_input_tokens?: number;
			};
		} = {};

		const respMeta =
			msg.response_metadata && typeof msg.response_metadata === "object"
				? (msg.response_metadata as Record<string, unknown>)
				: undefined;
		if (respMeta) {
			const modelName =
				typeof respMeta.model_name === "string"
					? respMeta.model_name
					: typeof respMeta.model === "string"
						? respMeta.model
						: undefined;
			if (modelName) meta.model = modelName;
			// Providers occasionally include a created_at / created timestamp.
			const createdAt =
				typeof respMeta.created_at === "string"
					? respMeta.created_at
					: typeof respMeta.created === "number"
						? new Date(respMeta.created * 1000).toISOString()
						: undefined;
			if (createdAt) meta.ts = createdAt;
		}

		const usageMeta =
			msg.usage_metadata && typeof msg.usage_metadata === "object"
				? (msg.usage_metadata as Record<string, unknown>)
				: undefined;
		if (usageMeta) {
			const pick = (k: string): number | undefined => {
				const v = usageMeta[k];
				return typeof v === "number" ? v : undefined;
			};
			const inputDetails =
				usageMeta.input_token_details &&
				typeof usageMeta.input_token_details === "object"
					? (usageMeta.input_token_details as Record<string, unknown>)
					: undefined;
			const pickDetail = (k: string): number | undefined => {
				if (!inputDetails) return undefined;
				const v = inputDetails[k];
				return typeof v === "number" ? v : undefined;
			};
			meta.usage = {
				input_tokens: pick("input_tokens"),
				output_tokens: pick("output_tokens"),
				total_tokens: pick("total_tokens"),
				cache_read_input_tokens: pickDetail("cache_read"),
				cache_creation_input_tokens: pickDetail("cache_creation"),
			};
		}

		// Fall back to additional_kwargs.created_at when node code tagged it.
		if (!meta.ts) {
			const kwargs =
				msg.additional_kwargs && typeof msg.additional_kwargs === "object"
					? (msg.additional_kwargs as Record<string, unknown>)
					: undefined;
			if (kwargs && typeof kwargs.created_at === "string") {
				meta.ts = kwargs.created_at;
			}
		}
		return meta;
	}

	/**
	 * Merge meta (model / ts / usage) into each message chunk emitted over the
	 * live SSE stream so the store can render them the same way as history
	 * backfill. Handles both `messages` (array) and `messages-tuple`
	 * ([message, metadata]) stream-mode shapes.
	 */
	enrichMessagesPayload(data: unknown): unknown {
		const mergeOne = (m: unknown): unknown => {
			if (!m || typeof m !== "object") return m;
			const meta = this.extractMessageMeta(m);
			return Object.keys(meta).length === 0 ? m : { ...m, ...meta };
		};
		if (Array.isArray(data)) {
			// messages-tuple: [message, metadata]
			if (
				data.length === 2 &&
				data[0] &&
				typeof data[0] === "object" &&
				!Array.isArray(data[0])
			) {
				return [mergeOne(data[0]), data[1]];
			}
			return data.map(mergeOne);
		}
		return mergeOne(data);
	}

	async getMessages(
		id: string,
	): Promise<{
		messages: Array<{
			role: string;
			content: string;
			model?: string;
			ts?: string;
			usage?: {
				input_tokens?: number;
				output_tokens?: number;
				total_tokens?: number;
				cache_read_input_tokens?: number;
				cache_creation_input_tokens?: number;
			};
		}>;
	}> {
		const r = this.repo.getOrThrow(id);
		const state = await this.langgraph_client.threads.getState(r.childThreadId);
		const messages = (state.values as { messages?: unknown } | null)?.messages;
		if (!Array.isArray(messages)) return { messages: [] };

		// Build a msgId → checkpoint.ts map by walking history newest→oldest and
		// remembering the earliest checkpoint that contains each message id.
		// Used as a timestamp fallback when the message object itself carries
		// none (typically human messages).
		const tsByMessageId = new Map<string, string>();
		try {
			const history = await this.langgraph_client.threads.getHistory(
				r.childThreadId,
				{ limit: 100 },
			);
			// history is newest-first; iterate reverse so earlier checkpoints
			// (i.e. when a message first appeared) win.
			for (let i = history.length - 1; i >= 0; i--) {
				const snap = history[i] as {
					created_at?: string;
					values?: { messages?: unknown };
				};
				const list = snap?.values?.messages;
				if (!Array.isArray(list)) continue;
				const ts = typeof snap.created_at === "string" ? snap.created_at : undefined;
				if (!ts) continue;
				for (const raw of list) {
					const id = (raw as { id?: unknown } | null)?.id;
					if (typeof id === "string" && !tsByMessageId.has(id)) {
						tsByMessageId.set(id, ts);
					}
				}
			}
		} catch {
			// getHistory best-effort — omit timestamps if unavailable.
		}

		return {
			messages: messages.map((m) => {
				const msg = m as {
					type?: unknown;
					role?: unknown;
					content?: unknown;
					id?: unknown;
				} | null;
				const raw =
					typeof msg?.type === "string"
						? msg.type
						: typeof msg?.role === "string"
							? msg.role
							: "unknown";
				const meta = this.extractMessageMeta(m);
				if (!meta.ts && typeof msg?.id === "string") {
					const tsFromCheckpoint = tsByMessageId.get(msg.id);
					if (tsFromCheckpoint) meta.ts = tsFromCheckpoint;
				}
				return {
					role: raw,
					content: this.stringifyContent(msg?.content),
					...meta,
				};
			}),
		};
	}

	async delete(id: string) {
		const r = this.repo.getOrThrow(id);
		// Mark BEFORE cancel/delete so detached consumeRunToBus tasks can bail
		// on their next persist attempt.
		this.deletedSessions.add(id);
		try {
			if (r.status === "running" && r.runId) {
				await this.langgraph_client.runs
					.cancel(r.childThreadId, r.runId)
					.catch(() => {});
			}
			await this.langgraph_client.threads
				.delete(r.childThreadId)
				.catch(() => {});
			this.repo.delete(id);
		} finally {
			// Keep the tombstone briefly so late writes still bail, then GC it.
			// consumeRunToBus finishes in single-digit seconds typically; 60s is
			// generous enough to cover any late notifyParent chain.
			setTimeout(() => this.deletedSessions.delete(id), 60_000);
		}
	}

	/**
	 * LangGraph enforces one active run per thread. Reject new messages while
	 * a run is still pending/running (HTTP 409) instead of letting the SDK
	 * surface a raw 422 which currently bubbles up as a 500.
	 */
	private async assertThreadIdle(threadId: string) {
		const runs = await this.langgraph_client.runs.list(threadId, { limit: 10 });
		if (runs.some((r) => r.status === "pending" || r.status === "running")) {
			throw new ThreadBusyError(threadId);
		}
	}

	/**
	 * The langgraph-sdk HTTPError is not exported from the package root, so
	 * detect a busy-thread rejection by the 422 status instead of instanceof.
	 */
	private isThreadBusy(e: unknown): boolean {
		return (
			typeof e === "object" &&
			e !== null &&
			(e as { status?: unknown }).status === 422
		);
	}

	private async acquireSlot(key: string) {
		const limit =
			config.maxConcurrency[key] ?? config.maxConcurrency.default ?? 3;
		while ((this.activeCount.get(key) ?? 0) >= limit) {
			await new Promise((r) => setTimeout(r, 500));
		}
		this.activeCount.set(key, (this.activeCount.get(key) ?? 0) + 1);
	}

	private releaseSlot(key: string) {
		this.activeCount.set(
			key,
			Math.max(0, (this.activeCount.get(key) ?? 1) - 1),
		);
	}

	async cancelAll() {
		const runningSessions = this.repo.getRunningSessions();
		await Promise.all(
			runningSessions.map((r) => this.delete(r.id).catch(() => {})),
		);
	}
}