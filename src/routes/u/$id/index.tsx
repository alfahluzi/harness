import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/u/$id/")({
	component: UserDetail,
});

function UserDetail() {
	const { id } = Route.useParams();
	return (
		<main className="min-h-full grid place-items-center">
			<h1 className="text-3xl font-bold">User #{id}</h1>
			<p className="text-neutral-600 mt-2">Dynamic param: {id}</p>
		</main>
	);
}
