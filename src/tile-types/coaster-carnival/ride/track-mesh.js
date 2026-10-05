import * as THREE from "three";
import { smoothFrames, frameBetween } from "./path.js";

// The track as 3D objects, in one of two styles (the layout is the same):
//
//   steel  two round rails, a thicker spine underneath, ties across every
//          1.5 m, and round columns down to the ground
//   wood   flat steel strips on wooden stacks, close-set wooden ties, no
//          spine, and a lattice of wooden bents (two leaning posts with
//          cross-braces) every few meters, like a classic wooden coaster
//
// Kept light for phones: rails, spine and stacks are one tube each (a ring of
// a few corners swept along the smooth frames); ties, columns and every beam
// of the wooden lattice are instanced meshes.

const GAUGE = 1.1; // m between the rails
const RAIL_RADIUS = 0.07;
const SPINE_RADIUS = 0.24;
const SPINE_DROP = 0.5; // m below the rails
const TIE_EVERY = 1.5; // m
const SUPPORT_EVERY = 8; // m
const SUPPORT_RADIUS = 0.22;
// Supports go under the track wherever it leans less than about 78° (banked
// turns included): the up direction's height share must be at least this.
const MIN_UPRIGHT = 0.2;
// Wood.
const WOOD = {
  tieEvery: 0.7, // m
  bentEvery: 4, // m between bents
  panel: 3, // m between cross-braces up a bent
  post: 0.24, // m thick
  brace: 0.14,
  stack: 0.3, // wooden stack under each rail: width (and 0.24 tall)
  lean: 0.12, // the posts spread out by this much per meter down
};

/**
 * A tube along the frames (closed into a loop unless `open`), offset by
 * (side, up) from the track line. `squash` flattens it top to bottom.
 */
