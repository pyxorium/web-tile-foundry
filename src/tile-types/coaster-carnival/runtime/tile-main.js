import { mountCoaster } from "../ride/mount.js";
import { unpackTrack } from "./track-data.js";

// The Coaster Carnival tile's program. It is bundled (with three.js) into one
// file, /coaster.js, which is the same in every Coaster Carnival tile; what
// makes each tile different is the config in its page:
//
//   <script type="application/json" id="coaster-config">
//     { "version": 1, "theme": "day", "style": "steel",
//       "colors": { "steel": "...", "wood": "...", "cart": "..." },
//       "tunnel": true, "handle": "alice.example", "makeUrl": "https://...",
//       "sprite": "data:image/png;base64,...", "track": { ...packed track } }
//   </script>
//
// The whole tile is the ride's box (see ride/mount.js for everything it does:
// the controls, sound, pausing out of view, recovering from a graphics crash).

function readConfig() {
  const el = document.getElementById("coaster-config");
  const config = JSON.parse(el.textContent);
  if (config.version !== 1) throw new Error(`Unknown coaster config version ${config.version}`);
  return config;
}

function showNote(text) {
  const note = document.createElement("p");
  note.className = "note";
  note.textContent = text;
  document.body.append(note);
}

try {
  const config = readConfig();
  const coaster = mountCoaster(document.body, {
    track: unpackTrack(config.track),
    theme: config.theme,
    style: config.style,
    colors: config.colors,
    tunnel: config.tunnel !== false,
    handle: config.handle || null,
    makeUrl: config.makeUrl || null,
  });
  if (config.sprite) {
    const image = new Image();
    image.onload = () => coaster.setRider(image);
    image.src = config.sprite;
  }
} catch (error) {
  console.error(error);
  showNote("The coaster could not start on this device.");
}
