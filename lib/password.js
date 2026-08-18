// Password management via dsh's settings service.
//
// Registers the `lan-access` settings namespace (a secret password field plus
// a non-secret `passwordOverride` mirror) and bridges the resolved password
// into the auth gate, so changing it from 设置 → 插件 → 插件配置 applies
// immediately and persists into the dsh settings document (~/.dsh/settings.yaml).
//
// Resolution: `stored-override ?? configured-password` — the configured
// password (row config / DSH_LAN_PASSWORD, default '123') is the base layer;
// once the user changes it in the UI, the stored override wins until reset.
// The password literal is `role('secret')` and never crosses a wire boundary;
// the boolean mirror tells the browser half whether the stored section
// overrides the configured password (the card shows "set here" vs "using
// configured password", and offers the restore action).

import z from "@deepseek-ai/schemastery";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";

/** Settings namespace backing the password card in 设置 → 插件 → 插件配置. */
export const PASSWORD_NAMESPACE = settingsNamespace("lan-access");

/**
* Namespace schema. `password` is `role('secret')`: redacted from every wire
* response. `passwordOverride` is a non-secret mirror the host keeps in sync.
*/
export const PASSWORD_SCHEMA = z.object({
	password: z.string().role("secret"),
	passwordOverride: z.boolean()
});

/**
* Bridge the auth gate's password to the settings section.
*
* The gate reads {@link state.password} for every login attempt; the settings
* section (when the `settings` service is composed) is the live source of
* truth once the user changes the password in the UI. The section registers
* with the configured password as its `base` layer, so the resolved value is
* `stored-override ?? config`, and every resolved change re-writes the gate.
* The `passwordOverride` mirror is updated through the scope (idempotent: an
* update that does not change the resolved value commits nothing and fires no
* watcher). Without the settings service the bridge is inert and the gate
* keeps the configured password.
* @param ctx - the plugin's cordis context.
* @param configPassword - password from row config / environment (the initial value).
* @param state - mutable `{ password }` read by the auth gate.
*/
export function bridgePasswordSettings(ctx, configPassword, state) {
	if (typeof configPassword !== "string" || configPassword === "") return;
	ctx.inject(["settings"], (sctx) => {
		const entry = { password: configPassword, passwordOverride: false };
		const scope = sctx.settings.register(PASSWORD_NAMESPACE, PASSWORD_SCHEMA, { base: entry });
		let source = () => entry;
		let lastOverride = false;
		const apply = (nextSource) => {
			source = nextSource;
			const resolved = source();
			if (typeof resolved?.password === "string" && resolved.password !== "") state.password = resolved.password;
			const override = resolved?.password !== configPassword;
			if (override !== lastOverride) {
				lastOverride = override;
				scope.update({ passwordOverride: override }).catch(() => {});
			}
		};
		sctx.effect(() => () => {
			source = () => entry;
			apply(source);
		});
		scope.watch(() => {
			apply(() => scope.get());
		});
		apply(() => scope.get());
	});
}
