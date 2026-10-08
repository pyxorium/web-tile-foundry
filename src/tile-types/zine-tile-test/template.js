import { TILE_CSP_META } from "../../core/policy.js";
import { scriptJson } from "../zine/runtime/template.js";

// The stage 4 host test page ("Zine Scene: tile test"): one of the creator's
// published tiles, copied into this tile under /t1/, started four ways inside
// this tile's own frame. Each way reports what happened to a results box;
// "Copy results" works like stage 0's (selects the text when the clipboard is
// refused). Plain script, standard policy, addEventListener only.
//
// Config: { title, tile: { name, by, uri, page, pageB, refs, banner? } }
//   page   the copied page as published ("/t1/index.html")
//   pageB  a copy whose own file addresses point into /t1/ ("/t1/page-b.html")
//   refs   the root paths the page uses ("/lantern.js", …)

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const CSS = `
html, body { margin: 0; background: #f4f1ea; color: #1b1a17; font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { padding: 12px; }
h1 { font-size: 17px; margin: 0 0 2px; }
.sub { margin: 0 0 10px; color: #6a655c; font-size: 12px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.way { background: #fff; border: 1px solid #ddd5c6; border-radius: 8px; padding: 8px; }
.way h2 { font-size: 14px; margin: 0 0 2px; }
.way p { margin: 0 0 6px; font-size: 12px; color: #6a655c; }
.box { position: relative; height: 260px; background: #111; border-radius: 6px; overflow: hidden; }
.box iframe { display: block; width: 100%; height: 100%; border: 0; }
.box .idle[hidden] { display: none; }
.box .idle { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #999; font-size: 12px; background-size: cover; background-position: center; }
.row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
button { font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 999px; border: 1px solid #b9b0a0; background: #fff; cursor: pointer; }
button.go { background: #1b1a17; color: #fff; border-color: #1b1a17; }
.status { margin-top: 4px; font-size: 12px; min-height: 1.4em; }
textarea { width: 100%; box-sizing: border-box; height: 170px; margin-top: 12px; font: 12px/1.35 ui-monospace, Menlo, Consolas, monospace; }
`;

