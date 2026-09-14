import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PluginHostProvider } from "@puna/sdk-frontend";
import { routeTree } from "./routeTree.gen";
import {
	ActiveWorkdirProvider,
	useActiveWorkdir,
} from "./hooks/use-active-workdir";
import { pluginLoaders } from "./lib/plugins/loader";
import "./index.css";
import "./lib/api-init";

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: 1,
			refetchOnWindowFocus: false,
		},
	},
});

/**
 * Inner shell — must live inside `ActiveWorkdirProvider` so it can read the
 * active config dir and feed it to `PluginHostProvider`.
 */
function AppShell() {
	const { configDir } = useActiveWorkdir();
	return (
		<PluginHostProvider configDir={configDir} loaders={pluginLoaders}>
			<RouterProvider router={router} />
		</PluginHostProvider>
	);
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<ActiveWorkdirProvider>
				<AppShell />
			</ActiveWorkdirProvider>
		</QueryClientProvider>
	</StrictMode>,
);
