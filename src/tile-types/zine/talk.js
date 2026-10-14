// Which tiles talk (v0.31.0): a talking tile sends messages to the page it sits
// in (window.parent.postMessage), or uses the tile message protocol (data.js,
// sendData) or wishes (makeWish). The zine can only connect tiles that do; most
// tiles (sprites, lanterns, Treeline replays, ATMOSYNTH patches) play on their
// own. Checked Oct 14 against every tile in the owner's two accounts: the cube,
// the palette and both dice send; ATMOSYNTH only listens (for its own use) and
// Treeline and the Foundry's own types neither send nor listen. Zines carry a
// relay and talk to the Foundry's preview, so a zine never counts.
// Plan: claude/zine-v031-plan.md.

// Sending is what counts (listening alone is common for other reasons).
export const TALK_SIGNS = Object.freeze([
  /\b(?:parent|top|opener)\s*\.\s*postMessage\s*\(/,
  /web-tiles\/data\.js/,
  /\bsendData\s*\(/,
  /\bmakeWish\s*\(/,
]);
const CODE = /^\/$|\.(?:m?js|html?)$/i;
const MAX_SCAN = 4 * 1024 * 1024;
const decoder = new TextDecoder();
const seen = new WeakMap(); // files array -> true | false

/** Whether some text shows a tile sending messages to its page. */
export function textTalks(text) {
  const s = String(text || "");
  return TALK_SIGNS.some((re) => re.test(s));
}

/**
 * Whether a page's tile talks: true, false, or null while it isn't copied yet.
 * `piece` is a page's piece (piece.js): its files are the tile's own, as copied.
 */
export function tileTalks(piece) {
  if (!piece || piece.kind !== "tile" || !piece.uri) return false;
  // The Foundry's own types never talk; a zine relays, it isn't a talker.
  if (piece.typeId) return false;
  if (piece.status !== "ready" || !Array.isArray(piece.files)) return null;
  if (seen.has(piece.files)) return seen.get(piece.files);
  let talks = false;
  for (const f of piece.files) {
    if (!f || !CODE.test(f.path) || !f.bytes || f.bytes.length > MAX_SCAN) continue;
    if (textTalks(decoder.decode(f.bytes))) { talks = true; break; }
  }
  seen.set(piece.files, talks);
  return talks;
}

/**
 * Whether a pair still counts in the panel: both tiles talk, or the creator
 * paired them on purpose ("Pair it anyway…" / "Show all tiles": pairAnyway on
 * both pages). A tile still being copied (null) doesn't end a pair.
 */
export function pairQualifies(page, partner) {
  const a = tileTalks(page && page.piece), b = tileTalks(partner && partner.piece);
  if (a === null || b === null) return true;
  if (a && b) return true;
  return Boolean(page && page.pairAnyway && partner && partner.pairAnyway);
}
