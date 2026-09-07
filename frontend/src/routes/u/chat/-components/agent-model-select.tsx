import type { AgentProfile } from "../-hooks/use-agent-model";
import type { ProviderModel } from "@/lib/api";

type AgentModelSelectProps = {
	agentProfile: string;
	model: string;
	agents: AgentProfile[];
	models: ProviderModel[];
	onAgentChange: (name: string) => void;
	onModelChange: (modelId: string) => void;
	modelStatus: string | null;
	isLoadingAgents: boolean;
};

const selectClass =
	"h-7 max-w-[8rem] truncate rounded border border-neutral-300 bg-transparent px-1.5 text-[10px] " +
	"text-neutral-700 focus:outline-none focus:ring-1 focus:ring-slate-400 " +
	"disabled:cursor-not-allowed disabled:text-neutral-400 " +
	"dark:border-neutral-700 dark:text-neutral-300 dark:bg-neutral-950";

export function AgentModelSelect({
	agentProfile,
	model,
	agents,
	models,
	onAgentChange,
	onModelChange,
	modelStatus,
	isLoadingAgents,
}: AgentModelSelectProps) {
	const agentDisabled = isLoadingAgents || agents.length === 0;
	const modelDisabled =
		agentDisabled || !agentProfile || !models.length || !!modelStatus;

	return (
		<div
			className="flex items-center gap-1"
			title="Agent & model used for this message"
		>
			<select
				aria-label="Agent"
				className={selectClass}
				value={agentProfile}
				onChange={(e) => onAgentChange(e.target.value)}
				disabled={agentDisabled}
				title={agents.find((a) => a.name === agentProfile)?.description ?? ""}
			>
				{agents.length === 0 && <option value="">No agents</option>}
				{agents.map((a) => (
					<option key={a.name} value={a.name} title={a.description ?? ""}>
						{a.name}
					</option>
				))}
			</select>

			<select
				aria-label="Model"
				className={selectClass}
				value={model}
				onChange={(e) => onModelChange(e.target.value)}
				disabled={modelDisabled}
			>
				{modelStatus ? (
					<option value="">{modelStatus}</option>
				) : models.length === 0 ? (
					<option value="">No models</option>
				) : (
					models.map((m) => (
						<option key={m.modelId} value={m.modelId}>
							{m.name ?? m.modelId}
						</option>
					))
				)}
			</select>
		</div>
	);
}
