import { bytesToDataUri } from "../../core/bytes.js";
import { renderZineHtml } from "./runtime/template.js";
import { EDITOR_JS } from "./runtime/editor.js";
import { zineConfig, madeLabel, PAGES } from "./pages.js";
import { STICKERS, PEN_SLOTS, MAX_MARKS, markColors, marksSvg } from "./marks.js";
import { lookOf } from "./looks.js";

// Sounds in the preview: the reader asks for a clip by this address and the
// Foundry hands over its bytes (they're in memory here). The number changes
// whenever the clip is made again, so the reader never plays an old cut.
const clipNumbers = new WeakMap();
let clipCount = 0;
function clipSrc(page) {
  const bytes = page.clip.bytes;
  if (!clipNumbers.has(bytes)) clipNumbers.set(bytes, ++clipCount);
  return `clip:${page.id}:${clipNumbers.get(bytes)}`;
}

// Tiles in the preview (stage 4): the reader asks for a tile's files by
// "piece:<page id>:<n><path>" and the Foundry hands over their bytes. The number
// changes when the page's tile is copied again, so nothing old is reused.
const tileNumbers = new WeakMap();
let tileCount = 0;
function tileSrc(pages) {
  return (pageId, path) => {
    const page = (pages || []).find((p) => p && p.id === pageId);
    const files = page && page.piece && page.piece.files;
    if (!files) return `piece:${pageId}:0${path}`;
    if (!tileNumbers.has(files)) tileNumbers.set(files, ++tileCount);
    return `piece:${pageId}:${tileNumbers.get(files)}${path}`;
  };
}

// The Foundry's preview of a zine: the tile's own page and reader, in a
// sandboxed frame like the real tile hosts, with the pictures handed in as
// data: addresses (a frame can't read the Foundry's files). The frame is made
// once; after that every change is sent to it, so the reader stays on the page
// being read. Opening a page in the editor turns the preview to it.
//
// Decorating (stickers and drawing): "Decorate" above the preview turns the
// page being edited into a canvas (runtime/editor.js, added to the preview's
// page only). The toolbar here picks the tool; each change comes back as the
// page's new marks, which are saved into the panel's values (so they're
// published, and undo works).

const dataUris = new WeakMap(); // picture bytes -> data: address

function pictureSrc(page) {
  const pic = page.picture;
  let uri = dataUris.get(pic.bytes);
  if (!uri) {
    uri = bytesToDataUri(pic.bytes, pic.contentType);
    dataUris.set(pic.bytes, uri);
  }
  return uri;
}

function spriteSrc(sprite) {
  let uri = dataUris.get(sprite.bytes);
  if (!uri) {
    uri = bytesToDataUri(sprite.bytes, "image/png");
    dataUris.set(sprite.bytes, uri);
  }
  return uri;
}

const ALL_STICKERS = Object.fromEntries(STICKERS.map((s) => [s.id, s.svg]));

export function previewConfig(values) {
  const config = zineConfig({
    title: values.name || "",
    handle: values.handle || "",
    paper: values.paper,
    look: values.look,
    ink: values.ink,
    pages: values.pages || [],
    made: madeLabel(),
    src: pictureSrc,
    sprite: values.sprite || null,
    spriteSrc: values.sprite && values.sprite.bytes ? spriteSrc(values.sprite) : undefined,
    soundSrc: clipSrc,
    tileSrc: tileSrc(values.pages),
    preview: true,
  });
  // Decorating needs every sticker and the look's colours, even on a page with no marks yet.
  config.stickers = ALL_STICKERS;
  config.markColors = markColors(values.look, values.ink);
  return config;
}

