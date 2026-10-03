import { TILE_CSP_META } from "../../../core/policy.js";
import { DEFAULT_SETTINGS } from "../lantern/settings.js";
import { RUNTIME_PATH } from "./paths.js";

// The Glass Lantern tile's page. It is small: the look and the shape as JSON,
// and one script tag for the program (/lantern.js, the same in every tile).
// No network: everything the tile needs is inside the tile.

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** JSON that is safe to place inside a <script> element. */
function scriptJson(value) {
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  return JSON.stringify(value).replace(/</g, "\\u003c").split(LS).join("\\u2028").split(PS).join("\\u2029");
}

/**
 * Only known look settings, each the same kind of value as its default, so a
 * tile never carries anything unexpected.
 */
export function cleanLook(look = {}) {
  const out = {};
  for (const [key, def] of Object.entries(DEFAULT_SETTINGS)) {
    if (!(key in look)) continue;
    const v = look[key];
    if (Array.isArray(def)) {
      if (Array.isArray(v) && v.length && v.every((c) => typeof c === "string")) out[key] = [...v];
    } else if (typeof v === typeof def && (typeof v !== "number" || Number.isFinite(v))) {
      out[key] = v;
    }
  }
  return out;
}

/** The config the page carries (see runtime/tile-main.js). */
export function lanternConfig({ shape, colours, look, slowTurn = true }) {
  return {
    version: 1,
    shape: { vertices: shape.vertices, faces: shape.faces },
    colours: colours || null,
    look: cleanLook(look),
    slowTurn: Boolean(slowTurn),
  };
}

export function renderLanternHtml({ title, config }) {
  const bg = /^#[0-9a-f]{6}$/i.test(config.look.bgBottom || "") ? config.look.bgBottom : "#0e0907";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
${TILE_CSP_META}
<meta name="referrer" content="no-referrer" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<!-- Made with the Web Tile Foundry (glass-lantern). Recipe: /foundry.json -->
<style>
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: ${bg}; }
  canvas.lantern { position: fixed; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; outline: none; }
  canvas.lantern:active { cursor: grabbing; }
  canvas.lantern:focus-visible { box-shadow: inset 0 0 0 2px #f4e9d6; }
  .note { position: fixed; left: 16px; right: 16px; bottom: 16px; margin: 0; text-align: center;
    font: 14px system-ui, sans-serif; color: #f4e9d6; }
</style>
</head>
<body>
<script type="application/json" id="lantern-config">${scriptJson(config)}</script>
<script src="${RUNTIME_PATH}"></script>
</body>
</html>
`;
}
