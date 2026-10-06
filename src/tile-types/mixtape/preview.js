import { mountPlayer } from "./runtime/player.js";
import { PLAYER_CSS } from "./runtime/player-css.js";
import { TAPE_PATH } from "./tape.js";

// The Foundry's preview of a tape: the tile's own player, run in the Foundry
// page, playing the built tile's files straight from memory. What it shows
// and plays is exactly what would be published (the same tape.json, the same
// song files with their transitions baked in).
//
// mountPreview(element, { result }) -> { update(values, result), dispose() }
// `result` is the latest built tile (buildTile in src/core/build.js) or null.
// The tile is rebuilt after every change (typing in the notes, too); if a song
// was playing and is still on the tape unchanged, it carries on from where it was.

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

/** Where song `cid` is on the tape: { side, index } or null. */
export function findSong(tape, cid) {
  const sides = (tape && tape.sides) || [];
  for (let side = 0; side < sides.length; side++) {
    const index = sides[side].tracks.findIndex((t) => t.cid === cid);
    if (index >= 0) return { side, index };
  }
  return null;
}

export function mountPreview(element, { result = null } = {}) {
  addStyles();
  const box = document.createElement("div");
  box.className = "mixtape-preview";
  box.style.height = "400px"; // the embed box height on the blog and webtil.es
  element.append(box); // alongside, not replacing (see dispose)
  let player = null;
  let shownTape = null;
  let shown;

  function update(next) {
    if (next === shown) return;
    shown = next;
    // What was playing, to carry on with.
    let resume = null;
    if (player && shownTape) {
      const st = player.state();
      if (st.playing && st.side != null) {
        const t = shownTape.sides[st.side] && shownTape.sides[st.side].tracks[st.index];
        if (t) resume = { cid: t.cid, time: st.time };
      }
    }
    if (player) player.dispose();
    player = null;
    const tape = tapeOf(next);
    shownTape = tape;
    if (!tape) {
      box.className = "mixtape-preview mixtape-preview-empty";
      box.textContent = "Your tape will appear here once its songs are ready.";
      return;
    }
    box.className = "mixtape-preview";
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
    const at = resume && findSong(tape, resume.cid);
    if (at) player.play(at.side, at.index, resume.time);
  }

  update(result);
  return {
    // Called as update(values, result) by the Foundry, or update(result).
    update(a, b) {
      update(arguments.length > 1 ? b : a && a.files ? a : shown);
    },
    player: () => player,
    dispose() {
      if (player) player.dispose();
      player = null;
      // Only this preview's own box: in development React mounts previews
      // twice, and a late dispose of the first must not empty the second.
      box.remove();
    },
  };
}
