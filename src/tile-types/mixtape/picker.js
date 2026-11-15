import { fetchPublicBlob, pdsOf, didOfUri } from "../../core/atproto.js";
import { myAccounts, nameOf } from "../../core/my-accounts.js";
import { rawCid } from "../../core/cid.js";
import { formatDuration } from "../../core/contract.js";
import { convertSong } from "../../core/audio/convert.js";
import { listPlyrSongs, ownerNames, groupShows, REASONS } from "./plyr.js";
import { createWorkshop, trackFromSong, sideFor } from "./workshop.js";
import { sharedPool } from "./shared.js";
import {
  searchWords, songMatches, sideMeters, tapeBurnedDown, showTick, showKey, readMemory, writeMemory, tapeLine,
  SOURCE_FILTERS, sourceMatches, sourceLabel, sourceOf, mergeShows, showMatches,
  TAPE_WIDTH, SHOW_LINE_WIDTH, tapeWidth, sideSongs, placeOf, putTrack, moveTrack, stepTrack, crossTrack,
  selectAfterRemove, movedLine, artistShowLine,
} from "./library.js";
import { IMPORT_DID, listTrackSongs, groupTrackShows } from "./tracks.js";

// The song picker in the Songs input (v0.34.0: the Choose songs window).
// In the panel: a short line about your songs and a "Choose songs" button.
// The button opens a large window over the Foundry: search, the side meters
// ("3:18 to burn"), your shows (newest first, each one opening and closing,
// its heading pinned while you scroll it, a tick for the whole show), and a
// narrow column with Side A and Side B in playing order. Songs come from the
// account in use and your other accounts on this browser
// (src/core/my-accounts.js). Ticking a song adds it to the tape and starts
// converting it; unticking removes it. Songs that can't be used yet are listed
// with the reason. The window remembers which shows were open and where it
// was scrolled (library.js). Plain DOM (the Foundry mounts it through the
// tracks input's picker).
//
// v0.35.0: "Import songs…" under Choose songs, shown only when pyxorium.com
// is signed in on this browser (V2-2, R3b-1), opens the importer's window
// (importer.js, loaded the first time it's opened).
//
// v0.36.0: the window also lists the songs imported from Live Music Archive
// recordings (cafe.thunderbird.audio.track records, tracks.js) beside the
// plyr.fm songs, grouped by recording, newest added first; each show's
// heading says "Archive" or "plyr.fm", a filter by the search box picks
// All, plyr.fm or Archive (shown when there are both), and the search also
// looks at an imported song's venue, place, taper and date. An imported song
// is converted to the tape's MP3 like a plyr.fm song (its stored Opus
// decoded by the browser). After the importer stores or edits songs, the
// list is read again when its window closes.
//
// v0.36.2 (R3b-21): while a search is typed, a show found by itself (its
// name, or a recording's band, venue, place, date or taper) starts closed,
// any other show with matches starts open with just those songs, and every
// heading opens and closes. Those clicks last for that search only
// (searchOpen) and never change what's remembered.
//
// v0.37.0, the tape desk (R3d-1 to R3d-9, claude/mixtape-3d-tape-desk-notes.md):
// a divider between the library and the tape column drags left to widen the
// column (230 px up to about half the window, the library keeping 480 px;
// double-click snaps back; the width is remembered). From 320 px each song
// shows its show under its title. Songs are arranged in the column: dragged
// with the mouse within a side or across sides (a line shows where it lands;
// let go outside the column and it snaps back), dragged in from the library
// at a chosen spot, or moved with the buttons a row shows when the mouse is
// over it or it's selected (↑ ↓, to Side B / to Side A, ×) and their keys
// (Alt+↑/↓, Alt+→/←, Delete). Removing can be undone from the window's bar
// (or Ctrl+Z). Escape steps back: a drag, then the selection, then the
// window. Phones and narrow windows: buttons only, no divider, no dragging.
//
// mountPicker(element, { getTracks, setTracks, context, sides, maxTracks, getMaxSecondsPerSide, storage })
//   -> { update(tracks, context), dispose() }

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}

function button(text, className = "btn btn-quiet btn-small") {
  const b = el("button", className, text);
  b.type = "button";
  return b;
}

const narrowWindow = () => typeof matchMedia === "function" && matchMedia("(max-width: 760px)").matches;
const DRAG_START = 5; // px the mouse moves before a press becomes a drag
const EDGE = 36; // px from the column's top or bottom edge where a drag scrolls it

const onPhone = () => typeof matchMedia === "function" && (matchMedia("(pointer: coarse)").matches || matchMedia("(max-width: 700px)").matches);
const browserStorage = () => {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
};

