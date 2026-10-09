import { fetchPublicBlob } from "../../core/atproto.js";
import { rawCid } from "../../core/cid.js";
import { formatSize } from "../../core/fileset.js";
import { convertPcm } from "../../core/audio/convert.js";
import { TAPE_FORMAT } from "../../core/audio/mp3.js";
import { listPlyrSongs, ownerNames, groupShows } from "../mixtape/plyr.js";
import { sharedPool } from "../mixtape/shared.js";
import {
  clipFromSong, cleanCut, clipFades, clipUpToDate, CLIP_MAX_SECONDS, CLIP_MIN_SECONDS, SOUND_TITLE_MAX, SOUND_DETAILS_MAX,
} from "./sound.js";

// The "Add a sound" panel under a page's switch (stage 3): pick one of your
// plyr.fm songs, cut up to a minute of it on a waveform with two handles,
// listen, and name it. Plain DOM, mounted by the Foundry's page editor
// (pageToggles' panel in src/core/contract.js) for the page being edited.
//
// The song is downloaded from your PDS once and read by the browser once (kept
// while the Foundry is open); only the clip is converted (the Mixtape's MP3
// format, with a short fade in and out), a moment after the handles stop.

// Shared by every page's panel.
const songLists = new Map(); // did -> Promise<songs>
const originals = new Map(); // blob cid -> Promise<Uint8Array>
const decodedSongs = new Map(); // blob cid -> Promise<AudioBuffer> (the last two)
const peakCache = new Map(); // blob cid -> Float32Array
const clipResults = new Map(); // "cid|start|end" -> Promise<{ bytes, seconds }>
const MAKE_DELAY_MS = 600;
const PEAKS = 900;

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}

/** "1:02.3" */
export function clockTenths(sec) {
  const t = Math.max(0, Math.round((Number(sec) || 0) * 10)) / 10;
  const m = Math.floor(t / 60);
  const s = (t - m * 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
}

function accountOf(ctx) {
  const a = ctx && ctx.account;
  if (!a || a.status !== "signedIn" || !a.did) return { state: "out" };
  if (a.lookupError) return { state: "lookup" };
  if (!a.pds) return { state: "waiting" };
  return { state: "ok", did: a.did, pds: a.pds, handle: a.handle || null };
}

function songsOf(a) {
  if (!songLists.has(a.did)) {
    const p = (async () => {
      const names = await ownerNames({ did: a.did, pds: a.pds, handle: a.handle });
      return listPlyrSongs({ did: a.did, pds: a.pds, owner: names });
    })();
    p.catch(() => songLists.delete(a.did));
    songLists.set(a.did, p);
  }
  return songLists.get(a.did);
}

function original(a, cid) {
  if (!originals.has(cid)) {
    const p = (async () => {
      const bytes = await fetchPublicBlob(a.did, a.pds, cid);
      if ((await rawCid(bytes)) !== cid) throw new Error("the downloaded file doesn't match the song's record");
      return bytes;
    })();
    p.catch(() => originals.delete(cid));
    originals.set(cid, p);
  }
  return originals.get(cid);
}

async function decodeBytes(bytes) {
  const Ctx = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Ctx) throw new Error("this browser can't read audio");
  const rate = TAPE_FORMAT.decodeRate;
  const ctx = new Ctx(2, rate, rate);
  try {
    return await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  } catch (e) {
    throw new Error(`the song couldn't be read (${(e && e.message) || "unknown format"})`);
  }
}

function decoded(a, cid) {
  if (!decodedSongs.has(cid)) {
    const p = original(a, cid).then(decodeBytes);
    p.catch(() => decodedSongs.delete(cid));
    decodedSongs.set(cid, p);
    // A long song takes a lot of memory once read: keep only the last two.
    while (decodedSongs.size > 2) decodedSongs.delete(decodedSongs.keys().next().value);
  } else {
    const p = decodedSongs.get(cid);
    decodedSongs.delete(cid);
    decodedSongs.set(cid, p);
  }
  return decodedSongs.get(cid);
}

