import { fetchPublicBlob, pdsOf, didOfUri } from "../../core/atproto.js";
import { myAccounts, nameOf } from "../../core/my-accounts.js";
import { rawCid } from "../../core/cid.js";
import { formatDuration } from "../../core/contract.js";
import { convertSong } from "../../core/audio/convert.js";
import { listPlyrSongs, ownerNames, groupShows, REASONS } from "./plyr.js";
import { createWorkshop, trackFromSong, sideFor } from "./workshop.js";
import { sharedPool } from "./shared.js";
import { searchWords, songMatches, sideMeters, tapeBurnedDown, showTick, showKey, readMemory, writeMemory, tapeLine } from "./library.js";
import { IMPORT_DID } from "./tracks.js";

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
  const who = el("span", "mx-who", "Your plyr.fm songs");
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
  search.placeholder = "Search songs, shows, venues, years";
  search.setAttribute("aria-label", "Search your songs");
  const meters = el("div", "mx-meters");
  const done = button("Done", "btn mx-done");
  top.append(title, search, meters, done);
  const bar = el("div", "mx-win-bar");
  const winStatus = el("p", "mx-win-status");
  winStatus.setAttribute("aria-live", "polite");
  const openAll = button("Open all shows");
  const closeAll = button("Close all shows");
  bar.append(winStatus, openAll, closeAll);
  const body = el("div", "mx-win-body");
  const lib = el("div", "mx-lib");
  const tape = el("aside", "mx-tape");
  tape.setAttribute("aria-label", "On the tape");
  const tapeToggle = button("", "mx-tape-toggle");
  tapeToggle.setAttribute("aria-expanded", "false");
  const tapeList = el("div", "mx-tape-list");
  tape.append(tapeToggle, tapeList);
  body.append(lib, tape);
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
  const memory = readMemory(storage);
  const openShows = new Set(memory.open);
  let disposed = false;
  let importer = null; // { open, dispose, key } once the importer window has been made
  let importAccount = null; // pyxorium.com among your accounts: { did, handle, pds }

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
        const made = (await import("./importer.js")).mountImporter(box, { account: importAccount, storage });
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
      who.textContent = "Your plyr.fm songs";
      refresh.hidden = true;
      setStatus(
        mine.state === "out" ? "Sign in to list your plyr.fm songs." :
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
    who.textContent = accounts.length > 1 ? "Your plyr.fm songs" : accounts[0].handle ? `Songs from @${accounts[0].handle} on plyr.fm` : "Your plyr.fm songs";
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

  async function songsFrom(a) {
    const names = await ownerNames({ did: a.did, pds: a.pds, handle: a.handle });
    return listPlyrSongs({ did: a.did, pds: a.pds, owner: names });
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
    setStatus("Looking for your plyr.fm songs…");
    const scroll = lib.scrollTop;
    clearLibrary();
    const results = await Promise.allSettled(list.map(songsFrom));
    if (mine !== loadTicket || disposed) return;
    const found = [];
    const failed = [];
    results.forEach((r, i) => (r.status === "fulfilled" ? found.push({ a: list[i], songs: r.value }) : failed.push({ a: list[i], err: r.reason })));
    for (const f of failed) console.error("[plyr.fm songs]", f.a.did, f.err);
    if (!found.length) {
      setStatus(`Your plyr.fm songs couldn't be listed (${failed[0].err.message}). Press Refresh to try again.`, true);
      return;
    }
    render(found, failed);
    if (scroll) lib.scrollTop = scroll;
  }

  // found: [{ a, songs }] per account; failed: [{ a, err }].
  function render(found, failed = []) {
    const songs = found.flatMap((f) => f.songs);
    const lost = failed.length ? ` ${failed.map((f) => nameOf(f.a)).join(", ")}: songs couldn't be listed (${failed[0].err.message}).` : "";
    if (!songs.length) {
      setStatus(`No plyr.fm songs were found on ${found.length > 1 ? "your accounts" : "this account"}.${lost}`, Boolean(lost));
      return;
    }
    const several = found.filter((f) => f.songs.length).length > 1;
    let usableCount = 0;
    let showCount = 0;
    const unusable = [];
    for (const f of found) {
      const groups = groupShows(f.songs);
      const usable = groups.filter((g) => g.usable > 0);
      unusable.push(...groups.filter((g) => g.usable === 0));
      usableCount += usable.reduce((n, g) => n + g.usable, 0);
      showCount += usable.length;
      // With songs in more than one of your accounts, each account's shows come under its name.
      if (several && usable.length) lib.append(el("p", "mx-account", nameOf(f.a)));
      for (const g of usable) lib.append(showBlock(g, showKey(f.a.did, g.album)));
    }
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
    summary = usableCount
      ? `${usableCount} of your ${songs.length} songs, in ${showCount} ${showCount === 1 ? "show" : "shows"}, can go on a tape.`
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
    toggle.append(el("span", "mx-caret", ""), el("span", "mx-album", g.album), count);
    headRow.append(tick, toggle);
    const ul = el("ul", "mx-songs");
    for (const s of g.songs) {
      const li = el("li", `mx-song ${s.usable ? "" : "is-off"}`);
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
      if (openShows.has(key)) openShows.delete(key);
      else openShows.add(key);
      remember();
      drawOpen(entry);
    });
    drawOpen(entry);
    return section;
  }

  // A show is open when you opened it, or while a search finds songs in it.
  function drawOpen(entry) {
    const isOpen = words.length ? true : openShows.has(entry.key);
    entry.section.classList.toggle("is-open", isOpen);
    entry.toggle.setAttribute("aria-expanded", String(isOpen));
    entry.list.hidden = !isOpen;
  }

  function applySearch() {
    words = searchWords(search.value);
    let any = false;
    for (const entry of shows) {
      let n = 0;
      for (const s of entry.g.songs) {
        const row = rows.get(s.uri);
        const hit = songMatches(s, words, entry.g.album);
        if (row) row.li.hidden = !hit;
        if (hit) n++;
      }
      entry.section.hidden = n === 0;
      if (n) any = true;
      drawOpen(entry);
    }
    for (const n of lib.querySelectorAll(".mx-account, .mx-unusable")) n.hidden = words.length > 0;
    const none = lib.querySelector(".mx-none");
    if (none) none.hidden = any || !words.length;
    openAll.disabled = closeAll.disabled = words.length > 0;
  }

  // The scroll is read while the window is open (a closed window reads 0).
  let lastScroll = memory.scroll;
  function remember() {
    if (dialog.open) lastScroll = lib.scrollTop;
    writeMemory(storage, { open: [...openShows], scroll: lastScroll });
  }

  function add(songs) {
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
    if (!winStatus.classList.contains("is-error")) {
      const n = tracks.length;
      winStatus.textContent = tapeBurnedDown(list)
        ? "Burned down: tape full."
        : n
          ? `${n} ${n === 1 ? "song" : "songs"} on the tape${n >= maxTracks ? " (the most a tape holds)" : ""}.`
          : summary;
    }
  }

  function drawTape(tracks) {
    tapeToggle.textContent = tapeLine(tracks, sides);
    tapeList.replaceChildren();
    for (const side of sides) {
      const list = tracks.filter((t) => t.side === side);
      tapeList.append(el("h3", "mx-tape-side", sides.length > 1 ? `Side ${side}` : "Songs"));
      if (!list.length) {
        tapeList.append(el("p", "mx-tape-empty", "Nothing yet"));
        continue;
      }
      const ol = el("ol", "mx-tape-songs");
      list.forEach((t, k) => {
        const li = el("li", `mx-tape-song ${t.status === "error" ? "is-error" : ""}`);
        const name = el("span", "mx-tape-title", t.title || "Untitled");
        name.title = t.title || "";
        const when = t.status === "converting" ? (Number.isFinite(t.progress) ? `${Math.round(t.progress)}%` : "…") : t.status === "error" ? "!" : formatDuration(t.seconds);
        li.append(el("span", "mx-tape-n", k + 1), name, el("span", "mx-tape-len", when));
        ol.append(li);
      });
      tapeList.append(ol);
    }
  }

  function update(tracks) {
    tracks = tracks || [];
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
      hide();
      document.documentElement.classList.remove("mx-window-open");
      if (workshop) workshop.dispose();
      if (importer) importer.dispose();
      // Only this picker's own box (see preview.js: React may mount twice).
      box.remove();
    },
  };
}
