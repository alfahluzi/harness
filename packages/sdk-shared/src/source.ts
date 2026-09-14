/**
 * Plugin source layers — where a discovered plugin directory came from.
 *
 * - `workspace-local`  → `<configDir>/plugins/`            (this workspace's `.puna`)
 * - `workspace-global` → `<ctx.globalConfigDir>/plugins/` (workspace-shared)
 * - `system-global`    → `~/.config/puna/plugins/`
 *
 * Conflict policy: local wins over global; see strategy §12 Q2.
 */
import { z } from "zod";

export const PluginSource = z.enum([
	"workspace-local",
	"workspace-global",
	"system-global",
]);
export type PluginSource = z.infer<typeof PluginSource>;
