import { createLantern } from "../lantern/scene.js";
import { createInteraction } from "../lantern/interaction.js";
import { createGearMenu } from "../lantern/gear.js";
import { DEFAULT_SETTINGS } from "../lantern/settings.js";
import { createQualityGovernor, overridesFor, SAFE_SETTINGS, stepIsUseful } from "../lantern/quality.js";

// One live lantern in a box on the page, with everything around it. Used by
// the tile (runtime/tile-main.js, the box is the whole tile) and by the
// Foundry's preview (preview.js), so what the creator sees is what the tile does.
//
//   const lantern = mountLantern(box, { shape, colors, look, slowTurn });
//   lantern.setShape(shape) / setColors(colors) / setLook(look)
//   lantern.setPaint(fn)    fn(face) on each tap instead of rolling; null to roll again
//   lantern.dispose()
//
// `box` must be positioned (relative, absolute or fixed): the canvas fills it
// and the gear menu sits in its top right corner.
//
// Looking after the viewer's device:
//   - draws only when something changes (or while slow turn is on), and not
//     at all while the box is scrolled out of view or the tab is hidden;
//   - auto quality steps the look down on slow devices (see quality.js);
//   - if the graphics crash, it starts again in place with the lightest look.

export const TILE_FILL = 0.84; //   the lantern's share of the box's shorter side
const MAX_RESTARTS = 2; //          after this many crashes, stop and say so

