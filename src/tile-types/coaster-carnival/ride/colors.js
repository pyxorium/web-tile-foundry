// Coaster Carnival's ready-made color schemes: the creator picks one for the
// track (its choices depend on the track style) and one for the cart. They
// stay the same in every theme: the theme only sets the world around the
// coaster (sky, light, scenery, sound). Ready-made rather than free color
// pickers, so every scheme can be checked by eye in day, night and spooky.
//
// The first in each list is the default.

const f = Object.freeze;

/** Steel: round rails, the spine under them, the ties between, the support columns. */
export const STEEL_SCHEMES = f([
  f({ id: "classic-red", label: "Classic red", rails: "#eef0f2", spine: "#e23d2e", ties: "#9aa3ab", supports: "#f4f4f2" }),
  f({ id: "ocean-blue", label: "Ocean blue", rails: "#e8f1f8", spine: "#1f6fd1", ties: "#8fa3b5", supports: "#f2f6fa" }),
  f({ id: "lime-purple", label: "Lime and purple", rails: "#f2f2f2", spine: "#7cc242", ties: "#4b3a63", supports: "#5b2d8e" }),
  f({ id: "sunset-orange", label: "Sunset orange", rails: "#fff3e0", spine: "#f07b1d", ties: "#545b66", supports: "#2f3a4a" }),
  f({ id: "midnight-teal", label: "Midnight teal", rails: "#c9d6d8", spine: "#12898a", ties: "#3a4a55", supports: "#1d2b36" }),
  f({ id: "candy-pink", label: "Candy pink", rails: "#ffffff", spine: "#ff5fa8", ties: "#c9b7a0", supports: "#ffe36e" }),
  f({ id: "all-black", label: "All black", rails: "#9aa0a6", spine: "#1c1c1e", ties: "#3a3a3e", supports: "#2b2b2e" }),
  f({ id: "mint-cream", label: "Mint and cream", rails: "#fffaf0", spine: "#49c2a3", ties: "#b9c9c2", supports: "#fffaf0" }),
]);

/** Wood: the steel strips on top, the wooden stacks under them, the ties, the lattice of supports. */
export const WOOD_FINISHES = f([
  f({ id: "natural", label: "Natural wood", rails: "#a9afb5", stacks: "#8a5a34", ties: "#74492a", supports: "#c79a66" }),
  f({ id: "white-painted", label: "White painted", rails: "#a9afb5", stacks: "#8c7a66", ties: "#6e5a48", supports: "#f1ede4" }),
  f({ id: "dark-stained", label: "Dark stained", rails: "#9aa0a6", stacks: "#4a2f1d", ties: "#3b2618", supports: "#5b3a24" }),
  f({ id: "barn-red", label: "Barn red", rails: "#a9afb5", stacks: "#6b2f22", ties: "#5a2a20", supports: "#a8352a" }),
  f({ id: "weathered-gray", label: "Weathered gray", rails: "#a9afb5", stacks: "#77716a", ties: "#5f5a52", supports: "#9c9890" }),
]);

/** The cart (both styles): its body and trim. */
export const CART_COLORS = f([
  f({ id: "sunny-yellow", label: "Sunny yellow", body: "#f6c531", trim: "#2a5db0" }),
  f({ id: "fire-red", label: "Fire red", body: "#e23d2e", trim: "#f4f4f2" }),
  f({ id: "sky-blue", label: "Sky blue", body: "#35a7ff", trim: "#1d2b53" }),
  f({ id: "racing-green", label: "Racing green", body: "#1f8a4c", trim: "#f6c531" }),
  f({ id: "royal-purple", label: "Royal purple", body: "#6b3fa0", trim: "#f4c430" }),
  f({ id: "bubblegum", label: "Bubblegum", body: "#ff7fbf", trim: "#ffffff" }),
  f({ id: "silver", label: "Silver", body: "#c8ccd2", trim: "#e23d2e" }),
]);

const find = (list, id) => list.find((c) => c.id === id) || list[0];
export const steelScheme = (id) => find(STEEL_SCHEMES, id);
export const woodFinish = (id) => find(WOOD_FINISHES, id);
export const cartColor = (id) => find(CART_COLORS, id);
export const DEFAULT_COLORS = f({ steel: STEEL_SCHEMES[0].id, wood: WOOD_FINISHES[0].id, cart: CART_COLORS[0].id });
