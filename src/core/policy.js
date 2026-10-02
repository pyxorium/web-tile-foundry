// The security policy every tile carries.
//
// It goes in two places: as a <meta http-equiv="Content-Security-Policy"> in the
// tile's own HTML, and (at publish time) as the manifest's
// "content-security-policy" header on the "/" resource. The tile loader does not
// impose a policy on the tile's own document, so the meta tag is what actually
// protects a tile shown outside a cooperating host.
//
// Text copied from the proven die tiles (tile.template.html). Note the spec's
// own list says "form-src"; the real directive is "form-action".

export const TILE_CSP =
  "default-src 'self' blob: data:; " +
  "script-src 'self' blob: data: 'unsafe-inline' 'wasm-unsafe-eval'; " +
  "script-src-attr 'none'; " +
  "style-src 'self' blob: data: 'unsafe-inline'; " +
  "form-action 'none'; manifest-src 'none'; object-src 'none'; base-uri 'none';";

export const TILE_CSP_META =
  `<meta http-equiv="Content-Security-Policy" content="${TILE_CSP}" />`;

/** Pulls the policy back out of a tile's HTML (null if it has none). */
export function readCspMeta(html) {
  const m = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i.exec(html);
  return m ? m[1] : null;
}
