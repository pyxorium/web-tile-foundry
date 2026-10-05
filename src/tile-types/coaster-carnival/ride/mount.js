import { createCoasterScene } from "./scene.js";
import { createRideSound } from "./sound.js";
import { createControls } from "./controls.js";
import { getTheme, THEME_IDS } from "./themes.js";

// One live Coaster Carnival ride in a box on the page, with everything around
// it: the 3D scene, the sound, and the viewer's controls. The ride lab uses it
// now; the tile (and the Foundry's "Test ride") will use the same, so what the
// creator sees is what the tile does.
//
//   const coaster = mountCoaster(box, { track, theme, view, style, colors, rider, handle, makeUrl });
//   coaster.setTrack(track) / setTheme(id) / setView(id) / setStyle(id) / setColors({...}) / setRider(image) / setTunnel(on)
//   coaster.dispose()
//
// `box` must be positioned (relative, absolute or fixed): the canvas fills it.
//
// Taps: on the waiting view, the end card or the pause back at the station, a
// tap rides; while choosing (and until the fork), a tap on the left or right
// half picks the way on that side. Keys: Space or Enter rides, the left and
// right arrows choose. Every control is also a real button (controls.js).
//
// Looking after the viewer's device (as Glass Lantern does):
//   - nothing moves or draws while the box is scrolled out of view or the tab
//     is hidden; a ride pauses there and carries on when it comes back
//   - if the graphics crash, it starts again in place with the lightest look,
//     back at the waiting view (after a few crashes it stops and says so)
//   - viewers whose device asks for reduced motion start in the gentle view from above

const MAX_RESTARTS = 2;

/** The view from above used to be the side view: an old "side" means "above". */
const aboveIfSide = (id) => (id === "side" ? "above" : id);

