// Fail-safe client-side patch for the dsh web UI served over LAN.
//
// Problem: dsh's settings UI deliberately degrades on non-loopback pages.
// The browser client computes `connection.isLoopback` from the page origin's
// hostname (dsh-client-connection apply()):
//
//   isLoopback: pageLocation === void 0 || isLoopbackHostname(pageLocation.hostname)
//
// Consumers such as the settings scope then choose host vs memory persistence
// (dsh-client-ui-settings): `connection.isLoopback ? "host" : "memory"`. On a
// LAN IP origin the scope stays in memory mode, its status never becomes
// "ready", and the plugin-configuration cards render nothing (PluginCard
// returns null when `!state.available`) — a blank 插件配置 tab.
//
// This module serves a patched copy of the `dsh-client-connection` browser
// bundle where the isLoopback predicate is forced to `true`, so the whole
// settings plane (scope, document store, welcome notice, deliverables)
// behaves as if the page were loopback — consistent with the server-side
// Host/Origin rewrite the auth gate already applies to authenticated LAN
// callers. The patch is fail-safe: if the expected marker string is absent
// (bundle changed), the original bytes are served untouched.

import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/** The bundle URL of the connection client row (package-name id, per the boot manifest). */
export const CONNECTION_BUNDLE_PATHNAME = "/plugins/@deepseek-ai/dsh-client-connection/client.js";

/** Marker forced to true; must match the shipped client-connection bundle. */
const MARKER = "pageLocation === void 0 || isLoopbackHostname(pageLocation.hostname)";
/** Replacement for {@link MARKER}. */
const REPLACEMENT = "true";

/**
* Locate the shipped `dsh-client-connection` browser bundle.
* Resolution order: explicit override, the running dsh installation (derived
* from the launcher bin in argv), then this plugin's own location.
* @param override - configured absolute path (optional).
* @returns the bundle file path, or undefined when unresolvable.
*/
export function resolveClientBundle(override) {
	if (typeof override === "string" && override !== "") return override;
	const probe = (base) => {
		try {
			return createRequire(base).resolve("@deepseek-ai/dsh-client-connection/lib/client.js");
		} catch {
			return void 0;
		}
	};
	// 1) the running dsh install: argv[1] is .../node_modules/.bin/dsh
	const bin = process.argv[1];
	if (typeof bin === "string" && bin.endsWith(".bin/dsh")) {
		const root = join(dirname(dirname(bin)), "@deepseek-ai", "dsh-client-connection", "lib", "client.js");
		const direct = probe(join(dirname(dirname(bin)), "probe.js"));
		if (direct !== void 0) return direct;
		return root; // path-only fallback; existsSync is checked by the caller
	}
	// 2) this plugin's own location (dev checkouts under a node_modules)
	const here = probe(import.meta.url);
	if (here !== void 0) return here;
	return void 0;
}

/**
* Apply the fail-safe isLoopback patch to one bundle body.
* @param body - the original client-connection bundle bytes (utf8).
* @returns `{ patched, body }` — patched=false when the marker was absent and
* the original must be served untouched.
*/
export function patchConnectionBundle(body) {
	if (!body.includes(MARKER)) return { patched: false, body };
	return { patched: true, body: body.replaceAll(MARKER, REPLACEMENT) };
}
