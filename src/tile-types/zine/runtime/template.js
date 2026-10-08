import { TILE_CSP_META } from "../../../core/policy.js";
import { READER_CSS, READER_JS } from "./reader.js";

// The zine tile's page: the zine (config JSON), the reader's styles and the
// reader program, all in one page. Pictures are separate files in the tile
// (/pictures/...), loaded by the page as it shows them. No network: everything
// the tile needs is inside the tile.

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** JSON that is safe to place inside a <script> element. */
export function scriptJson(value) {
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  return JSON.stringify(value).replace(/</g, "\\u003c").split(LS).join("\\u2028").split(PS).join("\\u2029");
}

/** `extraScript`: more program for the page (the Foundry's preview adds its decorating tools). */
export function renderZineHtml({ title, config, extraScript = "" }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
${TILE_CSP_META}
<meta name="referrer" content="no-referrer" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>${READER_CSS}</style>
</head>
<body>
<main id="zine" aria-label="${escapeHtml(title)}"></main>
<script type="application/json" id="zine-config">${scriptJson(config)}</script>
<script>${READER_JS}</script>${extraScript ? `\n<script>${extraScript}</script>` : ""}
</body>
</html>
`;
}
