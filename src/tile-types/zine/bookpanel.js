import { listAll } from "../../core/app-pictures.js";
import { rawCid } from "../../core/cid.js";
import { myAccounts, nameOf } from "../../core/my-accounts.js";
import { formatSize } from "../../core/fileset.js";
import { BOOKHIVE, bookFromRecord, groupBooks, authorsText, starsText, statusLine, reviewExcerpt } from "./books.js";
import { PAGES, wordLimit } from "./pages.js";

// The "Your book" panel on an "A book" page (stage 5, part 2): a list of your
// Bookhive books from all your accounts (public reads), grouped Finished,
// Reading, Want to read, Set aside; pick one and its cover is copied from your
// own account (checked against its record) into the zine. Choosing a book fills
// "Line from your review" with the start of your review, for you to edit.
// Plain DOM, mounted by the Foundry's page editor (the pages input's piece panel).

const lists = new Map(); // did -> Promise<books>
const covers = new Map(); // "uri|cid" -> Promise<files>
const COVER_MAX_SIDE = 1200;
const TIMEOUT_MS = 20000;

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}

function blobUrl(owner, cid) {
  const u = new URL(`${owner.pds}/xrpc/com.atproto.sync.getBlob`);
  u.searchParams.set("did", owner.did);
  u.searchParams.set("cid", cid);
  return u.toString();
}

function booksOf(a) {
  if (!lists.has(a.did)) {
    const owner = { did: a.did, pds: a.pds, handle: a.handle || null };
    const p = listAll(a, BOOKHIVE.collection).then((records) => records.map((r) => bookFromRecord(r, owner)).filter(Boolean));
    p.catch(() => lists.delete(a.did));
    lists.set(a.did, p);
  }
  return lists.get(a.did);
}

/** The book's cover, downloaded from its own account, checked, and made small only if it's big. */
async function coverFiles(book) {
  if (!book.cover) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let bytes;
  try {
    const res = await fetch(blobUrl(book.owner, book.cover.blobCid), { signal: controller.signal });
    if (!res.ok) throw new Error(`the server answered ${res.status}`);
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    if (err && err.name === "AbortError") throw new Error("downloading the cover took too long");
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if ((await rawCid(bytes)) !== book.cover.blobCid) throw new Error("the downloaded cover doesn't match the book's record");
  const type = book.cover.mimeType === "image/png" ? "image/png" : book.cover.mimeType === "image/webp" ? "image/webp" : "image/jpeg";
  const blob = new Blob([bytes], { type });
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error("the cover picture couldn't be opened");
  }
  const width = bitmap.width, height = bitmap.height;
  if (bitmap.close) bitmap.close();
  if (Math.max(width, height) > COVER_MAX_SIDE) {
    const { shrinkPicture } = await import("../../core/pictures.js");
    const made = await shrinkPicture(blob);
    const ext = made.contentType === "image/webp" ? "webp" : "jpg";
    return [{ path: `/cover.${ext}`, bytes: made.bytes, contentType: made.contentType, width: made.width, height: made.height }];
  }
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  return [{ path: `/cover.${ext}`, bytes, contentType: type, width, height }];
}

function coverOf(book) {
  const key = `${book.uri}|${book.cid}`;
  if (!covers.has(key)) {
    const p = coverFiles(book);
    p.catch(() => covers.delete(key));
    covers.set(key, p);
  }
  return covers.get(key);
}

/** What the page keeps about the book (no review text beyond what the creator picks). */
function bookPiece(b) {
  return {
    kind: "book", uri: b.uri, cid: b.cid, did: b.owner.did, own: true, name: b.title,
    book: { title: b.title, authors: b.authors, stars: b.stars, reading: b.reading, startedAt: b.startedAt, finishedAt: b.finishedAt },
    status: "loading", files: [],
  };
}

