import { deriveShape } from "../geometry/polyhedron.js";
import { createLantern } from "../lantern/scene.js";
import { createInteraction } from "../lantern/interaction.js";
import { createGearMenu } from "../lantern/gear.js";
import { DEFAULT_SETTINGS } from "../lantern/settings.js";
import { createQualityGovernor, overridesFor, SAFE_SETTINGS, stepIsUseful } from "../lantern/quality.js";

// The Glass Lantern tile's program. It is bundled (with three.js) into one
// file, /lantern.js, which is the same in every Glass Lantern tile; what makes
// each tile different is the small config in its page:
//
//   <script type="application/json" id="lantern-config">
//     { "version": 1, "shape": { "vertices": [...], "faces": [...] },
//       "colours": ["#...", ...], "look": { ...settings }, "slowTurn": true }
//   </script>
//
// It fills the tile with the lantern, centred with a little room round it,
// and adds the same viewer controls as the look lab: drag to turn, tap to
// roll, pinch or wheel to zoom, and the gear menu (top right).
//
// Looking after the viewer's device:
//   - draws only when something changes (or while slow turn is on), and not
//     at all while the tile is scrolled out of view or the tab is hidden;
//   - auto quality steps the look down on slow devices (see quality.js);
//   - if the graphics crash, it starts again in place with the lightest look.

export const TILE_FILL = 0.84; //   the lantern's share of the box's shorter side
const MAX_RESTARTS = 2; //          after this many crashes, stop and say so

function readConfig() {
  const el = document.getElementById("lantern-config");
  const config = JSON.parse(el.textContent);
  if (config.version !== 1) throw new Error(`Unknown lantern config version ${config.version}`);
  return config;
}

function start() {
  const config = readConfig();
  const shape = deriveShape(config.shape);
  const look = { ...DEFAULT_SETTINGS, ...config.look };
  document.body.style.background = look.bgBottom || "#0e0907";

  let slowTurn = config.slowTurn !== false;
  let lantern = null;
  let interaction = null;
  let canvas = null;
  let governor = null;
  let crashes = 0;
  let needsFrame = true;
  let onScreen = true;
  let raf = 0;
  let last = 0;

  const gear = createGearMenu({
    corner: "top-right",
    slowTurn,
    onSlowTurn: (on) => {
      slowTurn = on;
      if (interaction) interaction.setSlowTurn(on);
      wake();
    },
    onReset: () => {
      if (interaction) interaction.reset();
      wake();
    },
  });

  /** Builds the lantern on a fresh canvas. `safe`: start with the lightest look. */
  function build(safe, carry) {
    canvas = document.createElement("canvas");
    canvas.className = "lantern";
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "A stained glass lantern. Drag to turn it, tap or press Enter to roll it.");
    document.body.prepend(canvas);

    lantern = createLantern(canvas, look, { fill: TILE_FILL });
    lantern.setShape(shape);
    if (Array.isArray(config.colours) && config.colours.length === shape.faces.length) lantern.setColours(config.colours);
    if (safe) lantern.setOverrides(SAFE_SETTINGS);
    lantern.resize();

    interaction = createInteraction({ canvas, lantern, slowTurn });
    if (gear.setSlowTurn) gear.setSlowTurn(slowTurn && !interaction.reducedMotion);
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
    governor = safe
      ? null
      : createQualityGovernor({ isUseful: (step, before) => stepIsUseful(step, { ...lantern.settings, ...before }) });
    observe();
    needsFrame = true;
  }

  // ---------- the graphics crashed: start again in place, lighter ----------
  function onCrash(e) {
    e.preventDefault();
    const carry = lantern ? { quaternion: lantern.group.quaternion.clone(), zoom: lantern.zoom } : null;
    try {
      lantern.dispose();
    } catch {
      /* the context is already gone */
    }
    canvas.remove();
    lantern = null;
    interaction = null;
    crashes++;
    if (crashes > MAX_RESTARTS) {
      showNote("The lantern needs more graphics power than this device can give right now.");
      return;
    }
    // Give the browser a moment to free the old graphics before asking again.
    setTimeout(() => {
      build(true, carry);
      wake();
    }, 300);
  }

  function showNote(text) {
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = text;
    document.body.append(note);
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
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      if (governor && governor.state !== "done") governor.restart(performance.now());
      wake();
    }
  });
  window.addEventListener("resize", () => {
    if (lantern) lantern.resize();
    wake();
  });

  function wake() {
    needsFrame = true;
    if (!raf && lantern && onScreen && !document.hidden) {
      raf = requestAnimationFrame((t) => {
        last = t;
        frame(t);
      });
    }
  }

  function frame(now) {
    raf = 0;
    if (!lantern || !onScreen || document.hidden) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const moved = interaction.update(dt);
    // While auto quality is measuring, every frame is drawn so the count is fair.
    const measuring = governor && governor.state !== "done";
    if (moved || needsFrame || measuring) {
      needsFrame = false;
      lantern.render();
      if (governor) {
        const change = governor.frame(performance.now());
        if (change) {
          lantern.setOverrides(overridesFor(change.count));
          needsFrame = true;
        }
      }
    }
    // Keep going while anything moves; otherwise sleep until the viewer acts.
    if (moved || needsFrame || measuring) raf = requestAnimationFrame(frame);
  }

  build(false, null);
  wake();
}

try {
  start();
} catch (error) {
  console.error(error);
  const note = document.createElement("p");
  note.className = "note";
  note.textContent = "The lantern could not start on this device.";
  document.body.append(note);
}
