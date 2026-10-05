import * as THREE from "three";
import { frameBetween } from "./path.js";

// The track switch's two signs, both showing which way each route goes
// ("← Thrill   Chill →"; the words come from the theme, the arrows from the
// side the thrill route actually leaves on):
//
//   the fork sign     on a frame over the track just before the routes part,
//                     facing the oncoming cart
//   the station sign  on the front edge of the station roof, ahead of the cart
//                     at rest, so the behind-the-cart view sees it while the
//                     viewer chooses. Two lines: "Fork ahead!" over the arrows.
//
// Both can light up the chosen route (the other dims) and, while waiting for
// a choice, pulse; the station sign's top line can change (at the end of the
// ride, a nudge toward the other route).

const FORK = { before: 6, clear: 4.2, w: 7, h: 1.6 }; // m: before the routes part, rails to board, board size
// The station roof's underside is 5.9 m above the rails (see scene.js); the
// board stays below it, and well above the riding camera (2.6 m up) as the
// cart rolls out under it.
const STATION = { ahead: 8.3, bottom: 3.5, w: 5.6, h: 1.65 }; // m: ahead of the cart (the roof's front edge), rails to board, board size

/** Which side the thrill route leaves on, as seen riding: "left" or "right". */
export function thrillSide(track) {
  const sw = track.trackSwitch;
  const at = frameBetween(track, sw.chill.from, 0);
  const ahead = sw.thrill.points[Math.min(sw.thrill.to, sw.thrill.from + 15)];
  const d = [ahead[0] - at.p[0], ahead[1] - at.p[1], ahead[2] - at.p[2]];
  // `side` is the rider's left.
  return d[0] * at.side[0] + d[1] * at.side[1] + d[2] * at.side[2] > 0 ? "left" : "right";
}

/**
 * A sign face drawn on a canvas, redrawn when its state changes:
 *   { chosen: null | "chill" | "thrill", top: null | string, pulse: 0..1 }
 */
function signFace(theme, side, lines, aspect) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = Math.round(1024 / aspect);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const g = canvas.getContext("2d");
  const { board, text } = theme.signColors;
  const [left, right] = side === "left" ? ["thrill", "chill"] : ["chill", "thrill"];
  let last = "";

  function draw({ chosen = null, top = null, pulse = 0 } = {}) {
    const key = JSON.stringify([chosen, top, Math.round(pulse * 10)]);
    if (key === last) return;
    last = key;
    const W = canvas.width;
    const H = canvas.height;
    g.fillStyle = board;
    g.fillRect(0, 0, W, H);
    g.strokeStyle = text;
    g.lineWidth = 10;
    g.strokeRect(14, 14, W - 28, H - 28);
    g.textBaseline = "middle";
    const rowY = lines === 2 ? H * 0.7 : H / 2 + 4;
    const size = Math.round(lines === 2 ? H * 0.3 : H * 0.4);
    const plate = Math.round(size * 1.3);
    if (lines === 2) {
      g.fillStyle = text;
      g.font = `bold ${size}px system-ui, sans-serif`;
      g.textAlign = "center";
      g.fillText(top ?? "Fork ahead!", W / 2, H * 0.3);
    }
    g.font = `bold ${size}px system-ui, sans-serif`;
    for (const [route, x, align, label] of [
      [left, 50, "left", `← ${theme.routes[left]}`],
      [right, W - 50, "right", `${theme.routes[right]} →`],
    ]) {
      const lit = chosen === route;
      const dim = chosen && !lit;
      g.textAlign = align;
      const width = g.measureText(label).width;
      const x0 = align === "left" ? x - 18 : x - width - 18;
      // A lit route gets a bright plate behind it; while waiting, both plates glow and fade.
      const glow = lit ? 1 : chosen ? 0 : pulse;
      if (glow > 0) {
        g.globalAlpha = 0.85 * glow;
        g.fillStyle = text;
        g.fillRect(x0, rowY - plate / 2, width + 36, plate);
        g.globalAlpha = 1;
      }
      g.fillStyle = glow > 0.5 ? board : text;
      g.globalAlpha = dim ? 0.35 : 1;
      g.fillText(label, x, rowY + 2);
      g.globalAlpha = 1;
    }
    texture.needsUpdate = true;
  }
  draw();
  return { texture, draw };
}

