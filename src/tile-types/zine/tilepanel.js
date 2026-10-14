import { fetchPublishedTile, jsonFile, copyPaths, TILE_COLLECTION } from "../../core/published-tile.js";
import { listTileTypes } from "../../core/registry.js";
import { formatSize } from "../../core/fileset.js";
import { tilePlacement, tapeFromJson, tasteSongs, PIECE_KINDS, isAtmosynthTile, atmoPatchInfo, appTileInfo, appType } from "./piece.js";
import { myAccounts, nameOf } from "../../core/my-accounts.js";
import { pagesFor, pagesInUse } from "./pages.js";
import { tilePairs, pairChanges, showsTile, cleanShortName, SHORT_NAME_MAX } from "./pairs.js";
import { tileTalks, pairQualifies } from "./talk.js";

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
// The list comes from your own accounts (public reads): the account in use and
// your other accounts on this browser (src/core/my-accounts.js), every
// ing.dasl.masl record, with its recipe (/foundry.json) read to see what kind of
// tile it is. Tiles that can't go on this kind of page are listed with the reason.
// ATMOSYNTH tiles (v0.24.0) have no recipe; they're known by the generator in
// their manifest, and their patch.json is read when copied (whose modules and
// samples it uses; other people's modules make the reader wall it off).
// Since v0.28.0 any other tile of yours the Foundry didn't make (Treeline's,
// another app's, a hand-made one) can go on "A web tile" pages too, grouped by
// the app it names, else under "Other tiles".

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
            owner: { did: a.did, pds: a.pds, handle: a.handle || null },
            rkey: String(r.uri || "").split("/").pop(),
            name: String(tile.name || "Untitled tile"),
            banner: cidOf(res["/banner.png"]) || cidOf(res["/screenshot.png"]),
            generator: typeof tile.generator === "string" ? tile.generator : "",
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
      if (kind !== "tape") {
        // Every file must be one the zine can copy: say so now, on the card,
        // rather than when the zine is built (v0.27.0).
        try { copyPaths(pub.files, "/tiles/check"); } catch (err) {
          throw new Error(String(err.message).replace(/^The tile's /, "its ").replace(/\.$/, ""));
        }
        const foundry = Boolean(pub.recipe && pub.recipe.madeWith === "Web Tile Foundry");
        if (foundry) return { pub, files: pub.files };
        if (!isAtmosynthTile(pub.manifest)) return { pub, files: pub.files, app: appTileInfo(pub.manifest, pub.record) };
        const patch = jsonFile(pub.files, "/patch.json");
        if (!patch) throw new Error("its patch couldn't be read");
        return { pub, files: pub.files, atmo: atmoPatchInfo(patch) };
      }
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

export function mountTilePanel(root, { getPage, patchPage, getPages, patchPageById, context, values }) {
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
  // Talking tiles (v0.31.0) get a small "talks" badge after their name.
  const talksBadge = el("span", "tile-talks", "talks");
  talksBadge.title = "This tile talks to other tiles through the zine.";
  talksBadge.setAttribute("aria-label", "Talks: this tile talks to other tiles through the zine.");
  const typeLine = el("span", "field-help tile-kind");
  const made = el("span", "snd-made tile-made");
  made.setAttribute("aria-live", "polite");
  const retry = el("button", "btn btn-quiet btn-small", "Try again");
  retry.type = "button";
  const nameRow = el("span", "tile-name-row");
  nameRow.append(title, talksBadge);
  about.append(nameRow, typeLine, made);
  card.append(thumb, about);
  const help = el("p", "field-help tile-help", kind === "tape"
    ? "Shows as the tape's J-card: its cassette, title, songs by side and dedication, with a link to play the whole tape."
    : "Copied exactly as you published it. It starts when its page is shown, and stops when the page is turned.");
  box.append(head, note, status, card, help);

  // Tiles that talk (v0.29.0, "A web tile" pages only): this tile's partner on
  // another tile page, set on both pages at once, and the short name the
  // reader's captions call this tile by.
  const talk = el("div", "tile-talk");
  const talkLabel = el("label", "field-label", "Talks to");
  const talkPick = el("select", "text");
  talkPick.id = `talk-${Math.random().toString(36).slice(2, 9)}`;
  talkLabel.htmlFor = talkPick.id;
  const talkHelp = el("p", "field-help", "");
  // v0.31.0: a tile that shows no sign of talking says so; the menu then only
  // opens on purpose ("Pair it anyway…"). "Show all tiles" adds the others to a
  // talking tile's menu, marked, for a talker the check missed.
  const aloneNote = el("p", "field-help tile-alone", "This tile plays on its own: it doesn't seem to talk to other tiles.");
  const showAll = el("button", "link-button tile-talk-more", "Show all tiles");
  showAll.type = "button";
  const shortBox = el("label", "tile-talk-short");
  const shortInput = el("input", "text");
  shortInput.type = "text";
  shortInput.maxLength = SHORT_NAME_MAX;
  shortInput.placeholder = "e.g. Bob";
  shortBox.append(el("span", "field-label", "Short name (optional)"), shortInput, el("p", "field-help", ""));
  const shortHelp = shortBox.querySelector(".field-help");
  talk.append(talkLabel, aloneNote, talkPick, talkHelp, showAll, shortBox);
  let everyTile = false; // the menu lists every tile page, not only talking ones
  let everyFor = null;
  if (kind === "tile") box.append(talk);

  // The taste (tape pages only): a switch, then the sound panel with the tape's songs.
  const taste = el("div", "tape-taste");
  const tasteLabel = el("label", "toggle");
  const tasteBox = el("input");
  tasteBox.type = "checkbox";
  tasteBox.setAttribute("role", "switch");
  const tasteTrack = el("span", "toggle-track");
  tasteTrack.setAttribute("aria-hidden", "true");
  tasteLabel.append(tasteBox, tasteTrack, el("span", null, "Add a taste"));
  const tasteHelp = el("p", "field-help", "Up to a minute of one of the tape's songs, on a ribbon near the bottom of the page.");
  const tasteSlot = el("div", "tape-taste-panel");
  taste.append(tasteLabel, tasteHelp, tasteSlot);
  if (kind === "tape") box.append(taste);
  let tastePanel = null; // the mounted sound panel
  let tasteMounting = null;

  let accounts = null; // your accounts, the one in use first: [{ did, pds, handle }]
  let accountsKey = "";
  let tiles = null; // by uri
  let ticket = 0;
  let disposed = false;
  let lastValues = values;
  let thumbUrl = null; // the banner thumbnail, from the zine's copy
  let thumbFor = null;
  let lastContext = context;
  const piece = () => (page && page.piece && page.piece.kind === kind ? page.piece : null);

  function setStatus(text, error = false) {
    status.textContent = text || "";
    status.hidden = !text;
    status.classList.toggle("is-error", error);
  }

  const getType = (id) => listTileTypes().find((t) => t.id === id);
  const placementOf = (t) => tilePlacement(t.recipe, getType, want, t.generator);

  // Every account's list; one that can't be read is left out, with a note.
  async function allTiles(list) {
    const results = await Promise.allSettled(list.map((a) => tilesOf(a)));
    const all = [];
    const failed = [];
    results.forEach((r, i) => (r.status === "fulfilled" ? all.push(...r.value) : failed.push({ a: list[i], err: r.reason })));
    if (!all.length && failed.length) throw failed[0].err;
    return { all, failed };
  }

  async function loadList(force = false) {
    const list = accounts;
    if (!list) return;
    const mine = ++ticket;
    if (force) for (const a of list) lists.delete(a.did);
    setStatus(`Looking for your ${noun}s…`);
    try {
      const { all, failed } = await allTiles(list);
      if (mine !== ticket || disposed) return;
      tiles = new Map(all.map((t) => [t.uri, t]));
      drawList(all);
      drawCard();
      const usable = all.filter((t) => placementOf(t).ok).length;
      const chosen = piece();
      const where = list.length > 1 ? "your accounts" : "this account";
      let text = "";
      if (failed.length) text = `${failed.map((f) => nameOf(f.a)).join(", ")}: couldn't be listed (${failed[0].err.message}). Press Refresh to try again. `;
      // Only a problem while nothing is chosen: a chosen tile or tape keeps working.
      if (!usable && !(chosen && chosen.uri)) {
        text += all.length
          ? `None of your tiles can go on this page (see the list for why).`
          : `You haven't published any ${noun === "tape" ? "tapes" : "tiles"} from ${where} yet.`;
      }
      setStatus(text.trim(), Boolean(text) && !(chosen && chosen.uri));
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
    const several = new Set(all.map((t) => t.owner && t.owner.did)).size > 1;
    // Grouped by kind of tile, and by account when there's more than one.
    const groups = new Map();
    for (const t of all) {
      const pl = placementOf(t);
      if (!pl.ok) continue;
      const k = several ? `${pl.type.title} · ${nameOf(t.owner)}` : pl.type.title;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }
    for (const [k, list] of groups) {
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
        const o = el("option", null, `${t.name}${several ? ` (${nameOf(t.owner)})` : ""}: ${placementOf(t).reason}`);
        o.value = t.uri;
        o.disabled = true;
        group.append(o);
      }
      pick.append(group);
    }
    // One no longer listed (deleted since, or from an account no longer signed
    // in here) keeps working while its copy is here.
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
      ({ pub, tape, files, atmo, app }) => patchPage((pg) => (pg.piece && pg.piece.uri === uri && pg.piece.kind === kind ? {
        piece: {
          ...pg.piece, status: "ready", error: undefined, cid: pub.cid || pg.piece.cid, name: (pub.manifest && pub.manifest.name) || pg.piece.name,
          handle: pub.handle || pg.piece.handle, did: pub.did, own: true, files, ...(tape ? { tape } : {}),
          ...(atmo ? { maker: "atmosynth", atmo } : {}),
          ...(app ? { maker: "app", app } : {}),
          ...((atmo || app) && pub.manifest && pub.manifest.sizing ? { sizing: pub.manifest.sizing } : {}),
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
    const foundry = r.madeWith === "Web Tile Foundry";
    const atmo = isAtmosynthTile(t.generator) && !foundry;
    const maker = atmo ? { maker: "atmosynth" }
      : !foundry && kind === "tile" ? { maker: "app", app: t.generator ? { generator: t.generator } : {} }
      : { typeId: r.type, typeVersion: r.typeVersion, foundryVersion: r.foundryVersion };
    const change = {
      piece: {
        kind, uri: t.uri, cid: t.cid, name: t.name, did: t.owner.did, handle: t.owner.handle, own: true,
        ...maker,
        banner: t.banner, status: "loading",
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
  // Every page now (the latest), and the page specs in use with their pages.
  const allPages = () => (getPages ? getPages() : (lastValues && lastValues.pages) || []);
  function talkState() {
    const pages = allPages();
    const count = lastValues && lastValues.pageCount;
    const specs = pagesFor(count);
    const used = pagesInUse(pages, count);
    const me = (getPage() || page || {}).id;
    return { pages, specs, used, me, partner: tilePairs(specs, used).get(me) || "" };
  }
  const pageWords = (spec) => (spec.kind === "back" ? "the back" : `p. ${spec.short || spec.label}`);
  function drawTalk() {
    if (kind !== "tile") return;
    const cur = getPage() || page || {};
    talk.hidden = !showsTile(cur);
    if (talk.hidden) return;
    const { specs, used, me, partner } = talkState();
    const mine = tileTalks(cur.piece);
    // Opening every tile is for this tile only: a new tile starts afresh.
    if (everyFor !== (cur.piece && cur.piece.uri)) { everyFor = cur.piece && cur.piece.uri; everyTile = false; }
    // A pair that no longer counts ends quietly: the other page's tile taken off,
    // the page put aside, or (v0.31.0) a tile that doesn't talk, unless the
    // creator paired them on purpose.
    const partnerPage = partner ? used[specs.findIndex((sp) => sp.id === partner)] : null;
    if ((cur.talksTo && !partner) || (partner && !pairQualifies(cur, partnerPage))) {
      if (patchPageById) patchPageById(pairChanges(allPages(), me, ""));
      else patchPage((pg) => (pg.talksTo ? { talksTo: null } : null));
      return;
    }
    const others = [];
    specs.forEach((spec, i) => {
      if (spec.id === me || !showsTile(used[i])) return;
      others.push({ spec, page: used[i], talks: tileTalks(used[i].piece) });
    });
    const open = mine === true || everyTile || Boolean(partner);
    const hidden = others.filter((o) => o.talks !== true && o.spec.id !== partner);
    talkPick.replaceChildren();
    const none = el("option", null, "Nobody");
    none.value = "";
    talkPick.append(none);
    for (const o of others) {
      if (o.talks !== true && !everyTile && o.spec.id !== partner) continue;
      const mark = o.talks === true ? "" : o.talks === null ? " (still copying)" : " (no sign of talking)";
      const opt = el("option", null, `${o.spec.label}: ${o.page.piece.name || "a tile"}${mark}`);
      opt.value = o.spec.id;
      talkPick.append(opt);
    }
    talkPick.value = partner;
    talkPick.disabled = talkPick.options.length < 2;
    aloneNote.hidden = open;
    talkPick.hidden = !open;
    showAll.textContent = mine === true ? "Show all tiles" : "Pair it anyway…";
    showAll.hidden = everyTile || (mine === true ? hidden.length === 0 : open);
    talkHelp.hidden = !open;
    talkHelp.textContent = everyTile && mine !== true
      ? "Only for talking tiles. This tile shows no sign of talking, so a pair probably won't do anything."
      : everyTile
      ? "Only for talking tiles. Tiles marked “no sign of talking” probably won't answer."
      : talkPick.disabled
        ? "Only for talking tiles. Put a matching talking tile on another page to talk with this one."
        : "Only for talking tiles. Choose the page with its partner.";
    shortBox.hidden = !partner;
    if (document.activeElement !== shortInput) shortInput.value = cur.shortName || "";
    const mySpec = specs.find((s2) => s2.id === me);
    const name = cleanShortName(shortInput.value);
    const where = mySpec ? pageWords(mySpec) : "";
    shortHelp.textContent = `What the captions call this tile: “${name ? `Go to ${name}'s tile (${where})` : `Go to the tile on ${where}`}”.`;
  }
  showAll.addEventListener("click", () => {
    everyTile = true;
    drawTalk();
    if (!talkPick.disabled) talkPick.focus();
  });
  talkPick.addEventListener("change", () => {
    const me = (getPage() || page || {}).id;
    if (!me) return;
    const changes = pairChanges(allPages(), me, talkPick.value || "");
    // Paired on purpose with a tile that doesn't seem to talk (v0.31.0): kept on both pages,
    // so the pair isn't ended as one that no longer counts.
    const b = talkPick.value || "";
    if (b) {
      const pages = allPages();
      const pg = (id) => pages.find((x) => x && x.id === id);
      const anyway = !(tileTalks((pg(me) || {}).piece) === true && tileTalks((pg(b) || {}).piece) === true);
      changes[me] = { ...changes[me], pairAnyway: anyway || null };
      changes[b] = { ...changes[b], pairAnyway: anyway || null };
    } else if (changes[me]) changes[me] = { ...changes[me], pairAnyway: null };
    if (patchPageById) patchPageById(changes);
    else if (changes[me]) patchPage(changes[me]);
  });
  shortInput.addEventListener("input", () => {
    patchPage({ shortName: shortInput.value.slice(0, SHORT_NAME_MAX) });
  });
  shortInput.addEventListener("change", () => {
    const clean = cleanShortName(shortInput.value);
    if (clean !== shortInput.value) shortInput.value = clean;
    patchPage({ shortName: clean });
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
    talksBadge.hidden = !(kind === "tile" && tileTalks(p) === true);
    const pl = t && placementOf(t);
    const typeTitle = (pl && pl.type && pl.type.title) || (p.maker === "atmosynth" ? "ATMOSYNTH patch" : p.maker === "app" ? appType((p.app || {}).generator).title : p.typeId) || "";
    const songs = p.tape ? p.tape.sides.reduce((n, s) => n + s.tracks.length, 0) : 0;
    typeLine.textContent = [typeTitle, p.tape ? `${songs} song${songs === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
    // The banner: the zine's own copy once it's here; before that, from the
    // account the tile or tape is in (not necessarily the one in use).
    const copied = Array.isArray(p.files) && (p.files.find((f) => f.path === "/banner.png") || p.files.find((f) => f.path === "/screenshot.png"));
    const banner = p.banner || (t && t.banner);
    const owner = (t && t.owner) || (accounts || []).find((a) => a.did === p.did);
    let src = "";
    if (copied) {
      if (thumbFor !== copied.bytes) {
        if (thumbUrl) URL.revokeObjectURL(thumbUrl);
        thumbUrl = URL.createObjectURL(new Blob([copied.bytes], { type: "image/png" }));
        thumbFor = copied.bytes;
      }
      src = thumbUrl;
    } else if (banner && owner) {
      src = blobUrl(owner, banner);
    }
    if (src) { if (thumb.src !== src) thumb.src = src; thumb.hidden = false; } else thumb.hidden = true;
    made.replaceChildren();
    made.classList.remove("is-error");
    if (p.status === "error") {
      made.classList.add("is-error");
      made.append(`It couldn't be copied (${p.error}). `, retry);
    } else if (p.status === "ready" && Array.isArray(p.files)) {
      const bytes = p.files.reduce((n, f) => n + f.bytes.length, 0);
      made.textContent = kind === "tape" ? `Ready: its J-card (the banner is ${formatSize(bytes)}).` : `Copied: ${p.files.length} files, ${formatSize(bytes)}.`;
      if (p.maker === "atmosynth" && p.atmo && p.atmo.others) made.textContent += " It uses other people's modules, so it runs walled off on the page.";
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

  function useAccounts(ctx) {
    const mine = myAccounts(ctx);
    if (mine.state !== "ok") {
      accounts = null;
      accountsKey = "";
      tiles = null;
      pick.replaceChildren(el("option", null, `Your ${noun}s`));
      pick.disabled = true;
      refresh.hidden = true;
      note.hidden = true;
      setStatus(
        mine.state === "out" ? `Sign in to pick one of your ${noun}s.` :
        mine.state === "lookup" ? `Your account's details couldn't be looked up, so your ${noun}s can't be listed yet.` :
        "Looking up your account…"
      );
      return false;
    }
    if (accounts && accountsKey === mine.key) return true;
    accounts = mine.list;
    accountsKey = mine.key;
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
    const ok = useAccounts(ctx || lastContext);
    const p = piece();
    // A page whose copy was interrupted (the panel closed) picks it up again.
    if (ok && p && p.uri && p.status === "loading") copy(p.uri, p.cid);
    if (tiles && p && p.uri && pick.value !== p.uri) allTiles(accounts).then(({ all }) => { if (!disposed) drawList(all); }, () => {});
    drawCard();
    drawTaste();
    drawTalk();
  }

  update(page, values, context);
  return {
    update,
    dispose() {
      disposed = true;
      if (thumbUrl) URL.revokeObjectURL(thumbUrl);
      if (tastePanel) tastePanel.dispose();
      box.remove();
    },
  };
}
