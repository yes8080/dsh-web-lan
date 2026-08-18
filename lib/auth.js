// Password gate for the dsh web server (single shared password; the current
// dsh LAN model has no multi-user support).
//
// Wraps the running node:http server's request/upgrade handling so that:
//   - unauthenticated callers get a login page (browsers) or 401 (API/WS);
//   - authenticated callers pass through, with the request's Host/Origin
//     rewritten to the loopback authority so dsh's own trust fence — which
//     pins settings/credentials/agent-preset management to loopback until a
//     real authentication layer exists — treats the logged-in LAN user as a
//     trusted local client. This plugin IS that authentication layer.
//
// The login page is served pre-auth, so its language follows the browser's
// Accept-Language (zh -> Chinese, otherwise English); the in-app password
// card follows the dsh General settings language through the locale service.
//
// Sessions are persisted to a JSON file (default
// ~/.dsh/dsh-lan-sessions.json) so a dsh restart does not log everyone out;
// tokens are random 256-bit values, the session cookie is HttpOnly +
// SameSite=Strict, and a per-IP brute-force lockout (5 failures -> 30s)
// slows guessing.
//
// Known limitations (plain-HTTP LAN):
//   - credentials travel in clear text on the wire; prefer an SSH tunnel or
//     HTTPS when the network is not trusted;
//   - never log in on a hostname/domain you do not control (DNS rebinding);
//     always use the server's real IP or name.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CONNECTION_BUNDLE_PATHNAME, patchConnectionBundle } from "./client-patch.js";

/** Session cookie name. */
export const COOKIE_NAME = "dsh_lan_session";
/** Allowed failed logins per IP before a temporary lockout. */
const MAX_ATTEMPTS = 5;
/** Lockout duration after too many failures, milliseconds. */
const LOCKOUT_MS = 30_000;
/** Max login body size, bytes. */
const BODY_LIMIT = 8192;
/** Session lifetime, milliseconds (also the cookie Max-Age). */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Constant-time string comparison via sha256 (equal-length buffers). */
function safeEqual(a, b) {
	const ha = createHash("sha256").update(a).digest();
	const hb = createHash("sha256").update(b).digest();
	return timingSafeEqual(ha, hb);
}

/**
* Load persisted sessions from disk. Returns a Map of token -> created-at.
* Any read/parse failure falls back to an empty Map (the gate stays open to
* new logins, never crashes on a bad file).
*/
function loadSessions(sessionFile) {
	if (sessionFile === void 0 || !existsSync(sessionFile)) return new Map();
	try {
		const raw = JSON.parse(readFileSync(sessionFile, "utf8"));
		const entries = typeof raw?.sessions === "object" && raw.sessions !== null ? raw.sessions : {};
		const now = Date.now();
		const map = new Map();
		for (const [token, createdAt] of Object.entries(entries)) {
			if (typeof token === "string" && token.length >= 32 && typeof createdAt === "number" && now - createdAt < SESSION_TTL_MS) {
				map.set(token, createdAt);
			}
		}
		return map;
	} catch {
		return new Map();
	}
}

/**
* Persist sessions to disk (0600). Failures are logged by the caller and
* never break the gate: the plugin degrades to in-memory-only sessions.
*/
function saveSessions(sessionFile, sessions) {
	if (sessionFile === void 0) return false;
	try {
		mkdirSync(dirname(sessionFile), { recursive: true });
		const payload = JSON.stringify({ version: 1, sessions: Object.fromEntries(sessions) });
		writeFileSync(sessionFile, payload, { mode: 0o600 });
		return true;
	} catch {
		return false;
	}
}

/** Parse the Cookie header into a name -> value map. */
function readCookies(req) {
	const raw = req.headers.cookie ?? "";
	const out = Object.create(null);
	for (const part of raw.split(";")) {
		const eq = part.indexOf("=");
		if (eq === -1) continue;
		const key = part.slice(0, eq).trim();
		const value = part.slice(eq + 1).trim();
		if (key !== "") out[key] = decodeURIComponent(value);
	}
	return out;
}

/** The session token carried by one request, or undefined. */
function sessionToken(req) {
	return readCookies(req)[COOKIE_NAME];
}