/** A board (with a backing) at `position`, facing `toward` (a level direction). */
function board(face, w, h, frameMaterial, position, toward, group, geometries) {
  const g = new THREE.PlaneGeometry(w, h);
  geometries.push(g);
  const front = new THREE.Mesh(g, face);
  front.position.copy(position);
  front.lookAt(position.clone().add(toward));
  group.add(front);
  const backGeometry = new THREE.BoxGeometry(w + 0.2, h + 0.2, 0.12);
  geometries.push(backGeometry);
  const back = new THREE.Mesh(backGeometry, frameMaterial);
  back.position.copy(position).addScaledVector(toward, -0.08);
  back.quaternion.copy(front.quaternion);
  group.add(back);
}

/**
 * Builds both signs for a track with a switch. Returns
 * { group, show(state), dispose } (show updates both signs; see signFace),
 * or null without a switch.
 */
export function buildSwitchSigns(track, theme) {
  const sw = track.trackSwitch;
  if (!sw || typeof document === "undefined") return null;
  const side = thrillSide(track);
  const group = new THREE.Group();
  const geometries = [];
  const frameMaterial = new THREE.MeshStandardMaterial({ color: theme.signColors.board, roughness: 0.7 });
  const fork = signFace(theme, side, 1, FORK.w / FORK.h);
  const station = signFace(theme, side, 2, STATION.w / STATION.h);
  const forkMaterial = new THREE.MeshBasicMaterial({ map: fork.texture, fog: true });
  const stationMaterial = new THREE.MeshBasicMaterial({ map: station.texture, fog: true });
  const level = (f) => new THREE.Vector3(f.t[0], 0, f.t[2]).normalize();

  // The fork sign: posts either side from the ground, the board over the track.
  {
    const f = frameBetween(track, Math.max(0, sw.chill.from - Math.round(FORK.before / track.spacing)), 0);
    const flat = level(f);
    const left = new THREE.Vector3(0, 1, 0).cross(flat);
    const base = new THREE.Vector3(...f.p);
    const top = base.y + FORK.clear + FORK.h;
    for (const s of [-1, 1]) {
      const g = new THREE.CylinderGeometry(0.14, 0.18, top, 8);
      geometries.push(g);
      const post = new THREE.Mesh(g, frameMaterial);
      post.position.copy(base).addScaledVector(left, s * (FORK.w / 2 + 0.3));
      post.position.y = top / 2;
      group.add(post);
    }
    const at = base.clone();
    at.y = base.y + FORK.clear + FORK.h / 2;
    board(forkMaterial, FORK.w, FORK.h, frameMaterial, at, flat.clone().negate(), group, geometries);
  }

  // The station sign: on the front edge of the station roof (see scene.js), ahead of the cart at rest.
  {
    const f = frameBetween(track, 0, 0);
    const flat = level(f);
    const at = new THREE.Vector3(...f.p).addScaledVector(flat, STATION.ahead);
    at.y = f.p[1] + STATION.bottom + STATION.h / 2;
    board(stationMaterial, STATION.w, STATION.h, frameMaterial, at, flat.clone().negate(), group, geometries);
  }

  return {
    group,
    side,
    /** Updates both signs: { chosen, top (station sign only), pulse }. */
    show(state) {
      fork.draw({ chosen: state.chosen, pulse: state.pulse });
      station.draw(state);
    },
    dispose() {
      geometries.forEach((x) => x.dispose());
      [frameMaterial, forkMaterial, stationMaterial].forEach((x) => x.dispose());
      fork.texture.dispose();
      station.texture.dispose();
    },
  };
}
