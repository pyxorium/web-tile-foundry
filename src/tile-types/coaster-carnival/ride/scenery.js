import * as THREE from "three";
import { placeProps, landmarkSpot, sceneryRandom } from "./placement.js";
import { smoothFrames } from "./path.js";
import { TRACK_SIZES } from "./track-mesh.js";

// Everything around the track that gives a sense of place, depth and speed:
// a sky that glows at the horizon, a distant silhouette band, props near the
// track, one landmark, and theme touches (clouds, stars, a moon, bulbs along
// the track, mist).
//
// Phone care: everything is drawn in code (no picture files); repeated
// objects are one batch (InstancedMesh, or Points for glows); glow is faked
// with bright unlit materials and soft additive sprites, never real lights.
// Nothing here moves.
//
//   const scenery = buildScenery(track, theme);  scene.add(scenery.group);  scenery.dispose();

const SKY_RADIUS = 1900;
const BAND_RADIUS = 1250;

export function buildScenery(track, theme) {
  const group = new THREE.Group();
  const toDispose = [];
  const keep = (thing) => {
    toDispose.push(thing);
    return thing;
  };
  const glows = []; // [x, y, z, r, g, b, size] soft halos, all drawn in one batch at the end

  group.add(skyDome(theme, keep));
  group.add(horizonBand(theme, track, keep));

  const spots = placeProps(track, theme.props);
  for (const [kind, list] of Object.entries(spots)) {
    const made = PROPS[kind]?.(list, theme, keep, glows);
    if (made) group.add(made);
  }

  const landmark = theme.landmark === "haunted" ? hauntedHouse : ferrisWheel;
  group.add(landmark(landmarkSpot(track), theme, keep, glows));

  const x = theme.extras;
  if (x.clouds) group.add(clouds(track, keep));
  if (x.stars) group.add(stars(track, keep));
  if (x.moon) group.add(moon(theme, keep, glows));
  if (x.bulbs) group.add(trackBulbs(track, keep, glows));
  if (x.mist) group.add(mist(track, keep));

  if (glows.length) group.add(glowBatch(glows, keep));

  return {
    group,
    dispose() {
      toDispose.forEach((t) => t.dispose());
    },
  };
}

// ---------- sky and horizon ----------

function skyDome(theme, keep) {
  const geometry = keep(new THREE.SphereGeometry(SKY_RADIUS, 32, 16));
  const material = keep(
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(theme.skyTop) },
        horizon: { value: new THREE.Color(theme.horizon) },
        below: { value: new THREE.Color(theme.ground) },
      },
      vertexShader: "varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: [
        "uniform vec3 top; uniform vec3 horizon; uniform vec3 below; varying vec3 vDir;",
        "void main() {",
        "  float h = vDir.y;",
        // Glow hugs the horizon, then fades up to the top color.
        "  vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h * 2.2, 0.0, 1.0), 0.7)) : mix(horizon, below, clamp(-h * 6.0, 0.0, 1.0));",
        "  gl_FragColor = vec4(c, 1.0);",
        "  #include <colorspace_fragment>",
        "}",
      ].join("\n"),
    }),
  );
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

