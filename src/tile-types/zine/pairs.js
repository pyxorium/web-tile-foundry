// Tiles that talk (v0.29.0): two "A web tile" pages of one zine can be paired,
// and the zine's reader passes messages between their tiles (a wish and its
// grant, two dice sharing one roll). Plan: claude/zine-wish-pairs-plan.md.
//
// A pair is kept on both pages: page.talksTo is the partner page's id, and each
// page may have a shortName ("Bob", about 20 characters) that the reader's
// captions use ("Go to Bob's tile (p. 1)"). Setting it on one page sets both
// (pairChanges). A pair only counts while it is mutual and both pages are in
// use and show a tile (tilePairs); otherwise it is quietly ignored, so taking
// the tile off a page or putting the page aside ends it without a problem.
// Plain functions, no browser: the panel (tilepanel.js), the reader's config
// (pages.js) and the recipe (tile.js) all use them.

export const SHORT_NAME_MAX = 20;

/** A short name made safe: one line, at most SHORT_NAME_MAX characters. */
export function cleanShortName(s) {
  return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, SHORT_NAME_MAX).trim();
}

/** Whether a page shows a tile (an "A web tile" page with one of your tiles chosen). */
export function showsTile(page) {
  return Boolean(page && page.layout === "tile" && page.piece && page.piece.kind === "tile" && page.piece.uri);
}

/**
 * The pairs that count: Map page id -> partner page id (both directions).
 * `specs` are the page specs in use and `pages` their pages, in the same order
 * (pagesFor / pagesInUse in pages.js). Only mutual pairs of two tile pages.
 */
export function tilePairs(specs, pages) {
  const byId = new Map();
  (specs || []).forEach((spec, i) => byId.set(spec.id, (pages || [])[i] || null));
  const out = new Map();
  for (const [id, page] of byId) {
    const to = page && typeof page.talksTo === "string" ? page.talksTo : "";
    if (!to || to === id || !byId.has(to)) continue;
    const other = byId.get(to);
    if (!showsTile(page) || !showsTile(other) || other.talksTo !== id) continue;
    out.set(id, to);
  }
  return out;
}

/**
 * The changes that pair page `a` with page `b` (or, with b empty, end a's pair):
 * { [page id]: change }. Whoever either of them talked to before is let go,
 * so each tile has at most one partner. Short names stay with their pages.
 */
export function pairChanges(pages, a, b) {
  const list = Array.isArray(pages) ? pages : [];
  const find = (id) => list.find((p) => p && p.id === id) || null;
  const changes = {};
  const letGo = (id, keep) => {
    const p = find(id);
    const old = p && typeof p.talksTo === "string" ? p.talksTo : "";
    if (old && old !== keep) {
      const q = find(old);
      if (q && q.talksTo === id) changes[old] = { talksTo: null };
    }
  };
  if (!a || a === b) return changes;
  letGo(a, b || "");
  if (b) {
    letGo(b, a);
    changes[a] = { talksTo: b };
    changes[b] = { talksTo: a };
  } else {
    changes[a] = { talksTo: null };
  }
  return changes;
}