const JS = String.raw`
(function () {
  "use strict";
  var config = JSON.parse(document.getElementById("test-config").textContent);
  var tile = config.tile;
  var out = document.getElementById("results");
  var lines = [];
  var t0 = performance.now();
  function now() { return ((performance.now() - t0) / 1000).toFixed(1) + " s"; }
  function log(s) { lines.push(s); out.value = lines.join("\n"); }
  function line(k, v) { log(k + ": " + v); }

  // The space this tile is given, and where it is.
  function space() { return Math.round(window.innerWidth) + " x " + Math.round(window.innerHeight); }
  line("Test", "Zine Scene stage 4 tile test, " + new Date().toISOString());
  line("Tile copied", tile.name + " by " + tile.by + " (" + tile.uri + ")");
  line("Space", space() + ", pixel ratio " + (window.devicePixelRatio || 1));
  var host = "unknown";
  try { host = document.referrer ? new URL(document.referrer).host : "(no referrer)"; } catch (e) {}
  line("In a frame", String(window.parent !== window) + "; referrer " + host + "; origin " + location.origin);
  // In a sealed frame (the Foundry's own preview) even looking at the service worker throws.
  var sw = "no";
  try { sw = String(!!(navigator.serviceWorker && navigator.serviceWorker.controller)); } catch (e) { sw = "can't tell (" + (e && e.name) + ")"; }
  line("Service worker in this page", sw);
  if (location.origin === "null") line("Note", "this is a sealed preview (like the Foundry's own preview), not a tile host: the copied files can't load here. Publish, then test on appmosphe.re and the gallery.");

  function getText(path) { return fetch(path).then(function (r) { if (!r.ok) throw new Error(path + " answered " + r.status); return r.text(); }); }
  function getBlob(path) { return fetch(path).then(function (r) { if (!r.ok) throw new Error(path + " answered " + r.status); return r.blob(); }); }
  function swap(html, map) {
    // Point the page's own root addresses ("/lantern.js") somewhere else.
    tile.refs.forEach(function (ref) {
      if (!(ref in map)) return;
      html = html.split('"' + ref + '"').join('"' + map[ref] + '"').split("'" + ref + "'").join("'" + map[ref] + "'");
    });
    return html;
  }
  var END = "<" + "/script"; // never written as one piece: it would end this script
  function textOf(blob) { return blob.text ? blob.text() : new Response(blob).text(); }

  var ways = [
    { id: "A", name: "A. Written into a frame", note: "The page's text is written into a frame (srcdoc); its files come from /t1/ through this tile's loader.",
      start: function (frame) {
        return getText(tile.page).then(function (html) {
          var map = {}; tile.refs.forEach(function (r) { map[r] = "/t1" + r; });
          frame.srcdoc = swap(html, map);
        });
      } },
    { id: "B", name: "B. A page inside this tile", note: "The frame opens /t1/page-b.html, a copy of the page pointing into /t1/.",
      start: function (frame) { frame.src = tile.pageB; return Promise.resolve(); } },
    { id: "C", name: "C. Files handed over", note: "This tile downloads the files itself and gives the frame its own copies (blob: addresses).",
      start: function (frame, way) {
        var map = {};
        return Promise.all(tile.refs.map(function (r) {
          return getBlob("/t1" + r).then(function (b) { var u = URL.createObjectURL(b); map[r] = u; way.urls.push(u); });
        })).then(function () { return getText(tile.page); }).then(function (html) {
          var u = URL.createObjectURL(new Blob([swap(html, map)], { type: "text/html" }));
          way.urls.push(u);
          frame.src = u;
        });
      } },
    { id: "D", name: "D. Walled off", note: "Everything written into the page and the frame sealed off (sandbox, no same origin): safest for other people's tiles later.",
      sealed: true,
      start: function (frame) {
        var inline = {};
        return Promise.all(tile.refs.map(function (r) {
          return getBlob("/t1" + r).then(function (b) {
            if (/\.js$/.test(r)) return textOf(b).then(function (t) { inline[r] = { js: t.split(END).join("<\\/script") }; });
            return new Promise(function (ok) { var fr = new FileReader(); fr.onload = function () { inline[r] = { data: fr.result }; ok(); }; fr.readAsDataURL(b); });
          });
        })).then(function () { return getText(tile.page); }).then(function (html) {
          tile.refs.forEach(function (r) {
            var it = inline[r];
            if (!it) return;
            if (it.js != null) {
              html = html.split('<script src="' + r + '">' + END + ">").join("<script>" + it.js + END + ">");
            } else {
              html = html.split('"' + r + '"').join('"' + it.data + '"');
            }
          });
          frame.setAttribute("sandbox", "allow-scripts");
          frame.srcdoc = html;
        });
      } },
  ];

  var grid = document.getElementById("ways");
  ways.forEach(function (way) {
    way.urls = [];
    var card = document.createElement("section"); card.className = "way";
    var h = document.createElement("h2"); h.textContent = way.name;
    var p = document.createElement("p"); p.textContent = way.note;
    var box = document.createElement("div"); box.className = "box";
    var idle = document.createElement("div"); idle.className = "idle"; idle.textContent = "Not started";
    if (tile.banner) idle.style.backgroundImage = "url(" + JSON.stringify(tile.banner) + ")";
    box.appendChild(idle);
    var row = document.createElement("div"); row.className = "row";
    function button(text, cls, fn) { var b = document.createElement("button"); b.type = "button"; b.textContent = text; if (cls) b.className = cls; b.addEventListener("click", fn); row.appendChild(b); return b; }
    var status = document.createElement("div"); status.className = "status";
    way.status = status; way.box = box; way.idle = idle;
    button("Start", "go", function () { startWay(way); });
    button("Stop", "", function () { stopWay(way, true); });
    button("It moves", "", function () { line(way.id + " owner", "it moves"); });
    button("It's still", "", function () { line(way.id + " owner", "it's still"); });
    button("Dragging works", "", function () { line(way.id + " owner", "dragging works"); });
    button("Dragging doesn't", "", function () { line(way.id + " owner", "dragging doesn't work"); });
    card.appendChild(h); card.appendChild(p); card.appendChild(box); card.appendChild(row); card.appendChild(status);
    grid.appendChild(card);
  });

  function stopWay(way, say) {
    if (way.frame) { way.frame.remove(); way.frame = null; }
    way.urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
    way.urls = [];
    clearInterval(way.watch);
    way.idle.hidden = false;
    if (say) { way.status.textContent = "Stopped."; line(way.id + " stopped", now()); }
  }
  function startWay(way) {
    ways.forEach(function (w) { if (w !== way && w.frame) stopWay(w, true); }); // one at a time, as on a zine page
    stopWay(way, false);
    var started = performance.now();
    var frame = document.createElement("iframe");
    frame.title = tile.name;
    way.frame = frame;
    way.idle.hidden = true;
    way.status.textContent = "Starting…";
    line(way.id + " start", now());
    function onLoad() {
      if (way.frame !== frame) return;
      var ms = Math.round(performance.now() - started);
      line(way.id + " frame loaded", ms + " ms");
      way.status.textContent = "Frame loaded after " + ms + " ms.";
      if (way.sealed) return; // can't look inside a sealed frame
      try {
        var w = frame.contentWindow;
        w.addEventListener("error", function (e) { line(way.id + " error in the tile", (e && e.message) || "unknown"); });
        line(way.id + " service worker in the frame", String(!!(w.navigator.serviceWorker && w.navigator.serviceWorker.controller)));
      } catch (e) { line(way.id + " can't look inside", e.message); }
      var looks = 0;
      clearInterval(way.watch);
      way.watch = setInterval(function () {
        if (way.frame !== frame) { clearInterval(way.watch); return; }
        looks++;
        try {
          var c = frame.contentDocument && frame.contentDocument.querySelector("canvas");
          if (c) { clearInterval(way.watch); line(way.id + " canvas", c.width + " x " + c.height + " after " + Math.round(performance.now() - started) + " ms"); way.status.textContent = "Running: a " + c.width + " x " + c.height + " canvas."; return; }
          var bodyText = frame.contentDocument && frame.contentDocument.body ? frame.contentDocument.body.innerText.trim().slice(0, 60) : "";
          if (looks === 20) { clearInterval(way.watch); line(way.id + " canvas", "none after 10 s" + (bodyText ? " (page says: " + bodyText + ")" : "")); way.status.textContent = "No canvas after 10 s."; }
        } catch (e) { clearInterval(way.watch); line(way.id + " can't look inside", e.message); }
      }, 500);
    }
    way.box.appendChild(frame);
    // Listen only once the tile's page is set (a new frame first loads a blank page).
    way.start(frame, way).then(function () { frame.addEventListener("load", onLoad); }).catch(function (err) {
      line(way.id + " failed", (err && err.message) || String(err));
      way.status.textContent = "Failed: " + ((err && err.message) || err);
    });
  }

  document.getElementById("copy").addEventListener("click", function () {
    line("Space now", space());
    var text = out.value;
    var done = function (how) { line("Copy", how); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done("copied"); }, function (e) { out.focus(); out.select(); done("clipboard refused (" + e.name + "); text selected, copy it by hand"); });
    } else { out.focus(); out.select(); done("text selected, copy it by hand"); }
  });
  window.addEventListener("resize", function () { /* the Space line is updated on Copy */ });
})();
`;

/** The test page. `config` as described above. */
export function renderTileTestHtml({ title, config }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
${TILE_CSP_META}
<meta name="referrer" content="no-referrer" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>${CSS}</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<p class="sub">Tile test for zine pages: ${escapeHtml(config.tile.name)} by ${escapeHtml(config.tile.by)}. Start each way in turn (starting one stops the others), try dragging, press the answer buttons, then Copy results.</p>
<div class="grid" id="ways"></div>
<div class="row"><button type="button" id="copy" class="go">Copy results</button></div>
<textarea id="results" readonly aria-label="Results"></textarea>
</main>
<script type="application/json" id="test-config">${scriptJson(config)}</script>
<script>${JS}</script>
</body>
</html>
`;
}
