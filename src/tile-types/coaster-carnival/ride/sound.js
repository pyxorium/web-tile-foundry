// Coaster Carnival's sounds, made in the browser with Web Audio: no sound
// files, nothing to download, and each theme is just different settings.
//
//   const sound = createRideSound();
//   sound.start();                 // must be called from a tap or click (browsers block sound otherwise)
//   sound.update({ kind, speed }); // every frame while riding (kind = the piece of track, speed in m/s)
//   sound.stop();                  // fade everything out
//   sound.setTheme("spooky"); sound.setMuted(true); sound.setVolume(0.8);
//   sound.setMix({ roar: 1, clicks: 1, wind: 1, rumble: 1, effects: 1, drone: 1 }); // the lab's sliders
//   sound.setTone({ pitch: 1, brightness: 1, rise: 1 });                 // the roar's character
//
// What a steel coaster sounds like, layer by layer:
//   roar     the wheels on the track: a pitched hum-roar that rises with speed (the main sound)
//   clicks   the wheels passing track joints: soft ticks, faster as the cart speeds up
//   rumble   a deep, dark undertone from the structure
//   wind     a light airy layer that only comes in at high speed
//   effects  the chain lift's clack, a whoosh into loops, a thump at the bottom of drops,
//            the brake hiss
//   drone    (spooky only) a low, uneasy hum under everything
// Each layer has its own mix setting, and at 0 it is completely silent.

const SOUND_THEMES = Object.freeze({
  day: Object.freeze({ roarPitch: 1, clackPitch: 1, drone: 0 }),
  night: Object.freeze({ roarPitch: 1.05, clackPitch: 1.1, drone: 0 }),
  spooky: Object.freeze({ roarPitch: 0.85, clackPitch: 0.75, drone: 0.14 }),
});

// Tuned by ear in the ride lab (October 2026), the same for every theme.
export const DEFAULT_MIX = Object.freeze({ roar: 0.05, clicks: 0.85, wind: 0.45, rumble: 1.5, effects: 1, drone: 0.05 });
// The wheel roar's character, each as a share of normal:
//   pitch       the whole roar lower (0.5) or higher (2)
//   brightness  muffled (0.5) or sharp (2), separately from pitch
//   rise        how much the pitch climbs with speed: steady hum (0) to dramatic (2)
export const DEFAULT_TONE = Object.freeze({ pitch: 0.65, brightness: 0.65, rise: 0.25 });
export const DEFAULT_VOLUME = 0.7;

const CLACK_EVERY = 0.36; // seconds between chain clicks on the lift
// How each track style sounds: steel runs smooth, with a soft click at each
// joint; wood clatters, with closer, lower, louder knocks, a heavier rumble,
// and a rattle of loose little knocks at speed.
export const TRACK_SOUNDS = Object.freeze({
  steel: Object.freeze({ jointEvery: 3, jointPitch: 1, jointLevel: 1, rumble: 1, rattle: 0 }),
  wood: Object.freeze({ jointEvery: 1.4, jointPitch: 0.5, jointLevel: 1.6, rumble: 1.5, rattle: 1 }),
});
const PLAYBACK = 1.3; // the ride plays at 1.3x real time, so joints pass that much faster

