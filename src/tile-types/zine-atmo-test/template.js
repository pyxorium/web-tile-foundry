import { TILE_CSP_META } from "../../core/policy.js";
import { scriptJson } from "../zine/runtime/template.js";

// The ATMOSYNTH host test page: one of the creator's ATMOSYNTH tiles, copied
// into this tile under /t1/, started three ways inside this tile's own frame.
// A small probe in the tile's frame reports whether its audio really runs
// (audio contexts, their state and clock, worklets loaded or refused, the JSON
// files it fetched, errors). Plain script, standard policy, addEventListener only.
//
// Config: { title, folder, tile: { name, by, uri, page, refs, fetched, types, poster? } }
//   page     the copied page as published ("/t1/index.html")
//   refs     [{ ref: "./tile.js", path: "/tile.js" }, …] addresses in the page
//   fetched  ["/patch.json", "/tile.json", "/samples.json"] files the player fetches itself
//   types    { "/tile.js": "text/javascript", … } content types by original path

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/**
 * The probe, run inside the tile's frame (called directly by this page for a
 * same-origin frame, or written into a sealed frame's page). Works on
 * prototypes, so it catches audio made after it's installed, however the
 * player keeps its own references. send(state) is called once a second.
 */
export function atmoProbe(w, send) {
  var st = { contexts: 0, state: "", time: 0, worklets: 0, workletFails: 0, fetches: [], errors: [], ui: "" };
  var ctxs = [];
  function note(c) { if (c && ctxs.indexOf(c) < 0) { ctxs.push(c); st.contexts = ctxs.length; } }
  function err(s) { if (st.errors.length < 20) st.errors.push(String(s).slice(0, 200)); }
  try {
    var AW = w.AudioWorklet && w.AudioWorklet.prototype;
    if (AW && AW.addModule) {
      var add = AW.addModule;
      AW.addModule = function () {
        var p = add.apply(this, arguments);
        p.then(function () { st.worklets++; }, function (e) { st.workletFails++; err("worklet refused: " + ((e && (e.name + ": " + e.message)) || e)); });
        return p;
      };
    }
    var AN = w.AudioNode && w.AudioNode.prototype;
    if (AN && AN.connect) {
      var con = AN.connect;
      AN.connect = function () { note(this.context); return con.apply(this, arguments); };
    }
  } catch (e) { err("probe: " + (e && e.message)); }
  w.addEventListener("error", function (e) { err((e && e.message) || "error"); });
  w.addEventListener("unhandledrejection", function (e) { var r = e && e.reason; err("rejection: " + ((r && (r.message || r.name)) || String(r))); });
  w.setInterval(function () {
    var c = ctxs[ctxs.length - 1];
    st.state = c ? c.state : "";
    st.time = c ? Math.round(c.currentTime * 10) / 10 : 0;
    st.fetches = (w.__atmoFetches || []).slice();
    try { st.ui = ((w.document.body && w.document.body.innerText) || "").replace(/\s+/g, " ").trim().slice(0, 80); } catch (e) {}
    send(JSON.parse(JSON.stringify(st)));
  }, 1000);
}

/**
 * The fetch helper, written into the tile's page before its player: answers
 * the player's own fetch("./patch.json") (and the like) from the copies this
 * page hands over (blob: or data: addresses). map is { "/patch.json": "blob:…", … }.
 */
export function fetchHelperSource(map) {
  return "(function(){var M=" + JSON.stringify(map) + ";var F=window.fetch;window.__atmoFetches=[];" +
    "window.fetch=function(i,o){var u=typeof i===\"string\"?i:(i&&i.url)||\"\";var k=u.replace(/^\\.\\//,\"/\");if(k.charAt(0)!==\"/\")k=\"/\"+k;" +
    "if(Object.prototype.hasOwnProperty.call(M,k)){window.__atmoFetches.push(k);return F.call(window,M[k],o);}return F.apply(window,arguments);};})();";
}

const CSS = `
html, body { margin: 0; background: #f4f1ea; color: #1b1a17; font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { padding: 12px; max-width: 760px; }
h1 { font-size: 17px; margin: 0 0 2px; }
.sub { margin: 0 0 10px; color: #6a655c; font-size: 12px; }
.way { background: #fff; border: 1px solid #ddd5c6; border-radius: 8px; padding: 8px; margin-bottom: 12px; }
.way h2 { font-size: 14px; margin: 0 0 2px; }
.way p { margin: 0 0 6px; font-size: 12px; color: #6a655c; }
.box { position: relative; width: 100%; aspect-ratio: 720 / 520; max-height: 70vh; background: #0a0713; border-radius: 6px; overflow: hidden; }
.box iframe { display: block; width: 100%; height: 100%; border: 0; }
.box .idle[hidden] { display: none; }
.box .idle { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #bbb; font-size: 12px; background-size: cover; background-position: center; }
.row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
button { font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 999px; border: 1px solid #b9b0a0; background: #fff; cursor: pointer; }
button.go { background: #1b1a17; color: #fff; border-color: #1b1a17; }
.status { margin-top: 4px; font-size: 12px; min-height: 1.4em; }
textarea { width: 100%; box-sizing: border-box; height: 190px; margin-top: 4px; font: 12px/1.35 ui-monospace, Menlo, Consolas, monospace; }
`;

