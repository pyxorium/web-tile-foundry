import * as THREE from "three";
import { TUNNEL, tunnelLine, insideTunnel, hillHalfWidth } from "./tunnel.js";

// The tunnel itself (where it goes is tunnel.js): a hill the track runs
// through, with a dark inside, little lamps that flick past, and a portal at
// each end dressed for the theme (theme.tunnel):
//
//   "hill"     Day: a grassy hill with a stone arch
//   "lantern"  Night: a brick portal with a lantern either side
//   "mouth"    Spooky: a dark mouth with teeth along the arch and two glowing eyes above
//
//   const t = buildTunnel(track, tunnel, theme);   // tunnel from findTunnel(track)
//   t.group; t.contains(x, y, z); t.setFade(opacity); t.dispose();
//
// setFade lets the views from above and outside see the cart through the
// hill (the scene fades it while the cart is in or near the tunnel).

const WALL = 3; // m: inside, from the rails up to where the arch begins
const ARCH = 9; // points round the arch
const HILL = 17; // points across the hill

/** The inside, across the tunnel at rails height y: floor corner, up the wall, over the arch, down, and back along the floor. */
function insideProfile(y) {
  const hw = TUNNEL.halfWidth;
  const floor = Math.max(0.03, y - 1.6);
  const pts = [[-hw, floor]];
  for (let k = 0; k < ARCH; k++) {
    const a = Math.PI - (Math.PI * k) / (ARCH - 1);
    pts.push([hw * Math.cos(a), y + WALL + (TUNNEL.crown - WALL) * Math.sin(a)]);
  }
  pts.push([hw, floor]);
  return pts;
}

/** The hill's outline across the tunnel: from the ground on one side, over the top, to the ground on the other. */
function hillProfile(y, halfWidth) {
  const top = y + TUNNEL.crown + TUNNEL.cover;
  const pts = [];
  for (let k = 0; k < HILL; k++) {
    const u = -1 + (2 * k) / (HILL - 1);
    pts.push([u * halfWidth, top * Math.pow(Math.cos((Math.PI / 2) * Math.abs(u)), 1.2)]);
  }
  return pts;
}