/** A ring of silhouettes all round the far edge: rolling hills, a city skyline, or a jagged treeline. */
function horizonBand(theme, track, keep) {
  const rand = sceneryRandom(track, 7);
  const steps = 360;
  const heights = [];
  if (theme.hillShape === "skyline") {
    // Blocks of buildings with gaps.
    let i = 0;
    while (i < steps) {
      const width = 2 + Math.floor(rand() * 5);
      const height = rand() < 0.15 ? 0 : 30 + rand() * 90;
      for (let k = 0; k < width && i < steps; k++, i++) heights.push(height);
    }
  } else {
    const waves = [1, 2, 3, 5, 8, 13].map((n) => ({ n, phase: rand() * Math.PI * 2, amp: rand() }));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      let h = waves.reduce((s, w) => s + Math.sin(a * w.n + w.phase) * w.amp, 0);
      h = 50 + h * 18;
      if (theme.hillShape === "treeline") h = 22 + h * 0.75; // a lower, rolling ridge; spires added below
      heights.push(Math.max(8, h));
    }
    if (theme.hillShape === "treeline") {
      // Now and then, at irregular gaps, a tall dead tree pokes up above the ridge.
      let i = Math.floor(rand() * 8);
      while (i < steps) {
        heights[i] += 18 + rand() * 55;
        i += 5 + Math.floor(rand() * 14);
      }
    }
  }
  const positions = [];
  for (let i = 0; i < steps; i++) {
    const a0 = (i / steps) * Math.PI * 2;
    const a1 = ((i + 1) / steps) * Math.PI * 2;
    const [x0, z0] = [Math.cos(a0) * BAND_RADIUS, Math.sin(a0) * BAND_RADIUS];
    const [x1, z1] = [Math.cos(a1) * BAND_RADIUS, Math.sin(a1) * BAND_RADIUS];
    const h0 = heights[i];
    const h1 = theme.hillShape === "skyline" ? heights[i] : heights[(i + 1) % steps];
    positions.push(x0, -5, z0, x1, -5, z1, x1, h1, z1, x0, -5, z0, x1, h1, z1, x0, h0, z0);
  }
  const geometry = keep(new THREE.BufferGeometry());
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const material = keep(new THREE.MeshBasicMaterial({ color: theme.hills, fog: false, side: THREE.DoubleSide }));
  const band = new THREE.Mesh(geometry, material);

  // A skyline gets a scatter of lit windows.
  if (theme.hillShape === "skyline") {
    const windows = [];
    for (let i = 0; i < steps; i++) {
      if (!heights[i]) continue;
      for (let k = 0; k < 3; k++) {
        if (rand() < 0.5) continue;
        const a = ((i + rand()) / steps) * Math.PI * 2;
        windows.push(Math.cos(a) * (BAND_RADIUS - 2), 6 + rand() * (heights[i] - 10), Math.sin(a) * (BAND_RADIUS - 2));
      }
    }
    const g = keep(new THREE.BufferGeometry());
    g.setAttribute("position", new THREE.Float32BufferAttribute(windows, 3));
    const m = keep(new THREE.PointsMaterial({ color: "#ffd98a", size: 2.2, sizeAttenuation: false, fog: false }));
    const group = new THREE.Group();
    group.add(band, new THREE.Points(g, m));
    return group;
  }
  return band;
}

// ---------- props near the track ----------

/** One batch of a shape at many spots. `place(spot, matrix)` may adjust each matrix. */
function batch(geometry, material, spots, keep, place) {
  keep(geometry);
  keep(material);
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, spots.length));
  mesh.count = spots.length;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  spots.forEach((spot, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), spot.turn);
    s.setScalar(spot.size);
    p.set(spot.x, 0, spot.z);
    m.compose(p, q, s);
    if (place) place(spot, m, i);
    mesh.setMatrixAt(i, m);
  });
  return mesh;
}

const lit = (color, roughness = 0.9) => new THREE.MeshStandardMaterial({ color, roughness });

