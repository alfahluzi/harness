/**
 * Sandboxed HTTP fetch tool for a LangGraph React agent.
 *
 * Drop-in replacement for the (sunset) `@langchain/community` `RequestsToolkit`.
 *
 * SSRF protection is the primary defense:
 *  - Only `http:`/`https:` URLs allowed.
 *  - Host must match the configured whitelist (exact or subdomain suffix).
 *  - DNS is resolved up front and every returned address is checked against
 *    private/loopback/link-local/CGNAT ranges (DNS rebinding guard).
 *  - Redirects are NOT followed (a 302 can point at a private IP).
 *
 * No auth is special-cased here. The LLM may supply arbitrary `headers`, but
 * callers must NOT rely on this tool to be safe with secrets — treat the
 * `allowedHosts` whitelist purely as an SSRF constraint.
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
	DEFAULT_OUTPUT_LIMIT_BYTES,
	DEFAULT_TIMEOUT_MS,
	truncate,
	withToolLog,
	toolError,
} from "./_lib.js";

export const httpFetchSchema = z.object({
	url: z.string().url(),
	method: z.enum(["GET", "POST"]),
	headers: z.record(z.string(), z.string()).optional(),
	jsonBody: z.unknown().optional(),
});

export interface HttpToolsConfig {
	/** Exact or suffix match, e.g. "api.example.com" (also allows "x.api.example.com"). */
	allowedHosts: string[];
	/** Request timeout in ms. Defaults to DEFAULT_TIMEOUT_MS (15000). */
	timeoutMs?: number;
	/** Max response bytes retained. Defaults to DEFAULT_OUTPUT_LIMIT_BYTES (6144). */
	maxResponseBytes?: number;
}

/**
 * True when a dotted-quad IPv4 address falls in a blocked range
 * (loopback, private, link-local, this-network, CGNAT).
 */
function isPrivateIPv4(octets: number[]): boolean {
	const [a, b] = octets;
	if (octets.length !== 4) return false;
	if (a === 127) return true; // 127.0.0.0/8 loopback
	if (a === 10) return true; // 10.0.0.0/8 private
	if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
	if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
	if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
	if (a === 0) return true; // 0.0.0.0/8 this network
	if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
	return false;
}

/**
 * True when an IPv6 address is loopback, ULA, link-local, or IPv4-mapped to a
 * blocked IPv4 range.
 */
