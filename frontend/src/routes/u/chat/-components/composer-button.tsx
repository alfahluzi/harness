type ComposerButtonProps = React.ComponentProps<"button">;

export function ComposerButton({
	className,
	children,
	...props
}: ComposerButtonProps) {
	return (
		<button
			type="button"
			className={
				"inline-flex h-8 min-w-8 items-center justify-center rounded-md " +
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
