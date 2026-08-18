// Integration test for dsh-web-lan (no dsh needed, pure Node).
//
// Builds a stub node:http server that mimics dsh's webServer (a trust fence
// that 403s privileged methods for non-loopback Hosts, plus a static index
// fallback), mounts the plugin with a fake Cordis ctx, then exercises the
// whole auth surface: unauthenticated interception, login/logout, session
// cookies, Host/Origin rewrite, privileged-method pass-through, brute-force
// lockout, WebSocket upgrade gating, and the randomUUID polyfill tap.

import { createServer, request as httpRequest } from "node:http";
import { strict as assert } from "node:assert";
import plugin from "../lib/index.js";

const PORT = 0; // OS-assigned

// ── helpers ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
function check(name, fn) {
	try {
		fn();
		passed += 1;
		console.log(`  ok  ${name}`);
	} catch (error) {
		failed += 1;
		console.error(`FAIL  ${name}\n      ${error.message}`);
	}
}

function cookieFrom(res) {
	const setCookie = res.headers.get("set-cookie") ?? "";
	const m = /dsh_lan_session=([^;]+)/.exec(setCookie);
	return m === null ? void 0 : m[1];
}

async function getJson(port, path, cookie) {
	const res = await fetch(`http://127.0.0.1:${port}${path}`, {
		headers: cookie === void 0 ? {} : { cookie: `dsh_lan_session=${cookie}` },
		redirect: "manual"
	});
	return res;
}

// ── stub server that mimics dsh's webServer + trust fence ───────────────────

const seen = { hosts: [], upgrades: 0 };
const stub = createServer((req, res) => {
	seen.hosts.push(req.headers.host);
	const pathname = new URL(req.url ?? "/", "http://x").pathname;
	const loopback = (req.headers.host ?? "").startsWith("127.");
	if (pathname.startsWith("/api/")) {
		// Mimic dsh: privileged methods require loopback Host; workspace.list passes for LAN.
		const privileged = pathname.includes("settings.describe") || pathname.includes("credentials.describe");
		if (privileged && !loopback) {
			res.writeHead(403);
			res.end("forbidden");
			return;
		}
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify({ ok: true, host: req.headers.host, origin: req.headers.origin ?? null }));
		return;
	}
	res.writeHead(200, { "content-type": "text/html" });
	res.end("<!doctype html><html><head></head><body><div id=\"root\"></div></body></html>");
});
stub.on("upgrade", (req, socket) => {
	seen.upgrades += 1;
	socket.write("HTTP/1.1 101 Switching Protocols\r\n\r\n");
	socket.end();
});

// ── mount helpers: fake cordis ctx providing webServer + settings ──────────

/**
* Build a fake `settings` service that records namespace registrations and lets
* a test push a new resolved value (as the real provider does on persist/load).
* @param preloaded - map of namespace -> stored user section (simulates a
*   settings document that already holds overrides from a previous session).
* @returns `{ service, registrations }`.
*/
function fakeSettings(preloaded = {}) {
	const registrations = new Map();
	const service = {
		register(ns, schema, options) {
			if (registrations.has(ns)) throw new Error(`settings namespace "${ns}" is already registered`);
			const watchers = new Set();
			const rec = {
				schema,
				resolved: { ...(options?.base ?? {}), ...(preloaded[ns] ?? {}) },
				setResolved(value) {
					rec.resolved = value;
					for (const cb of [...watchers]) cb(value);
				}
			};
			rec.scope = {
				get: () => rec.resolved,
				watch: (cb) => {
					watchers.add(cb);
					return () => watchers.delete(cb);
				},
				update: async () => {},
				replace: async () => {}
			};
			registrations.set(ns, rec);
			return rec.scope;
		}
	};
	return { service, registrations };
}

