import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useActiveWorkdir } from "../../../hooks/use-active-workdir";
import { useProviders } from "../../../hooks/use-providers";
import type { ProviderType } from "@/lib/ui-types";
import { PROVIDER_CATALOG } from "./-components/provider-catalog";
import { ProviderModal } from "./-components/provider-modal";

export const Route = createFileRoute("/u/settings/")({
	component: SettingsPage,
});

const PROVIDER_TYPES: ProviderType[] = ["openai", "anthropic", "google", "openrouter", "custom"];

function SettingsPage() {
	const { configDir } = useActiveWorkdir();
	const providers = useProviders();
	const [openType, setOpenType] = useState<ProviderType | null>(null);

	const byId = new Map((providers.data?.providers ?? []).map((p) => [p.id, p]));
	const openProvider = openType ? byId.get(openType) : undefined;

	return (
		<div className="flex flex-col gap-4 p-4 h-full overflow-auto">
			<header>
				<h2 className="text-xl font-semibold">Settings</h2>
				<p className="text-sm text-neutral-500">
					Connect your LLM providers. Select a provider to enter your API key.
				</p>
			</header>

			{!configDir && (
				<div className="border border-dashed border-neutral-300 dark:border-neutral-700 rounded p-4 text-center text-sm text-neutral-500">
					Set an active workdir above to manage provider connections.
				</div>
			)}

			{providers.isError && (
				<p className="text-sm text-red-600">
					Failed to load providers: {providers.error.message}
				</p>
			)}

			{configDir && (
				<ul className="flex flex-col gap-1.5 max-w-xl">
					{PROVIDER_TYPES.map((type) => {
						const catalog = PROVIDER_CATALOG[type];
						const provider = byId.get(type);
						const isConnected = !!provider;
						return (
							<li key={type}>
								<button
									type="button"
									onClick={() => setOpenType(type)}
									className="w-full flex items-center justify-between gap-2 rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-2.5 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
								>
									<span className="flex items-center gap-2 min-w-0">
										<span className={`h-2.5 w-2.5 rounded-full ${catalog.dot}`} />
										<span className="text-sm font-medium">{catalog.label}</span>
										{isConnected && provider && (
											<span className="font-mono text-xs text-neutral-500 truncate">
												{provider.type === "custom"
													? provider.name
													: provider.defaultModel}
											</span>
										)}
									</span>
									<span className="flex items-center gap-2 shrink-0">
										{isConnected ? (
											<span
												className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase ${catalog.badge}`}
											>
												connected
											</span>
										) : (
											<span className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
												not connected
											</span>
										)}
										<span className="text-neutral-400">›</span>
									</span>
								</button>
							</li>
						);
					})}
				</ul>
			)}

			{openType && (
				<ProviderModal
					type={openType}
					provider={openProvider}
					onClose={() => setOpenType(null)}
				/>
			)}
		</div>
	);
}
