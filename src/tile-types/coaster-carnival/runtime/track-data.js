import { boundsOf } from "../track/checks.js";
import { fingerprintOf } from "../../glass-lantern/geometry/polyhedron.js";

// The finished track as the tile carries it. The Foundry runs the generator
// once and the tile stores the result (as Glass Lantern does with gems), so
// every device rides exactly the same coaster whatever its arithmetic. The
// generator already rounds its numbers (points to the millimeter), so packing
// loses nothing: unpacking gives back the same points, the same scenery and
// tunnel, and the same fingerprint.
//
// Packed, the arrays are flat ([x, y, z, x, y, z, ...]) and only what the
// ride uses is kept. Pure data, no three.js, so it is tested in Node.
//
//   packTrack(generateTrack(...)) → data     (JSON-ready)
//   unpackTrack(data)             → track    (what the ride's setTrack takes)

export const TRACK_DATA_VERSION = 1;

const flat = (rows) => rows.flat();
function rows(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function packRoute(r) {
  return {
    spacing: r.spacing,
    duration: r.duration,
    points: flat(r.points),
    ups: flat(r.ups),
    speed: [...r.speed],
    time: [...r.time],
    pieces: r.pieces.map((p) => [p.kind, p.from, p.to, p.start, p.end]),
  };
}

function unpackRoute(d) {
  return {
    spacing: d.spacing,
    duration: d.duration,
    points: rows(d.points, 3),
    ups: rows(d.ups, 3),
    speed: d.speed,
    time: d.time,
    pieces: d.pieces.map(([kind, from, to, start, end]) => ({ kind, from, to, start, end })),
  };
}

export function packTrack(track) {
  const sw = track.trackSwitch;
  return {
    v: TRACK_DATA_VERSION,
    generator: track.version,
    seed: track.input.seed,
    fingerprint: track.fingerprint,
    route: packRoute(track),
    trackSwitch: sw
      ? {
          at: sw.at,
          extra: sw.extra,
          feature: sw.feature,
          depth: sw.depth,
          chill: { from: sw.chill.from, to: sw.chill.to, end: sw.chill.end },
          thrill: { ...packRoute(sw.thrill), from: sw.thrill.from, to: sw.thrill.to, end: sw.thrill.end },
        }
      : null,
  };
}

export function unpackTrack(data) {
  if (!data || data.v !== TRACK_DATA_VERSION) throw new Error(`Unknown track data version ${data && data.v}`);
  const main = unpackRoute(data.route);
  const sw = data.trackSwitch;
  const trackSwitch = sw
    ? {
        at: sw.at,
        extra: sw.extra,
        feature: sw.feature,
        depth: sw.depth,
        chill: { ...sw.chill },
        thrill: { ...unpackRoute(sw.thrill), from: sw.thrill.from, to: sw.thrill.to, end: sw.thrill.end },
      }
    : null;
  const allPoints = trackSwitch ? [...main.points, ...trackSwitch.thrill.points] : main.points;
  return {
    version: data.generator,
    input: { seed: data.seed }, // the scenery is placed from the layout number (placement.js)
    ...main,
    trackSwitch,
    bounds: boundsOf(allPoints),
    fingerprint: fingerprintOf(allPoints, []),
  };
}
