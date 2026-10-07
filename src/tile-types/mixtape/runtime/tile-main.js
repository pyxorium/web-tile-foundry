import { mountPlayer } from "./player.js";

// The program in every Mixtape tile (built into its page): reads the tape from the
// page (the same object as /tape.json) and starts the player. Songs are
// fetched from the tile itself, one at a time, as they are played.
//
// Restarting (Try again on a song stuck loading): the page notes the song in
// its address (#cue=<side>.<index>) and reloads itself; on the fresh start
// that song is cued and the note is taken off again.

const CUE = /^#cue=(\d{1,2})\.(\d{1,3})$/;

function takeCue() {
  const m = CUE.exec(location.hash || "");
  if (!m) return null;
  try {
    history.replaceState(null, "", location.pathname + location.search);
  } catch {
    /* fine: the note stays in the address */
  }
  return { side: Number(m[1]), index: Number(m[2]) };
}

function restart({ side, index }) {
  try {
    history.replaceState(null, "", `${location.pathname}${location.search}#cue=${side}.${index}`);
  } catch {
    /* restart without cueing the song */
  }
  location.reload();
}

function start() {
  const root = document.getElementById("mixtape");
  const node = document.getElementById("mixtape-config");
  let config = null;
  try {
    config = JSON.parse(node.textContent);
  } catch {
    config = null;
  }
  if (!config || !config.tape) {
    root.textContent = "This tape's track list is missing.";
    return;
  }
  mountPlayer(root, { tape: config.tape, artwork: config.artwork || null, makeUrl: config.makeUrl || null, restart, resume: takeCue() });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
