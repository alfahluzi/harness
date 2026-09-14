import { useState } from "react";

/**
 * Local structural mirrors of the SDK contracts this template consumes.
 *
 * Runtime contract (strategy §6.2):
 *   ToolUiContribution = {
 *     [toolName: string]: React.ComponentType<{ msg; args?; result? }>
 *   }
 *
 * F3-T1 extends `ChatMessage` with `toolName`/`args`/`result` (strategy §6.5).
 * The SDK type exports land with Lane A (F3-T1..F3-T4); until then the prop
 * type is inlined so the template compiles standalone. Replace with
 * `import type { ChatMessage, ToolUiComponentProps } from "@puna/sdk-frontend"`
 * once those exports exist.
 */
type ChatMessage = {
	id?: string;
	role: "human" | "ai" | "tool";
	content?: string;
	toolName?: string;
	args?: unknown;
	result?: unknown;
};

type ToolUiComponentProps = {
	msg: ChatMessage;
	args?: unknown;
	result?: unknown;
};

type MermaidArgs =
	| { source?: string; code?: string; diagram?: string }
	| undefined;

function MermaidDiagram({ msg, args, result }: ToolUiComponentProps) {
	const a = (args ?? {}) as MermaidArgs;
	const source = a?.source ?? a?.code ?? a?.diagram ?? "";
	const [copied, setCopied] = useState(false);

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(source);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// clipboard rejected (e.g. insecure context); silently no-op
		}
	};

	return (
		<div className="flex w-full justify-start" data-plugin-tool="mermaid">
			<div className="max-w-[90%] rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
				<div className="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
					<span>mermaid · {msg.toolName ?? "diagram"}</span>
					<button
						type="button"
						onClick={copy}
						disabled={!source}
						className="rounded border border-neutral-300 px-2 py-0.5 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-900"
					>
						{copied ? "Copied" : "Copy"}
					</button>
				</div>
				<pre className="whitespace-pre-wrap break-words">
					<code>{source || "(empty mermaid source)"}</code>
				</pre>
				{result !== undefined && (
					<div className="mt-2 border-t border-neutral-200 pt-2 text-[10px] text-neutral-500 dark:border-neutral-800">
						<span>result:</span>
						<pre className="mt-1 whitespace-pre-wrap break-words">
							<code>
								{typeof result === "string"
									? result
									: JSON.stringify(result, null, 2)}
							</code>
						</pre>
					</div>
				)}
			</div>
		</div>
	);
}

/**
 * `toolUi` is an OBJECT keyed by tool name; the host renders the entry whose
 * key matches `msg.toolName` (first match wins). Currently only `mermaid`.
 */
export const toolUi = {
	mermaid: MermaidDiagram,
};
