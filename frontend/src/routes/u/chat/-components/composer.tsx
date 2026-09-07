import { PlusIcon, SendIcon, StopCircle } from "lucide-react";
import type { KeyboardEvent, RefObject } from "react";
import { ComposerButton } from "./composer-button";

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
}: ComposerProps) {
	const note = error ?? info;

	return (
		<div className="absolute bottom-0 left-0 w-full flex justify-center my-2 pr-2">
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
				<div className="flex px-2 pb-1 justify-between">
					<ComposerButton>
						<PlusIcon className="text-neutral-400" size={20} />
					</ComposerButton>
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
