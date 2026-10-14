import { test } from "node:test";
import assert from "node:assert/strict";
import { checkInputs, pageProblems, pagesBytes, isShown } from "../src/core/contract.js";
import { buildTile } from "../src/core/build.js";
import { zine } from "../src/tile-types/zine/index.js";
import {
  PAGES, PAGE_COUNTS, PAGE_COUNT_OPTIONS, emptyPages, pageCountOf, pagesFor, pageInUse, pagesInUse, asideNote, zineConfig,
} from "../src/tile-types/zine/pages.js";
import { makeZineTile, defaultDescription } from "../src/tile-types/zine/tile.js";
import { chooseLayout, viewsFor } from "../src/tile-types/zine/runtime/reader.js";
import { clipFromSong } from "../src/tile-types/zine/sound.js";

// Zine Scene, stage 6, part 1: 2, 4 or 8 pages (owner, Oct 11).
// 4 = cover, pages 1 and 2, back; 2 = cover and back. Pages a shorter zine
// doesn't use are put aside: kept in the panel, never published.

const pic = (w = 1200, h = 800) => ({ bytes: new Uint8Array([1, 2, 3, 4]), contentType: "image/webp", width: w, height: h, alt: "" });
const pagesInput = zine.inputs.find((i) => i.kind === "pages");
const countInput = zine.inputs.find((i) => i.key === "pageCount");
const ids = (specs) => specs.map((s) => s.id);
const at = (pages, id) => pages[PAGES.findIndex((p) => p.id === id)];

/** Every page filled with a picture and a heading. */
function full(pageCount) {
  const pages = emptyPages();
  pages.forEach((p, i) => {
    p.picture = pic();
    if (i > 0) p.heading = `Heading ${i}`;
  });
  return { name: "Late Summer", paper: "letter", pageCount, pages, description: "", handle: "pyxorium.com" };
}

test("page counts: 8 by default, 4 keeps cover, 1, 2, back; 2 keeps cover and back", () => {
  assert.deepEqual(PAGE_COUNTS, [8, 4, 2]);
  // The panel offers 8 and 4 (owner, Oct 12); 2 is set aside but still read.
  assert.deepEqual(PAGE_COUNT_OPTIONS.map((o) => o.value), [8, 4]);
  assert.equal(pageCountOf(undefined), 8);
  assert.equal(pageCountOf("4"), 4);
  assert.equal(pageCountOf(6), 8);
  assert.deepEqual(ids(pagesFor(8)), ids(PAGES));
  assert.deepEqual(ids(pagesFor(4)), ["cover", "p1", "p2", "back"]);
  assert.deepEqual(ids(pagesFor(2)), ["cover", "back"]);
  assert.ok(pageInUse(PAGES[3], { pageCount: 8 }));
  assert.ok(!pageInUse(PAGES[3], { pageCount: 4 }));
  assert.ok(pageInUse("back", { pageCount: 2 }));
  // The panel's values keep all eight; pagesInUse picks the ones in use, in order.
  const pages = emptyPages();
  assert.deepEqual(pagesInUse(pages, 4).map((p) => p.id), ["cover", "p1", "p2", "back"]);
  // The choice: three buttons, with Paper and Look; a zine made before (no count) still builds.
  const keys = zine.inputs.map((i) => i.key);
  assert.ok(keys.indexOf("pageCount") === keys.indexOf("paper") + 1);
  // v0.31.0: a "Pages: 8 ▾" pill beside "Paper: Letter ▾".
  assert.deepEqual(countInput.options.map((o) => o.label), ["8", "4"]);
  assert.equal(countInput.label, "Pages");
  assert.equal(countInput.display, "menu");
  assert.equal(zine.defaults({}).pageCount, 8);
  assert.deepEqual(checkInputs(zine, { ...full(undefined) }), []);
});

test("the line under the choice names the put-aside pages and the count that brings them back", () => {
  const v = full(4);
  assert.equal(asideNote(v), "Pages 3 to 6 are put aside, not published. Switch back to 8 to get them back.");
  const one = { ...full(4), pages: emptyPages() };
  at(one.pages, "p4").words = "Kept for later.";
  assert.equal(asideNote(one), "Page 4 is put aside, not published. Switch back to 8 to get it back.");
  const two = { ...full(2), pages: emptyPages() };
  at(two.pages, "p1").sound = true;
  assert.equal(asideNote(two), "Page 1 is put aside, not published. Switch back to 4 to get it back.");
  at(two.pages, "p5").marks = [{ t: "s", id: "star", x: 10, y: 10, s: 1, r: 0 }];
  assert.equal(asideNote(two), "Pages 1 and 5 are put aside, not published. Switch back to 8 to get them back.");
  // Nothing aside, or nothing on the put-aside pages: no line.
  assert.equal(asideNote(full(8)), null);
  assert.equal(asideNote({ ...full(4), pages: emptyPages() }), null);
  assert.equal(countInput.note(v), asideNote(v));
});

