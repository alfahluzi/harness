import type { ProviderSummary } from "@/lib/api";

// UI-only presentational unions derived from the generated API types.
// These are NOT part of the OpenAPI schema (they are view-level aliases),
// so they live here instead of in the generated client.

export type LayerSource = "local" | "global";

export type ProviderType = ProviderSummary["type"];
