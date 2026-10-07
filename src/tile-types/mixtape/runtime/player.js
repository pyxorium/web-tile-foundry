// The tape player: the tape's label, its sides and songs, and play / pause /
// previous / next with a position bar. Used by the tile's own page
// (tile-main.js) and by the Foundry's preview (preview.js).
//
// Songs play one at a time, each downloaded whole before it plays. That's
// how tile hosts hand a tile its files anyway (the host page downloads the
// whole file from the author's server, then passes it into the tile), so
// "streaming" gains nothing there. Each song is downloaded once: a song on
// its way is never asked for again, and nothing is cancelled, because the
// host can't cancel a download it has started (asking again only adds a
// second download that competes with the first). Every song on the side
// being played is kept once it's in, and the songs either side of the current
// one are downloaded in the background (next first, then previous), so
// skipping either way is usually instant and a side runs on without a gap
// beyond the one baked into the audio.
//
// A slow download says so: after 10 seconds "Still loading <song>…", after 20
// seconds a Try again button as well. Try again waits for the same download
// unless it failed (or has been going for a minute), and only then starts a
// new one. A side ends like a cassette side: "Turn the tape" offers the next
// one. The phone's lock screen and headset buttons work through Media
// Session.
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

/** Loading messages: "Still loading…", then Try again; a download older than giveUp counts as failed. */
export const LOAD_TIMES = { slow: 10000, again: 20000, giveUp: 60000 };

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
 *   getBlob      (path) -> Promise<Blob>: a song's whole file (default: fetch it from the tile)
 *   loadTimes    see LOAD_TIMES (for tests)
 *   artwork      a picture path or URL for the lock screen, or null
 *   makeUrl      link shown small in the corner (the Foundry), or null
 *   mediaSession use the lock screen and headset controls (default true)
 * Returns { dispose(), state() }.
 */
