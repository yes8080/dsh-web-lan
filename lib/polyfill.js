// crypto.randomUUID polyfill injection for dsh's served index.html.
//
// The dsh browser client calls crypto.randomUUID() for every RPC id and
// message id (dsh-client-connection's AbstractApiClient.mintRpcId and
// createMessage). Per the Web Crypto spec that API exists only in *secure
// contexts* (HTTPS or localhost); over plain HTTP on a LAN IP it is
// undefined, so the whole /api layer fails with
// "crypto.randomUUID is not a function". We inject an inline classic script
// that defines it from crypto.getRandomValues (available on insecure
// origins) before the app bundle executes.

/** Inline classic script defining crypto.randomUUID when the browser lacks it. */
export function polyfillScript() {
	return `<script>(function () {
  if (typeof crypto.randomUUID === 'function') return;
  try {
    crypto.randomUUID = function () {
      var b = crypto.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 15) | 64;
      b[8] = (b[8] & 63) | 128;
      var hex = '';
      for (var i = 0; i < 16; i++) {
        hex += b[i].toString(16).padStart(2, '0');
        if (i === 3 || i === 5 || i === 7 || i === 9) hex += '-';
      }
      return hex;
    };
  } catch (e) {}
})()<\/script>`;
}

/**
* Insert the polyfill right after the opening body tag, so it executes during
* HTML parsing — before the deferred module bundle that reads
* window.__DSH_BOOT__ and calls crypto.randomUUID.
* @param html - Raw application index HTML.
* @returns HTML containing the polyfill (idempotent).
*/
export function injectPolyfill(html) {
	if (html.includes("crypto.randomUUID")) return html;
	const script = polyfillScript();
	const body = /<body(?:\s[^>]*)?>/i.exec(html);
	if (body === null) return `${html}${script}`;
	const at = body.index + body[0].length;
	return `${html.slice(0, at)}${script}${html.slice(at)}`;
}
