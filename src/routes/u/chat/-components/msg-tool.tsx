type MessageToolProps = {
	msg: {
		role: string;
		content: string;
	};
};
export function MessageTool({ msg }: MessageToolProps) {
	return (
		<div className="border border-neutral-700 rounded-md p-2 mr-auto w-full wrap-break-word">
			{msg.content}
		</div>
	);
}
