import { mountPlayer } from "./runtime/player.js";
import { PLAYER_CSS } from "./runtime/player-css.js";
import { TAPE_PATH } from "./tape.js";

// The Foundry's preview of a tape: the tile's own player, run in the Foundry
// page, playing the built tile's files straight from memory. What it shows
// and plays is exactly what would be published (the same tape.json, the same
// song files with their transitions baked in).
//
// mountPreview(element, { result }) -> { update(result), dispose() }
// `result` is a built tile (buildTile in src/core/build.js) or null.

let styled = false;
function addStyles() {
  if (styled) return;
  styled = true;
  const style = document.createElement("style");
  style.dataset.mixtape = "player";
  style.textContent = PLAYER_CSS;
  document.head.append(style);
}

/** The tape inside a built tile (its /tape.json). */
export function tapeOf(result) {
  const file = result && result.files.find((f) => f.path === TAPE_PATH);
  return file ? JSON.parse(new TextDecoder().decode(file.bytes)) : null;
}

export function mountPreview(element, { result = null } = {}) {
  addStyles();
  const box = document.createElement("div");
  box.className = "mixtape-preview";
  box.style.height = "400px"; // the embed box height on the blog and webtil.es
  element.replaceChildren(box);
  let player = null;
  let shown = null;

  function update(next) {
    if (next === shown) return;
    shown = next;
    if (player) player.dispose();
    player = null;
    const tape = tapeOf(next);
    if (!tape) {
      box.textContent = "Your tape will appear here once it has songs.";
      return;
    }
    const files = new Map(next.files.map((f) => [f.path, f]));
    player = mountPlayer(box, {
      tape,
      mediaSession: false,
      async getBlob(path) {
        const f = files.get(path);
        if (!f) throw new Error(`${path} isn't in the tile`);
        return new Blob([f.bytes], { type: f.contentType });
      },
    });
  }

  update(result);
  return {
    update,
    player: () => player,
    dispose() {
      if (player) player.dispose();
      player = null;
      element.replaceChildren();
    },
  };
}
