import { fetchPublicBlob } from "../../core/atproto.js";
import { rawCid } from "../../core/cid.js";
import { formatDuration } from "../../core/contract.js";
import { convertSong } from "../../core/audio/convert.js";
import { listPlyrSongs, groupShows, REASONS } from "./plyr.js";
import { createWorkshop, trackFromSong, sideFor } from "./workshop.js";
import { sharedPool } from "./shared.js";

// The song picker shown above the song list: the account's plyr.fm songs,
// grouped by show. Ticking a song adds it to the tape and starts converting
// it; unticking removes it. Songs that can't be used yet are listed with the
// reason. Plain DOM (the Foundry mounts it through the tracks input's picker).
//
// mountPicker(element, { getTracks, setTracks, context, sides, maxTracks })
//   -> { update(tracks, context), dispose() }

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}

const onPhone = () => typeof matchMedia === "function" && (matchMedia("(pointer: coarse)").matches || matchMedia("(max-width: 700px)").matches);

export function mountPicker(root, { getTracks, setTracks, context, sides, maxTracks = 40 }) {
  root.replaceChildren();
  const box = el("div", "mx-picker");
  root.append(box);
  if (onPhone()) {
    box.append(el("p", "mx-note", "Best on a computer: converting songs takes a lot of memory, and long songs may not fit on a phone."));
  }
  const head = el("div", "mx-head");
  const who = el("span", "mx-who", "Your plyr.fm songs");
  const refresh = el("button", "btn btn-quiet btn-small", "Refresh");
  refresh.type = "button";
  head.append(who, refresh);
  const status = el("p", "mx-status");
  status.setAttribute("aria-live", "polite");
  const shows = el("div", "mx-shows");
  box.append(head, status, shows);

  let account = null; // { did, pds, handle }
  let workshop = null;
  let loadTicket = 0;
  let rows = new Map(); // song uri -> { input, extra, song }
  let disposed = false;

  function setStatus(text, error = false) {
    status.textContent = text || "";
    status.classList.toggle("is-error", error);
    status.hidden = !text;
  }

  function accountOf(ctx) {
    const a = ctx && ctx.account;
    if (!a || a.status !== "signedIn" || !a.did) return { state: "out" };
    if (a.lookupError) return { state: "lookup" };
    if (!a.pds) return { state: "waiting" };
    return { state: "ok", did: a.did, pds: a.pds, handle: a.handle || null };
  }

  function useAccount(ctx) {
    const a = accountOf(ctx);
    if (a.state !== "ok") {
      account = null;
      shows.replaceChildren();
      rows = new Map();
      who.textContent = "Your plyr.fm songs";
      refresh.hidden = true;
      setStatus(
        a.state === "out" ? "Sign in to list your plyr.fm songs." :
        a.state === "lookup" ? "Your account's details couldn't be looked up, so your songs can't be listed yet. Use Try again above." :
        "Looking up your account…"
      );
      return;
    }
    if (account && account.did === a.did && account.pds === a.pds) {
      if (a.handle && account.handle !== a.handle) {
        account.handle = a.handle;
        who.textContent = `Songs from @${a.handle} on plyr.fm`;
      }
      return;
    }
    account = a;
    if (workshop) workshop.dispose();
    workshop = createWorkshop({
      sides,
      setTracks,
      download: (t) => download(a, t),
      convert: (bytes, fades, onProgress) =>
        convertSong(bytes, { pool: sharedPool(), ...fades, onProgress }).then((r) => ({ bytes: r.bytes, seconds: r.seconds })),
    });
    who.textContent = a.handle ? `Songs from @${a.handle} on plyr.fm` : "Your plyr.fm songs";
    refresh.hidden = false;
    load();
    workshop.sync(getTracks());
  }

  async function download(a, t) {
    if (!t.blobCid) throw new Error("this song has no file on your account");
    const bytes = await fetchPublicBlob(a.did, a.pds, t.blobCid);
    if ((await rawCid(bytes)) !== t.blobCid) throw new Error("the downloaded file doesn't match the song's record");
    return bytes;
  }

  async function load() {
    const mine = ++loadTicket;
    const a = account;
    setStatus("Looking for your plyr.fm songs…");
    shows.replaceChildren();
    rows = new Map();
    try {
      const songs = await listPlyrSongs({ did: a.did, pds: a.pds, owner: a.handle });
      if (mine !== loadTicket || disposed) return;
      render(songs);
    } catch (err) {
      if (mine !== loadTicket || disposed) return;
      console.error("[plyr.fm songs]", err);
      setStatus(`Your plyr.fm songs couldn't be listed (${err.message}). Press Refresh to try again.`, true);
    }
  }

  function render(songs) {
    if (!songs.length) {
      setStatus("No plyr.fm songs were found on this account.");
      return;
    }
    const groups = groupShows(songs);
    const usable = groups.filter((g) => g.usable > 0);
    const unusable = groups.filter((g) => g.usable === 0);
    const usableCount = usable.reduce((n, g) => n + g.usable, 0);
    setStatus(
      usableCount
        ? `${usableCount} of your ${songs.length} songs can go on a tape. Open a show and tick songs to add them; they start converting right away.`
        : `None of your ${songs.length} songs can go on a tape yet: their audio is only on plyr.fm's storage, which other sites can't read.`
    );
    for (const g of usable) shows.append(showBlock(g));
    if (unusable.length) {
      const d = el("details", "mx-show mx-unusable");
      const count = unusable.reduce((n, g) => n + g.songs.length, 0);
      d.append(el("summary", null, `${unusable.length} more ${unusable.length === 1 ? "show" : "shows"} (${count} songs) can't be added yet`));
      const reasons = new Set(unusable.flatMap((g) => g.songs.map((s) => s.reason)).filter(Boolean));
      d.append(el("p", "mx-reason", [...reasons].map((r) => REASONS[r]).join(" ")));
      const ul = el("ul", "mx-unusable-list");
      for (const g of unusable) ul.append(el("li", null, `${g.album} · ${g.songs.length} ${g.songs.length === 1 ? "song" : "songs"}`));
      d.append(ul);
      shows.append(d);
    }
    update(getTracks());
  }

  function showBlock(g) {
    const d = el("details", "mx-show");
    const sum = el("summary");
    const total = g.songs.filter((s) => s.usable).reduce((n, s) => n + s.seconds, 0);
    sum.append(el("span", "mx-album", g.album), el("span", "mx-count", `${g.usable} ${g.usable === 1 ? "song" : "songs"} · ${formatDuration(total)}`));
    d.append(sum);
    const tools = el("div", "mx-show-tools");
    const all = el("button", "btn btn-quiet btn-small", "Add the whole show");
    all.type = "button";
    all.addEventListener("click", () => add(g.songs.filter((s) => s.usable)));
    tools.append(all);
    d.append(tools);
    const ul = el("ul", "mx-songs");
    for (const s of g.songs) {
      const li = el("li", `mx-song ${s.usable ? "" : "is-off"}`);
      const label = el("label");
      const input = el("input");
      input.type = "checkbox";
      input.disabled = !s.usable;
      input.addEventListener("change", () => (input.checked ? add([s]) : remove(s)));
      label.append(input, el("span", "mx-n", s.trackNumber ?? ""), el("span", "mx-title", s.title), el("span", "mx-len", s.seconds ? formatDuration(s.seconds) : ""));
      li.append(label);
      const extra = el("span", "mx-extra");
      if (!s.usable) extra.textContent = REASONS[s.reason] || "";
      li.append(extra);
      ul.append(li);
      rows.set(s.uri, { input, extra, song: s });
    }
    d.append(ul);
    return d;
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
        next = [...next, trackFromSong(s, sideFor(next, sides, s.seconds))];
      }
      if (full) setStatus(`A tape holds up to ${maxTracks} songs.`, true);
      return next;
    });
  }

  function remove(s) {
    setTracks((list) => list.filter((t) => t.id !== s.uri));
  }

  function update(tracks) {
    const byId = new Map((tracks || []).map((t) => [t.id, t]));
    for (const [uri, row] of rows) {
      const t = byId.get(uri);
      row.input.checked = !!t;
      if (!row.song.usable) continue;
      row.extra.replaceChildren();
      if (t && t.status === "error") {
        const again = el("button", "btn btn-quiet btn-small", "Try again");
        again.type = "button";
        again.addEventListener("click", () => workshop && workshop.retry(t.id));
        row.extra.append(again);
      } else if (t) {
        row.extra.textContent = t.status === "ready" ? `On side ${t.side}` : "Converting…";
      }
    }
    if (workshop) workshop.sync(tracks || []);
  }

  refresh.addEventListener("click", () => account && load());
  useAccount(context);

  return {
    update(tracks, ctx) {
      if (ctx) useAccount(ctx);
      update(tracks);
    },
    dispose() {
      disposed = true;
      if (workshop) workshop.dispose();
      root.replaceChildren();
    },
  };
}
