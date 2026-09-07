import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/u/")({
	component: UsersIndex,
});

function UsersIndex() {
	return (
		<main className="min-h-full flex flex-col gap-6 items-center justify-center p-8">
			<h1 className="text-3xl font-bold">Users</h1>
			<Link
				to="/u/workspace"
				className="px-4 py-2 rounded border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-900 text-sm"
			>
				Open workspace (agents &amp; skills)
			</Link>
		</main>
	);
}
