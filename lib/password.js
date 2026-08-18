// Password management via dsh's settings service.
//
// Registers the `lan-access` settings namespace (a secret password field plus
// a non-secret `passwordOverride` mirror) and bridges the resolved password
// into the auth gate, so changing it from 设置 → 插件 → 插件配置 applies
// immediately and persists into the dsh settings document. Resolution:
// `stored-override ?? configured-password` — the configured password is the
// base layer; once changed in the UI the stored override wins until reset.
// The password literal is role('secret') and never crosses a wire boundary.

import z from "@deepseek-ai/schemastery";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";

export const PASSWORD_NAMESPACE = settingsNamespace("lan-access");

/** `password` is redacted from every wire response; `passwordOverride` mirrors
* whether the stored section overrides the configured password (for the card). */
export const PASSWORD_SCHEMA = z.object({
	password: z.string().role("secret"),
	passwordOverride: z.boolean()
});

/**
* Bridge the auth gate's password to the settings section: register the
* namespace (base = configured password), feed every resolved change into
* {@link state.password}, and keep the override mirror in sync (idempotent —
* an update that does not change the resolved value commits nothing). Inert
* without the settings service.
* @param ctx - the plugin's cordis context.
* @param configPassword - row config / environment password (the initial value).
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
		scope.watch(() => apply(() => scope.get()));
		apply(() => scope.get());
	});
}
