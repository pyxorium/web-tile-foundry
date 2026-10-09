// "A book" pages (Zine Scene stage 5, part 2): one of the creator's Bookhive
// books, with its cover (copied from their own account), title, author, stars,
// where they are with it, and a line from their review that they choose.
// No DOM here, so the tests can use it; the panel that picks a book is bookpanel.js.
//
// buzz.bookhive.book (Bookhive's lexicon, checked Oct 9 2026):
//   title, authors (tab separated), hiveId, createdAt, startedAt?, finishedAt?,
//   cover? (blob, PNG or JPEG, up to 1 MB), status? (buzz.bookhive.defs#finished |
//   #reading | #wantToRead | #abandoned), stars? (1 to 10, shown as 1 to 5 with
//   halves), review? (up to 15,000 graphemes), hiveBookUri (Bookhive's catalogue).
//
// A page with the "A book" layout keeps its book in page.piece:
//   { kind: "book", uri, cid, did, own, name,
//     book: { title, authors: [..], stars, reading, startedAt, finishedAt, review },
//     status: "loading" | "ready" | "error", error?,
//     files: [{ path: "/cover.jpg" | "/cover.png" | "/cover.webp", bytes, contentType, width, height }] }
// (files is empty for a book with no cover; the reader draws one.) The line from
// the review is the page's words, filled in when the book is chosen (autoWords
// remembers what was filled in, so choosing another book replaces it unless edited).

export const BOOKHIVE = Object.freeze({
  app: "Bookhive",
  collection: "buzz.bookhive.book",
  home: "https://bookhive.buzz/",
});

export const BOOK_TITLE_MAX = 200;
export const BOOK_AUTHORS_MAX = 160;

