import { Quaternion, Vector3 } from "three";
import { pickFace, faceTowards, tumbleAt, easeInOut, isTap, glowAt, secureRandom, makeRollCurve, ROLL_DEFAULTS } from "./roll.js";

// Viewer interaction for a lantern on a canvas (used by the look lab now and
// by the tile in stage 5):
//
//   drag            turn it; let go while moving and it glides, slowing down
//   tap / click     roll: tumbles and settles with a fair random pane facing you,
//                   which glows for a moment
//   pinch / wheel   zoom (the wheel only while the pointer is over the lantern,
//                   so it never traps page scrolling elsewhere)
//   slow turn       a gentle turn when nobody is touching it (can be switched off)
//   reset()         back to the starting view (the gear menu's "Reset view")
//
// Pointer handling follows the user's proven pinch fix (bobindex.html / the Bob
// tile): every pointer is tracked by id; the lantern turns only while exactly
// one pointer is down; a second finger cancels the drag; when one finger of a
// pinch lifts, the drag restarts from the finger that is left.
//
// Reduced motion (the viewer's system setting): starts still, and a roll is a
// quick fade to the new face instead of a tumble.

const DRAG_RAD_PER_PX = 0.009;
const GLIDE_DAMPING = 2.2; //   per second: how fast a flick slows down
const GLIDE_MAX = 9; //         rad/s
const FLICK_IDLE_MS = 90; //    holding still this long before letting go means no glide
const WHEEL_ZOOM = 0.0015;
const FADE_SECONDS = 0.18;
const RESET_SECONDS = 0.6;

