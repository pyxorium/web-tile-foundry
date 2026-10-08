// Decorating a page in the Foundry's live preview (stickers and drawing).
// Added only to the preview's page (renderZineHtml with editor: true), never to
// a published zine. It works with the reader through window.__zine (see
// reader.js, preview mode) and talks to the Foundry by messages:
//   in:  { zine: "edit", on, id, tool: "sticker"|"pen"|"eraser", sticker, pen, width }
//   out: { zine: "marks", id, marks }   after each change (when a drag ends)
//        { zine: "selected", has }      whether a sticker is selected
// While decorating, page turning pauses (window.__zineLock).

import { MAX_MARKS, STICKER_SIZE, STICKER_SCALE } from "../marks.js";

export const EDITOR_JS = String.raw`
(function () {
  "use strict";
  var Z = window.__zine;
  if (!Z) return;
  var MAX = ${MAX_MARKS}, SIZE = ${STICKER_SIZE}, SMIN = ${STICKER_SCALE[0]}, SMAX = ${STICKER_SCALE[1]};
  var st = { on: false, id: null, tool: "sticker", sticker: "star", pen: "a", width: "fine", sel: -1, marks: [] };
  var svg = null, drag = null;

  function post(m) { try { window.parent.postMessage(m, "*"); } catch (e) {} }
  function marksOf(id) {
    var p = Z.config().pages.filter(function (x) { return x.id === id; })[0];
    return p && p.marks ? JSON.parse(JSON.stringify(p.marks)) : [];
  }
  function point(e) {
    var p = svg.createSVGPoint();
    p.x = e.clientX; p.y = e.clientY;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  }
  function draw() {
    svg = Z.renderMarks(st.id, st.marks, true);
    if (!svg) return;
    svg.classList.add("tool-" + st.tool);
    svg.addEventListener("pointerdown", down);
    var m = st.marks[st.sel];
    if (m && m.t === "s") {
      var half = SIZE * m.s / 2;
      var g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("class", "sel");
      g.setAttribute("transform", "translate(" + m.x + " " + m.y + ") rotate(" + m.r + ")");
      g.innerHTML = '<rect x="' + (-half - 4) + '" y="' + (-half - 4) + '" width="' + (2 * half + 8) + '" height="' + (2 * half + 8) + '"/>' +
        '<circle data-handle="1" cx="' + (half + 4) + '" cy="' + (half + 4) + '" r="7"/>';
      svg.appendChild(g);
    }
  }
  function select(i) {
    st.sel = i;
    post({ zine: "selected", has: i >= 0 && st.marks[i] && st.marks[i].t === "s" });
  }
  function commit() { post({ zine: "marks", id: st.id, marks: st.marks }); }

  function down(e) {
    if (!st.on || !e.isPrimary) return;
    e.preventDefault();
    var p = point(e);
    var hit = e.target.closest ? e.target.closest("[data-i]") : null;
    var i = hit ? Number(hit.getAttribute("data-i")) : -1;
    svg.setPointerCapture(e.pointerId);
    if (st.tool === "eraser") {
      if (i >= 0) { st.marks.splice(i, 1); select(-1); draw(); commit(); }
      return;
    }
    if (st.tool === "pen") {
      if (st.marks.length >= MAX) return;
      st.marks.push({ t: "p", pen: st.pen, w: st.width, d: [round(p.x), round(p.y)] });
      drag = { kind: "pen", i: st.marks.length - 1 };
      select(-1); draw();
      return;
    }
    // Stickers: the handle resizes and turns the selected one; a sticker moves; empty paper places one.
    var m = st.marks[st.sel];
    if (e.target.getAttribute && e.target.getAttribute("data-handle") && m) {
      var dx = p.x - m.x, dy = p.y - m.y;
      drag = { kind: "turn", d0: Math.max(4, Math.hypot(dx, dy)), a0: Math.atan2(dy, dx), s0: m.s, r0: m.r };
      return;
    }
    if (i >= 0 && st.marks[i].t === "s") {
      select(i);
      drag = { kind: "move", dx: p.x - st.marks[i].x, dy: p.y - st.marks[i].y };
      draw();
      return;
    }
    if (st.marks.length >= MAX) return;
    st.marks.push({ t: "s", id: st.sticker, x: round(p.x), y: round(p.y), s: 1, r: 0 });
    select(st.marks.length - 1);
    drag = { kind: "move", dx: 0, dy: 0, placed: true };
    draw();
  }
  function move(e) {
    if (!drag || !svg) return;
    var p = point(e);
    if (drag.kind === "pen") {
      var d = st.marks[drag.i].d, lx = d[d.length - 2], ly = d[d.length - 1];
      if ((p.x - lx) * (p.x - lx) + (p.y - ly) * (p.y - ly) < 2.25 || d.length >= 800) return;
      d.push(round(p.x), round(p.y));
    } else if (drag.kind === "move") {
      var m = st.marks[st.sel];
      m.x = round(p.x - drag.dx); m.y = round(p.y - drag.dy);
    } else if (drag.kind === "turn") {
      var s = st.marks[st.sel], dx = p.x - s.x, dy = p.y - s.y;
      s.s = Math.round(Math.min(SMAX, Math.max(SMIN, drag.s0 * Math.hypot(dx, dy) / drag.d0)) * 10) / 10;
      s.r = Math.round(drag.r0 + (Math.atan2(dy, dx) - drag.a0) * 180 / Math.PI);
    }
    draw();
  }
  function up() {
    if (!drag) return;
    drag = null;
    commit();
  }
  function round(v) { return Math.round(v * 10) / 10; }

  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
  document.addEventListener("pointercancel", up);
  document.addEventListener("keydown", function (e) {
    if (!st.on) return;
    if ((e.key === "Delete" || e.key === "Backspace") && st.sel >= 0) {
      st.marks.splice(st.sel, 1); select(-1); draw(); commit(); e.preventDefault();
    } else if (e.key === "Escape") { select(-1); draw(); }
  });

  function enter() {
    window.__zineLock = true;
    Z.goto(st.id);
    var el = Z.pageEl(st.id);
    Array.prototype.forEach.call(document.querySelectorAll(".zp.decorating"), function (x) { x.classList.remove("decorating"); });
    if (el) el.classList.add("decorating");
    draw();
  }
  function leave() {
    window.__zineLock = false;
    Array.prototype.forEach.call(document.querySelectorAll(".zp.decorating"), function (x) { x.classList.remove("decorating"); });
    if (st.id) Z.renderMarks(st.id, st.marks, false);
    select(-1);
  }

  // The reader rebuilds whenever the zine changes (each change comes back from
  // the Foundry): pick the page up again from the new zine.
  window.__zineAfterBuild = function () {
    if (!st.on) return;
    st.marks = marksOf(st.id);
    if (st.sel >= st.marks.length) select(-1);
    enter();
  };

  window.addEventListener("message", function (e) {
    if (e.source !== window.parent || !e.data || e.data.zine !== "edit") return;
    var m = e.data;
    if (!m.on) { if (st.on) { st.on = false; leave(); } return; }
    var changedPage = m.id !== st.id;
    st.tool = m.tool || st.tool; st.sticker = m.sticker || st.sticker; st.pen = m.pen || st.pen; st.width = m.width || st.width;
    if (m.remove && st.sel >= 0) { st.marks.splice(st.sel, 1); select(-1); commit(); }
    if (!st.on || changedPage) { if (st.on) leave(); st.id = m.id; st.marks = marksOf(m.id); select(-1); }
    st.on = true;
    if (st.tool !== "sticker") select(-1);
    enter();
  });
})();
`;