/** A surface swept along the tunnel: `profile(entry)` gives the same number of [across, height] points at every sample. */
function loft(line, profile, closed) {
  const rows = line.map((e) => profile(e).map(([x, h]) => [e.p[0] + e.across[0] * x, h, e.p[2] + e.across[2] * x]));
  const per = rows[0].length;
  const positions = new Float32Array(rows.length * per * 3);
  rows.forEach((row, r) => row.forEach((v, k) => positions.set(v, (r * per + k) * 3)));
  const index = [];
  const segs = closed ? per : per - 1;
  for (let r = 0; r < rows.length - 1; r++) {
    for (let k = 0; k < segs; k++) {
      const a = r * per + k;
      const b = r * per + ((k + 1) % per);
      const c = a + per;
      const d = b + per;
      index.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** Places an object made in tunnel-end coordinates (x across, y height, z outward) at one end. */
function endMatrix(e, outward) {
  const across = new THREE.Vector3(...e.across).multiplyScalar(outward);
  const out = new THREE.Vector3(...e.along).multiplyScalar(outward);
  const m = new THREE.Matrix4().makeBasis(across, new THREE.Vector3(0, 1, 0), out);
  m.setPosition(e.p[0], 0, e.p[2]);
  return m;
}

export function buildTunnel(track, tunnel, theme) {
  const look = theme.tunnel || {};
  const line = tunnelLine(track, tunnel);
  const group = new THREE.Group();
  const geometries = [];
  const keepG = (g) => (geometries.push(g), g);
  const highest = Math.max(...line.map((e) => e.p[1]));
  const halfWidth = hillHalfWidth(highest);

  const materials = {
    hill: new THREE.MeshStandardMaterial({ color: look.hill || "#6aa84f", roughness: 1, flatShading: true }),
    // The portal faces sideways, away from the sun overhead: `lift` lets it light itself a little.
    portal: new THREE.MeshStandardMaterial({ color: look.portal || "#a39d92", emissive: look.portal || "#a39d92", emissiveIntensity: look.lift ?? 0, roughness: 0.95, side: THREE.DoubleSide }),
    rim: new THREE.MeshStandardMaterial({ color: look.rim || "#c9c2b5", emissive: look.rim || "#c9c2b5", emissiveIntensity: look.lift ?? 0, roughness: 0.9 }),
    // The hill's front face round the portal: the hill's color, lit a little like the portal.
    face: new THREE.MeshStandardMaterial({ color: look.hill || "#6aa84f", emissive: look.hill || "#6aa84f", emissiveIntensity: (look.lift ?? 0) * 0.8, roughness: 1, side: THREE.DoubleSide }),
    inside: new THREE.MeshBasicMaterial({ color: look.inside || "#2a2622", side: THREE.DoubleSide }),
    lamp: new THREE.MeshBasicMaterial({ color: look.lamp || "#fff2c8" }),
    extra: new THREE.MeshBasicMaterial({ color: look.extra || "#ffffff" }),
    post: new THREE.MeshStandardMaterial({ color: "#2b2420", roughness: 0.8 }),
  };
  const fading = [materials.hill, materials.face, materials.portal, materials.rim, materials.inside];
  // Set up for see-through from the start (fully solid until faded), so fading
  // only changes a number: switching see-through on mid-ride would make the
  // browser prepare new drawing instructions, a visible hitch the first time.
  for (const m of fading) m.transparent = true;
  const mesh = (g, m) => {
    const x = new THREE.Mesh(keepG(g), m);
    group.add(x);
    return x;
  };

  // The hill, the inside (walls, arch and floor, all one dark surface).
  mesh(loft(line, (e) => hillProfile(e.p[1], halfWidth), false), materials.hill);
  mesh(loft(line, (e) => insideProfile(e.p[1]), true), materials.inside);

  // Little lamps along the walls, every few meters, on alternate sides.
  const lampGeometry = keepG(new THREE.BoxGeometry(0.22, 0.28, 0.6));
  const every = Math.max(1, Math.round(5 / track.spacing));
  const lampSpots = [];
  for (let k = 2, side = 1; k < line.length - 2; k += every, side = -side) lampSpots.push([line[k], side]);
  const lamps = new THREE.InstancedMesh(lampGeometry, materials.lamp, Math.max(1, lampSpots.length));
  lamps.count = lampSpots.length;
  lampSpots.forEach(([e, side], k) => {
    const x = side * (TUNNEL.halfWidth - 0.12);
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...e.across), new THREE.Vector3(0, 1, 0), new THREE.Vector3(...e.along));
    m.setPosition(e.p[0] + e.across[0] * x, e.p[1] + 2.4, e.p[2] + e.across[2] * x);
    lamps.setMatrixAt(k, m);
  });
  group.add(lamps);

  // The two portals.
  for (const [e, outward] of [[line[0], -1], [line[line.length - 1], 1]]) {
    const end = new THREE.Group();
    end.matrixAutoUpdate = false;
    end.matrix.copy(endMatrix(e, outward));
    group.add(end);
    const y = e.p[1];
    const add = (g, m, x, h, z = 0) => {
      const o = new THREE.Mesh(keepG(g), m);
      o.position.set(x, h, z);
      end.add(o);
      return o;
    };
    // The face: the hill's outline with the opening cut out, and a stone
    // collar round the opening (both from a little below the ground, so each
    // hole stays inside its outline).
    const inside = insideProfile(y);
    const floor = inside[0][1];
    const collar = inside.slice(1, -1).map(([x, h]) => [x * 1.32, floor + (h - floor) * 1.16]);
    const face = (outline, holePoints) => {
      const shape = new THREE.Shape();
      shape.moveTo(outline[0][0], -0.5);
      for (const [x, h] of outline) shape.lineTo(x, Math.max(h, 0));
      shape.lineTo(outline[outline.length - 1][0], -0.5);
      shape.closePath();
      const hole = new THREE.Path();
      // The hole must run the opposite way round to the outline.
      const ring = [[holePoints[0][0], -0.2], ...holePoints, [holePoints[holePoints.length - 1][0], -0.2]];
      [...ring].reverse().forEach(([x, h], k) => (k ? hole.lineTo(x, h) : hole.moveTo(x, h)));
      hole.closePath();
      shape.holes.push(hole);
      return new THREE.ShapeGeometry(shape);
    };
    add(face(hillProfile(y, halfWidth), collar), materials.face, 0, 0, 0.02);
    add(face(collar, inside.slice(1, -1)), materials.portal, 0, 0, 0.05);
    // A rim round the opening.
    const rimPath = new THREE.CatmullRomCurve3(inside.map(([x, h]) => new THREE.Vector3(x * 1.04, h, 0.12)));
    add(new THREE.TubeGeometry(rimPath, 40, 0.3, 6, false), materials.rim, 0, 0);

    if (look.look === "lantern") {
      for (const s of [-1, 1]) {
        const x = s * (TUNNEL.halfWidth + 1);
        add(new THREE.BoxGeometry(0.16, y + 2, 0.16), materials.post, x, (y + 2) / 2, 0.45); // from the ground up
        add(new THREE.BoxGeometry(0.5, 0.65, 0.5), materials.lamp, x, y + 2.3, 0.45);
        add(new THREE.BoxGeometry(0.62, 0.1, 0.62), materials.post, x, y + 2.68, 0.45);
      }
    } else if (look.look === "mouth") {
      // Teeth along the top of the arch, pointing down.
      const tooth = new THREE.ConeGeometry(0.32, 1.1, 5);
      tooth.rotateX(Math.PI);
      for (let k = 1; k <= 7; k++) {
        const a = Math.PI * (0.12 + (0.76 * k) / 8);
        const x = TUNNEL.halfWidth * Math.cos(a) * 0.98;
        const h = y + WALL + (TUNNEL.crown - WALL) * Math.sin(a) - 0.5;
        add(k === 1 ? tooth : tooth.clone(), materials.extra, x, h, 0.15);
      }
      // Two glowing eyes above the mouth.
      const eye = new THREE.SphereGeometry(0.42, 10, 8);
      for (const s of [-1, 1]) add(s < 0 ? eye : eye.clone(), materials.lamp, s * 1.9, y + TUNNEL.crown + 1, 0.2);
    }
  }

  return {
    group,
    line,
    tunnel,
    /** Whether a point is inside the tunnel. */
    contains(x, y, z) {
      return insideTunnel(line, x, y, z);
    },
    /** 1 = solid; less lets the cart show through the hill from above and outside. */
    setFade(opacity) {
      const see = opacity < 0.99;
      for (const m of fading) {
        m.opacity = see ? opacity : 1;
        m.depthWrite = !see; // solid hills hide what's behind them; faded ones mustn't
      }
    },
    dispose() {
      geometries.forEach((g) => g.dispose());
      Object.values(materials).forEach((m) => m.dispose());
    },
  };
}
