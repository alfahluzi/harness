import { ChatRequest } from "./chat-request";

type ChatPanelProps = {};
export function ChatPanel({}: ChatPanelProps) {
	const random_data = [
		1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 174, 5, 4869, 123, 7,
	];
	return (
		<div className="h-full w-full flex flex-col gap-2 items-center justify-start my-2 overflow-y-auto scrollbar-thin">
			{random_data.map((_, index) => {
				const isLast = index == random_data.length - 1;
				return <ChatRequest last={isLast} />;
			})}
		</div>
	);
}
