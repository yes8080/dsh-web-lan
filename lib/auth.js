// Password gate for the dsh web server (single shared password, no multi-user).
//
// Wraps the node:http server's request/upgrade handling: unauthenticated
// callers get a login page / 401 (browsers) or a destroyed socket (WS);
// authenticated callers pass through with Host/Origin rewritten to the
// loopback authority, so dsh's trust fence treats them as local clients.
// Sessions persist to ~/.dsh/dsh-lan-sessions.json (restart-safe); tokens are
// random 256-bit, cookie HttpOnly + SameSite=Strict, per-IP lockout after 5
// failures for 30s. The login page follows Accept-Language (zh/en) — it is
// pre-auth, so the General settings language is not available there.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CONNECTION_BUNDLE_PATHNAME, patchConnectionBundle } from "./client-patch.js";

export const COOKIE_NAME = "dsh_lan_session";
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30_000;
const BODY_LIMIT = 8192;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Constant-time comparison via sha256. */
function safeEqual(a, b) {
	return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

/** Load persisted sessions (token -> issued-at); any failure -> empty Map. */
function loadSessions(sessionFile) {
	if (sessionFile === void 0 || !existsSync(sessionFile)) return new Map();
	try {
		const entries = JSON.parse(readFileSync(sessionFile, "utf8"))?.sessions ?? {};
		const now = Date.now();
		const map = new Map();
		for (const [token, createdAt] of Object.entries(entries)) {
			if (typeof token === "string" && token.length >= 32 && typeof createdAt === "number" && now - createdAt < SESSION_TTL_MS) map.set(token, createdAt);
		}
		return map;
	} catch {
		return new Map();
	}
}

/** Persist sessions (0600, atomic write); failures degrade to in-memory-only. */
function saveSessions(sessionFile, sessions) {
	if (sessionFile === void 0) return false;
	try {
		mkdirSync(dirname(sessionFile), { recursive: true });
		const payload = JSON.stringify({ version: 1, sessions: Object.fromEntries(sessions) });
		const tmp = `${sessionFile}.tmp`;
		writeFileSync(tmp, payload, { mode: 0o600 });
		renameSync(tmp, sessionFile);
		return true;
	} catch {
		return false;
	}
}

/** Parse the Cookie header into a name -> value map. */
function readCookies(req) {
	const out = Object.create(null);
	for (const part of (req.headers.cookie ?? "").split(";")) {
		const eq = part.indexOf("=");
		if (eq === -1) continue;
		out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
	}
	return out;
}

const sessionToken = (req) => readCookies(req)[COOKIE_NAME];

/** zh/en copy for the self-contained login page. */
const LOGIN_COPY = {
	zh: { lang: "zh-CN", title: "登录 — DeepSeek Harness", subtitle: "请输入访问密码", password: "密码", submit: "进入", invalid: "密码错误" },
	en: { lang: "en", title: "Sign in — DeepSeek Harness", subtitle: "Enter the access password", password: "Password", submit: "Enter", invalid: "Incorrect password" }
};

const loginLanguage = (req) => (/(^|,)\s*zh([-;,]|$)/i.test(req.headers["accept-language"] ?? "") ? "zh" : "en");

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
  :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0d1117;color:#e6edf3;font:15px/1.5 system-ui,"PingFang SC","Microsoft YaHei",sans-serif}.card{width:340px;max-width:92vw;background:#161b22;border:1px solid #30363d;border-radius:12px;padding:28px}h1{font-size:17px;margin:0 0 4px}p.sub{margin:0 0 20px;color:#8b949e;font-size:13px}label{display:block;margin:12px 0 4px;font-size:13px;color:#c9d1d9}input{width:100%;padding:9px 11px;border-radius:8px;border:1px solid #30363d;background:#0d1117;color:#e6edf3;font-size:14px}input:focus{outline:2px solid #2f81f7;border-color:transparent}button{margin-top:18px;width:100%;padding:10px;border:0;border-radius:8px;background:#238636;color:#fff;font-size:15px;cursor:pointer}button:hover{background:#2ea043}.error{margin:0 0 12px;color:#f85149;font-size:13px}
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
* Wrap the server with the auth gate (call once). Removes the existing
* request/upgrade listeners and re-adds gated versions delegating to the
* originals; returns a disposer that restores them on unload.
* @param server - the `webServer` service's node:http server.
* @param auth - `{ password }` accepted at login (mutable: the settings bridge
* updates it live).
* @param options - `{ sessionFile, clientBundlePath }` — the bundle patch
* makes the client settings plane treat authenticated LAN pages as loopback.
*/
export function wrapServer(server, auth, options = {}) {
	const originalRequest = server.listeners("request")[0];
	const originalUpgrade = server.listeners("upgrade")[0];
	server.removeAllListeners("request");
	server.removeAllListeners("upgrade");

	// Fail-safe patched connection bundle (read once; original when unreadable).
	let patchedBundle;
	const bundlePath = options.clientBundlePath;
	if (typeof bundlePath === "string" && bundlePath !== "" && existsSync(bundlePath)) {
		try {
			const result = patchConnectionBundle(readFileSync(bundlePath, "utf8"));
			patchedBundle = result.patched ? result.body : void 0;
		} catch {
			patchedBundle = void 0;
		}
	}

	const sessions = loadSessions(options.sessionFile);
	const failures = new Map();
	/** Session of the most recent settings write — the password changer. */
	let lastMutateToken;

	// Kicks every session except the one that just changed the password (the
	// only settings write that can change it is a /api/settings.mutate, and the
	// password bridge calls this right after the triggering mutate passes the
	// gate). Leaked sessions die with the password; the changer stays logged in.
	auth.invalidateSessions ??= () => {
		const keep = lastMutateToken !== void 0 && sessions.has(lastMutateToken) ? lastMutateToken : void 0;
		sessions.clear();
		if (keep !== void 0) sessions.set(keep, Date.now());
		saveSessions(options.sessionFile, sessions);
	};

	const loopbackAuthority = () => {
		const addr = server.address();
		return `127.0.0.1:${typeof addr === "object" && addr !== null ? addr.port : 3080}`;
	};
	// Rewrite Host/Origin so dsh's trust fence sees a loopback client.
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
		if (safeEqual(new URLSearchParams(body).get("password") ?? "", auth.password)) {
			failures.delete(ip);
			const token = randomBytes(32).toString("hex");
			sessions.set(token, Date.now());
			saveSessions(options.sessionFile, sessions);
			res.writeHead(302, {
				location: "/",
				"set-cookie": `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
			});
			res.end();
			return;
		}
		recordFailure(ip);
		const lang = loginLanguage(req);
		res.writeHead(401, { "content-type": "text/html; charset=utf-8" });
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

	const requestHandler = (req, res) => {
		const pathname = (() => {
			try {
				return new URL(req.url ?? "/", "http://x").pathname;
			} catch {
				return "/";
			}
		})();
		if (req.method === "POST" && pathname === "/login") return void handleLogin(req, res);
		if (req.method === "POST" && pathname === "/logout") return void handleLogout(req, res);
		if (req.method === "GET" && pathname === "/login") {
			res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
			res.end(loginPage("", loginLanguage(req)));
			return;
		}
		if (!isAuthenticated(req)) {
			const wantsJson = pathname.startsWith("/api/") || (req.headers.accept ?? "").includes("application/json");
			res.writeHead(wantsJson ? 401 : 302, { "content-type": "application/json", ...wantsJson ? {} : { location: "/login" } });
			res.end(wantsJson ? JSON.stringify({ error: "unauthorized" }) : "");
			return;
		}
		// Remember the session that writes settings — the password changer keeps
		// its session when invalidateSessions fires right after the write.
		if (req.method === "POST" && pathname === "/api/settings.mutate") {
			const token = sessionToken(req);
			if (token !== void 0) lastMutateToken = token;
		}
		makeLoopback(req);
		// Serve the patched connection bundle so the settings plane sees loopback.
		if (patchedBundle !== void 0 && (req.method === "GET" || req.method === "HEAD") && pathname === CONNECTION_BUNDLE_PATHNAME) {
			res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" });
			res.end(patchedBundle);
			return;
		}
		if (originalRequest !== void 0) originalRequest(req, res);
		else {
			res.writeHead(503);
			res.end();
		}
	};

	const upgradeHandler = (req, socket, head) => {
		if (!isAuthenticated(req)) {
			socket.destroy();
			return;
		}
		makeLoopback(req);
		if (originalUpgrade !== void 0) originalUpgrade(req, socket, head);
		else socket.destroy();
	};

	server.on("request", requestHandler);
	server.on("upgrade", upgradeHandler);

	// Disposer: restore the original listeners so the plugin is fully
	// reversible when it unloads (disable/update/uninstall, even without a restart).
	return () => {
		server.removeListener("request", requestHandler);
		server.removeListener("upgrade", upgradeHandler);
		if (originalRequest !== void 0) server.on("request", originalRequest);
		if (originalUpgrade !== void 0) server.on("upgrade", originalUpgrade);
	};
}
