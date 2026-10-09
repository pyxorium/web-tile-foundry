import { fetchPublishedTile, jsonFile, TILE_COLLECTION } from "../../core/published-tile.js";
import { listTileTypes } from "../../core/registry.js";
import { formatSize } from "../../core/fileset.js";
import { tilePlacement, tapeFromJson, tasteSongs, PIECE_KINDS } from "./piece.js";

// The "Your tile" / "Your tape" panel on an "A tile" or "A tape" page (stage 4):
// pick one of your published tiles (or tapes); the Foundry copies it into the
// zine. Plain DOM, mounted by the Foundry's page editor (the pages input's piece
// panel, src/core/contract.js) for the page being edited, and mounted again when
// the page's layout changes.
//
//   A tile: all the tile's files, exactly as published.
//   A tape: only its banner (as published), plus what its J-card shows, read from
//           its tape.json; and an optional taste, cut from one of the tape's own
//           songs with the sound panel (soundpanel.js), played on the page's sound band.
//
// The list comes from your own account (public reads): every ing.dasl.masl
// record, with its recipe (/foundry.json) read to see what kind of tile it is.
// Tiles that can't go on this kind of page are listed with the reason.

const lists = new Map(); // did -> Promise<entries>
const recipes = new Map(); // blob cid -> Promise<recipe | null>
const copies = new Map(); // "kind|uri|cid" -> Promise<{ pub, tape? }>
const PAGE_SIZE = 100;
const MAX_TILES = 500;
const TIMEOUT_MS = 12000;
const TAPE_FILES = ["/banner.png", "/tape.json", "/foundry.json"];

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}

