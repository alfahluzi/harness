import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/u/")({
	component: UsersIndex,
});

function UsersIndex() {
	return (
		<main className="min-h-full  grid place-items-center">
			<h1 className="text-3xl font-bold">Users</h1>
		</main>
	);
}