/**
* Mount the plugin against a fake cordis ctx.
* @param options - `{ password, sessionFile, clientBundlePath, server, preloadedSettings }`.
* @returns the registered effects/taps, the settings registrations, and the ctx.
*/
function mountPlugin({ password, sessionFile, clientBundlePath, server, preloadedSettings = {} } = {}) {
	const taps = [];
	const effects = [];
	const warnings = [];
	const { service: settings, registrations: settingsRegs } = fakeSettings(preloadedSettings);
	const ctx = {
		logger: { warn(message) { warnings.push(message); } },
		fiber: { state: 0 },
		inject(services, cb) {
			if (services.includes("webServer")) {
				cb({ webServer: { tapIndex(fn) { taps.push(fn); }, server }, effect(fn) { effects.push(fn); } });
			}
			if (services.includes("settings")) {
				cb({ settings, effect(fn) { effects.push(fn); } });
			}
		}
	};
	plugin.apply(ctx, { password, sessionFile, clientBundlePath });
	for (const fn of effects) fn(); // run the registered effects in order
	return { taps, effects, warnings, settingsRegs, ctx };
}

// ── mount the plugin with a fake ctx ───────────────────────────────────────

const { taps, effects, settingsRegs } = mountPlugin({ password: "secret", server: stub });
assert.strictEqual(taps.length, 1, "polyfill tap registered");

await new Promise((resolve) => stub.listen(PORT, "127.0.0.1", resolve));
const port = stub.address().port;
const loopback = `127.0.0.1:${port}`;

// ── tests ───────────────────────────────────────────────────────────────────

console.log("polyfill tap:");
check("injects crypto.randomUUID polyfill into index", () => {
	const html = taps[0]("<!doctype html><html><head></head><body><div id=\"root\"></div></body></html>");
	assert.ok(html.includes("crypto.randomUUID"));
	assert.ok(html.indexOf("<body>") < html.indexOf("crypto.randomUUID"));
	assert.strictEqual(taps[0](html), html, "idempotent");
});

console.log("unauthenticated access:");
check("GET / redirects to /login", async () => {
	const res = await getJson(port, "/");
	assert.strictEqual(res.status, 302);
	assert.strictEqual(res.headers.get("location"), "/login");
});
check("GET /login serves the login page (password only, no username field)", async () => {
	const res = await getJson(port, "/login");
	assert.strictEqual(res.status, 200);
	const html = await res.text();
	assert.ok(html.includes("type=\"password\""));
	assert.ok(!html.includes("name=\"username\""), "no username field");
});
check("POST /api/settings.describe without cookie -> 401", async () => {
	const res = await getJson(port, "/api/settings.describe");
	assert.strictEqual(res.status, 401);
});
check("WebSocket upgrade without cookie is destroyed", async () => {
	seen.upgrades = 0;
	await new Promise((resolve) => {
		const req = httpRequest({ host: "127.0.0.1", port, path: "/api/events.host", headers: { connection: "Upgrade", upgrade: "websocket" } });
		req.on("upgrade", () => resolve("upgraded"));
		req.on("error", () => resolve("error"));
		req.on("close", () => setTimeout(resolve, 50, "closed"));
		req.end();
	});
	assert.strictEqual(seen.upgrades, 0, "original upgrade handler must not run");
});

console.log("login:");
check("wrong password -> 401, error message follows Accept-Language", async () => {
	// Chinese when the browser asks for zh
	const zh = await fetch(`http://127.0.0.1:${port}/login`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded", "accept-language": "zh-CN,zh;q=0.9" },
		body: "password=wrong",
		redirect: "manual"
	});
	assert.strictEqual(zh.status, 401);
	assert.ok((await zh.text()).includes("密码错误"), "zh error message");
	// English otherwise
	const en = await fetch(`http://127.0.0.1:${port}/login`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: "password=wrong",
		redirect: "manual"
	});
	assert.strictEqual(en.status, 401);
	assert.ok((await en.text()).includes("Incorrect password"), "en error message");
});
check("GET /login serves a login page in the request language", async () => {
	const zh = await fetch(`http://127.0.0.1:${port}/login`, { headers: { "accept-language": "zh-CN" } });
	const zhHtml = await zh.text();
	assert.ok(zhHtml.includes("请输入访问密码"), "zh login page");
	const en = await fetch(`http://127.0.0.1:${port}/login`, { headers: { "accept-language": "en-US" } });
	const enHtml = await en.text();
	assert.ok(enHtml.includes("Enter the access password"), "en login page");
});
check("correct credentials -> 302 + session cookie", async () => {
	const res = await fetch(`http://127.0.0.1:${port}/login`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: "password=secret",
		redirect: "manual"
	});
	assert.strictEqual(res.status, 302);
	assert.strictEqual(res.headers.get("location"), "/");
	const cookie = cookieFrom(res);
	assert.ok(cookie !== void 0 && cookie.length >= 64, "random 256-bit token");
	const sc = res.headers.get("set-cookie") ?? "";
	assert.ok(sc.includes("HttpOnly") && sc.includes("SameSite=Strict"), "cookie flags");
	globalThis.__cookie = cookie;
});

