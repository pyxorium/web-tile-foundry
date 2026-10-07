// The tape player: the tape's label, its sides and songs, and play / pause /
// previous / next with a position bar. Used by the tile's own page
// (tile-main.js) and by the Foundry's preview (preview.js).
//
// Songs play one at a time. In a tile, a song starts playing while it is still
// arriving ("streaming"), so play starts in a moment instead of after the whole
// file is in. Some tile hosts can't jump around in a file that is still
// arriving; if a jump with the position bar doesn't land (or the stream fails),
// the player downloads the song whole and plays that, from the same place
// ("download, then play", which always works). Once the current song can play
// through, the next one is downloaded whole in the background (even a long
// song is only about 11 MB), so a side runs on without a gap beyond the one
// baked into the audio.
//
// Nothing can hang forever: if no data arrives for 10 seconds while a song is
// loading or waiting to play, the player tries once more by itself (a fresh
// download); if that stalls too, it says "This is taking a while." with a
// Try again button. A side ends like a cassette side: "Turn the tape" offers
// the next one. The phone's lock screen and headset buttons work through
// Media Session.
//
// Everything from the tape is shown as plain text (textContent), never as HTML.

const ICONS = {
  play: "M7 4.5v15l12.5-7.5z",
  pause: "M6 4.5h4.5v15H6zm7.5 0H18v15h-4.5z",
  prev: "M6 5h2.5v14H6zm3.5 7L19 5v14z",
  next: "M15.5 5H18v14h-2.5zM5 5l9.5 7L5 19z",
};

function icon(name) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", ICONS[name]);
  svg.append(path);
  return svg;
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}

/** 0:07, 3:45, 1:02:03 */
export function clock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

const text = (v) => (typeof v === "string" ? v : "");

/** How long with no data arriving counts as stuck. */
export const STALL_MS = 10000;

/**
 * The tape's sides as [{ name, tracks }], from a tape.json object (v2 sides,
 * or v1's single track list). Tracks without a path are left out.
 */
export function sidesOf(tape) {
  const raw = Array.isArray(tape && tape.sides) && tape.sides.length
    ? tape.sides
    : [{ name: "", tracks: (tape && tape.tracks) || [] }];
  return raw
    .map((s) => ({
      name: text(s && s.name),
      tracks: (Array.isArray(s && s.tracks) ? s.tracks : []).filter((t) => t && typeof t.path === "string" && t.path.startsWith("/")),
    }))
    .filter((s) => s.tracks.length);
}

const sideLabel = (side, count) => (side.name ? (side.name.length <= 2 ? `Side ${side.name}` : side.name) : count > 1 ? "Side" : "Tape");
/** "Side A" -> "side A" in the middle of a sentence; other names stay as written. */
const inSentence = (label) => label.replace(/^(Side|Tape)\b/, (w) => w.toLowerCase());

/**
 * Mounts a player in `root`. Options:
 *   tape         the tape.json object
 *   getBlob      (path, { stallMs }) -> Promise<Blob>: a song's whole file (default:
 *                fetch it from the tile, giving up after stallMs with no data)
 *   streamUrl    (path) -> URL to play a song from while it arrives, or null to
 *                always download first (default: the path itself in a tile; none
 *                when getBlob is given, as in the Foundry's preview)
 *   stallMs      see STALL_MS
 *   artwork      a picture path or URL for the lock screen, or null
 *   makeUrl      link shown small in the corner (the Foundry), or null
 *   mediaSession use the lock screen and headset controls (default true)
 * Returns { dispose(), state() }.
 */