/** Chinese / English copy for the self-contained login page. */
const LOGIN_COPY = {
	zh: {
		lang: "zh-CN",
		title: "登录 — DeepSeek Harness",
		subtitle: "请输入访问密码",
		password: "密码",
		submit: "进入",
		invalid: "密码错误"
	},
	en: {
		lang: "en",
		title: "Sign in — DeepSeek Harness",
		subtitle: "Enter the access password",
		password: "Password",
		submit: "Enter",
		invalid: "Incorrect password"
	}
};

/** Prefer Chinese when the browser asks for it (Accept-Language), else English. */
function loginLanguage(req) {
	const header = req.headers["accept-language"] ?? "";
	return /(^|,)\s*zh([-;,]|$)/i.test(header) ? "zh" : "en";
}

/** Minimal self-contained login page (dark, no external assets). */
export function loginPage(error, lang = "zh") {
	const copy = LOGIN_COPY[lang === "en" ? "en" : "zh"];
	const message = error ? `<p class="error">${error}</p>` : "";
	return `<!doctype html>
<html lang="${copy.lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${copy.title}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #0d1117; color: #e6edf3; font: 15px/1.5 system-ui, "PingFang SC", "Microsoft YaHei", sans-serif; }
  .card { width: 340px; max-width: 92vw; background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 28px; }
  h1 { font-size: 17px; margin: 0 0 4px; }
  p.sub { margin: 0 0 20px; color: #8b949e; font-size: 13px; }
  label { display: block; margin: 12px 0 4px; font-size: 13px; color: #c9d1d9; }
  input { width: 100%; padding: 9px 11px; border-radius: 8px; border: 1px solid #30363d; background: #0d1117; color: #e6edf3; font-size: 14px; }
  input:focus { outline: 2px solid #2f81f7; border-color: transparent; }
  button { margin-top: 18px; width: 100%; padding: 10px; border: 0; border-radius: 8px; background: #238636; color: #fff; font-size: 15px; cursor: pointer; }
  button:hover { background: #2ea043; }
  .error { margin: 0 0 12px; color: #f85149; font-size: 13px; }
</style>
</head>
<body>
  <form class="card" method="post" action="/login">
    <h1>DeepSeek Harness</h1>
    <p class="sub">${copy.subtitle}</p>
    ${message}
    <label for="password">${copy.password}</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus />
    <button type="submit">${copy.submit}</button>
  </form>
</body>
</html>`;
}

/** Read a request body up to a size limit. */
async function readBody(req, limit = BODY_LIMIT) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > limit) throw new Error("body too large");
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString("utf8");
}

