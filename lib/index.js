// dsh-web-lan — LAN access layer for DeepSeek Harness (`dsh`) web.
//
//  1. crypto.randomUUID polyfill — fixes the whole /api layer on plain-HTTP
//     LAN origins (that API only exists in secure contexts);
//  2. Password gate — unauthenticated callers get a login page / 401;
//     authenticated callers pass through with Host/Origin rewritten to the
//     loopback authority, so dsh's trust fence treats them as local clients;
//  3. Client isLoopback patch — so the settings/plugin-config plane works on
//     LAN pages (fail-safe bundle patch);
//  4. Password management from 设置 → 插件 → 插件配置 (zh/en card, secret
//     field, applies immediately, persists).
//
// Zero-config install: the package declares `dsh.bundle`; its cordis.patch.yml
// binds the web server to 0.0.0.0 and inserts this row (default password '123',
// override with DSH_LAN_PASSWORD). With an empty password the gate stays off
// and LAN access stays OPEN (a boot warning is logged).

import { homedir } from "node:os";
import { join } from "node:path";
import { injectPolyfill } from "./polyfill.js";
import { wrapServer } from "./auth.js";
import { resolveClientBundle } from "./client-patch.js";
import { PASSWORD_NAMESPACE, PASSWORD_SCHEMA, bridgePasswordSettings } from "./password.js";

export { PASSWORD_NAMESPACE, PASSWORD_SCHEMA };

/** Stable Cordis plugin name. Must be unique among mounted plugins. */
const name = "lan-access";

/** Host services required before the index tap and server wrap can mount. */
const inject = ["webServer"];

/** Default session store location (writable in the dsh server's environment). */
function defaultSessionFile() {
	return join(homedir(), ".dsh", "dsh-lan-sessions.json");
}

function apply(ctx, config) {
	const password = config?.password ?? process.env.DSH_LAN_PASSWORD;
	const sessionFile = config?.sessionFile ?? process.env.DSH_LAN_SESSION_FILE ?? defaultSessionFile();
	const clientBundlePath = config?.clientBundlePath ?? process.env.DSH_LAN_CLIENT_BUNDLE ?? resolveClientBundle();
	const authOn = Boolean(password);

	/** Live password the auth gate checks; updated by the settings section. */
	const authState = { password };

	ctx.inject(["webServer"], (httpCtx) => {
		// 1. crypto.randomUUID polyfill on every index response.
		httpCtx.effect(() => httpCtx.webServer.tapIndex(injectPolyfill), "lan-access: crypto.randomUUID polyfill");

		// 2. Password gate over the whole HTTP surface (including WebSocket upgrades).
		if (authOn) {
			httpCtx.effect(() => wrapServer(httpCtx.webServer.server, authState, {
				sessionFile,
				clientBundlePath
			}), "lan-access: password gate");
		} else {
			ctx.logger?.warn?.("[lan-access] no password configured — LAN access is OPEN; set row config or DSH_LAN_PASSWORD");
		}
	});

	// 3. Password editable from 设置 → 插件 → 插件配置 (applies immediately, persists).
	bridgePasswordSettings(ctx, authOn ? password : "", authState);
}

export default { name, inject, apply };