function accountOf(ctx) {
  const a = ctx && ctx.account;
  if (!a || a.status !== "signedIn" || !a.did) return { state: "out" };
  if (a.lookupError) return { state: "lookup" };
  if (!a.pds) return { state: "waiting" };
  return { state: "ok", did: a.did, pds: a.pds, handle: a.handle || null };
}

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`the server answered ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err && err.name === "AbortError") throw new Error("your account's server took too long");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function blobUrl(a, cid) {
  const u = new URL(`${a.pds}/xrpc/com.atproto.sync.getBlob`);
  u.searchParams.set("did", a.did);
  u.searchParams.set("cid", cid);
  return u.toString();
}

const cidOf = (entry) => (entry && entry.src && entry.src.ref && typeof entry.src.ref.$link === "string" ? entry.src.ref.$link : null);

function recipeOf(a, cid) {
  if (!cid) return Promise.resolve(null);
  if (!recipes.has(cid)) {
    const p = getJson(blobUrl(a, cid)).catch(() => null);
    recipes.set(cid, p);
  }
  return recipes.get(cid);
}

/** Your published tiles, newest first: [{ uri, cid, rkey, name, banner, recipe }]. */
function tilesOf(a) {
  if (!lists.has(a.did)) {
    const p = (async () => {
      const records = [];
      let cursor = null;
      do {
        const u = new URL(`${a.pds}/xrpc/com.atproto.repo.listRecords`);
        u.searchParams.set("repo", a.did);
        u.searchParams.set("collection", TILE_COLLECTION);
        u.searchParams.set("limit", String(PAGE_SIZE));
        if (cursor) u.searchParams.set("cursor", cursor);
        const page = await getJson(u.toString());
        for (const r of page.records || []) records.push(r);
        cursor = page.cursor && (page.records || []).length ? page.cursor : null;
      } while (cursor && records.length < MAX_TILES);
      const out = [];
      // Read the recipes a few at a time.
      for (let i = 0; i < records.length; i += 6) {
        const batch = records.slice(i, i + 6);
        const found = await Promise.all(batch.map(async (r) => {
          const tile = (r.value && r.value.tile) || {};
          const res = tile.resources || {};
          if (!res["/"]) return null;
          return {
            uri: r.uri,
            cid: r.cid,
            rkey: String(r.uri || "").split("/").pop(),
            name: String(tile.name || "Untitled tile"),
            banner: cidOf(res["/banner.png"]),
            createdAt: (r.value && r.value.createdAt) || "",
            recipe: await recipeOf(a, cidOf(res["/foundry.json"])),
          };
        }));
        for (const f of found) if (f) out.push(f);
      }
      out.sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)));
      return out;
    })();
    p.catch(() => lists.delete(a.did));
    lists.set(a.did, p);
  }
  return lists.get(a.did);
}

function copyOf(kind, uri, cid) {
  const key = `${kind}|${uri}|${cid || ""}`;
  if (!copies.has(key)) {
    const p = fetchPublishedTile(uri, kind === "tape" ? { only: TAPE_FILES } : {}).then((pub) => {
      if (cid && pub.cid && pub.cid !== cid) throw new Error("it changed while it was being copied; choose it again");
      if (kind !== "tape") return { pub, files: pub.files };
      const tape = tapeFromJson(jsonFile(pub.files, "/tape.json"));
      if (!tape) throw new Error("its song list couldn't be read");
      return { pub, tape, files: pub.files.filter((f) => f.path === "/banner.png") };
    });
    p.catch(() => copies.delete(key));
    copies.set(key, p);
  }
  return copies.get(key);
}

/** The taste's song list for the sound panel: the tape's own songs, by side. */
function tasteSource(getPage) {
  const songs = () => tasteSongs((getPage() || {}).piece);
  return {
    list: async () => songs(),
    groups: (all) => {
      const sides = [];
      for (const s of all) {
        let g = sides.find((x) => x.label === s.album);
        if (!g) sides.push((g = { label: s.album, songs: [] }));
        g.songs.push(s);
      }
      return sides;
    },
    refresh: false,
    pickLabel: "Song for the taste",
    signedOut: "Sign in to cut a taste of your tape.",
    placeholder: "The tape's songs",
    looking: "",
    none: "This tape's songs can't be read, so a taste can't be cut from it.",
    failed: (msg) => `The tape's songs couldn't be listed (${msg}).`,
    unusableNote: () => "",
  };
}

export function mountTilePanel(root, { getPage, patchPage, context, values }) {
  let page = getPage() || {};
  const kind = PIECE_KINDS[page.layout] || "tile";
  const want = kind === "tape" ? "tape" : "live";
  const noun = kind === "tape" ? "tape" : "tile";

  const box = el("div", "tile-panel");
  root.append(box);
  const head = el("div", "snd-head");
  const pick = el("select", "text snd-pick");
  pick.setAttribute("aria-label", `${noun[0].toUpperCase()}${noun.slice(1)} for this page`);
  const refresh = el("button", "btn btn-quiet btn-small", "Refresh");
  refresh.type = "button";
  head.append(pick, refresh);
  const note = el("p", "field-help snd-note");
  const status = el("p", "snd-status");
  status.setAttribute("aria-live", "polite");
  const card = el("div", "tile-card");
  const thumb = el("img", "tile-thumb");
  thumb.alt = "";
  const about = el("div", "tile-about");
  const title = el("strong", "tile-name");
  const typeLine = el("span", "field-help tile-kind");
  const made = el("span", "snd-made tile-made");
  made.setAttribute("aria-live", "polite");
  const retry = el("button", "btn btn-quiet btn-small", "Try again");
  retry.type = "button";
  about.append(title, typeLine, made);
  card.append(thumb, about);
  const help = el("p", "field-help tile-help", kind === "tape"
    ? "Shows as the tape's J-card: its cassette, title, songs by side and dedication, with a link to play the whole tape."
    : "Copied exactly as you published it. Readers tap it to start it on the page; it stops when they turn the page.");
  box.append(head, note, status, card, help);

  // The taste (tape pages only): a switch, then the sound panel with the tape's songs.
  const taste = el("div", "tape-taste");
  const tasteLabel = el("label", "toggle");
  const tasteBox = el("input");
  tasteBox.type = "checkbox";
  tasteBox.setAttribute("role", "switch");
  const tasteTrack = el("span", "toggle-track");
  tasteTrack.setAttribute("aria-hidden", "true");
  tasteLabel.append(tasteBox, tasteTrack, el("span", null, "Add a taste"));
  const tasteHelp = el("p", "field-help", "Up to a minute of one of the tape's songs, on a band near the bottom of the page. Readers tap to play it; it plays on as they turn the pages.");
  const tasteSlot = el("div", "tape-taste-panel");
  taste.append(tasteLabel, tasteHelp, tasteSlot);
  if (kind === "tape") box.append(taste);
  let tastePanel = null; // the mounted sound panel
  let tasteMounting = null;

  let account = null;
  let tiles = null; // by uri
  let ticket = 0;
  let disposed = false;
  let lastValues = values;
  let lastContext = context;
  const piece = () => (page && page.piece && page.piece.kind === kind ? page.piece : null);

  function setStatus(text, error = false) {
    status.textContent = text || "";
    status.hidden = !text;
    status.classList.toggle("is-error", error);
  }

  const getType = (id) => listTileTypes().find((t) => t.id === id);
  const placementOf = (t) => tilePlacement(t.recipe, getType, want);

  async function loadList(force = false) {
    const a = account;
    if (!a) return;
    const mine = ++ticket;
    if (force) lists.delete(a.did);
    setStatus(`Looking for your ${noun}s…`);
    try {
      const all = await tilesOf(a);
      if (mine !== ticket || disposed) return;
      tiles = new Map(all.map((t) => [t.uri, t]));
      drawList(all);
      const usable = all.filter((t) => placementOf(t).ok).length;
      setStatus(usable ? "" : all.length ? `None of your tiles can go on this page (see the list for why).` : "You haven't published any tiles from this account yet.", !usable);
    } catch (err) {
      if (mine !== ticket || disposed) return;
      setStatus(`Your tiles couldn't be listed (${err.message}). Press Refresh to try again.`, true);
    }
  }

  function drawList(all) {
    pick.replaceChildren();
    const p = piece();
    const none = el("option", null, p && p.uri ? `Choose another ${noun}…` : `Choose one of your ${noun}s…`);
    none.value = "";
    pick.append(none);
    let found = false;
    const byType = new Map();
    for (const t of all) {
      const pl = placementOf(t);
      if (!pl.ok) continue;
      const k = pl.type.title;
      if (!byType.has(k)) byType.set(k, []);
      byType.get(k).push(t);
    }
    for (const [k, list] of byType) {
      const group = el("optgroup");
      group.label = k;
      for (const t of list) {
        const o = el("option", null, t.name);
        o.value = t.uri;
        if (p && p.uri === t.uri) { o.selected = true; found = true; }
        group.append(o);
      }
      pick.append(group);
    }
    const others = all.filter((x) => !placementOf(x).ok);
    if (others.length) {
      const group = el("optgroup");
      group.label = "Can't go on this page";
      for (const t of others) {
        const o = el("option", null, `${t.name}: ${placementOf(t).reason}`);
        o.value = t.uri;
        o.disabled = true;
        group.append(o);
      }
      pick.append(group);
    }
    // One no longer listed (deleted since) keeps working while its copy is here.
    if (p && p.uri && !found) {
      const o = el("option", null, p.name || `This page's ${noun}`);
      o.value = p.uri;
      o.selected = true;
      pick.insertBefore(o, none.nextSibling);
    }
    note.textContent = others.length ? `${others.length} of your tiles can't go on this page; they're listed at the end with the reason.` : "";
    note.hidden = !others.length;
  }

  function copy(uri, cid) {
    copyOf(kind, uri, cid).then(
      ({ pub, tape, files }) => patchPage((pg) => (pg.piece && pg.piece.uri === uri && pg.piece.kind === kind ? {
        piece: {
          ...pg.piece, status: "ready", error: undefined, cid: pub.cid || pg.piece.cid, name: (pub.manifest && pub.manifest.name) || pg.piece.name,
          handle: pub.handle || pg.piece.handle, did: pub.did, files, ...(tape ? { tape } : {}),
        },
      } : null)),
      (err) => patchPage((pg) => (pg.piece && pg.piece.uri === uri ? { piece: { ...pg.piece, status: "error", error: err.message || String(err) } } : null)),
    );
  }

  pick.addEventListener("change", () => {
    const t = tiles && tiles.get(pick.value);
    if (!t || !placementOf(t).ok) return;
    const p = piece();
    if (p && p.uri === t.uri && p.status !== "error") return;
    const r = t.recipe || {};
    const change = {
      piece: {
        kind, uri: t.uri, cid: t.cid, name: t.name, did: account.did, handle: account.handle,
        typeId: r.type, typeVersion: r.typeVersion, foundryVersion: r.foundryVersion, banner: t.banner, status: "loading",
      },
    };
    // A taste belongs to its tape: a new tape starts without one.
    if (kind === "tape" && (getPage() || {}).sound) Object.assign(change, { sound: false, clip: null });
    patchPage(change);
    copy(t.uri, t.cid);
  });
  refresh.addEventListener("click", () => loadList(true));
  retry.addEventListener("click", () => {
    const p = piece();
    if (!p || !p.uri) return;
    patchPage((pg) => (pg.piece ? { piece: { ...pg.piece, status: "loading", error: undefined } } : null));
    copy(p.uri, p.cid);
  });
  tasteBox.addEventListener("change", () => {
    patchPage(tasteBox.checked ? { sound: true } : { sound: false });
  });

  function drawCard() {
    const p = piece();
    card.hidden = !(p && p.uri);
    if (!p || !p.uri) return;
    const t = tiles && tiles.get(p.uri);
    title.textContent = p.name || `Untitled ${noun}`;
    const pl = t && placementOf(t);
    const typeTitle = (pl && pl.type && pl.type.title) || p.typeId || "";
    const songs = p.tape ? p.tape.sides.reduce((n, s) => n + s.tracks.length, 0) : 0;
    typeLine.textContent = [typeTitle, p.tape ? `${songs} song${songs === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
    const banner = p.banner || (t && t.banner);
    if (banner && account) { thumb.src = blobUrl(account, banner); thumb.hidden = false; } else thumb.hidden = true;
    made.replaceChildren();
    made.classList.remove("is-error");
    if (p.status === "error") {
      made.classList.add("is-error");
      made.append(`It couldn't be copied (${p.error}). `, retry);
    } else if (p.status === "ready" && Array.isArray(p.files)) {
      const bytes = p.files.reduce((n, f) => n + f.bytes.length, 0);
      made.textContent = kind === "tape" ? `Ready: its J-card (the banner is ${formatSize(bytes)}).` : `Copied: ${p.files.length} files, ${formatSize(bytes)}.`;
    } else {
      made.textContent = kind === "tape" ? "Reading the tape…" : "Copying it into the zine…";
    }
  }

  async function drawTaste() {
    if (kind !== "tape") return;
    const p = piece();
    const ready = Boolean(p && p.status === "ready" && p.tape);
    taste.hidden = !ready;
    tasteBox.checked = Boolean(page.sound);
    const want2 = ready && Boolean(page.sound);
    if (want2 && !tastePanel && !tasteMounting) {
      tasteMounting = import("./soundpanel.js").then(({ mountSoundPanel }) => {
        tasteMounting = null;
        if (disposed || !page.sound) return;
        tastePanel = mountSoundPanel(tasteSlot, { getPage, patchPage, context: lastContext, values: lastValues }, tasteSource(getPage));
        tastePanel.update(getPage() || page, lastValues, lastContext);
      });
    } else if (!want2 && tastePanel) {
      tastePanel.dispose();
      tastePanel = null;
    } else if (tastePanel) {
      tastePanel.update(page, lastValues, lastContext);
    }
  }

  function useAccount(ctx) {
    const a = accountOf(ctx);
    if (a.state !== "ok") {
      account = null;
      tiles = null;
      pick.replaceChildren(el("option", null, `Your ${noun}s`));
      pick.disabled = true;
      refresh.hidden = true;
      note.hidden = true;
      setStatus(
        a.state === "out" ? `Sign in to pick one of your ${noun}s.` :
        a.state === "lookup" ? `Your account's details couldn't be looked up, so your ${noun}s can't be listed yet.` :
        "Looking up your account…"
      );
      return false;
    }
    if (account && account.did === a.did && account.pds === a.pds) return true;
    account = a;
    pick.disabled = false;
    refresh.hidden = false;
    loadList();
    return true;
  }

  function update(next, nextValues, ctx) {
    if (disposed) return;
    page = next || getPage() || {};
    if (nextValues) lastValues = nextValues;
    if (ctx) lastContext = ctx;
    const ok = useAccount(ctx || lastContext);
    const p = piece();
    // A page whose copy was interrupted (the panel closed) picks it up again.
    if (ok && p && p.uri && p.status === "loading") copy(p.uri, p.cid);
    if (tiles && p && p.uri && pick.value !== p.uri) tilesOf(account).then((all) => { if (!disposed) drawList(all); }, () => {});
    drawCard();
    drawTaste();
  }

  update(page, values, context);
  return {
    update,
    dispose() {
      disposed = true;
      if (tastePanel) tastePanel.dispose();
      box.remove();
    },
  };
}