function stickerIcon(st, colors) {
  const svg = marksSvg([{ t: "s", id: st.id, x: 30, y: 30, s: 0.85, r: 0 }], colors, 60, 60);
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

function button(text, cls = "", title = "") {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `zt-btn ${cls}`.trim();
  if (text) b.textContent = text;
  if (title) { b.title = title; b.setAttribute("aria-label", title); }
  return b;
}

export function mountZinePreview(element, { values, setValue, onSelect }) {
  const box = document.createElement("div");
  box.className = "zine-preview";
  const bar = document.createElement("div");
  bar.className = "zine-tools";
  const frame = document.createElement("iframe");
  frame.title = "Live preview of your zine";
  frame.setAttribute("sandbox", "allow-scripts allow-popups allow-popups-to-escape-sandbox");
  let ready = false;
  let pending = null;
  let disposed = false;
  let latest = values;
  let pageId = "cover"; // the page open in the editor
  const deco = { on: false, tool: "sticker", sticker: "star", pen: "a", width: "fine", selected: false };
  const history = []; // { id, marks } before each change, for Undo

  function send(message) {
    if (!frame.contentWindow) return;
    frame.contentWindow.postMessage(message, "*");
  }
  function pageIndex(id) { return PAGES.findIndex((p) => p.id === id); }
  function marksOf(id) {
    const p = (latest.pages || [])[pageIndex(id)];
    return (p && p.marks) || [];
  }
  function saveMarks(id, marks, remember = true) {
    const pages = (latest.pages || []).slice();
    const i = pageIndex(id);
    if (i < 0 || !pages[i]) return;
    if (remember) history.push({ id, marks: marksOf(id) });
    if (history.length > 60) history.shift();
    pages[i] = { ...pages[i], marks };
    latest = { ...latest, pages };
    if (setValue) setValue("pages", pages);
  }
  function sendEdit(extra = {}) {
    send({ zine: "edit", on: deco.on, id: pageId, tool: deco.tool, sticker: deco.sticker, pen: deco.pen, width: deco.width, ...extra });
  }

  function onMessage(e) {
    if (e.source !== frame.contentWindow || !e.data) return;
    const m = e.data;
    if (m.zine === "ready") {
      ready = true;
      if (pending) { send({ zine: "config", config: pending }); pending = null; }
    } else if (m.zine === "marks" && deco.on && typeof m.id === "string") {
      saveMarks(m.id, Array.isArray(m.marks) ? m.marks : []);
      drawBar();
    } else if (m.zine === "clip" && typeof m.src === "string") {
      // The reader wants a sound's bytes.
      const [, id, n] = m.src.split(":");
      const page = (latest.pages || []).find((p) => p && p.id === id);
      const bytes = page && page.clip && page.clip.bytes;
      if (bytes && String(clipNumbers.get(bytes)) === n) {
        const copy = bytes.slice().buffer;
        frame.contentWindow.postMessage({ zine: "clip", src: m.src, bytes: copy }, "*", [copy]);
      } else {
        send({ zine: "clip", src: m.src, error: "this sound has changed since" });
      }
    } else if (m.zine === "piece" && typeof m.src === "string") {
      // The reader wants one of a tile's files.
      const match = /^piece:([A-Za-z0-9_-]+):(\d+)(\/.*)$/.exec(m.src);
      const page = match && (latest.pages || []).find((p) => p && p.id === match[1]);
      const files = page && page.piece && page.piece.files;
      const file = files && String(tileNumbers.get(files)) === match[2] && files.find((f) => f.path === match[3]);
      if (file) {
        const copy = file.bytes.slice().buffer;
        frame.contentWindow.postMessage({ zine: "piece", src: m.src, bytes: copy, type: file.contentType || "" }, "*", [copy]);
      } else {
        send({ zine: "piece", src: m.src, error: "this tile has changed since" });
      }
    } else if (m.zine === "selected") {
      deco.selected = Boolean(m.has);
      drawBar();
    }
  }
  window.addEventListener("message", onMessage);

  // The toolbar above the preview. Redrawn only when something it shows changes
  // (so a click isn't lost to a redraw).
  let shown = "";
  function drawBar() {
    const sig = JSON.stringify([deco, pageId, history.length > 0, marksOf(pageId).length, latest.look, latest.ink]);
    if (sig === shown) return;
    shown = sig;
    bar.replaceChildren();
    const spec = PAGES[pageIndex(pageId)] || PAGES[0];
    if (!deco.on) {
      const b = button(`Decorate ${spec.kind === "page" ? spec.label.toLowerCase() : "the " + spec.label.toLowerCase()}`, "zt-main");
      b.addEventListener("click", () => { deco.on = true; history.length = 0; sendEdit(); drawBar(); });
      const hint = document.createElement("span");
      hint.className = "zt-hint";
      hint.textContent = "Stickers and drawing";
      bar.append(b, hint);
      return;
    }
    const look = lookOf(latest.look);
    const colors = markColors(latest.look, latest.ink);
    const row = document.createElement("div");
    row.className = "zt-row";
    const tools = document.createElement("div");
    tools.className = "zt-seg";
    for (const [tool, label] of [["sticker", "Stickers"], ["pen", "Pen"], ["eraser", "Eraser"]]) {
      const b = button(label, deco.tool === tool ? "on" : "");
      b.setAttribute("aria-pressed", String(deco.tool === tool));
      b.addEventListener("click", () => { deco.tool = tool; sendEdit(); drawBar(); });
      tools.append(b);
    }
    const undo = button("Undo", "", "Undo the last change");
    undo.disabled = history.length === 0;
    undo.addEventListener("click", () => {
      const last = history.pop();
      if (!last) return;
      if (last.id !== pageId) { pageId = last.id; sendEdit(); }
      saveMarks(last.id, last.marks, false);
      drawBar();
    });
    const clear = button("Clear page", "", "Remove every sticker and drawing on this page");
    clear.disabled = marksOf(pageId).length === 0;
    clear.addEventListener("click", () => { saveMarks(pageId, []); drawBar(); });
    const done = button("Done", "zt-main");
    done.addEventListener("click", () => { deco.on = false; sendEdit(); drawBar(); });
    row.append(tools, undo, clear, done);
    bar.append(row);

    const opts = document.createElement("div");
    opts.className = "zt-row zt-opts";
    if (deco.tool === "sticker") {
      for (const st of STICKERS) {
        const b = button("", `zt-sticker ${deco.sticker === st.id ? "on" : ""}`, st.label);
        const img = document.createElement("img");
        img.src = stickerIcon(st, colors);
        img.alt = "";
        if (look === "photocopy") img.style.filter = "grayscale(1) contrast(1.35)";
        b.append(img);
        b.addEventListener("click", () => { deco.sticker = st.id; sendEdit(); drawBar(); });
        opts.append(b);
      }
      if (deco.selected) {
        const del = button("Remove sticker", "zt-small");
        del.addEventListener("click", () => sendEdit({ remove: true }));
        opts.append(del);
      }
    } else if (deco.tool === "pen") {
      const slots = PEN_SLOTS[look] || PEN_SLOTS.clean;
      if (!slots.some(([slot]) => slot === deco.pen)) deco.pen = slots[0][0];
      for (const [slot, name] of slots) {
        const b = button("", `zt-pen ${deco.pen === slot ? "on" : ""}`, name);
        const dot = document.createElement("span");
        dot.style.background = colors.pens[slot];
        if (slot === "hi") dot.style.opacity = String(Math.max(0.5, colors.hiOpacity));
        b.append(dot, document.createTextNode(name));
        b.addEventListener("click", () => { deco.pen = slot; sendEdit(); drawBar(); });
        opts.append(b);
      }
      for (const [w, name] of [["fine", "Fine"], ["thick", "Thick"]]) {
        const b = button(name, `zt-small ${deco.width === w ? "on" : ""}`);
        b.addEventListener("click", () => { deco.width = w; sendEdit(); drawBar(); });
        opts.append(b);
      }
    } else {
      const t = document.createElement("span");
      t.className = "zt-hint";
      t.textContent = "Tap a sticker or a line to remove it.";
      opts.append(t);
    }
    const count = document.createElement("span");
    count.className = "zt-hint zt-count";
    const n = marksOf(pageId).length;
    count.textContent = n >= MAX_MARKS ? `This page is full (${MAX_MARKS})` : `${n} of ${MAX_MARKS}`;
    opts.append(count);
    bar.append(opts);
    const help = document.createElement("p");
    help.className = "zt-hint zt-help";
    help.textContent = deco.tool === "sticker"
      ? "Tap the page to add the sticker. Drag a sticker to move it; drag its round handle to resize and turn it."
      : deco.tool === "pen" ? "Draw on the page with your mouse or finger." : "";
    if (help.textContent) bar.append(help);
  }

  const first = previewConfig(values);
  frame.srcdoc = renderZineHtml({ title: first.title || "Zine", config: first, extraScript: EDITOR_JS });
  box.append(bar, frame);
  element.append(box);
  drawBar();

  const stopSelect = onSelect((id) => {
    pageId = id;
    if (ready) send({ zine: "goto", id });
    if (deco.on) sendEdit();
    drawBar();
  });

  return {
    update(next) {
      if (disposed) return;
      const lookChanged = next.look !== latest.look || next.ink !== latest.ink;
      latest = next;
      const config = previewConfig(next);
      if (ready) send({ zine: "config", config });
      else pending = config;
      if (lookChanged) drawBar();
    },
    dispose() {
      disposed = true;
      stopSelect();
      window.removeEventListener("message", onMessage);
      box.remove(); // only this preview's own box (React may mount twice in development)
    },
  };
}
