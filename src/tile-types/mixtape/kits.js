// Cassette looks ("kits"): the shell, the label paper and ink, and the two
// stripes across the label. A tape records its kit's id and its colors in
// tape.json (label.style, label.colors), so any player can use the colors
// without knowing the kits. The card pictures (art.js) and the tile's player
// use them too.

export const KITS = Object.freeze([
  { id: "cassette-classic", label: "Classic", shell: "#26232c", edge: "#121117", paper: "#f3e8cc", ink: "#2b2340", stripe1: "#e2572c", stripe2: "#f2a93b", backdrop: ["#4a3a5e", "#1b1822"] },
  { id: "cassette-smoke", label: "Smoke", shell: "#5d6571", edge: "#353b44", paper: "#f4f1ea", ink: "#1f2b3d", stripe1: "#2f6fd0", stripe2: "#7fb0ef", backdrop: ["#2b3d52", "#0f1620"] },
  { id: "cassette-cream", label: "Cream", shell: "#e9dfc8", edge: "#b3a483", paper: "#fffaf0", ink: "#2a2a2a", stripe1: "#2f8f6b", stripe2: "#8fcaa0", backdrop: ["#2f5d4f", "#13291f"] },
  { id: "cassette-cherry", label: "Cherry", shell: "#b3262e", edge: "#741821", paper: "#fff4e0", ink: "#2a1a1a", stripe1: "#1d1d1d", stripe2: "#f4c542", backdrop: ["#5e1a20", "#230809"] },
  { id: "cassette-ocean", label: "Ocean", shell: "#1f4e79", edge: "#12304d", paper: "#f2efe6", ink: "#1b2a3a", stripe1: "#f28c38", stripe2: "#f6c85f", backdrop: ["#21486b", "#0a1624"] },
]);

export const DEFAULT_KIT = KITS[0].id;

export function kitById(id) {
  return KITS.find((k) => k.id === id) || KITS[0];
}

/** The colors a tape carries in tape.json (label.colors). */
export function kitColors(id) {
  const k = kitById(id);
  return { shell: k.shell, paper: k.paper, ink: k.ink, stripe1: k.stripe1, stripe2: k.stripe2 };
}
