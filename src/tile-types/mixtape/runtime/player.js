// The tape player: the tape's label, its sides and songs, and play / pause /
// previous / next with a position bar. Used by the tile's own page
// (tile-main.js) and by the Foundry's preview (preview.js).
//
// Songs play one at a time, each downloaded whole before it plays
// ("download, then play": seeking works through the tile loader, which a
// streamed file did not). The next song is fetched as soon as the current one
// starts (even a long song is only about 11 MB), so a side runs on, even after
// a jump near the end with the position bar, without a gap beyond the one baked into the
// audio. A side ends like a cassette side: "Turn the tape" offers the next one.
// The phone's lock screen and headset buttons work through Media Session.
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
 *   getBlob      (path) -> Promise<Blob>: a song's file (default: fetch it from the tile)
 *   artwork      a picture path or URL for the lock screen, or null
 *   makeUrl      link shown small in the corner (the Foundry), or null
 *   mediaSession use the lock screen and headset controls (default true)
 * Returns { dispose(), state() }.
 */
export function mountPlayer(root, { tape, getBlob = defaultGetBlob, artwork = null, makeUrl = null, mediaSession = true } = {}) {
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
  if (dedication) head.append(el("p", "mt-ded", dedication));
  const notes = text(tape && tape.notes);
  let notesBtn = null;
  if (notes) {
    notesBtn = el("button", "mt-notes-btn", "Notes");
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
  if (notes) {
    notesPanel = el("section", "mt-notes");
    notesPanel.hidden = true;
    notesPanel.append(el("h2", null, "Liner notes"), el("div", null, notes));
    body.append(notesPanel);
    notesBtn.addEventListener("click", () => {
      notesPanel.hidden = !notesPanel.hidden;
      notesBtn.setAttribute("aria-expanded", String(!notesPanel.hidden));
      notesBtn.textContent = notesPanel.hidden ? "Notes" : "Songs";
    });
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

  function trackAt(c) {
    return c ? sides[c.side].tracks[c.index] : null;
  }
  function artistOf(t) {
    return text(t.artist) || tapeArtist;
  }

  function fetchUrl(path) {
    if (urls.has(path)) return Promise.resolve(urls.get(path));
    if (!loading.has(path)) {
      const p = Promise.resolve()
        .then(() => getBlob(path))
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
    if (error) now.setAttribute("data-error", "");
    else now.removeAttribute("data-error");
  }

  function nowText() {
    const t = trackAt(cur);
    if (!t) return "";
    const who = artistOf(t);
    return `${sides.length > 1 ? sideLabel(sides[cur.side], sides.length) + " · " : ""}${cur.index + 1}. ${text(t.title) || "Untitled"}${who ? " · " + who : ""}`;
  }

  async function play(c, { at = 0 } = {}) {
    const mine = ++ticket;
    cur = c;
    sideOver = false;
    if (shownSide !== c.side) showSide(c.side);
    else renderList();
    const t = trackAt(c);
    root.classList.add("mt-busy");
    say(`Loading ${text(t.title) || "the song"}…`);
    setMeta(t);
    try {
      const url = await fetchUrl(t.path);
      if (mine !== ticket || disposed) return;
      audio.src = url;
      if (at) audio.currentTime = at;
      root.classList.remove("mt-busy");
      say(nowText());
      forgetOthers();
      // Fetch the next song now, so it's ready even if the listener skips ahead.
      const n = nextOf(c);
      if (n) fetchUrl(trackAt(n).path).catch(() => {});
      await audio.play().catch((err) => {
        if (mine === ticket) say(`${nowText()} · press play`, false);
        if (err && err.name !== "NotAllowedError" && err.name !== "AbortError") throw err;
      });
    } catch (err) {
      if (mine !== ticket) return;
      root.classList.remove("mt-busy");
      say(`Couldn't play "${text(t.title) || "this song"}" (${(err && err.message) || "unknown problem"}).`, true);
    }
    updateButtons();
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
      audio.currentTime = 0;
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
    say(`End of ${inSentence(sideLabel(sides[cur.side], sides.length))}.`);
    renderList();
    updateButtons();
  }

  audio.addEventListener("ended", () => {
    const n = nextOf(cur);
    if (n) play(n);
    else endOfSide();
  });
  audio.addEventListener("timeupdate", () => {
    updatePosition();
  });
  audio.addEventListener("loadedmetadata", updatePosition);
  audio.addEventListener("play", updateButtons);
  audio.addEventListener("pause", updateButtons);
  audio.addEventListener("error", () => {
    if (audio.getAttribute("src")) say(`This song couldn't be played.`, true);
  });

  pos.addEventListener("input", () => {
    seeking = true;
    if (Number.isFinite(audio.duration)) time.textContent = `${clock((pos.value / 1000) * audio.duration)} / ${clock(audio.duration)}`;
  });
  pos.addEventListener("change", () => {
    if (Number.isFinite(audio.duration)) audio.currentTime = (pos.value / 1000) * audio.duration;
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
      if (d && Number.isFinite(d.seekTime)) audio.currentTime = d.seekTime;
    });
  }

  // ---- sides ----------------------------------------------------------------------
  // A side button is like flipping the cassette: with nothing playing, the
  // side's first song is cued (marked, and play starts it). While a song plays,
  // the other side can be looked at without stopping the music.
  function chooseSide(k) {
    const playing = !!cur && !audio.paused && !sideOver;
    if (!playing && (!cur || cur.side !== k || sideOver)) cue({ side: k, index: 0 });
    showSide(k);
  }

  function cue(c) {
    ticket++; // a song still loading gives way
    cur = c;
    sideOver = false;
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
    if (notesPanel && !notesPanel.hidden) notesBtn.click();
    renderList();
    list.scrollTop = 0;
  }

  function renderList() {
    const side = sides[shownSide];
    list.replaceChildren();
    if (!side) return;
    // Looking at one side while the other plays: say so, with a way back.
    if (cur && cur.side !== shownSide && !audio.paused && !sideOver) {
      const back = el("button", "mt-elsewhere", `Now playing on ${inSentence(sideLabel(sides[cur.side], sides.length))} ›`);
      back.type = "button";
      back.addEventListener("click", () => showSide(cur.side));
      const li = el("li");
      li.append(back);
      list.append(li);
    }
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
      };
    },
    /** For tests and the preview: play a song, from `at` seconds. */
    play: (side, index, at = 0) => play({ side, index }, { at }),
    audio,
    dispose() {
      disposed = true;
      ticket++;
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

async function defaultGetBlob(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} wasn't found in the tile (${response.status})`);
  return response.blob();
}
