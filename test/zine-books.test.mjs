import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bookFromRecord, groupBooks, authorsText, starsText, starsLabel, statusLine, reviewExcerpt, bookCoverPath, bookForReader, bookRecipe,
} from "../src/tile-types/zine/books.js";
import { pieceProblems, pieceFiles } from "../src/tile-types/zine/piece.js";
import { emptyPages, zineConfig, wordLimit, PAGES, LAYOUTS, BOOK_ROOM, BOOK_SPRITE_COST, BOOK_SOUND_COST } from "../src/tile-types/zine/pages.js";
import { makeZineTile, zineRecipe } from "../src/tile-types/zine/tile.js";
import { zine } from "../src/tile-types/zine/index.js";
import { READER_JS, READER_CSS } from "../src/tile-types/zine/runtime/reader.js";

// Zine Scene stage 5, part 2: "A book" pages from Bookhive.

const DID = "did:plc:rqbqpaaluty5v47jwciowpik";
const OWNER = { did: DID, pds: "https://meadow.us-east.host.bsky.network", handle: "pyxorium.com" };
// The owner's live record (Oct 9 2026): reading, a cover, no stars or review.
const NEUROMANCER = {
  uri: `at://${DID}/buzz.bookhive.book/3ld3ic6bwks23`,
  cid: "bafyreineuro",
  value: {
    $type: "buzz.bookhive.book", title: "Neuromancer", hiveId: "bk_Jsi6J0NflynvrYixzz9f", status: "buzz.bookhive.defs#reading", authors: "William Gibson",
    createdAt: "2024-12-12T04:58:22.015Z", hiveBookUri: "at://did:plc:enu2j5xjlqsjaylv3du4myh4/buzz.bookhive.catalogBook/bk_Jsi6J0NflynvrYixzz9f",
    cover: { ref: { $link: "bafkreigensap3tou3allwjszkzlawpej5xaof6w2emd4otxid6vnzwjz2q" }, size: 43277, $type: "blob", mimeType: "image/jpeg" },
  },
};
const finished = (rkey, title, extra = {}) => ({
  uri: `at://${DID}/buzz.bookhive.book/${rkey}`, cid: `bafyrei${rkey}`,
  value: { $type: "buzz.bookhive.book", title, authors: "Ursula K. Le Guin", hiveId: "x", status: "buzz.bookhive.defs#finished", createdAt: "2026-01-01T00:00:00Z", ...extra },
});
const DISPOSSESSED = finished("dis", "The Dispossessed", {
  stars: 9, finishedAt: "2026-10-03T12:00:00Z", startedAt: "2026-09-01T00:00:00Z", authors: "Ursula K. Le Guin",
  review: "A book about walls. Shevek's journey made me rethink what freedom costs. The ending is quiet and perfect, and I keep coming back to it.",
});

test("books: Bookhive records read as books (the owner's live one too)", () => {
  const n = bookFromRecord(NEUROMANCER, OWNER);
  assert.equal(n.title, "Neuromancer");
  assert.deepEqual(n.authors, ["William Gibson"]);
  assert.equal(n.reading, "reading");
  assert.equal(n.stars, null);
  assert.equal(n.review, "");
  assert.deepEqual(n.cover, { blobCid: "bafkreigensap3tou3allwjszkzlawpej5xaof6w2emd4otxid6vnzwjz2q", mimeType: "image/jpeg", size: 43277 });
  const d = bookFromRecord(DISPOSSESSED, OWNER);
  assert.deepEqual([d.reading, d.stars, d.finishedAt], ["finished", 9, "2026-10-03T12:00:00.000Z"]);
  // Several authors are tab separated; odd stars and unknown statuses are dropped.
  const odd = bookFromRecord(finished("odd", "Good Omens", { authors: "Terry Pratchett\tNeil Gaiman", stars: 14, status: "buzz.bookhive.defs#owned" }), OWNER);
  assert.deepEqual(odd.authors, ["Terry Pratchett", "Neil Gaiman"]);
  assert.equal(odd.stars, null);
  assert.equal(odd.reading, null);
  assert.equal(bookFromRecord({ uri: "at://x", value: { title: "  " } }), null);
});

test("books: grouped Finished, Reading, Want to read, Set aside, newest first", () => {
  const books = [
    NEUROMANCER,
    DISPOSSESSED,
    finished("old", "A Wizard of Earthsea", { finishedAt: "2025-03-01T00:00:00Z" }),
    finished("want", "Piranesi", { status: "buzz.bookhive.defs#wantToRead" }),
    finished("drop", "Ulysses", { status: "buzz.bookhive.defs#abandoned" }),
  ].map((r) => bookFromRecord(r, OWNER));
  const groups = groupBooks(books);
  assert.deepEqual(groups.map((g) => g.title), ["Finished", "Reading", "Want to read", "Set aside"]);
  assert.deepEqual(groups[0].items.map((b) => b.title), ["The Dispossessed", "A Wizard of Earthsea"]);
});

