// dsh-web-lan — browser half.
//
// Registers one card in 设置 → 插件 → 插件配置 (the `settings.plugin.item`
// slot, keyed by the `lan-access` settings namespace the host half registers):
// a write-only password field whose save writes the namespace through the
// settings wire. The password never crosses a wire boundary — the host marks
// the schema field `role('secret')` (redacted from every response); whether
// the stored section overrides the configured password is carried by the
// host's non-secret `passwordOverride` mirror in the scope value. Saving with
// a blank field keeps the current password, and a reset button clears the
// stored override so the configured (row config / environment) password
// applies again. All copy goes through the locale service (zh/en), so the
// card follows the dsh General settings language automatically.
//
// This file is served verbatim by dsh's client-modules route
// (`/plugins/dsh-web-lan/client.js`) and must stay in the loader-wrapper
// format: no top-level imports, plain JavaScript, `React.createElement` only.
window.__ModuleLoader__.load({
	id: "dsh-web-lan",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");

		// ── card styles (same theme tokens as the built-in plugin cards) ──
		const css = ".lanA_a_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}.lanA_a_card:hover{border-color:var(--dsw-alias-label-dimmed)}.lanA_a_cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}.lanA_a_header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}.lanA_a_header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.lanA_a_headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}.lanA_a_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}.lanA_a_description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}.lanA_a_body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}.lanA_a_readOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}.lanA_a_pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.lanA_a_field{flex-direction:column;gap:6px;padding:12px 0;display:flex}.lanA_a_field+.lanA_a_field{border-top:1px solid var(--dsw-alias-border-l2)}.lanA_a_head{align-items:center;gap:8px;display:flex}.lanA_a_label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}.lanA_a_badges{align-items:center;gap:8px;display:inline-flex}.lanA_a_badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.lanA_a_badgeMuted{white-space:nowrap;color:var(--dsw-alias-label-tertiary);border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px}.lanA_a_input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5;width:100%;box-sizing:border-box}.lanA_a_input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}.lanA_a_input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}.lanA_a_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}.lanA_a_resetRow{padding-top:4px}.lanA_a_reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5}.lanA_a_reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}.lanA_a_reset:disabled{cursor:default}.lanA_a_footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}.lanA_a_failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}.lanA_a_discard,.lanA_a_save{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}.lanA_a_discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}.lanA_a_save{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);font-weight:600}.lanA_a_save:disabled{opacity:.5;cursor:default}";
		const tagId = "dsh-web-lan/card.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-web-lan";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		const lanCss = {
			"card": "lanA_a_card",
			"cardOpen": "lanA_a_cardOpen",
			"header": "lanA_a_header",
			"headText": "lanA_a_headText",
			"name": "lanA_a_name",
			"description": "lanA_a_description",
			"body": "lanA_a_body",
			"readOnly": "lanA_a_readOnly",
			"pending": "lanA_a_pending",
			"field": "lanA_a_field",
			"head": "lanA_a_head",
			"label": "lanA_a_label",
			"badges": "lanA_a_badges",
			"badge": "lanA_a_badge",
			"badgeMuted": "lanA_a_badgeMuted",
			"input": "lanA_a_input",
			"hint": "lanA_a_hint",
			"resetRow": "lanA_a_resetRow",
			"reset": "lanA_a_reset",
			"footer": "lanA_a_footer",
			"failed": "lanA_a_failed",
			"discard": "lanA_a_discard",
			"save": "lanA_a_save"
		};

		// ── controller: staged password over the `lan-access` settings scope ──
		const LAN_ACCESS_NS = "lan-access";

		/**
		* Bridges the `lan-access` scope onto the card's staged password form.
		* The literal never rides a response (host redacts it); whether the stored
		* section overrides the configured password is carried by the host's
		* non-secret `passwordOverride` mirror inside the scope value. Saving a
		* blank field writes nothing (keeps the current password).
		*/
		var LanAccessCardController = class {
			scope;
			api;
			staged = "";
			listeners = /* @__PURE__ */ new Set();
			saving = false;
			failed = false;
			saved = false;
			/**
			* @param scope - the bound settings scope for the `lan-access` namespace.
			* @param api - settings wire face used to write the password.
			*/
			constructor(scope, api) {
				this.scope = scope;
				this.api = api;
				this.store = _deepseek_ai_dsh_client_runtime_client.createSnapshotStore(this.projection());
				// Republish the projection into the store on every change (scope
				// snapshot, staged draft, save state) — the slot's
				// `useLanAccessCard` selector reads this store, so a store frozen
				// at construction (status "loading" → available false) would keep
				// the card rendering nothing forever.
				this.listeners.add(() => {
					this.store.set(this.projection());
				});
				scope.subscribe(() => {
					this.publish();
				});
			}
			projection() {
				const snapshot = this.scope.getSnapshot();
				const text = this.staged;
				return {
					available: snapshot.status === "ready",
					writable: snapshot.writable,
					dirty: text.trim() !== "",
					invalid: false,
					saving: this.saving,
					failed: this.failed,
					saved: this.saved,
					override: snapshot.value?.passwordOverride === true,
					password: { text }
				};
			}
			/**
			* Write the staged password, then re-read the scope (the host applies
			* it to the login gate immediately and persists it).
			* A blank draft writes nothing (keeps the current password).
			* @returns settlement after the write and the read-back.
			*/
			async save() {
				const text = this.staged.trim();
				if (text === "" || this.saving) return;
				this.saving = true;
				this.failed = false;
				this.saved = false;
				this.publish();
				try {
					const snapshot = this.scope.getSnapshot();
					const response = await this.api.settings.mutate({
						ns: LAN_ACCESS_NS,
						ops: [{ op: "set", path: ["password"], value: text }],
						...(snapshot.revision !== void 0 ? { expectedRevision: snapshot.revision } : {})
					});
					if (response.result?.ok) {
						this.staged = "";
						this.saved = true;
					} else {
						this.failed = true;
					}
				} catch (_settingsWriteFailure) {
					this.failed = true;
				}
				this.saving = false;
				this.scope.load();
				this.publish();
			}
			/**
			* Clear the stored override so the configured password applies again.
			*/
			async reset() {
				if (this.saving) return;
				this.saving = true;
				this.failed = false;
				this.saved = false;
				this.publish();
				try {
					const snapshot = this.scope.getSnapshot();
					const response = await this.api.settings.mutate({
						ns: LAN_ACCESS_NS,
						ops: [{ op: "unset", path: ["password"] }],
						...(snapshot.revision !== void 0 ? { expectedRevision: snapshot.revision } : {})
					});
					if (!response.result?.ok) this.failed = true;
				} catch (_settingsWriteFailure) {
					this.failed = true;
				}
				this.saving = false;
				this.scope.load();
				this.publish();
			}
			discard() {
				this.staged = "";
				this.failed = false;
				this.saved = false;
				this.publish();
			}
			edit(text) {
				this.staged = text;
				this.failed = false;
				this.saved = false;
				this.publish();
			}
			publish() {
				for (const listener of this.listeners) listener();
			}
			/**
			* Build the face the card's slot registration injects.
			* @returns the card's snapshot and its form actions.
			*/
			inject() {
				return {
					hooks: { lanAccessCard: this.store },
					edit: (text) => this.edit(text),
					save: () => this.save(),
					reset: () => this.reset(),
					discard: () => this.discard()
				};
			}
		};

		// ── card component ────────────────────────────────────────────────────
		/**
		* Render the LAN access card: a header disclosing a write-only password
		* control whose save applies the new password immediately.
		* @param props - locale copy, the card snapshot, and its form actions.
		* @returns the card, or nothing while the namespace is unavailable.
		*/
		function LanAccessCard(props) {
			const { t } = props;
			const [open, setOpen] = react.useState(false);
			const state = props.useLanAccessCard((snapshot) => snapshot);
			if (!state.available) return null;
			const disabled = !state.writable;
			const blocked = !state.dirty || state.invalid || state.saving;
			return react.createElement("li", {
				className: [lanCss.card, open ? lanCss.cardOpen : ""].filter(Boolean).join(" "),
				children: [
					react.createElement("button", {
						type: "button",
						className: lanCss.header,
						"aria-expanded": open,
						"aria-label": `${t(open ? "collapse" : "expand")}: ${t("title")}`,
						onClick: () => setOpen(!open),
						children: [
							react.createElement("span", { className: lanCss.headText, children: [
								react.createElement("span", { className: lanCss.name, children: t("title") }),
								react.createElement("span", { className: lanCss.description, children: t("description") })
							] }),
							state.saved ? react.createElement("span", { className: lanCss.pending, children: t("saved") }) : null
						]
					}),
					open ? react.createElement("div", { className: lanCss.body, children: [
						!state.writable ? react.createElement("p", { className: lanCss.readOnly, role: "status", children: t("readOnly") }) : null,
						react.createElement("div", { className: lanCss.field, children: [
							react.createElement("div", { className: lanCss.head, children: [
								react.createElement("label", { className: lanCss.label, htmlFor: "lan-access-password", children: t("passwordLabel") }),
								react.createElement("span", { className: lanCss.badges, children: [
								react.createElement("span", { className: state.override ? lanCss.badge : lanCss.badgeMuted, children: state.override ? t("passwordSet") : t("passwordUnset") })
								] })
							] }),
							react.createElement("input", {
								id: "lan-access-password",
								className: lanCss.input,
								type: "password",
								autoComplete: "off",
								value: state.password.text,
								disabled,
								onChange: (event) => props.edit(event.target.value)
							}),
							react.createElement("p", { className: lanCss.hint, children: t("passwordHint") })
						] }),
						state.override ? react.createElement("div", { className: lanCss.resetRow, children: [
							react.createElement("button", { type: "button", className: lanCss.reset, disabled, onClick: props.reset, children: t("resetToConfigured") })
						] }) : null,
						react.createElement("div", { className: lanCss.footer, children: [
							state.failed ? react.createElement("p", { className: lanCss.failed, role: "status", children: t("saveFailed") }) : null,
							react.createElement("button", { type: "button", className: lanCss.discard, disabled: (!state.dirty && !state.failed) || state.saving, onClick: props.discard, children: t("discard") }),
							react.createElement("button", { type: "button", className: lanCss.save, disabled: blocked, onClick: props.save, children: t(state.saving ? "saving" : "save") })
						] })
					] }) : null
				]
			});
		}

		// ── locale ────────────────────────────────────────────────────────────
		const NS = "dsh-web-lan";
		/** English copy. */
		const en = {
			title: "LAN access",
			description: "Manage the shared LAN access password.",
			passwordLabel: "Access password",
			passwordHint: "Enter a new password and save; leave blank to keep the current one. Takes effect immediately.",
			passwordSet: "Set here",
			passwordUnset: "Using configured password",
			resetToConfigured: "Restore the configured password",
			readOnly: "This deployment stores settings read-only.",
			expand: "Show settings",
			collapse: "Hide settings",
			save: "Save",
			saving: "Saving…",
			saved: "Saved",
			discard: "Discard",
			saveFailed: "The deployment did not accept these values; they were left for you to correct."
		};
		/** Simplified Chinese copy. */
		const zh = {
			title: "局域网访问",
			description: "管理局域网共享访问密码。",
			passwordLabel: "访问密码",
			passwordHint: "输入新密码并保存即生效；留空保持当前密码不变。",
			passwordSet: "已在此设置",
			passwordUnset: "使用配置中的密码",
			resetToConfigured: "恢复为配置中的密码",
			readOnly: "本部署的设置为只读。",
			expand: "展开设置",
			collapse: "收起设置",
			save: "保存",
			saving: "保存中…",
			saved: "已保存",
			discard: "放弃修改",
			saveFailed: "本部署没有接受这些值，已保留供你修改。"
		};

		// ── entry ─────────────────────────────────────────────────────────────
		/** Required services (cordis fiber inject). */
		const inject = [
			"slots",
			"locale",
			"connection",
			"remote",
			"settingsScope"
		];

		/**
		* Mount the LAN access card into the plugin configuration section.
		* @param ctx - the browser plugin context.
		*/
		function apply(ctx) {
			const { api } = ctx.get("connection");
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-web-lan: card dictionaries");
			// `decode` bypasses schema validation: the password field is redacted
			// from the served value, so an empty object must still read as ready.
			// The scope re-reads itself on settings/document-updated (the host
			// bumps the namespace on every password write), so the badge and the
			// reset affordance follow the `passwordOverride` mirror automatically.
			const controller = new LanAccessCardController(ctx.settingsScope.bind({ namespace: LAN_ACCESS_NS, decode: (value) => value }), api);
			ctx.slots.inject("settings.plugin.item", function* () {
				yield ctx.slots.register({
					name: "settings.plugin.item",
					key: LAN_ACCESS_NS,
					locale: NS,
					inject: () => controller.inject()
				}, LanAccessCard);
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
