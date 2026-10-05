// Draws a few Coaster Carnival tracks as a picture: each from above and from
// the side, colored by piece. For looking at layouts while tuning; not part
// of the site.
//
//   node lab/coaster-track-sketch.mjs                 writes coaster-tracks.svg
//   node lab/coaster-track-sketch.mjs out.svg 60      file name, time cap in seconds
//   node lab/coaster-track-sketch.mjs out.svg 40 switch   with the track switch
import { writeFileSync } from "node:fs";
import { generateTrack } from "../src/tile-types/coaster-carnival/track/index.js";

const out = process.argv[2] || "coaster-tracks.svg";
const timeCap = Number(process.argv[3] || 60);
const withSwitch = process.argv[4] === "switch";

const RIDES = [
  { drops: 1, loops: 0, corkscrews: 0, intensity: 1, seed: 7 },
  { drops: 2, loops: 1, corkscrews: 1, intensity: 3, seed: 1 },
  { drops: 3, loops: 1, corkscrews: 1, intensity: 3, seed: 12 },
  { drops: 2, loops: 2, corkscrews: 1, intensity: 5, seed: 2026 },
];

const COLORS = {
  "station-out": "#7a7a7a",
  "station-in": "#7a7a7a",
  brakes: "#b0413e",
  lift: "#3d6fb6",
  crest: "#3d6fb6",
  drop: "#e08a1e",
  rise: "#d4b62c",
  hilltop: "#d4b62c",
  loop: "#c2368f",
  corkscrew: "#7d3fc4",
  turn: "#2f9e6e",
  valley: "#999999",
  filler: "#bbbbbb",
  return: "#999999",
  woods: "#1f6b3a",
  water: "#2a8fd8",
};
const KEY = [
  ["station", COLORS["station-out"]],
  ["lift", COLORS.lift],
  ["drop", COLORS.drop],
  ["climb", COLORS.rise],
  ["loop", COLORS.loop],
  ["corkscrew", COLORS.corkscrew],
  ["turn", COLORS.turn],
  ["straight", COLORS.filler],
  ["brakes", COLORS.brakes],
  ...(withSwitch ? [["woods route", COLORS.woods], ["water route", COLORS.water]] : []),
];

const W = 1130;
const ROW = 330;
const TOP = { x: 20, w: 420, h: 260 };
const SIDE = { x: 470, w: 610, h: 200 };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

