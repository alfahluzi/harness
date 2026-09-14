/**
 * `PluginHostProvider` + hook suite.
 *
 * The provider owns:
 *   - registry state (list + hydrated capabilities, via `registry.ts`)
 *   - a resolved-component cache (keyed by `loaderKey`) so re-renders don't
 *     re-run loaders
 *
 * Consumer hooks derive slot content:
 *   - `usePluginRegistry()`        → raw registry state
 *   - `usePluginLeftBarItems()`    → dock items for the left navigation bar
 *   - `usePluginFooterBarItems(r)` → nodes for a footer region
 *
 * Every plugin render is wrapped in a `PluginErrorBoundary` (see `slots.tsx`)
 * so a throwing plugin degrades to `null` instead of crashing the app.
 */
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ComponentType,
	type ReactNode,
} from "react";
import type { PluginSource, PluginSummary } from "@puna/sdk-shared";
import {
	EMPTY_REGISTRY,
	createRegistryClient,
	type PluginCapabilityKey,
	type RegistryState,
} from "./registry";
import {
	loaderKey,
	type Loaders,
	type PluginComponentType,
} from "./loader";
import { PluginErrorBoundary } from "./slots";
import { PluginSourceBadge } from "./badge";

export type PluginFooterRegion = "left" | "middle" | "right";

/**
 * `PluginCapabilities.footerBar` is a single `CapabilityEntry`, so the schema
 * has no per-region information. Convention for Fase 2: footer contributions
 * land in the right region (matches the pre-SDK `footerBar.right` sample).
 * Fase 3+ may extend the manifest with region info.
 */
export const DEFAULT_FOOTER_REGION: PluginFooterRegion = "right";

/**
 * Structural twin of `frontend/src/layout/left-bar.tsx`'s
 * `NavigationLeftItem` — kept here so the SDK package has no frontend import.
 */
export interface PluginNavigationItem {
	id: string;
	label: string;
	icon: ComponentType<{ className?: string }>;
	to?: string;
	/** Tooltip text; the dock renders `<name> · <source> · <kind>`. */
	title?: string;
	child?: ReactNode;
}

type PluginHostContextValue = {
	registry: RegistryState;
	configDir: string;
	loaders: Loaders;
	components: Map<string, PluginComponentType>;
	registerComponent: (key: string, component: PluginComponentType) => void;
};

const defaultHostContext: PluginHostContextValue = {
	registry: EMPTY_REGISTRY,
	configDir: "",
	loaders: new Map(),
	components: new Map(),
	registerComponent: () => {},
};

const PluginHostContext =
	createContext<PluginHostContextValue>(defaultHostContext);

export type PluginHostProviderProps = {
	/** Active workspace config dir; empty string = no-op (empty registry). */
	configDir: string;
	loaders: Loaders;
	children?: ReactNode;
	fetchImpl?: typeof fetch;
	baseUrl?: string;
};

export function PluginHostProvider({
	configDir,
	loaders,
	children,
	fetchImpl,
	baseUrl,
}: PluginHostProviderProps) {
	const client = useMemo(
		() => createRegistryClient({ fetchImpl, baseUrl }),
		[fetchImpl, baseUrl],
	);
	const [registry, setRegistry] = useState<RegistryState>(EMPTY_REGISTRY);
	const [components, setComponents] = useState<
		Map<string, PluginComponentType>
	>(() => new Map());

	useEffect(() => {
		if (!configDir) {
			setRegistry(EMPTY_REGISTRY);
			return;
		}
		let cancelled = false;
		setRegistry((prev) => ({ ...prev, loading: true, error: null }));
		void client
			.fetchAll(configDir)
			.then((next) => {
				if (cancelled) return;
				setRegistry(next);
				if (next.error) {
					console.warn(
						`[puna:plugins] registry load failed for "${configDir}"`,
						next.error,
					);
				} else {
					console.info(
						`[puna:plugins] ${next.plugins.size} plugins loaded from ${configDir}`,
					);
				}
			})
			.catch((cause: unknown) => {
				if (cancelled) return;
				const error =
					cause instanceof Error ? cause : new Error(String(cause));
				setRegistry({ plugins: new Map(), loading: false, error });
				console.warn(`[puna:plugins] registry load failed`, error);
			});
		return () => {
			cancelled = true;
		};
	}, [client, configDir]);

	const registerComponent = useCallback(
		(key: string, component: PluginComponentType) => {
			setComponents((prev) => {
				if (prev.get(key) === component) return prev;
				const next = new Map(prev);
				next.set(key, component);
				return next;
			});
		},
		[],
	);

	const value = useMemo<PluginHostContextValue>(
		() => ({
			registry,
			configDir,
			loaders,
			components,
			registerComponent,
		}),
		[registry, configDir, loaders, components, registerComponent],
	);

	return (
		<PluginHostContext.Provider value={value}>
			{children}
		</PluginHostContext.Provider>
	);
}

export type LoadedPluginComponentProps = {
	pluginId: string;
	capabilityKey: PluginCapabilityKey;
	exportName?: string;
};

/**
 * Renders a plugin slot component once its loader resolves. Wraps the output in
 * a `contents` div carrying `data-plugin-id` / `data-plugin-capability` for e2e
 * selectors (display: contents preserves surrounding flex layout).
 */