const PROPS = {
  tree(spots, theme, keep) {
    const g = new THREE.Group();
    const trunk = new THREE.CylinderGeometry(0.35, 0.5, 3, 6).translate(0, 1.5, 0);
    const leaves = new THREE.ConeGeometry(2.6, 7, 7).translate(0, 6, 0);
    g.add(batch(trunk, lit(theme.propColors.trunk), spots, keep), batch(leaves, lit(theme.propColors.leaves), spots, keep));
    return g;
  },

  deadTree(spots, theme, keep) {
    // A bare trunk with three crooked branches, merged into one shape.
    const parts = [new THREE.CylinderGeometry(0.25, 0.55, 7, 5).translate(0, 3.5, 0)];
    for (const [angle, height, lean] of [[0, 4.5, 0.9], [2.1, 5.5, 0.7], [4.2, 3.8, 1.0]]) {
      const b = new THREE.CylinderGeometry(0.08, 0.2, 3.2, 4).translate(0, 1.6, 0);
      b.rotateZ(lean).rotateY(angle).translate(0, height, 0);
      parts.push(b);
    }
    return batch(mergeGeometries(parts), lit(theme.propColors.trunk), spots, keep);
  },

  tent(spots, theme, keep, glows) {
    // Round striped tent: plain wall, striped cone roof, a pennant on top and
    // a doorway at the front (lit from inside at night).
    const c = theme.propColors;
    const wall = colored(new THREE.CylinderGeometry(3.2, 3.2, 2.6, 12, 1, true).translate(0, 1.3, 0), c.tentB);
    const roof = striped(new THREE.ConeGeometry(3.7, 3, 12).translate(0, 4.1, 0), c.tentA, c.tentB, 12, "around");
    const pole = colored(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 4).translate(0, 6.2, 0), c.wood);
    const flag = colored(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([0, 6.95, 0, 0, 6.35, 0, 1.1, 6.65, 0], 3)), c.tentC);
    flag.computeVertexNormals();
    const body = mergeGeometries([wall, roof, pole, flag]);
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
    const big = spots.map((s) => ({ ...s, size: s.size * 1.3 }));
    const g = new THREE.Group();
    g.add(batch(body, material, big, keep));
    g.add(doorways(big, theme, keep, glows, { width: 1.5, height: 2.1, forward: 3.22 }));
    return g;
  },

  stand(spots, theme, keep, glows) {
    // Food stand: a counter, a back wall, corner posts, a striped awning and a sign on top.
    const c = theme.propColors;
    const parts = [
      colored(new THREE.BoxGeometry(3.6, 1.1, 1.4).translate(0, 0.55, 0.4), c.wood), // counter
      colored(new THREE.BoxGeometry(3.6, 2.8, 0.15).translate(0, 1.4, -0.75), c.tentB), // back wall
      colored(new THREE.BoxGeometry(0.15, 2.8, 1.6).translate(-1.75, 1.4, 0), c.tentB), // sides
      colored(new THREE.BoxGeometry(0.15, 2.8, 1.6).translate(1.75, 1.4, 0), c.tentB),
      striped(new THREE.BoxGeometry(4, 0.12, 2.1, 8, 1, 1).rotateX(0.22).translate(0, 2.95, 0.55), c.tentA, c.tentB, 8, "across", 4),
    ];
    const g = new THREE.Group();
    g.add(batch(mergeGeometries(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), spots, keep));
    g.add(signs(spots, theme, keep, glows, { width: 2.6, height: 0.75, y: 3.65, z: 0.1 }));
    g.add(doorways(spots, theme, keep, glows, { width: 3.2, height: 1.5, forward: -0.66, y: 1.9, glowForward: 0.4 }));
    return g;
  },

  booth(spots, theme, keep, glows) {
    // Game booth: open-fronted box with a striped awning, a shelf of prizes and a sign.
    const c = theme.propColors;
    const prizeColors = [c.tentA, c.tentC, c.sign, "#7dff6b", "#ffffff"];
    const prizes = prizeColors.map((col, i) => colored(new THREE.SphereGeometry(0.22, 8, 6).translate(-1 + i * 0.5, 1.55, -0.5), col));
    const parts = [
      colored(new THREE.BoxGeometry(3, 0.9, 0.5).translate(0, 0.45, 0.85), c.tentA), // front counter
      colored(new THREE.BoxGeometry(3, 2.7, 0.15).translate(0, 1.35, -0.9), c.tentB), // back
      colored(new THREE.BoxGeometry(0.15, 2.7, 1.9).translate(-1.45, 1.35, 0), c.tentC), // sides
      colored(new THREE.BoxGeometry(0.15, 2.7, 1.9).translate(1.45, 1.35, 0), c.tentC),
      colored(new THREE.BoxGeometry(2.7, 0.08, 0.5).translate(0, 1.3, -0.55), c.wood), // shelf
      striped(new THREE.BoxGeometry(3.4, 0.12, 1.6, 6, 1, 1).rotateX(0.25).translate(0, 2.85, 0.6), c.tentC, c.tentB, 6, "across", 3.4),
      ...prizes,
    ];
    const g = new THREE.Group();
    g.add(batch(mergeGeometries(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), spots, keep));
    g.add(signs(spots, theme, keep, glows, { width: 2.2, height: 0.7, y: 3.5, z: 0.2, color: c.tentC }));
    return g;
  },

  lamp(spots, theme, keep, glows) {
    const post = new THREE.CylinderGeometry(0.1, 0.14, 5, 5).translate(0, 2.5, 0);
    const head = new THREE.SphereGeometry(0.35, 8, 6).translate(0, 5.1, 0);
    const g = new THREE.Group();
    const headMat = new THREE.MeshBasicMaterial({ color: theme.lampGlow ? "#ffe9a8" : "#d8d8d8" });
    g.add(batch(post, lit(theme.propColors.lamp, 0.6), spots, keep), batch(head, headMat, spots, keep));
    if (theme.lampGlow) {
      for (const s of spots) glows.push([s.x, 5.1 * s.size, s.z, 1, 0.85, 0.5, 9 * s.size]);
      // A soft warm pool of light on the ground under each lamp.
      const pool = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      const poolMat = new THREE.MeshBasicMaterial({ map: keep(softDisc(64, [255, 214, 140])), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
      const pools = batch(pool, poolMat, spots, keep, (spot, m) => {
        const size = 14 * spot.size;
        m.makeScale(size, 1, size).setPosition(spot.x, 0.05, spot.z);
      });
      pools.renderOrder = 1;
      g.add(pools);
    }
    return g;
  },

  balloon(spots, theme, keep) {
    const colors = theme.propColors.balloon;
    const ball = new THREE.SphereGeometry(1.5, 12, 10).scale(1, 1.2, 1);
    const mat = keep(new THREE.MeshStandardMaterial({ roughness: 0.4 }));
    const mesh = batch(ball, mat, spots, keep, (spot, m) => m.setPosition(spot.x, 10 + spot.size * 9, spot.z));
    spots.forEach((_, i) => mesh.setColorAt(i, new THREE.Color(colors[i % colors.length])));
    return mesh;
  },

  grave(spots, theme, keep) {
    const stone = new THREE.BoxGeometry(0.9, 1.3, 0.25).translate(0, 0.65, 0);
    return batch(stone, lit(theme.propColors.grave, 1), spots, keep, (spot, m) => {
      const tilt = new THREE.Matrix4().makeRotationX((spot.size - 1) * 0.5);
      m.multiply(tilt);
    });
  },

  pumpkin(spots, theme, keep, glows) {
    const ball = new THREE.SphereGeometry(0.45, 10, 8).scale(1, 0.75, 1).translate(0, 0.32, 0);
    const mat = new THREE.MeshBasicMaterial({ color: theme.propColors.pumpkin });
    for (const s of spots) glows.push([s.x, 0.5, s.z, 1, 0.5, 0.1, 4]);
    return batch(ball, mat, spots, keep);
  },
};

// ---------- landmarks ----------

function ferrisWheel(spot, theme, keep, glows) {
  const g = new THREE.Group();
  const R = 22;
  const hub = R + 6;
  const metal = keep(new THREE.MeshStandardMaterial({ color: theme.landmarkColor, metalness: 0.4, roughness: 0.5 }));
  if (theme.glow) metal.emissive = new THREE.Color(theme.landmarkColor).multiplyScalar(0.35);
  const rim = new THREE.Mesh(keep(new THREE.TorusGeometry(R, 0.45, 6, 64)), metal);
  rim.position.y = hub;
  g.add(rim);
  const spokes = 16;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const spoke = new THREE.Mesh(keep(new THREE.BoxGeometry(0.25, R, 0.25)), metal);
    spoke.position.set((Math.cos(a) * R) / 2, hub + (Math.sin(a) * R) / 2, 0);
    spoke.rotation.z = a - Math.PI / 2;
    g.add(spoke);
    const car = new THREE.Mesh(keep(new THREE.BoxGeometry(2, 1.8, 2)), metal);
    car.position.set(Math.cos(a) * R, hub + Math.sin(a) * R - 1.4, 0);
    g.add(car);
    if (theme.glow) glows.push(["local", Math.cos(a) * R, hub + Math.sin(a) * R, 0, 1, 0.8, 0.35, 10]);
  }
  for (const side of [-1, 1]) {
    for (const lean of [-1, 1]) {
      const leg = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.4, 0.6, hub + 2, 6)), metal);
      leg.position.set(lean * 7, hub / 2, side * 2.5);
      leg.rotation.z = -lean * Math.atan(7 / hub);
      g.add(leg);
    }
  }
  return place(g, spot, glows);
}