function tube(frames, offsetSide, offsetUp, radius, corners, open = false, squash = 1) {
  const n = frames.length;
  const positions = new Float32Array(n * corners * 3);
  const normals = new Float32Array(n * corners * 3);
  for (let i = 0; i < n; i++) {
    const { p, up, side } = frames[i];
    const c = [p[0] + side[0] * offsetSide + up[0] * offsetUp, p[1] + side[1] * offsetSide + up[1] * offsetUp, p[2] + side[2] * offsetSide + up[2] * offsetUp];
    for (let k = 0; k < corners; k++) {
      const a = (k / corners) * Math.PI * 2;
      const [ca, sa] = [Math.cos(a), Math.sin(a)];
      const d = [side[0] * ca + up[0] * sa, side[1] * ca + up[1] * sa, side[2] * ca + up[2] * sa];
      const o = (i * corners + k) * 3;
      const sq = sa * (squash - 1); // flattening: pull the up part in
      positions[o] = c[0] + (d[0] + up[0] * sq) * radius;
      positions[o + 1] = c[1] + (d[1] + up[1] * sq) * radius;
      positions[o + 2] = c[2] + (d[2] + up[2] * sq) * radius;
      normals[o] = d[0];
      normals[o + 1] = d[1];
      normals[o + 2] = d[2];
    }
  }
  const index = [];
  for (let i = 0; i < (open ? n - 1 : n); i++) {
    const j = (i + 1) % n;
    for (let k = 0; k < corners; k++) {
      const k2 = (k + 1) % corners;
      const a = i * corners + k;
      const b = i * corners + k2;
      const c = j * corners + k;
      const d = j * corners + k2;
      index.push(a, b, c, b, d, c); // faces point outward
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  g.setIndex(index);
  return g;
}

/** A matrix placing a unit object at a frame (x = side, y = up, z = travel). */
function frameMatrix(frame, offsetUp = 0) {
  const m = new THREE.Matrix4();
  const { p, t, up, side } = frame;
  m.makeBasis(new THREE.Vector3(...side), new THREE.Vector3(...up), new THREE.Vector3(...t));
  m.setPosition(p[0] + up[0] * offsetUp, p[1] + up[1] * offsetUp, p[2] + up[2] * offsetUp);
  return m;
}

/** Frames for samples from..to only (an open stretch of a closed track). */
function rangeFrames(track, from, to, steps) {
  const out = [];
  for (let i = from; i < to; i++) {
    for (let s = 0; s < steps; s++) out.push(frameBetween(track, i, s / steps));
  }
  out.push(frameBetween(track, to, 0));
  return out;
}

/**
 * Builds the track objects. Returns { group, materials, style, dispose }.
 * `materials` (rails, spine, ties, supports, and for wood the stacks under
 * the rails) are recolored by the scene. With a track switch, the thrill
 * route's own stretch is built too, sharing the materials.
 */
export function buildTrack(track, quality = 1, style = "steel") {
  const wood = style === "wood";
  const materials = {
    rails: new THREE.MeshStandardMaterial({ color: "#eeeeee", metalness: 0.6, roughness: 0.35 }),
    spine: new THREE.MeshStandardMaterial({ color: "#e23d2e", metalness: 0.3, roughness: 0.5 }),
    ties: new THREE.MeshStandardMaterial({ color: "#999999", metalness: wood ? 0 : 0.4, roughness: wood ? 0.9 : 0.6 }),
    supports: new THREE.MeshStandardMaterial({ color: "#f4f4f2", metalness: wood ? 0 : 0.2, roughness: wood ? 0.9 : 0.7 }),
    stacks: new THREE.MeshStandardMaterial({ color: "#8a5a34", metalness: 0, roughness: 0.9 }),
  };
  const group = new THREE.Group();
  const geometries = [];
  const run = wood ? buildWoodRun : buildRun;
  run(track, null, quality, materials, group, geometries);
  const thrill = track.trackSwitch?.thrill;
  // The thrill route's stretch, running a sample onto the shared track at each end.
  if (thrill) run(thrill, [thrill.from - 1, thrill.to + 1], quality, materials, group, geometries);
  return {
    group,
    materials,
    style: wood ? "wood" : "steel",
    dispose() {
      geometries.forEach((g) => g.dispose());
      Object.values(materials).forEach((m) => m.dispose());
    },
  };
}

/** Rails, spine, ties and supports for a whole closed track, or for samples range[0]..range[1] of it. */
function buildRun(track, range, quality, materials, group, geometries) {
  const steps = quality >= 1 ? 3 : 2;
  const frames = range ? rangeFrames(track, range[0], range[1], steps) : smoothFrames(track, steps);
  const open = Boolean(range);
  const corners = quality >= 1 ? 8 : 6;
  const add = (geometry, material) => {
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);
    return mesh;
  };
  add(tube(frames, -GAUGE / 2, 0, RAIL_RADIUS, corners - 2, open), materials.rails);
  add(tube(frames, GAUGE / 2, 0, RAIL_RADIUS, corners - 2, open), materials.rails);
  add(tube(frames, 0, -SPINE_DROP, SPINE_RADIUS, corners, open), materials.spine);

  // Ties: little bars from rail to rail down to the spine.
  const tieGeometry = new THREE.BoxGeometry(GAUGE + 0.1, 0.12, 0.16);
  tieGeometry.translate(0, -0.12, 0);
  geometries.push(tieGeometry);
  const tieStep = Math.max(1, Math.round((TIE_EVERY / track.spacing) * steps));
  const tieCount = Math.floor(frames.length / tieStep);
  const ties = new THREE.InstancedMesh(tieGeometry, materials.ties, tieCount);
  for (let k = 0; k < tieCount; k++) ties.setMatrixAt(k, frameMatrix(frames[k * tieStep]));
  group.add(ties);

  // Supports: columns from under the spine straight down to the ground, where
  // the track is high enough to need one, including through steeply banked
  // turns; not where it is nearly on its side or upside down, nor inside a
  // loop or corkscrew (those hold themselves up at their base).
  const inElement = new Array(track.points.length).fill(false);
  for (const piece of track.pieces) {
    if (piece.kind === "loop" || piece.kind === "corkscrew") for (let i = piece.from; i <= piece.to; i++) inElement[i] = true;
  }
  const supportGeometry = new THREE.CylinderGeometry(SUPPORT_RADIUS, SUPPORT_RADIUS * 1.25, 1, 8);
  supportGeometry.translate(0, -0.5, 0); // top at 0, hanging down 1
  geometries.push(supportGeometry);
  const spots = [];
  const every = Math.max(1, Math.round(SUPPORT_EVERY / track.spacing));
  const [first, last] = range ? [range[0] + 2, range[1] - 2] : [0, track.points.length - 1];
  for (let i = first; i <= last; i += every) {
    const up = track.ups[i];
    const p = track.points[i];
    if (inElement[i] || up[1] < MIN_UPRIGHT) continue;
    const top = p[1] - SPINE_DROP * up[1] - SPINE_RADIUS;
    if (top < 1.2) continue;
    spots.push([p[0] - up[0] * SPINE_DROP, top, p[2] - up[2] * SPINE_DROP]);
  }
  const supports = new THREE.InstancedMesh(supportGeometry, materials.supports, Math.max(1, spots.length));
  supports.count = spots.length;
  spots.forEach(([x, y, z], k) => {
    const m = new THREE.Matrix4().makeScale(1, y, 1);
    m.setPosition(x, y, z);
    supports.setMatrixAt(k, m);
  });
  group.add(supports);
}

/** Samples inside loops and corkscrews (they hold themselves up at their base). */
function elementSamples(track) {
  const inElement = new Array(track.points.length).fill(false);
  for (const piece of track.pieces) {
    if (piece.kind === "loop" || piece.kind === "corkscrew") for (let i = piece.from; i <= piece.to; i++) inElement[i] = true;
  }
  return inElement;
}

/** Rails on wooden stacks, close-set ties and wooden bents, for a whole track or samples range[0]..range[1]. */
function buildWoodRun(track, range, quality, materials, group, geometries) {
  const steps = quality >= 1 ? 3 : 2;
  const frames = range ? rangeFrames(track, range[0], range[1], steps) : smoothFrames(track, steps);
  const open = Boolean(range);
  const corners = quality >= 1 ? 8 : 6;
  const add = (geometry, material) => {
    geometries.push(geometry);
    group.add(new THREE.Mesh(geometry, material));
  };
  // Flat steel strips, each on a stack of boards.
  for (const s of [-1, 1]) {
    add(tube(frames, (s * GAUGE) / 2, 0, 0.09, corners, open, 0.35), materials.rails);
    add(tube(frames, (s * GAUGE) / 2, -0.15, WOOD.stack / 2, 4, open, 0.8), materials.stacks);
  }

  // Ties: wide boards under the stacks, close together.
  const tieGeometry = new THREE.BoxGeometry(GAUGE + 0.9, 0.12, 0.2);
  tieGeometry.translate(0, -0.33, 0);
  geometries.push(tieGeometry);
  const tieStep = Math.max(1, Math.round((WOOD.tieEvery / track.spacing) * steps));
  const tieCount = Math.floor(frames.length / tieStep);
  const ties = new THREE.InstancedMesh(tieGeometry, materials.ties, tieCount);
  for (let k = 0; k < tieCount; k++) ties.setMatrixAt(k, frameMatrix(frames[k * tieStep]));
  group.add(ties);

  // Bents: two posts leaning out as they go down, cross-braces every few
  // meters and one diagonal in each panel, alternating.
  const beams = [];
  const beam = (a, b, thick) => beams.push([a, b, thick]);
  const inElement = elementSamples(track);
  const every = Math.max(1, Math.round(WOOD.bentEvery / track.spacing));
  const [first, last] = range ? [range[0] + 2, range[1] - 2] : [0, track.points.length - 1];
  for (let i = first, n = 0; i <= last; i += every, n++) {
    const up = track.ups[i];
    if (inElement[i] || up[1] < MIN_UPRIGHT) continue;
    const p = track.points[i];
    const next = track.points[(i + 1) % track.points.length];
    const t = [next[0] - p[0], next[1] - p[1], next[2] - p[2]];
    const tl = Math.hypot(t[0], t[1], t[2]) || 1;
    // The rider's left (as the frames have it), and level across the track.
    const side = [(up[1] * t[2] - up[2] * t[1]) / tl, (up[2] * t[0] - up[0] * t[2]) / tl, (up[0] * t[1] - up[1] * t[0]) / tl];
    const flat = Math.hypot(t[0], t[2]) || 1;
    const across = [-t[2] / flat, 0, t[0] / flat];
    const sign = across[0] * side[0] + across[2] * side[2] >= 0 ? 1 : -1; // so posts spread outward on each side
    // Where each post meets the track: under the ties at each edge, banked with the track.
    const tops = [-1, 1].map((s) => {
      const off = s * (GAUGE / 2 + 0.35);
      return new THREE.Vector3(p[0] + side[0] * off - up[0] * 0.4, p[1] + side[1] * off - up[1] * 0.4, p[2] + side[2] * off - up[2] * 0.4);
    });
    if (Math.max(tops[0].y, tops[1].y) < 0.9) continue; // on the ground already
    // Each post leans outward as it goes down; `on(k, y)` is post k at height y.
    const bottoms = tops.map((a, k) => {
      const out = (k === 0 ? -1 : 1) * sign * a.y * WOOD.lean;
      return new THREE.Vector3(a.x + across[0] * out, 0, a.z + across[2] * out);
    });
    const on = (k, y) => bottoms[k].clone().lerp(tops[k], Math.max(0, Math.min(1, y / Math.max(0.01, tops[k].y))));
    for (let k = 0; k < 2; k++) if (tops[k].y > 0.3) beam(bottoms[k], tops[k], WOOD.post);
    beam(tops[0], tops[1], WOOD.brace); // a cap along the underside, tilted with the banking
    const low = Math.min(tops[0].y, tops[1].y);
    const panels = Math.max(1, Math.round(low / WOOD.panel));
    for (let k = 1; k <= panels; k++) {
      const y = (low * k) / panels;
      const y0 = (low * (k - 1)) / panels;
      if (k < panels) beam(on(0, y), on(1, y), WOOD.brace);
      const flip = (k + n) % 2;
      beam(on(flip, y0), on(1 - flip, y), WOOD.brace);
    }
  }
  const beamGeometry = new THREE.BoxGeometry(1, 1, 1);
  geometries.push(beamGeometry);
  const lattice = new THREE.InstancedMesh(beamGeometry, materials.supports, Math.max(1, beams.length));
  lattice.count = beams.length;
  const yAxis = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  beams.forEach(([a, b, thick], k) => {
    const d = b.clone().sub(a);
    const len = d.length();
    q.setFromUnitVectors(yAxis, d.divideScalar(len || 1));
    m.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(thick, len, thick));
    lattice.setMatrixAt(k, m);
  });
  group.add(lattice);
}

export const TRACK_SIZES = Object.freeze({ GAUGE, SPINE_DROP });