export function mountPicker(root, { getTracks, setTracks, context, sides, maxTracks = 40, getMaxSecondsPerSide = null, storage = browserStorage() }) {
  // Added alongside, not replacing: React may mount twice in development, and
  // the first one removes only its own box when it is disposed.
  const box = el("div", "mx-picker");
  root.append(box);
  if (onPhone()) {
    box.append(el("p", "mx-note", "Best on a computer: converting songs takes a lot of memory, and long songs may not fit on a phone."));
  }
  const head = el("div", "mx-head");
  const who = el("span", "mx-who", "Your songs");
  const refresh = button("Refresh");
  head.append(who, refresh);
  const status = el("p", "mx-status");
  status.setAttribute("aria-live", "polite");
  const open = button("Choose songs", "btn mx-open");
  open.disabled = true;
  const importBtn = button("Import songs…", "btn btn-quiet mx-import-open");
  importBtn.hidden = true;
  const importNote = el("p", "field-help mx-import-note", "Songs from Live Music Archive recordings, kept on @pyxorium.com.");
  importNote.hidden = true;
  box.append(head, status, open, importBtn, importNote);

  // The window (a modal <dialog>: Escape closes it, the page behind can't be reached).
  const dialog = el("dialog", "mx-window");
  dialog.setAttribute("aria-label", "Choose songs");
  const win = el("div", "mx-win");
  const top = el("div", "mx-win-head");
  const title = el("h2", "mx-win-title", "Choose songs");
  const search = el("input", "text mx-search");
  search.type = "search";
  search.placeholder = "Search songs, shows, venues, tapers, years";
  search.setAttribute("aria-label", "Search your songs");
  // All · plyr.fm · Archive (v0.36.0), shown when there are songs of both kinds.
  const filter = el("div", "mx-filter");
  filter.setAttribute("role", "group");
  filter.setAttribute("aria-label", "Songs from");
  filter.hidden = true;
  const filterButtons = SOURCE_FILTERS.map((f) => {
    const b = button(f.label, "mx-filter-btn");
    b.dataset.source = f.id;
    b.addEventListener("click", () => {
      source = f.id;
      remember();
      drawFilter();
      applySearch();
    });
    filter.append(b);
    return b;
  });
  const meters = el("div", "mx-meters");
  const done = button("Done", "btn mx-done");
  const finder = el("div", "mx-finder");
  finder.append(search, filter);
  top.append(title, finder, meters, done);
  const bar = el("div", "mx-win-bar");
  const winStatus = el("p", "mx-win-status");
  winStatus.setAttribute("aria-live", "polite");
  const openAll = button("Open all shows");
  const closeAll = button("Close all shows");
  // Undo after removing a song from the column (R3d-7).
  const undoBtn = button("Undo", "btn btn-small mx-undo");
  undoBtn.hidden = true;
  undoBtn.title = "Put the song back where it was (Ctrl+Z)";
  bar.append(winStatus, undoBtn, openAll, closeAll);
  const body = el("div", "mx-win-body");
  const lib = el("div", "mx-lib");
  // The divider (R3d-3): drag left to widen the tape column, double-click to snap back.
  const split = el("div", "mx-split");
  split.setAttribute("role", "separator");
  split.setAttribute("aria-orientation", "vertical");
  split.setAttribute("aria-label", "Tape column width");
  split.setAttribute("aria-valuemin", String(TAPE_WIDTH));
  split.tabIndex = 0;
  split.title = "Drag to widen the tape column; double-click to put it back";
  const tape = el("aside", "mx-tape");
  tape.setAttribute("aria-label", "On the tape");
  const tapeToggle = button("", "mx-tape-toggle");
  tapeToggle.setAttribute("aria-expanded", "false");
  const tapeList = el("div", "mx-tape-list");
  const live = el("p", "mx-sr");
  live.setAttribute("aria-live", "polite");
  tape.append(tapeToggle, tapeList, live);
  body.append(lib, split, tape);
  win.append(top, bar, body);
  dialog.append(win);
  box.append(dialog);

  let accounts = null; // your accounts, the one in use first: [{ did, pds, handle }]
  let accountsKey = "";
  let workshop = null;
  let loadTicket = 0;
  let rows = new Map(); // song uri -> { input, extra, song, li }
  let shows = []; // [{ key, g, section, list, tick, toggle, count }]
  let summary = ""; // the panel's line once songs are listed
  let words = [];
  let searchKey = ""; // the search the open/closed choices below belong to
  const searchOpen = new Map(); // show key -> open, chosen by a click during this search
  const memory = readMemory(storage);
  const openShows = new Set(memory.open);
  let source = memory.source; // "all" | "plyr" | "archive"
  let bothKinds = false; // songs of both kinds can be used: the filter shows
  let disposed = false;
  let importer = null; // { open, dispose, key } once the importer window has been made
  let importAccount = null; // pyxorium.com among your accounts: { did, handle, pds }
  // The tape desk (v0.37.0).
  let wantWidth = memory.width; // the column width asked for (0: the narrow default)
  let lastTracks = []; // the song list as last drawn
  let selected = null; // the selected song's id in the column
  let undoInfo = null; // { track, side, index } of the song last removed with ×
  let announce = null; // a song whose new place is read out once the list arrives
  let drag = null; // { kind: "tape" | "lib", id, song, x, y, started, target, ghost }
  let suppressClick = false; // the click that ends a drag isn't a click
  const tapeRows = new Map(); // track id -> { li, n, title, len, show, up, down, cross, x }
  const sideBoxes = new Map(); // side -> { box, empty, ol }

  function setStatus(text, error = false) {
    status.textContent = text || "";
    status.classList.toggle("is-error", error);
    status.hidden = !text;
  }

  // The importer is offered only while pyxorium.com is one of your accounts here.
  function useImporter(list) {
    const a = (list || []).find((x) => x.did === IMPORT_DID) || null;
    const key = a ? `${a.did}@${a.pds}@${a.handle || ""}` : "";
    if (importer && importer.key !== key) {
      importer.dispose();
      importer = null;
    }
    importAccount = a;
    importBtn.hidden = importNote.hidden = !a;
  }

  async function openImporter() {
    if (!importAccount) return;
    importBtn.disabled = true;
    try {
      if (!importer) {
        const key = `${importAccount.did}@${importAccount.pds}@${importAccount.handle || ""}`;
        // Songs stored or edited in the importer: list the songs again when it closes.
        const onClosed = (changed) => changed && !disposed && accounts && load();
        const made = (await import("./importer.js")).mountImporter(box, { account: importAccount, storage, onClosed });
        if (disposed) {
          made.dispose();
          return;
        }
        importer = { ...made, key };
      }
      await importer.open();
    } catch (err) {
      console.error("[import]", err);
      setStatus(`The importer couldn't open: ${err.message}`, true);
    } finally {
      importBtn.disabled = false;
    }
  }

  function useAccounts(ctx) {
    const mine = myAccounts(ctx);
    useImporter(mine.state === "ok" ? mine.list : []);
    if (mine.state !== "ok") {
      accounts = null;
      accountsKey = "";
      clearLibrary();
      who.textContent = "Your songs";
      refresh.hidden = true;
      setStatus(
        mine.state === "out" ? "Sign in to list your songs." :
        mine.state === "lookup" ? "Your account's details couldn't be looked up, so your songs can't be listed yet. Use Try again above." :
        "Looking up your account…"
      );
      return;
    }
    if (accounts && accountsKey === mine.key) return;
    accounts = mine.list;
    accountsKey = mine.key;
    // One workshop for every account: each song is downloaded from its own account.
    if (!workshop) {
      workshop = createWorkshop({
        sides,
        setTracks,
        download: (t) => download(t),
        convert: (bytes, fades, onProgress) =>
          convertSong(bytes, { pool: sharedPool(), ...fades, onProgress }).then((r) => ({ bytes: r.bytes, seconds: r.seconds })),
      });
    }
    who.textContent = accounts.length > 1 ? "Your songs" : accounts[0].handle ? `Songs from @${accounts[0].handle}` : "Your songs";
    refresh.hidden = false;
    load();
    workshop.sync(getTracks());
  }

  async function download(t) {
    if (!t.blobCid) throw new Error("this song has no file on your account");
    // A song comes from the account it was picked from (its id is its record's at:// address).
    const did = didOfUri(t.id) || (accounts && accounts[0].did);
    if (!did) throw new Error("you're not signed in");
    const pds = await pdsOf(did, accounts || []);
    const bytes = await fetchPublicBlob(did, pds, t.blobCid);
    if ((await rawCid(bytes)) !== t.blobCid) throw new Error("the downloaded file doesn't match the song's record");
    return bytes;
  }

  // An account's plyr.fm songs and its imported songs. The account's songs
  // fail only if its plyr.fm songs can't be listed; imported songs that can't
  // be listed are said as a note (trackError).
  async function songsFrom(a) {
    const plyr = (async () => {
      const names = await ownerNames({ did: a.did, pds: a.pds, handle: a.handle });
      return listPlyrSongs({ did: a.did, pds: a.pds, owner: names });
    })();
    const tracks = listTrackSongs({ did: a.did, pds: a.pds }).then(
      (list) => ({ list, err: null }),
      (err) => ({ list: [], err })
    );
    const [songs, t] = await Promise.all([plyr, tracks]);
    return { songs, tracks: t.list, trackError: t.err };
  }

  function clearLibrary() {
    lib.replaceChildren();
    rows = new Map();
    shows = [];
    summary = "";
    open.disabled = true;
    if (dialog.open) dialog.close();
  }

  async function load() {
    const mine = ++loadTicket;
    const list = accounts;
    setStatus("Looking for your songs…");
    const scroll = lib.scrollTop;
    clearLibrary();
    const results = await Promise.allSettled(list.map(songsFrom));
    if (mine !== loadTicket || disposed) return;
    const found = [];
    const failed = [];
    results.forEach((r, i) => (r.status === "fulfilled" ? found.push({ a: list[i], ...r.value }) : failed.push({ a: list[i], err: r.reason })));
    for (const f of failed) console.error("[songs]", f.a.did, f.err);
    for (const f of found) if (f.trackError) console.error("[imported songs]", f.a.did, f.trackError);
    if (!found.length) {
      setStatus(`Your songs couldn't be listed (${failed[0].err.message}). Press Refresh to try again.`, true);
      return;
    }
    render(found, failed);
    if (scroll) lib.scrollTop = scroll;
  }

  // found: [{ a, songs, tracks, trackError }] per account; failed: [{ a, err }].
  function render(found, failed = []) {
    const songs = found.flatMap((f) => [...f.songs, ...(f.tracks || [])]);
    const lostTracks = found.filter((f) => f.trackError);
    const lost =
      (failed.length ? ` ${failed.map((f) => nameOf(f.a)).join(", ")}: songs couldn't be listed (${failed[0].err.message}).` : "") +
      (lostTracks.length ? ` Imported songs on ${lostTracks.map((f) => nameOf(f.a)).join(", ")} couldn't be listed (${lostTracks[0].trackError.message}).` : "");
    if (!songs.length) {
      setStatus(`No songs were found on ${found.length > 1 ? "your accounts" : "this account"}.${lost}`, Boolean(lost));
      return;
    }
    const several = found.filter((f) => f.songs.length || (f.tracks || []).length).length > 1;
    let usableCount = 0;
    let archiveCount = 0;
    let showCount = 0;
    const kinds = new Set();
    const unusable = [];
    for (const f of found) {
      // plyr.fm's shows and the imported recordings in one list, newest added first (R3b-10).
      const groups = mergeShows(groupShows(f.songs), groupTrackShows(f.tracks || []));
      const usable = groups.filter((g) => g.usable > 0);
      unusable.push(...groups.filter((g) => g.usable === 0));
      usableCount += usable.reduce((n, g) => n + g.usable, 0);
      archiveCount += usable.filter((g) => sourceOf(g) === "archive").reduce((n, g) => n + g.usable, 0);
      showCount += usable.length;
      for (const g of usable) kinds.add(sourceOf(g));
      // With songs in more than one of your accounts, each account's shows come under its name.
      if (several && usable.length) lib.append(el("p", "mx-account", nameOf(f.a)));
      for (const g of usable) lib.append(showBlock(g, sourceOf(g) === "archive" ? showKey(f.a.did, `archive|${g.key}`) : showKey(f.a.did, g.album)));
    }
    bothKinds = kinds.size > 1;
    drawFilter();
    if (unusable.length) {
      const d = el("details", "mx-unusable");
      const count = unusable.reduce((n, g) => n + g.songs.length, 0);
      d.append(el("summary", null, `${unusable.length} more ${unusable.length === 1 ? "show" : "shows"} (${count} songs) can't be added yet`));
      const reasons = new Set(unusable.flatMap((g) => g.songs.map((s) => s.reason)).filter(Boolean));
      d.append(el("p", "mx-reason", [...reasons].map((r) => REASONS[r]).join(" ")));
      const ul = el("ul", "mx-unusable-list");
      for (const g of unusable) ul.append(el("li", null, `${g.album} · ${g.songs.length} ${g.songs.length === 1 ? "song" : "songs"}`));
      d.append(ul);
      lib.append(d);
    }
    lib.append(el("p", "mx-none", "No songs match your search."));
    const imported = archiveCount ? ` (${archiveCount} imported from Archive recordings)` : "";
    summary = usableCount
      ? `${usableCount} of your ${songs.length} songs${imported}, in ${showCount} ${showCount === 1 ? "show" : "shows"}, can go on a tape.`
      : `None of your ${songs.length} songs can go on a tape yet: their audio is only on plyr.fm's storage, which other sites can't read.`;
    setStatus(summary + (usableCount ? " Choose songs to pick them; they start converting right away." : "") + lost);
    open.disabled = !usableCount;
    applySearch();
    update(getTracks());
  }

  function showBlock(g, key) {
    const section = el("section", "mx-show");
    const headRow = el("div", "mx-show-head");
    const tick = el("input", "mx-show-tick");
    tick.type = "checkbox";
    tick.setAttribute("aria-label", `Every song from ${g.album}`);
    const toggle = el("button", "mx-show-toggle");
    toggle.type = "button";
    const total = g.songs.filter((s) => s.usable).reduce((n, s) => n + s.seconds, 0);
    const count = el("span", "mx-count", `${g.usable} ${g.usable === 1 ? "song" : "songs"} · ${formatDuration(total)}`);
    const kind = el("span", `mx-src mx-src-${sourceOf(g)}`, sourceLabel(g));
    toggle.append(el("span", "mx-caret", ""), el("span", "mx-album", g.album), kind, count);
    headRow.append(tick, toggle);
    const ul = el("ul", "mx-songs");
    for (const s of g.songs) {
      const li = el("li", `mx-song ${s.usable ? "" : "is-off"}`);
      li.dataset.uri = s.uri;
      const label = el("label");
      const input = el("input");
      input.type = "checkbox";
      input.disabled = !s.usable;
      input.addEventListener("change", () => (input.checked ? add([s]) : remove([s])));
      label.append(input, el("span", "mx-n", s.trackNumber ?? ""), el("span", "mx-title", s.title), el("span", "mx-len", s.seconds ? formatDuration(s.seconds) : ""));
      li.append(label);
      const extra = el("span", "mx-extra");
      if (!s.usable) extra.textContent = REASONS[s.reason] || "";
      li.append(extra);
      ul.append(li);
      rows.set(s.uri, { input, extra, song: s, li, album: g.album });
    }
    section.append(headRow, ul);
    const entry = { key, g, section, list: ul, tick, toggle };
    shows.push(entry);
    tick.addEventListener("change", () => {
      const usable = g.songs.filter((s) => s.usable);
      if (showTick(g, getTracks()) === "all") remove(usable);
      else add(usable);
    });
    toggle.addEventListener("click", () => {
      if (words.length) {
        // During a search: for this search only; what's remembered stays as it was.
        searchOpen.set(key, !isOpenNow(entry));
      } else {
        if (openShows.has(key)) openShows.delete(key);
        else openShows.add(key);
        remember();
      }
      drawOpen(entry);
    });
    drawOpen(entry);
    return section;
  }

  // A show is open when you opened it. While searching: as clicked during
  // this search, else closed when the search found the show by itself and
  // open when it found songs in it (R3b-21).
  function isOpenNow(entry) {
    if (!words.length) return openShows.has(entry.key);
    if (searchOpen.has(entry.key)) return searchOpen.get(entry.key);
    return !entry.byShow;
  }

  function drawOpen(entry) {
    const isOpen = isOpenNow(entry);
    entry.section.classList.toggle("is-open", isOpen);
    entry.toggle.setAttribute("aria-expanded", String(isOpen));
    entry.list.hidden = !isOpen;
  }

  // The filter's buttons, and the filter itself only when there are songs of both kinds.
  function drawFilter() {
    filter.hidden = !bothKinds;
    for (const b of filterButtons) b.setAttribute("aria-pressed", String(b.dataset.source === activeSource()));
  }

  // The filter in use: what was chosen, or All while there is only one kind.
  function activeSource() {
    return bothKinds ? source : "all";
  }

  function applySearch() {
    words = searchWords(search.value);
    const key = words.join(" ");
    if (key !== searchKey) {
      searchKey = key;
      searchOpen.clear();
    }
    const from = activeSource();
    let any = false;
    for (const entry of shows) {
      if (!sourceMatches(entry.g, from)) {
        entry.section.hidden = true;
        continue;
      }
      let n = 0;
      for (const s of entry.g.songs) {
        const row = rows.get(s.uri);
        const hit = songMatches(s, words, entry.g.album);
        if (row) row.li.hidden = !hit;
        if (hit) n++;
      }
      entry.byShow = showMatches(entry.g, words);
      entry.section.hidden = n === 0;
      if (n) any = true;
      drawOpen(entry);
    }
    const narrowed = words.length > 0 || from !== "all";
    for (const n of lib.querySelectorAll(".mx-account, .mx-unusable")) n.hidden = narrowed;
    const none = lib.querySelector(".mx-none");
    if (none) {
      none.textContent = words.length ? "No songs match your search." : from === "archive" ? "No Archive songs yet." : "No plyr.fm songs.";
      none.hidden = any || !narrowed;
    }
    openAll.disabled = closeAll.disabled = words.length > 0;
  }

  // The scroll is read while the window is open (a closed window reads 0).
  let lastScroll = memory.scroll;
  function remember() {
    if (dialog.open) lastScroll = lib.scrollTop;
    writeMemory(storage, { open: [...openShows], scroll: lastScroll, source, width: wantWidth });
  }

  function add(songs) {
    forgetUndo();
    setTracks((list) => {
      let next = list;
      let full = false;
      for (const s of songs) {
        if (next.some((t) => t.id === s.uri)) continue;
        if (next.length >= maxTracks) {
          full = true;
          break;
        }
        next = [...next, trackFromSong(s, sideFor(next, sides, s.seconds, (getMaxSecondsPerSide && getMaxSecondsPerSide()) || undefined))];
      }
      if (full) say(`A tape holds up to ${maxTracks} songs.`, true);
      return next;
    });
  }

  function remove(songs) {
    forgetUndo();
    const gone = new Set(songs.map((s) => s.uri));
    setTracks((list) => list.filter((t) => !gone.has(t.id)));
  }

  // A message for both the panel and the window (the panel is hidden while the window is open).
  function say(text, error = false) {
    setStatus(text, error);
    winStatus.textContent = text;
    winStatus.classList.toggle("is-error", error);
  }

  function drawMeters(tracks) {
    const max = (getMaxSecondsPerSide && getMaxSecondsPerSide()) || 0;
    const list = sideMeters(tracks, sides, max);
    meters.replaceChildren();
    for (const m of list) {
      const one = el("div", `mx-meter ${m.over ? "over" : ""}`);
      const line = el("div", "mx-meter-line");
      line.append(el("span", "mx-meter-name", sides.length > 1 ? `Side ${m.side}` : "Songs"), el("span", "mx-meter-time", `${formatDuration(m.total)}${m.max ? ` of ${formatDuration(m.max)}` : ""}`));
      one.append(line);
      if (m.max) {
        const barEl = el("span", "mx-meter-bar");
        const fill = el("span");
        fill.style.setProperty("width", `${Math.min(100, (m.total / m.max) * 100)}%`);
        barEl.append(fill);
        one.append(barEl, el("span", "mx-meter-left", m.line));
      }
      meters.append(one);
    }
    undoBtn.hidden = !undoInfo;
    if (undoInfo) {
      winStatus.classList.remove("is-error");
      winStatus.textContent = `Removed "${undoInfo.track.title || "Untitled"}".`;
    } else if (!winStatus.classList.contains("is-error")) {
      const n = tracks.length;
      winStatus.textContent = tapeBurnedDown(list)
        ? "Burned down: tape full."
        : n
          ? `${n} ${n === 1 ? "song" : "songs"} on the tape${n >= maxTracks ? " (the most a tape holds)" : ""}.`
          : summary;
    }
  }

  // ---- The tape column (v0.37.0: the tape desk) ----

  // Each side's heading, "Nothing yet" and list, made once.
  function sideBox(side) {
    if (!sideBoxes.has(side)) {
      const box = el("section", "mx-tape-sidebox");
      box.dataset.side = side;
      box.append(el("h3", "mx-tape-side", sides.length > 1 ? `Side ${side}` : "Songs"));
      const empty = el("p", "mx-tape-empty", "Nothing yet");
      const ol = el("ol", "mx-tape-songs");
      box.append(empty, ol);
      tapeList.append(box);
      sideBoxes.set(side, { box, empty, ol });
    }
    return sideBoxes.get(side);
  }

  function actButton(text, cls, onClick) {
    const b = button("", `mx-act ${cls}`);
    if (Array.isArray(text)) b.append(el("span", "mx-act-short", text[0]), el("span", "mx-act-long", text[1]));
    else b.textContent = text;
    b.tabIndex = -1;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  function tapeRow(t) {
    let r = tapeRows.get(t.id);
    if (r) return r;
    const li = el("li", "mx-tape-song");
    li.dataset.id = t.id;
    li.tabIndex = -1;
    const main = el("div", "mx-tape-main");
    const n = el("span", "mx-tape-n");
    const title = el("span", "mx-tape-title");
    const len = el("span", "mx-tape-len");
    main.append(n, title, len);
    const show = el("div", "mx-tape-show");
    const acts = el("div", "mx-tape-acts");
    const id = t.id;
    const up = actButton("↑", "mx-act-up", () => stepSong(id, -1));
    const down = actButton("↓", "mx-act-down", () => stepSong(id, 1));
    const cross = actButton(["→B", "to Side B"], "mx-act-cross", () => crossSong(id, Number(cross.dataset.dir) || 1));
    const x = actButton("×", "mx-act-x", () => removeSong(id));
    x.title = "Remove from the tape (Delete)";
    x.setAttribute("aria-label", "Remove from the tape");
    acts.append(up, down, cross, x);
    li.append(main, show, acts);
    r = { li, n, title, len, show, up, down, cross, x };
    tapeRows.set(id, r);
    return r;
  }

  function drawTape(tracks) {
    tapeToggle.textContent = tapeLine(tracks, sides);
    const active = document.activeElement;
    const hadFocus = !!active && tapeList.contains(active);
    const seen = new Set();
    const ids = new Set(tracks.map((t) => t.id));
    if (selected && !ids.has(selected)) selected = null;
    const firstId = tracks.length ? (sides.map((sd) => sideSongs(tracks, sd)[0]).find(Boolean) || {}).id : null;
    sides.forEach((side, si) => {
      const { empty, ol } = sideBox(side);
      const list = sideSongs(tracks, side);
      empty.hidden = list.length > 0;
      const lis = list.map((t, k) => {
        seen.add(t.id);
        const r = tapeRow(t);
        r.li.className = `mx-tape-song${t.status === "error" ? " is-error" : ""}${t.id === selected ? " is-selected" : ""}${drag && drag.started && drag.id === t.id ? " is-dragging" : ""}`;
        r.li.tabIndex = t.id === (selected || firstId) ? 0 : -1;
        r.n.textContent = String(k + 1);
        r.title.textContent = t.title || "Untitled";
        r.title.title = t.title || "";
        r.len.textContent = t.status === "converting" ? (Number.isFinite(t.progress) ? `${Math.round(t.progress)}%` : "…") : t.status === "error" ? "!" : formatDuration(t.seconds);
        const showLine = artistShowLine(t.artist, t.album);
        r.show.textContent = showLine;
        r.show.title = showLine;
        r.show.hidden = !showLine;
        r.up.disabled = k === 0;
        r.down.disabled = k === list.length - 1;
        r.up.title = "Move up (Alt+↑)";
        r.down.title = "Move down (Alt+↓)";
        r.up.setAttribute("aria-label", "Move up");
        r.down.setAttribute("aria-label", "Move down");
        // Across the flip: the next side when there is one, else the side before.
        const dir = si < sides.length - 1 ? 1 : -1;
        const to = sides[si + dir];
        r.cross.hidden = !to;
        if (to) {
          r.cross.dataset.dir = String(dir);
          r.cross.firstChild.textContent = dir > 0 ? `→${to}` : `←${to}`;
          r.cross.lastChild.textContent = `to Side ${to}`;
          r.cross.title = `To Side ${to} (Alt+${dir > 0 ? "→" : "←"})`;
          r.cross.setAttribute("aria-label", `To Side ${to}`);
        }
        r.li.setAttribute("aria-label", `${t.title || "Untitled"}, ${sides.length > 1 ? `Side ${side}, ` : ""}position ${k + 1}`);
        return r.li;
      });
      const now = [...ol.children];
      if (now.length !== lis.length || now.some((n, i) => n !== lis[i])) ol.replaceChildren(...lis);
    });
    for (const [id, r] of tapeRows) {
      if (!seen.has(id)) {
        r.li.remove();
        tapeRows.delete(id);
      }
    }
    // Keep the keyboard where it was: on the selected song (moved, or the next one after a removal).
    if (hadFocus && !tapeList.contains(document.activeElement)) {
      const r = selected && tapeRows.get(selected);
      if (r) r.li.focus({ preventScroll: true });
    }
    if (selected && tapeRows.get(selected) && announce === selected) {
      tapeRows.get(selected).li.scrollIntoView({ block: "nearest" });
    }
    if (announce && ids.has(announce)) {
      live.textContent = movedLine(tracks, announce, sides);
      announce = null;
    }
  }

  function select(id, focus = false) {
    selected = id;
    for (const [rid, r] of tapeRows) {
      r.li.classList.toggle("is-selected", rid === id);
      r.li.tabIndex = rid === id ? 0 : -1;
    }
    if (!id) {
      const first = tapeList.querySelector(".mx-tape-song");
      if (first) first.tabIndex = 0;
    }
    if (focus && id && tapeRows.get(id)) tapeRows.get(id).li.focus();
  }

  function forgetUndo() {
    if (!undoInfo) return;
    undoInfo = null;
    undoBtn.hidden = true;
  }

  // Every change from the column goes through here (the list's own rules
  // re-convert the songs whose fades change).
  function arrange(id, fn) {
    forgetUndo();
    announce = id;
    select(id);
    setTracks((list) => fn(list));
  }

  const stepSong = (id, dir) => arrange(id, (list) => stepTrack(list, id, dir));
  const crossSong = (id, dir) => arrange(id, (list) => crossTrack(list, id, sides, dir));

  function removeSong(id) {
    const t = lastTracks.find((x) => x.id === id);
    const at = placeOf(lastTracks, id);
    if (!t || !at) return;
    const next = selectAfterRemove(lastTracks, id);
    undoInfo = { track: t, side: at.side, index: at.index };
    select(next);
    live.textContent = `Removed ${t.title || "Untitled"}`;
    setTracks((list) => list.filter((x) => x.id !== id));
  }

  function undoRemove() {
    if (!undoInfo) return;
    const u = undoInfo;
    undoInfo = null;
    undoBtn.hidden = true;
    if (lastTracks.length >= maxTracks) {
      say(`A tape holds up to ${maxTracks} songs.`, true);
      return;
    }
    announce = u.track.id;
    select(u.track.id);
    setTracks((list) => (list.some((x) => x.id === u.track.id) || list.length >= maxTracks ? list : putTrack(list, u.track, u.side, u.index)));
  }

  // ---- Dragging (mouse only; not on phones or narrow windows) ----

  function dragStart(e, d) {
    if (e.button !== 0 || narrowWindow()) return;
    if (e.pointerType && e.pointerType !== "mouse" && e.pointerType !== "pen") return;
    drag = { ...d, x: e.clientX, y: e.clientY, started: false, target: null, ghost: null, pointerId: e.pointerId, px: e.clientX, py: e.clientY };
    window.addEventListener("pointermove", dragMove, true);
    window.addEventListener("pointerup", dragEnd, true);
    window.addEventListener("pointercancel", dragCancel, true);
  }

  function dragMove(e) {
    if (!drag || (drag.pointerId !== undefined && e.pointerId !== drag.pointerId)) return;
    drag.px = e.clientX;
    drag.py = e.clientY;
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_START) return;
      drag.started = true;
      dialog.classList.add("is-dragging");
      try {
        const sel = window.getSelection && window.getSelection();
        if (sel) sel.removeAllRanges();
      } catch {
        /* nothing selected */
      }
      const ghost = el("div", "mx-ghost", drag.title || "Untitled");
      dialog.append(ghost);
      drag.ghost = ghost;
      if (drag.kind === "tape" && tapeRows.get(drag.id)) tapeRows.get(drag.id).li.classList.add("is-dragging");
      const line = el("div", "mx-drop-line");
      line.hidden = true;
      tapeList.append(line);
      drag.line = line;
      drag.timer = requestAnimationFrame(dragTick);
    }
    e.preventDefault();
    drag.ghost.style.left = `${e.clientX}px`;
    drag.ghost.style.top = `${e.clientY}px`;
    dropAt(e.clientX, e.clientY);
  }

  // Scroll the column while the song is held near its top or bottom edge.
  function dragTick() {
    if (!drag || !drag.started) return;
    const r = tape.getBoundingClientRect();
    if (drag.px >= r.left && drag.px <= r.right) {
      const step = drag.py < r.top + EDGE ? -1 : drag.py > r.bottom - EDGE ? 1 : 0;
      if (step && (step < 0 ? tape.scrollTop > 0 : tape.scrollTop < tape.scrollHeight - tape.clientHeight)) {
        tape.scrollTop += step * 10;
        dropAt(drag.px, drag.py);
      }
    }
    drag.timer = requestAnimationFrame(dragTick);
  }

  // Where a song let go at (x, y) would land: { side, index } or null outside the column; draws the line.
  function dropAt(x, y) {
    const r = tape.getBoundingClientRect();
    const inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    drag.target = null;
    tape.classList.toggle("is-drop", inside);
    if (!inside) {
      drag.line.hidden = true;
      return;
    }
    // The side: the one under the pointer, else the nearest.
    let best = null;
    for (const side of sides) {
      const b = sideBox(side).box.getBoundingClientRect();
      const dist = y < b.top ? b.top - y : y > b.bottom ? y - b.bottom : 0;
      if (!best || dist < best.dist) best = { side, dist };
    }
    const { box, empty, ol } = sideBox(best.side);
    const items = [...ol.children].filter((li) => li.dataset.id !== drag.id);
    let index = 0;
    for (const li of items) {
      const b = li.getBoundingClientRect();
      if (b.top + b.height / 2 < y) index++;
    }
    drag.target = { side: best.side, index };
    const base = tapeList.getBoundingClientRect().top;
    let top;
    if (!items.length) top = (empty.hidden ? box.getBoundingClientRect().bottom : empty.getBoundingClientRect().top) - base;
    else if (index < items.length) top = items[index].getBoundingClientRect().top - base - 1;
    else top = items[items.length - 1].getBoundingClientRect().bottom - base + 1;
    drag.line.style.top = `${Math.round(top)}px`;
    drag.line.hidden = false;
  }

  function dragStop() {
    window.removeEventListener("pointermove", dragMove, true);
    window.removeEventListener("pointerup", dragEnd, true);
    window.removeEventListener("pointercancel", dragCancel, true);
    if (!drag) return null;
    const d = drag;
    drag = null;
    if (d.started) {
      cancelAnimationFrame(d.timer);
      if (d.ghost) d.ghost.remove();
      if (d.line) d.line.remove();
      dialog.classList.remove("is-dragging");
      tape.classList.remove("is-drop");
      for (const r of tapeRows.values()) r.li.classList.remove("is-dragging");
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 0);
    }
    return d;
  }

  function dragEnd(e) {
    if (!drag || (drag.pointerId !== undefined && e.pointerId !== drag.pointerId)) return;
    const d = dragStop();
    if (!d || !d.started || !d.target) return; // a click, or let go outside the column: nothing changes
    const { side, index } = d.target;
    if (d.kind === "tape") {
      arrange(d.id, (list) => moveTrack(list, d.id, side, index));
      return;
    }
    // From the library: a song not on the tape yet, put where it was dropped.
    if (lastTracks.some((t) => t.id === d.song.uri)) return;
    if (lastTracks.length >= maxTracks) {
      say(`A tape holds up to ${maxTracks} songs.`, true);
      return;
    }
    const song = d.song;
    arrange(song.uri, (list) => (list.some((t) => t.id === song.uri) || list.length >= maxTracks ? list : putTrack(list, trackFromSong(song, side), side, index)));
  }

  function dragCancel() {
    dragStop();
  }

  let pressedSelected = false; // the pressed song was already selected (pressing focuses, which selects)
  tapeList.addEventListener("pointerdown", (e) => {
    const li = e.target.closest(".mx-tape-song");
    if (!li || e.target.closest("button")) return;
    pressedSelected = selected === li.dataset.id;
    const t = lastTracks.find((x) => x.id === li.dataset.id);
    if (t) dragStart(e, { kind: "tape", id: t.id, title: t.title });
  });
  lib.addEventListener("pointerdown", (e) => {
    const li = e.target.closest(".mx-song");
    if (!li || !li.dataset.uri) return;
    const row = rows.get(li.dataset.uri);
    if (!row || !row.song.usable || lastTracks.some((t) => t.id === row.song.uri)) return;
    dragStart(e, { kind: "lib", id: row.song.uri, song: row.song, title: row.song.title });
  });
  // The click that ends a drag doesn't tick or select anything.
  dialog.addEventListener("click", (e) => {
    if (!suppressClick) return;
    suppressClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  // Clicking a song selects it (and again deselects it); a tap on phones too.
  tapeList.addEventListener("click", (e) => {
    const li = e.target.closest(".mx-tape-song");
    if (!li || e.target.closest("button")) return;
    const was = pressedSelected;
    pressedSelected = false;
    if (was && selected === li.dataset.id) {
      select(null);
      li.tabIndex = 0;
    } else select(li.dataset.id, true);
  });
  tapeList.addEventListener("focusin", (e) => {
    const li = e.target.closest && e.target.closest(".mx-tape-song");
    if (li && e.target === li && selected !== li.dataset.id) select(li.dataset.id);
  });
  // Clicking anywhere outside the column deselects.
  dialog.addEventListener("pointerdown", (e) => {
    if (selected && !tape.contains(e.target)) select(null);
  });

  // Keys in the column: ↑/↓ between songs, Alt+↑/↓ move, Alt+→/← across the flip, Delete removes.
  tapeList.addEventListener("keydown", (e) => {
    const li = e.target.closest && e.target.closest(".mx-tape-song");
    if (!li) return;
    const id = li.dataset.id;
    const order = sides.flatMap((sd) => sideSongs(lastTracks, sd)).map((t) => t.id);
    const k = order.indexOf(id);
    let handled = true;
    if (e.altKey && e.key === "ArrowUp") stepSong(id, -1);
    else if (e.altKey && e.key === "ArrowDown") stepSong(id, 1);
    else if (e.altKey && e.key === "ArrowRight") crossSong(id, 1);
    else if (e.altKey && e.key === "ArrowLeft") crossSong(id, -1);
    else if (!e.altKey && !e.ctrlKey && !e.metaKey && e.key === "ArrowDown" && k < order.length - 1) select(order[k + 1], true);
    else if (!e.altKey && !e.ctrlKey && !e.metaKey && e.key === "ArrowUp" && k > 0) select(order[k - 1], true);
    else if (e.key === "Delete") removeSong(id);
    else if ((e.key === "Enter" || e.key === " ") && e.target === li) select(selected === id ? null : id, true);
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  // Escape steps back one thing at a time (R3d-6): a drag, then the selection, then the window.
  let keepOpen = false;
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (drag) {
        dragStop();
        keepOpen = true;
      } else if (selected) {
        const r = tapeRows.get(selected);
        select(null);
        if (r) {
          r.li.tabIndex = 0;
          r.li.focus();
        }
        keepOpen = true;
      }
      if (keepOpen) {
        e.preventDefault();
        setTimeout(() => (keepOpen = false), 0);
      }
      return;
    }
    // Ctrl+Z puts back the song last removed (not while typing in the search).
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "z" && undoInfo && e.target !== search) {
      e.preventDefault();
      undoRemove();
    }
  }, true);
  dialog.addEventListener("cancel", (e) => {
    if (keepOpen) e.preventDefault();
  });
  undoBtn.addEventListener("click", undoRemove);

  // ---- The divider (R3d-3) ----

  function applyWidth() {
    if (narrowWindow() || !dialog.open) {
      tape.classList.remove("is-wide");
      return;
    }
    const space = body.clientWidth - split.offsetWidth;
    const w = tapeWidth(wantWidth, space);
    body.style.setProperty("--mx-tape-w", `${w}px`);
    tape.classList.toggle("is-wide", w >= SHOW_LINE_WIDTH);
    split.setAttribute("aria-valuenow", String(w));
    split.setAttribute("aria-valuemax", String(tapeWidth(1e6, space)));
    return w;
  }

  function setWidth(w, save = false) {
    const space = body.clientWidth - split.offsetWidth;
    const drawn = tapeWidth(w, space);
    wantWidth = drawn > TAPE_WIDTH ? drawn : 0;
    applyWidth();
    if (save) remember();
  }

  let splitting = null;
  split.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    splitting = { id: e.pointerId };
    try {
      split.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable */
    }
    dialog.classList.add("is-splitting");
  });
  split.addEventListener("pointermove", (e) => {
    if (!splitting) return;
    const r = body.getBoundingClientRect();
    setWidth(r.right - e.clientX - split.offsetWidth / 2);
  });
  const endSplit = () => {
    if (!splitting) return;
    splitting = null;
    dialog.classList.remove("is-splitting");
    remember();
  };
  split.addEventListener("pointerup", endSplit);
  split.addEventListener("pointercancel", endSplit);
  split.addEventListener("dblclick", () => setWidth(0, true));
  split.addEventListener("keydown", (e) => {
    const now = tapeWidth(wantWidth, body.clientWidth - split.offsetWidth);
    let w = null;
    if (e.key === "ArrowLeft") w = now + 16;
    else if (e.key === "ArrowRight") w = now - 16;
    else if (e.key === "Home") w = 0;
    else if (e.key === "End") w = 1e6;
    if (w === null) return;
    e.preventDefault();
    setWidth(w, true);
  });
  const onResize = () => dialog.open && applyWidth();
  if (typeof window !== "undefined") window.addEventListener("resize", onResize);

  function update(tracks) {
    tracks = tracks || [];
    lastTracks = tracks;
    const byId = new Map(tracks.map((t) => [t.id, t]));
    for (const [uri, row] of rows) {
      const t = byId.get(uri);
      row.input.checked = !!t;
      row.li.classList.toggle("is-on", !!t);
      if (!row.song.usable) continue;
      row.extra.replaceChildren();
      if (t && t.status === "error") {
        const again = button("Try again");
        again.addEventListener("click", () => workshop && workshop.retry(t.id));
        row.extra.append(again);
      } else if (t) {
        row.extra.textContent = t.status === "ready" ? `Side ${t.side}` : "Converting…";
      }
    }
    for (const entry of shows) {
      const state = showTick(entry.g, tracks);
      entry.tick.checked = state === "all";
      entry.tick.indeterminate = state === "some";
    }
    drawMeters(tracks);
    drawTape(tracks);
    if (workshop) workshop.sync(tracks);
  }

  function show() {
    if (!rows.size) return;
    winStatus.classList.remove("is-error");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    document.documentElement.classList.add("mx-window-open");
    applyWidth();
    update(getTracks());
    lib.scrollTop = lastScroll;
    search.focus();
  }

  function hide() {
    if (dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }

  open.addEventListener("click", show);
  done.addEventListener("click", hide);
  dialog.addEventListener("close", () => {
    document.documentElement.classList.remove("mx-window-open");
    dragStop();
    forgetUndo();
    select(null);
    // Closed because the list is being fetched again: nothing to remember or say.
    if (!rows.size) return;
    remember();
    if (summary) setStatus(summary + ((getTracks() || []).length ? " Choose songs to pick more." : " Choose songs to pick them; they start converting right away."));
    open.focus();
  });
  search.addEventListener("input", applySearch);
  openAll.addEventListener("click", () => {
    for (const e of shows) openShows.add(e.key);
    remember();
    shows.forEach(drawOpen);
  });
  closeAll.addEventListener("click", () => {
    for (const e of shows) openShows.delete(e.key);
    remember();
    shows.forEach(drawOpen);
    lib.scrollTop = 0;
  });
  let scrollTimer = null;
  lib.addEventListener("scroll", () => {
    if (dialog.open) lastScroll = lib.scrollTop;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(remember, 250);
  });
  tapeToggle.addEventListener("click", () => {
    const on = !tape.classList.contains("is-open");
    tape.classList.toggle("is-open", on);
    tapeToggle.setAttribute("aria-expanded", String(on));
  });

  refresh.addEventListener("click", () => accounts && load());
  importBtn.addEventListener("click", openImporter);
  useAccounts(context);

  return {
    update(tracks, ctx) {
      if (ctx) useAccounts(ctx);
      update(tracks);
    },
    dispose() {
      disposed = true;
      clearTimeout(scrollTimer);
      dragStop();
      if (typeof window !== "undefined") window.removeEventListener("resize", onResize);
      hide();
      document.documentElement.classList.remove("mx-window-open");
      if (workshop) workshop.dispose();
      if (importer) importer.dispose();
      // Only this picker's own box (see preview.js: React may mount twice).
      box.remove();
    },
  };
}
