import { test } from "node:test";
import assert from "node:assert/strict";
import { checkTileType, checkInputs, pageProblems, pageShows, pageFullness, PAGE_FIELDS } from "../src/core/contract.js";
import { contentTypeFor } from "../src/core/fileset.js";
import { readCspMeta, TILE_CSP } from "../src/core/policy.js";
import { fitSize, pictureFileProblem } from "../src/core/pictures.js";
import { buildTile } from "../src/core/build.js";
import { zine } from "../src/tile-types/zine/index.js";
import {
  PAGES, LAYOUTS, emptyPages, wordLimit, wordSize, paperForLocale, picturePath, zinePages, zineConfig, cleanText, madeLabel, WORD_LIMITS,
} from "../src/tile-types/zine/pages.js";
import { makeZineTile, defaultDescription, zineRecipe } from "../src/tile-types/zine/tile.js";
import { renderZineHtml } from "../src/tile-types/zine/runtime/template.js";
import { chooseLayout, viewsFor, READER_JS, PAGE_SIZES } from "../src/tile-types/zine/runtime/reader.js";

// Zine Scene, stage 1.

const pic = (w = 1200, h = 800, type = "image/webp") => ({ bytes: new Uint8Array([1, 2, 3, 4]), contentType: type, width: w, height: h, alt: "" });
const pagesInput = zine.inputs.find((i) => i.kind === "pages");

function sample() {
  const pages = emptyPages();
  pages[0].picture = pic(900, 1200);
  pages[0].subtitle = "Autumn issue";
  pages[1].heading = "How it started";
  pages[1].words = "We started in a garage.\n\nNobody could play yet.";
  pages[1].picture = pic();
  pages[2].layout = "words";
  pages[2].words = "The first gig.";
  pages[3].layout = "picture";
  pages[3].picture = pic(800, 800, "image/jpeg");
  pages[3].words = "hidden: not shown with the Picture layout";
  return { name: "Garage Days", paper: "letter", pages, description: "", handle: "pyxorium.com" };
}

test("the zine type follows the contract", () => {
  checkTileType(zine);
  assert.equal(zine.id, "zine");
  assert.equal(zine.maxBytes, 20 * 1024 * 1024);
});

test("pages: cover, 1 to 6, back; layouts show the right fields", () => {
  assert.deepEqual(PAGES.map((p) => p.id), ["cover", "p1", "p2", "p3", "p4", "p5", "p6", "back"]);
  assert.deepEqual(pageShows(pagesInput, PAGES[0], {}), ["picture", "subtitle"]);
  assert.deepEqual(pageShows(pagesInput, PAGES[1], { layout: "picture" }), ["picture"]);
  assert.deepEqual(pageShows(pagesInput, PAGES[1], { layout: "words" }), ["heading", "words"]);
  for (const l of LAYOUTS) assert.ok(l.shows.every((f) => PAGE_FIELDS.includes(f)));
});

