import ReactMarkdown from "react-markdown";

type MarkdownProps = {
	content: string;
	className?: string;
};

export function Markdown({ content, className }: MarkdownProps) {
	return (
		<div className={className}>
			<ReactMarkdown
				components={{
					p: ({ children }) => (
						<p className="wrap-break-word whitespace-pre-wrap not-last:mb-2">
							{children}
						</p>
					),
					a: ({ children, href }) => (
						<a
							href={href}
							target="_blank"
							rel="noopener noreferrer"
							className="text-blue-600 underline hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
						>
							{children}
						</a>
					),
					code: ({ children, className: codeClass }) => {
						const isBlock = codeClass?.includes("language-");
						if (isBlock) {
							return (
								<code
									className={`${codeClass ?? ""} block overflow-x-auto rounded-md bg-neutral-200 p-0.5 font-mono text-xs dark:bg-neutral-800`}
								>
									{children}
								</code>
							);
						}
						return (
							<code className="rounded bg-neutral-200 px-1 py-0.5 font-mono text-xs dark:bg-neutral-800">
								{children}
							</code>
						);
					},
					pre: ({ children }) => (
						<pre className="my-2 overflow-x-auto rounded-md bg-neutral-200 p-2 text-xs dark:bg-neutral-800">
							{children}
						</pre>
					),
					ul: ({ children }) => (
						<ul className="my-2 list-inside list-disc space-y-1">{children}</ul>
					),
					ol: ({ children }) => (
						<ol className="my-2 list-inside list-decimal space-y-1">
							{children}
						</ol>
					),
					h1: ({ children }) => (
						<h1 className="my-2 text-lg font-semibold">{children}</h1>
					),
					h2: ({ children }) => (
						<h2 className="my-2 text-base font-semibold">{children}</h2>
					),
					h3: ({ children }) => (
						<h3 className="my-2 text-sm font-semibold">{children}</h3>
					),
					blockquote: ({ children }) => (
						<blockquote className="my-2 border-l-2 border-neutral-400 pl-3 italic dark:border-neutral-600">
							{children}
						</blockquote>
					),
				}}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
}