console.log("authenticated access:");
check("GET / with cookie -> 200, Host rewritten to loopback", async () => {
	const res = await getJson(port, "/", globalThis.__cookie);
	assert.strictEqual(res.status, 200);
	assert.ok(seen.hosts.includes(loopback), `stub saw Host ${loopback}`);
});
check("POST /api/settings.describe with cookie -> 200 (privileged method passes)", async () => {
	const res = await fetch(`http://127.0.0.1:${port}/api/settings.describe`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			cookie: `dsh_lan_session=${globalThis.__cookie}`,
			host: "172.22.157.12:3080",
			origin: "http://172.22.157.12:3080"
		},
		body: "{}"
	});
	assert.strictEqual(res.status, 200);
	const body = await res.json();
	assert.strictEqual(body.host, loopback, "Host rewritten");
	assert.strictEqual(body.origin, `http://${loopback}`, "Origin rewritten");
});
check("WebSocket upgrade with cookie reaches original handler", async () => {
	seen.upgrades = 0;
	const result = await new Promise((resolve) => {
		const req = httpRequest({
			host: "127.0.0.1", port, path: "/api/events.host",
			headers: { connection: "Upgrade", upgrade: "websocket", cookie: `dsh_lan_session=${globalThis.__cookie}` }
		});
		req.on("upgrade", () => resolve("upgraded"));
		req.on("error", () => resolve("error"));
		req.end();
	});
	assert.strictEqual(result, "upgraded");
	assert.strictEqual(seen.upgrades, 1, "original upgrade handler ran");
});

console.log("logout:");
check("POST /logout clears session, then / redirects again", async () => {
	const res = await fetch(`http://127.0.0.1:${port}/logout`, {
		method: "POST",
		headers: { cookie: `dsh_lan_session=${globalThis.__cookie}` },
		redirect: "manual"
	});
	assert.strictEqual(res.status, 302);
	assert.ok((res.headers.get("set-cookie") ?? "").includes("Max-Age=0"));
	const again = await getJson(port, "/", globalThis.__cookie);
	assert.strictEqual(again.status, 302, "old session no longer valid");
});

console.log("brute-force lockout:");
check("5 failures then 429 on the 6th attempt", async () => {
	for (let i = 0; i < 5; i++) {
		await fetch(`http://127.0.0.1:${port}/login`, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: "password=nope",
			redirect: "manual"
		});
	}
	const res = await fetch(`http://127.0.0.1:${port}/login`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: "password=secret",
		redirect: "manual"
	});
	assert.strictEqual(res.status, 429);
});

console.log("no-credentials mode:");
check("without credentials the gate stays open (polyfill only) + warning", async () => {
	const stub2 = createServer((req, res) => {
		res.writeHead(200, { "content-type": "text/html" });
		res.end("<!doctype html><html><body>x</body></html>");
	});
	const mounted = mountPlugin({ server: stub2 });
	await new Promise((resolve) => stub2.listen(0, "127.0.0.1", resolve));
	const p2 = stub2.address().port;
	const res = await fetch(`http://127.0.0.1:${p2}/api/anything`, { redirect: "manual" });
	assert.strictEqual(res.status, 200, "no auth gate without credentials");
	assert.strictEqual(mounted.taps.length, 1);
	assert.ok(mounted.warnings.some((w) => w.includes("OPEN")), "boot warning logged");
	stub2.close();
});

