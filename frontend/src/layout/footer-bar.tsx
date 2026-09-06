import { UserRound } from "lucide-react";

export function FooterBar() {
	return (
		<footer className="col-span-3 row-start-3 flex h-8 items-center justify-between border-t mt-0.5 border-neutral-200 bg-neutral-50/80 px-4 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950/80 dark:text-neutral-400">
			<div className="w-fit flex gap-1 justify-start">
				<_FooterButton>
					<div className="flex px-1 gap-1">
						<UserRound size={14} />
						<span>Aldi Fahluzi</span>
					</div>
				</_FooterButton>
				<_FooterButton>
					<span className="mx-2">Active Database: 2</span>
				</_FooterButton>
				<_FooterButton>
					<span className="mx-2">Plugins: 2</span>
				</_FooterButton>
				<_FooterButton>
					<span className="mx-2">MCP: 2</span>
				</_FooterButton>
			</div>
			<div className="w-fit flex gap-1 justify-between"></div>
			<div className="w-fit flex gap-1 justify-end">
				<_FooterButton>
					<span className="mx-2">Total Token: 425692834</span>
				</_FooterButton>
				<_FooterButton>
					<span className="mx-2">Used Bill: 342 USD</span>
				</_FooterButton>
			</div>
		</footer>
	);
}

type _FooterButtonProps = React.ComponentProps<"button">;

function _FooterButton({ className, children, ...props }: _FooterButtonProps) {
	return (
		<button
			type="button"
			className={
				"inline-flex h-6 min-w-6 items-center justify-center rounded-sm " +
				"text-neutral-500 transition-colors " +
				"hover:bg-neutral-200 hover:text-neutral-900 " +
				"focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 " +
				"dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 " +
				{ className }
			}
			{...props}
		>
			{children}
		</button>
	);
}
