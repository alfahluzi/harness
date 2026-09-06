import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
	component: Home,
});

function Home() {
	return (
		<main className="min-h-screen grid place-items-center">
			<h1 className="text-4xl font-bold">Cognesia</h1>
			<Link to="/u" className="mt-4 text-blue-600 underline">
				Go to users
			</Link>
		</main>
	);
}
