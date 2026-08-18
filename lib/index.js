// dsh-web-lan — DeepSeek Harness (`dsh`) web-profile plugin: LAN access layer.
//
// Features:
//   1. crypto.randomUUID polyfill — the dsh browser client calls
//      crypto.randomUUID() for every RPC/message id, an API that only exists
//      in secure contexts (HTTPS/localhost); over plain HTTP on a LAN IP it is
//      undefined and the whole /api layer fails. An inline getRandomValues
//      implementation is injected into every served index.html.
//   2. Password gate — unauthenticated callers get a login page / 401;
//      authenticated callers pass through with Host/Origin rewritten to the
//      loopback authority, so dsh's trust fence (which pins
//      settings/credentials/agent-preset management to loopback until a real
//      authentication layer exists) treats the logged-in LAN user as a
//      trusted local client. Single shared password (no multi-user).
//   3. Client isLoopback patch — dsh's settings UI degrades on non-loopback
//      pages (settings scope runs in memory mode, so the plugin-configuration
//      cards render nothing). A fail-safe patched dsh-client-connection bundle
//      forces the client's isLoopback flag so the settings plane works.
//   4. Password management in 设置 → 插件 → 插件配置 — the plugin registers a
//      `lan-access` settings namespace (secret password field) plus a client
//      card; saving a new password updates the running gate immediately and
//      persists into the dsh settings document. The configured password (row
//      config / DSH_LAN_PASSWORD, default '123') is the initial value; once
//      changed in the UI, the stored override wins.
//
// Configuration (row config or environment):
//   password: ...          or DSH_LAN_PASSWORD      (default from bundle patch: '123')
//   sessionFile: ...       or DSH_LAN_SESSION_FILE  (default: ~/.dsh/dsh-lan-sessions.json)
//   clientBundlePath: ...  or DSH_LAN_CLIENT_BUNDLE (override the bundle to patch)
// When the password is empty, the plugin only injects the polyfill and LAN
// access stays OPEN (a boot warning is logged).
//
// Installation is zero-config: the package declares `dsh.bundle`, so
// `dsh plugin --profile web add dsh-web-lan` auto-appends it to the profile's
// bundle stack and its cordis.patch.yml binds the web server to 0.0.0.0,
// inserts this plugin row, and serves the browser half (lib/client.js).

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