export function createRideSound() {
  let ctx = null;
  let nodes = null;
  let theme = SOUND_THEMES.day;
  let mix = { ...DEFAULT_MIX };
  let tone = { ...DEFAULT_TONE };
  let muted = false;
  let volume = DEFAULT_VOLUME;
  let trackSound = TRACK_SOUNDS.steel;
  let lastKind = null;
  let nextClack = 0;
  let jointTravel = 0;
  let lastTime = 0;
  let running = false;

  /** Noise buffers: white (bright, for clicks and hiss) and brown (dark, for rumble), 6 s long so nothing audibly repeats. */
  function buffers() {
    const length = ctx.sampleRate * 6;
    const white = ctx.createBuffer(1, length, ctx.sampleRate);
    const brown = ctx.createBuffer(1, length, ctx.sampleRate);
    const w = white.getChannelData(0);
    const b = brown.getChannelData(0);
    let seed = 12345;
    let last = 0;
    for (let i = 0; i < length; i++) {
      seed = (seed * 16807) % 2147483647;
      const x = (seed / 2147483647) * 2 - 1;
      w[i] = x;
      last = (last + 0.02 * x) / 1.02; // brown noise: each sample drifts from the last
      b[i] = last * 3.5;
    }
    return { white, brown };
  }

  function loop(buffer) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.start(0, Math.random() * 5);
    return src;
  }

  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    master.connect(limiter).connect(ctx.destination);
    const { white, brown } = buffers();
    nodes = { master, white, brown };

    // Roar: a few low tones a little apart, softened by a filter, with a slow wobble.
    const roarFilter = ctx.createBiquadFilter();
    roarFilter.type = "lowpass";
    roarFilter.frequency.value = 400;
    roarFilter.Q.value = 0.7;
    const roarGain = ctx.createGain();
    roarGain.gain.value = 0;
    const roarOscs = [1, 1.5, 2.02].map((ratio) => {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = 40 * ratio;
      o.connect(roarFilter);
      o.start();
      return { o, ratio };
    });
    // The wobble shakes a second volume stage that comes *after* the roar's
    // own volume, so with the roar turned down to nothing it stays silent.
    const roarWobble = ctx.createGain();
    roarWobble.gain.value = 1;
    const wobble = ctx.createOscillator();
    const wobbleDepth = ctx.createGain();
    wobble.frequency.value = 7;
    wobbleDepth.gain.value = 0;
    wobble.connect(wobbleDepth).connect(roarWobble.gain);
    wobble.start();
    // A little filtered noise in the roar too, so it isn't a pure hum.
    const grit = ctx.createBiquadFilter();
    grit.type = "bandpass";
    grit.frequency.value = 700;
    grit.Q.value = 1.5;
    const gritGain = ctx.createGain();
    gritGain.gain.value = 0.25;
    loop(white).connect(grit).connect(gritGain).connect(roarFilter);
    roarFilter.connect(roarGain).connect(roarWobble).connect(master);

    // Rumble: dark brown noise, low.
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = "lowpass";
    rumbleFilter.frequency.value = 120;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0;
    loop(brown).connect(rumbleFilter).connect(rumbleGain).connect(master);

    // Wind: narrow and high, kept quiet.
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.Q.value = 2.2;
    windFilter.frequency.value = 1200;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    loop(white).connect(windFilter).connect(windGain).connect(master);

    // Drone (spooky): two slightly mistuned tones, high enough for phone and
    // laptop speakers, softened by a filter that slowly opens and closes.
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0;
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = "lowpass";
    droneFilter.frequency.value = 520;
    droneFilter.Q.value = 2;
    for (const f of [110, 116.5]) {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = f;
      o.connect(droneFilter);
      o.start();
    }
    const droneSway = ctx.createOscillator();
    droneSway.frequency.value = 0.18;
    const droneSwayDepth = ctx.createGain();
    droneSwayDepth.gain.value = 180;
    droneSway.connect(droneSwayDepth).connect(droneFilter.frequency);
    droneSway.start();
    droneFilter.connect(droneGain).connect(master);

    Object.assign(nodes, { roarFilter, roarGain, roarOscs, wobbleDepth, rumbleFilter, rumbleGain, windFilter, windGain, droneGain });
    applyVolume();
  }

  function applyVolume() {
    if (!nodes) return;
    nodes.master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.05);
  }

  /** A short burst of filtered noise: the building block of clicks, whooshes and hisses. */
  function burst({ type = "bandpass", freq = 2000, q = 1, gain = 0.5, attack = 0.002, length = 0.03, sweepTo = null, dark = false }) {
    const src = ctx.createBufferSource();
    src.buffer = dark ? nodes.brown : nodes.white;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + length);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + attack + length);
    src.connect(filter).connect(g).connect(nodes.master);
    src.start(t, Math.random() * 5);
    src.stop(t + attack + length + 0.05);
  }

  function clack() {
    const p = theme.clackPitch;
    const e = mix.effects;
    burst({ freq: 2600 * p, q: 6, gain: 0.35 * e, length: 0.025 });
    setTimeout(() => running && burst({ freq: 1500 * p, q: 5, gain: 0.25 * e, length: 0.04 }), 70);
  }

  /** A short tone that rings out: for the station bell. */
  function ring(freq, gain, length) {
    const t = ctx.currentTime;
    for (const [ratio, share] of [[1, 1], [2.76, 0.35], [5.4, 0.12]]) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = freq * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain * share, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + length / ratio);
      o.connect(g).connect(nodes.master);
      o.start(t);
      o.stop(t + length + 0.05);
    }
  }

  function joint(speed) {
    // A soft double tick (front and back wheels), brighter at speed; on wood, a lower, louder knock.
    const { jointPitch: p, jointLevel: l } = trackSound;
    const g = Math.min(0.22, 0.05 + speed * 0.006) * mix.clicks * l;
    const length = 0.018 / Math.sqrt(p);
    burst({ freq: (900 + speed * 25) * p, q: 3, gain: g, length });
    setTimeout(() => running && burst({ freq: (800 + speed * 22) * p, q: 3, gain: g * 0.8, length }), Math.max(25, 1600 / Math.max(speed, 1)));
  }

  return {
    /** Starts (or resumes) sound. Call from a tap or click. */
    start() {
      if (!ctx) build();
      if (ctx.state === "suspended") ctx.resume();
      running = true;
      lastKind = null;
      nextClack = 0;
      jointTravel = 0;
      lastTime = ctx.currentTime;
      nodes.droneGain.gain.setTargetAtTime(theme.drone * mix.drone, ctx.currentTime, 0.8);
    },

    /** Call every frame while riding. */
    update({ kind, speed }) {
      if (!ctx || !running) return;
      const t = ctx.currentTime;
      const dt = Math.min(0.1, Math.max(0, t - lastTime));
      lastTime = t;
      const v = Math.max(0, speed || 0);
      const inStation = kind === "station-out" || kind === "station-in";
      const level = Math.min(1, v / 25); // 0 standing still, 1 near top speed

      // Roar: pitch and loudness follow speed.
      const base = (28 + v * 3.2 * tone.rise) * theme.roarPitch * tone.pitch;
      for (const { o, ratio } of nodes.roarOscs) o.frequency.setTargetAtTime(base * ratio, t, 0.15);
      nodes.roarFilter.frequency.setTargetAtTime((250 + v * 40) * tone.brightness * tone.pitch, t, 0.2);
      nodes.roarGain.gain.setTargetAtTime((inStation ? 0.01 : 0.03 + level * 0.16) * mix.roar, t, 0.15);
      nodes.wobbleDepth.gain.setTargetAtTime(0.15 + level * 0.25, t, 0.3); // share of the roar's own volume

      // Rumble: deep, grows with speed.
      nodes.rumbleGain.gain.setTargetAtTime((inStation ? 0.02 : 0.05 + level * 0.25) * mix.rumble * trackSound.rumble, t, 0.2);
      nodes.rumbleFilter.frequency.setTargetAtTime(80 + v * 3, t, 0.3);

      // Wind: only at speed, and kept light.
      nodes.windGain.gain.setTargetAtTime(Math.max(0, level - 0.45) * 0.12 * mix.wind, t, 0.3);
      nodes.windFilter.frequency.setTargetAtTime(900 + v * 45, t, 0.3);

      // Track joints click past as the cart moves (not on the lift, where the chain clacks instead).
      if (!inStation && kind !== "lift") {
        jointTravel += v * PLAYBACK * dt;
        if (jointTravel >= trackSound.jointEvery) {
          jointTravel %= trackSound.jointEvery;
          joint(v);
        }
        // Wood rattles: loose little knocks, more of them the faster it goes.
        if (trackSound.rattle && Math.random() < trackSound.rattle * level * level * dt * 14) {
          burst({ freq: 300 + Math.random() * 500, q: 4, gain: 0.08 * mix.clicks * (0.5 + Math.random()), length: 0.02 });
        }
      }
      if (kind === "lift" && t >= nextClack) {
        clack();
        nextClack = t + CLACK_EVERY;
      }

      // One-off effects when a new piece begins.
      if (kind !== lastKind) {
        const e = mix.effects;
        if (kind === "loop") burst({ type: "bandpass", freq: 400, q: 1.2, gain: 0.18 * e, attack: 0.3, length: 1.0, sweepTo: 1100 });
        if (kind === "drop" && lastKind) burst({ type: "lowpass", freq: 140, q: 0.5, gain: 0.4 * e, attack: 0.05, length: 0.8, dark: true });
        if (kind === "brakes") burst({ type: "highpass", freq: 3200, q: 0.4, gain: 0.3 * e, attack: 0.03, length: 1.1 });
        lastKind = kind;
      }
    },

    /**
     * One-off station sounds (only after start()):
     *   "bar"      the lap bar locking down
     *   "release"  the lap bar letting go (the same sound, lighter and rising)
     *   "bell"     the dispatch bell, just before the cart rolls out
     */
    cue(name) {
      if (!ctx) return;
      const e = mix.effects;
      if (name === "bar") {
        burst({ type: "lowpass", freq: 260, q: 2, gain: 0.5 * e, attack: 0.004, length: 0.16, dark: true });
        burst({ freq: 1400, q: 4, gain: 0.18 * e, length: 0.03 });
      } else if (name === "release") {
        burst({ type: "lowpass", freq: 220, q: 2, gain: 0.3 * e, attack: 0.02, length: 0.12, sweepTo: 520, dark: true });
        burst({ freq: 1800, q: 4, gain: 0.12 * e, length: 0.025 });
      } else if (name === "bell") {
        ring(1180, 0.16 * e, 1.1);
        setTimeout(() => ctx && ring(1180, 0.12 * e, 0.9), 180);
      }
    },

    /** Fades everything out (end of the ride, or back to the station). */
    stop() {
      running = false;
      if (!ctx) return;
      const t = ctx.currentTime;
      for (const g of [nodes.roarGain, nodes.rumbleGain, nodes.windGain, nodes.wobbleDepth]) g.gain.setTargetAtTime(0, t, 0.3);
      nodes.droneGain.gain.setTargetAtTime(0, t, 0.6);
    },

    /** The track style's sound: "steel" or "wood". */
    setStyle(id) {
      trackSound = TRACK_SOUNDS[id] || TRACK_SOUNDS.steel;
    },

    setTheme(id) {
      theme = SOUND_THEMES[id] || SOUND_THEMES.day;
      if (ctx && running) nodes.droneGain.gain.setTargetAtTime(theme.drone * mix.drone, ctx.currentTime, 0.5);
    },

    /** How loud each layer is, as a share of normal (0 = off, 1 = normal, 2 = double). */
    setMix(next) {
      for (const k of Object.keys(DEFAULT_MIX)) if (Number.isFinite(next?.[k])) mix[k] = Math.max(0, Math.min(2, next[k]));
      if (ctx && running) nodes.droneGain.gain.setTargetAtTime(theme.drone * mix.drone, ctx.currentTime, 0.2);
    },

    /** The roar's character: { pitch, brightness, rise } (see DEFAULT_TONE). */
    setTone(next) {
      if (Number.isFinite(next?.pitch)) tone.pitch = Math.max(0.5, Math.min(2, next.pitch));
      if (Number.isFinite(next?.brightness)) tone.brightness = Math.max(0.5, Math.min(2, next.brightness));
      if (Number.isFinite(next?.rise)) tone.rise = Math.max(0, Math.min(2, next.rise));
    },

    setMuted(on) {
      muted = Boolean(on);
      applyVolume();
    },

    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
      applyVolume();
    },

    get muted() {
      return muted;
    },
  };
}

export { SOUND_THEMES };
