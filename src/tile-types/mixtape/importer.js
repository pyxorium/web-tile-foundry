import { formatDuration } from "../../core/contract.js";
import { formatSize } from "../../core/fileset.js";
import { grantedScope, xrpcForAccount, openSignInWindow, signInAgain, isStorageError } from "../../auth/auth.js";
import { IMPORT_SCOPE } from "../../auth/client-config.js";
import { scopeAllows } from "../../core/tile-post.js";
import { makeOpusFile, canEncodeOpus, BLOB_LIMIT, OPUS_LONG_KBPS } from "../../core/audio/opus.js";
import {
  TRACK_COLLECTION, folderOf, sortFiles, pickInfo, readFlacMeta, buildSongs, prefill, showName, readPolicies, policyFor,
  rememberPolicy, showProblems, songProblems, buildTrackRecord, fitDescription, importedKeys, isImported,
} from "./archive.js";
import { listTracks, groupRecordings, storeTrack, updateTrack, editedRecord, TrackError } from "./tracks.js";

// Mixtape Burndown's importer (Foundry v0.35.0; claude/mixtape-3b-importer-notes.md
// R3b-1 to R3b-9, R3b-15, R3b-16). pyxorium.com only for now (V2-2).
//
// "Import songs…" under Choose songs opens this window: pick a recording's
// folder (or files); the importer reads the FLACs' tags and the info .txt,
// fills in "Where these came from", lists the songs unticked; after the rights
// tick, each ticked song is converted to Opus in WebM (core/audio/opus.js) and
// stored on pyxorium.com as a cafe.thunderbird.audio.track record, one at a
// time. Below, what's already imported, with Edit details (the same stored
// audio, a new record version).
//
// Storing needs a permission ordinary sign-ins don't ask for (R3-A8): when
// pyxorium.com's sign-in lacks it, the window offers "Sign in again to allow
// importing", in the small sign-in window, so the tape being made is kept.
//
// mountImporter(root, { account: { did, handle, pds }, storage }) -> { open(), dispose() }

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

const browserStorage = () => {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
};

const POPUP_BLOCKED = "Your browser blocked the sign-in window. Allow pop-ups for this page, then try again.";

/** The rights tick's words (R3b-6, approved Nov 14). */
export const RIGHTS_TEXT =
  "They're my own recordings, or the performer allows non-commercial sharing (such as on the Live Music Archive), the Archive offers this recording as a download, and I've checked the taper's notes. They'll be public on my account as Opus files, free to listen to.";

const FORM_FIELDS = [
  { key: "band", label: "Band", help: "The performer (each song's artist)." },
  { key: "album", label: "Show name", help: "Built from band, venue and date; change it if you like." },
  { key: "date", label: "Date", help: "YYYY-MM-DD (or YYYY-MM, YYYY).", small: true },
  { key: "venue", label: "Venue" },
  { key: "place", label: "Place", help: "City and state or country." },
  { key: "taper", label: "Taper", help: "Who recorded it, if known." },
  { key: "source", label: "Source and lineage", multiline: 2, help: "Soundboard or audience, and the lineage." },
  { key: "archiveUrl", label: "Archive address", help: "The recording's page on the Live Music Archive." },
  { key: "policyUrl", label: "Sharing policy link", help: "The band's policy (or a taper's page). Remembered for this band." },
  { key: "description", label: "Notes", multiline: 8, help: "The info file, kept with each song. Edit freely." },
];

async function readFlacHead(file) {
  let want = 65536;
  for (let i = 0; i < 6; i++) {
    const bytes = new Uint8Array(await file.slice(0, Math.min(want, file.size)).arrayBuffer());
    const meta = readFlacMeta(bytes);
    if (!meta.needBytes) return meta;
    if (want >= file.size) throw new Error("The file ends before its tags do.");
    want = Math.max(meta.needBytes, want * 2);
  }
  throw new Error("This file's tags are too large to read.");
}

