import { UserRound } from "lucide-react";
import {
	PluginSlot,
	usePluginFooterBarItems,
	usePluginRegistry,
} from "@puna/sdk-frontend";
import { useActiveWorkdir } from "../hooks/use-active-workdir";

export function FooterBar() {
	const { configDir } = useActiveWorkdir();
	const registry = usePluginRegistry();
	const footerLeft = usePluginFooterBarItems("left");
	const footerMiddle = usePluginFooterBarItems("middle");
	const footerRight = usePluginFooterBarItems("right");
	return (
		<footer className="col-span-3 row-start-3 flex h-8 items-center justify-between border-t mt-0.5 border-neutral-200 bg-neutral-50/80 px-4 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950/80 dark:text-neutral-400">
			<div className="w-fit flex gap-1 justify-start">
				<PluginSlot slot="footerBar.left">{footerLeft}</PluginSlot>
				<_FooterButton>
					<div className="flex px-1 gap-1">
						<UserRound size={14} />
						<span>Aldi Fahluzi</span>
					</div>
				</_FooterButton>
				<_FooterButton title={configDir || "No active workspace"}>
					<span className="mx-2">
						Active Workspace:{" "}
						<span className="font-mono">
							{configDir || "(none)"}
						</span>
					</span>
				</_FooterButton>
				<_FooterButton
					title={
						registry.error
							? `Plugin registry error: ${registry.error.message}`
							: `${registry.plugins.size} plugin(s) loaded`
					}
				>
					<span className="mx-2">Plugins: {registry.plugins.size}</span>
				</_FooterButton>
				<_FooterButton>
					<span className="mx-2">MCP: 2</span>
				</_FooterButton>
			</div>
			<div className="w-fit flex gap-1 justify-between">
				<PluginSlot slot="footerBar.middle">{footerMiddle}</PluginSlot>
			</div>
			<div className="w-fit flex gap-1 justify-end">
				<PluginSlot slot="footerBar.right">{footerRight}</PluginSlot>
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