test("a pages input is checked: missing pages, bad layout, unready picture", () => {
  assert.deepEqual(pageProblems(pagesInput, null), ["The pages are missing."]);
  const pages = emptyPages();
  pages[2].layout = "poster";
  pages[1].picture = { bytes: new Uint8Array(0), contentType: "image/webp", width: 1, height: 1 };
  const out = pageProblems(pagesInput, pages, { paper: "letter" });
  assert.ok(out.some((m) => /Page 2 has an unknown layout/.test(m)), out.join(" | "));
  assert.ok(out.some((m) => /Page 1: the picture isn't ready/.test(m)), out.join(" | "));
  // A picture on a page whose layout doesn't show pictures is simply ignored.
  const ok = emptyPages();
  ok[1].layout = "words";
  ok[1].picture = { bytes: new Uint8Array(0) };
  assert.deepEqual(pageProblems(pagesInput, ok, {}), []);
});

test("too many words: measured with line breaks, and the message fits the layout", () => {
  assert.equal(wordSize("abc"), 3);
  assert.equal(wordSize("a\nb\n\nc"), 6 + 3 * 20);
  const pages = emptyPages();
  pages[1].words = "x".repeat(WORD_LIMITS.letter.both.page[0] + 1);
  pages[2].layout = "words";
  pages[2].words = "x".repeat(WORD_LIMITS.letter.words.page[0] + 1);
  const out = pageProblems(pagesInput, pages, { paper: "letter" });
  assert.ok(out.some((m) => /^Too many words for page 1 .*without a picture\.$/.test(m)), out.join(" | "));
  assert.ok(out.some((m) => /^Too many words for page 2 .*Shorten them\.$/.test(m)), out.join(" | "));
  assert.equal(pageFullness(pagesInput, PAGES[1], { layout: "both", words: "" }, {}), 0);
  assert.equal(pageFullness(pagesInput, PAGES[2], { layout: "words", words: "x".repeat(WORD_LIMITS.letter.words.page[0]) }, { paper: "letter" }), 100);
});

test("word limits: a heading, the back's footer and A4 each leave less room", () => {
  const p = PAGES[1], back = PAGES[7];
  for (const paper of ["letter", "a4"]) {
    for (const layout of ["both", "words"]) {
      const plain = wordLimit(p, { layout }, { paper });
      assert.ok(wordLimit(p, { layout, heading: "Hi" }, { paper }) < plain);
      assert.ok(wordLimit(back, { layout }, { paper }) < plain);
    }
    assert.ok(wordLimit(p, { layout: "both" }, { paper }) < wordLimit(p, { layout: "words" }, { paper }));
  }
  assert.ok(wordLimit(p, { layout: "words" }, { paper: "a4" }) < wordLimit(p, { layout: "words" }, { paper: "letter" }));
});

test("paper follows the region: Letter in the US and Canada, A4 elsewhere", () => {
  assert.equal(paperForLocale("en-US"), "letter");
  assert.equal(paperForLocale("fr-CA"), "letter");
  assert.equal(paperForLocale("en-GB"), "a4");
  assert.equal(paperForLocale("de-DE"), "a4");
  assert.equal(paperForLocale("en"), "a4");
  assert.equal(PAGE_SIZES.letter.h / PAGE_SIZES.letter.w > PAGE_SIZES.a4.h / PAGE_SIZES.a4.w, true);
});

test("defaults: titled after the handle, all eight pages empty, description left to the default", () => {
  const d = zine.defaults({ handle: "pyxorium.com" });
  assert.equal(d.name, "@pyxorium.com's zine");
  assert.equal(d.handle, "pyxorium.com");
  assert.equal(d.pages.length, 8);
  assert.equal(d.description, "");
  assert.deepEqual(checkInputs(zine, d), []);
});

test("the tile: page, pictures by page, recipe without hidden content", () => {
  const v = sample();
  const t = makeZineTile({ ...v, made: "October 2026" });
  assert.deepEqual(t.files.map((f) => f.path), ["/", "/pictures/cover.webp", "/pictures/p1.webp", "/pictures/p3.jpg"]);
  assert.equal(contentTypeFor("/pictures/p3.jpg"), "image/jpeg");
  assert.equal(t.name, "Garage Days");
  assert.equal(t.description, defaultDescription("Garage Days", "pyxorium.com"));
  assert.match(t.description, /Garage Days.*@pyxorium\.com/);
  const html = new TextDecoder().decode(t.files[0].bytes);
  assert.equal(readCspMeta(html), TILE_CSP);
  assert.doesNotMatch(html, /src="https?:/i);
  assert.doesNotMatch(html, /\son[a-z]+=/i);
  const r = t.recipeInputs;
  assert.equal(r.paper, "letter");
  assert.equal(r.look, "clean");
  assert.equal(r.pages.length, 8);
  assert.deepEqual(r.pages[3], { id: "p3", layout: "picture", picture: { path: "/pictures/p3.jpg", width: 800, height: 800 } });
  assert.equal(r.pages[1].words, "We started in a garage.\n\nNobody could play yet.");
  assert.ok(!JSON.stringify(r).includes("hidden"));
  assert.equal(zineRecipe({ paper: "a4", pages: v.pages }).paper, "a4");
});

test("the reader's config is in the page, safe inside the script element", () => {
  const v = sample();
  v.name = "A </script><b>zine</b>";
  v.pages[2].words = "line   break </script>";
  const t = makeZineTile({ ...v, made: "October 2026" });
  const html = new TextDecoder().decode(t.files[0].bytes);
  assert.ok(html.includes("<title>A &lt;/script&gt;&lt;b&gt;zine&lt;/b&gt;</title>"));
  const json = /<script type="application\/json" id="zine-config">([\s\S]*?)<\/script>/.exec(html)[1];
  assert.ok(!json.includes("</script"));
  const config = JSON.parse(json);
  assert.equal(config.title, "A </script><b>zine</b>");
  assert.equal(config.handle, "pyxorium.com");
  assert.equal(config.made, "October 2026");
  assert.equal(config.makeUrl, "https://foundry.thunderbird.cafe/");
  assert.equal(config.pages[3].words, undefined);
  assert.equal(config.pages[3].picture.src, "/pictures/p3.jpg");
  assert.ok(!config.preview);
  // The reader program parses.
  assert.doesNotThrow(() => new Function(READER_JS));
});

test("text is cleaned: line endings, control characters, extra blank lines, length", () => {
  assert.equal(cleanText("a\r\nb\r\rc\u0007  \n\n\n\nd  "), "a\nb\n\nc\n\nd");
  assert.equal(cleanText("abcdef", 3), "abc");
  assert.equal(madeLabel(new Date(2026, 9, 7)), "October 2026");
});

test("reader layouts: card when tiny, spread when two pages fit well, else one page", () => {
  assert.equal(chooseLayout(220, 180).mode, "card");
  assert.equal(chooseLayout(400, 520).mode, "single");
  assert.equal(chooseLayout(390, 800).mode, "single");
  assert.equal(chooseLayout(720, 520).mode, "spread");
  assert.equal(chooseLayout(1408, 480).mode, "spread");
  assert.equal(chooseLayout(1280, 900).mode, "spread");
  assert.equal(chooseLayout(600, 900).mode, "single");
  assert.deepEqual(viewsFor("spread", 8), [[null, 0], [1, 2], [3, 4], [5, 6], [7, null]]);
  assert.deepEqual(viewsFor("single", 3), [[0], [1], [2]]);
  // The reader page carries the same rule (it runs on its own, without this module).
  for (const n of ["width < 260 || height < 230", "spread * h >= 300 && spread >= 0.85 * single", "single * h < 200"]) assert.ok(READER_JS.includes(n), n);
});

test("pictures: sizes, refused files", () => {
  assert.deepEqual(fitSize(4000, 3000), { width: 1200, height: 900 });
  assert.deepEqual(fitSize(600, 400), { width: 600, height: 400 });
  assert.deepEqual(fitSize(3000, 4000, 1000), { width: 750, height: 1000 });
  assert.match(pictureFileProblem({ type: "image/heic", name: "IMG_1.HEIC", size: 1 }), /HEIC/);
  assert.match(pictureFileProblem({ type: "", name: "x.heif", size: 1 }), /HEIC/);
  assert.match(pictureFileProblem({ type: "application/pdf", name: "x.pdf", size: 1 }), /JPEG, PNG or WebP/);
  assert.match(pictureFileProblem({ type: "image/jpeg", name: "x.jpg", size: 50 * 1024 * 1024 }), /very large/);
  assert.equal(pictureFileProblem({ type: "image/jpeg", name: "x.jpg", size: 1000 }), null);
  assert.throws(() => picturePath({ id: "p1", picture: { contentType: "image/png" } }), /unknown type/);
});

test("the Foundry builds a zine (without card art while editing)", async () => {
  const result = await buildTile(zine, sample(), { final: false });
  assert.equal(result.typeId, "zine");
  assert.ok(result.files.some((f) => f.path === "/foundry.json"));
  assert.deepEqual(result.icons, []);
  const recipe = JSON.parse(new TextDecoder().decode(result.files.find((f) => f.path === "/foundry.json").bytes));
  assert.equal(recipe.inputs.paper, "letter");
});

test("the size limit stops a zine that is too big", async () => {
  const v = sample();
  v.pages[1].picture = { ...pic(), bytes: new Uint8Array(21 * 1024 * 1024) };
  await assert.rejects(buildTile(zine, v, { final: false }), /up to 20/);
});

test("preview config: data addresses and the preview flag", () => {
  const v = sample();
  const c = zineConfig({ title: v.name, handle: v.handle, paper: "a4", pages: v.pages, src: () => "data:image/webp;base64,AA==", preview: true });
  assert.equal(c.preview, true);
  assert.equal(c.paper, "a4");
  assert.equal(c.pages[0].picture.src, "data:image/webp;base64,AA==");
  assert.equal(zinePages(v.pages)[1].heading, "How it started");
  const html = renderZineHtml({ title: "x", config: c });
  assert.ok(html.includes('"preview":true'));
});

// Stage 2: looks.
import { LOOKS, RISO_INKS, LOOK_OPTIONS, INK_OPTIONS, lookOf, inkOf, lookColors, textInk, contrast, RISO_PAPER } from "../src/tile-types/zine/looks.js";
import { RISO_CURVES, READER_CSS } from "../src/tile-types/zine/runtime/reader.js";
import { curveAt, risoPixel, tonerGrey, artStyle } from "../src/tile-types/zine/art.js";

test("looks: four looks, six ink pairs, pictures for every choice", () => {
  assert.deepEqual(LOOKS.map((l) => l.value), ["clean", "photocopy", "collage", "riso"]);
  assert.equal(RISO_INKS.length, 6);
  for (const o of [...LOOK_OPTIONS, ...INK_OPTIONS]) assert.match(o.image, /^data:image\/svg\+xml,/);
  const look = zine.inputs.find((i) => i.key === "look");
  const ink = zine.inputs.find((i) => i.key === "ink");
  assert.equal(look.display, "swatches");
  assert.equal(ink.showIf({ look: "riso" }), true);
  assert.equal(ink.showIf({ look: "collage" }), false);
  assert.equal(zine.defaults({}).look, "clean");
  assert.equal(lookOf("poster"), "clean");
  assert.equal(inkOf("nope").value, "blue-pink");
});

test("riso text is always readable (4.5:1 or better on the paper)", () => {
  for (const pair of RISO_INKS) {
    const c = lookColors("riso", pair.value);
    assert.ok(contrast(c.text, RISO_PAPER) >= 4.5, `${pair.label}: ${contrast(c.text, RISO_PAPER).toFixed(2)}`);
    assert.equal(c.a, pair.a);
    assert.equal(c.b, pair.b);
  }
  assert.equal(textInk("#000000"), "#000000");
  assert.equal(lookColors("clean", "blue-pink"), null);
});

test("the look and inks reach the zine: config, recipe, page styles", () => {
  const v = sample();
  const riso = makeZineTile({ ...v, look: "riso", ink: "teal-orange", made: "x" });
  const html = new TextDecoder().decode(riso.files[0].bytes);
  const config = JSON.parse(/id="zine-config">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.equal(config.look, "riso");
  assert.equal(config.ink.pair, "teal-orange");
  assert.equal(config.ink.b, "#ff6c2f");
  assert.equal(riso.recipeInputs.look, "riso");
  assert.equal(riso.recipeInputs.ink, "teal-orange");
  const collage = makeZineTile({ ...v, look: "collage", ink: "teal-orange", made: "x" });
  assert.equal(collage.recipeInputs.look, "collage");
  assert.equal(collage.recipeInputs.ink, undefined);
  assert.ok(!/"ink"/.test(new TextDecoder().decode(collage.files[0].bytes).split('id="zine-config">')[1].split("</script>")[0]));
  for (const look of ["photocopy", "collage", "riso"]) assert.ok(READER_CSS.includes(`[data-look="${look}"]`), look);
  // Grain textures are data: addresses (nothing loaded from outside the tile).
  assert.doesNotMatch(READER_CSS, /url\(["']?https?:/);
  assert.doesNotThrow(() => new Function(READER_JS));
});

test("card art matches the reader: riso curves, two inks, toner grey", () => {
  assert.equal(curveAt(RISO_CURVES.a, 0), 0);
  assert.equal(curveAt(RISO_CURVES.a, 1), 1);
  assert.ok(Math.abs(curveAt("0 1", 0.25) - 0.25) < 1e-9);
  const ink = lookColors("riso", "black-red");
  assert.deepEqual(risoPixel(0, 0, ink).map(Math.round), [246, 241, 231]); // white stays paper
  const dark = risoPixel(1, 1, ink);
  assert.ok(dark.every((c) => c < 40), String(dark)); // black stays nearly black
  assert.equal(tonerGrey(1), 255);
  assert.equal(tonerGrey(0), 0);
  assert.equal(artStyle("riso", "black-red").paper, RISO_PAPER);
  assert.equal(artStyle("whatever").look, "clean");
});

// Stage 2: Fill and crop.
import { cropRect, clampCrop } from "../src/core/pictures.js";
import { fillFrame, cleanCrop, FILL_ZOOM_MAX } from "../src/tile-types/zine/pages.js";

test("crop math: covers the frame, keeps the chosen point in the middle as far as the edges allow", () => {
  // A wide picture in a tall frame: covers the height, centred.
  const r = cropRect(1200, 800, 330, 510, 0.5, 0.5, 1);
  assert.ok(Math.abs(r.h - 510) < 1e-6);
  assert.ok(Math.abs(r.x - (165 - r.w / 2)) < 1e-6);
  assert.equal(r.y, 0);
  // Asking for the far left edge stops at the edge (no gap).
  assert.equal(cropRect(1200, 800, 330, 510, 0, 0.5, 1).x, 0);
  assert.ok(Math.abs(cropRect(1200, 800, 330, 510, 1, 0.5, 1).x - (330 - r.w)) < 1e-6);
  // Zoom enlarges.
  assert.ok(Math.abs(cropRect(1200, 800, 330, 510, 0.5, 0.5, 2).w - 2 * r.w) < 1e-6);
  // The same crop looks the same at any size (the editor's small box and the page).
  const small = cropRect(1200, 800, 155, 240, 0.7, 0.3, 1.4), big = cropRect(1200, 800, 330, 510.97, 0.7, 0.3, 1.4);
  assert.ok(Math.abs(small.x / small.w - big.x / big.w) < 0.01);
  // clampCrop pulls the point back to where it still matters.
  const c = clampCrop(1200, 800, 330, 510, { x: 0, y: 0.9, zoom: 1 });
  assert.ok(c.x > 0 && c.x < 0.5);
  assert.equal(c.y, 0.5); // the height is exactly covered: up/down can't move
  assert.deepEqual(cleanCrop({ x: -1, y: 7, zoom: 9 }), { x: 0, y: 1, zoom: FILL_ZOOM_MAX });
  assert.deepEqual(cleanCrop(null), { x: 0.5, y: 0.5, zoom: 1 });
});

test("fill frames: edge to edge on the cover and picture-only pages; inside the margins with words", () => {
  const filled = (layout) => ({ layout, picture: { fill: true } });
  assert.deepEqual(fillFrame(PAGES[0], { picture: { fill: true } }, { paper: "a4" }), { w: 330, h: 467, bleed: true });
  assert.deepEqual(fillFrame(PAGES[3], filled("picture"), { paper: "letter" }), { w: 330, h: 510, bleed: true });
  assert.deepEqual(fillFrame(PAGES[1], filled("both"), { paper: "letter", look: "clean" }), { w: 286, h: 245, bleed: false });
  assert.deepEqual(fillFrame(PAGES[1], filled("both"), { paper: "letter", look: "collage" }), { w: 258, h: 194, bleed: false });
  assert.equal(fillFrame(PAGES[1], { layout: "both", picture: {} }, {}), null);
  const frame = pagesInput.pictureFrame(PAGES[2], { layout: "both", picture: { width: 1, height: 1 } }, { paper: "a4" });
  assert.equal(frame.bleed, false);
});

test("fill and crop reach the zine and the recipe; a bad crop is caught", () => {
  const v = sample();
  v.pages[0].picture = { ...v.pages[0].picture, fill: true, crop: { x: 0.7, y: 0.3, zoom: 1.4 } };
  v.pages[1].picture = { ...v.pages[1].picture, fill: true };
  const t = makeZineTile({ ...v, look: "collage", made: "x" });
  const config = JSON.parse(/id="zine-config">([\s\S]*?)<\/script>/.exec(new TextDecoder().decode(t.files[0].bytes))[1]);
  assert.deepEqual(config.pages[0].picture.crop, { x: 0.7, y: 0.3, zoom: 1.4 });
  assert.equal(config.pages[0].picture.frame.bleed, true);
  assert.deepEqual(config.pages[1].picture.crop, { x: 0.5, y: 0.5, zoom: 1 });
  assert.equal(config.pages[1].picture.frame.w, 258);
  assert.equal(config.pages[3].picture.fill, undefined);
  assert.deepEqual(t.recipeInputs.pages[0].picture.crop, { x: 0.7, y: 0.3, zoom: 1.4 });
  assert.equal(t.recipeInputs.pages[0].picture.fill, true);
  assert.ok(READER_JS.includes("function cropRect"));
  const bad = emptyPages();
  bad[1].picture = { ...pic(), fill: true, crop: { x: 0.5, y: 0.5, zoom: 5 } };
  assert.ok(pageProblems(pagesInput, bad, {}).some((m) => /crop isn't valid/.test(m)));
  bad[1].picture = { ...pic(), fill: "yes" };
  assert.ok(pageProblems(pagesInput, bad, {}).some((m) => /crop isn't valid/.test(m)));
});

// Stage 2: the creator's sprite on a page.
import { usableSprite, usesSprite, SPRITE_COST, SPRITE_PATH } from "../src/tile-types/zine/pages.js";

const SPRITE = { bytes: new Uint8Array([137, 80, 78, 71]), cid: "bafkre-sprite", width: 144, height: 192,
  geometry: { frameWidth: 48, frameHeight: 48, columns: 3, rows: 4 },
  origin: { kind: "record", uri: "at://did:plc:x/actor.rpg.sprite/self", generator: "rpg.actor" } };

test("sprite: a switch on every page, unavailable without a sprite", () => {
  const t = pagesInput.pageToggles.find((x) => x.key === "sprite");
  assert.ok(t);
  assert.equal(t.unavailable({ sprite: SPRITE }, {}), null);
  assert.match(t.unavailable({ sprite: null }, { ownSprite: { state: "none" } }), /rpg\.actor/);
  assert.match(t.unavailable({ sprite: null }, { ownSprite: { state: "loading" } }), /Looking/);
  assert.equal(usableSprite({ ...SPRITE, geometry: { ...SPRITE.geometry, rows: 2 } }), false);
  assert.equal(usableSprite(null), false);
  assert.equal(zine.defaults({}).sprite, null);
});

test("sprite: its lane takes room from the words", () => {
  const page = { layout: "words", sprite: true };
  const without = wordLimit(PAGES[1], { layout: "words" }, { paper: "letter", sprite: SPRITE });
  assert.equal(wordLimit(PAGES[1], page, { paper: "letter", sprite: SPRITE }), without - SPRITE_COST);
  // No usable sprite: no lane, no cost.
  assert.equal(wordLimit(PAGES[1], page, { paper: "letter", sprite: null }), without);
});

test("sprite: in the zine only when a page uses it; the recipe says where it came from", () => {
  const v = sample();
  const none = makeZineTile({ ...v, sprite: SPRITE, made: "x" });
  assert.ok(!none.files.some((f) => f.path === SPRITE_PATH));
  assert.equal(none.recipeInputs.sprite, undefined);
  v.pages[0].sprite = true;
  v.pages[2].sprite = true;
  const t = makeZineTile({ ...v, sprite: SPRITE, made: "x" });
  assert.ok(t.files.some((f) => f.path === SPRITE_PATH && f.contentType === "image/png"));
  const config = JSON.parse(/id="zine-config">([\s\S]*?)<\/script>/.exec(new TextDecoder().decode(t.files[0].bytes))[1]);
  assert.deepEqual(config.sprite, { src: SPRITE_PATH, frameWidth: 48, frameHeight: 48, columns: 3, rows: 4 });
  assert.deepEqual(config.pages.filter((p) => p.sprite).map((p) => p.id), ["cover", "p2"]);
  assert.equal(t.recipeInputs.sprite.cid, "bafkre-sprite");
  assert.deepEqual(t.recipeInputs.sprite.origin, { kind: "record", uri: "at://did:plc:x/actor.rpg.sprite/self", generator: "rpg.actor" });
  assert.deepEqual(t.recipeInputs.pages.filter((p) => p.sprite).map((p) => p.id), ["cover", "p2"]);
  // Pages ask for the sprite but there is none (signed out): the zine is made without it.
  const noSprite = makeZineTile({ ...v, sprite: null, made: "x" });
  assert.ok(!noSprite.files.some((f) => f.path === SPRITE_PATH));
  assert.equal(usesSprite(v.pages, null), false);
  // A local file's name never goes into the public recipe.
  const local = makeZineTile({ ...v, sprite: { ...SPRITE, origin: { kind: "local-file", name: "secret-name.png" } }, made: "x" });
  assert.ok(!JSON.stringify(local.recipeInputs).includes("secret-name"));
  // The reader carries the walker: a button readers can tap, frames from the sheet.
  assert.ok(READER_JS.includes('el("button", "walker")'));
  assert.match(READER_CSS, /\.zp \.walker \{[^}]*image-rendering: pixelated/);
  assert.ok(zine.credits.some((c) => c.some((part) => part && part.href === "https://rpg.actor/")));
});

test("sprite: page switches are checked by the contract", () => {
  const bad = { ...pagesInput, pageToggles: [{ key: "words", label: "x" }] };
  assert.throws(() => checkTileType({ ...zine, inputs: zine.inputs.map((i) => (i.kind === "pages" ? bad : i)) }), /page toggle/);
});

// Stage 2: new layouts (words over picture, big quote) and the rpg.actor credit.
import { pageLayout } from "../src/core/contract.js";

test("new layouts: words over picture always fills; big quote renames its fields", () => {
  const overlay = LAYOUTS.find((l) => l.value === "overlay");
  const quote = LAYOUTS.find((l) => l.value === "quote");
  assert.equal(overlay.fill, "always");
  assert.deepEqual(overlay.shows, ["picture", "heading", "words"]);
  assert.deepEqual(quote.shows, ["words", "subtitle"]);
  assert.equal(quote.labels.words, "Quote");
  assert.equal(pageLayout(pagesInput, PAGES[1], { layout: "quote" }).value, "quote");
  assert.equal(pageLayout(pagesInput, PAGES[0], {}), null);
  // A picture on "words over picture" fills the page even without choosing Fill.
  assert.deepEqual(fillFrame(PAGES[1], { layout: "overlay", picture: { fill: false } }, { paper: "a4" }), { w: 330, h: 467, bleed: true });
  const v = sample();
  v.pages[1] = { id: "p1", layout: "overlay", heading: "Gig", words: "Kitchen.", picture: pic() };
  v.pages[2] = { id: "p2", layout: "quote", words: "Opinions.", subtitle: "Ana", heading: "hidden heading", picture: pic() };
  const t = makeZineTile({ ...v, made: "x" });
  const config = JSON.parse(/id="zine-config">([\s\S]*?)<\/script>/.exec(new TextDecoder().decode(t.files[0].bytes))[1]);
  assert.equal(config.pages[1].picture.fill, true);
  assert.equal(config.pages[1].picture.frame.bleed, true);
  assert.equal(config.pages[2].picture, null);
  assert.equal(config.pages[2].heading, undefined);
  assert.equal(config.pages[2].subtitle, "Ana");
  assert.ok(!t.files.some((f) => f.path === "/pictures/p2.webp"));
  assert.ok(READER_JS.includes('"overlay"') && READER_JS.includes("quote-box"));
});

test("new layouts: word room, and the sprite's lane only costs full-page words", () => {
  for (const paper of ["letter", "a4"]) {
    const overlay = wordLimit(PAGES[1], { layout: "overlay" }, { paper });
    assert.ok(overlay > 0 && overlay < wordLimit(PAGES[1], { layout: "both" }, { paper }));
    assert.ok(wordLimit(PAGES[1], { layout: "overlay", heading: "H" }, { paper }) < overlay);
    assert.equal(wordLimit(PAGES[1], { layout: "quote" }, { paper }), 180);
    assert.equal(wordLimit(PAGES[1], { layout: "overlay", sprite: true }, { paper, sprite: SPRITE }), overlay);
    assert.equal(wordLimit(PAGES[1], { layout: "quote", sprite: true }, { paper, sprite: SPRITE }), 180);
  }
  const pages = emptyPages();
  pages[2] = { id: "p2", layout: "quote", words: "x".repeat(181) };
  assert.ok(pageProblems(pagesInput, pages, { paper: "letter" }).some((m) => /^Too many words for page 2 .*Shorten them\.$/.test(m)));
});

test("layout labels and always-fill are checked by the contract", () => {
  const withLayouts = (layouts) => ({ ...zine, inputs: zine.inputs.map((i) => (i.kind === "pages" ? { ...i, layouts } : i)) });
  assert.throws(() => checkTileType(withLayouts([...LAYOUTS, { value: "x", label: "X", shows: ["words"], labels: { body: "B" } }])), /labels/);
  assert.throws(() => checkTileType(withLayouts([...LAYOUTS, { value: "y", label: "Y", shows: ["picture"], fill: "sometimes" }])), /fill/);
});

test("the credits name rpg.actor when the zine uses the sprite", () => {
  const v = sample();
  const read = (tile) => JSON.parse(/id="zine-config">([\s\S]*?)<\/script>/.exec(new TextDecoder().decode(tile.files[0].bytes))[1]);
  const without = read(makeZineTile({ ...v, sprite: SPRITE, made: "x" }));
  assert.equal(without.sprite, undefined); // no page uses it: no sprite, so no credit
  assert.equal(without.credits, undefined);
  const pages = v.pages.map((p, i) => (i === 1 || i === 7 ? { ...p, sprite: true } : p));
  const withIt = read(makeZineTile({ ...v, pages, sprite: SPRITE, made: "x" }));
  assert.deepEqual(withIt.credits, [{ what: "Sprite", app: "rpg.actor", href: "https://rpg.actor/", pages: "page 1 and the back" }]);
});

// Stage 2: stickers and drawing.
import { STICKERS, PEN_SLOTS, MAX_MARKS, MAX_POINTS, markColors, cleanMarks, simplifyStroke, marksMarkup, marksDefs, marksSvg, stickersUsed } from "../src/tile-types/zine/marks.js";
import { EDITOR_JS } from "../src/tile-types/zine/runtime/editor.js";

test("stickers and pens: sixteen stickers; pens and colours follow the look", () => {
  assert.equal(STICKERS.length, 16);
  assert.equal(new Set(STICKERS.map((s) => s.id)).size, 16);
  assert.deepEqual(PEN_SLOTS.photocopy.map(([s]) => s), ["a", "b"]);
  assert.deepEqual(PEN_SLOTS.riso.map(([s]) => s), ["a", "b"]);
  const riso = markColors("riso", "teal-orange");
  assert.equal(riso.pens.b, "#ff6c2f");
  assert.equal(riso.fills.star, "#ff6c2f");
  assert.equal(riso.fills.speech, riso.paper); // white stickers stay paper-coloured
  const copy = markColors("photocopy");
  assert.equal(copy.pens.b, copy.paper); // white-out
  assert.equal(copy.mono, true);
  assert.equal(markColors("clean").pens.b, "#d23b2e");
});

test("marks are cleaned: known stickers and pens only, numbers in range, limits kept", () => {
  const many = Array.from({ length: MAX_MARKS + 5 }, (_, i) => ({ t: "s", id: "star", x: i, y: i, s: 1, r: 0 }));
  assert.equal(cleanMarks(many).length, MAX_MARKS);
  const out = cleanMarks([
    { t: "s", id: "nope", x: 1, y: 1 },
    { t: "s", id: "heart", x: 9999, y: -999, s: 9, r: 370 },
    { t: "p", pen: "z", w: "fine", d: [1, 2, 3, 4] },
    { t: "p", pen: "hi", w: "wide", d: [1, 2, "x", 4, 5, 6] },
    { t: "p", pen: "a", d: [1] },
    "junk",
  ]);
  assert.deepEqual(out[0], { t: "s", id: "heart", x: 370, y: -40, s: 3, r: 10 });
  assert.deepEqual(out[1], { t: "p", pen: "hi", w: "fine", d: [1, 2, 5, 6] });
  assert.equal(out.length, 2);
  const long = { t: "p", pen: "a", w: "fine", d: Array.from({ length: 2000 }, (_, i) => i % 300) };
  assert.equal(cleanMarks([long])[0].d.length, MAX_POINTS * 2);
  assert.deepEqual(simplifyStroke([0, 0, 0.5, 0, 1, 0, 3, 0, 3.2, 0]), [0, 0, 3, 0, 3.2, 0]);
});

test("marks become SVG: stickers by reference, smoothed strokes, highlighter see-through", () => {
  const colors = markColors("clean");
  const marks = cleanMarks([{ t: "s", id: "star", x: 50, y: 60, s: 2, r: 15 }, { t: "p", pen: "hi", w: "thick", d: [0, 0, 10, 10, 20, 0] }]);
  const svg = marksMarkup(marks, colors);
  assert.match(svg, /<g data-i="0" transform="translate\(50 60\) rotate\(15\)"><use href="#st-star" x="-60" y="-60" width="120" height="120"/);
  assert.match(svg, /<path data-i="1" d="M0 0Q10 10 15 5L20 0"/);
  assert.match(svg, /stroke-opacity="0.45"/);
  assert.match(marksDefs({ star: STICKERS[0].svg }, colors), /<symbol id="st-star"/);
  assert.match(marksSvg(marks, colors, 330, 510), /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 330 510"/);
  assert.deepEqual(Object.keys(stickersUsed([{ marks }, { marks: [{ t: "s", id: "heart" }] }])), ["star", "heart"]);
  // The reader carries the same functions.
  assert.ok(READER_JS.includes("function marksMarkup") && READER_JS.includes("function marksDefs"));
});

test("marks reach the zine and the recipe; the published page has no editor", () => {
  const v = sample();
  v.pages[1].marks = [{ t: "s", id: "heart", x: 100, y: 120, s: 1, r: -8 }, { t: "p", pen: "b", w: "thick", d: [10, 10, 40, 30] }];
  const t = makeZineTile({ ...v, look: "riso", ink: "blue-pink", made: "x" });
  const html = new TextDecoder().decode(t.files[0].bytes);
  const config = JSON.parse(/id="zine-config">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.deepEqual(Object.keys(config.stickers), ["heart"]);
  assert.equal(config.markColors.pens.b, "#ff48b0");
  assert.equal(config.pages[1].marks.length, 2);
  assert.equal(config.pages[2].marks, undefined);
  assert.deepEqual(t.recipeInputs.pages[1].marks[0], { t: "s", id: "heart", x: 100, y: 120, s: 1, r: -8 });
  assert.ok(!html.includes("setPointerCapture"), "the decorating tools stay in the Foundry");
  const plain = makeZineTile({ ...sample(), made: "x" });
  assert.ok(!new TextDecoder().decode(plain.files[0].bytes).includes('"stickers"'));
  // The preview's page adds the editor.
  assert.ok(renderZineHtml({ title: "x", config, extraScript: EDITOR_JS }).includes("setPointerCapture"));
  assert.doesNotThrow(() => new Function(EDITOR_JS));
});