export function mountCoaster(box, options = {}) {
  const reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const keyTarget = options.keyTarget || window;
  const current = {
    track: options.track || null,
    theme: options.theme || "day",
    view: aboveIfSide(options.view) || (reducedMotion ? "above" : "behind"),
    style: options.style || "steel",
    colors: { ...(options.colors || {}) },
    rider: options.rider || null,
    tunnel: options.tunnel !== false, // "Add a tunnel": on unless the creator turned it off
    behind: null,
  };
  const ridden = new Set();
  let ride = null;
  let canvas = null;
  let crashes = 0;
  let quality = options.quality ?? 1;
  let onScreen = true;
  let disposed = false;
  let soundLoop = 0;
  let note = null;

  const sound = createRideSound();
  sound.setTheme(current.theme);
  sound.setStyle(current.style);
  if (options.volume != null) sound.setVolume(options.volume);
  if (options.mix) sound.setMix(options.mix);
  if (options.tone) sound.setTone(options.tone);
  let soundOn = options.sound !== false;
  sound.setMuted(!soundOn);

  const controls = createControls(box, {
    handle: options.handle,
    makeUrl: options.makeUrl,
    themes: THEME_IDS,
    theme: current.theme,
    view: current.view,
    sound: soundOn,
    onRide: () => startRide(),
    onChoose: (side) => choose(side),
    onTheme: (id) => api.setTheme(id),
    onView: (id) => api.setView(id),
    onSound: (on) => api.setSound(on),
  });

  // ---------- the scene ----------

  function routesOf() {
    return current.track?.trackSwitch ? 2 : 1;
  }

  /** The words for each side's way ("Frolic" on the side the long route, "thrill" in the code, leaves on). */
  function names() {
    const words = getTheme(current.theme).routes;
    return ride?.thrillSide === "left" ? { left: words.thrill, right: words.chill } : { left: words.chill, right: words.thrill };
  }

  function stateChanged(state) {
    if (state === "settling") ridden.add(ride.route);
    if (state === "riding") {
      sound.start();
      runSound();
    } else sound.stop();
    controls.setState(state, { names: names(), chosen: false, ridden: ridden.size, routes: routesOf() });
    if (state === "done") controls.focusMain();
    if (options.onState) options.onState(state);
  }

  function build() {
    canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "A roller coaster ride.");
    Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", display: "block", cursor: "pointer", touchAction: "manipulation" });
    box.prepend(canvas);
    ride = createCoasterScene(canvas, { quality, onState: stateChanged, onCue: (name) => sound.cue(name) });
    ride.setStyle(current.style);
    ride.setColors(current.colors);
    ride.setTunnel(current.tunnel);
    if (current.track) ride.setTrack(current.track);
    ride.setTheme(current.theme);
    ride.setView(current.view);
    if (current.behind) ride.setBehind(current.behind);
    if (current.rider) ride.setRider(current.rider);
    canvas.addEventListener("click", onTap);
    canvas.addEventListener("webglcontextlost", onCrash);
    ride.setPaused(!visible());
  }

  // ---------- taps and keys ----------

  function startRide() {
    if (!ride || !current.track) return;
    sound.start(); // from a tap or key: browsers allow sound to begin here
    sound.stop(); //  quiet in the station; the ride's sound starts as the cart rolls out
    ride.start();
  }

  function choose(side) {
    if (!ride || !current.track?.trackSwitch) return false;
    const route = side === ride.thrillSide ? "thrill" : "chill";
    const done = ride.choose(route);
    if (done && ride.state === "boarding") controls.setState("boarding", { names: names(), chosen: true, ridden: ridden.size, routes: routesOf() });
    return done;
  }

  function onTap(event) {
    const state = ride?.state;
    if (state === "waiting" || state === "done" || state === "settling") startRide();
    else if (state === "boarding" || state === "riding") {
      const rect = canvas.getBoundingClientRect();
      choose(event.clientX - rect.left < rect.width / 2 ? "left" : "right");
    }
  }

  function onKey(event) {
    if (event.defaultPrevented || !ride) return;
    const tag = event.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const state = ride.state;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      if (!choose(event.key === "ArrowLeft" ? "left" : "right")) return;
    } else if ((event.key === " " || event.key === "Enter") && ["waiting", "done", "settling"].includes(state)) {
      if (tag === "BUTTON" || tag === "A") return; // the focused button handles it
      startRide();
    } else return;
    event.preventDefault();
  }
  keyTarget.addEventListener("keydown", onKey);

  // Sound follows the cart while riding.
  function runSound() {
    if (soundLoop) return;
    const step = () => {
      soundLoop = 0;
      if (!ride || ride.state !== "riding" || ride.paused || disposed) return;
      const now = ride.now();
      if (now) sound.update(now);
      soundLoop = requestAnimationFrame(step);
    };
    soundLoop = requestAnimationFrame(step);
  }

  // ---------- only move and draw while it can be seen ----------

  const visible = () => onScreen && !document.hidden;
  function applyVisibility() {
    if (!ride) return;
    const hide = !visible();
    if (hide === ride.paused) return;
    ride.setPaused(hide);
    if (ride.state === "riding") {
      if (hide) sound.stop();
      else {
        sound.start();
        runSound();
      }
    }
  }
  const observer =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) => {
          onScreen = entries.some((e) => e.isIntersecting);
          applyVisibility();
        })
      : null;
  if (observer) observer.observe(box);
  document.addEventListener("visibilitychange", applyVisibility);
  const resizer = typeof ResizeObserver === "function" ? new ResizeObserver(() => ride?.resize()) : null;
  if (resizer) resizer.observe(box);

  // ---------- the graphics crashed: start again in place, lighter ----------

  function onCrash(event) {
    event.preventDefault();
    if (disposed) return;
    teardown();
    crashes++;
    if (crashes > MAX_RESTARTS) {
      note = document.createElement("p");
      note.textContent = "This coaster needs more graphics power than this device can give right now.";
      Object.assign(note.style, { position: "absolute", left: "16px", right: "16px", top: "40%", margin: "0", textAlign: "center", font: "15px system-ui, sans-serif", color: "#fff" });
      box.append(note);
      return;
    }
    quality = 0;
    setTimeout(() => {
      if (!disposed) build();
    }, 300);
  }

  function teardown() {
    sound.stop();
    try {
      ride?.dispose();
    } catch {
      /* the graphics are already gone */
    }
    canvas?.remove();
    ride = null;
    canvas = null;
  }

  build();

  const api = {
    /** The scene and the sound, for the ride lab's tuning panels. */
    get ride() {
      return ride;
    },
    sound,
    get view() {
      return current.view;
    },
    setTrack(track) {
      current.track = track;
      ridden.clear();
      ride?.setTrack(track);
      controls.setState("waiting", { names: names(), routes: routesOf(), ridden: 0 });
    },
    setTheme(id) {
      current.theme = id;
      ride?.setTheme(id);
      sound.setTheme(id);
      controls.setTheme(id);
      controls.setState(ride?.state || "waiting", { names: names(), ridden: ridden.size, routes: routesOf() });
      if (options.onTheme) options.onTheme(id);
    },
    setView(id) {
      id = aboveIfSide(id);
      current.view = id;
      ride?.setView(id);
      controls.setView(id);
      if (options.onView) options.onView(id);
    },
    setStyle(id) {
      current.style = id;
      ride?.setStyle(id);
      sound.setStyle(id);
    },
    setColors(colors) {
      Object.assign(current.colors, colors);
      ride?.setColors(colors);
    },
    setTunnel(on) {
      current.tunnel = Boolean(on);
      ride?.setTunnel(current.tunnel);
    },
    setRider(image) {
      current.rider = image;
      ride?.setRider(image);
    },
    setBehind(settings) {
      current.behind = { ...(current.behind || {}), ...settings };
      ride?.setBehind(settings);
    },
    setSound(on) {
      soundOn = Boolean(on);
      sound.setMuted(!soundOn);
      controls.setSound(soundOn);
      if (options.onSound) options.onSound(soundOn);
    },
    startRide,
    choose,
    dispose() {
      disposed = true;
      if (soundLoop) cancelAnimationFrame(soundLoop);
      keyTarget.removeEventListener("keydown", onKey);
      if (observer) observer.disconnect();
      if (resizer) resizer.disconnect();
      document.removeEventListener("visibilitychange", applyVisibility);
      try {
        ride?.renderer.forceContextLoss();
      } catch {
        /* already gone */
      }
      teardown();
      controls.dispose();
      note?.remove();
    },
  };
  return api;
}
