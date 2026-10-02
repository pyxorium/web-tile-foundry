import { TILE_CSP_META } from "../../core/policy.js";
import { paintShadow } from "./shadow.js";
import { runSpriteWalker } from "./walker-runtime.js";

// Renders the sprite-walker tile's single HTML page. Everything it needs is
// inside this one file: the sprite sheet is inlined as a data: URI, so the tile
// works on any page with no network access at all. Only the background the
// creator chose is included.

export const MOTION_OPTIONS = Object.freeze([
  { value: "none", label: "No motion" },
  { value: "forward", label: "Walking forward" },
  { value: "backforth", label: "Back and forth" },
]);

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
 * A function's source as an expression that can be pasted into the tile.
 * Normally "function (...) {...}"; a minifier may turn an object's function
 * into method shorthand "name(...) {...}", which needs wrapping to stay valid.
 */
export function functionSource(fn) {
  const src = fn.toString();
  if (/^(async\s+)?function\b/.test(src) || /^\(?[\w\s,]*\)?\s*=>/.test(src)) return src;
  return `({ ${src} })[${JSON.stringify(fn.name)}]`;
}

export function renderTileHtml({ title, sheetDataUri, frameWidth, frameHeight, startMotion, scene }) {
  const config = { sheet: sheetDataUri, frameWidth, frameHeight, startMotion, background: scene.id, groundRatio: scene.groundRatio };
  const radios = MOTION_OPTIONS.map(
    (o) => `      <label><input type="radio" name="motion" value="${o.value}" /> ${escapeHtml(o.label)}</label>`
  ).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
${TILE_CSP_META}
<meta name="referrer" content="no-referrer" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<!-- Made with the Web Tile Foundry (sprite-walker, background: ${escapeHtml(scene.id)} v${scene.version}). Recipe: /foundry.json -->
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #222;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  #stage { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
  #gear { position: fixed; top: 10px; right: 10px; width: 38px; height: 38px; border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.28); background: rgba(20,22,48,0.55); color: #f3eee6;
    font-size: 18px; line-height: 1; cursor: pointer; display: flex; align-items: center; justify-content: center; }
  #gear:hover { background: rgba(20,22,48,0.8); }
  #gear:focus-visible, #menu input:focus-visible { outline: 2px solid #ffd27a; outline-offset: 2px; }
  #menu { position: fixed; top: 56px; right: 10px; min-width: 190px; padding: 10px 12px 8px;
    border-radius: 12px; border: 1px solid rgba(255,255,255,0.22); background: rgba(16,17,38,0.94);
    color: #f3eee6; font-size: 14px; box-shadow: 0 8px 24px rgba(0,0,0,0.35); }
  #menu[hidden] { display: none; }
  #menu h2 { margin: 0 0 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em;
    text-transform: uppercase; color: #ffd27a; }
  #menu label { display: flex; align-items: center; gap: 8px; padding: 5px 2px; cursor: pointer; }
  #menu input { accent-color: #ffd27a; margin: 0; }
</style>
</head>
<body>
  <canvas id="stage" aria-label="${escapeHtml(title)}" role="img"></canvas>
  <button id="gear" type="button" aria-label="Motion settings" aria-haspopup="true" aria-expanded="false">⚙</button>
  <div id="menu" hidden>
    <h2>Motion</h2>
    <fieldset style="border:0;margin:0;padding:0">
      <legend style="position:absolute;left:-9999px">Motion</legend>
${radios}
    </fieldset>
  </div>
<script>
(${functionSource(runSpriteWalker)})(${scriptJson(config)}, ${functionSource(scene.paint)}, ${functionSource(paintShadow)});
</script>
</body>
</html>
`;
}
