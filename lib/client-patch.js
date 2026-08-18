// Fail-safe isLoopback patch: dsh's settings UI degrades on non-loopback
// pages (settings scope runs in memory mode → 插件配置 cards render nothing).
// Serve a patched dsh-client-connection bundle where `isLoopback` is forced
// to true; if the exact marker is absent (bundle changed), serve the original.

import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/** Bundle URL the browser actually loads (package-name id, per the boot manifest). */
export const CONNECTION_BUNDLE_PATHNAME = "/plugins/@deepseek-ai/dsh-client-connection/client.js";

const MARKER = "pageLocation === void 0 || isLoopbackHostname(pageLocation.hostname)";
const REPLACEMENT = "true";

/** Locate the shipped connection bundle: override, the running dsh install (argv), or this package. */
export function resolveClientBundle(override) {
	if (typeof override === "string" && override !== "") return override;
	const probe = (base) => {
		try {
			return createRequire(base).resolve("@deepseek-ai/dsh-client-connection/lib/client.js");
		} catch {
			return void 0;
		}
	};
	const bin = process.argv[1];
	if (typeof bin === "string" && bin.endsWith(".bin/dsh")) {
		const root = join(dirname(dirname(bin)), "@deepseek-ai", "dsh-client-connection", "lib", "client.js");
		return probe(join(dirname(dirname(bin)), "probe.js")) ?? root;
	}
	return probe(import.meta.url);
}

/** Fail-safe: replace the marker only when present, else return the original. */
export function patchConnectionBundle(body) {
	if (!body.includes(MARKER)) return { patched: false, body };
	return { patched: true, body: body.replaceAll(MARKER, REPLACEMENT) };
}