export function mountPlayer(root, { tape, getBlob = defaultGetBlob, artwork = null, makeUrl = null, mediaSession = true, loadTimes = LOAD_TIMES } = {}) {
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
  const loading = new Map(); // path -> { started, promise } (a download on its way)
  let shownSide = 0;
  let cur = null; // { side, index }
  let sideOver = false;
  let seeking = false;
  let disposed = false;
  let ticket = 0; // the latest request to play; older ones give way
  let loadTimers = []; // the "Still loading…" and Try again messages for the song on its way

  function trackAt(c) {
    return c ? sides[c.side].tracks[c.index] : null;
  }
  function artistOf(t) {
    return text(t.artist) || tapeArtist;
  }

  // A song's whole file as an object URL. One download per song: a song on its
  // way is waited for, not asked for again. `again` (Try again) starts a new
  // download only if there's none on its way, or the one on its way has been
  // going for longer than loadTimes.giveUp.
  function fetchUrl(path, { again = false } = {}) {
    if (urls.has(path)) return Promise.resolve(urls.get(path));
    const going = loading.get(path);
    if (going && !(again && Date.now() - going.started > loadTimes.giveUp)) return going.promise;
    const entry = { started: Date.now(), promise: null };
    entry.promise = Promise.resolve()
      .then(() => getBlob(path))
      .then((blob) => {
        if (urls.has(path)) return urls.get(path); // an earlier download got here first
        const url = URL.createObjectURL(blob.type === "audio/mpeg" ? blob : new Blob([blob], { type: "audio/mpeg" }));
        urls.set(path, url);
        return url;
      })
      .finally(() => {
        if (loading.get(path) === entry) loading.delete(path);
      });
    loading.set(path, entry);
    return entry.promise;
  }

  // Keep every song on the side being played (a side is at most about 22 MB);
  // songs on other sides are let go.
  function forgetOthers() {
    const keep = new Set(cur ? sides[cur.side].tracks.map((t) => t.path) : []);
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

  // The songs either side of the current one, in the background: the next
  // one, then the one before (one download at a time, so they don't compete).
  function prefetchAround() {
    const c = cur;
    if (!c) return;
    const around = [nextOf(c), c.index > 0 ? { side: c.side, index: c.index - 1 } : null]
      .filter(Boolean)
      .map((x) => trackAt(x).path);
    around.reduce(
      (p, path) => p.then(() => (!disposed && cur && cur.side === c.side ? fetchUrl(path).then(() => {}, () => {}) : null)),
      Promise.resolve(),
    );
  }

  function say(msg, error = false) {
    now.textContent = msg;
    now.removeAttribute("data-stuck");
    if (error) now.setAttribute("data-error", "");
    else now.removeAttribute("data-error");
  }

  function clearLoadTimers() {
    for (const id of loadTimers) clearTimeout(id);
    loadTimers = [];
  }

  // A message with a Try again button, to play song `c` from `at`.
  function offerAgain(msg, error, c, at) {
    say(msg, error);
    const again = el("button", "mt-again", "Try again");
    again.type = "button";
    again.addEventListener("click", () => play(c, { at, again: true }));
    now.append(" ", again);
    now.setAttribute("data-stuck", "");
  }

  function nowText() {
    const t = trackAt(cur);
    if (!t) return "";
    const who = artistOf(t);
    return `${sides.length > 1 ? sideLabel(sides[cur.side], sides.length) + " · " : ""}${cur.index + 1}. ${text(t.title) || "Untitled"}${who ? " · " + who : ""}`;
  }

  // Plays song `c` from `at` seconds, once its file is in. `again`: Try again.
  async function play(c, { at = 0, again = false } = {}) {
    const mine = ++ticket;
    cur = c;
    sideOver = false;
    clearLoadTimers();
    if (shownSide !== c.side) showSide(c.side);
    else renderList();
    const t = trackAt(c);
    const name = text(t.title) || "the song";
    setMeta(t);
    if (!urls.has(t.path)) {
      root.classList.add("mt-busy");
      say(`${again && loading.has(t.path) ? "Still loading" : "Loading"} ${name}…`);
      loadTimers.push(
        setTimeout(() => mine === ticket && say(`Still loading ${name}…`), loadTimes.slow),
        setTimeout(() => mine === ticket && offerAgain(`Still loading ${name}…`, false, c, at), loadTimes.again),
      );
    }
    try {
      const url = await fetchUrl(t.path, { again });
      if (mine !== ticket || disposed) return;
      clearLoadTimers();
      audio.src = url;
      if (at) audio.currentTime = at;
      root.classList.remove("mt-busy");
      say(nowText());
      forgetOthers();
      prefetchAround();
      await audio.play().catch((err) => {
        if (mine === ticket) say(`${nowText()} · press play`, false);
        if (err && err.name !== "NotAllowedError" && err.name !== "AbortError") throw err;
      });
    } catch (err) {
      if (mine !== ticket) return;
      clearLoadTimers();
      root.classList.remove("mt-busy");
      offerAgain(`Couldn't load "${text(t.title) || "this song"}" (${(err && err.message) || "unknown problem"}).`, true, c, at);
      return;
    }
    updateButtons();
  }

  /** Jump to `s` seconds in the current song. */
  function seekTo(s) {
    if (Number.isFinite(s)) audio.currentTime = s;
  }

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
  audio.addEventListener("timeupdate", updatePosition);
  audio.addEventListener("loadedmetadata", updatePosition);
  audio.addEventListener("play", updateButtons);
  audio.addEventListener("pause", updateButtons);
  audio.addEventListener("error", () => {
    if (!audio.getAttribute("src") || (audio.error && audio.error.code === 1) || !cur) return;
    offerAgain("This song couldn't be played.", true, cur, audio.currentTime || 0);
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
    clearLoadTimers();
    root.classList.remove("mt-busy");
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
        time: audio.currentTime,
        duration: audio.duration,
        loaded: [...urls.keys()],
        loading: [...loading.keys()],
      };
    },
    /** For tests and the preview: play a song, from `at` seconds. */
    play: (side, index, at = 0) => play({ side, index }, { at }),
    audio,
    dispose() {
      disposed = true;
      ticket++;
      clearLoadTimers();
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

/** A song's whole file from the tile. */
export async function defaultGetBlob(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(response.status === 404 ? `${path} isn't in the tile` : `the host answered ${response.status}`);
  return response.blob();
}
