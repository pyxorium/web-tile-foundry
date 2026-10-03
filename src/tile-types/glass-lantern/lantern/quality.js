// Automatic quality: keep the lantern smooth (and keep the browser from giving
// up on it) on slower devices and very large screens.
//
// Two parts:
//
// 1. A pixel budget (in scene.js, `maxPixels`): on a very big canvas, such as
//    an ultrawide monitor, the lantern draws at a lower resolution and is
//    scaled up. This is decided before the first frame, so a huge window
//    never starts with a frame the graphics chip can't finish.
//
// 2. A step-down governor (here): for the first moments it measures how fast
//    the lantern draws. If it can't hold the target frame rate, it applies the
//    next step from QUALITY_STEPS, waits for things to settle, and measures
//    again, until it is fast enough or there is nothing left to give up.
//
// The steps are setting overrides laid on top of the creator's settings; they
// never change the saved settings themselves.
//
// No three.js and no browser APIs here, so it can be tested in Node.

export const QUALITY_STEPS = Object.freeze([
  Object.freeze({ id: "half-glass", label: "real glass at half resolution", settings: Object.freeze({ glassResolution: "half" }) }),
  Object.freeze({ id: "no-rainbow", label: "rainbow edges off", settings: Object.freeze({ dispersion: 0 }) }),
  Object.freeze({ id: "no-far-side", label: "far side glass off", settings: Object.freeze({ farSide: false }) }),
  Object.freeze({ id: "sharpness-1", label: "sharpness 1", settings: Object.freeze({ pixelRatio: "1" }) }),
  Object.freeze({ id: "backup-glass", label: "backup glass", settings: Object.freeze({ realGlass: false }) }),
]);

/** The settings to start from after the graphics crashed once: the lightest ones. */
export const SAFE_SETTINGS = Object.freeze({ realGlass: false, pixelRatio: "1", glassResolution: "half", dispersion: 0, farSide: false });

/** All the overrides from the first `count` steps, merged. */
export function overridesFor(count, steps = QUALITY_STEPS) {
  return Object.assign({}, ...steps.slice(0, count).map((s) => s.settings));
}

/**
 * Watches frame times and decides when to step down.
 *
 *   const governor = createQualityGovernor();
 *   each frame:  const change = governor.frame(performance.now());
 *                if (change) apply overridesFor(change.count)
 *   governor.state  "settling" | "measuring" | "done"
 *
 * targetFps: the slowest acceptable rate (45: smooth enough, and a 60 Hz
 *   screen that holds 60 passes comfortably).
 * settleMs: ignored time after a start or a change (new shaders compile then,
 *   and the first frames are always slow).
 * windowMs: how long to measure before deciding.
 * hopelessMs: if even a few frames each take this long, step down at once
 *   instead of waiting out the window (frames this slow risk a crash).
 */
export function createQualityGovernor({ steps = QUALITY_STEPS, targetFps = 45, settleMs = 500, windowMs = 1500, hopelessMs = 150, startAt = 0 } = {}) {
  let count = startAt;
  let state = "settling";
  let changedAt = null;
  let windowStart = 0;
  let frames = 0;
  let last = null;
  let slow = 0;

  function restartMeasuring(now) {
    state = "settling";
    changedAt = now;
    frames = 0;
    slow = 0;
    last = null;
  }

  return {
    get state() {
      return state;
    },
    get count() {
      return count;
    },
    get steps() {
      return steps.slice(0, count);
    },
    /** Starts measuring again (for example after a big settings change). */
    restart(now) {
      restartMeasuring(now);
    },
    /** Call once per drawn frame. Returns { count, step } when it steps down. */
    frame(now) {
      if (state === "done") return null;
      if (changedAt === null) changedAt = now;
      if (state === "settling") {
        if (now - changedAt < settleMs) return null;
        state = "measuring";
        windowStart = now;
        frames = 0;
        slow = 0;
        last = now;
        return null;
      }
      const delta = now - last;
      last = now;
      frames++;
      if (delta >= hopelessMs) slow++;
      const elapsed = now - windowStart;
      const hopeless = slow >= 2;
      if (!hopeless && elapsed < windowMs) return null;
      const fps = (frames * 1000) / elapsed;
      if (!hopeless && fps >= targetFps) {
        state = "done";
        return null;
      }
      if (count >= steps.length) {
        state = "done";
        return null;
      }
      count++;
      restartMeasuring(now);
      return { count, step: steps[count - 1] };
    },
  };
}
