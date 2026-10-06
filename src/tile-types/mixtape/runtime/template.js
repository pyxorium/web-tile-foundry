import { TILE_CSP_META } from "../../../core/policy.js";
import { RUNTIME_PATH } from "./paths.js";
import { PLAYER_CSS } from "./player-css.js";

// The Mixtape tile's page: the tape (the same object as /tape.json) as JSON,
// the player's look, and one script tag for the player (/mixtape.js, the same
// in every tile). The songs are separate files, each downloaded only when it
// is played. No network: everything the tile needs is inside the tile.

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

export function renderMixtapeHtml({ title, config }) {
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
<div id="mixtape" class="mt"></div>
<script type="application/json" id="mixtape-config">${scriptJson(config)}</script>
<script src="${RUNTIME_PATH}"></script>
</body>
</html>
`;
}
