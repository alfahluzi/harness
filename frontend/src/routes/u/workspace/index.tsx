import { createFileRoute } from "@tanstack/react-router";
import { useActiveWorkdir } from "../../../hooks/use-active-workdir";
import { SessionsPanel } from "./-components/sessions-panel";
import { WorkdirPicker } from "./-components/workdir-picker";

export const Route = createFileRoute("/u/workspace/")({
	component: WorkspacePage,
});

function WorkspacePage() {
	const { configDir } = useActiveWorkdir();

	return (
		<div className="flex flex-col gap-4 p-4 h-full overflow-auto">
			<header>
				<h2 className="text-xl font-semibold">Workspace</h2>
			</header>
			<WorkdirPicker />
			{!configDir && (
				<div className="border border-dashed border-neutral-300 dark:border-neutral-700 rounded p-4 text-center text-sm text-neutral-500">
					Set an active workdir above to load session history. MCPs are
					managed from the left dock.
				</div>
			)}
			{configDir && <SessionsPanel />}
		</div>
	);
}