/** How loud the song is across its length (PEAKS columns, 0 to 1), for drawing. */
export function peaksFor(left, right, n = PEAKS) {
  const out = new Float32Array(n);
  const len = left.length;
  if (!len) return out;
  const per = len / n;
  const stride = Math.max(1, Math.floor(per / 200));
  let top = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * per), b = Math.min(len, Math.floor((i + 1) * per));
    let m = 0;
    for (let k = a; k < b; k += stride) {
      const v = Math.max(Math.abs(left[k]), Math.abs(right[k]));
      if (v > m) m = v;
    }
    out[i] = m;
    if (m > top) top = m;
  }
  if (top > 0) for (let i = 0; i < n; i++) out[i] /= top;
  return out;
}

function makeClip(a, cid, start, end, onProgress) {
  const key = `${cid}|${start}|${end}`;
  if (!clipResults.has(key)) {
    const p = (async () => {
      const buf = await decoded(a, cid);
      const rate = buf.sampleRate;
      const s0 = Math.floor(start * rate), s1 = Math.min(buf.length, Math.floor(end * rate));
      const left = buf.getChannelData(0).slice(s0, s1);
      const right = (buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)).slice(s0, s1);
      const r = await convertPcm({ left, right, rate }, { pool: sharedPool(), ...clipFades(end - start), onProgress });
      return { bytes: r.bytes, seconds: r.seconds };
    })();
    p.catch(() => clipResults.delete(key));
    clipResults.set(key, p);
  }
  return clipResults.get(key);
}

/**
 * Where a sound panel's songs come from. The default is the creator's plyr.fm
 * songs; a tape page's taste (stage 4) lists the tape's own songs instead.
 */
export const PLYR_SOURCE = Object.freeze({
  list: (a) => songsOf(a),
  forget: (a) => songLists.delete(a.did),
  groups: (all) => groupShows(all).map((show) => ({ label: show.album, songs: show.songs })),
  refresh: true,
  pickLabel: "Song for this page's sound",
  signedOut: "Sign in to pick one of your plyr.fm songs.",
  placeholder: "Your plyr.fm songs",
  looking: "Looking for your plyr.fm songs…",
  none: "None of your plyr.fm songs can be used yet: their audio is only on plyr.fm's storage. In plyr.fm, copy a song's audio to your PDS to use it here.",
  failed: (msg) => `Your plyr.fm songs couldn't be listed (${msg}). Press Refresh to try again.`,
  unusableNote: (n) => `${n} of your songs ${n === 1 ? "is" : "are"} only on plyr.fm's storage or for supporters, so ${n === 1 ? "it isn't" : "they aren't"} listed.`,
});