function hauntedHouse(spot, theme, keep, glows) {
  const g = new THREE.Group();
  const hillMat = keep(new THREE.MeshStandardMaterial({ color: "#241c22", roughness: 1 }));
  const hill = new THREE.Mesh(keep(new THREE.SphereGeometry(45, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2)), hillMat);
  hill.scale.set(1, 0.32, 1);
  g.add(hill);
  const top = 14;
  const wall = keep(new THREE.MeshStandardMaterial({ color: theme.landmarkColor, roughness: 1 }));
  const box = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(keep(new THREE.BoxGeometry(w, h, d)), wall);
    m.position.set(x, top + y, z);
    g.add(m);
  };
  const roof = (r, h, x, y, z, sides = 4) => {
    const m = new THREE.Mesh(keep(new THREE.ConeGeometry(r, h, sides)), wall);
    m.position.set(x, top + y, z);
    m.rotation.y = Math.PI / 4;
    g.add(m);
  };
  box(16, 10, 10, 0, 5, 0);
  roof(12, 7, 0, 13.5, 0);
  box(5, 20, 5, 9, 10, 1); // tower
  roof(4.5, 8, 9, 24, 1, 8);
  box(1.4, 5, 1.4, -5, 12, -2); // chimney
  // Lit windows facing the ride.
  const windowMat = keep(new THREE.MeshBasicMaterial({ color: "#ffc45c" }));
  for (const [x, y] of [[-5, 4], [0, 4], [5, 4], [-5, 8], [5, 8], [9, 16], [9, 11]]) {
    const w = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.4, 1.9)), windowMat);
    w.position.set(x, top + y, x === 9 ? 3.6 : 5.05);
    g.add(w);
    glows.push(["local", x, top + y, 6, 1, 0.7, 0.3, 6]);
  }
  return place(g, spot, glows);
}