export function mountBookPanel(root, { getPage, patchPage, values, context }) {
  let page = getPage() || {};
  let lastValues = values;
  let lastContext = context;
  let accounts = null;
  let accountsKey = "";
  let books = null; // all, by uri
  let browsing = false; // the list shown while a book is chosen ("Choose another book")
  let ticket = 0;
  let disposed = false;
  let thumbUrl = null;
  let thumbFor = null;
  let listKey = "";

  const box = el("div", "book-panel");
  root.append(box);
  const status = el("p", "snd-status");
  status.setAttribute("aria-live", "polite");
  const card = el("div", "tile-card book-card");
  const thumb = el("img", "tile-thumb book-thumb");
  thumb.alt = "";
  const about = el("div", "tile-about");
  const title = el("strong", "tile-name");
  const byLine = el("span", "field-help tile-kind");
  const made = el("span", "snd-made tile-made");
  made.setAttribute("aria-live", "polite");
  const again = el("button", "btn btn-quiet btn-small", "Try again");
  again.type = "button";
  const another = el("button", "btn btn-quiet btn-small", "Choose another book");
  another.type = "button";
  about.append(title, byLine, made, another);
  card.append(thumb, about);
  const listHead = el("div", "book-list-head");
  const listTitle = el("span", "book-list-title", "Your Bookhive books");
  const refresh = el("button", "btn btn-quiet btn-small", "Refresh");
  refresh.type = "button";
  listHead.append(listTitle, refresh);
  const list = el("div", "book-list");
  list.setAttribute("role", "list");
  const help = el("p", "field-help", "The cover, title, author, stars and where you are with it come from Bookhive. The line from your review is yours to edit below.");
  box.append(status, card, listHead, list, help);

  const piece = () => (page && page.piece && page.piece.kind === "book" ? page.piece : null);

  function setStatus(text, error = false) {
    status.textContent = text || "";
    status.hidden = !text;
    status.classList.toggle("is-error", error);
  }

  // Which other page already has this book.
  function usedOn(uri) {
    const pages = (lastValues && lastValues.pages) || [];
    for (let i = 0; i < PAGES.length; i++) {
      const p = pages[i];
      if (!p || p.id === page.id || p.layout !== "book" || !p.piece || p.piece.uri !== uri) continue;
      const s = PAGES[i];
      return s.kind === "back" ? "the back" : s.label.toLowerCase();
    }
    return null;
  }

  async function loadList(force = false) {
    if (!accounts) return;
    const mine = ++ticket;
    if (force) for (const a of accounts) lists.delete(a.did);
    setStatus("Looking for your Bookhive books…");
    const results = await Promise.allSettled(accounts.map((a) => booksOf(a)));
    if (mine !== ticket || disposed) return;
    const all = [];
    const failed = [];
    results.forEach((r, i) => (r.status === "fulfilled" ? all.push(...r.value) : failed.push({ a: accounts[i], err: r.reason })));
    books = new Map(all.map((b) => [b.uri, b]));
    listKey = "";
    drawList(all);
    let text = "";
    if (failed.length) text = `${failed.map((f) => nameOf(f.a)).join(", ")}: couldn't be listed (${(failed[0].err && failed[0].err.message) || "unknown problem"}). Press Refresh to try again. `;
    if (!all.length && !failed.length) text = `You haven't added any books on Bookhive from ${accounts.length > 1 ? "your accounts" : "this account"} yet.`;
    setStatus(text.trim(), Boolean(failed.length && !all.length));
    drawCard();
  }

  function drawList(all) {
    list.replaceChildren();
    const several = new Set(all.map((b) => b.owner.did)).size > 1;
    const p = piece();
    for (const g of groupBooks(all)) {
      const head = el("p", "book-group", g.title);
      list.append(head);
      for (const b of g.items) {
        const row = el("button", "book-row");
        row.type = "button";
        row.setAttribute("role", "listitem");
        if (p && p.uri === b.uri) row.classList.add("on");
        const img = el("span", "book-row-cover");
        if (b.cover) {
          const i = el("img");
          i.alt = "";
          i.loading = "lazy";
          i.decoding = "async";
          i.src = blobUrl(b.owner, b.cover.blobCid);
          i.addEventListener("error", () => { i.remove(); img.classList.add("none"); });
          img.append(i);
        } else {
          img.classList.add("none");
        }
        const text = el("span", "book-row-text");
        text.append(el("span", "book-row-title", b.title));
        const sub = [authorsText(b.authors), starsText(b.stars), several ? nameOf(b.owner) : ""].filter(Boolean).join(" · ");
        if (sub) text.append(el("span", "book-row-sub", sub));
        const used = usedOn(b.uri);
        if (used) text.append(el("span", "book-row-used", `On ${used}`));
        row.append(img, text);
        row.setAttribute("aria-label", [b.title, authorsText(b.authors), statusLine(b), used ? `already on ${used}` : ""].filter(Boolean).join(", "));
        row.addEventListener("click", () => choose(b));
        list.append(row);
      }
    }
  }

  function limitFor(pg) {
    const spec = PAGES.find((s) => s.id === pg.id) || PAGES[1];
    return wordLimit(spec, pg, lastValues || {});
  }

  function choose(b) {
    browsing = false;
    const now = getPage() || page;
    const change = { piece: bookPiece(b) };
    // The line from the review: filled in unless the creator has written their own.
    const mineWords = String(now.words || "").trim() && now.words !== now.autoWords;
    if (!mineWords) {
      const line = reviewExcerpt(b.review, Math.floor(limitFor({ ...now, layout: "book" }) * 0.9));
      change.words = line;
      change.autoWords = line;
    }
    patchPage(change);
    copy(b);
  }

  function copy(b) {
    coverOf(b).then(
      (files) => patchPage((pg) => (pg.piece && pg.piece.uri === b.uri && pg.piece.kind === "book" ? { piece: { ...pg.piece, status: "ready", error: undefined, files } } : null)),
      (err) => patchPage((pg) => (pg.piece && pg.piece.uri === b.uri ? { piece: { ...pg.piece, status: "error", error: err.message || String(err) } } : null)),
    );
  }

  refresh.addEventListener("click", () => loadList(true));
  another.addEventListener("click", () => { browsing = !browsing; drawCard(); if (browsing && list.firstChild) list.querySelector(".book-row") && list.querySelector(".book-row").focus(); });
  again.addEventListener("click", () => {
    const p = piece();
    const b = p && books && books.get(p.uri);
    if (!b) { loadList(true); return; }
    patchPage((pg) => (pg.piece ? { piece: { ...pg.piece, status: "loading", error: undefined } } : null));
    copy(b);
  });

  function drawCard() {
    const p = piece();
    const chosen = Boolean(p && p.uri);
    card.hidden = !chosen;
    const showList = !chosen || browsing;
    list.hidden = !showList || !books;
    listHead.hidden = !showList || !accounts;
    another.textContent = browsing ? "Keep this book" : "Choose another book";
    if (!chosen) return;
    const b = p.book || {};
    title.textContent = b.title || p.name || "Untitled book";
    byLine.textContent = [authorsText(b.authors), starsText(b.stars), statusLine(b)].filter(Boolean).join(" · ");
    const copied = Array.isArray(p.files) && p.files[0];
    const listed = books && books.get(p.uri);
    let src = "";
    if (copied) {
      if (thumbFor !== copied.bytes) {
        if (thumbUrl) URL.revokeObjectURL(thumbUrl);
        thumbUrl = URL.createObjectURL(new Blob([copied.bytes], { type: copied.contentType }));
        thumbFor = copied.bytes;
      }
      src = thumbUrl;
    } else if (listed && listed.cover) {
      src = blobUrl(listed.owner, listed.cover.blobCid);
    }
    if (src) { if (thumb.src !== src) thumb.src = src; thumb.hidden = false; } else thumb.hidden = true;
    made.replaceChildren();
    made.classList.remove("is-error");
    if (p.status === "error") {
      made.classList.add("is-error");
      made.append(`Its cover couldn't be copied (${p.error}). `, again);
    } else if (p.status === "ready") {
      made.textContent = copied ? `Ready: its cover is ${formatSize(copied.bytes.length)}.` : "Ready: it has no cover on Bookhive, so one is drawn in your zine's look.";
    } else {
      made.textContent = "Copying its cover…";
    }
  }

  function useAccounts(ctx) {
    const mine = myAccounts(ctx);
    if (mine.state !== "ok") {
      accounts = null;
      accountsKey = "";
      books = null;
      list.replaceChildren();
      setStatus(mine.state === "out" ? "Sign in to pick one of your Bookhive books." : mine.state === "lookup" ? "Your account's details couldn't be looked up, so your books can't be listed yet." : "Looking up your account…");
      drawCard();
      return false;
    }
    if (accounts && accountsKey === mine.key) return true;
    accounts = mine.list;
    accountsKey = mine.key;
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
    if (ok && p && p.uri && p.status === "loading" && books && books.get(p.uri)) copy(books.get(p.uri));
    // Redraw the list only when what it marks changes (the chosen book, books on other pages).
    if (books) {
      const key = [(p && p.uri) || "", ...((lastValues && lastValues.pages) || []).map((q) => (q && q.layout === "book" && q.piece && q.piece.uri) || "")].join("|");
      if (key !== listKey) { listKey = key; drawList([...books.values()]); }
    }
    drawCard();
  }

  update(page, values, context);
  return {
    update,
    dispose() {
      disposed = true;
      if (thumbUrl) URL.revokeObjectURL(thumbUrl);
      box.remove();
    },
  };
}
