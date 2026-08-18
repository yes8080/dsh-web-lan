// crypto.randomUUID polyfill: the dsh browser client calls it for every
// RPC/message id, but it only exists in secure contexts (HTTPS/localhost).
// Over plain HTTP on a LAN IP it is undefined and the whole /api layer fails.

/** Inline script defining crypto.randomUUID from getRandomValues (available on insecure origins). */
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

/** Insert the polyfill right after <body>, before the deferred app bundle runs. */
export function injectPolyfill(html) {
	if (html.includes("crypto.randomUUID")) return html;
	const body = /<body(?:\s[^>]*)?>/i.exec(html);
	if (body === null) return `${html}${polyfillScript()}`;
	const at = body.index + body[0].length;
	return `${html.slice(0, at)}${polyfillScript()}${html.slice(at)}`;
}