console.log("session persistence:");
check("sessions survive a server restart via the session file", async () => {
	const { mkdtempSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const dir = mkdtempSync(join(tmpdir(), "dsh-lan-test-"));
	const sessionFile = join(dir, "sessions.json");

	const mount = () => {
		const srv = createServer((req, res) => {
			res.writeHead(200, { "content-type": "text/html" });
			res.end("<!doctype html><html><body>ok</body></html>");
		});
		mountPlugin({ password: "secret", sessionFile, server: srv });
		return srv;
	};

	// first "boot": login and grab the token
	const srv1 = mount();
	await new Promise((resolve) => srv1.listen(0, "127.0.0.1", resolve));
	const p1 = srv1.address().port;
	const login = await fetch(`http://127.0.0.1:${p1}/login`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: "password=secret",
		redirect: "manual"
	});
	const token = cookieFrom(login);
	assert.ok(token, "got a session token");
	const before = await fetch(`http://127.0.0.1:${p1}/`, { headers: { cookie: `dsh_lan_session=${token}` }, redirect: "manual" });
	assert.strictEqual(before.status, 200, "token works on the first boot");
	await new Promise((resolve) => srv1.close(resolve));

	// second "boot" (restart): same session file, fresh server
	const srv2 = mount();
	await new Promise((resolve) => srv2.listen(0, "127.0.0.1", resolve));
	const p2 = srv2.address().port;
	const after = await fetch(`http://127.0.0.1:${p2}/`, { headers: { cookie: `dsh_lan_session=${token}` }, redirect: "manual" });
	assert.strictEqual(after.status, 200, "same token still valid after restart (persisted)");
	await new Promise((resolve) => srv2.close(resolve));
});

console.log("client isLoopback patch:");
check("authenticated users get the patched connection bundle", async () => {
	const { mkdtempSync, writeFileSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const dir = mkdtempSync(join(tmpdir(), "dsh-lan-bundle-"));
	const bundlePath = join(dir, "client.js");
	const MARKER = "pageLocation === void 0 || isLoopbackHostname(pageLocation.hostname)";
	const ORIGINAL = `function x() {\n  isLoopback: ${MARKER},\n  other: 1\n}\n`;
	writeFileSync(bundlePath, ORIGINAL);

	const srv = createServer((req, res) => {
		res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
		res.end("ORIGINAL-HANDLER");
	});
	mountPlugin({ password: "secret", clientBundlePath: bundlePath, server: srv });
	await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
	const port = srv.address().port;

	// unauthenticated: still 401
	const unauth = await fetch(`http://127.0.0.1:${port}/plugins/@deepseek-ai/dsh-client-connection/client.js`, { redirect: "manual" });
	assert.strictEqual(unauth.status, 401, "bundle gated behind auth");

	// login and fetch the bundle
	const login = await fetch(`http://127.0.0.1:${port}/login`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: "password=secret",
		redirect: "manual"
	});
	const token = cookieFrom(login);
	const res = await fetch(`http://127.0.0.1:${port}/plugins/@deepseek-ai/dsh-client-connection/client.js?rev=abc`, {
		headers: { cookie: `dsh_lan_session=${token}` }
	});
	assert.strictEqual(res.status, 200);
	assert.strictEqual(res.headers.get("content-type"), "text/javascript; charset=utf-8");
	const body = await res.text();
	assert.ok(!body.includes(MARKER), "marker replaced");
	assert.ok(body.includes("isLoopback: true"), "isLoopback forced to true");
	assert.ok(body.includes("other: 1"), "rest of bundle intact");
	await new Promise((resolve) => srv.close(resolve));
});

check("bundle patch is fail-safe when the marker is absent", async () => {
	const { mkdtempSync, writeFileSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const dir = mkdtempSync(join(tmpdir(), "dsh-lan-bundle2-"));
	const bundlePath = join(dir, "client.js");
	writeFileSync(bundlePath, "export const whatever = 1;\n"); // no marker

	const srv = createServer((req, res) => {
		res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
		res.end("ORIGINAL-HANDLER");
	});
	mountPlugin({ password: "secret", clientBundlePath: bundlePath, server: srv });
	await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
	const port = srv.address().port;
	const login = await fetch(`http://127.0.0.1:${port}/login`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: "password=secret",
		redirect: "manual"
	});
	const token = cookieFrom(login);
	const res = await fetch(`http://127.0.0.1:${port}/plugins/@deepseek-ai/dsh-client-connection/client.js`, {
		headers: { cookie: `dsh_lan_session=${token}` }
	});
	assert.strictEqual(res.status, 200);
	assert.strictEqual(await res.text(), "ORIGINAL-HANDLER", "original bundle served untouched");
	await new Promise((resolve) => srv.close(resolve));
});