export function mountPlayer(root, { tape, getBlob = null, streamUrl, artwork = null, makeUrl = null, mediaSession = true, stallMs = STALL_MS } = {}) {
  if (streamUrl === undefined) streamUrl = getBlob ? null : (path) => path;
  if (!getBlob) getBlob = defaultGetBlob;
  const sides = sidesOf(tape);
  const title = text(tape && tape.title) || "Mixtape";
  const tapeArtist = text(tape && tape.artist);
  const madeBy = tape && tape.madeBy && (text(tape.madeBy.name) || (tape.madeBy.handle ? `@${tape.madeBy.handle}` : ""));

  root.classList.add("mt");
  root.replaceChildren();
  // The cassette's own colors (tape.json label.colors), if it has them.
  const colors = (tape && tape.label && tape.label.colors) || {};
  const HEX = /^#[0-9a-f]{6}$/i;
  const setVar = (name, c) => typeof c === "string" && HEX.test(c) && root.style.setProperty(name, c);
  setVar("--label", colors.paper);
  setVar("--label-ink", colors.ink);
  setVar("--stripe1", colors.stripe1);
  setVar("--stripe2", colors.stripe2);
  setVar("--accent", colors.stripe2);

  // ---- label ------------------------------------------------------------------
  const head = el("header", "mt-head");
  const labelText = text(tape && tape.label && tape.label.text);
  head.append(el("p", "mt-label", labelText || title));
  const subParts = [];
  if (labelText && labelText !== title) subParts.push(title);
  if (madeBy) subParts.push(`made by ${madeBy}`);
  else if (tapeArtist) subParts.push(tapeArtist);
  if (subParts.length) head.append(el("p", "mt-sub", subParts.join(" · ")));
  const dedication = text(tape && tape.dedication);
  const dedLine = dedication ? el("p", "mt-ded", dedication) : null;
  if (dedLine) head.append(dedLine);
  const notes = text(tape && tape.notes);
  // The J-card, like the paper insert in a cassette case: dedication, liner
  // notes and each side's songs. Every tape has one (the songs at least).
  let notesBtn = null;
  if (sides.length || notes || dedication) {
    notesBtn = el("button", "mt-notes-btn", "J-card");
    notesBtn.type = "button";
    notesBtn.setAttribute("aria-expanded", "false");
    head.append(notesBtn);
  }
  root.append(head);

  // ---- side tabs, song list, notes ------------------------------------------------
  const tabs = el("nav", "mt-sides");
  tabs.setAttribute("aria-label", "Sides");
  const sideButtons = sides.map((s, k) => {
    const total = s.tracks.reduce((n, t) => n + (Number(t.duration) || 0), 0);
    const b = el("button", "mt-side", `${sideLabel(s, sides.length)}${total ? " · " + clock(total) : ""}`);
    b.type = "button";
    b.addEventListener("click", () => chooseSide(k));
    tabs.append(b);
    return b;
  });
  if (sides.length > 1) root.append(tabs);

  const body = el("div", "mt-body");
  const list = el("ol", "mt-list");
  body.append(list);
  let notesPanel = null;
  if (notesBtn) {
    notesPanel = el("section", "mt-notes");
    notesPanel.hidden = true;
    notesPanel.setAttribute("aria-label", "J-card");
    if (dedication) notesPanel.append(el("p", "mt-jc-ded", dedication));
    if (notes) notesPanel.append(el("h2", null, "Liner notes"), el("div", "mt-jc-notes", notes));
    for (const s of sides) {
      const line = el("p", "mt-jc-side");
      line.append(el("strong", null, `${sideLabel(s, sides.length)}:`), document.createTextNode(" " + s.tracks.map((t) => text(t.title) || "Untitled").join(", ")));
      notesPanel.append(line);
    }
    body.append(notesPanel);
    notesBtn.addEventListener("click", () => setCard(notesPanel.hidden));
  }
  root.append(body);

  // ---- transport bar ------------------------------------------------------------
  const bar = el("footer", "mt-bar");
  const now = el("div", "mt-now", sides.length ? "Press play to start." : "This tape has no songs.");
  now.setAttribute("aria-live", "polite");
  const ctrl = el("div", "mt-ctrl");
  const mkBtn = (name, label, extra = "") => {
    const b = el("button", `mt-btn ${extra}`);
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.append(icon(name));
    return b;
  };
  const prevBtn = mkBtn("prev", "Previous song");
  const playBtn = mkBtn("play", "Play", "mt-play");
  const nextBtn = mkBtn("next", "Next song");
  const pos = el("input", "mt-pos");
  pos.type = "range";
  pos.min = "0";
  pos.max = "1000";
  pos.step = "1";
  pos.value = "0";
  pos.setAttribute("aria-label", "Position in the song");
  const time = el("span", "mt-time", "0:00");
  ctrl.append(prevBtn, playBtn, nextBtn, pos, time);
  bar.append(now, ctrl);
  root.append(bar);
  if (makeUrl) {
    const a = el("a", "mt-make", "Web Tile Foundry");
    a.href = makeUrl;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    // The bar is where it fits without covering anything.
    bar.style.position = "relative";
    bar.append(a);
  }

  // ---- playing --------------------------------------------------------------------
  const audio = new Audio();
  audio.preload = "auto";
  const urls = new Map(); // path -> object URL (the current song and the next one)
  const loading = new Map(); // path -> Promise<url>
  let shownSide = 0;
  let cur = null; // { side, index }
  let sideOver = false;
  let seeking = false;
  let disposed = false;
  let ticket = 0; // the latest request to play; older ones give way
  let mode = null; // how the current song plays: "stream" (while it arrives) or "blob" (downloaded whole)
  let streamRetried = false;
  let pendingSeek = null; // a jump in a streaming song, checked when it lands
  let loadingShown = false; // the bar says "Loading…" until the song plays
  let lastData = Date.now(); // when the song last made progress

  function trackAt(c) {
    return c ? sides[c.side].tracks[c.index] : null;
  }
  function artistOf(t) {
    return text(t.artist) || tapeArtist;
  }

  // A song's whole file as an object URL. A download that stalls or drops is
  // tried again once (`retries`) before giving up.
  function fetchUrl(path, { retries = 1 } = {}) {
    if (urls.has(path)) return Promise.resolve(urls.get(path));
    if (!loading.has(path)) {
      const attempt = (left) =>
        Promise.resolve()
          .then(() => getBlob(path, { stallMs }))
          .catch((err) => {
            if (left > 0 && err && err.retry && !disposed) return attempt(left - 1);
            throw err;
          });
      const p = attempt(retries)
        .then((blob) => {
          const url = URL.createObjectURL(blob.type === "audio/mpeg" ? blob : new Blob([blob], { type: "audio/mpeg" }));
          urls.set(path, url);
          return url;
        })
        .finally(() => loading.delete(path));
      loading.set(path, p);
    }
    return loading.get(path);
  }

  // Keep only the current song and the next one in memory.
  function forgetOthers() {
    const keep = new Set();
    const t = trackAt(cur);
    if (t) keep.add(t.path);
    const n = nextOf(cur);
    if (n) keep.add(trackAt(n).path);
    for (const [path, url] of urls) {
      if (!keep.has(path)) {
        URL.revokeObjectURL(url);
        urls.delete(path);
      }
    }
  }

  function nextOf(c) {
    if (!c) return null;
    return c.index + 1 < sides[c.side].tracks.length ? { side: c.side, index: c.index + 1 } : null;
  }

  function say(msg, error = false) {
    now.textContent = msg;
    now.removeAttribute("data-stuck");
    loadingShown = false;
    if (error) now.setAttribute("data-error", "");
    else now.removeAttribute("data-error");
  }

  function sayLoading(t) {
    root.classList.add("mt-busy");
    say(`Loading ${text(t.title) || "the song"}…`);
    loadingShown = true;
  }

  // Gave up on this song for now: say why, with a button to try again from
  // where it was.
  function stuck(msg, error = false, at = audio.currentTime || 0) {
    const c = cur;
    ticket++;
    audio.pause();
    root.classList.remove("mt-busy");
    say(msg, error);
    const again = el("button", "mt-again", "Try again");
    again.type = "button";
    again.addEventListener("click", () => {
      if (cur === c) play(c, { at, blob: at > 0 });
    });
    now.append(" ", again);
    now.setAttribute("data-stuck", "");
    updateButtons();
  }

  function prefetchNext() {
    const n = nextOf(cur);
    if (n) fetchUrl(trackAt(n).path).catch(() => {});
  }

  function nowText() {
    const t = trackAt(cur);
    if (!t) return "";
    const who = artistOf(t);
    return `${sides.length > 1 ? sideLabel(sides[cur.side], sides.length) + " · " : ""}${cur.index + 1}. ${text(t.title) || "Untitled"}${who ? " · " + who : ""}`;
  }

  // Plays song `c` from `at` seconds. A song already downloaded (or on its way)
  // plays from its file; otherwise it streams, unless `blob` asks for the whole
  // file first (to start part way in, or as the retry). `retries`: automatic
  // tries again for a stalled download.
  async function play(c, { at = 0, blob = false, retries = 1, autoplay = true } = {}) {
    const mine = ++ticket;
    cur = c;
    sideOver = false;
    pendingSeek = null;
    mode = null; // until the song is set up (a download has its own watch)
    if (shownSide !== c.side) showSide(c.side);
    else renderList();
    const t = trackAt(c);
    sayLoading(t);
    setMeta(t);
    lastData = Date.now();
    try {
      const stream = !blob && !at && streamUrl && !urls.has(t.path) && !loading.has(t.path);
      let url;
      if (stream) {
        url = streamUrl(t.path);
        mode = "stream";
        streamRetried = false;
      } else {
        url = await fetchUrl(t.path, { retries });
        if (mine !== ticket || disposed) return;
        mode = "blob";
      }
      audio.src = url;
      if (at) audio.currentTime = at;
      lastData = Date.now();
      if (mode === "blob") {
        root.classList.remove("mt-busy");
        say(nowText());
        // Fetch the next song now, so it's ready even if the listener skips ahead.
        prefetchNext();
      }
      forgetOthers();
      if (!autoplay) {
        if (mode === "stream") say(`${nowText()} · press play`);
        updateButtons();
        return;
      }
      await audio.play().catch((err) => {
        if (mine === ticket) {
          root.classList.remove("mt-busy");
          say(`${nowText()} · press play`, false);
        }
        if (err && err.name !== "NotAllowedError" && err.name !== "AbortError") throw err;
      });
    } catch (err) {
      if (mine !== ticket) return;
      if (err && err.stalled) stuck("This is taking a while.", false, at);
      else stuck(`Couldn't play "${text(t.title) || "this song"}" (${(err && err.message) || "unknown problem"}).`, true, at);
      return;
    }
    updateButtons();
  }

  // The streaming song can't go on (it failed, stalled, or a jump didn't
  // land): download it whole and carry on from `at`.
  function toWholeFile(at, { retries = 0 } = {}) {
    if (!cur || sideOver) return;
    play(cur, { at, blob: true, retries, autoplay: !audio.paused || loadingShown });
  }

  /** Jump to `s` seconds in the current song. */
  function seekTo(s) {
    if (!Number.isFinite(s)) return;
    if (mode === "stream" && !canSeek(s)) {
      // Back to the start: just start the stream again.
      if (s === 0) play(cur, { autoplay: !audio.paused });
      else toWholeFile(s, { retries: 1 });
      return;
    }
    if (mode === "stream") pendingSeek = s;
    audio.currentTime = s;
  }

  function canSeek(s) {
    const r = audio.seekable;
    for (let i = 0; r && i < r.length; i++) if (s >= r.start(i) && s <= r.end(i)) return true;
    return false;
  }

  // The stall watch: a song that should be playing but has had no data for
  // stallMs is tried again once as a whole download, then given up on.
  function checkStall() {
    if (disposed || sideOver || !cur || mode !== "stream" || audio.paused || audio.readyState >= 3) {
      lastData = Date.now();
      return;
    }
    if (Date.now() - lastData < stallMs) return;
    if (!streamRetried) {
      streamRetried = true;
      toWholeFile(audio.currentTime || 0, { retries: 0 });
    } else stuck("This is taking a while.");
  }
  const watch = setInterval(checkStall, 1000);
  const fresh = () => {
    lastData = Date.now();
  };
  for (const ev of ["progress", "loadeddata", "canplay", "playing", "seeked"]) audio.addEventListener(ev, fresh);

  function toggle() {
    if (!cur) {
      if (sides.length) play({ side: shownSide, index: 0 });
      return;
    }
    if (sideOver) {
      play({ side: cur.side, index: 0 });
      return;
    }
    if (!audio.src) {
      play(cur);
      return;
    }
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }

  function prev() {
    if (!cur) return;
    // Cued but not loaded yet: start the song before it, or this one.
    if (!audio.getAttribute("src") && !sideOver) {
      play({ side: cur.side, index: Math.max(0, cur.index - 1) });
      return;
    }
    if (audio.currentTime > 3 || cur.index === 0) {
      seekTo(0);
      if (audio.paused && !sideOver) audio.play().catch(() => {});
      else if (sideOver) play({ side: cur.side, index: cur.index });
      return;
    }
    play({ side: cur.side, index: cur.index - 1 });
  }

  function next() {
    const n = nextOf(cur);
    if (n) play(n);
  }

  function endOfSide() {
    sideOver = true;
    mode = null;
    audio.removeAttribute("src");
    audio.load();
    const more = sides.length > 1;
    say(`End of ${inSentence(sideLabel(sides[cur.side], sides.length))}.${cardOpen() && more ? " Tap Tape to turn it over." : ""}`);
    renderList();
    updateButtons();
  }

  audio.addEventListener("ended", () => {
    const n = nextOf(cur);
    if (n) play(n);
    else endOfSide();
  });
  audio.addEventListener("timeupdate", () => {
    if (!audio.paused) lastData = Date.now();
    updatePosition();
  });
  audio.addEventListener("loadedmetadata", updatePosition);
  audio.addEventListener("play", updateButtons);
  audio.addEventListener("pause", updateButtons);
  audio.addEventListener("playing", () => {
    if (loadingShown) {
      root.classList.remove("mt-busy");
      say(nowText());
    }
  });
  // The streaming song can play through: time to fetch the next one.
  audio.addEventListener("canplaythrough", () => {
    if (mode === "stream") prefetchNext();
  });
  audio.addEventListener("seeked", () => {
    // A jump in a streaming song that didn't land (the host can't jump in a
    // file still arriving): play the whole file from there instead.
    if (mode === "stream" && pendingSeek !== null) {
      const want = pendingSeek;
      pendingSeek = null;
      if (Math.abs(audio.currentTime - want) > 1.5) toWholeFile(want, { retries: 1 });
    }
  });
  audio.addEventListener("error", () => {
    if (!audio.getAttribute("src") || (audio.error && audio.error.code === 1)) return;
    if (mode === "stream" && cur && !sideOver) toWholeFile(audio.currentTime || 0, { retries: 1 });
    else stuck("This song couldn't be played.", true);
  });

  pos.addEventListener("input", () => {
    seeking = true;
    if (Number.isFinite(audio.duration)) time.textContent = `${clock((pos.value / 1000) * audio.duration)} / ${clock(audio.duration)}`;
  });
  pos.addEventListener("change", () => {
    if (Number.isFinite(audio.duration)) seekTo((pos.value / 1000) * audio.duration);
    seeking = false;
  });

  playBtn.addEventListener("click", toggle);
  prevBtn.addEventListener("click", prev);
  nextBtn.addEventListener("click", next);

  function updatePosition() {
    const d = audio.duration;
    const t = audio.currentTime;
    if (!seeking) pos.value = Number.isFinite(d) && d > 0 ? String(Math.round((t / d) * 1000)) : "0";
    // A cued song isn't loaded yet; its length comes from the track list.
    const listed = !audio.getAttribute("src") && cur && !sideOver ? Number(trackAt(cur).duration) : NaN;
    time.textContent = Number.isFinite(d) ? `${clock(t)} / ${clock(d)}` : Number.isFinite(listed) && listed > 0 ? `0:00 / ${clock(listed)}` : clock(t);
    if (mediaSession && navigator.mediaSession && navigator.mediaSession.setPositionState && Number.isFinite(d) && d > 0) {
      try {
        navigator.mediaSession.setPositionState({ duration: d, position: Math.min(t, d), playbackRate: audio.playbackRate || 1 });
      } catch {
        /* some browsers are fussy about the numbers */
      }
    }
  }

  function updateButtons() {
    const playing = !!cur && !audio.paused && !sideOver;
    playBtn.replaceChildren(icon(playing ? "pause" : "play"));
    playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
    prevBtn.disabled = !cur;
    nextBtn.disabled = !nextOf(cur) || sideOver;
    pos.disabled = !cur || sideOver;
    if (mediaSession && navigator.mediaSession) navigator.mediaSession.playbackState = cur ? (playing ? "playing" : "paused") : "none";
  }

  function setMeta(t) {
    if (!mediaSession || !navigator.mediaSession || typeof MediaMetadata === "undefined") return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: text(t.title) || "Untitled",
      artist: artistOf(t),
      album: title,
      artwork: artwork ? [{ src: artwork, sizes: "256x256", type: "image/png" }] : [],
    });
  }

  if (mediaSession && navigator.mediaSession) {
    const set = (action, fn) => {
      try {
        navigator.mediaSession.setActionHandler(action, fn);
      } catch {
        /* not supported here */
      }
    };
    set("play", () => toggle());
    set("pause", () => audio.pause());
    set("previoustrack", prev);
    set("nexttrack", next);
    set("seekto", (d) => {
      if (d && Number.isFinite(d.seekTime)) seekTo(d.seekTime);
    });
  }

  // ---- the J-card ---------------------------------------------------------------------
  // Taken out to read while the tape plays: the side buttons go away (put the
  // card back before flipping the tape), and so does the label's dedication
  // line (the card shows it in full), which also gives the card more room.
  function setCard(open) {
    if (!notesPanel) return;
    notesPanel.hidden = !open;
    notesBtn.setAttribute("aria-expanded", String(open));
    notesBtn.textContent = open ? "Tape" : "J-card";
    tabs.hidden = open;
    if (dedLine) dedLine.hidden = open;
  }
  const cardOpen = () => !!notesPanel && !notesPanel.hidden;

  // ---- sides ----------------------------------------------------------------------
  // A side button is like flipping the cassette: the music stops and the
  // side's first song is cued (marked; press play to start it). No
  // auto-reverse. The side that's already in the player stays as it is.
  function chooseSide(k) {
    if (!cur || cur.side !== k || sideOver) cue({ side: k, index: 0 });
    showSide(k);
  }

  function cue(c) {
    ticket++; // a song still loading gives way
    cur = c;
    sideOver = false;
    mode = null;
    pendingSeek = null;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    pos.value = "0";
    const t = trackAt(c);
    time.textContent = `0:00${t && t.duration ? " / " + clock(t.duration) : ""}`;
    say(`${nowText()} · press play`);
    setMeta(t);
    updateButtons();
  }

  // ---- the list -----------------------------------------------------------------
  function showSide(k) {
    shownSide = k;
    sideButtons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === k)));
    if (cardOpen()) setCard(false);
    renderList();
    list.scrollTop = 0;
  }

  function renderList() {
    const side = sides[shownSide];
    list.replaceChildren();
    if (!side) return;
    side.tracks.forEach((t, i) => {
      const li = el("li");
      const row = el("button", "mt-row");
      row.type = "button";
      const isCur = !!cur && cur.side === shownSide && cur.index === i && !sideOver;
      if (isCur) row.setAttribute("aria-current", "true");
      const body = el("span", "mt-t");
      body.append(el("span", "mt-tt", text(t.title) || "Untitled"));
      const who = artistOf(t);
      const album = text(t.album);
      if (who || album) body.append(el("span", "mt-ta", [who, album].filter(Boolean).join(" · ")));
      row.append(el("span", "mt-n", i + 1), body, el("span", "mt-d", t.duration ? clock(t.duration) : ""));
      row.addEventListener("click", () => {
        if (isCur && !audio.paused) audio.pause();
        else if (isCur && audio.src) audio.play().catch(() => {});
        else play({ side: shownSide, index: i });
      });
      li.append(row);
      list.append(li);
    });
    if (sideOver && cur && cur.side === shownSide) {
      const end = el("div", "mt-end", `End of ${inSentence(sideLabel(side, sides.length))}.`);
      // The next side, or back to the first once the last side is over.
      let other = sides.findIndex((_, k) => k > shownSide);
      if (other < 0) other = sides.findIndex((_, k) => k !== shownSide);
      end.append(el("br"));
      const again = el("button", null, other >= 0 ? `Turn the tape: play ${inSentence(sideLabel(sides[other], sides.length))}` : "Play it again");
      again.type = "button";
      again.addEventListener("click", () => play({ side: other >= 0 ? other : shownSide, index: 0 }));
      end.append(again);
      list.append(end);
      end.scrollIntoView({ block: "nearest" });
    } else if (isCurShown()) {
      const row = list.querySelector('[aria-current="true"]');
      if (row) row.scrollIntoView({ block: "nearest" });
    }
  }

  function isCurShown() {
    return !!cur && cur.side === shownSide;
  }

  showSide(0);
  updateButtons();

  return {
    state() {
      return {
        side: cur ? cur.side : null,
        index: cur ? cur.index : null,
        playing: !!cur && !audio.paused && !sideOver,
        sideOver,
        mode,
        time: audio.currentTime,
        duration: audio.duration,
        loaded: [...urls.keys()],
      };
    },
    /** For tests and the preview: play a song, from `at` seconds. */
    play: (side, index, at = 0) => play({ side, index }, { at, blob: at > 0 }),
    audio,
    dispose() {
      disposed = true;
      ticket++;
      clearInterval(watch);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
      if (mediaSession && navigator.mediaSession) {
        for (const a of ["play", "pause", "previoustrack", "nexttrack", "seekto"]) {
          try {
            navigator.mediaSession.setActionHandler(a, null);
          } catch {
            /* fine */
          }
        }
        navigator.mediaSession.metadata = null;
      }
      root.replaceChildren();
      root.classList.remove("mt", "mt-busy");
      for (const v of ["--label", "--label-ink", "--stripe1", "--stripe2", "--accent"]) root.style.removeProperty(v);
    },
  };
}