/** Where you are with a book, in the order the list groups them. */
export const READING = Object.freeze([
  { id: "finished", group: "Finished" },
  { id: "reading", group: "Reading" },
  { id: "wantToRead", group: "Want to read" },
  { id: "abandoned", group: "Set aside" },
]);

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function oneLine(s, max) {
  return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function readingOf(status) {
  const m = /#(finished|reading|wantToRead|abandoned)$/.exec(String(status || ""));
  return m ? m[1] : null;
}

function dateOf(s) {
  const t = Date.parse(String(s || ""));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** One buzz.bookhive.book record as a book, or null. */
export function bookFromRecord(record, owner = null) {
  const v = record && record.value;
  if (!v || typeof v !== "object") return null;
  const title = oneLine(v.title, BOOK_TITLE_MAX);
  if (!title) return null;
  const authors = String(v.authors || "").split("\t").map((a) => oneLine(a, 120)).filter(Boolean).slice(0, 8);
  const stars = Number.isInteger(v.stars) && v.stars >= 1 && v.stars <= 10 ? v.stars : null;
  const c = v.cover;
  const coverCid = c && c.ref && typeof c.ref.$link === "string" ? c.ref.$link : null;
  const mime = String((c && c.mimeType) || "").toLowerCase();
  return {
    uri: String(record.uri || ""),
    cid: String(record.cid || ""),
    title,
    authors,
    stars,
    reading: readingOf(v.status),
    startedAt: dateOf(v.startedAt),
    finishedAt: dateOf(v.finishedAt),
    createdAt: dateOf(v.createdAt) || "",
    review: typeof v.review === "string" ? v.review.slice(0, 20000) : "",
    cover: coverCid && (!mime || ["image/jpeg", "image/png", "image/webp"].includes(mime)) ? { blobCid: coverCid, mimeType: mime || "image/jpeg", size: Number(c.size) || 0 } : null,
    owner,
  };
}

/** Newest first, by when it was finished (else started, else added). */
function when(b) {
  return b.finishedAt || b.startedAt || b.createdAt || "";
}

/** Books grouped Finished, Reading, Want to read, Set aside (then any others), newest first. */
export function groupBooks(books) {
  const groups = [];
  for (const r of READING) {
    const items = books.filter((b) => b.reading === r.id).sort((a, b) => when(b).localeCompare(when(a)));
    if (items.length) groups.push({ key: r.id, title: r.group, items });
  }
  const rest = books.filter((b) => !READING.some((r) => r.id === b.reading)).sort((a, b) => when(b).localeCompare(when(a)));
  if (rest.length) groups.push({ key: "other", title: "Other books", items: rest });
  return groups;
}

/** "Ursula K. Le Guin", "A and B", "A, B and C". */
export function authorsText(authors) {
  const a = (authors || []).filter(Boolean);
  if (a.length <= 1) return a[0] || "";
  return `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;
}

/** Stars as five, with a half: 9 → "★★★★½" (for the panel's list). */
export function starsText(stars) {
  if (!stars) return "";
  const full = Math.floor(stars / 2);
  return "★".repeat(full) + (stars % 2 ? "½" : "");
}

/** "4.5 out of 5 stars" (for screen readers). */
export function starsLabel(stars) {
  if (!stars) return "";
  const n = stars / 2;
  return `${Number.isInteger(n) ? n : n.toFixed(1)} out of 5 star${n === 1 ? "" : "s"}`;
}

/** "Finished October 2026", "Reading now", "On my list", "Set aside", or "". */
export function statusLine(book) {
  if (!book) return "";
  const month = (iso) => {
    const d = iso ? new Date(iso) : null;
    return d && Number.isFinite(d.getTime()) ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : "";
  };
  if (book.reading === "finished") return oneLine(`Finished ${month(book.finishedAt)}`, 40);
  if (book.reading === "reading") return "Reading now";
  if (book.reading === "wantToRead") return "On my list";
  if (book.reading === "abandoned") return "Set aside";
  return "";
}

/**
 * The start of a review, as one paragraph, within `limit` characters: cut at
 * the last sentence end that fits; failing that, at a word, with "…".
 */
export function reviewExcerpt(review, limit) {
  const text = String(review || "").replace(/\s+/g, " ").trim();
  if (!text || limit <= 0) return "";
  if (text.length <= limit) return text;
  const head = text.slice(0, limit);
  const ends = [...head.matchAll(/[.!?…]["”’)]?(?=\s|$)/g)];
  const last = ends.length ? ends[ends.length - 1] : null;
  if (last && last.index + last[0].length >= Math.min(40, limit / 3)) return head.slice(0, last.index + last[0].length).trim();
  const cut = head.slice(0, Math.max(0, limit - 1)).replace(/\s+\S*$/, "").replace(/[,;:\s]+$/, "");
  return cut ? `${cut}…` : "";
}

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Where a page's book cover goes in the zine. */
export function bookCoverPath(pageId, contentType) {
  return `/books/${pageId}.${EXT[contentType] || "jpg"}`;
}

/** A book piece is ready to build. */
export function bookReady(piece) {
  return Boolean(piece && piece.kind === "book" && piece.status === "ready" && piece.book && piece.book.title && Array.isArray(piece.files));
}

/** The book's cover file in the piece (null when it has none). */
export function bookCover(piece) {
  return (piece && Array.isArray(piece.files) && piece.files.find((f) => /^\/cover\.(jpg|png|webp)$/.test(f.path) && f.bytes)) || null;
}

/** The book's files as they go into the zine (its cover, if any). */
export function bookFiles(piece, pageId) {
  const c = bookReady(piece) && bookCover(piece);
  return c ? [{ path: bookCoverPath(pageId, c.contentType), bytes: c.bytes, contentType: c.contentType }] : [];
}

/**
 * A page's book as the reader gets it, or null. `src(path)` gives the address
 * the reader loads the cover from (in the zine, or in the Foundry preview).
 *   { title, authors, stars?, starsLabel?, status?, cover?: { src, width, height } }
 */
export function bookForReader(page, pageId, src = null) {
  const p = page && page.piece;
  if (!bookReady(p)) return null;
  const b = p.book;
  const out = { title: oneLine(b.title, BOOK_TITLE_MAX), authors: oneLine(authorsText(b.authors), BOOK_AUTHORS_MAX) };
  if (b.stars) { out.stars = b.stars; out.starsLabel = starsLabel(b.stars); }
  const s = statusLine(b);
  if (s) out.status = s;
  const c = bookCover(p);
  if (c) out.cover = { src: src ? src(c.path) : bookCoverPath(pageId, c.contentType), width: c.width || 0, height: c.height || 0 };
  return out;
}

/** A page's book in the zine's public recipe: the record it came from, and where its cover went. */
export function bookRecipe(page, pageId) {
  const p = page && page.piece;
  if (!bookReady(p)) return null;
  const out = { kind: "book", uri: p.uri, cid: p.cid, title: oneLine(p.book.title, BOOK_TITLE_MAX) };
  const c = bookCover(p);
  if (c) out.cover = bookCoverPath(pageId, c.contentType);
  return out;
}
