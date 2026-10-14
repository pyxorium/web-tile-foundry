// Foundry v0.30.0 for Zine Scene: animated pictures on pages (GIF, animated
// WebP, APNG, with a still), GIF and AVIF as copyable tile files, light Markdown
// in words, headings and the title, and zine fonts (a heading font and a words
// font). Plan and decisions: claude/zine-v030-plan.md.
// Run with:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

import { contentTypeFor, copyTypeAccepts, hasContentType } from "../src/core/fileset.js";
import { fetchPublishedTile, copyPaths } from "../src/core/published-tile.js";
import { rawCid } from "../src/core/cid.js";
import { dagCborCid } from "../src/core/dagcbor.js";
import { tileViewUrl } from "../src/core/publish.js";
import { animatedType, gifFrames, webpAnimated, pngAnimated, animationTooBig, ANIMATED_MAX_BYTES } from "../src/core/pictures.js";
import { pageProblems, pagesBytes, checkInputs } from "../src/core/contract.js";
import { mdRuns, mdPlain, mdRoom } from "../src/tile-types/zine/markdown.js";
import { emptyPages, zineConfig, picturePath, stillPath, wordSize, wordLimit, PAGES } from "../src/tile-types/zine/pages.js";
import { makeZineTile, plainTitle, defaultDescription } from "../src/tile-types/zine/tile.js";
import { ZINE_FONTS, cleanFont, fontFiles, fontsForReader, HEADING_FONT_OPTIONS, WORDS_FONT_OPTIONS } from "../src/tile-types/zine/fonts.js";
import { zine } from "../src/tile-types/zine/index.js";
import { READER_JS, READER_CSS } from "../src/tile-types/zine/runtime/reader.js";

const enc = (s) => new TextEncoder().encode(s);
const cat = (...parts) => { const n = parts.reduce((a, p) => a + p.length, 0); const out = new Uint8Array(n); let k = 0; for (const p of parts) { out.set(p, k); k += p.length; } return out; };
const u32be = (n) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const u32le = (n) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);

// ---- Small real-shaped picture files ----

/** A 1x1 GIF with `frames` images (each: graphic control extension, descriptor, tiny LZW data). */
function gif(frames) {
  const head = cat(enc("GIF89a"), new Uint8Array([1, 0, 1, 0, 0x80, 0, 0]), new Uint8Array([0, 0, 0, 255, 255, 255]));
  const loop = new Uint8Array([0x21, 0xff, 11, ...enc("NETSCAPE2.0"), 3, 1, 0, 0, 0]);
  const frame = cat(new Uint8Array([0x21, 0xf9, 4, 0, 10, 0, 0, 0]), new Uint8Array([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0]), new Uint8Array([2, 2, 0x44, 0x01, 0]));
  return cat(head, loop, ...Array.from({ length: frames }, () => frame), new Uint8Array([0x3b]));
}
function riff(chunks) {
  const body = cat(enc("WEBP"), ...chunks.map(([id, data]) => cat(enc(id), u32le(data.length), data, data.length & 1 ? new Uint8Array([0]) : new Uint8Array(0))));
  return cat(enc("RIFF"), u32le(body.length), body);
}
const webpStill = () => riff([["VP8L", new Uint8Array([0x2f, 0, 0, 0, 0])]]);
const webpAnim = () => riff([["VP8X", new Uint8Array([0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0])], ["ANIM", new Uint8Array(6)], ["ANMF", new Uint8Array(16)]]);
function png(withActl, frames = 2) {
  const chunk = (id, data) => cat(u32be(data.length), enc(id), data, new Uint8Array(4));
  const ihdr = chunk("IHDR", cat(u32be(1), u32be(1), new Uint8Array([8, 6, 0, 0, 0])));
  const actl = withActl ? chunk("acTL", cat(u32be(frames), u32be(0))) : new Uint8Array(0);
  return cat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, actl, chunk("IDAT", new Uint8Array([1, 2, 3])), chunk("IEND", new Uint8Array(0)));
}