/** Moves a landmark to its spot (facing the ride) and turns its "local" glows into world positions. */
function place(group, spot, glows) {
  group.position.set(spot.x, 0, spot.z);
  group.rotation.y = spot.facing;
  group.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  for (let i = 0; i < glows.length; i++) {
    const g = glows[i];
    if (g[0] !== "local") continue;
    v.set(g[1], g[2], g[3]).applyMatrix4(group.matrixWorld);
    glows[i] = [v.x, v.y, v.z, g[4], g[5], g[6], g[7]];
  }
  return group;
}

// ---------- theme touches ----------

function clouds(track, keep) {
  const rand = sceneryRandom(track, 11);
  const puffs = [];
  for (let c = 0; c < 22; c++) {
    const a = rand() * Math.PI * 2;
    const d = 300 + rand() * 900;
    const [cx, cy, cz] = [Math.cos(a) * d, 130 + rand() * 120, Math.sin(a) * d];
    const n = 3 + Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) puffs.push({ x: cx + (rand() - 0.5) * 70, y: cy + rand() * 12, z: cz + (rand() - 0.5) * 30, size: 14 + rand() * 18 });
  }
  const geometry = keep(new THREE.SphereGeometry(1, 10, 6).scale(1, 0.45, 0.8));
  const material = keep(new THREE.MeshBasicMaterial({ color: "#ffffff", fog: false, transparent: true, opacity: 0.92 }));
  const mesh = new THREE.InstancedMesh(geometry, material, puffs.length);
  const m = new THREE.Matrix4();
  puffs.forEach((p, i) => mesh.setMatrixAt(i, m.makeScale(p.size, p.size, p.size).setPosition(p.x, p.y, p.z)));
  return mesh;
}

