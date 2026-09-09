import { CopyIcon } from "lucide-react";
import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import SyntaxHighlighter from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

type MarkdownProps = {
	content: string;
	className?: string;
};
// helper — taruh di luar komponen
function extractText(node: React.ReactNode): string {
	if (typeof node === "string") return node;
	if (typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(extractText).join("");
	if (React.isValidElement(node)) {
		return extractText((node.props as any)?.children);
	}
	return "";
}
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
						const lang = codeClass?.replace("language-", "");

						if (isBlock) {
							return (
								<div className="">
									<pre className="font-extralight opacity-70">{lang}</pre>
									<SyntaxHighlighter
										customStyle={{
											margin: 0,
											padding: 8,
										}}
										language={lang}
										style={oneDark}
									>
										{String(children).replace(/\n$/, "")}
									</SyntaxHighlighter>
								</div>
							);
						}
						return (
							<code className="rounded items-center align-middle  font-mono text-xs ">
								{String(children).replace(/\n$/, "")}
							</code>
						);
					},
					pre: ({ children }) => {
						const codeText = extractText(children);
						const [copied, setCopied] = useState(false); // butuh ini jadi komponen sendiri, lihat catatan di bawah

						const handleCopy = async () => {
							await navigator.clipboard.writeText(codeText.trim());
							setCopied(true);
							setTimeout(() => setCopied(false), 1500);
						};

						return (
							<pre className="relative items-center min-h-10 p-2 my-2 overflow-x-auto rounded-md bg-neutral-200 text-xs dark:bg-neutral-800">
								{children}
								<button
									onClick={handleCopy}
									className="absolute right-0 bottom-0 p-1.5 m-3 rounded-sm transition-all bg-neutral-400 dark:bg-neutral-700 opacity-50 hover:opacity-80"
								>
									{copied ? (
										<span className="text-[10px]">Copied</span>
									) : (
										<CopyIcon size={12} />
									)}
								</button>
							</pre>
						);
					},
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