const STILL = { bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2]), contentType: "image/webp", width: 480, height: 270 };
const animatedPic = (bytes = gif(3), contentType = "image/gif") => ({ bytes, contentType, width: 480, height: 270, animated: true, still: STILL });

function zineValues(pages, more = {}) {
  return { name: "The Late Shift", paper: "letter", look: "clean", ink: "", pages, pageCount: 8, handle: "pyxorium.com", sprite: null, ...more };
}
const pagesInput = zine.inputs.find((i) => i.key === "pages");

// ---- GIF and AVIF tile files ----

test("GIF and AVIF are tile file types, so a tile carrying them can be copied onto a page", async () => {
  assert.equal(contentTypeFor("/art/loop.gif"), "image/gif");
  assert.equal(contentTypeFor("/art/photo.AVIF"), "image/avif");
  assert.ok(hasContentType("/x.gif") && hasContentType("/x.avif"));
  assert.ok(copyTypeAccepts("/x.gif", "image/gif") && copyTypeAccepts("/x.avif", "image/avif"));
  assert.ok(!copyTypeAccepts("/x.gif", "text/javascript"), "never across families");

  // A published tile with a GIF and an AVIF in it, copied as the tile panel does.
  const DID = "did:plc:rqbqpaaluty5v47jwciowpik";
  const spec = {
    "/": ['<!doctype html><img src="/loop.gif"><img src="/photo.avif">', "text/html"],
    "/loop.gif": [gif(2), "image/gif"],
    "/photo.avif": [new Uint8Array([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]), "image/avif"],
  };
  const blobs = new Map();
  const resources = {};
  for (const [path, [data, ct]] of Object.entries(spec)) {
    const bytes = typeof data === "string" ? enc(data) : data;
    const cid = await rawCid(bytes);
    blobs.set(cid, bytes);
    resources[path] = { src: { $type: "blob", ref: { $link: cid }, mimeType: ct, size: bytes.length }, "content-type": ct };
  }
  const tile = { name: "Loops", resources };
  const value = { $type: "ing.dasl.masl", cid: await dagCborCid(tile), tile, createdAt: "2026-10-14T00:00:00.000Z" };
  const address = `at://${DID}/ing.dasl.masl/3mzzloops22`;
  const json = (b) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (u.host === "plc.directory") return json({ alsoKnownAs: ["at://pyxorium.com"], service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: "https://pds.example" }] });
    if (u.pathname.endsWith("getRecord")) return json({ uri: address, cid: "bafyreirecord", value });
    if (u.pathname.endsWith("getBlob")) return new Response(blobs.get(u.searchParams.get("cid")));
    return new Response("?", { status: 404 });
  };
  const pub = await fetchPublishedTile(address, { fetchImpl });
  const paths = pub.files.map((f) => f.path).sort();
  assert.deepEqual(paths, ["/", "/loop.gif", "/photo.avif"]);
  assert.equal(typeof copyPaths, "function");
});

// ---- Animated pictures ----

test("animated pictures are told apart from still ones: GIF (2+ images), animated WebP, APNG", () => {
  assert.equal(gifFrames(gif(1)), 1);
  assert.ok(gifFrames(gif(3)) > 1);
  assert.equal(animatedType(gif(1)), null, "a one-image GIF is a still picture");
  assert.equal(animatedType(gif(2)), "image/gif");
  assert.equal(webpAnimated(webpStill()), false);
  assert.equal(animatedType(webpAnim()), "image/webp");
  assert.equal(pngAnimated(png(false)), false);
  assert.equal(pngAnimated(png(true, 1)), false, "an acTL with one frame doesn't move");
  assert.equal(animatedType(png(true)), "image/png");
  assert.equal(animatedType(new Uint8Array([0xff, 0xd8, 0xff])), null, "a JPEG");
  assert.equal(animatedType(new Uint8Array(0)), null);
  assert.equal(ANIMATED_MAX_BYTES, 3 * 1024 * 1024);
  assert.match(animationTooBig(7.2 * 1024 * 1024), /^This animation is 7\.2 MB; a page can hold one up to 3 MB\. Try a shorter or smaller one, or save it as an animated WebP/);
});