test("put-aside pages aren't checked or counted", () => {
  const v = full(4);
  at(v.pages, "p5").layout = "words";
  at(v.pages, "p5").words = "x".repeat(5000); // far too many words
  at(v.pages, "p6").layout = "poster"; // unknown layout
  assert.deepEqual(pageProblems(pagesInput, v.pages, v), []);
  assert.deepEqual(checkInputs(zine, v), []);
  assert.equal(pagesBytes(pagesInput, v.pages, v), 4 * 4);
  assert.equal(pagesBytes(pagesInput, v.pages, { ...v, pageCount: 8 }), 7 * 4); // page 5's picture is hidden by its Words layout
  // Switching back to 8 brings their problems back with them.
  assert.ok(pageProblems(pagesInput, v.pages, { ...v, pageCount: 8 }).length >= 2);
  // A sound only on a put-aside page doesn't ask for the plyr.fm confirmation.
  const rights = zine.inputs.find((i) => i.key === "soundRights");
  at(v.pages, "p3").sound = true;
  assert.ok(!isShown(rights, v));
  assert.ok(isShown(rights, { ...v, pageCount: 8 }));
});

test("a 4-page zine is built from its four pages only", async () => {
  const v = full(4);
  const tile = makeZineTile({ ...v, made: "October 2026" });
  const paths = tile.files.map((f) => f.path).sort();
  assert.deepEqual(paths, ["/", "/pictures/back.webp", "/pictures/cover.webp", "/pictures/p1.webp", "/pictures/p2.webp"]);
  assert.equal(tile.description, "“Late Summer”, a little zine by @pyxorium.com, four pages to flip through.");
  assert.equal(tile.recipeInputs.pageCount, 4);
  assert.deepEqual(tile.recipeInputs.pages.map((p) => p.id), ["cover", "p1", "p2", "back"]);
  assert.ok(!JSON.stringify(tile.recipeInputs).includes("Heading 3"));
  const html = new TextDecoder().decode(tile.files.find((f) => f.path === "/").bytes);
  assert.ok(html.includes('"pageCount":4'));
  assert.ok(!html.includes("Heading 3"));
  // Through the Foundry: the recipe carries the count.
  const built = await buildTile(zine, v, { final: false });
  const recipe = JSON.parse(new TextDecoder().decode(built.files.find((f) => f.path === "/foundry.json").bytes));
  assert.equal(recipe.inputs.pageCount, 4);
  assert.equal(zine.reviewSummary(v), "4 pages · 4 pictures");
});

test("a 2-page zine: front and back; switching back to 8 restores the rest", () => {
  const v = full(2);
  const tile = makeZineTile({ ...v, made: "October 2026" });
  assert.deepEqual(tile.files.map((f) => f.path).sort(), ["/", "/pictures/back.webp", "/pictures/cover.webp"]);
  assert.equal(tile.description, "“Late Summer”, a little zine by @pyxorium.com, front and back.");
  assert.equal(zine.reviewSummary(v), "2 pages · 2 pictures");
  const c = zineConfig({ title: v.name, handle: v.handle, paper: "letter", pages: v.pages, pageCount: 2 });
  assert.deepEqual(c.pages.map((p) => [p.id, p.kind]), [["cover", "cover"], ["back", "back"]]);
  // The same values with 8 pages: everything comes back, nothing was lost.
  const all = makeZineTile({ ...v, pageCount: 8, made: "October 2026" });
  assert.equal(all.files.filter((f) => f.path.startsWith("/pictures/")).length, 8);
  assert.equal(all.description, "“Late Summer”, a little zine by @pyxorium.com, eight pages to flip through.");
  assert.equal(defaultDescription("x", "", undefined), "“x”, a little zine, eight pages to flip through.");
});

test("credits name only the pages in use", () => {
  const v = full(2);
  const song = { uri: "at://did:plc:x/fm.plyr.track/3m", cid: "bafy", title: "Drop Top", album: "", artist: "", seconds: 100, blob: { cid: "bafk" } };
  const clip = { ...clipFromSong(song), start: 0, end: 10, status: "ready", bytes: new Uint8Array(10), seconds: 10, made: { start: 0, end: 10 } };
  for (const id of ["cover", "p3", "back"]) Object.assign(at(v.pages, id), { sound: true, clip });
  const c = zineConfig({ title: v.name, handle: v.handle, paper: "letter", pages: v.pages, pageCount: 2 });
  assert.deepEqual(c.credits.map((x) => [x.app, x.pages]), [["plyr.fm", "the cover and the back"]]);
});

test("the reader: 4 pages open as cover, 1–2, back; 2 pages flip like a card, never a spread", () => {
  assert.deepEqual(viewsFor("spread", 4), [[null, 0], [1, 2], [3, null]]);
  assert.equal(chooseLayout(1408, 480, "letter", 4).mode, "spread");
  assert.equal(chooseLayout(1408, 480, "letter", 2).mode, "single");
  assert.equal(chooseLayout(1280, 900, "a4", 2).mode, "single");
  assert.equal(chooseLayout(220, 180, "letter", 2).mode, "card");
  // Where an 8-page zine opens as a spread, a 2-page one shows one side at full height.
  assert.equal(chooseLayout(1000, 700, "letter", 8).mode, "spread");
  assert.equal(chooseLayout(1000, 700, "letter", 2).mode, "single");
});
