import { mountPlayer } from "./player.js";

// The program in every Mixtape tile (/mixtape.js): reads the tape from the
// page (the same object as /tape.json) and starts the player. Songs are
// fetched from the tile itself, one at a time, as they are played.

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
  mountPlayer(root, { tape: config.tape, artwork: config.artwork || null, makeUrl: config.makeUrl || null });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