let svg = "";
RIDES.forEach((input, r) => {
  const t = generateTrack({ ...input, trackSwitch: withSwitch }, { timeCap });
  const y0 = 60 + r * ROW;
  const kindAt = new Array(t.points.length);
  for (const p of t.pieces) for (let i = p.from; i <= p.to; i++) kindAt[i] = p.kind;
  const sw = t.trackSwitch;
  if (sw) for (let i = sw.woods.from; i <= sw.woods.to; i++) kindAt[i] = "woods";

  // From above: x across, z down the page (station at the front = bottom).
  const scaleTop = Math.min(TOP.w / t.bounds.size[0], TOP.h / t.bounds.size[2]);
  const top = (p) => [TOP.x + TOP.w / 2 + p[0] * scaleTop, y0 + 20 + TOP.h / 2 + p[2] * scaleTop];
  // From the side: distance along the track across, height up.
  const scaleX = SIDE.w / t.length;
  const scaleY = SIDE.h / 50;
  const side = (i) => [SIDE.x + i * t.spacing * scaleX, y0 + 20 + SIDE.h - t.points[i][1] * scaleY];

  const segments = (map) => {
    let s = "";
    for (let i = 0; i < t.points.length; i++) {
      const j = (i + 1) % t.points.length;
      if (map === side && j === 0) continue;
      const [ax, ay] = map === top ? top(t.points[i]) : side(i);
      const [bx, by] = map === top ? top(t.points[j]) : side(j);
      s += `<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${COLORS[kindAt[i]] || "#000"}" stroke-width="2.5" stroke-linecap="round"/>`;
    }
    return s;
  };

  const asked = `${input.drops} drop${input.drops > 1 ? "s" : ""}, ${input.loops} loop${input.loops === 1 ? "" : "s"}, ${input.corkscrews} corkscrew${input.corkscrews === 1 ? "" : "s"}, intensity ${input.intensity}, seed ${input.seed}`;
  const left = Object.entries(t.leftOut).filter(([, n]) => n).map(([k, n]) => (n === true ? "the switch" : `${n} ${k}`)).join(", ");
  svg += `<text x="20" y="${y0}" font-size="15" font-weight="600">${esc(asked)}</text>`;
  const times = sw ? `woods route ${t.duration.toFixed(1)} s, water route ${sw.water.duration.toFixed(1)} s, switch at ${sw.at.toFixed(1)} s` : `${t.duration.toFixed(1)} s`;
  svg += `<text x="20" y="${y0 + 17}" font-size="12" fill="#555">${esc(`${times}, ${Math.round(t.length)} m of track, top speed ${t.topSpeed} m/s, strongest push ${t.peakGs} g, ${Math.round(t.bounds.size[0])} × ${Math.round(t.bounds.size[2])} m, up to ${Math.round(t.bounds.max[1])} m tall${left ? `; left out: ${left}` : ""}`)}</text>`;
  svg += `<rect x="${TOP.x}" y="${y0 + 20}" width="${TOP.w}" height="${TOP.h}" fill="#f6f4ef" rx="6"/>`;
  svg += segments(top);
  if (sw) {
    const w = sw.water.points;
    for (let i = sw.water.from - 1; i <= sw.water.to; i++) {
      const [ax, ay] = top(w[i]);
      const [bx, by] = top(w[i + 1]);
      svg += `<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${COLORS.water}" stroke-width="2.5" stroke-linecap="round"/>`;
    }
    const [jx, jy] = top(t.points[sw.woods.from]);
    svg += `<circle cx="${jx}" cy="${jy}" r="4" fill="none" stroke="#222" stroke-width="1.5"/><text x="${jx + 7}" y="${jy - 6}" font-size="11">switch</text>`;
  }
  const [sx, sy] = top(t.points[0]);
  svg += `<circle cx="${sx}" cy="${sy}" r="5" fill="#222"/><text x="${sx + 8}" y="${sy + 4}" font-size="11">station</text>`;
  svg += `<rect x="${SIDE.x}" y="${y0 + 20}" width="${SIDE.w}" height="${SIDE.h}" fill="#f6f4ef" rx="6"/>`;
  for (let h = 10; h <= 40; h += 10) {
    const gy = y0 + 20 + SIDE.h - h * scaleY;
    svg += `<line x1="${SIDE.x}" x2="${SIDE.x + SIDE.w}" y1="${gy}" y2="${gy}" stroke="#ddd"/><text x="${SIDE.x + SIDE.w + 4}" y="${gy + 4}" font-size="10" fill="#888">${h} m</text>`;
  }
  svg += segments(side);
  svg += `<text x="${SIDE.x}" y="${y0 + 20 + SIDE.h + 16}" font-size="11" fill="#555">From the side, unrolled: distance along the track, left to right</text>`;
  svg += `<text x="${TOP.x}" y="${y0 + 20 + TOP.h + 14}" font-size="11" fill="#555">From above</text>`;
});

let key = "";
KEY.forEach(([label, color], i) => {
  key += `<rect x="${20 + i * 98}" y="18" width="14" height="14" fill="${color}" rx="3"/><text x="${38 + i * 98}" y="30" font-size="12">${label}</text>`;
});
const H = 60 + RIDES.length * ROW;
const page = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif"><rect width="100%" height="100%" fill="#fff"/>${key}${svg}</svg>`;
writeFileSync(out, page);
console.log(`Wrote ${out} (time cap ${timeCap} s).`);
