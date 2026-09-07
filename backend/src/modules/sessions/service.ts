import { Client } from "@langchain/langgraph-sdk";
import { config } from "../../global/config";
import { TaskRepository, type TaskRecord } from "./repository";

export class SessionService {
	private client: Client;
	private repo: TaskRepository;
	private activeCount = new Map<string, number>();

	constructor(repo: TaskRepository = new TaskRepository()) {
		this.client = new Client({ apiUrl: config.langgraphUrl });
		this.repo = repo;
	}

	async create(opts: {
		parent?: string;
		description: string;
		prompt: string;
		agentProfile: string;
		background: boolean;
	}) {
		const child = await this.client.threads.create();
		const taskId = `bg_${crypto.randomUUID().slice(0, 8)}`;
		const createdAt = Date.now();

		const record: TaskRecord = {
			id: taskId,
			description: opts.description,
			parentThreadId: opts.parent,
			childThreadId: child.thread_id,
			runId: "",
			agentProfile: opts.agentProfile,
			background: opts.background,
			status: "pending",
			createdAt,
		};

		this.repo.insert(record);

		if (!opts.background) {
			record.status = "running";
			this.repo.setStatus(taskId, "running");
			const run = await this.client.runs.wait(child.thread_id, config.graphId, {
				input: { messages: [{ role: "human", content: opts.prompt }] },
				config: { configurable: { agent_profile: opts.agentProfile } },
			});
			record.status = "completed";
			record.completedAt = Date.now();
			record.result = run;
			this.repo.setResult(taskId, run, record.completedAt);
			return { taskId, sessionId: child.thread_id, status: record.status, result: run };
		}

		void this.launch(record, opts.prompt);
		return { taskId, sessionId: child.thread_id, status: record.status };
	}

	async list() {
		const rows = this.repo.list();
		return rows.map((r) => ({
			id: r.id,
			description: r.description,
			status: r.status,
			agentProfile: r.agent_profile,
			createdAt: r.created_at,
			completedAt: r.completed_at ?? undefined,
		}));
	}

	private async launch(record: TaskRecord, prompt: string) {
		await this.acquireSlot(record.agentProfile);
		record.status = "running";
		this.repo.setStatus(record.id, "running");

		try {
			const run = await this.client.runs.create(record.childThreadId, config.graphId, {
				input: { messages: [{ role: "human", content: prompt }] },
				config: { configurable: { agent_profile: record.agentProfile } },
			});
			record.runId = run.run_id;
			this.repo.setRunId(record.id, run.run_id);

			await this.waitForCompletion(record);

			const state = await this.client.threads.getState(record.childThreadId);
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

	private async waitForCompletion(record: TaskRecord) {
		try {
			for await (const _chunk of this.client.runs.joinStream(
				record.childThreadId,
				record.runId,
			)) {
				// no-op for now; can stream tool-call progress later
			}
		} catch {
			while (true) {
				const run = await this.client.runs.get(record.childThreadId, record.runId);
				if (run.status === "success" || run.status === "error") return;
				await new Promise((r) => setTimeout(r, 2000));
			}
		}
	}

	private async notifyParent(record: TaskRecord) {
		if (!record.parentThreadId) return;

		const siblings = this.repo.listByParent(record.parentThreadId);

		const siblingsStillRunning = siblings.some(
			(r) => r.id !== record.id && r.status === "running",
		);

		const notification = this.renderReminder(record, siblingsStillRunning);

		await this.client.threads.updateState(record.parentThreadId, {
			values: { messages: [{ role: "system", content: notification }] },
		});

		if (!siblingsStillRunning) {
			await this.client.runs.create(record.parentThreadId, config.graphId, {
				input: null,
			});
		}
	}

	private renderReminder(record: TaskRecord, stillRunning: boolean) {
		const lines = [`[BACKGROUND TASK ${record.status.toUpperCase()}]`, `ID: ${record.id}`];
		if (record.status === "error") lines.push(`Error: ${record.error}`);
		lines.push(
			stillRunning
				? "Other background tasks still running. Do NOT poll."
				: "All background tasks complete.",
		);
		lines.push(`Use get_result(id="${record.id}") to retrieve output.`);
		return lines.join("\n");
	}

	async getStatus(id: string) {
		const r = this.repo.getOrThrow(id);
		return { status: r.status, createdAt: r.createdAt, completedAt: r.completedAt };
	}

	async getResult(id: string) {
		const r = this.repo.getOrThrow(id);
		if (r.status !== "completed" && r.status !== "error") return { status: r.status };
		return { status: r.status, result: r.result };
	}

	async sendMessage(id: string, message: string) {
		const r = this.repo.getOrThrow(id);
		const run = await this.client.runs.wait(r.childThreadId, config.graphId, {
			input: { messages: [{ role: "human", content: message }] },
			config: { configurable: { agent_profile: r.agentProfile } },
		});
		this.repo.setResult(id, run, Date.now());
		return run;
	}

	async delete(id: string) {
		const r = this.repo.getOrThrow(id);
		if (r.status === "running" && r.runId) {
			await this.client.runs.cancel(r.childThreadId, r.runId).catch(() => {});
		}
		await this.client.threads.delete(r.childThreadId).catch(() => {});
		this.repo.delete(id);
	}

	private async acquireSlot(key: string) {
		const limit = config.maxConcurrency[key] ?? config.maxConcurrency.default ?? 3;
		while ((this.activeCount.get(key) ?? 0) >= limit) {
			await new Promise((r) => setTimeout(r, 500));
		}
		this.activeCount.set(key, (this.activeCount.get(key) ?? 0) + 1);
	}

	private releaseSlot(key: string) {
		this.activeCount.set(key, Math.max(0, (this.activeCount.get(key) ?? 1) - 1));
	}

	async cancelAll() {
		const runningTasks = this.repo.getRunningTasks();
		await Promise.all(runningTasks.map((r) => this.delete(r.id).catch(() => {})));
	}
}
