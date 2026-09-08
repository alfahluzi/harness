import { createRootRoute, Outlet } from "@tanstack/react-router";
import { StreamProvider } from "@/components/stream-provider";
import { API_BASE_URL } from "@/lib/stream";

export const Route = createRootRoute({
	component: Root,
});

function Root() {
	return (
		<StreamProvider baseUrl={API_BASE_URL}>
			<Outlet />
		</StreamProvider>
	);
}