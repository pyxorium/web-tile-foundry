import { seededRandom } from "../../glass-lantern/geometry/gem.js";

// Where the scenery goes. Pure maths, no three.js, so it is tested in Node.
//
// Everything is placed from the layout number (track.input.seed), so the
// Foundry preview and the published tile always show the same scenery. It
// never changes the track: props are kept a set distance from every point of
// the track (which also clears its supports) and from the station.
//
//   placeProps(track, [{ kind, count, gap?, near?, sizes?: [min, max] }, ...])
//     → { [kind]: [{ x, z, turn, size }, ...] }
//   landmarkSpot(track, salt) → { x, z, facing }   somewhere just outside the ride

const CELL = 12; // m, size of the lookup grid for "how close is the track"
const STATION_CLEAR = 22; // m around the station's middle
const PROP_SPACING = 3.5; // m between props

function trackGrid(track) {
  const grid = new Map();
  // With a track switch, the thrill route's own stretch counts as track too.
  const thrill = track.trackSwitch?.thrill;
  const points = thrill ? [...track.points, ...thrill.points.slice(thrill.from, thrill.to + 1)] : track.points;
  for (const [x, , z] of points) {
    const key = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push([x, z]);
  }
  return grid;
}

/** Horizontal distance from (x, z) to the nearest track point, looking only within `reach`. */
function nearestTrack(grid, x, z, reach) {
  const r = Math.ceil(reach / CELL);
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  let best = Infinity;
  for (let i = -r; i <= r; i++) {
    for (let j = -r; j <= r; j++) {
      const cell = grid.get(`${cx + i},${cz + j}`);
      if (!cell) continue;
      for (const [px, pz] of cell) best = Math.min(best, Math.hypot(px - x, pz - z));
    }
  }
  return best;
}

/** A seeded random source for scenery, separate from the track's own (so scenery never shifts the layout). */
export function sceneryRandom(track, salt = 0) {
  return seededRandom(((track.input?.seed ?? 0) ^ 0x5ce4e5 ^ (salt * 0x9e3779b1)) >>> 0);
}

export function placeProps(track, plan) {
  const grid = trackGrid(track);
  const station = track.points[0];
  const b = track.bounds;
  const placed = [];
  const out = {};
  plan.forEach((item, index) => {
    const rand = sceneryRandom(track, index + 1);
    const gap = item.gap ?? 8;
    const [small, large] = item.sizes ?? [0.75, 1.25];
    const margin = item.near === false ? 160 : 60; // how far beyond the ride props may go
    const list = [];
    let tries = 0;
    while (list.length < item.count && tries < item.count * 40) {
      tries++;
      const x = b.min[0] - margin + rand() * (b.size[0] + 2 * margin);
      const z = b.min[2] - margin + rand() * (b.size[2] + 2 * margin);
      if (Math.hypot(x - station[0], z - station[2]) < STATION_CLEAR) continue;
      if (nearestTrack(grid, x, z, gap) < gap) continue;
      if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < PROP_SPACING)) continue;
      placed.push([x, z]);
      list.push({ x, z, turn: rand() * Math.PI * 2, size: small + rand() * (large - small) });
    }
    out[item.kind] = list;
  });
  return out;
}

/** A spot just outside the ride for a landmark (Ferris wheel, haunted house), behind the track as seen from the front. */
export function landmarkSpot(track, salt = 99) {
  const rand = sceneryRandom(track, salt);
  const b = track.bounds;
  const grid = trackGrid(track);
  for (let i = 0; i < 60; i++) {
    // Behind the ride (negative z: the waiting view looks from +z), toward one side.
    const side = rand() < 0.5 ? -1 : 1;
    const x = side * (b.size[0] * (0.15 + rand() * 0.35));
    const z = b.min[2] - 35 - rand() * 60;
    if (nearestTrack(grid, x, z, 40) >= 40) return { x, z, facing: Math.atan2(-x, -z) };
  }
  return { x: 0, z: b.min[2] - 120, facing: 0 };
}

export const _internal = { trackGrid, nearestTrack };