function stars(track, keep) {
  const rand = sceneryRandom(track, 13);
  const positions = [];
  for (let i = 0; i < 900; i++) {
    const a = rand() * Math.PI * 2;
    const y = 0.08 + rand() * 0.92; // above the horizon band
    const r = Math.sqrt(1 - y * y);
    positions.push(Math.cos(a) * r * 1700, y * 1700, Math.sin(a) * r * 1700);
  }
  const geometry = keep(new THREE.BufferGeometry());
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const material = keep(new THREE.PointsMaterial({ color: "#ffffff", size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }));
  return new THREE.Points(geometry, material);
}

function moon(theme, keep, glows) {
  const pos = new THREE.Vector3(-0.45, 0.42, -0.79).normalize().multiplyScalar(1500);
  const mesh = new THREE.Mesh(keep(new THREE.SphereGeometry(55, 24, 16)), keep(new THREE.MeshBasicMaterial({ color: theme.moon, fog: false })));
  mesh.position.copy(pos);
  glows.push([pos.x, pos.y, pos.z, 0.9, 0.9, 0.8, 520]);
  return mesh;
}

/** Light bulbs along both sides of the track, every 3 m, in carnival colors. */
function trackBulbs(track, keep, glows) {
  const frames = smoothFrames(track, 1);
  const every = Math.max(1, Math.round(3 / track.spacing));
  const colors = ["#ff4fb8", "#ffd23f", "#35e0ff", "#7dff6b", "#ffffff"].map((c) => new THREE.Color(c));
  const spots = [];
  for (let i = 0; i < frames.length; i += every) {
    const { p, up, side } = frames[i];
    for (const s of [-1, 1]) {
      const o = (TRACK_SIZES.GAUGE / 2 + 0.12) * s;
      spots.push([p[0] + side[0] * o + up[0] * 0.05, p[1] + side[1] * o + up[1] * 0.05, p[2] + side[2] * o + up[2] * 0.05]);
    }
  }
  const geometry = keep(new THREE.SphereGeometry(0.11, 6, 4));
  const material = keep(new THREE.MeshBasicMaterial());
  const mesh = new THREE.InstancedMesh(geometry, material, spots.length);
  const m = new THREE.Matrix4();
  spots.forEach(([x, y, z], i) => {
    mesh.setMatrixAt(i, m.makeTranslation(x, y, z));
    const c = colors[Math.floor(i / 2) % colors.length];
    mesh.setColorAt(i, c);
    if (i % 2 === 0) glows.push([x, y, z, c.r, c.g, c.b, 0.55]);
  });
  return mesh;
}

/** Low drifting mist: a few big soft patches just above the ground. */
function mist(track, keep) {
  const rand = sceneryRandom(track, 17);
  const texture = keep(softDisc(128, [255, 255, 255]));
  const material = keep(new THREE.MeshBasicMaterial({ map: texture, color: "#c9b8d8", transparent: true, opacity: 0.13, depthWrite: false }));
  const geometry = keep(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  const b = track.bounds;
  const count = 26;
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const size = 60 + rand() * 90;
    const x = b.min[0] - 40 + rand() * (b.size[0] + 80);
    const z = b.min[2] - 40 + rand() * (b.size[2] + 80);
    mesh.setMatrixAt(i, m.makeScale(size, 1, size).setPosition(x, 0.6 + rand() * 1.8, z));
  }
  mesh.renderOrder = 2;
  return mesh;
}

// ---------- soft glows ----------

