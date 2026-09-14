import {
	PluginErrorBoundary,
	getPluginToolUiOwner,
	usePluginToolUi,
} from "@puna/sdk-frontend";
import type { ChatMessage } from "@/lib/chat-types";

type MessageToolProps = {
	msg: ChatMessage;
};

export function MessageTool({ msg }: MessageToolProps) {
	// F3-T4: plugin `toolUi` lookup keyed by tool name. Legacy tool messages
	// (no `toolName`) resolve to null and keep the default bubble below.
	const Custom = usePluginToolUi(msg.toolName);

	if (Custom && msg.toolName) {
		const pluginId = getPluginToolUiOwner(Custom) ?? "toolUi";
		return (
			<div className="flex w-full justify-start">
				<PluginErrorBoundary
					pluginId={pluginId}
					capabilityName={`toolUi:${msg.toolName}`}
				>
					<div
						data-plugin-tool={msg.toolName}
						className="max-w-[90%] rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400"
					>
						<Custom msg={msg} args={msg.args} result={msg.result} />
					</div>
				</PluginErrorBoundary>
			</div>
		);
	}

	return (
		<div className="flex w-full justify-start">
			<div className="max-w-[90%] rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
				<p className="whitespace-pre-wrap break-words">{msg.content}</p>
			</div>
		</div>
	);
}
