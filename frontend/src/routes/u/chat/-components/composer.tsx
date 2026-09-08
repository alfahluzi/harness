import { PlusIcon, SendIcon, StopCircle } from "lucide-react";
import type { KeyboardEvent, RefObject } from "react";
import { AgentModelSelect } from "./agent-model-select";
import { ComposerButton } from "./composer-button";
import type { AgentProfile } from "../-hooks/use-agent-model";
import type { ProviderModel } from "@/lib/api";

const MAX_HEIGHT = 200;

export type ComposerProps = {
	text: string;
	error: string | null;
	info: string | null;
	onTextChange: (next: string) => void;
	onSubmit: () => void;
	onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
	onStop: () => void;
	isPending: boolean;
	canSubmit: boolean;
	textareaRef: RefObject<HTMLTextAreaElement | null>;
	onAutoResize: () => void;
	agentProfile: string;
	model: string;
	agents: AgentProfile[];
	models: ProviderModel[];
	onAgentChange: (name: string) => void;
	onModelChange: (modelId: string) => void;
	modelStatus: string | null;
	isLoadingAgents: boolean;
};

export function Composer({
	text,
	error,
	info,
	onTextChange,
	onSubmit,
	onKeyDown,
	onStop,
	isPending,
	canSubmit,
	textareaRef,
	onAutoResize,
	agentProfile,
	model,
	agents,
	models,
	onAgentChange,
	onModelChange,
	modelStatus,
	isLoadingAgents,
}: ComposerProps) {
	const note = error ?? info;

	return (
		<div className="w-full flex justify-center mb-2 pr-2">
			<div
				className={
					"border rounded-lg border-neutral-300 dark:border-neutral-700 " +
					"bg-neutral-100 dark:bg-neutral-950 " +
					"max-w-200 w-full " +
					"shadow-lg"
				}
			>
				{note && (
					<div
						className={
							"px-3 pt-2 text-xs " +
							(error
								? "text-red-600 dark:text-red-400"
								: "text-slate-600 dark:text-slate-400")
						}
					>
						{note}
					</div>
				)}

				<textarea
					ref={textareaRef}
					value={text}
					onChange={(e) => onTextChange(e.target.value)}
					onInput={onAutoResize}
					onKeyDown={onKeyDown}
					rows={1}
					style={{ maxHeight: `${MAX_HEIGHT}px` }}
					className="border-b border-neutral-300 dark:border-neutral-800 w-full focus:outline-none p-2 px-4 text-xs bg-transparent resize-none"
				/>

				<div className="flex items-center justify-between gap-2 px-2 pb-1">
					<div className="flex items-center gap-1">
						<AgentModelSelect
							agentProfile={agentProfile}
							model={model}
							agents={agents}
							models={models}
							onAgentChange={onAgentChange}
							onModelChange={onModelChange}
							modelStatus={modelStatus}
							isLoadingAgents={isLoadingAgents}
						/>
						<ComposerButton>
							<PlusIcon className="text-neutral-400" size={20} />
						</ComposerButton>
					</div>

					{isPending ? (
						<ComposerButton onClick={onStop}>
							<StopCircle
								className="text-neutral-700 dark:text-neutral-200"
								size={20}
							/>
						</ComposerButton>
					) : canSubmit ? (
						<ComposerButton onClick={onSubmit} disabled={!canSubmit}>
							<SendIcon
								className="text-neutral-700 dark:text-neutral-200"
								size={20}
							/>
						</ComposerButton>
					) : (
						<ComposerButton disabled>
							<SendIcon className="text-neutral-400" size={20} />
						</ComposerButton>
					)}
				</div>
			</div>
		</div>
	);
}