export function LoadedPluginComponent({
	pluginId,
	capabilityKey,
	exportName = "",
}: LoadedPluginComponentProps) {
	const { registry, configDir, loaders, components, registerComponent } =
		useContext(PluginHostContext);
	const key = loaderKey(pluginId, capabilityKey, exportName);
	const Component = components.get(key) ?? null;

	useEffect(() => {
		if (Component) return;
		const loader = loaders.get(key);
		if (!loader) return;
		let cancelled = false;
		void loader()
			.then((mod) => {
				if (cancelled) return;
				const named = exportName
					? (mod as Record<string, unknown>)[exportName]
					: undefined;
				const resolved =
					typeof named === "function" ? named : mod.default;
				if (typeof resolved !== "function") {
					console.warn(
						`[puna:plugins] loader "${key}" resolved to no component`,
					);
					return;
				}
				registerComponent(key, resolved as PluginComponentType);
			})
			.catch((cause: unknown) => {
				console.warn(`[puna:plugins] loader "${key}" failed`, cause);
			});
		return () => {
			cancelled = true;
		};
	}, [Component, key, loaders, exportName, registerComponent]);

	if (!Component) return null;

	const summary = registry.plugins.get(pluginId)?.summary;
	return (
		<div
			data-plugin-id={pluginId}
			data-plugin-capability={capabilityKey}
			data-plugin-source={summary?.source}
			data-plugin-kind={summary?.kind}
			className="contents"
		>
			<Component pluginId={pluginId} configDir={configDir} />
		</div>
	);
}

/** Default icon used for plugin dock entries (no plugin-supplied icons yet). */
export function StickyNotesIcon({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9l5-5V5a2 2 0 0 0-2-2z" />
			<path d="M14 21v-5h5" />
			<path d="M8 8h6" />
			<path d="M8 12h4" />
		</svg>
	);
}

const SOURCE_DOT_STYLES: Record<PluginSource, string> = {
	"workspace-local": "bg-emerald-500",
	"workspace-global": "bg-blue-500",
	"system-global": "bg-purple-500",
};

type PluginDockIconProps = {
	summary: PluginSummary;
	className?: string;
};

/**
 * Dock icon wrapper: default icon + source-color dot overlay. The dot is the
 * compact origin badge; the full `PluginSourceBadge` renders in the panel
 * header (see `usePluginLeftBarItems`).
 */
function PluginDockIcon({ summary, className }: PluginDockIconProps) {
	return (
		<span
			className={`relative inline-flex items-center justify-center ${className ?? ""}`}
			title={`${summary.name} · ${summary.source} · ${summary.kind}`}
		>
			<StickyNotesIcon className="h-5 w-5" />
			<span
				aria-hidden="true"
				className={`absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-full border border-white dark:border-neutral-950 ${SOURCE_DOT_STYLES[summary.source]}`}
			/>
		</span>
	);
}

function createDockIcon(summary: PluginSummary): PluginNavigationItem["icon"] {
	return function DockIcon({ className }: { className?: string }) {
		return <PluginDockIcon summary={summary} className={className} />;
	};
}

/** Raw registry state (loading / error / hydrated plugin map). */
export function usePluginRegistry(): RegistryState {
	return useContext(PluginHostContext).registry;
}

/**
 * Left-bar dock entries for every plugin declaring `capabilities.leftBar`.
 * The panel child renders the plugin component behind an error boundary, with
 * host chrome showing the full source badge.
 */
export function usePluginLeftBarItems(): PluginNavigationItem[] {
	const { registry } = useContext(PluginHostContext);
	return useMemo(() => {
		const items: PluginNavigationItem[] = [];
		for (const [pluginId, entry] of registry.plugins) {
			const capability = entry.capabilities.leftBar;
			if (!capability) continue;
			const summary = entry.summary;
			items.push({
				id: `${pluginId}:leftBar`,
				label: summary.name,
				title: `${summary.name} · ${summary.source} · ${summary.kind}`,
				icon: createDockIcon(summary),
				child: (
					<div className="flex h-full min-h-0 flex-col">
						<div className="flex items-center justify-between gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
							<span className="truncate text-xs font-medium text-neutral-500 dark:text-neutral-400">
								{summary.name}
							</span>
							<PluginSourceBadge
								source={summary.source}
								kind={summary.kind}
							/>
						</div>
						<div className="min-h-0 flex-1 overflow-auto">
							<PluginErrorBoundary
								pluginId={pluginId}
								capabilityName="leftBar"
							>
								<LoadedPluginComponent
									pluginId={pluginId}
									capabilityKey="leftBar"
									exportName={capability.export}
								/>
							</PluginErrorBoundary>
						</div>
					</div>
				),
			});
		}
		return items;
	}, [registry.plugins]);
}

/**
 * Footer region nodes for every plugin declaring `capabilities.footerBar`.
 * Region selection follows `DEFAULT_FOOTER_REGION` until the manifest carries
 * region info.
 */
export function usePluginFooterBarItems(
	region: PluginFooterRegion,
): ReactNode[] {
	const { registry } = useContext(PluginHostContext);
	return useMemo(() => {
		const nodes: ReactNode[] = [];
		if (region !== DEFAULT_FOOTER_REGION) return nodes;
		for (const [pluginId, entry] of registry.plugins) {
			const capability = entry.capabilities.footerBar;
			if (!capability) continue;
			const summary = entry.summary;
			nodes.push(
				<PluginErrorBoundary
					key={`${pluginId}:footerBar`}
					pluginId={pluginId}
					capabilityName={`footerBar.${region}`}
				>
					<span
						title={`${summary.name} · ${summary.source} · ${summary.kind}`}
						className="inline-flex items-center"
					>
						<LoadedPluginComponent
							pluginId={pluginId}
							capabilityKey="footerBar"
							exportName={capability.export}
						/>
					</span>
				</PluginErrorBoundary>,
			);
		}
		return nodes;
	}, [registry.plugins, region]);
}
