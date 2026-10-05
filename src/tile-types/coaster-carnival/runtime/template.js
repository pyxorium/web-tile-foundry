import { TILE_CSP_META } from "../../../core/policy.js";
import { THEME_IDS, DEFAULT_THEME } from "../ride/themes.js";
import { STEEL_SCHEMES, WOOD_FINISHES, CART_COLORS, DEFAULT_COLORS } from "../ride/colors.js";
import { RUNTIME_PATH } from "./paths.js";

// The Coaster Carnival tile's page: the creator's choices, the finished track
// and the rider's sprite as JSON, and one script tag for the program
// (/coaster.js, the same in every tile). No network: everything the tile
// needs is inside the tile.

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

const HANDLE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
const pick = (list, id, fallback) => (list.some((x) => x.id === id) ? id : fallback);

/**
 * Only known choices, each checked, so a tile never carries anything
 * unexpected: { theme, style, colors: { steel, wood, cart }, tunnel, handle }.
 */
export function cleanChoices(choices = {}) {
  const colors = choices.colors || {};
  const handle = typeof choices.handle === "string" && choices.handle.length <= 253 && HANDLE.test(choices.handle) ? choices.handle.toLowerCase() : null;
  return {
    theme: THEME_IDS.includes(choices.theme) ? choices.theme : DEFAULT_THEME,
    style: choices.style === "wood" ? "wood" : "steel",
    colors: {
      steel: pick(STEEL_SCHEMES, colors.steel, DEFAULT_COLORS.steel),
      wood: pick(WOOD_FINISHES, colors.wood, DEFAULT_COLORS.wood),
      cart: pick(CART_COLORS, colors.cart, DEFAULT_COLORS.cart),
    },
    tunnel: choices.tunnel !== false,
    handle,
  };
}

/** The config the page carries (see runtime/tile-main.js). `track` is packed (track-data.js); `sprite` a PNG data URI or null. */
export function coasterConfig({ choices, track, sprite }) {
  if (sprite !== null && !(typeof sprite === "string" && sprite.startsWith("data:image/png;base64,"))) throw new Error("The rider must be a PNG picture.");
  return { version: CONFIG_VERSION, ...cleanChoices(choices), makeUrl: MAKE_URL, sprite, track };
}

export function renderCoasterHtml({ title, config }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
${TILE_CSP_META}
<meta name="referrer" content="no-referrer" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<!-- Made with the Web Tile Foundry (coaster-carnival). Recipe: /foundry.json -->
<style>
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #10131c; }
  body { position: relative; }
  .note { position: fixed; left: 16px; right: 16px; top: 40%; margin: 0; text-align: center;
    font: 15px system-ui, sans-serif; color: #ffffff; }
</style>
</head>
<body>
<script type="application/json" id="coaster-config">${scriptJson(config)}</script>
<script src="${RUNTIME_PATH}"></script>
</body>
</html>
`;
}
