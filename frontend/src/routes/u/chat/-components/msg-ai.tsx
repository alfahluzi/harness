import { Markdown } from "@/components/markdown";

type MessageAiProps = {
	content: string;
	streaming?: boolean;
};

export function MessageAi({ content, streaming }: MessageAiProps) {
	return (
		<div className="flex w-full justify-start">
			<div className="max-w-[85%] py-2.5 text-sm text-neutral-900 dark:text-neutral-100">
				<Markdown content={content} />
				{streaming && (
					<span className="ml-1 inline-block h-4 w-2 animate-pulse bg-current align-middle" />
				)}
			</div>
		</div>
	);
}
