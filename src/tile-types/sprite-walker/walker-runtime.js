// The code that runs inside a sprite-walker tile.
//
// Choreography follows House Dice's SoloSpriteFrame exactly (agreed Oct 2 2026):
//   walk in place:   frames [0,1,2,1] x3 at 190 ms, facing the viewer (row 0)
//   then: idle pose, 500 ms; turn right (row 2), 300 ms;
//         sidestep right: frames [0,1,2,1,0] at 190 ms while gliding one
//         sprite-width over 760 ms; face the viewer, 900 ms;
//         walk in place; idle, 500 ms; turn left (row 1), 300 ms;
//         sidestep back; face the viewer; pause 1000 ms; repeat.
// Rows: 0 facing the viewer, 1 facing left, 2 facing right, 3 facing away.
// Column 1 is the idle pose; columns 0 and 2 are the opposite step poses.
//
// Motions offered in the gear menu:
//   "none"      idle pose, facing the viewer
//   "forward"   walking in place toward the viewer, [0,1,2,1] on a loop
//   "backforth" the full choreography above
//
// The background is chosen in the Foundry; only that one scene's paint()
// is passed in (see scenes/index.js). It animates gently, and holds still for
// viewers who ask their system for reduced motion.
//
// IMPORTANT: this function is copied into the tile as text, so it must stay
// fully self-contained: no imports and no outside variables. The scene and
// shadow painters are passed in as arguments for the same reason.

export function runSpriteWalker(cfg, paintScene, paintShadow) {
  "use strict";
  var FRAME_MS = 190;
  var WALK_IN_PLACE = [0, 1, 2, 1, 0, 1, 2, 1, 0, 1, 2, 1];
  var SIDESTEP = [0, 1, 2, 1, 0];
  var GLIDE_MS = FRAME_MS * (SIDESTEP.length - 1); // 760 ms, as in House Dice
  var ROW_FRONT = 0, ROW_LEFT = 1, ROW_RIGHT = 2;
  var IDLE = 1;
  var MOTIONS = ["none", "forward", "backforth"];

  var canvas = document.getElementById("stage");
  var ctx = canvas.getContext("2d");
  var gear = document.getElementById("gear");
  var menu = document.getElementById("menu");
  var radios = Array.prototype.slice.call(document.querySelectorAll('input[name="motion"]'));
  var reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // offset: 0 = home spot, 1 = one sprite-width to the right.
  var state = { mode: "none", row: ROW_FRONT, frame: IDLE, offset: 0, glide: null };
  var generation = 0;
  var timer = null;

  function now() { return performance.now(); }

  // Plays a list of steps; each step may set row/frame, start a glide, and wait.
  function play(steps, onEnd) {
    var mine = generation;
    var i = 0;
    function next() {
      if (mine !== generation) return;
      while (i < steps.length) {
        var s = steps[i++];
        if (s.row !== undefined) state.row = s.row;
        if (s.frame !== undefined) state.frame = s.frame;
        if (s.glideTo !== undefined) state.glide = { from: state.offset, to: s.glideTo, start: now(), dur: GLIDE_MS };
        if (s.wait) { timer = setTimeout(next, s.wait); return; }
      }
      if (onEnd) onEnd();
    }
    next();
  }

  // Frames with a wait between each one, but none after the last (House Dice timing).
  function frames(seq) {
    return seq.map(function (f, i) { return { frame: f, wait: i < seq.length - 1 ? FRAME_MS : 0 }; });
  }
  function sidestep(row, to) {
    return [{ row: row, glideTo: to }].concat(frames(SIDESTEP));
  }
  var CYCLE = [].concat(
    frames(WALK_IN_PLACE),
    [{ frame: IDLE, wait: 500 }, { row: ROW_RIGHT, wait: 300 }],
    sidestep(ROW_RIGHT, 1),
    [{ row: ROW_FRONT, frame: IDLE, wait: 900 }],
    frames(WALK_IN_PLACE),
    [{ frame: IDLE, wait: 500 }, { row: ROW_LEFT, wait: 300 }],
    sidestep(ROW_LEFT, 0),
    [{ row: ROW_FRONT, frame: IDLE, wait: 1000 }]
  );
  var FORWARD = [0, 1, 2, 1].map(function (f) { return { frame: f, wait: FRAME_MS }; });

  function setMode(mode) {
    if (MOTIONS.indexOf(mode) < 0) mode = "none";
    generation++;
    clearTimeout(timer);
    state.mode = mode;
    state.row = ROW_FRONT;
    state.frame = IDLE;
    state.offset = 0;
    state.glide = null;
    radios.forEach(function (r) { r.checked = r.value === mode; });
    if (mode === "forward") {
      var loopF = function () { play(FORWARD, loopF); };
      loopF();
    } else if (mode === "backforth") {
      var loopB = function () { play(CYCLE, loopB); };
      play([{ wait: 300 }], loopB);
    }
  }

  // ---- drawing -----------------------------------------------------------
  var sheet = new Image();
  var ready = false;
  sheet.onload = function () { ready = true; };
  sheet.src = cfg.sheet;

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    var w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    var h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }

  function draw() {
    resize();
    var W = canvas.width, H = canvas.height;
    var fw = cfg.frameWidth, fh = cfg.frameHeight;
    // Whole-number scaling only, so the pixel art stays crisp.
    var scale = Math.max(1, Math.floor(Math.min(W / (fw * 3.2), (H * cfg.groundRatio * 0.82) / fh)));
    ctx.imageSmoothingEnabled = false;
    var groundY = paintScene(ctx, W, H, scale, reduce ? 0 : now());

    if (state.glide) {
      var t = Math.min(1, (now() - state.glide.start) / state.glide.dur);
      state.offset = state.glide.from + (state.glide.to - state.glide.from) * t;
      if (t >= 1) state.glide = null;
    }
    var sw = fw * scale, sh = fh * scale;
    var travel = sw; // one sprite-width, as in House Dice's solo sprite
    var x = Math.round(W / 2 - sw / 2 - travel / 2 + state.offset * travel);
    var y = Math.round(groundY - sh + Math.round(sh * 0.04));
    paintShadow(ctx, x + sw / 2, groundY, sw);
    if (ready) ctx.drawImage(sheet, state.frame * fw, state.row * fh, fw, fh, x, y, sw, sh);
    requestAnimationFrame(draw);
  }

  // ---- gear menu ---------------------------------------------------------
  function openMenu(open) {
    menu.hidden = !open;
    gear.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      var current = radios.filter(function (r) { return r.checked; })[0] || radios[0];
      current.focus();
    }
  }
  gear.addEventListener("click", function (e) { e.stopPropagation(); openMenu(menu.hidden); });
  menu.addEventListener("click", function (e) { e.stopPropagation(); });
  document.addEventListener("click", function () { if (!menu.hidden) openMenu(false); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !menu.hidden) { openMenu(false); gear.focus(); }
  });
  radios.forEach(function (r) {
    r.addEventListener("change", function () { if (r.checked) setMode(r.value); });
  });

  // Read-only view for tests and the curious. Nothing here reaches the network.
  window.__walker = {
    get state() { return { mode: state.mode, row: state.row, frame: state.frame, offset: state.offset }; },
    setMode: setMode,
  };

  // The creator's chosen start, unless the viewer asked their system for less motion.
  setMode(reduce ? "none" : cfg.startMotion);
  requestAnimationFrame(draw);
}
