import * as THREE from "three";
import { smoothFrames } from "./path.js";

// The track as 3D objects: two rails, a thicker spine underneath, ties
// across every 1.5 m, and supports down to the ground. Kept light for phones:
// the rails and spine are one tube each (a ring of a few corners swept along
// the smooth frames), the ties and supports are single instanced meshes.

const GAUGE = 1.1; // m between the rails
const RAIL_RADIUS = 0.07;
const SPINE_RADIUS = 0.24;
const SPINE_DROP = 0.5; // m below the rails
const TIE_EVERY = 1.5; // m
const SUPPORT_EVERY = 8; // m
const SUPPORT_RADIUS = 0.22;

/** A closed tube along the frames, offset by (side, up) from the track line. */
function tube(frames, offsetSide, offsetUp, radius, corners) {
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
      positions[o] = c[0] + d[0] * radius;
      positions[o + 1] = c[1] + d[1] * radius;
      positions[o + 2] = c[2] + d[2] * radius;
      normals[o] = d[0];
      normals[o + 1] = d[1];
      normals[o + 2] = d[2];
    }
  }
  const index = [];
  for (let i = 0; i < n; i++) {
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

/**
 * Builds the track objects. Returns { group, materials, dispose }.
 * `materials` (rails, spine, ties, supports) are recolored by the theme.
 */
export function buildTrack(track, quality = 1) {
  const steps = quality >= 1 ? 3 : 2;
  const frames = smoothFrames(track, steps);
  const corners = quality >= 1 ? 8 : 6;
  const materials = {
    rails: new THREE.MeshStandardMaterial({ color: "#eeeeee", metalness: 0.6, roughness: 0.35 }),
    spine: new THREE.MeshStandardMaterial({ color: "#e23d2e", metalness: 0.3, roughness: 0.5 }),
    ties: new THREE.MeshStandardMaterial({ color: "#999999", metalness: 0.4, roughness: 0.6 }),
    supports: new THREE.MeshStandardMaterial({ color: "#f4f4f2", metalness: 0.2, roughness: 0.7 }),
  };
  const group = new THREE.Group();
  const geometries = [];
  const add = (geometry, material) => {
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);
    return mesh;
  };
  add(tube(frames, -GAUGE / 2, 0, RAIL_RADIUS, corners - 2), materials.rails);
  add(tube(frames, GAUGE / 2, 0, RAIL_RADIUS, corners - 2), materials.rails);
  add(tube(frames, 0, -SPINE_DROP, SPINE_RADIUS, corners), materials.spine);

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
  // the track is the right way up and high enough to need one, and not inside
  // a loop or corkscrew (those hold themselves up at their base).
  const inElement = new Array(track.points.length).fill(false);
  for (const piece of track.pieces) {
    if (piece.kind === "loop" || piece.kind === "corkscrew") for (let i = piece.from; i <= piece.to; i++) inElement[i] = true;
  }
  const supportGeometry = new THREE.CylinderGeometry(SUPPORT_RADIUS, SUPPORT_RADIUS * 1.25, 1, 8);
  supportGeometry.translate(0, -0.5, 0); // top at 0, hanging down 1
  geometries.push(supportGeometry);
  const spots = [];
  const every = Math.max(1, Math.round(SUPPORT_EVERY / track.spacing));
  for (let i = 0; i < track.points.length; i += every) {
    const up = track.ups[i];
    const p = track.points[i];
    if (inElement[i] || up[1] < 0.6) continue;
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

  return {
    group,
    materials,
    dispose() {
      geometries.forEach((g) => g.dispose());
      Object.values(materials).forEach((m) => m.dispose());
    },
  };
}

export const TRACK_SIZES = Object.freeze({ GAUGE, SPINE_DROP });