console.log("password management in 插件配置:");
check("registers the lan-access settings namespace when a password is configured", () => {
	assert.ok(settingsRegs.has("lan-access"), "lan-access namespace registered");
	const schema = settingsRegs.get("lan-access").schema;
	const json = schema.toJSON();
	// find the password field through the object's dict (uid layout is stable
	// per schema, not hard-coded)
	const objectRef = Object.values(json.refs).find((ref) => ref?.type === "object" && ref?.dict?.password !== void 0);
	assert.ok(objectRef, "schema has a password field");
	const secret = json.refs[objectRef.dict.password];
	assert.strictEqual(secret.type, "string");
	assert.strictEqual(secret.meta.role, "secret", "password field is redacted on the wire");
	const overrideRef = json.refs[objectRef.dict.passwordOverride];
	assert.strictEqual(overrideRef.type, "boolean", "passwordOverride mirror is non-secret");
});

check("saving a new password through settings updates the gate immediately", async () => {
	const srv = createServer((req, res) => {
		res.writeHead(200, { "content-type": "text/html" });
		res.end("<!doctype html><html><body>ok</body></html>");
	});
	const mounted = mountPlugin({ password: "secret", server: srv });
	await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
	const p = srv.address().port;

	const login = async (pass) => (await fetch(`http://127.0.0.1:${p}/login`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: `password=${encodeURIComponent(pass)}`,
		redirect: "manual"
	})).status;

	// an existing session must survive until the password changes...
	const session = await fetch(`http://127.0.0.1:${p}/login`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: "password=secret",
		redirect: "manual"
	});
	const cookie = cookieFrom(session);
	const authed = await fetch(`http://127.0.0.1:${p}/`, { headers: { cookie: `dsh_lan_session=${cookie}` } });
	assert.strictEqual(authed.status, 200, "session works before the change");

	assert.strictEqual(await login("secret"), 302, "configured password works");
	// the settings provider resolves a new value (as a UI save would persist it)
	mounted.settingsRegs.get("lan-access").setResolved({ password: "hunter2" });
	assert.strictEqual(await login("secret"), 401, "old password rejected after change");
	assert.strictEqual(await login("hunter2"), 302, "new password accepted immediately");
	// ...and the password change kicks every existing session
	const kicked = await fetch(`http://127.0.0.1:${p}/`, { headers: { cookie: `dsh_lan_session=${cookie}` }, redirect: "manual" });
	assert.strictEqual(kicked.status, 302, "old session invalidated by the password change");
	await new Promise((resolve) => srv.close(resolve));
});

check("a stored override from a previous session wins over the configured password", async () => {
	const srv = createServer((req, res) => {
		res.writeHead(200, { "content-type": "text/html" });
		res.end("<!doctype html><html><body>ok</body></html>");
	});
	mountPlugin({ password: "secret", server: srv, preloadedSettings: { "lan-access": { password: "stored" } } });
	await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
	const p = srv.address().port;
	const login = async (pass) => (await fetch(`http://127.0.0.1:${p}/login`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: `password=${encodeURIComponent(pass)}`,
		redirect: "manual"
	})).status;
	assert.strictEqual(await login("secret"), 401, "configured password shadowed by the stored override");
	assert.strictEqual(await login("stored"), 302, "stored password accepted");
	await new Promise((resolve) => srv.close(resolve));
});

check("no settings service composed -> gate keeps the configured password", async () => {
	const srv = createServer((req, res) => {
		res.writeHead(200, { "content-type": "text/html" });
		res.end("<!doctype html><html><body>ok</body></html>");
	});
	const taps = [];
	const effects = [];
	const ctx = {
		logger: { warn() {} },
		fiber: { state: 0 },
		inject(services, cb) {
			if (services.includes("webServer")) cb({ webServer: { tapIndex(fn) { taps.push(fn); }, server: srv }, effect(fn) { effects.push(fn); } });
			// "settings" is intentionally absent: the bridge must no-op.
		}
	};
	plugin.apply(ctx, { password: "secret" });
	for (const fn of effects) fn();
	await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
	const p = srv.address().port;
	const login = await fetch(`http://127.0.0.1:${p}/login`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: "password=secret",
		redirect: "manual"
	});
	assert.strictEqual(login.status, 302, "gate still works with the configured password");
	await new Promise((resolve) => srv.close(resolve));
});

