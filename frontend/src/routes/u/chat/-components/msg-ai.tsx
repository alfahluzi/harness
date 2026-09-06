type MessageAiProps = {
	msg: {
		role: string;
		content: string;
	};
};
export function MessageAi({ msg }: MessageAiProps) {
	return (
		<div className="py-1 mr-auto w-full wrap-break-word">{msg.content}</div>
	);
}
