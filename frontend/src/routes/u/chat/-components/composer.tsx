import { PlusIcon, SendIcon } from "lucide-react";
import { ComposerButton } from "./composer-button";
import { useRef } from "react";
const MAX_HEIGHT = 200; // px, atur sesuai kebutuhan

export function Composer() {
	const textareaRef = useRef(null);

	const handleInput = () => {
		const textarea: any = textareaRef.current;
		if (textarea) {
			textarea.style.height = "auto";
			const newHeight = Math.min(textarea.scrollHeight, MAX_HEIGHT);
			textarea.style.height = `${newHeight}px`;
			textarea.style.overflowY =
				textarea.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
		}
	};
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
				<textarea
					ref={textareaRef}
					onInput={handleInput}
					rows={1}
					style={{ maxHeight: `${MAX_HEIGHT}px` }}
					className="border-b border-neutral-300 dark:border-neutral-800 w-full focus:outline-none p-2 px-4 text-xs"
				></textarea>
				<div className="flex px-2 pb-1 justify-between">
					<ComposerButton>
						<PlusIcon className="text-neutral-400" size={20} />
					</ComposerButton>
					<ComposerButton>
						<SendIcon className="text-neutral-400" size={20} />
					</ComposerButton>
				</div>
			</div>
		</div>
	);
}