console.log("client bundle:");
check("browser half loads under the module loader and registers the lan-access card", async () => {
	const previousWindow = globalThis.window;
	let captured;
	globalThis.window = {
		__ModuleLoader__: {
			load(def) { captured = def; }
		}
	};
	try {
		await import("../lib/client.js");
	} finally {
		if (previousWindow === void 0) delete globalThis.window;
		else globalThis.window = previousWindow;
	}
	assert.ok(captured !== void 0, "bundle registered with the module loader");
	assert.strictEqual(captured.id, "dsh-web-lan");

	const reactStub = {
		createElement: () => ({}),
		useState: (initial) => [initial, () => {}],
		useEffect: () => {}
	};
	const storeStub = (initial) => ({
		getSnapshot: () => initial,
		set: () => {},
		subscribe: () => () => {}
	});
	const factoryResult = captured.factory((spec) => {
		if (spec === "react") return reactStub;
		if (spec === "@deepseek-ai/dsh-client-runtime/client") return { createSnapshotStore: storeStub };
		if (spec === "@deepseek-ai/dsh-client-ui-primitives") return { Button: () => ({}), Input: () => ({}), Pill: () => ({}) };
		throw new Error(`unexpected require: ${spec}`);
	});

	const registrations = [];
	const ctx = {
		get(name) {
			if (name === "connection") return {
				api: {
					settings: {
						describe: async () => ({ result: { ok: true, value: { namespaces: [] } } }),
						mutate: async () => ({ result: { ok: true, value: {} } })
					}
				}
			};
			return void 0;
		},
		locale: {
			bind: () => (key) => key,
			register: () => {},
			subscribe: () => () => {}
		},
		effect: () => {},
		remote: { $on: () => () => {} },
		settingsScope: {
			bind: (spec) => ({
				getSnapshot: () => ({ status: "ready", writable: true, value: {}, revision: 0 }),
				subscribe: () => () => {},
				load: () => {},
				set: async () => {},
				unset: async () => {}
			})
		},
		slots: {
			inject: (name, generator) => {
				if (name !== "settings.plugin.item") return;
				for (const registration of generator()) registrations.push(registration);
			}
		}
	};
	assert.deepStrictEqual(factoryResult.inject, ["slots", "locale", "connection", "remote", "settingsScope"]);
	factoryResult.apply(ctx);
	assert.strictEqual(registrations.length, 1, "one card registered");
	assert.strictEqual(registrations[0].options.key, "lan-access", "card keyed by the settings namespace");
	assert.strictEqual(typeof registrations[0].component, "function");
});

console.log("uninstall reversibility:");
check("disposing the gate restores the original request/upgrade listeners", async () => {
	const { wrapServer } = await import("../lib/auth.js");
	let requests = 0;
	const srv = createServer((req, res) => {
		requests += 1;
		res.writeHead(200, { "content-type": "text/plain" });
		res.end("original-handler");
	});
	srv.on("upgrade", (req, socket) => {
		socket.write("HTTP/1.1 101 Switching Protocols\r\n\r\n");
		socket.end();
	});
	await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
	const p = srv.address().port;

	// gate active: unauthenticated request is intercepted (302 to /login)
	const disposer = wrapServer(srv, { password: "secret" }, {});
	const gated = await fetch(`http://127.0.0.1:${p}/anything`, { redirect: "manual" });
	assert.strictEqual(gated.status, 302, "gate intercepts before disposal");
	assert.strictEqual(requests, 0, "original handler not reached while gated");

	// dispose: the original handler must be restored
	disposer();
	const open = await fetch(`http://127.0.0.1:${p}/anything`);
	assert.strictEqual(open.status, 200);
	assert.strictEqual(await open.text(), "original-handler");
	assert.strictEqual(requests, 1, "original handler reached after disposal");
	await new Promise((resolve) => srv.close(resolve));
});

await new Promise((resolve) => stub.close(resolve));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
