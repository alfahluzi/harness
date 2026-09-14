/**
 * Slot helpers — per-slot React error boundaries.
 *
 * A plugin component that throws must not take down the host app: the boundary
 * logs to the console and renders `fallback ?? null`.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

export type PluginErrorBoundaryProps = {
	pluginId: string;
	capabilityName: string;
	fallback?: ReactNode;
	children?: ReactNode;
};

type PluginErrorBoundaryState = {
	hasError: boolean;
};

export class PluginErrorBoundary extends Component<
	PluginErrorBoundaryProps,
	PluginErrorBoundaryState
> {
	state: PluginErrorBoundaryState = { hasError: false };

	static getDerivedStateFromError(): PluginErrorBoundaryState {
		return { hasError: true };
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		console.error(
			`[puna:plugins] slot "${this.props.pluginId}:${this.props.capabilityName}" crashed`,
			error,
			info.componentStack,
		);
	}

	render(): ReactNode {
		if (this.state.hasError) return this.props.fallback ?? null;
		return this.props.children;
	}
}

export type PluginSlotProps = {
	/** Slot region name, e.g. `leftBar` or `footerBar.right`. */
	slot: string;
	/** Plugin id for logging/attribution; defaults to `slot:<slot>`. */
	pluginId?: string;
	fallback?: ReactNode;
	children?: ReactNode;
};

/** Convenience pass-through that wraps `children` in a `PluginErrorBoundary`. */
export function PluginSlot({
	slot,
	pluginId,
	fallback,
	children,
}: PluginSlotProps) {
	return (
		<PluginErrorBoundary
			pluginId={pluginId ?? `slot:${slot}`}
			capabilityName={slot}
			fallback={fallback}
		>
			{children}
		</PluginErrorBoundary>
	);
}
