// Coaster Carnival's three themes: the world around the coaster (sky, light,
// scenery; sound settings are in sound.js). The viewer can switch themes. A
// theme never changes the track's layout, and never its colors: those are the
// creator's color schemes (colors.js), the same in every theme.
//
// Scenery (see scenery.js):
//   skyTop / horizon    the sky fades from skyTop overhead to horizon at the edge
//   hills               color of the distant silhouette band all round
//   hillShape           "rolling" hills, a "skyline" of buildings, or a jagged "treeline"
//   props               what stands near the track, how many, and (sizes) the
//                       smallest and largest size, as a share of normal
//   landmark            "ferris" (a Ferris wheel) or "haunted" (a house on a hill)
//   extras              clouds, stars, moon, bulbs (along the track), mist
//   routes              the words on the track switch's signs for each route
//                       (Frolic is the long way round, Detour the short one:
//                       a nod to the "frolic and detour" rule, where a frolic
//                       is the bigger departure)
//   signColors          the sign's board and lettering

export const THEMES = Object.freeze({
  day: Object.freeze({
    label: "Daytime carnival",
    sky: "#8ccfff",
    skyTop: "#4f9fe8",
    horizon: "#e4f4ff",
    fog: [220, 1100],
    ground: "#7dbb5c",
    hills: "#8fb7a3",
    hillShape: "rolling",
    station: "#ffffff",
    stationRoof: "#e23d2e",
    sunColor: "#fff4e0",
    sunStrength: 2.4,
    skyLight: "#bfe3ff",
    groundLight: "#6f8f4c",
    ambient: 1.1,
    glow: 0,
    props: Object.freeze([
      Object.freeze({ kind: "tree", count: 90, sizes: Object.freeze([0.65, 1.5]) }),
      Object.freeze({ kind: "tent", count: 6, gap: 12 }),
      Object.freeze({ kind: "stand", count: 5, gap: 10 }),
      Object.freeze({ kind: "booth", count: 5, gap: 10 }),
      Object.freeze({ kind: "balloon", count: 14, gap: 10 }),
      Object.freeze({ kind: "lamp", count: 16, sizes: Object.freeze([0.9, 1.1]) }),
    ]),
    propColors: Object.freeze({ leaves: "#3f8f45", trunk: "#7a5232", tentA: "#e23d2e", tentB: "#ffffff", tentC: "#2a5db0", sign: "#f6c531", wood: "#9a6a44", door: "#3a2a20", lamp: "#3a3f48", balloon: Object.freeze(["#e23d2e", "#f6c531", "#2a5db0", "#8e44ad", "#27ae60"]) }),
    landmark: "ferris",
    landmarkColor: "#ffffff",
    routes: Object.freeze({ chill: "Detour", thrill: "Frolic" }),
    signColors: Object.freeze({ board: "#2a5db0", text: "#ffffff" }),
    extras: Object.freeze({ clouds: true, stars: false, moon: false, bulbs: false, mist: false }),
    moon: "#ffffff",
    lampGlow: 0,
  }),
  night: Object.freeze({
    label: "Night lights",
    sky: "#0b0f2e",
    skyTop: "#04061a",
    horizon: "#3a2a6e",
    fog: [200, 1000],
    ground: "#1a2340",
    hills: "#161433",
    hillShape: "skyline",
    station: "#2a2f4a",
    stationRoof: "#ffd23f",
    sunColor: "#9aa8ff",
    sunStrength: 0.8,
    skyLight: "#5b5fa8",
    groundLight: "#1a1630",
    ambient: 0.75,
    glow: 0.9,
    props: Object.freeze([
      Object.freeze({ kind: "tree", count: 60, sizes: Object.freeze([0.6, 1.8]) }),
      Object.freeze({ kind: "tent", count: 6, gap: 12 }),
      Object.freeze({ kind: "stand", count: 5, gap: 10 }),
      Object.freeze({ kind: "booth", count: 5, gap: 10 }),
      Object.freeze({ kind: "lamp", count: 34, sizes: Object.freeze([0.9, 1.1]) }),
    ]),
    propColors: Object.freeze({ leaves: "#1f3a33", trunk: "#2b2420", tentA: "#ff4fb8", tentB: "#f4ecff", tentC: "#35e0ff", sign: "#ffd23f", wood: "#4a3a52", door: "#ffb35c", lamp: "#2c3352", balloon: Object.freeze([]) }),
    landmark: "ferris",
    landmarkColor: "#ffd23f",
    routes: Object.freeze({ chill: "Detour", thrill: "Frolic" }),
    signColors: Object.freeze({ board: "#1b1d3a", text: "#ffd23f" }),
    extras: Object.freeze({ clouds: false, stars: true, moon: true, bulbs: true, mist: false }),
    moon: "#f3eecb",
    lampGlow: 1,
  }),
  spooky: Object.freeze({
    label: "Spooky",
    sky: "#2a1838",
    skyTop: "#120a1c",
    horizon: "#7a4a5e",
    fog: [110, 650],
    ground: "#2c2820",
    hills: "#1c1220",
    hillShape: "treeline",
    station: "#3a2e28",
    stationRoof: "#6b3fa0",
    sunColor: "#d8c4ff",
    sunStrength: 0.9,
    skyLight: "#6d5a8a",
    groundLight: "#2a2018",
    ambient: 0.8,
    glow: 0.25,
    props: Object.freeze([
      Object.freeze({ kind: "deadTree", count: 70, sizes: Object.freeze([0.6, 1.8]) }),
      Object.freeze({ kind: "grave", count: 60, gap: 6 }),
      Object.freeze({ kind: "pumpkin", count: 30, gap: 6 }),
    ]),
    propColors: Object.freeze({ leaves: "#000000", trunk: "#2e2219", tentA: "#000000", tentB: "#000000", lamp: "#000000", grave: "#8a8a8f", pumpkin: "#ff7a1a", balloon: Object.freeze([]) }),
    landmark: "haunted",
    landmarkColor: "#1c1520",
    routes: Object.freeze({ chill: "Detour", thrill: "Frolic" }),
    signColors: Object.freeze({ board: "#3a2b20", text: "#e8d9b0" }),
    extras: Object.freeze({ clouds: false, stars: true, moon: true, bulbs: false, mist: true }),
    moon: "#f4f1e0",
    lampGlow: 0,
  }),
});

export const THEME_IDS = Object.freeze(Object.keys(THEMES));
export const DEFAULT_THEME = "day";

export function getTheme(id) {
  return THEMES[id] || THEMES[DEFAULT_THEME];
}
