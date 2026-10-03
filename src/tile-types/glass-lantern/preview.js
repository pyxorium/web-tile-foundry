import { mountLantern } from "./runtime/mount.js";
import { resolvePanel } from "./panel.js";

// The live preview in the Foundry: the same lantern the tile runs (mount.js),
// updated straight from the panel's values. In Hands-on mode a tap paints the
// facet under it with the brush instead of rolling.

export function mountPreview(element, { values, setValue }) {
  let current = values;
  let parts = resolvePanel(current);
  const lantern = mountLantern(element, { shape: parts.shape, colors: parts.colors, look: parts.look, slowTurn: parts.slowTurn, settleMs: 2000 });
  let seen = { shape: parts.shape.fingerprint, colors: JSON.stringify(parts.colors), look: JSON.stringify(parts.look) };

  function paintMode() {
    if (current.colorMode !== "handson") return null;
    return (face) => {
      const colors = resolvePanel(current).colors.slice();
      if (colors[face] === current.brush) return;
      colors[face] = current.brush;
      setValue("faceColors", colors);
    };
  }
  lantern.setPaint(paintMode());

  return {
    update(next) {
      current = next;
      parts = resolvePanel(next);
      const now = { shape: parts.shape.fingerprint, colors: JSON.stringify(parts.colors), look: JSON.stringify(parts.look) };
      if (now.look !== seen.look) lantern.setLook(parts.look);
      if (now.shape !== seen.shape) lantern.setShape(parts.shape);
      if (now.shape !== seen.shape || now.colors !== seen.colors) lantern.setColors(parts.colors);
      seen = now;
      lantern.setPaint(paintMode());
    },
    dispose() {
      lantern.dispose();
    },
  };
}
