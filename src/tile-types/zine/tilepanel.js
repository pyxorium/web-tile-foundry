import { fetchPublishedTile, TILE_COLLECTION } from "../../core/published-tile.js";
import { listTileTypes } from "../../core/registry.js";
import { formatSize } from "../../core/fileset.js";
import { tilePlacement } from "./piece.js";

// The "Your tile" panel on an "A tile" page (stage 4): pick one of your
// published tiles; the Foundry copies its files, exactly as published, into
// the zine. Plain DOM, mounted by the Foundry's page editor (the pages input's
// piece panel, src/core/contract.js) for the page being edited.
//
// The list comes from your own account (public reads): every ing.dasl.masl
// record, with its recipe (/foundry.json) read to see what kind of tile it is.
// Tiles that can't go on a page are listed with the reason.

const lists = new Map(); // did -> Promise<entries>
const recipes = new Map(); // blob cid -> Promise<recipe | null>
const copies = new Map(); // "uri|cid" -> Promise<published tile>
const PAGE_SIZE = 100;
const MAX_TILES = 500;
const TIMEOUT_MS = 12000;

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

/** Your published tiles, newest first: [{ uri, cid, rkey, name, banner, recipe, placement }]. */
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
      const types = listTileTypes();
      const getType = (id) => types.find((t) => t.id === id);
      const out = [];
      // Read the recipes a few at a time.
      for (let i = 0; i < records.length; i += 6) {
        const batch = records.slice(i, i + 6);
        const found = await Promise.all(batch.map(async (r) => {
          const tile = (r.value && r.value.tile) || {};
          const res = tile.resources || {};
          if (!res["/"]) return null;
          const recipe = await recipeOf(a, cidOf(res["/foundry.json"]));
          return {
            uri: r.uri,
            cid: r.cid,
            rkey: String(r.uri || "").split("/").pop(),
            name: String(tile.name || "Untitled tile"),
            banner: cidOf(res["/banner.png"]),
            createdAt: (r.value && r.value.createdAt) || "",
            recipe,
            placement: tilePlacement(recipe, getType),
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

function copyOf(uri, cid) {
  const key = `${uri}|${cid || ""}`;
  if (!copies.has(key)) {
    const p = fetchPublishedTile(uri).then((pub) => {
      if (cid && pub.cid && pub.cid !== cid) throw new Error("the tile changed while it was being copied; choose it again");
      return pub;
    });
    p.catch(() => copies.delete(key));
    copies.set(key, p);
  }
  return copies.get(key);
}

export function mountTilePanel(root, { getPage, patchPage, context }) {
  const box = el("div", "tile-panel");
  root.append(box);
  const head = el("div", "snd-head");
  const pick = el("select", "text snd-pick");
  pick.setAttribute("aria-label", "Tile for this page");
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
  const kind = el("span", "field-help tile-kind");
  const made = el("span", "snd-made tile-made");
  made.setAttribute("aria-live", "polite");
  const retry = el("button", "btn btn-quiet btn-small", "Try again");
  retry.type = "button";
  about.append(title, kind, made);
  card.append(thumb, about);
  const help = el("p", "field-help tile-help", "Copied exactly as you published it. Readers tap it to start it on the page; it stops when they turn the page.");
  box.append(head, note, status, card, help);

  let account = null;
  let tiles = null; // by uri
  let ticket = 0;
  let disposed = false;
  let page = getPage() || {};
  const piece = () => (page && page.piece) || null;

  function setStatus(text, error = false) {
    status.textContent = text || "";
    status.hidden = !text;
    status.classList.toggle("is-error", error);
  }

  async function loadList(force = false) {
    const a = account;
    if (!a) return;
    const mine = ++ticket;
    if (force) lists.delete(a.did);
    setStatus("Looking for your tiles…");
    try {
      const all = await tilesOf(a);
      if (mine !== ticket || disposed) return;
      tiles = new Map(all.map((t) => [t.uri, t]));
      drawList(all);
      const usable = all.filter((t) => t.placement.ok).length;
      setStatus(usable ? "" : all.length ? "None of your tiles can go on a page yet (see the list for why)." : "You haven't published any tiles from this account yet.", !usable);
    } catch (err) {
      if (mine !== ticket || disposed) return;
      setStatus(`Your tiles couldn't be listed (${err.message}). Press Refresh to try again.`, true);
    }
  }

  function drawList(all) {
    pick.replaceChildren();
    const p = piece();
    const none = el("option", null, p && p.uri ? "Choose another tile…" : "Choose one of your tiles…");
    none.value = "";
    pick.append(none);
    let found = false;
    const byType = new Map();
    for (const t of all.filter((x) => x.placement.ok)) {
      const k = t.placement.type.title;
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
    const others = all.filter((x) => !x.placement.ok);
    if (others.length) {
      const group = el("optgroup");
      group.label = "Can't go on a page";
      for (const t of others) {
        const o = el("option", null, `${t.name}: ${t.placement.reason}`);
        o.value = t.uri;
        o.disabled = true;
        group.append(o);
      }
      pick.append(group);
    }
    // A tile no longer listed (deleted since) keeps working while its copy is here.
    if (p && p.uri && !found) {
      const o = el("option", null, p.name || "This page's tile");
      o.value = p.uri;
      o.selected = true;
      pick.insertBefore(o, none.nextSibling);
    }
    note.textContent = others.length ? `${others.length} of your tiles can't go on a page; they're listed at the end with the reason.` : "";
    note.hidden = !others.length;
  }

  function copy(uri, cid) {
    copyOf(uri, cid).then(
      (pub) => patchPage((pg) => (pg.piece && pg.piece.uri === uri ? {
        piece: { ...pg.piece, status: "ready", error: undefined, cid: pub.cid || pg.piece.cid, name: (pub.manifest && pub.manifest.name) || pg.piece.name, handle: pub.handle || pg.piece.handle, did: pub.did, files: pub.files },
      } : null)),
      (err) => patchPage((pg) => (pg.piece && pg.piece.uri === uri ? { piece: { ...pg.piece, status: "error", error: err.message || String(err) } } : null)),
    );
  }

  pick.addEventListener("change", () => {
    const t = tiles && tiles.get(pick.value);
    if (!t || !t.placement.ok) return;
    const p = piece();
    if (p && p.uri === t.uri && p.status !== "error") return;
    const r = t.recipe || {};
    patchPage({
      piece: {
        kind: "tile", uri: t.uri, cid: t.cid, name: t.name, did: account.did, handle: account.handle,
        typeId: r.type, typeVersion: r.typeVersion, foundryVersion: r.foundryVersion, banner: t.banner, status: "loading",
      },
    });
    copy(t.uri, t.cid);
  });
  refresh.addEventListener("click", () => loadList(true));
  retry.addEventListener("click", () => {
    const p = piece();
    if (!p || !p.uri) return;
    patchPage((pg) => (pg.piece ? { piece: { ...pg.piece, status: "loading", error: undefined } } : null));
    copy(p.uri, p.cid);
  });

  function drawCard() {
    const p = piece();
    card.hidden = !(p && p.uri);
    if (!p || !p.uri) return;
    const t = tiles && tiles.get(p.uri);
    title.textContent = p.name || "Untitled tile";
    const typeTitle = (t && t.placement.type && t.placement.type.title) || p.typeId || "";
    kind.textContent = [typeTitle, p.handle ? `by @${p.handle}` : ""].filter(Boolean).join(" · ");
    const banner = p.banner || (t && t.banner);
    if (banner && account) { thumb.src = blobUrl(account, banner); thumb.hidden = false; } else thumb.hidden = true;
    made.replaceChildren();
    made.classList.remove("is-error");
    if (p.status === "error") {
      made.classList.add("is-error");
      made.append(`It couldn't be copied (${p.error}). `, retry);
    } else if (p.status === "ready" && Array.isArray(p.files)) {
      const bytes = p.files.reduce((n, f) => n + f.bytes.length, 0);
      made.textContent = `Copied: ${p.files.length} files, ${formatSize(bytes)}.`;
    } else {
      made.textContent = "Copying it into the zine…";
    }
  }

  function useAccount(ctx) {
    const a = accountOf(ctx);
    if (a.state !== "ok") {
      account = null;
      tiles = null;
      pick.replaceChildren(el("option", null, "Your tiles"));
      pick.disabled = true;
      refresh.hidden = true;
      note.hidden = true;
      setStatus(
        a.state === "out" ? "Sign in to pick one of your tiles." :
        a.state === "lookup" ? "Your account's details couldn't be looked up, so your tiles can't be listed yet." :
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

  function update(next, _values, ctx) {
    if (disposed) return;
    page = next || getPage() || {};
    const ok = useAccount(ctx);
    const p = piece();
    // A page whose copy was interrupted (the panel closed) picks it up again.
    if (ok && p && p.uri && p.status === "loading") copy(p.uri, p.cid);
    if (tiles && p && p.uri && pick.value !== p.uri) tilesOf(account).then((all) => { if (!disposed) drawList(all); }, () => {});
    drawCard();
  }

  update(page, null, context);
  return {
    update,
    dispose() {
      disposed = true;
      box.remove();
    },
  };
}
