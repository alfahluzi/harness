import { useState } from "react";
import {
	useConnectProvider,
	useDisconnectProvider,
	useProvider,
	useProviderModels,
	useTestProviderCredentials,
	useUpdateProvider,
} from "../../../../hooks/use-providers";
import type { ProviderSummary } from "@/lib/api";
import type { ProviderType } from "@/lib/ui-types";
import { PROVIDER_CATALOG } from "./provider-catalog";

const inputClass =
	"w-full px-2 py-1.5 text-sm rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 focus:outline-none focus:ring-1 focus:ring-blue-500";

const primaryBtnClass =
	"text-sm px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50";

export function ProviderModal({
	type,
	provider,
	onClose,
}: {
	type: ProviderType;
	provider?: ProviderSummary;
	onClose: () => void;
}) {
	const catalog = PROVIDER_CATALOG[type];
	const isConnected = !!provider;
	const isCustom = type === "custom";

	const [apiKey, setApiKey] = useState("");
	const [displayName, setDisplayName] = useState(provider?.name ?? "");
	const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "");
	const [showKey, setShowKey] = useState(false);
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
				? { type, apiKey: apiKey.trim() || undefined, baseUrl: baseUrl.trim() || undefined }
				: { type, apiKey: apiKey.trim() || undefined },
			{ onSuccess: (result) => setTestOk(result.ok) },
		);
	};

	const handleSave = () => {
		if (isConnected) {
			update.mutate({
				id: type,
				body: isCustom
					? { name: displayName.trim() || undefined, baseUrl: baseUrl.trim() || undefined, apiKey: apiKey.trim() || undefined }
					: { apiKey: apiKey.trim() || undefined },
			});
		} else {
			connect.mutate(
				isCustom
					? { type, apiKey: apiKey.trim(), name: displayName.trim() || undefined, baseUrl: baseUrl.trim() || undefined }
					: { type, apiKey: apiKey.trim() },
			);
		}
	};

	const handleDisconnect = () => {
		if (!confirmDisconnect) {
			setConfirmDisconnect(true);
			return;
		}
		disconnect.mutate(type, { onSuccess: onClose });
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
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
			onClick={onClose}
		>
			<div
				className="w-full max-w-md flex flex-col gap-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 shadow-xl"
				onClick={(e) => e.stopPropagation()}
			>
				<header className="flex items-center justify-between gap-2">
					<div className="flex items-center gap-2">
						<span className={`h-2.5 w-2.5 rounded-full ${catalog.dot}`} />
						<h3 className="font-semibold">{catalog.label}</h3>
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
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
					>
						×
					</button>
				</header>

			<div className="flex flex-col gap-1.5">
					{isCustom && (
						<>
							<label
								className="text-[10px] uppercase tracking-wide text-neutral-500"
								htmlFor={`${type}-modal-display-name`}
							>
								Provider Display Name
							</label>
							<input
								id={`${type}-modal-display-name`}
								type="text"
								value={displayName}
								onChange={(e) => {
									setDisplayName(e.target.value);
									setTestOk(false);
								}}
								placeholder="My provider"
								className={inputClass}
								autoFocus
							/>
							<label
								className="text-[10px] uppercase tracking-wide text-neutral-500"
								htmlFor={`${type}-modal-base-url`}
							>
								Base URL
							</label>
							<input
								id={`${type}-modal-base-url`}
								type="text"
								value={baseUrl}
								onChange={(e) => {
									setBaseUrl(e.target.value);
									setTestOk(false);
								}}
								placeholder="https://api.example.com/v1"
								className={inputClass}
								autoComplete="off"
								spellCheck={false}
							/>
						</>
					)}
					<label
						className="text-[10px] uppercase tracking-wide text-neutral-500"
						htmlFor={`${type}-modal-key`}
					>
						API Key
					</label>
					<div className="flex gap-1">
						<input
							id={`${type}-modal-key`}
							type={showKey ? "text" : "password"}
							value={apiKey}
							onChange={(e) => {
								setApiKey(e.target.value);
								setTestOk(false);
							}}
							placeholder={
								isConnected ? "Leave empty to keep current key" : catalog.keyPlaceholder
							}
							className={inputClass}
							autoComplete="off"
							spellCheck={false}
							autoFocus={!isCustom}
						/>
						<button
							type="button"
							onClick={() => setShowKey((v) => !v)}
							aria-label={showKey ? "Hide API key" : "Show API key"}
							className="px-2 rounded border border-neutral-300 dark:border-neutral-700 text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
						>
							{showKey ? "hide" : "show"}
						</button>
					</div>
					{isConnected && detail.data && (
						<p className="text-xs text-neutral-500">
							Saved key: <span className="font-mono">{detail.data.apiKeyMasked}</span>
						</p>
					)}
				</div>

				{test.error && <p className="text-xs text-red-600">{test.error.message}</p>}
				{test.data && !test.data.ok && (
					<p className="text-xs text-red-600">
						✗ {test.data.error ?? "connection failed"}
					</p>
				)}
				{test.data?.ok && (
					<p className="text-xs text-emerald-600 dark:text-emerald-400">
						✓ Connected in {test.data.latencyMs}ms
					</p>
				)}

				{connect.error && (
					<p className="text-xs text-red-600">{connect.error.message}</p>
				)}
				{update.error && <p className="text-xs text-red-600">{update.error.message}</p>}

				<div className="flex items-center gap-1.5 pt-1">
					<button
						type="button"
						disabled={test.isPending || (isCustom && !baseUrl.trim())}
						onClick={handleTest}
						className="flex-1 text-sm px-3 py-1.5 rounded border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50"
					>
						{test.isPending ? "Testing…" : "Test"}
					</button>
					<button
						type="button"
						disabled={saveDisabled}
						onClick={handleSave}
						className={`flex-1 ${primaryBtnClass}`}
					>
						{saveLabel}
					</button>
					{isConnected && (
						<button
							type="button"
							disabled={disconnect.isPending}
							onClick={handleDisconnect}
							className={`text-sm px-3 py-1.5 rounded disabled:opacity-50 ${
								confirmDisconnect
									? "bg-red-600 text-white hover:bg-red-700"
									: "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
							}`}
						>
							{disconnect.isPending ? "…" : confirmDisconnect ? "Sure?" : "Disconnect"}
						</button>
					)}
				</div>

				{isConnected && (
					<div className="flex flex-col gap-1">
						<p className="text-[10px] uppercase tracking-wide text-neutral-500">
							Available models ({models.data?.models.length ?? "…"})
						</p>
						<ul className="flex flex-col gap-0.5 max-h-48 overflow-y-auto rounded border border-neutral-200 dark:border-neutral-800 p-1.5">
							{models.isLoading && (
								<li className="text-xs text-neutral-500 italic">Loading…</li>
							)}
							{models.data?.models.map((m) => (
								<li
									key={m.modelId}
									className="flex items-center justify-between gap-2 text-xs"
								>
									<span className="font-mono truncate">{m.modelId}</span>
									{m.name && (
										<span className="truncate text-neutral-500">{m.name}</span>
									)}
								</li>
							))}
							{!models.isLoading && (models.data?.models.length ?? 0) === 0 && (
								<li className="text-xs text-neutral-500 italic">
									No models synced yet. Save to fetch from /models.
								</li>
							)}
						</ul>
					</div>
				)}
			</div>
		</div>
	);
}