test("an animated picture keeps its bytes and its still: files, reader, recipe, size, checks", () => {
  const pages = emptyPages();
  pages[0].picture = animatedPic(webpAnim(), "image/webp"); // the cover
  pages[1].picture = animatedPic(); // page 1, a GIF
  pages[2].picture = { ...animatedPic(png(true), "image/png"), fill: true };
  pages[2].layout = "picture";
  pages[3].picture = { ...STILL }; // an ordinary still picture
  assert.equal(picturePath(pages[1]), "/pictures/p1.gif");
  assert.equal(stillPath(pages[1]), "/pictures/p1-still.webp");
  assert.equal(picturePath(pages[2]), "/pictures/p2.png");
  assert.throws(() => picturePath({ id: "p9", picture: { contentType: "image/gif", bytes: gif(1) } }), /unknown type/, "a GIF only goes in as an animation, with its still");

  const out = makeZineTile(zineValues(pages));
  const paths = out.files.map((f) => f.path);
  for (const p of ["/pictures/cover.webp", "/pictures/cover-still.webp", "/pictures/p1.gif", "/pictures/p1-still.webp", "/pictures/p2.png", "/pictures/p2-still.webp", "/pictures/p3.webp"]) assert.ok(paths.includes(p), p);
  assert.ok(!paths.includes("/pictures/p3-still.webp"), "a still picture has no still of its own");
  assert.equal(out.files.find((f) => f.path === "/pictures/p1.gif").contentType, "image/gif");
  assert.deepEqual(out.files.find((f) => f.path === "/pictures/p1.gif").bytes, pages[1].picture.bytes, "kept byte for byte");

  const config = zineConfig({ title: "x", handle: "", paper: "letter", look: "clean", ink: "", pages, pageCount: 8, made: "", src: picturePath });
  assert.equal(config.pages[1].picture.src, "/pictures/p1.gif");
  assert.equal(config.pages[1].picture.still, "/pictures/p1-still.webp");
  assert.equal(config.pages[3].picture.still, undefined);
  const recipe = out.recipeInputs.pages.find((p) => p.id === "p1").picture;
  assert.equal(recipe.animated, true);
  assert.equal(recipe.still, "/pictures/p1-still.webp");

  assert.equal(pagesBytes(pagesInput, pages, zineValues(pages)), [0, 1, 2, 3].reduce((n, i) => n + pages[i].picture.bytes.length + (pages[i].picture.still ? STILL.bytes.length : 0), 0), "stills count in the size meter");
  assert.deepEqual(pageProblems(pagesInput, pages, zineValues(pages)), []);
  const noStill = emptyPages();
  noStill[1].picture = { ...animatedPic(), still: null };
  assert.match(pageProblems(pagesInput, noStill, zineValues(noStill)).join(" "), /isn't ready/);
  const big = emptyPages();
  big[1].picture = animatedPic(new Uint8Array(ANIMATED_MAX_BYTES + 1));
  assert.match(pageProblems(pagesInput, big, zineValues(big)).join(" "), /Page 1: This animation is 3 MB; a page can hold one up to 3 MB/);
  assert.equal(pagesInput.animatedPictures, true);
});

test("the reader shows a still to readers who ask for less motion", () => {
  assert.ok(READER_JS.includes('window.matchMedia("(prefers-reduced-motion: reduce)")'));
  assert.ok(READER_JS.includes("pic.still && lessMotion && lessMotion.matches ? pic.still : pic.src"));
  assert.ok(READER_JS.includes('img.setAttribute("data-anim", pic.src); img.setAttribute("data-still", pic.still);'));
});

// ---- Light Markdown ----

test("light Markdown: bold, italic, code and links, stray asterisks left alone", () => {
  assert.deepEqual(mdRuns("**bold** and *italic*", true), [{ t: "bold", b: 1 }, { t: " and " }, { t: "italic", i: 1 }]);
  assert.deepEqual(mdRuns("***both***", true), [{ t: "both", b: 1, i: 1 }]);
  assert.deepEqual(mdRuns("a **b *c* d** e", true), [{ t: "a " }, { t: "b ", b: 1 }, { t: "c", b: 1, i: 1 }, { t: " d", b: 1 }, { t: " e" }]);
  assert.deepEqual(mdRuns("use `x *y*` here", true), [{ t: "use " }, { t: "x *y*", c: 1 }, { t: " here" }]);
  for (const plain of ["5*3*2", "a * b", "*", "* a list", "2**3", "**unclosed", "a ** b **", "snake_case"]) {
    assert.deepEqual(mdRuns(plain, true), [{ t: plain }], plain);
  }
  assert.deepEqual(mdRuns("\\*not\\* italic", true), [{ t: "*not* italic" }], "a backslash keeps a marker");
  assert.deepEqual(mdRuns("[the patch](https://atmosynth.at/p/1) ok", true), [{ t: "the patch", h: "https://atmosynth.at/p/1" }, { t: " ok" }]);
  assert.deepEqual(mdRuns("[**go**](https://a.co)", true), [{ t: "go", b: 1, h: "https://a.co" }]);
});

test("links: https:// pages, and at:// tiles on lexicographer.space; nothing else", () => {
  const uri = "at://did:plc:rqbqpaaluty5v47jwciowpik/ing.dasl.masl/3mxrkta4fzv22";
  assert.deepEqual(mdRuns(`[my other zine](${uri})`, true), [{ t: "my other zine", h: tileViewUrl(uri, null) }]);
  assert.equal(mdRuns("[t](at://pyxorium.com/ing.dasl.masl/3abc)", true)[0].h, "https://lexicographer.space/@pyxorium.com/3abc");
  for (const bad of ["http://plain.example", "javascript:alert(1)", "data:text/html,x", "at://did:plc:x/app.bsky.feed.post/3abc", "https://", "mailto:me@example.com", "//evil.example", "https://a.co/<x>"]) {
    const runs = mdRuns(`[x](${bad})`, true);
    assert.ok(runs.every((r) => !r.h), bad);
    assert.equal(runs.map((r) => r.t).join(""), `[x](${bad})`, `${bad} stays as written`);
  }
});

test("headings and the title take bold and italic only; the card's name is plain", () => {
  assert.deepEqual(mdRuns("The *Late* `Shift` [x](https://a.co)", false), [{ t: "The " }, { t: "Late", i: 1 }, { t: " `Shift` [x](https://a.co)" }]);
  assert.equal(plainTitle("The **Late** *Shift*"), "The Late Shift");
  assert.equal(defaultDescription("The *Late* Shift", "a.b", 8), "“The Late Shift”, a little zine by @a.b, eight pages to flip through.");
  const pages = emptyPages();
  pages[1].heading = "A **night** out";
  const out = makeZineTile(zineValues(pages, { name: "The *Late* Shift" }));
  assert.equal(out.name, "The Late Shift", "feeds show the title as plain text");
  const html = new TextDecoder().decode(out.files.find((f) => f.path === "/").bytes);
  assert.match(html, /<title>The Late Shift<\/title>/);
  assert.match(html, /"title":"The \*Late\* Shift"/, "the cover sets it in italic");
  assert.equal(out.recipeInputs.pages.find((p) => p.id === "p1").heading, "A **night** out", "the recipe keeps the text as typed");
  assert.equal(plainTitle("****"), "****", "stray asterisks stay as written, even in the title");
});

test("the word gauge counts the words as they read; the big quote and a review line count as typed", () => {
  const typed = "Read **this** and [the patch](https://atmosynth.at/patches/long-address-here).";
  assert.equal(mdPlain(typed), "Read this and the patch.");
  assert.ok(wordSize(typed, { layout: "both" }) < typed.length - 40);
  assert.equal(wordSize(typed, { layout: "quote" }), typed.length);
  assert.equal(wordSize(typed, { layout: "book" }), typed.length);
  assert.ok(mdRoom("**abcdefghij**") > 10, "bold letters a little wider");
  assert.equal(wordSize("a\nb", { layout: "words" }), 2 + 1 + 20, "line breaks cost as before");
  assert.equal(wordSize("plain words"), "plain words".length);
  // The panel's gauge passes the page in (contract pageFullness).
  const page = { id: "p1", layout: "words", heading: "", words: "**x** ".repeat(200) };
  assert.ok(wordSize(page.words, page) < page.words.length);
  assert.ok(wordLimit(PAGES[1], page, { paper: "letter" }) > 0);
  assert.equal(pagesInput.wordsHint(PAGES[1], { layout: "both" }), "**bold**, *italic*, `code`, [link](https://…)");
  assert.equal(pagesInput.wordsHint(PAGES[1], { layout: "quote" }), null);
  assert.equal(pagesInput.headingHint(PAGES[1], {}), "**bold**, *italic*");
});

test("the reader makes the elements itself: links in a new tab, nothing from the text as HTML", () => {
  assert.ok(READER_JS.includes("var mdRuns = function mdRuns(") || READER_JS.includes("var mdRuns = function"));
  assert.ok(READER_JS.includes('link.target = "_blank"; link.rel = "noopener noreferrer";'));
  assert.ok(READER_JS.includes("wordsBlock(page.words, false); rv.classList.add(\"review\")"), "a book's review line stays plain");
  assert.ok(READER_JS.includes("var q = wordsBlock(page.words, false);"), "the big quote stays plain");
  assert.ok(READER_JS.includes('headEl("h1", null, config.title || "")'));
  assert.ok(!/innerHTML\s*=\s*[^;]*(words|heading|title)/.test(READER_JS));
  assert.ok(READER_CSS.includes(".zp h1 strong, .zp h2 strong { font-weight: 900; }"));
});

// ---- Zine fonts ----

test("six fonts for headings, four for words; choices made safe", () => {
  assert.deepEqual(ZINE_FONTS.map((f) => f.label), ["Fraunces", "Courier Prime", "Nunito", "Caveat", "Bebas Neue", "Pirata One"]);
  assert.deepEqual(HEADING_FONT_OPTIONS.map((o) => o.label), ["Default", "Fraunces", "Courier Prime", "Nunito", "Caveat", "Bebas Neue", "Pirata One"]);
  assert.deepEqual(WORDS_FONT_OPTIONS.map((o) => o.label), ["Default", "Fraunces", "Courier Prime", "Nunito", "Caveat"]);
  assert.equal(cleanFont("heading", "bebas-neue"), "bebas-neue");
  assert.equal(cleanFont("words", "bebas-neue"), "", "poster and blackletter are for headings only");
  assert.equal(cleanFont("heading", "comic-sans"), "");
  const values = zine.defaults({ handle: "a.b" });
  assert.equal(values.headingFont, "");
  assert.equal(values.wordsFont, "");
  assert.deepEqual(checkInputs(zine, { ...values, wordsFont: "pirata-one" }).map((p) => p.key), ["wordsFont"]);
  assert.deepEqual(checkInputs(zine, { ...values, headingFont: "pirata-one", wordsFont: "caveat" }), []);
});

test("the font pills sit side by side right under the look", () => {
  const keys = zine.inputs.map((i) => i.key);
  assert.deepEqual(keys.slice(keys.indexOf("look"), keys.indexOf("look") + 3), ["look", "headingFont", "wordsFont"]);
  for (const k of ["headingFont", "wordsFont"]) {
    const input = zine.inputs.find((i) => i.key === k);
    assert.equal(input.display, "menu");
    assert.equal(input.row, "fonts");
  }
  assert.equal(zine.inputs.find((i) => i.key === "wordsFont").rowHelp, "Fonts for the whole zine. Default uses the look's own.");
});

test("only the fonts a zine uses go into it, each with its licence", () => {
  assert.deepEqual(fontFiles({}), []);
  assert.deepEqual(fontFiles({ headingFont: "bebas-neue" }).map((f) => f.path), ["/fonts/bebas-neue.woff2", "/fonts/bebas-neue-OFL.txt"]);
  assert.deepEqual(fontFiles({ headingFont: "fraunces", wordsFont: "fraunces" }).map((f) => f.path), ["/fonts/fraunces.woff2", "/fonts/fraunces-italic.woff2", "/fonts/fraunces-OFL.txt"], "a font used twice goes in once");

  const choice = { headingFont: "pirata-one", wordsFont: "courier-prime" };
  const fontBytes = {};
  for (const f of fontFiles(choice)) fontBytes[f.file] = readFileSync(new URL(`../public/zine-fonts/${f.file}`, import.meta.url));
  const out = makeZineTile(zineValues(emptyPages(), { ...choice, fontBytes }));
  const fonts = out.files.filter((f) => f.path.startsWith("/fonts/"));
  assert.deepEqual(fonts.map((f) => f.path), fontFiles(choice).map((f) => f.path));
  assert.equal(fonts.find((f) => f.path.endsWith(".woff2")).contentType, "font/woff2");
  assert.equal(fonts.find((f) => f.path.endsWith(".txt")).contentType, "text/plain");
  assert.equal(out.recipeInputs.headingFont, "pirata-one");
  assert.equal(out.recipeInputs.wordsFont, "courier-prime");
  assert.equal(makeZineTile(zineValues(emptyPages())).recipeInputs.headingFont, undefined, "the look's own fonts aren't recorded");
  assert.throws(() => makeZineTile(zineValues(emptyPages(), { headingFont: "fraunces" })), /fonts haven't loaded/);

  const html = new TextDecoder().decode(out.files.find((f) => f.path === "/").bytes);
  assert.match(html, /"fonts":\{"heading":\{"id":"pirata-one","family":"zine-heading-pirata-one","faces":\[\{"src":"\/fonts\/pirata-one.woff2"/);
  assert.equal(fontsForReader({}), null);
  assert.equal(fontsForReader({ wordsFont: "caveat" }, (f) => `font:${f}`).words.faces[0].src, "font:caveat.woff2");
});

test("the font files are in the Foundry: WOFF2, Latin, with their OFL licences", () => {
  for (const font of ZINE_FONTS) {
    for (const face of font.faces) {
      const path = new URL(`../public/zine-fonts/${face.file}`, import.meta.url);
      assert.ok(existsSync(path), face.file);
      const b = readFileSync(path);
      assert.equal(b.subarray(0, 4).toString("latin1"), "wOF2", face.file);
      assert.ok(b.length < 100 * 1024, `${face.file} is small (${b.length} bytes)`);
    }
    const licence = readFileSync(new URL(`../public/zine-fonts/${font.licence}`, import.meta.url), "utf8");
    assert.match(licence, /SIL OPEN FONT LICENSE/i, font.licence);
  }
  assert.ok(READER_JS.includes("function applyFonts()") && READER_JS.includes("sizeAdjust"));
  assert.ok(READER_CSS.includes("html[data-hf] .zp h1, html[data-hf] .zp h2 { font-family: var(--hf)"));
});

test("Courier Prime words at 90%: they take about 11% more room on the gauge", async () => {
  const { wordsWidth } = await import("../src/tile-types/zine/fonts.js");
  assert.equal(wordsWidth({ wordsFont: "courier-prime" }), 1.11);
  assert.equal(wordsWidth({ wordsFont: "fraunces" }), 1);
  assert.equal(wordsWidth({}), 1);
  const page = { layout: "words", words: "x".repeat(1000) };
  assert.equal(wordSize(page.words, page, PAGES[1], { wordsFont: "courier-prime" }), 1110);
  assert.equal(wordSize(page.words, page, PAGES[1], {}), 1000);
  assert.equal(wordSize("x".repeat(100), { layout: "quote" }, PAGES[1], { wordsFont: "courier-prime" }), 100, "the big quote keeps its own font");
  const { pageFullness } = await import("../src/core/contract.js");
  const values = zineValues([], { wordsFont: "courier-prime" });
  assert.ok(pageFullness(pagesInput, PAGES[1], page, values) > pageFullness(pagesInput, PAGES[1], page, zineValues([])));
  assert.deepEqual(pagesInput.pictureTypes, ["JPG", "PNG", "WebP", "GIF", "AVIF"]);
});
