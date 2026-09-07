import { Client } from "@langchain/langgraph-sdk";
import { config } from "../../global/config";
import { resolveAgentRuntimeConfig } from "../../global/agent-runtime";
import { SessionRepository, type SessionRecord } from "./repository";

export class SessionService {
	private langgraph_client: Client;
	private repo: SessionRepository;
	private activeCount = new Map<string, number>();

	constructor(repo: SessionRepository = new SessionRepository()) {
		this.langgraph_client = new Client({ apiUrl: config.langgraphUrl });
		this.repo = repo;
	}

	async create(opts: {
		workspaceId: string;
		parent?: string;
		description: string;
		prompt: string;
		agentProfile: string;
		background: boolean;
		configDir: string;
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
				opts.workspaceId,
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
				record.workspaceId,
			);
			const run = await this.langgraph_client.runs.create(
				record.childThreadId,
				config.graphId,
				{
					input: { messages: [{ role: "human", content: prompt }] },
					config: runtime,
				},
			);
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

	private async notifyParent(record: SessionRecord) {
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
			await this.langgraph_client.runs.create(
				record.parentThreadId,
				config.graphId,
				{
					input: null,
				},
			);
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

	async getResult(id: string) {
		const r = this.repo.getOrThrow(id);
		if (r.status !== "completed" && r.status !== "error")
			return { status: r.status };
		return { status: r.status, result: r.result };
	}

	async sendMessage(id: string, message: string, configDir: string) {
		const r = this.repo.getOrThrow(id);
		const runtime = await resolveAgentRuntimeConfig(
			configDir,
			r.agentProfile,
			r.workspaceId,
		);
		const run = await this.langgraph_client.runs.wait(
			r.childThreadId,
			config.graphId,
			{
				input: { messages: [{ role: "human", content: message }] },
				config: runtime,
			},
		);
		this.repo.setResult(id, run, Date.now());
		return run;
	}

	async delete(id: string) {
		const r = this.repo.getOrThrow(id);
		if (r.status === "running" && r.runId) {
			await this.langgraph_client.runs
				.cancel(r.childThreadId, r.runId)
				.catch(() => {});
		}
		await this.langgraph_client.threads.delete(r.childThreadId).catch(() => {});
		this.repo.delete(id);
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