/**
* Wrap a running node:http server with the auth gate. Must be called exactly
* once per server. Removes the server's existing request/upgrade listeners
* (the ones the dsh webserver registered) and re-adds gated versions that
* delegate to the originals for authenticated requests.
* @param server - the `webServer` service's node:http server.
* @param auth - `{ password }` accepted at login.
* @param options - optional `{ sessionFile, clientBundlePath }`; `sessionFile`
* persists sessions across restarts, `clientBundlePath` (when resolvable)
* serves a patched dsh-client-connection bundle that forces the client's
* isLoopback flag, so the settings plane works for authenticated LAN pages.
*/
export function wrapServer(server, auth, options = {}) {
	const originalRequest = server.listeners("request")[0];
	const originalUpgrade = server.listeners("upgrade")[0];
	server.removeAllListeners("request");
	server.removeAllListeners("upgrade");

	/** Fail-safe patched client bundle (read once; original when unreadable/unpatchable). */
	let patchedBundle;
	const bundlePath = options.clientBundlePath;
	if (typeof bundlePath === "string" && bundlePath !== "" && existsSync(bundlePath)) {
		try {
			const original = readFileSync(bundlePath, "utf8");
			const result = patchConnectionBundle(original);
			patchedBundle = result.patched ? result.body : void 0;
		} catch {
			patchedBundle = void 0;
		}
	}

	/** Sessions: token -> issued-at epoch ms (loaded from disk when configured). */
	const sessions = loadSessions(options.sessionFile);
	/** Failed logins per remote address: { count, until }. */
	const failures = new Map();

	/** The loopback authority the authenticated request is rewritten to. */
	const loopbackAuthority = () => {
		const addr = server.address();
		const port = typeof addr === "object" && addr !== null ? addr.port : 3080;
		return `127.0.0.1:${port}`;
	};

	/** Rewrite Host/Origin so dsh's trust fence sees a loopback client. */
	const makeLoopback = (req) => {
		const authority = loopbackAuthority();
		req.headers.host = authority;
		if (req.headers.origin !== void 0) req.headers.origin = `http://${authority}`;
	};

	const rateLimited = (ip) => {
		const f = failures.get(ip);
		if (f === void 0) return false;
		if (f.until > Date.now()) return true;
		failures.delete(ip);
		return false;
	};
	const recordFailure = (ip) => {
		const f = failures.get(ip) ?? { count: 0, until: 0 };
		f.count += 1;
		if (f.count >= MAX_ATTEMPTS) {
			f.until = Date.now() + LOCKOUT_MS;
			f.count = 0;
		}
		failures.set(ip, f);
	};

	const handleLogin = async (req, res) => {
		const ip = req.socket.remoteAddress ?? "?";
		if (rateLimited(ip)) {
			res.writeHead(429, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: "too many attempts, try again later" }));
			return;
		}
		let body;
		try {
			body = await readBody(req);
		} catch {
			res.writeHead(400, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: "bad request" }));
			return;
		}
		const params = new URLSearchParams(body);
		const pass = params.get("password") ?? "";
		if (safeEqual(pass, auth.password)) {
			failures.delete(ip);
			const token = randomBytes(32).toString("hex");
			sessions.set(token, Date.now());
			if (!saveSessions(options.sessionFile, sessions)) {
				/* session persisted in memory only — a restart will log users out */
			}
			res.writeHead(302, {
				location: "/",
				"set-cookie": `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
			});
			res.end();
			return;
		}
		recordFailure(ip);
		res.writeHead(401, { "content-type": "text/html; charset=utf-8" });
		const lang = loginLanguage(req);
		res.end(loginPage(LOGIN_COPY[lang].invalid, lang));
	};

	const handleLogout = (req, res) => {
		const token = sessionToken(req);
		if (token !== void 0) sessions.delete(token);
		saveSessions(options.sessionFile, sessions);
		res.writeHead(302, {
			location: "/login",
			"set-cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`
		});
		res.end();
	};

	const isAuthenticated = (req) => {
		const token = sessionToken(req);
		return token !== void 0 && sessions.has(token);
	};

	server.on("request", (req, res) => {
		let pathname = "/";
		try {
			pathname = new URL(req.url ?? "/", "http://x").pathname;
		} catch {
			/* fall through with "/" */
		}
		if (req.method === "POST" && pathname === "/login") return void handleLogin(req, res);
		if (req.method === "POST" && pathname === "/logout") return void handleLogout(req, res);
		if (req.method === "GET" && pathname === "/login") {
			res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
			res.end(loginPage("", loginLanguage(req)));
			return;
		}
		if (!isAuthenticated(req)) {
			const wantsJson = pathname.startsWith("/api/") || (req.headers.accept ?? "").includes("application/json");
			if (wantsJson) {
				res.writeHead(401, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: "unauthorized" }));
			} else {
				res.writeHead(302, { location: "/login" });
				res.end();
			}
			return;
		}
		makeLoopback(req);
		// Serve the fail-safe patched connection bundle so the client's settings
		// plane treats this authenticated LAN page as loopback.
		if (patchedBundle !== void 0 && (req.method === "GET" || req.method === "HEAD") && pathname === CONNECTION_BUNDLE_PATHNAME) {
			res.writeHead(200, {
				"content-type": "text/javascript; charset=utf-8",
				"cache-control": "no-cache"
			});
			res.end(patchedBundle);
			return;
		}
		if (originalRequest !== void 0) originalRequest(req, res);
		else {
			res.writeHead(503);
			res.end();
		}
	});

	server.on("upgrade", (req, socket, head) => {
		if (!isAuthenticated(req)) {
			socket.destroy();
			return;
		}
		makeLoopback(req);
		if (originalUpgrade !== void 0) originalUpgrade(req, socket, head);
		else socket.destroy();
	});
}