export function createInteraction({ canvas, lantern, slowTurn = true, slowTurnSpeed = 0.25, onRoll } = {}) {
  const reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const group = lantern.group;
  const home = group.quaternion.clone(); // the starting view, for reset
  const state = {
    slowTurn: slowTurn && !reducedMotion,
    slowTurnSpeed,
    spin: new Vector3(), //   glide: angular velocity (world axes), rad/s
    roll: null, //            { from, to, axis, turns, t, face, fade }
    reset: null, //           { from, to, zoomFrom, t }
    glow: null, //            { face, t }
  };
  const up = new Vector3(0, 1, 0);
  const right = new Vector3(1, 0, 0);
  const tmpQ = new Quaternion();

  // ---------- pointers (the pinch fix) ----------
  const pointers = new Map();
  let last = null; //        { x, y, t } of the dragging pointer
  let gesture = null; //     { x, y, t, moved, fingers } for telling taps from drags
  let pinchDist = null;
  let dragVel = { x: 0, y: 0 };

  function startDrag(x, y) {
    last = { x, y, t: performance.now() };
    dragVel = { x: 0, y: 0 };
    state.spin.set(0, 0, 0); // touching it stops a glide
  }

  canvas.addEventListener("pointerdown", (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* some browsers refuse capture for synthetic events */
    }
    if (pointers.size === 1) {
      gesture = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0, fingers: 1 };
      startDrag(e.clientX, e.clientY);
    } else {
      if (gesture) gesture.fingers = Math.max(gesture.fingers, pointers.size);
      last = null; // a second finger: no turning while pinching
      state.spin.set(0, 0, 0);
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist) lantern.setZoom(lantern.zoom * (d / pinchDist));
      pinchDist = d;
      return;
    }
    if (pointers.size !== 1 || !last) return; // turn only with exactly one pointer
    const now = performance.now();
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    if (gesture) gesture.moved = Math.max(gesture.moved, Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y));
    if (gesture && gesture.moved <= 3) return; // ignore jitter until it is clearly a drag
    cancelAutomatic();
    turnBy(dx * DRAG_RAD_PER_PX, dy * DRAG_RAD_PER_PX);
    const dt = Math.max((now - last.t) / 1000, 0.008);
    dragVel = { x: 0.5 * dragVel.x + 0.5 * ((dy * DRAG_RAD_PER_PX) / dt), y: 0.5 * dragVel.y + 0.5 * ((dx * DRAG_RAD_PER_PX) / dt) };
    last = { x: e.clientX, y: e.clientY, t: now };
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = null;
    if (pointers.size === 1) {
      // 2 -> 1 fingers: carry on dragging from the finger that is left.
      const r = [...pointers.values()][0];
      startDrag(r.x, r.y);
      return;
    }
    if (pointers.size > 0) return;
    // Last finger up: a tap rolls; a quick release while moving glides.
    const now = performance.now();
    if (gesture && e.type === "pointerup" && isTap({ moved: gesture.moved, ms: now - gesture.t, fingers: gesture.fingers })) {
      roll();
    } else if (last && now - last.t < FLICK_IDLE_MS) {
      const clamp = (v) => Math.max(-GLIDE_MAX, Math.min(GLIDE_MAX, v));
      state.spin.set(clamp(dragVel.x), clamp(dragVel.y), 0);
    }
    last = null;
    gesture = null;
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("lostpointercapture", endPointer);

  // Wheel and trackpad zoom, only while over the lantern itself.
  canvas.addEventListener(
    "wheel",
    (e) => {
      const rect = canvas.getBoundingClientRect();
      const c = lantern.screenCircle();
      if (Math.hypot(e.clientX - rect.left - c.x, e.clientY - rect.top - c.y) > c.r) return; // let the page scroll
      e.preventDefault();
      lantern.setZoom(lantern.zoom * Math.exp(-e.deltaY * WHEEL_ZOOM));
    },
    { passive: false }
  );

  // ---------- turning ----------
  function turnBy(aboutY, aboutX) {
    group.quaternion.premultiply(tmpQ.setFromAxisAngle(up, aboutY));
    group.quaternion.premultiply(tmpQ.setFromAxisAngle(right, aboutX));
  }
  function cancelAutomatic() {
    if (state.roll) {
      // Grabbing mid-roll: stop where it is and drop the result.
      state.roll = null;
      if (canvas.style.opacity) canvas.style.opacity = "";
    }
    state.reset = null;
  }

  // ---------- rolling ----------
  function roll() {
    const shape = lantern.shape;
    if (!shape) return;
    cancelAutomatic();
    state.spin.set(0, 0, 0);
    const face = pickFace(shape.faces.length);
    const to = faceTowards(shape.normals[face], lantern.viewDirection().toArray(), (secureRandom() - 0.5) * Math.PI * 0.6);
    const axis = new Vector3(secureRandom() - 0.5, secureRandom() - 0.5, secureRandom() - 0.5).normalize();
    // The roll's feel comes from the lantern's settings (tunable in the lab).
    const feel = { ...ROLL_DEFAULTS };
    const eff = lantern.effective || {};
    for (const k of Object.keys(ROLL_DEFAULTS)) if (typeof eff[k] === "number") feel[k] = eff[k];
    const curve = makeRollCurve(feel);
    state.roll = { from: group.quaternion.clone(), to, axis, turns: curve.spins, curve, t: 0, face, fade: reducedMotion };
    state.glow = null;
    lantern.setHighlight(-1, 0);
    if (onRoll) onRoll({ face, rolling: true });
  }

  function reset() {
    cancelAutomatic();
    state.spin.set(0, 0, 0);
    state.reset = { from: group.quaternion.clone(), to: home.clone(), zoomFrom: lantern.zoom, t: 0 };
  }

  /** Call every frame with the seconds since the last frame. Returns true if anything moved. */
  function update(dt) {
    let moved = false;
    if (state.roll) {
      const r = state.roll;
      r.t += dt;
      if (r.fade) {
        // Reduced motion: fade out, jump to the face, fade in.
        const half = FADE_SECONDS;
        if (r.t < half) canvas.style.opacity = String(1 - r.t / half);
        else {
          group.quaternion.copy(r.to);
          canvas.style.opacity = String(Math.min(1, (r.t - half) / half));
        }
        if (r.t >= 2 * half) finishRoll();
      } else {
        tumbleAt(r.from, r.to, r.axis, r.turns, r.curve.progress(r.t), group.quaternion);
        if (r.t >= r.curve.duration) finishRoll();
      }
      moved = true;
    } else if (state.reset) {
      const r = state.reset;
      r.t += dt;
      const e = easeInOut(Math.min(1, r.t / RESET_SECONDS));
      group.quaternion.slerpQuaternions(r.from, r.to, e);
      lantern.setZoom(r.zoomFrom + (1 - r.zoomFrom) * e);
      if (r.t >= RESET_SECONDS) state.reset = null;
      moved = true;
    } else if (state.spin.lengthSq() > 1e-6) {
      turnBy(state.spin.y * dt, state.spin.x * dt);
      state.spin.multiplyScalar(Math.exp(-GLIDE_DAMPING * dt));
      moved = true;
    } else if (state.slowTurn && pointers.size === 0 && !state.glow) {
      group.quaternion.premultiply(tmpQ.setFromAxisAngle(up, state.slowTurnSpeed * dt));
      moved = true;
    }
    if (state.glow) {
      state.glow.t += dt;
      const g = glowAt(state.glow.t);
      lantern.setHighlight(state.glow.face, g);
      if (g <= 0) {
        state.glow = null;
        lantern.setHighlight(-1, 0);
      }
      moved = true;
    }
    return moved;
  }

  function finishRoll() {
    const r = state.roll;
    group.quaternion.copy(r.to);
    canvas.style.opacity = "";
    state.roll = null;
    state.glow = { face: r.face, t: 0 };
    if (onRoll) onRoll({ face: r.face, rolling: false });
  }

  return {
    update,
    roll,
    reset,
    get reducedMotion() {
      return reducedMotion;
    },
    get rolling() {
      return Boolean(state.roll);
    },
    setSlowTurn(on, speed) {
      state.slowTurn = Boolean(on) && !reducedMotion;
      if (speed !== undefined) state.slowTurnSpeed = speed;
    },
    /** Call after the shape changes: stops any roll or glow. */
    shapeChanged() {
      cancelAutomatic();
      state.glow = null;
      lantern.setHighlight(-1, 0);
    },
  };
}