/**
 * A song's whole file from the tile. Gives up (err.stalled, err.retry) if no
 * data arrives for stallMs, so a stuck download never hangs the player; a
 * dropped connection is also marked err.retry.
 */
export async function defaultGetBlob(path, { stallMs = STALL_MS, fetchImpl = fetch } = {}) {
  const ctrl = new AbortController();
  let last = Date.now();
  let stalled = false;
  const timer = setInterval(() => {
    if (Date.now() - last > stallMs) {
      stalled = true;
      ctrl.abort();
    }
  }, Math.min(1000, Math.max(50, stallMs / 4)));
  try {
    const response = await fetchImpl(path, { signal: ctrl.signal });
    if (!response.ok) throw new Error(`${path} wasn't found in the tile (${response.status})`);
    last = Date.now();
    const type = response.headers.get("content-type") || "";
    if (!response.body || !response.body.getReader) return await response.blob();
    const reader = response.body.getReader();
    const chunks = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      last = Date.now();
    }
    return new Blob(chunks, { type });
  } catch (err) {
    if (stalled) {
      const e = new Error("no data arrived for a while");
      e.stalled = true;
      e.retry = true;
      throw e;
    }
    if (err && err.name === "TypeError") err.retry = true; // the connection dropped
    throw err;
  } finally {
    clearInterval(timer);
  }
}