/** A soft round spot drawn on a small canvas: bright middle fading to nothing. */
function softDisc(size, [r, g, b]) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
  grad.addColorStop(0.35, `rgba(${r},${g},${b},0.45)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** All halos (lamps, bulbs, windows, pumpkins, moon) in one batch of additive soft points. */
function glowBatch(glows, keep) {
  const positions = [];
  const colors = [];
  const sizes = [];
  for (const [x, y, z, r, g, b, s] of glows) {
    positions.push(x, y, z);
    colors.push(r, g, b);
    sizes.push(s);
  }
  const geometry = keep(new THREE.BufferGeometry());
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("size", new THREE.Float32BufferAttribute(sizes, 1));
  const texture = keep(softDisc(64, [255, 255, 255]));
  const material = keep(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { map: { value: texture }, scale: { value: 600 } },
      vertexShader: [
        "attribute float size; attribute vec3 color; varying vec3 vColor; uniform float scale;",
        "void main() { vColor = color; vec4 mv = modelViewMatrix * vec4(position, 1.0);",
        "  gl_PointSize = clamp(size * scale / -mv.z, 1.0, 256.0); gl_Position = projectionMatrix * mv; }",
      ].join("\n"),
      fragmentShader: "uniform sampler2D map; varying vec3 vColor; void main() { vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vColor * t.a, t.a); }",
    }),
  );
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 5;
  return points;
}

// ---------- helpers ----------

/** Joins simple geometries into one (keeping per-vertex colors when every part has them). */
function mergeGeometries(list) {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const withColor = parts.every((p) => p.attributes.color);
  let count = 0;
  for (const p of parts) count += p.attributes.position.count;
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const color = withColor ? new Float32Array(count * 3) : null;
  let offset = 0;
  for (const p of parts) {
    if (!p.attributes.normal) p.computeVertexNormals();
    position.set(p.attributes.position.array, offset * 3);
    normal.set(p.attributes.normal.array, offset * 3);
    if (color) color.set(p.attributes.color.array, offset * 3);
    offset += p.attributes.position.count;
  }
  new Set([...list, ...parts]).forEach((g) => g.dispose());
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(position, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  if (color) out.setAttribute("color", new THREE.BufferAttribute(color, 3));
  return out;
}

/** The geometry painted one color (as per-vertex color, so several can share one material). */
function colored(geometry, hex) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g !== geometry) geometry.dispose();
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
}

/**
 * The geometry painted in alternating stripes of two colors: "around" the
 * vertical axis (tent roofs), or "across" from left to right (awnings, `span` meters wide).
 */
function striped(geometry, hexA, hexB, count, direction, span = 1) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g !== geometry) geometry.dispose();
  const [a, b] = [new THREE.Color(hexA), new THREE.Color(hexB)];
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let t = 0; t < pos.count; t += 3) {
    // One color per triangle, from where its middle sits.
    const x = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3;
    const z = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
    const k = direction === "around" ? Math.floor(((Math.atan2(z, x) + Math.PI) / (2 * Math.PI)) * count) : Math.floor(((x + span / 2) / span) * count);
    const c = ((k % 2) + 2) % 2 ? a : b;
    for (let v = 0; v < 3; v++) colors.set([c.r, c.g, c.b], (t + v) * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
}

/** Doorways (or serving windows) on the front of tents and stands: dark by day, glowing warmly at night. */
function doorways(spots, theme, keep, glows, { width, height, forward, y = height / 2, glowForward = forward }) {
  const night = theme.glow > 0.5;
  const plane = new THREE.PlaneGeometry(width, height).translate(0, y, forward + 0.02);
  const material = new THREE.MeshBasicMaterial({ color: theme.propColors.door, side: THREE.DoubleSide });
  const mesh = batch(plane, material, spots, keep);
  if (night) {
    const v = new THREE.Vector3();
    for (const s of spots) {
      v.set(0, y * s.size, (glowForward + 0.6) * s.size).applyAxisAngle(new THREE.Vector3(0, 1, 0), s.turn);
      glows.push([s.x + v.x, v.y, s.z + v.z, 1, 0.7, 0.35, 7 * s.size]);
    }
  }
  return mesh;
}

/** A sign board on top of stands and booths, lit at night. */
function signs(spots, theme, keep, glows, { width, height, y, z, color = theme.propColors.sign }) {
  const night = theme.glow > 0.5;
  const board = new THREE.BoxGeometry(width, height, 0.12).translate(0, y, z);
  const material = night ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const mesh = batch(board, material, spots, keep);
  if (night) {
    const c = new THREE.Color(color);
    const v = new THREE.Vector3();
    for (const s of spots) {
      v.set(0, y * s.size, (z + 0.4) * s.size).applyAxisAngle(new THREE.Vector3(0, 1, 0), s.turn);
      glows.push([s.x + v.x, v.y, s.z + v.z, c.r, c.g, c.b, 6 * s.size]);
    }
  }
  return mesh;
}
