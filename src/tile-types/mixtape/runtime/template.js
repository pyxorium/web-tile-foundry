import { TILE_CSP_META } from "../../../core/policy.js";
import { PLAYER_CSS } from "./player-css.js";

// The Mixtape tile's page: the tape (the same object as /tape.json) as JSON,
// the player's look, and the player program itself (runtime/bundle.js), built
// into the page so the tape draws as soon as the page arrives, with no second
// file to wait for. Until the player starts, the label strip (in the tape's own
// colors) says "Loading mixtape…". The songs are separate files, each
// downloaded only when it is played. No network: everything the tile needs is
// inside the tile.
//
// (Tapes made before Oct 7 2026 load the player as a separate /mixtape.js; the
// revise script brings them up to this page.)

export const LOADING_TEXT = "Loading mixtape…";

export const MAKE_URL = "https://foundry.thunderbird.cafe/";
export const CONFIG_VERSION = 1;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** JSON that is safe to place inside a <script> element. */
function scriptJson(value) {
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  return JSON.stringify(value).replace(/</g, "\\u003c").split(LS).join("\\u2028").split(PS).join("\\u2029");
}

/** The config the page carries (see runtime/tile-main.js). `tape` is the tape.json object; `artwork` a picture path for the lock screen, or null. */
export function mixtapeConfig({ tape, artwork = null }) {
  return { version: CONFIG_VERSION, makeUrl: MAKE_URL, artwork, tape };
}

/** The player program, safe to place inside a <script> element. */
export function inlineScript(code) {
  if (typeof code !== "string" || !code) throw new Error("The tape's player is missing.");
  if (/<\/script|<!--/i.test(code)) throw new Error("The tape's player can't be built into the page (it contains </script or <!--).");
  return code;
}

/** The tape's label colors as a style attribute value ("" when it has none); hex colors only. */
function colorStyle(tape) {
  const colors = (tape && tape.label && tape.label.colors) || {};
  const HEX = /^#[0-9a-f]{6}$/i;
  const pairs = [["--label", colors.paper], ["--label-ink", colors.ink], ["--stripe1", colors.stripe1], ["--stripe2", colors.stripe2], ["--accent", colors.stripe2]];
  return pairs.filter(([, c]) => typeof c === "string" && HEX.test(c)).map(([v, c]) => `${v}: ${c}`).join("; ");
}

export function renderMixtapeHtml({ title, config, runtime }) {
  const style = colorStyle(config && config.tape);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
${TILE_CSP_META}
<meta name="referrer" content="no-referrer" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<!-- Made with the Web Tile Foundry (mixtape). Track list: /tape.json. Recipe: /foundry.json -->
<style>
html, body { margin: 0; width: 100%; height: 100%; }
body { overflow: hidden; }
${PLAYER_CSS}
</style>
</head>
<body>
<div id="mixtape" class="mt"${style ? ` style="${style}"` : ""}><header class="mt-head"><p class="mt-label">${LOADING_TEXT}</p></header></div>
<script type="application/json" id="mixtape-config">${scriptJson(config)}</script>
<script>${inlineScript(runtime)}</script>
</body>
</html>
`;
}