function isBlockedIPv6(address: string): boolean {
	const lower = address.toLowerCase();
	if (lower === "::1") return true; // loopback
	if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
	if (lower.startsWith("fe80")) return true; // link-local
	// IPv4-mapped address (e.g. ::ffff:192.168.0.1) — check the embedded quad.
	const v4Tail = lower.match(/([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)$/);
	if (v4Tail && isPrivateIPv4(v4Tail[1].split(".").map(Number))) return true;
	return false;
}

/**
 * Resolve a hostname and reject the request if ANY resolved address is
 * private/loopback/link-local/CGNAT. Throws on a blocked address.
 */
async function assertPublicHostname(hostname: string): Promise<void> {
	const addresses = await lookup(hostname, { all: true });
	for (const { address } of addresses) {
		const family = isIP(address);
		const blocked =
			family === 4
				? isPrivateIPv4(address.split(".").map(Number))
				: family === 6
					? isBlockedIPv6(address)
					: true;
		if (blocked) {
			throw new Error(
				`resolved address ${address} is a private/loopback/link-local IP (SSRF guard blocked this request)`,
			);
		}
	}
}

async function httpFetchImpl(
	input: {
		url: string;
		method: "GET" | "POST";
		headers?: Record<string, string>;
		jsonBody?: unknown;
	},
	config: HttpToolsConfig,
): Promise<string> {
	const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxResponseBytes =
		config.maxResponseBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES;
	const allowedHosts = config.allowedHosts;

	return withToolLog(
		"http",
		{ url: input.url, method: input.method },
		async () => {
			// 1. Parse + validate URL.
			let u: URL;
			try {
				u = new URL(input.url);
			} catch (err) {
				return toolError(
					"http",
					`invalid URL: ${err instanceof Error ? err.message : String(err)}`,
				);
			}

			// 2. Protocol whitelist — before anything else.
			if (u.protocol !== "http:" && u.protocol !== "https:") {
				return toolError("http", "protocol not allowed: " + u.protocol);
			}

			// 3. Host whitelist (exact or suffix match).
			if (allowedHosts.length > 0) {
				const host = u.hostname;
				const allowed = allowedHosts.some(
					(h) => h === host || host.endsWith("." + h),
				);
				if (!allowed) {
					return toolError(
						"http",
						`host "${host}" is not in the allowed list (${allowedHosts.join(", ")})`,
					);
				}
			}

			// 4. SSRF guard: DNS-resolve and reject private addresses. Done
			//    BEFORE creating the AbortController so abort cost isn't wasted.
			try {
				await assertPublicHostname(u.hostname);
			} catch (err) {
				return toolError(
					"http",
					err instanceof Error ? err.message : String(err),
				);
			}

			// 5. Filter LLM-supplied headers; never let the model override Host.
			const filteredHeaders: Record<string, string> = {};
			if (input.headers) {
				for (const [k, v] of Object.entries(input.headers)) {
					if (k.toLowerCase() === "host") continue;
					filteredHeaders[k] = v;
				}
			}

			// 6. Fetch (redirects not followed — they can point at private IPs).
			try {
				const response = await fetch(u.toString(), {
					method: input.method,
					headers: filteredHeaders,
					body:
						input.jsonBody !== undefined
							? JSON.stringify(input.jsonBody)
							: undefined,
					signal: AbortSignal.timeout(timeoutMs),
					redirect: "manual",
				});

				// 7. Read body as a stream, capped at maxResponseBytes.
				const chunks: Buffer[] = [];
				let total = 0;
				let truncated = false;
				if (response.body) {
					for await (const chunk of response.body) {
						const buf = Buffer.from(chunk);
						if (total + buf.byteLength > maxResponseBytes) {
							const remaining = maxResponseBytes - total;
							if (remaining > 0) {
								chunks.push(buf.subarray(0, remaining));
							}
							truncated = true;
							break;
						}
						chunks.push(buf);
						total += buf.byteLength;
					}
				}

				// Streaming stops at maxResponseBytes, so truncate() alone never
				// sees an oversized buffer — append an explicit marker here.
				let bodyText = truncate(Buffer.concat(chunks), maxResponseBytes);
				if (truncated) {
					bodyText += `\n\n[truncated: response exceeded ${maxResponseBytes} byte(s) limit]`;
				}

				// 8. Format a readable result for the LLM.
				const lines: string[] = [
					`Status: ${response.status} ${response.statusText}`,
				];
				const contentType = response.headers.get("content-type");
				if (contentType) {
					lines.push(`Content-Type: ${contentType}`);
				}

				if (response.status >= 300 && response.status < 400) {
					lines.push("Redirect not followed (SSRF protection).");
					const loc = response.headers.get("location");
					if (loc) lines.push(`Location: ${loc}`);
				}

				if (bodyText) {
					lines.push(`Body:\n${bodyText}`);
				}

				return lines.join("\n");
			} catch (err) {
				if (
					err instanceof Error &&
					(err.name === "AbortError" || err.name === "TimeoutError")
				) {
					return toolError("http", `request timed out after ${timeoutMs}ms`);
				}
				return toolError(
					"http",
					err instanceof Error ? err.message : String(err),
				);
			}
		},
	);
}

const HTTP_TOOL_DESCRIPTION =
	"Make an HTTP GET or POST to a whitelisted host. " +
	"Resolves DNS and rejects private IPs (SSRF guard). " +
	"Redirects not followed. " +
	"Body truncated. " +
	"No auth — do not put secrets in headers. " +
	"Only hosts matching the allowed list (exact host or subdomain suffix) are permitted.";

/**
 * Build the single `httpFetch` tool with config bound at construction time.
 * Returns a LangChain `tool()` instance ready for a ToolNode / bindTools.
 */
export function createHttpTools(config: HttpToolsConfig) {
	return tool(
		(input: {
			url: string;
			method: "GET" | "POST";
			headers?: Record<string, string>;
			jsonBody?: unknown;
		}) => httpFetchImpl(input, config),
		{
			name: "httpFetch",
			description: HTTP_TOOL_DESCRIPTION,
			schema: httpFetchSchema,
		},
	);
}