export function mountImporter(root, { account, storage = browserStorage() }) {
  const did = account.did;
  const handle = account.handle || null;
  const who = handle ? `@${handle}` : did;

  const dialog = el("dialog", "mx-window mx-import");
  dialog.setAttribute("aria-label", "Import songs");
  const win = el("div", "mx-win");
  const top = el("div", "mx-imp-head");
  const title = el("h2", "mx-win-title", "Import songs");
  const sub = el("span", "mx-imp-to", `Kept on ${who}, each song as its own record with its audio.`);
  const close = button("Close", "btn mx-done");
  top.append(title, sub, close);
  const body = el("div", "mx-imp-body");
  win.append(top, body);
  dialog.append(win);
  root.append(dialog);

  // ---- 0. The permission ----
  const perm = el("section", "mx-imp-perm heads-up");
  perm.hidden = true;
  const permText = el("p", null, "");
  const permError = el("p", "field-error");
  permError.setAttribute("role", "alert");
  permError.hidden = true;
  const permBtn = button("Sign in again to allow importing", "btn");
  const permCancel = button("Cancel");
  permCancel.hidden = true;
  const permRow = el("div", "button-row");
  permRow.append(permBtn, permCancel);
  perm.append(permText, permError, permRow);

  const noEncoder = el("p", "mx-note");
  noEncoder.hidden = true;
  noEncoder.textContent = "This browser can't make Opus files, so songs can't be imported here. Use a current Edge or Chrome on a computer.";

  // ---- 1. Pick a recording ----
  const pickSec = el("section", "mx-imp-sec");
  pickSec.append(el("h3", "mx-imp-h", "1. Pick a recording"));
  pickSec.append(el("p", "field-help", "A recording's folder as downloaded from the Archive. Only its FLAC files and its info .txt are used; anything else in the folder is left alone."));
  const folderInput = el("input");
  folderInput.type = "file";
  folderInput.multiple = true;
  folderInput.setAttribute("webkitdirectory", "");
  folderInput.hidden = true;
  const filesInput = el("input");
  filesInput.type = "file";
  filesInput.multiple = true;
  filesInput.accept = ".flac,.txt,audio/flac";
  filesInput.hidden = true;
  const pickFolder = button("Choose a folder…", "btn");
  const pickFiles = button("Choose files…");
  const pickRow = el("div", "button-row");
  pickRow.append(pickFolder, pickFiles, folderInput, filesInput);
  const found = el("p", "mx-status");
  found.setAttribute("aria-live", "polite");
  found.hidden = true;
  pickSec.append(pickRow, found);

  // ---- 2. Where these came from ----
  const whereSec = el("section", "mx-imp-sec");
  whereSec.hidden = true;
  whereSec.append(el("h3", "mx-imp-h", "2. Where these came from"));
  whereSec.append(el("p", "field-help", "Filled in from the folder's name, the info file and the songs' tags. Please check it: it goes into every song's record."));
  const form = el("div", "mx-imp-form");
  const inputs = {};
  for (const f of FORM_FIELDS) {
    const wrap = el("label", `mx-imp-field${f.multiline ? " is-wide" : ""}`);
    wrap.append(el("span", "field-label", f.label));
    const input = f.multiline ? el("textarea", "text") : el("input", "text");
    if (f.multiline) input.rows = f.multiline;
    else input.type = "text";
    input.dataset.key = f.key;
    wrap.append(input);
    if (f.help) wrap.append(el("span", "field-help", f.help));
    form.append(wrap);
    inputs[f.key] = input;
  }
  const formProblems = el("ul", "publish-blockers");
  formProblems.hidden = true;
  const cutNote = el("p", "field-help");
  cutNote.hidden = true;
  whereSec.append(form, cutNote, formProblems);

  // ---- 3. Songs ----
  const songSec = el("section", "mx-imp-sec");
  songSec.hidden = true;
  songSec.append(el("h3", "mx-imp-h", "3. Songs"));
  const countNote = el("p", "mx-note");
  countNote.hidden = true;
  const songBar = el("div", "mx-imp-bar");
  const tickAll = button("Tick all");
  const untickAll = button("Untick all");
  const songTotal = el("span", "mx-imp-total");
  songBar.append(tickAll, untickAll, songTotal);
  const songList = el("ol", "mx-imp-songs");
  songSec.append(countNote, songBar, songList);

  // ---- 4. Rights, then store ----
  const goSec = el("section", "mx-imp-sec");
  goSec.hidden = true;
  goSec.append(el("h3", "mx-imp-h", "4. Store them"));
  const terms = el("div", "mx-imp-terms");
  terms.hidden = true;
  const rightsLabel = el("label", "mx-imp-rights");
  const rights = el("input");
  rights.type = "checkbox";
  const rightsWords = el("span");
  rightsWords.append(el("strong", null, "These songs are free to share this way."), document.createTextNode(` ${RIGHTS_TEXT}`));
  rightsLabel.append(rights, rightsWords);
  const goRow = el("div", "button-row");
  const go = button("Convert and store", "btn");
  const stop = button("Stop after this song");
  stop.hidden = true;
  goRow.append(go, stop);
  const goStatus = el("p", "mx-status");
  goStatus.setAttribute("aria-live", "polite");
  goSec.append(terms, rightsLabel, goRow, goStatus);

  // ---- Already imported ----
  const doneSec = el("section", "mx-imp-sec");
  doneSec.append(el("h3", "mx-imp-h", "Already imported"));
  const doneStatus = el("p", "mx-status");
  const doneList = el("div", "mx-imp-done");
  doneSec.append(doneStatus, doneList);

  body.append(perm, noEncoder, pickSec, whereSec, songSec, goSec, doneSec);

  // ---- state ----
  let opened = false;
  let disposed = false;
  let allowed = null; // true, false, or null (can't tell)
  let encoderOk = true;
  let stored = []; // trackFromRecord
  let keys = new Set();
  let rec = null; // the picked recording: { folder, files: Map name -> File, songs, note, infoName, termsLines }
  let rows = []; // [{ song, li, tick, name, state, extra }]
  let running = false;
  let stopAsked = false;
  let albumEdited = false;
  let signInAbort = null;
  const openRecs = new Set(); // recordings left open in "Already imported" (kept across redraws)
  const savedNotes = new Map(); // recording key -> "Saved 2 songs."

  // ---- the permission ----
  async function checkPermission(after = false) {
    try {
      const scope = await grantedScope(did);
      allowed = scope == null ? null : scopeAllows(scope, TRACK_COLLECTION);
    } catch {
      allowed = false;
    }
    if (allowed === false) {
      perm.hidden = false;
      permText.textContent = after
        ? `That sign-in still doesn't allow importing. Sign in again and allow storing songs on ${who}'s page.`
        : `To store songs, ${who}'s sign-in on this browser needs one more permission: songs (cafe.thunderbird.audio.track records). Signing in again opens a small window, so the tape you're making stays as it is.`;
    } else {
      perm.hidden = true;
    }
    refreshGo();
  }

  // Straight from the click: the window must open before anything is awaited.
  permBtn.addEventListener("click", () => {
    const w = openSignInWindow();
    if (!w) {
      showPermError(POPUP_BLOCKED);
      return;
    }
    permError.hidden = true;
    const ctl = new AbortController();
    signInAbort = ctl;
    permBtn.disabled = true;
    permCancel.hidden = false;
    permText.textContent = "Finish signing in in the small window…";
    signInAgain(did, handle, { signal: ctl.signal, scope: IMPORT_SCOPE })
      .then(() => checkPermission(true))
      .catch((err) => {
        try { w.close(); } catch { /* already gone */ }
        if (ctl.signal.aborted) return checkPermission();
        console.error("[import] sign in again", err);
        showPermError(isStorageError(err) ? "Signing in couldn't start because this browser isn't allowing the page to store data." : `Signing in again didn't work: ${err.message}`);
        return checkPermission();
      })
      .finally(() => {
        signInAbort = null;
        permBtn.disabled = false;
        permCancel.hidden = true;
      });
  });
  permCancel.addEventListener("click", () => signInAbort && signInAbort.abort());

  function showPermError(message) {
    permError.textContent = message;
    permError.hidden = false;
    perm.hidden = false;
  }

  // ---- already imported ----
  async function loadStored() {
    doneStatus.textContent = "Looking for songs you've imported…";
    doneStatus.classList.remove("is-error");
    try {
      if (!account.pds) throw new Error("your account's details aren't looked up yet");
      stored = await listTracks({ did, pds: account.pds });
    } catch (err) {
      console.error("[import] listing", err);
      doneStatus.textContent = `Your imported songs couldn't be listed (${err.message}).`;
      doneStatus.classList.add("is-error");
      return;
    }
    if (disposed) return;
    keys = importedKeys(stored);
    drawStored();
    if (rec) drawSongs();
  }

  function drawStored() {
    doneList.replaceChildren();
    if (!stored.length) {
      doneStatus.textContent = "None yet.";
      return;
    }
    const groups = groupRecordings(stored);
    const bytes = stored.reduce((n, t) => n + t.size, 0);
    doneStatus.textContent = `${stored.length} ${stored.length === 1 ? "song" : "songs"} from ${groups.length} ${groups.length === 1 ? "recording" : "recordings"}, ${formatSize(bytes)} in all. They'll be listed in Choose songs in the next Foundry update.`;
    for (const g of groups) doneList.append(recordingBlock(g));
  }

  function recordingBlock(g) {
    const box = el("details", "mx-imp-rec");
    box.open = openRecs.has(g.key);
    box.addEventListener("toggle", () => (box.open ? openRecs.add(g.key) : openRecs.delete(g.key)));
    const sum = el("summary");
    const secs = g.tracks.reduce((n, t) => n + t.seconds, 0);
    sum.append(el("span", "mx-album", g.album), el("span", "mx-count", `${g.tracks.length} ${g.tracks.length === 1 ? "song" : "songs"} · ${formatDuration(secs)}`));
    box.append(sum);
    const ul = el("ol", "mx-imp-stored");
    for (const t of g.tracks) {
      const li = el("li");
      li.append(el("span", "mx-n", t.trackNumber ?? ""), el("span", "mx-title", t.title), el("span", "mx-len", `${t.set ? `${t.set} · ` : ""}${formatDuration(t.seconds)} · ${formatSize(t.size)}`));
      ul.append(li);
    }
    const edit = button("Edit details");
    edit.addEventListener("click", () => {
      box.open = true;
      editor(box, g, edit);
    });
    box.append(ul, edit);
    if (savedNotes.has(g.key)) box.append(el("p", "mx-status", savedNotes.get(g.key)));
    return box;
  }

  // Edit details (R3b-8): the recording's details and each song's name, number and set.
  function editor(box, g, editBtn) {
    if (box.querySelector(".mx-imp-editor")) return;
    editBtn.hidden = true;
    const first = g.tracks[0];
    const ed = el("div", "mx-imp-editor");
    const edForm = el("div", "mx-imp-form");
    const values = {
      band: first.artist, album: first.album, date: first.date, venue: first.venue, place: first.place, taper: first.taper,
      source: first.source, archiveUrl: first.archiveUrl, policyUrl: first.policyUrl, description: first.description,
    };
    const edInputs = {};
    for (const f of FORM_FIELDS) {
      const wrap = el("label", `mx-imp-field${f.multiline ? " is-wide" : ""}`);
      wrap.append(el("span", "field-label", f.label));
      const input = f.multiline ? el("textarea", "text") : el("input", "text");
      if (f.multiline) input.rows = Math.min(f.multiline, 5);
      input.value = values[f.key] || "";
      wrap.append(input);
      edForm.append(wrap);
      edInputs[f.key] = input;
    }
    const table = el("ol", "mx-imp-songs");
    const songInputs = g.tracks.map((t) => {
      const li = el("li", "mx-imp-song");
      const n = el("input", "text mx-imp-num");
      n.type = "number";
      n.min = "1";
      n.max = "999";
      n.value = t.trackNumber ?? "";
      n.setAttribute("aria-label", "Track number");
      const name = el("input", "text mx-imp-name");
      name.type = "text";
      name.value = t.title;
      name.setAttribute("aria-label", "Song name");
      const set = el("input", "text mx-imp-set");
      set.type = "text";
      set.value = t.set;
      set.placeholder = "Set";
      set.setAttribute("aria-label", "Set");
      li.append(n, name, set, el("span", "mx-len", formatDuration(t.seconds)));
      table.append(li);
      return { t, n, name, set };
    });
    const problems = el("ul", "publish-blockers");
    problems.hidden = true;
    const row = el("div", "button-row");
    const save = button("Save changes", "btn");
    const cancel = button("Cancel");
    const status = el("p", "mx-status");
    row.append(save, cancel);
    ed.append(edForm, table, problems, row, status);
    box.append(ed);

    cancel.addEventListener("click", () => {
      ed.remove();
      editBtn.hidden = false;
    });
    save.addEventListener("click", async () => {
      const show = Object.fromEntries(Object.entries(edInputs).map(([k, i]) => [k, i.value]));
      const list = [...showProblems(show), ...songInputs.flatMap((s) => songProblems({ title: s.name.value, trackNumber: s.n.value, set: s.set.value }))];
      problems.replaceChildren(...list.map((p) => el("li", null, p.message)));
      problems.hidden = !list.length;
      if (list.length) return;
      save.disabled = cancel.disabled = true;
      const changes = songInputs.map((s) => ({
        s,
        record: editedRecord(s.t.value, {
          ...show, artist: show.band, description: fitDescription(show.description).text,
          title: s.name.value, trackNumber: s.n.value, set: s.set.value,
        }),
      })).filter((c) => JSON.stringify(c.record) !== JSON.stringify({ $type: TRACK_COLLECTION, ...c.s.t.value }));
      if (!changes.length) {
        status.textContent = "Nothing changed.";
        save.disabled = cancel.disabled = false;
        return;
      }
      try {
        const xrpc = await xrpcForAccount(did);
        let k = 0;
        for (const c of changes) {
          status.textContent = `Saving ${++k} of ${changes.length}…`;
          await updateTrack({ xrpc, did, rkey: c.s.t.rkey, cid: c.s.t.cid, record: c.record });
        }
        if (show.policyUrl) rememberPolicy(storage, show.band, show.policyUrl.trim());
        // The recording may now be filed under a new address or name: keep it open there.
        const t0 = changes[0].record;
        const key = String((t0.recording && t0.recording.archiveUrl) || t0.album || "Other songs").toLowerCase();
        openRecs.add(key);
        savedNotes.clear();
        savedNotes.set(key, `Saved ${changes.length} ${changes.length === 1 ? "song" : "songs"}.`);
        await loadStored();
      } catch (err) {
        console.error("[import] edit", err);
        status.textContent = err.message;
        status.classList.add("is-error");
        if (err instanceof TrackError && err.step === "scope") checkPermission();
        save.disabled = cancel.disabled = false;
      }
    });
  }

  // ---- picking a recording ----
  pickFolder.addEventListener("click", () => folderInput.click());
  pickFiles.addEventListener("click", () => filesInput.click());
  folderInput.addEventListener("change", () => readPicked([...folderInput.files]).finally(() => (folderInput.value = "")));
  filesInput.addEventListener("change", () => readPicked([...filesInput.files]).finally(() => (filesInput.value = "")));

  async function readPicked(files) {
    if (running || !files.length) return;
    found.hidden = false;
    found.classList.remove("is-error");
    found.textContent = "Reading the folder…";
    const folder = folderOf(files);
    const { flacs, texts, ignored } = sortFiles(files);
    if (!flacs.length) {
      found.textContent = `No FLAC files ${folder ? `in ${folder}` : "among those files"}. The importer takes a recording's FLACs (and its info .txt).`;
      found.classList.add("is-error");
      return;
    }
    const withText = await Promise.all(texts.map(async (f) => ({ name: f.name, text: await f.text().catch(() => "") })));
    const info = withText.length ? pickInfo(withText) : null;
    const metas = await Promise.all(flacs.map(async (f) => {
      try {
        return { name: f.name, size: f.size, meta: await readFlacHead(f) };
      } catch (err) {
        console.warn("[import] tags", f.name, err);
        return { name: f.name, size: f.size, meta: null, error: err.message };
      }
    }));
    const { songs, note } = buildSongs(metas, info ? info.info.setlist : []);
    const unreadable = metas.filter((m) => !m.meta).map((m) => m.name);
    rec = {
      folder,
      files: new Map(flacs.map((f) => [f.name, f])),
      songs: songs.map((s) => ({ ...s, tick: false, status: "" })),
      note,
      infoName: info ? info.name : "",
      termsLines: info ? info.info.termsLines : [],
      unreadable,
    };
    const left = ignored.length + Math.max(0, texts.length - (info ? 1 : 0));
    found.textContent =
      `Found ${flacs.length} FLAC ${flacs.length === 1 ? "file" : "files"}` +
      (info ? ` and the info file ${info.name}` : " (no info .txt)") +
      (folder ? ` in ${folder}` : "") +
      (left ? `; ${left} other ${left === 1 ? "file" : "files"} left out.` : ".") +
      (unreadable.length ? ` ${unreadable.length} couldn't be read: ${unreadable.join(", ")}.` : "");
    const values = prefill({ folder, info: info ? info.info : null, infoText: info ? info.text : "", songs, policies: readPolicies(storage) });
    for (const f of FORM_FIELDS) inputs[f.key].value = values[f.key] || "";
    albumEdited = false;
    rights.checked = false;
    drawTerms();
    whereSec.hidden = songSec.hidden = goSec.hidden = false;
    checkForm();
    drawSongs();
  }

  // The show name follows band, venue and date until it's changed by hand.
  for (const k of ["band", "venue", "date"]) {
    inputs[k].addEventListener("input", () => {
      if (!albumEdited) inputs.album.value = showName({ band: inputs.band.value, venue: inputs.venue.value, date: inputs.date.value });
      if (k === "band" && !inputs.policyUrl.value.trim()) inputs.policyUrl.value = policyFor(readPolicies(storage), inputs.band.value);
      checkForm();
      drawSongs();
    });
  }
  inputs.album.addEventListener("input", () => {
    albumEdited = true;
    checkForm();
    drawSongs();
  });
  for (const k of ["place", "taper", "source", "archiveUrl", "policyUrl", "description"]) {
    inputs[k].addEventListener("input", () => {
      checkForm();
      if (k === "archiveUrl") drawSongs();
    });
  }

  function formValues() {
    return Object.fromEntries(FORM_FIELDS.map((f) => [f.key, inputs[f.key].value]));
  }

  function checkForm() {
    const v = formValues();
    const list = showProblems({ ...v, description: "" });
    const fit = fitDescription(v.description);
    cutNote.hidden = !fit.cut;
    cutNote.textContent = fit.cut ? "The notes are longer than a record holds (5,000 bytes): they'll be cut short at a line break, with “…” at the end." : "";
    formProblems.replaceChildren(...list.map((p) => el("li", null, p.message)));
    formProblems.hidden = !list.length;
    refreshGo();
    return list;
  }

  function drawTerms() {
    terms.replaceChildren();
    const lines = rec ? rec.termsLines : [];
    terms.hidden = !lines.length;
    if (!lines.length) return;
    terms.append(el("p", "mx-imp-terms-h", "From the taper's notes:"));
    const ul = el("ul");
    for (const l of lines) ul.append(el("li", null, l));
    terms.append(ul);
  }

  // ---- the song list ----
  function drawSongs() {
    if (!rec) return;
    countNote.hidden = !rec.note;
    countNote.textContent = rec.note;
    const show = formValues();
    songList.replaceChildren();
    rows = rec.songs.map((song) => {
      const li = el("li", "mx-imp-song");
      const already = isImported(keys, show, song);
      song.already = already;
      if (already) song.tick = false;
      const tooLong = song.plan.tooLong;
      let tick = null;
      if (already) {
        li.append(el("span", "mx-imp-already", "Already imported"));
        li.classList.add("is-done");
      } else {
        tick = el("input", "mx-imp-tick");
        tick.type = "checkbox";
        tick.checked = song.tick;
        tick.disabled = tooLong || running || !song.seconds;
        tick.setAttribute("aria-label", `Import ${song.title}`);
        tick.addEventListener("change", () => {
          song.tick = tick.checked;
          li.classList.toggle("is-on", song.tick);
          drawTotal();
        });
        li.append(tick);
      }
      li.append(el("span", "mx-n", song.trackNumber ?? ""));
      const nameWrap = el("span", "mx-imp-namebox");
      const name = el("input", "text mx-imp-name");
      name.type = "text";
      name.value = song.title;
      name.disabled = already || running;
      name.setAttribute("aria-label", "Song name");
      name.addEventListener("input", () => {
        song.title = name.value;
        song.unknownName = false;
        mark.hidden = true;
      });
      const mark = el("span", "mx-imp-unknown", "name unknown");
      mark.hidden = !song.unknownName;
      nameWrap.append(name, mark);
      li.append(nameWrap);
      li.append(el("span", "mx-imp-set-label", song.set || ""));
      const len = song.seconds ? formatDuration(song.seconds) : "?";
      const size = song.seconds && !tooLong ? ` · about ${formatSize(song.plan.bytes)}` : "";
      li.append(el("span", "mx-len", `${len}${size}`));
      const extra = el("span", "mx-imp-extra");
      if (!song.seconds) extra.textContent = "Couldn't read this file.";
      else if (tooLong) extra.textContent = "Too long to store.";
      else if (song.plan.long) extra.textContent = `Long song: will be stored at ${OPUS_LONG_KBPS} kbps to fit.`;
      if (song.status) {
        extra.textContent = song.status;
        extra.classList.toggle("is-error", song.statusError === true);
      }
      li.append(extra);
      li.classList.toggle("is-on", song.tick);
      li.classList.toggle("is-off", tooLong || !song.seconds);
      songList.append(li);
      return { song, li, tick, name, extra };
    });
    drawTotal();
  }

  function setRowStatus(song, text, error = false) {
    song.status = text;
    song.statusError = error;
    const r = rows.find((x) => x.song === song);
    if (r) {
      r.extra.textContent = text;
      r.extra.classList.toggle("is-error", error);
    }
  }

  function ticked() {
    return rec ? rec.songs.filter((s) => s.tick && !s.already && !s.plan.tooLong && s.seconds) : [];
  }

  function drawTotal() {
    const list = ticked();
    const secs = list.reduce((n, s) => n + s.seconds, 0);
    const bytes = list.reduce((n, s) => n + s.plan.bytes, 0);
    songTotal.textContent = list.length ? `${list.length} ticked · ${formatDuration(secs)} · about ${formatSize(bytes)}` : "None ticked.";
    refreshGo();
  }

  tickAll.addEventListener("click", () => {
    if (!rec || running) return;
    for (const s of rec.songs) if (!s.already && !s.plan.tooLong && s.seconds) s.tick = true;
    drawSongs();
  });
  untickAll.addEventListener("click", () => {
    if (!rec || running) return;
    for (const s of rec.songs) s.tick = false;
    drawSongs();
  });
  rights.addEventListener("change", refreshGo);

  function refreshGo() {
    const n = ticked().length;
    go.textContent = n ? `Convert and store ${n} ${n === 1 ? "song" : "songs"}` : "Convert and store";
    const formOk = rec && !showProblems({ ...formValues(), description: "" }).length;
    const namesOk = ticked().every((s) => !songProblems(s).length);
    go.disabled = running || !n || !rights.checked || !formOk || !namesOk || allowed === false || !encoderOk;
    if (!running && rec) {
      goStatus.classList.remove("is-error");
      goStatus.textContent = !n
        ? "Tick the songs to import."
        : !formOk
          ? "Check “Where these came from” above."
          : !namesOk
            ? "Every ticked song needs a name."
            : !rights.checked
              ? "Tick the box above when you've checked these songs are free to share."
              : allowed === false
                ? "Sign in again to allow importing (at the top of this window) first."
                : "";
    }
  }

  // ---- converting and storing, one song at a time (R3b-9) ----
  go.addEventListener("click", run);
  stop.addEventListener("click", () => {
    stopAsked = true;
    stop.disabled = true;
    stop.textContent = "Stopping after this song…";
  });

  async function run() {
    if (running || go.disabled) return;
    const list = ticked();
    const show = formValues();
    const fit = fitDescription(show.description);
    show.description = fit.text;
    running = true;
    stopAsked = false;
    stop.hidden = false;
    stop.disabled = false;
    stop.textContent = "Stop after this song";
    for (const input of Object.values(inputs)) input.disabled = true;
    pickFolder.disabled = pickFiles.disabled = tickAll.disabled = untickAll.disabled = rights.disabled = true;
    for (const r of rows) {
      if (r.tick) r.tick.disabled = true;
      r.name.disabled = true;
    }
    refreshGo();
    if (show.policyUrl.trim()) rememberPolicy(storage, show.band, show.policyUrl.trim());
    let done = 0;
    let failed = null;
    try {
      const xrpc = await xrpcForAccount(did);
      for (const song of list) {
        if (stopAsked) break;
        goStatus.classList.remove("is-error");
        goStatus.textContent = `${done} of ${list.length} stored. Now: ${song.title}`;
        try {
          await importOne(xrpc, show, song);
          done++;
          setRowStatus(song, "Stored.");
        } catch (err) {
          console.error("[import]", song.name, err);
          setRowStatus(song, err.message, true);
          if (err instanceof TrackError) {
            // A storage error stops the batch (R3b-9).
            failed = err;
            if (err.step === "scope") checkPermission();
            break;
          }
        }
      }
    } catch (err) {
      failed = err;
    } finally {
      running = false;
      stop.hidden = true;
      for (const input of Object.values(inputs)) input.disabled = false;
      pickFolder.disabled = pickFiles.disabled = tickAll.disabled = untickAll.disabled = rights.disabled = false;
      for (const s of list) if (s.status === "Stored.") s.tick = false;
      await loadStored();
      drawSongs();
      refreshGo();
      goStatus.textContent = failed
        ? `${done} of ${list.length} stored; stopped: ${failed.message}`
        : stopAsked
          ? `${done} of ${list.length} stored; stopped as asked.`
          : `${done} of ${list.length} stored.`;
      goStatus.classList.toggle("is-error", Boolean(failed));
    }
  }

  async function importOne(xrpc, show, song) {
    const file = rec.files.get(song.name);
    if (!file) throw new Error("The file is no longer there.");
    setRowStatus(song, "Reading…");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const stage = { decoding: "Decoding…", encoding: "Converting", checking: "Checking…" };
    const progress = (s, p) => setRowStatus(song, s === "encoding" ? `Converting ${Math.round(p)}%` : stage[s]);
    let made = await makeOpusFile(bytes, { kbps: song.plan.kbps, onProgress: progress });
    if (made.bytes.length > BLOB_LIMIT && made.kbps !== OPUS_LONG_KBPS) {
      made = await makeOpusFile(bytes, { kbps: OPUS_LONG_KBPS, onProgress: progress });
    }
    if (made.bytes.length > BLOB_LIMIT) throw new Error(`Too big to store (${formatSize(made.bytes.length)}).`);
    setRowStatus(song, `Uploading ${formatSize(made.bytes.length)}…`);
    await storeTrack({
      xrpc,
      did,
      bytes: made.bytes,
      mimeType: made.mimeType,
      makeRecord: (audioBlob) => buildTrackRecord({ show, song, audioBlob, seconds: made.seconds }),
    });
  }

  // ---- the window ----
  close.addEventListener("click", hide);
  dialog.addEventListener("cancel", (e) => {
    if (running) {
      e.preventDefault();
      goStatus.textContent = "Still storing songs: use “Stop after this song” first.";
    }
  });
  dialog.addEventListener("close", () => {
    document.documentElement.classList.remove("mx-window-open");
    if (signInAbort) signInAbort.abort();
  });

  function hide() {
    if (running) {
      goStatus.textContent = "Still storing songs: use “Stop after this song” first.";
      return;
    }
    if (dialog.open) dialog.close();
  }

  async function open() {
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    document.documentElement.classList.add("mx-window-open");
    if (!opened) {
      opened = true;
      encoderOk = await canEncodeOpus();
      noEncoder.hidden = encoderOk;
      loadStored();
    }
    checkPermission();
  }

  return {
    open,
    dispose() {
      disposed = true;
      if (signInAbort) signInAbort.abort();
      if (dialog.open) dialog.close();
      document.documentElement.classList.remove("mx-window-open");
      dialog.remove();
    },
  };
}