test("books: stars, status, authors and the review's first line", () => {
  assert.equal(starsText(9), "★★★★½");
  assert.equal(starsText(10), "★★★★★");
  assert.equal(starsText(1), "½");
  assert.equal(starsLabel(9), "4.5 out of 5 stars");
  assert.equal(starsLabel(2), "1 out of 5 star");
  assert.equal(statusLine(bookFromRecord(DISPOSSESSED)), "Finished October 2026");
  assert.equal(statusLine({ reading: "finished" }), "Finished");
  assert.equal(statusLine({ reading: "reading" }), "Reading now");
  assert.equal(statusLine({ reading: "wantToRead" }), "On my list");
  assert.equal(statusLine({ reading: "abandoned" }), "Set aside");
  assert.equal(statusLine({ reading: null }), "");
  assert.equal(authorsText(["A", "B", "C"]), "A, B and C");
  const review = DISPOSSESSED.value.review;
  assert.equal(reviewExcerpt(review, 500), review);
  assert.equal(reviewExcerpt(review, 90), "A book about walls. Shevek's journey made me rethink what freedom costs.");
  assert.equal(reviewExcerpt("no sentence ends here at all just words and more words", 30), "no sentence ends here at all…");
  assert.equal(reviewExcerpt("Line one.\n\nLine   two.", 100), "Line one. Line two.");
  assert.equal(reviewExcerpt("", 100), "");
});

function bookPage(record, { cover = true, words = "" } = {}) {
  const b = bookFromRecord(record, OWNER);
  return {
    id: "p1", layout: "book", words,
    piece: {
      kind: "book", uri: b.uri, cid: b.cid, did: DID, own: true, name: b.title,
      book: { title: b.title, authors: b.authors, stars: b.stars, reading: b.reading, startedAt: b.startedAt, finishedAt: b.finishedAt },
      status: "ready", files: cover ? [{ path: "/cover.jpg", bytes: new Uint8Array([255, 216, 255, 1]), contentType: "image/jpeg", width: 400, height: 600 }] : [],
    },
  };
}

test("books: a book page in the zine (reader, files, recipe, credits, review summary)", () => {
  assert.ok(LAYOUTS.some((l) => l.value === "book" && l.label === "A book"));
  const pages = emptyPages();
  pages[1] = bookPage(DISPOSSESSED, { words: "Shevek's journey made me rethink what freedom costs." });
  pages[3] = { ...bookPage(NEUROMANCER, { cover: false }), id: "p3" };
  const config = zineConfig({ title: "Books", handle: "pyxorium.com", paper: "letter", pages });
  assert.deepEqual(config.pages[1].book, {
    title: "The Dispossessed", authors: "Ursula K. Le Guin", stars: 9, starsLabel: "4.5 out of 5 stars", status: "Finished October 2026",
    cover: { src: "/books/p1.jpg", width: 400, height: 600 },
  });
  assert.equal(config.pages[1].words, "Shevek's journey made me rethink what freedom costs.");
  assert.deepEqual(config.pages[3].book, { title: "Neuromancer", authors: "William Gibson", status: "Reading now" }); // drawn cover
  assert.deepEqual(config.credits, [{ what: "Books", app: "Bookhive", href: "https://bookhive.buzz/", pages: "pages 1 and 3" }]);
  const tile = makeZineTile({ name: "Books", handle: "pyxorium.com", pages });
  assert.deepEqual(tile.files.filter((f) => f.path.startsWith("/books/")).map((f) => f.path), ["/books/p1.jpg"]);
  const recipe = zineRecipe({ paper: "letter", look: "clean", pages });
  assert.deepEqual(recipe.pages[1].book, { kind: "book", uri: DISPOSSESSED.uri, cid: DISPOSSESSED.cid, title: "The Dispossessed", cover: "/books/p1.jpg" });
  assert.equal(recipe.pages[1].words, "Shevek's journey made me rethink what freedom costs.");
  assert.equal(JSON.stringify(recipe).includes("autoWords"), false);
  assert.match(zine.reviewSummary({ pages }), /2 books/);
  assert.equal(bookCoverPath("p2", "image/png"), "/books/p2.png");
  assert.equal(pieceFiles(pages[3], "p3").length, 0);
  assert.deepEqual(bookRecipe(pages[3], "p3"), { kind: "book", uri: NEUROMANCER.uri, cid: NEUROMANCER.cid, title: "Neuromancer" });
  assert.equal(bookForReader({ piece: { ...pages[1].piece, status: "loading" } }, "p1"), null);
  // The reader draws it, and its styles keep to the tile's own files.
  assert.match(READER_JS, /function bookBlock/);
  assert.match(READER_CSS, /\.dcover/);
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(READER_CSS));
});

test("books: problems while choosing, and the review line's room", () => {
  const spec = PAGES[1];
  assert.deepEqual(pieceProblems({ layout: "book" }, spec), ["Page 1: choose one of your books, or pick another layout."]);
  const p = bookPage(DISPOSSESSED);
  assert.deepEqual(pieceProblems({ ...p, piece: { ...p.piece, status: "loading" } }, spec), ["Page 1: the book is still being copied."]);
  assert.match(pieceProblems({ ...p, piece: { ...p.piece, status: "error", error: "the server answered 500" } }, spec)[0], /couldn't be copied \(the server answered 500\)/);
  assert.deepEqual(pieceProblems(p, spec), []);
  const sprite = { bytes: new Uint8Array([1]), geometry: { frameWidth: 48, frameHeight: 48, columns: 3, rows: 4 } };
  assert.equal(wordLimit(spec, { layout: "book" }, { paper: "letter" }), BOOK_ROOM.letter.page);
  assert.equal(wordLimit(PAGES[7], { layout: "book" }, { paper: "a4" }), BOOK_ROOM.a4.back);
  assert.equal(wordLimit(spec, { layout: "book", sprite: true, sound: true }, { paper: "letter", sprite }), BOOK_ROOM.letter.page - BOOK_SPRITE_COST - BOOK_SOUND_COST);
});
