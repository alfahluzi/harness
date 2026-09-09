import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useActiveWorkdir } from "../../../hooks/use-active-workdir";
import {
	useConnectProvider,
	useDisconnectProvider,
	useProvider,
	useProviderModels,
	useProviders,
	useTestProviderCredentials,
	useUpdateProvider,
} from "../../../hooks/use-providers";
import type { ProviderSummary } from "@/lib/api";
import type { ProviderType } from "@/lib/ui-types";
import { PROVIDER_CATALOG } from "./-components/provider-catalog";

export const Route = createFileRoute("/u/settings/")({
	component: SettingsPage,
});

const PROVIDER_TYPES: ProviderType[] = [
	"openai",
	"anthropic",
	"google",
	"openrouter",
	"custom",
];

function SettingsPage() {
	const { configDir } = useActiveWorkdir();
	const providers = useProviders();
	const [openType, setOpenType] = useState<ProviderType | null>(null);

	const byId = new Map((providers.data?.providers ?? []).map((p) => [p.id, p]));

	return (
		<div className="flex flex-col gap-4 p-4 h-full overflow-auto">
			<div className="max-w-3xl w-full mx-auto">
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
					<ul className="flex flex-col gap-1.5">
						{PROVIDER_TYPES.map((type) => {
							const catalog = PROVIDER_CATALOG[type];
							const provider = byId.get(type);
							const isConnected = !!provider;
							const isOpen = openType === type;

							return (
								<li key={type}>
									<button
										type="button"
										onClick={() => setOpenType(isOpen ? null : type)}
										aria-expanded={isOpen}
										className="w-full flex items-center justify-between gap-2 rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-2.5 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
									>
										<span className="flex items-center gap-2 min-w-0">
											<span
												className={`h-2.5 w-2.5 rounded-full ${catalog.dot}`}
											/>
											<span className="text-sm font-medium">
												{catalog.label}
											</span>
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
											<span
												className={`text-neutral-400 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
											>
												›
											</span>
										</span>
									</button>

									{/* wrapper animasi: grid-rows 0fr <-> 1fr */}
									<div
										className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${
											isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
										}`}
									>
										<div className="overflow-hidden">
											{isOpen && (
												<ProviderPanel type={type} provider={provider} />
											)}
										</div>
									</div>
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</div>
	);
}

function ProviderPanel({
	type,
	provider,
}: {
	type: ProviderType;
	provider: ProviderSummary | undefined;
}) {
	const catalog = PROVIDER_CATALOG[type];
	const isConnected = !!provider;
	const isCustom = type === "custom";

	const [apiKey, setApiKey] = useState("");
	const [displayName, setDisplayName] = useState(provider?.name ?? "");
	const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "");
	const [testOk, setTestOk] = useState(false);
	const [confirmDisconnect, setConfirmDisconnect] = useState(false);

	const detail = useProvider(isConnected ? provider.id : null);
	const models = useProviderModels(isConnected ? provider.id : null);
	const test = useTestProviderCredentials();
	const connect = useConnectProvider();
	const update = useUpdateProvider();
	const disconnect = useDisconnectProvider();

	const handleTest = () => {
		test.mutate(
			isCustom
				? {
						type,
						apiKey: apiKey.trim() || undefined,
						baseUrl: baseUrl.trim() || undefined,
					}
				: { type, apiKey: apiKey.trim() || undefined },
			{ onSuccess: (result) => setTestOk(result.ok) },
		);
	};

	const handleSave = () => {
		if (isConnected) {
			update.mutate({
				id: type,
				body: isCustom
					? {
							name: displayName.trim() || undefined,
							baseUrl: baseUrl.trim() || undefined,
							apiKey: apiKey.trim() || undefined,
						}
					: { apiKey: apiKey.trim() || undefined },
			});
		} else {
			connect.mutate(
				isCustom
					? {
							type,
							apiKey: apiKey.trim(),
							name: displayName.trim() || undefined,
							baseUrl: baseUrl.trim() || undefined,
						}
					: { type, apiKey: apiKey.trim() },
			);
		}
	};

	const handleDisconnect = () => {
		if (!confirmDisconnect) {
			setConfirmDisconnect(true);
			return;
		}
		disconnect.mutate(type);
	};

	const saveDisabled =
		!testOk || test.isPending || connect.isPending || update.isPending;
	const saveLabel = testOk
		? isConnected
			? update.isPending
				? "Saving…"
				: "Save"
			: connect.isPending
				? "Saving…"
				: "Save connection"
		: "Test first";

	return (
		<div className="border p-3 items-center align-middle rounded w-full text-xs text-neutral-900 dark:text-neutral-100 border-neutral-200 dark:border-neutral-800 mt-1.5">
			{isCustom && (
				<div className="p-1 items-center grid grid-cols-3">
					<span className="col-span-1">Name:</span>
					<input
						className="col-auto border-neutral-200 dark:border-neutral-800 border rounded focus:outline-0 p-0.5"
						type="text"
						value={displayName}
						onChange={(e) => {
							setDisplayName(e.target.value);
							setTestOk(false);
						}}
						placeholder="My provider"
					/>
				</div>
			)}
			<div className="grid grid-cols-3 gap-3 p-1 items-center">
				<div className="grid grid-cols-3">
					<span className="col-span-1">Api Key:</span>
					<input
						className="col-span-2 w-full border-neutral-200 dark:border-neutral-800 border rounded focus:outline-0 p-0.5"
						type="password"
						value={apiKey}
						onChange={(e) => {
							setApiKey(e.target.value);
							setTestOk(false);
						}}
						placeholder={
							isConnected
								? "Leave empty to keep current key"
								: catalog.keyPlaceholder
						}
						autoComplete="off"
						spellCheck={false}
					/>
				</div>
				<div className="grid grid-cols-3">
					<span className="col-span-1">Base Url:</span>
					<input
						className="col-span-2 w-full border-neutral-200 dark:border-neutral-800 border rounded focus:outline-0 p-0.5"
						type="text"
						value={baseUrl}
						onChange={(e) => {
							setBaseUrl(e.target.value);
							setTestOk(false);
						}}
						placeholder={catalog.baseUrl || "https://api.example.com/v1"}
						autoComplete="off"
						spellCheck={false}
					/>
				</div>
				<div className="grid grid-cols-2 gap-1">
					<button
						type="button"
						disabled={test.isPending || (isCustom && !baseUrl.trim())}
						onClick={handleTest}
						className="col-auto border-neutral-200 dark:border-neutral-800 border rounded px-2 py-1 disabled:opacity-50"
					>
						{test.isPending ? "Testing…" : "Test"}
					</button>
					<button
						type="button"
						disabled={saveDisabled}
						onClick={handleSave}
						className="col-auto border-neutral-200 dark:border-neutral-800 border rounded px-2 py-1 disabled:opacity-50"
					>
						{saveLabel}
					</button>
				</div>

				{isConnected && (
					<button
						type="button"
						disabled={disconnect.isPending}
						onClick={handleDisconnect}
						className={`border rounded px-2 py-1 disabled:opacity-50 ${
							confirmDisconnect
								? "bg-red-600 text-white border-red-600"
								: "border-neutral-200 dark:border-neutral-800 text-red-600 dark:text-red-400"
						}`}
					>
						{disconnect.isPending
							? "…"
							: confirmDisconnect
								? "Sure?"
								: "Disconnect"}
					</button>
				)}
			</div>

			{test.error && <p className="p-1 text-red-600">{test.error.message}</p>}
			{test.data && !test.data.ok && (
				<p className="p-1 text-red-600">
					✗ {test.data.error ?? "connection failed"}
				</p>
			)}
			{test.data?.ok && (
				<p className="p-1 text-emerald-600 dark:text-emerald-400">
					✓ Connected in {test.data.latencyMs}ms
				</p>
			)}
			{connect.error && (
				<p className="p-1 text-red-600">{connect.error.message}</p>
			)}
			{update.error && (
				<p className="p-1 text-red-600">{update.error.message}</p>
			)}
			{isConnected && detail.data && (
				<p className="p-1 text-neutral-500">
					Saved key:{" "}
					<span className="font-mono">{detail.data.apiKeyMasked}</span>
				</p>
			)}

			<div className="p-1">
				<span>Available Models:</span>
				<div>
					{!isConnected && (
						<div className="text-neutral-500 italic">
							Connect to fetch models.
						</div>
					)}
					{isConnected && models.isLoading && (
						<div className="text-neutral-500 italic">Loading…</div>
					)}
					{isConnected &&
						models.data?.models.map((m) => (
							<div key={m.modelId}>{m.name ?? m.modelId}</div>
						))}
					{isConnected &&
						!models.isLoading &&
						(models.data?.models.length ?? 0) === 0 && (
							<div className="text-neutral-500 italic">
								No models synced yet. Save to fetch from /models.
							</div>
						)}
				</div>
			</div>
		</div>
	);
}
