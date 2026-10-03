import { deriveShape } from "../geometry/polyhedron.js";
import { mountLantern } from "./mount.js";

// The Glass Lantern tile's program. It is bundled (with three.js) into one
// file, /lantern.js, which is the same in every Glass Lantern tile; what makes
// each tile different is the small config in its page:
//
//   <script type="application/json" id="lantern-config">
//     { "version": 1, "shape": { "vertices": [...], "faces": [...] },
//       "colors": ["#...", ...], "look": { ...settings }, "slowTurn": true }
//   </script>
//
// The whole tile is the lantern's box (see mount.js for everything it does).

function readConfig() {
  const el = document.getElementById("lantern-config");
  const config = JSON.parse(el.textContent);
  if (config.version !== 1) throw new Error(`Unknown lantern config version ${config.version}`);
  return config;
}

try {
  const config = readConfig();
  document.body.style.background = (config.look && config.look.bgBottom) || "#0e0907";
  mountLantern(document.body, {
    shape: deriveShape(config.shape),
    colors: config.colors,
    look: config.look,
    slowTurn: config.slowTurn !== false,
  });
} catch (error) {
  console.error(error);
  const note = document.createElement("p");
  note.className = "note";
  note.textContent = "The lantern could not start on this device.";
  document.body.append(note);
}
