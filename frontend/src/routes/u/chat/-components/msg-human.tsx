type MessageHumanProps = {
	msg: {
		role: string;
		content: string;
	};
};
export function MessageHuman({ msg }: MessageHumanProps) {
	return (
		<div className="border border-neutral-700 rounded-lg px-2 py-1 bg-neutral-800 ml-auto w-fit max-w-11/12 wrap-break-word">
			{msg.content}
		</div>
	);
}