const JS = String.raw`
(function () {
  "use strict";
  var config = JSON.parse(document.getElementById("test-config").textContent);
  var tile = config.tile;
  var folder = config.folder;
  var probe = window.__atmoProbe;
  var helperSource = window.__atmoHelper;
  var out = document.getElementById("results");
  var lines = [];
  var t0 = performance.now();
  function now() { return ((performance.now() - t0) / 1000).toFixed(1) + " s"; }
  function log(s) { lines.push(s); out.value = lines.join("\n"); }
  function line(k, v) { log(k + ": " + v); }
  function space() { return Math.round(window.innerWidth) + " x " + Math.round(window.innerHeight); }

  line("Test", "ATMOSYNTH tile on a zine page, " + new Date().toISOString());
  line("Tile copied", tile.name + " by " + tile.by + " (" + tile.uri + ")");
  line("Browser", navigator.userAgent);
  line("Space", space() + ", pixel ratio " + (window.devicePixelRatio || 1));
  var host = "unknown";
  try { host = document.referrer ? new URL(document.referrer).host : "(no referrer)"; } catch (e) {}
  line("In a frame", String(window.parent !== window) + "; referrer " + host + "; origin " + location.origin);
  var sw = "no";
  try { sw = String(!!(navigator.serviceWorker && navigator.serviceWorker.controller)); } catch (e) { sw = "can't tell (" + (e && e.name) + ")"; }
  line("Service worker in this page", sw);
  if (location.origin === "null") line("Note", "this is a sealed preview (like the Foundry's own preview), not a tile host: the copied files can't load here. Publish, then test on appmosphe.re and the gallery.");

  function getBlob(path) { return fetch(path).then(function (r) { if (!r.ok) throw new Error(path + " answered " + r.status); return r.blob(); }); }
  function getText(path) { return getBlob(path).then(function (b) { return b.text ? b.text() : new Response(b).text(); }); }
  function typed(blob, path) { return new Blob([blob], { type: tile.types[path] || blob.type || "application/octet-stream" }); }
  function dataUrl(blob) { return new Promise(function (ok, no) { var fr = new FileReader(); fr.onload = function () { ok(fr.result); }; fr.onerror = function () { no(fr.error); }; fr.readAsDataURL(blob); }); }
  function quoteSwap(html, from, to) { return html.split('"' + from + '"').join('"' + to + '"').split("'" + from + "'").join("'" + to + "'"); }
  function headInsert(html, extra) {
    var m = /<head[^>]*>/i.exec(html);
    if (m) return html.slice(0, m.index + m[0].length) + extra + html.slice(m.index + m[0].length);
    return extra + html;
  }
  var END = "<" + "/script"; // never written as one piece: it would end this script
  function scriptTag(src) { return "<script>" + src.split(END).join("<\\/script") + END + ">"; }
  function isCode(p) { return /\.(js|css)$/.test(p); }
  // Exact root addresses of the tile's own files written in its script or
  // stylesheet ("/assets/mark.svg" in quotes or backticks) don't resolve once
  // the tile runs from copies, so they're swapped for the copies' addresses.
  function swapRoots(text, addr, swapped) {
    Object.keys(addr).forEach(function (p) {
      ["\"", "'", String.fromCharCode(96)].forEach(function (q) {
        var from = q + p + q;
        if (text.indexOf(from) >= 0) { text = text.split(from).join(q + addr[p] + q); if (swapped.indexOf(p) < 0) swapped.push(p); }
      });
    });
    return text;
  }
  // Every file of the tile (but its page), ready to hand over: addr[path] is a
  // blob: address (kind "blob") or a data: address (kind "data"); code[path]
  // the script and stylesheet texts after swapRoots.
  function prepare(kind, way) {
    var paths = Object.keys(tile.types).filter(function (p) { return p !== "/"; });
    var got = {}, addr = {}, code = {}, swapped = [];
    function address(blob) {
      if (kind === "blob") { var u = URL.createObjectURL(blob); way.urls.push(u); return Promise.resolve(u); }
      return dataUrl(blob);
    }
    return Promise.all(paths.map(function (p) { return getBlob(folder + p).then(function (b) { got[p] = typed(b, p); }); }))
      .then(function () { return Promise.all(paths.filter(function (p) { return !isCode(p); }).map(function (p) { return address(got[p]).then(function (a) { addr[p] = a; }); })); })
      .then(function () {
        var plain = {}; Object.keys(addr).forEach(function (p) { plain[p] = addr[p]; });
        return Promise.all(paths.filter(isCode).map(function (p) {
          return (got[p].text ? got[p].text() : new Response(got[p]).text()).then(function (t) {
            code[p] = swapRoots(t, plain, swapped);
            return address(new Blob([code[p]], { type: tile.types[p] })).then(function (a) { addr[p] = a; });
          });
        }));
      })
      .then(function () {
        if (swapped.length) line(way.id + " root addresses swapped in the player", swapped.join(", "));
        return { addr: addr, code: code };
      });
  }

  var ways = [
    { id: "B", name: "B. The tile's own page, in its folder", note: "The frame opens " + tile.page + " as published. Its files come from /t1/ through this tile's loader (needs the loader's service worker in the frame).",
      start: function (frame) { frame.src = tile.page; return Promise.resolve(); } },
    { id: "C", name: "C. Files handed over (as zines do today)", note: "This page downloads the files itself, gives the frame blob: copies, and answers the player's own fetch(\"./patch.json\") with a small helper. No service worker needed.",
      start: function (frame, way) {
        return prepare("blob", way).then(function (ready) {
          return getText(tile.page).then(function (html) {
            tile.refs.forEach(function (r) { html = quoteSwap(html, r.ref, ready.addr[r.path]); });
            var map = {}; tile.fetched.forEach(function (p) { map[p] = ready.addr[p]; });
            html = headInsert(html, scriptTag(helperSource(map)));
            var u = URL.createObjectURL(new Blob([html], { type: "text/html" }));
            way.urls.push(u);
            frame.src = u;
          });
        });
      } },
    { id: "D", name: "D. Walled off (sealed frame)", note: "Everything written into the page and the frame sealed off (sandbox, no same origin): the safest way for other people's tiles later. Audio and storage may behave differently here.",
      sealed: true,
      start: function (frame, way) {
        return prepare("data", way).then(function (ready) {
          return getText(tile.page).then(function (html) {
            tile.refs.forEach(function (r) {
              var q = "[\"']" + r.ref.replace(/[.*+?^$(){}|[\]\\\/]/g, "\\$&") + "[\"']";
              if (/\.js$/.test(r.path)) {
                html = html.replace(new RegExp("<script([^>]*?)\\s+src=" + q + "([^>]*)>\\s*" + END + ">", "i"), function (all, a, b) {
                  var attrs = (a + b).replace(/\s+crossorigin(=["'][^"']*["'])?/i, "");
                  return "<script" + attrs + ">" + ready.code[r.path].split(END).join("<\\/script") + END + ">";
                });
              } else if (/\.css$/.test(r.path)) {
                html = html.replace(new RegExp("<link[^>]*href=" + q + "[^>]*>", "i"), function () { return "<style>" + ready.code[r.path] + "</style>"; });
              } else {
                html = quoteSwap(html, r.ref, ready.addr[r.path]);
              }
            });
            var map = {}; tile.fetched.forEach(function (p) { map[p] = ready.addr[p]; });
            var probeCall = "(" + probe.toString() + ")(window,function(s){parent.postMessage({atmoProbe:s},\"*\");});";
            html = headInsert(html, scriptTag(helperSource(map)) + scriptTag(probeCall));
            frame.setAttribute("sandbox", "allow-scripts");
            frame.srcdoc = html;
          });
        });
      } },
  ];

  var list = document.getElementById("ways");
  ways.forEach(function (way) {
    way.urls = [];
    var card = document.createElement("section"); card.className = "way";
    var h = document.createElement("h2"); h.textContent = way.name;
    var p = document.createElement("p"); p.textContent = way.note;
    var box = document.createElement("div"); box.className = "box";
    var idle = document.createElement("div"); idle.className = "idle"; idle.textContent = "Not started";
    if (tile.poster) idle.style.backgroundImage = "url(" + JSON.stringify(tile.poster) + ")";
    box.appendChild(idle);
    var row = document.createElement("div"); row.className = "row";
    function button(text, cls, fn) { var b = document.createElement("button"); b.type = "button"; b.textContent = text; if (cls) b.className = cls; b.addEventListener("click", fn); row.appendChild(b); return b; }
    var status = document.createElement("div"); status.className = "status";
    way.status = status; way.box = box; way.idle = idle;
    button("Start", "go", function () { startWay(way); });
    button("Stop", "", function () { stopWay(way, true); });
    button("It plays", "", function () { line(way.id + " owner", "it plays"); });
    button("It's silent", "", function () { line(way.id + " owner", "it's silent"); });
    button("Knobs work", "", function () { line(way.id + " owner", "knobs work"); });
    button("Knobs don't", "", function () { line(way.id + " owner", "knobs don't work"); });
    card.appendChild(h); card.appendChild(p); card.appendChild(box); card.appendChild(row); card.appendChild(status);
    list.appendChild(card);
  });

  function stopWay(way, say) {
    if (way.frame) { way.frame.remove(); way.frame = null; }
    way.urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
    way.urls = [];
    way.seen = null;
    way.idle.hidden = false;
    if (say) { way.status.textContent = "Stopped."; line(way.id + " stopped", now()); }
  }

  // What the probe reports: log changes, show the latest.
  function report(way, st) {
    var seen = way.seen || (way.seen = { errors: 0, fetches: 0, worklets: 0, fails: 0, state: "", contexts: 0, ui: false, ran: false });
    if (st.ui && !seen.ui) { seen.ui = true; line(way.id + " player shown", now() + " (" + st.ui.slice(0, 50) + ")"); }
    if (st.fetches.length > seen.fetches) { line(way.id + " helper answered", st.fetches.slice(seen.fetches).join(", ")); seen.fetches = st.fetches.length; }
    if (st.contexts > seen.contexts) { line(way.id + " audio contexts", String(st.contexts)); seen.contexts = st.contexts; }
    if (st.worklets > seen.worklets && seen.worklets === 0) line(way.id + " worklets", "loading (" + st.worklets + " so far)");
    seen.worklets = st.worklets;
    if (st.workletFails > seen.fails) { line(way.id + " worklets refused", String(st.workletFails)); seen.fails = st.workletFails; }
    if (st.state && st.state !== seen.state) { line(way.id + " audio", st.state + " at " + now()); seen.state = st.state; }
    if (st.state === "running" && st.time > 3 && !seen.ran) { seen.ran = true; line(way.id + " audio clock", "advancing (" + st.time + " s), " + st.worklets + " worklets loaded"); }
    for (var i = seen.errors; i < st.errors.length; i++) line(way.id + " error", st.errors[i]);
    seen.errors = st.errors.length;
    way.status.textContent = "Audio: " + (st.state || "not started yet (press PLAY in the tile)") + (st.state ? " · clock " + st.time + " s" : "") + " · worklets " + st.worklets + (st.workletFails ? " (" + st.workletFails + " refused)" : "") + (st.errors.length ? " · " + st.errors.length + " errors" : "");
  }
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || !d.atmoProbe) return;
    ways.forEach(function (way) { if (way.frame && way.frame.contentWindow === e.source) report(way, d.atmoProbe); });
  });

  function startWay(way) {
    ways.forEach(function (w) { if (w !== way && w.frame) stopWay(w, true); }); // one at a time, as on a zine page
    stopWay(way, false);
    var started = performance.now();
    var frame = document.createElement("iframe");
    frame.title = tile.name;
    frame.setAttribute("allow", "autoplay");
    way.frame = frame;
    way.idle.hidden = true;
    way.status.textContent = "Starting…";
    line(way.id + " start", now());
    function onLoad() {
      if (way.frame !== frame) return;
      var ms = Math.round(performance.now() - started);
      line(way.id + " frame loaded", ms + " ms");
      way.status.textContent = "Frame loaded after " + ms + " ms. Press PLAY in the tile.";
      if (way.sealed) return; // its probe was written into the page and reports by message
      try {
        var w = frame.contentWindow;
        line(way.id + " service worker in the frame", String(!!(w.navigator.serviceWorker && w.navigator.serviceWorker.controller)));
        probe(w, function (st) { if (way.frame === frame) report(way, st); });
      } catch (e) { line(way.id + " can't look inside", e.message); }
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
})();
`;

/** The test page. `config` as described above. */
export function renderAtmoTestHtml({ title, config }) {
  const shared = `window.__atmoProbe = ${atmoProbe.toString()};\nwindow.__atmoHelper = ${fetchHelperSource.toString()};`;
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
<p class="sub">ATMOSYNTH tile on a zine page: ${escapeHtml(config.tile.name)} by ${escapeHtml(config.tile.by)}. Start each way in turn (starting one stops the others), press PLAY in the tile, turn a knob, press the answer buttons, then Copy results.</p>
<div class="row" style="margin:0 0 8px"><button type="button" id="copy" class="go">Copy results</button></div>
<textarea id="results" readonly aria-label="Results"></textarea>
<div id="ways" style="margin-top:12px"></div>
</main>
<script type="application/json" id="test-config">${scriptJson(config)}</script>
<script>${shared}</script>
<script>${JS}</script>
</body>
</html>
`;
}