// settleMs: how long auto quality waits before it first times the drawing
// (longer in the Foundry, whose page is busy for a moment as it starts).
export function mountLantern(box, { shape, colors = null, look = {}, slowTurn = true, fill = TILE_FILL, settleMs = 500 } = {}) {
  let currentShape = shape;
  let currentColors = colors;
  let currentLook = { ...DEFAULT_SETTINGS, ...look };
  let wantSlowTurn = slowTurn !== false;
  let paint = null;

  let lantern = null;
  let interaction = null;
  let canvas = null;
  let governor = null;
  let crashes = 0;
  let needsFrame = true;
  let onScreen = true;
  let raf = 0;
  let last = 0;
  let disposed = false;
  let busy = false; // the page is drawing pictures (art.js): don't judge the device's speed meanwhile
  let note = null;

  const gear = createGearMenu({
    parent: box,
    position: "absolute",
    corner: "top-right",
    slowTurn: wantSlowTurn,
    onSlowTurn: (on) => {
      wantSlowTurn = on;
      applySlowTurn();
      wake();
    },
    onReset: () => {
      if (interaction) interaction.reset();
      wake();
    },
  });

  // Slow turn follows the gear menu's switch, painting or not (the user's
  // choice, Oct 3: it should keep turning in Hands-on mode too).
  function applySlowTurn() {
    if (interaction) interaction.setSlowTurn(wantSlowTurn);
  }

  function applyColors() {
    if (Array.isArray(currentColors) && currentColors.length === currentShape.faces.length) lantern.setColours(currentColors);
  }

  /** Builds the lantern on a fresh canvas. `safe`: start with the lightest look. */
  function build(safe, carry) {
    canvas = document.createElement("canvas");
    canvas.className = "lantern";
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "A stained glass lantern. Drag to turn it, tap or press Enter to roll it.");
    Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", display: "block", touchAction: "none", cursor: "grab", outline: "none" });
    box.prepend(canvas);

    lantern = createLantern(canvas, currentLook, { fill });
    lantern.setShape(currentShape);
    applyColors();
    if (safe) lantern.setOverrides(SAFE_SETTINGS);
    lantern.resize();

    interaction = createInteraction({ canvas, lantern, slowTurn: wantSlowTurn, onTap: tap });
    applySlowTurn();
    gear.setSlowTurn(wantSlowTurn && !interaction.reducedMotion);
    if (carry) {
      lantern.group.quaternion.copy(carry.quaternion);
      lantern.setZoom(carry.zoom);
    }

    // Anything the viewer does asks for a new picture.
    for (const type of ["pointerdown", "pointermove", "wheel"]) canvas.addEventListener(type, wake, { passive: true });
    canvas.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        interaction.roll();
        wake();
      }
    });
    canvas.addEventListener("webglcontextlost", onCrash);

    // Auto quality, unless already on the lightest look.
    governor = safe ? null : createQualityGovernor({ settleMs, isUseful: (step, before) => stepIsUseful(step, { ...lantern.settings, ...before }) });
    observe();
    needsFrame = true;
  }

  function tap({ x, y }) {
    if (!paint || !lantern) return false;
    const face = lantern.faceAt(x, y);
    if (face >= 0) paint(face);
    wake();
    return true; // painting: a tap never rolls, even off the lantern
  }

  // ---------- the graphics crashed: start again in place, lighter ----------
  function onCrash(e) {
    e.preventDefault();
    if (disposed) return;
    const carry = lantern ? { quaternion: lantern.group.quaternion.clone(), zoom: lantern.zoom } : null;
    teardown();
    crashes++;
    if (crashes > MAX_RESTARTS) {
      showNote("The lantern needs more graphics power than this device can give right now.");
      return;
    }
    // Give the browser a moment to free the old graphics before asking again.
    setTimeout(() => {
      if (disposed) return;
      build(true, carry);
      wake();
    }, 300);
  }

  function teardown() {
    try {
      if (lantern) lantern.dispose();
    } catch {
      /* the context is already gone */
    }
    if (canvas) canvas.remove();
    lantern = null;
    interaction = null;
    canvas = null;
  }

  function showNote(text) {
    note = document.createElement("p");
    note.className = "note";
    note.textContent = text;
    Object.assign(note.style, { position: "absolute", left: "16px", right: "16px", bottom: "16px", margin: "0", textAlign: "center", font: "14px system-ui, sans-serif", color: "#f4e9d6" });
    box.append(note);
  }

  // ---------- only draw while it can be seen ----------
  let observer = null;
  function observe() {
    if (typeof IntersectionObserver !== "function") return;
    if (observer) observer.disconnect();
    observer = new IntersectionObserver((entries) => {
      onScreen = entries.some((x) => x.isIntersecting);
      if (onScreen) wake();
    });
    observer.observe(canvas);
  }
  const onBusy = (e) => {
    busy = Boolean(e.detail && e.detail.busy);
    if (!busy && governor && governor.state !== "done") governor.restart(performance.now());
    wake();
  };
  window.addEventListener("glass-lantern:busy", onBusy);
  const onVisibility = () => {
    if (!document.hidden) {
      if (governor && governor.state !== "done") governor.restart(performance.now());
      wake();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  const resizer =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          if (lantern) lantern.resize();
          wake();
        })
      : null;
  if (resizer) resizer.observe(box);
  const onWindowResize = () => {
    if (lantern) lantern.resize();
    wake();
  };
  window.addEventListener("resize", onWindowResize);

  function wake() {
    needsFrame = true;
    if (!raf && lantern && onScreen && !document.hidden && !disposed) {
      raf = requestAnimationFrame((t) => {
        last = t;
        frame(t);
      });
    }
  }

  function frame(now) {
    raf = 0;
    if (!lantern || !onScreen || document.hidden || disposed) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const moved = interaction.update(dt);
    // While auto quality is measuring, every frame is drawn so the count is fair.
    const measuring = governor && governor.state !== "done" && !busy;
    if (moved || needsFrame || measuring) {
      needsFrame = false;
      lantern.render();
      if (governor && !busy) {
        const change = governor.frame(performance.now());
        if (change) {
          lantern.setOverrides(overridesFor(change.count));
          needsFrame = true;
        }
      }
    }
    // Keep going while anything moves; otherwise sleep until something changes.
    if (moved || needsFrame || measuring) raf = requestAnimationFrame(frame);
  }

  build(false, null);
  wake();

  return {
    setShape(next) {
      currentShape = next;
      if (!lantern) return;
      lantern.setShape(next);
      applyColors();
      interaction.shapeChanged();
      wake();
    },
    setColors(next) {
      currentColors = next;
      if (!lantern) return;
      applyColors();
      wake();
    },
    setLook(next) {
      currentLook = { ...DEFAULT_SETTINGS, ...next };
      if (!lantern) return;
      lantern.update(currentLook);
      wake();
    },
    /** fn(face) is called for each tapped facet instead of rolling; null to roll again. */
    setPaint(fn) {
      paint = fn || null;
      applySlowTurn();
      wake();
    },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (observer) observer.disconnect();
      if (resizer) resizer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onWindowResize);
      window.removeEventListener("glass-lantern:busy", onBusy);
      // Hand the graphics back at once (a page may only hold a few).
      try {
        if (lantern) lantern.renderer.forceContextLoss();
      } catch {
        /* already gone */
      }
      teardown();
      gear.dispose();
      if (note) note.remove();
    },
  };
}