export function mountSoundPanel(root, { getPage, patchPage, context }, songSource = PLYR_SOURCE) {
  const box = el("div", "snd-panel");
  root.append(box);

  const head = el("div", "snd-head");
  const pick = el("select", "text snd-pick");
  pick.setAttribute("aria-label", songSource.pickLabel);
  const refresh = el("button", "btn btn-quiet btn-small", "Refresh");
  refresh.type = "button";
  head.append(pick, refresh);
  const listNote = el("p", "field-help snd-note");
  const status = el("p", "snd-status");
  status.setAttribute("aria-live", "polite");

  const wave = el("div", "snd-wave");
  const canvas = el("canvas");
  canvas.setAttribute("aria-hidden", "true");
  const hStart = el("div", "snd-handle snd-start");
  const hEnd = el("div", "snd-handle snd-end");
  for (const [h, name] of [[hStart, "Start of the clip"], [hEnd, "End of the clip"]]) {
    h.tabIndex = 0;
    h.setAttribute("role", "slider");
    h.setAttribute("aria-label", name);
    h.append(el("span", "snd-knob"));
  }
  const head2 = el("div", "snd-playhead");
  wave.append(canvas, head2, hStart, hEnd);
  const times = el("p", "snd-times");
  const tools = el("div", "snd-tools");
  const listen = el("button", "btn btn-quiet btn-small", "▶ Listen to the clip");
  listen.type = "button";
  const stopBtn = el("button", "btn btn-quiet btn-small", "■ Stop");
  stopBtn.type = "button";
  const waveHelp = el("span", "field-help snd-wave-help", "Drag the handles (or use the arrow keys) to choose up to a minute. Tap the waveform to listen from there.");
  tools.append(listen, stopBtn);
  const made = el("p", "snd-made");
  made.setAttribute("aria-live", "polite");
  const retry = el("button", "btn btn-quiet btn-small", "Try again");
  retry.type = "button";

  const titleRow = el("label", "field page-text snd-field");
  titleRow.append(el("span", "field-label", "Sound's title"));
  const titleIn = el("input", "text");
  titleIn.maxLength = SOUND_TITLE_MAX;
  titleRow.append(titleIn);
  const detailsRow = el("label", "field page-text snd-field");
  detailsRow.append(el("span", "field-label", "Details line (optional)"));
  const detailsIn = el("input", "text");
  detailsIn.maxLength = SOUND_DETAILS_MAX;
  detailsRow.append(detailsIn);
  const editor = el("div", "snd-editor");
  editor.append(wave, times, tools, waveHelp, made, titleRow, detailsRow);
  box.append(head, listNote, status, editor);

  let account = null;
  let songs = null; // usable songs, by uri
  let listTicket = 0;
  let disposed = false;
  let page = getPage() || {};
  let peaks = null; // for the song on the waveform
  let peaksCid = null;
  let makeTimer = null;
  let pendingMake = null; // the clip waiting to be made (made at once if the panel closes)
  let making = null; // key being made
  let progress = null;
  let ctxAudio = null, source = null, playFrom = 0, playStarted = 0, playUntil = 0, raf = 0;

  const clip = () => (page && page.clip) || null;
  const songSeconds = () => { const c = clip(); return (c && c.song && c.song.seconds) || 0; };

  function setStatus(text, error = false) {
    status.textContent = text || "";
    status.hidden = !text;
    status.classList.toggle("is-error", error);
  }

  // The song list.
  async function loadList(force = false) {
    const a = account;
    if (!a) return;
    const mine = ++listTicket;
    if (force && songSource.forget) songSource.forget(a);
    setStatus(songSource.looking);
    try {
      const all = await songSource.list(a);
      if (mine !== listTicket || disposed) return;
      songs = new Map(all.filter((s) => s.usable).map((s) => [s.uri, s]));
      drawList(all);
      setStatus(songs.size ? "" : songSource.none, !songs.size);
    } catch (err) {
      if (mine !== listTicket || disposed) return;
      setStatus(songSource.failed(err.message), true);
    }
  }

  function drawList(all) {
    pick.replaceChildren();
    const c = clip();
    const none = el("option", null, c && c.song ? "Choose another song…" : "Choose a song…");
    none.value = "";
    pick.append(none);
    let found = false;
    for (const show of songSource.groups(all).map((g) => ({ album: g.label, songs: g.songs }))) {
      const usable = show.songs.filter((s) => s.usable);
      if (!usable.length) continue;
      const group = el("optgroup");
      group.label = show.album;
      for (const s of usable) {
        const o = el("option", null, `${s.title}${s.seconds ? ` (${clockTenths(s.seconds).replace(/\.\d$/, "")})` : ""}`);
        o.value = s.uri;
        if (c && c.song && c.song.uri === s.uri) { o.selected = true; found = true; }
        group.append(o);
      }
      pick.append(group);
    }
    // A clip from a song that's no longer listed keeps working; it's shown as chosen.
    if (c && c.song && !found) {
      const o = el("option", null, c.song.title || "This page's song");
      o.value = c.song.uri;
      o.selected = true;
      pick.insertBefore(o, none.nextSibling);
    }
    const unusable = all.length - all.filter((s) => s.usable).length;
    listNote.textContent = unusable ? songSource.unusableNote(unusable) : "";
    listNote.hidden = !unusable;
  }

  pick.addEventListener("change", () => {
    const s = songs && songs.get(pick.value);
    if (!s) return;
    stopListening();
    const old = clip();
    const next = clipFromSong(s);
    // Keep a title or details the creator typed for the page? No: a new song brings its own.
    if (old && old.song && old.song.uri === s.uri) return;
    patchPage({ clip: { ...next, status: "converting" } });
  });
  refresh.addEventListener("click", () => loadList(true));

  // The waveform.
  async function ensurePeaks() {
    const c = clip();
    if (!c || !c.song || !c.song.blobCid || !account) return;
    const cid = c.song.blobCid;
    if (peaksCid === cid && peaks) return;
    peaksCid = cid;
    peaks = peakCache.get(cid) || null;
    if (peaks) { draw(); return; }
    draw();
    try {
      setStatus("Downloading the song…");
      await original(account, cid);
      if (disposed || peaksCid !== cid) return;
      setStatus("Reading the song…");
      const buf = await decoded(account, cid);
      if (disposed || peaksCid !== cid) return;
      const p = peaksFor(buf.getChannelData(0), buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0));
      peakCache.set(cid, p);
      peaks = p;
      setStatus("");
      // The record's length may be rounded: the song's own length is the truth.
      const now = clip();
      if (now && now.song && now.song.blobCid === cid && Math.abs((now.song.seconds || 0) - buf.duration) > 0.05) {
        const cut = cleanCut(now.start, now.end, buf.duration);
        patchPage((pg) => (pg.clip && pg.clip.song && pg.clip.song.blobCid === cid ? { clip: { ...pg.clip, ...cut, song: { ...pg.clip.song, seconds: buf.duration } } } : null));
      }
      draw();
    } catch (err) {
      if (disposed || peaksCid !== cid) return;
      peaksCid = null;
      setStatus(`The song couldn't be loaded (${err.message}).`, true);
    }
  }

  function draw() {
    const c = clip();
    const total = songSeconds();
    const w = Math.max(1, wave.clientWidth), h = 72;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const g = canvas.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const styles = getComputedStyle(box);
    const on = styles.getPropertyValue("--accent").trim() || "#2f5fb3";
    const off = styles.getPropertyValue("--line").trim() || "#ccc";
    const x0 = c && total ? (c.start / total) * w : 0, x1 = c && total ? (c.end / total) * w : 0;
    g.globalAlpha = 0.12;
    g.fillStyle = on;
    g.fillRect(x0, 0, x1 - x0, h);
    g.globalAlpha = 1;
    if (peaks) {
      const n = peaks.length;
      for (let i = 0; i < w; i += 2) {
        const v = peaks[Math.min(n - 1, Math.floor((i / w) * n))];
        const bar = Math.max(1, v * (h - 8));
        g.fillStyle = i >= x0 && i <= x1 ? on : off;
        g.fillRect(i, (h - bar) / 2, 1.5, bar);
      }
    } else {
      g.fillStyle = off;
      g.fillRect(0, h / 2 - 0.5, w, 1);
    }
    placeHandles();
  }

  function placeHandles() {
    const c = clip();
    const total = songSeconds();
    const w = wave.clientWidth;
    if (!c || !total) return;
    hStart.style.left = `${(c.start / total) * w}px`;
    hEnd.style.left = `${(c.end / total) * w}px`;
    hStart.setAttribute("aria-valuemin", "0");
    hStart.setAttribute("aria-valuemax", String(Math.round(total)));
    hStart.setAttribute("aria-valuenow", String(c.start));
    hStart.setAttribute("aria-valuetext", clockTenths(c.start));
    hEnd.setAttribute("aria-valuemin", "0");
    hEnd.setAttribute("aria-valuemax", String(Math.round(total)));
    hEnd.setAttribute("aria-valuenow", String(c.end));
    hEnd.setAttribute("aria-valuetext", clockTenths(c.end));
    times.textContent = `${clockTenths(c.start)} to ${clockTenths(c.end)} · ${(c.end - c.start).toFixed(1)} s (up to ${CLIP_MAX_SECONDS} s)`;
  }

  // Moving a handle. The other handle follows when the clip would be longer than a minute.
  function setCut(which, t) {
    const c = clip();
    if (!c) return;
    const total = songSeconds();
    let { start, end } = c;
    if (which === "start") {
      start = Math.max(0, Math.min(t, end - CLIP_MIN_SECONDS));
      if (end - start > CLIP_MAX_SECONDS) end = start + CLIP_MAX_SECONDS;
    } else {
      end = Math.min(total, Math.max(t, start + CLIP_MIN_SECONDS));
      if (end - start > CLIP_MAX_SECONDS) start = end - CLIP_MAX_SECONDS;
    }
    const cut = cleanCut(start, end, total);
    if (cut.start === c.start && cut.end === c.end) return;
    page = { ...page, clip: { ...c, ...cut } };
    draw();
    patchPage((pg) => (pg.clip ? { clip: { ...pg.clip, ...cut, status: clipUpToDate({ ...pg.clip, ...cut }) ? "ready" : "converting" } } : null));
  }

  function timeAt(clientX) {
    const r = wave.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width))) * songSeconds();
  }
  for (const [h, which] of [[hStart, "start"], [hEnd, "end"]]) {
    h.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      h.setPointerCapture(e.pointerId);
      h.focus();
      h.classList.add("dragging");
      const move = (ev) => setCut(which, timeAt(ev.clientX));
      const up = () => {
        h.classList.remove("dragging");
        h.removeEventListener("pointermove", move);
        h.removeEventListener("pointerup", up);
        h.removeEventListener("pointercancel", up);
      };
      h.addEventListener("pointermove", move);
      h.addEventListener("pointerup", up);
      h.addEventListener("pointercancel", up);
    });
    h.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 1 : 0.1;
      const by = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step }[e.key];
      if (by === undefined) return;
      e.preventDefault();
      const c = clip();
      if (c) setCut(which, (which === "start" ? c.start : c.end) + by);
    });
  }
  // Tapping the waveform plays the song from there.
  wave.addEventListener("pointerdown", (e) => {
    if (e.target !== canvas && e.target !== wave) return;
    playSong(timeAt(e.clientX), null);
  });

  // Listening (in the Foundry, from the song as read by the browser).
  async function playSong(from, until) {
    const c = clip();
    if (!c || !c.song || !account) return;
    stopListening();
    try {
      if (!ctxAudio) ctxAudio = new (window.AudioContext || window.webkitAudioContext)();
      if (ctxAudio.state === "suspended") await ctxAudio.resume();
      const buf = await decoded(account, c.song.blobCid);
      if (disposed) return;
      source = ctxAudio.createBufferSource();
      source.buffer = buf;
      source.connect(ctxAudio.destination);
      playFrom = Math.max(0, Math.min(from, buf.duration - 0.05));
      playUntil = until != null ? until : buf.duration;
      playStarted = ctxAudio.currentTime;
      source.start(0, playFrom, Math.max(0.05, playUntil - playFrom));
      source.onended = () => { if (source && source.buffer === buf) stopListening(); };
      stopBtn.disabled = false;
      tickHead();
    } catch (err) {
      setStatus(`The song can't be played here (${err.message}).`, true);
    }
  }
  function tickHead() {
    cancelAnimationFrame(raf);
    if (!source || !ctxAudio) { head2.hidden = true; return; }
    const t = playFrom + (ctxAudio.currentTime - playStarted);
    const total = songSeconds();
    head2.hidden = false;
    head2.style.left = `${total ? (Math.min(t, playUntil) / total) * wave.clientWidth : 0}px`;
    raf = requestAnimationFrame(tickHead);
  }
  function stopListening() {
    cancelAnimationFrame(raf);
    if (source) {
      const s = source;
      source = null;
      try { s.onended = null; s.stop(); } catch { /* already stopped */ }
    }
    head2.hidden = true;
    stopBtn.disabled = true;
  }
  listen.addEventListener("click", () => { const c = clip(); if (c) playSong(c.start, c.end); });
  stopBtn.addEventListener("click", stopListening);

  // Making the clip: a moment after the handles stop moving.
  function scheduleMake() {
    const c = clip();
    clearTimeout(makeTimer);
    if (!c || !c.song || !account || clipUpToDate(c) || c.status === "error") return;
    const key = `${c.song.blobCid}|${c.start}|${c.end}`;
    if (making === key) return;
    pendingMake = () => make(c.song.blobCid, c.start, c.end);
    makeTimer = setTimeout(() => { const run = pendingMake; pendingMake = null; if (run) run(); }, MAKE_DELAY_MS);
  }
  function make(cid, start, end) {
    const key = `${cid}|${start}|${end}`;
    making = key;
    progress = 0;
    drawMade();
    const forThisCut = (pg) => pg.clip && pg.clip.song && pg.clip.song.blobCid === cid && pg.clip.start === start && pg.clip.end === end;
    makeClip(account, cid, start, end, (stage, pct) => {
      if (making === key && stage === "encoding") { progress = Math.round(pct); drawMade(); }
    }).then(
      (r) => {
        if (making === key) { making = null; progress = null; }
        patchPage((pg) => (forThisCut(pg) ? { clip: { ...pg.clip, status: "ready", bytes: r.bytes, seconds: r.seconds, made: { start, end }, error: undefined } } : null));
      },
      (err) => {
        if (making === key) { making = null; progress = null; }
        patchPage((pg) => (forThisCut(pg) ? { clip: { ...pg.clip, status: "error", error: err.message || String(err) } } : null));
      }
    );
  }
  retry.addEventListener("click", () => {
    const c = clip();
    if (!c || !c.song) return;
    peaksCid = peaksCid === c.song.blobCid && peaks ? peaksCid : null;
    patchPage((pg) => (pg.clip ? { clip: { ...pg.clip, status: "converting", error: undefined } } : null));
  });

  function drawMade() {
    const c = clip();
    made.replaceChildren();
    made.classList.remove("is-error");
    if (!c || !c.song) return;
    if (c.status === "error") {
      made.classList.add("is-error");
      made.append(`The clip couldn't be made (${c.error}). `, retry);
    } else if (clipUpToDate(c) && c.status === "ready" && c.bytes) {
      made.textContent = `Clip ready: ${clockTenths(c.seconds || c.end - c.start)}, ${formatSize(c.bytes.length)}.`;
    } else {
      made.textContent = progress != null ? `Making the clip… ${progress}%` : "Making the clip…";
    }
  }

  function drawFields() {
    const c = clip();
    if (document.activeElement !== titleIn) titleIn.value = (c && c.title) || "";
    if (document.activeElement !== detailsIn) detailsIn.value = (c && c.details) || "";
  }
  titleIn.addEventListener("input", () => patchPage((pg) => (pg.clip ? { clip: { ...pg.clip, title: titleIn.value } } : null)));
  detailsIn.addEventListener("input", () => patchPage((pg) => (pg.clip ? { clip: { ...pg.clip, details: detailsIn.value } } : null)));

  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(() => draw()) : null;
  if (resize) resize.observe(wave);

  function useAccount(ctx) {
    const a = accountOf(ctx);
    if (a.state !== "ok") {
      account = null;
      songs = null;
      pick.replaceChildren(el("option", null, songSource.placeholder));
      pick.disabled = true;
      refresh.hidden = true;
      listNote.hidden = true;
      setStatus(
        a.state === "out" ? songSource.signedOut :
        a.state === "lookup" ? "Your account's details couldn't be looked up, so your songs can't be listed yet." :
        "Looking up your account…"
      );
      return false;
    }
    if (account && account.did === a.did && account.pds === a.pds) return true;
    account = a;
    pick.disabled = false;
    refresh.hidden = !songSource.refresh;
    loadList();
    return true;
  }

  function update(next, _values, ctx) {
    if (disposed) return;
    page = next || getPage() || {};
    const ok = useAccount(ctx);
    const c = clip();
    editor.hidden = !(c && c.song);
    if (songs && c && c.song && pick.value !== c.song.uri) {
      songSource.list(account).then((all) => { if (!disposed) drawList(all); }, () => {});
    }
    if (ok && c && c.song) {
      ensurePeaks();
      scheduleMake();
    }
    draw();
    drawMade();
    drawFields();
  }

  update(page, null, context);
  return {
    update,
    dispose() {
      disposed = true;
      clearTimeout(makeTimer);
      // Another page was opened before the handles' pause ended: make the clip anyway.
      if (pendingMake) { const run = pendingMake; pendingMake = null; run(); }
      stopListening();
      if (resize) resize.disconnect();
      if (ctxAudio) { try { ctxAudio.close(); } catch { /* closed */ } }
      box.remove();
    },
  };
}
