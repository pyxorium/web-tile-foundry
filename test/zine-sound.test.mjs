import { test } from "node:test";
import assert from "node:assert/strict";
import { checkTileType, checkInputs, pageProblems, pagesBytes, buildProblems } from "../src/core/contract.js";
import { contentTypeFor } from "../src/core/fileset.js";
import { buildTile } from "../src/core/build.js";
import { zine } from "../src/tile-types/zine/index.js";
import { emptyPages, wordLimit, zineConfig, PAGES } from "../src/tile-types/zine/pages.js";
import { makeZineTile, zineRecipe } from "../src/tile-types/zine/tile.js";
import { READER_JS, READER_CSS, LOAD_TIMES } from "../src/tile-types/zine/runtime/reader.js";
import { renderZineHtml } from "../src/tile-types/zine/runtime/template.js";
import { previewConfig } from "../src/tile-types/zine/preview.js";
import {
  plyrSongUrl, cleanCut, clipFromSong, clipFades, clipUpToDate, soundReady, soundProblems, soundForReader, soundRecipe,
  defaultDetails, soundPath, CLIP_MAX_SECONDS, SOUND_COST, QUOTE_SOUND_COST,
} from "../src/tile-types/zine/sound.js";
import { peaksFor, clockTenths } from "../src/tile-types/zine/soundpanel.js";

// Zine Scene, stage 3: sounds from plyr.fm songs, and pictures loaded page by page.

const DID = "did:plc:rqbqpaaluty5v47jwciowpik";
const SONG = {
  uri: `at://${DID}/fm.plyr.track/3mabcde2xyz`,
  cid: "bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5uxgf3kz3vvxmpe4a5zy",
  title: "Drop Top",
  album: "Parlor Greens at Jam Cruise 2026",
  artist: "",
  seconds: 281.4,
  blob: { cid: "bafkreiaxvhh3ul2c4tw3u4ue2tq3cnnl3yrv6ex2fwfdtfuedzgxbwq5ga" },
};
const mp3 = (n = 5000) => new Uint8Array(n).fill(0xff);

function readyClip(start = 30, end = 75.5) {
  return { ...clipFromSong(SONG), start, end, status: "ready", bytes: mp3(), seconds: end - start, made: { start, end } };
}
const pagesInput = zine.inputs.find((i) => i.kind === "pages");
const soundToggle = pagesInput.pageToggles.find((t) => t.key === "sound");

function sample() {
  const pages = emptyPages();
  pages[0].subtitle = "With sound";
  pages[2].layout = "words";
  pages[2].words = "Listen to this one.";
  pages[2].sound = true;
  pages[2].clip = readyClip();
  return { name: "Loud Pages", paper: "letter", pages, description: "", handle: "pyxorium.com", soundRights: true };
}

test("the zine type still follows the contract, with a 20 MB limit and the lamejs credit", () => {
  checkTileType(zine);
  assert.equal(zine.maxBytes, 20 * 1024 * 1024);
  const credits = JSON.stringify(zine.credits);
  assert.ok(credits.includes("lamejs") && credits.includes("LGPL") && credits.includes("plyr.fm") && credits.includes("rpg.actor"));
  assert.ok(soundToggle && soundToggle.panel && typeof soundToggle.panel.mount === "function");
  assert.equal(pagesInput.sizeLabel, "Pictures, sounds and tiles");
});

test("the contract checks page switches' panels, problems and sizes", () => {
  const bad = (t) => ({ ...zine, inputs: zine.inputs.map((i) => (i.kind === "pages" ? { ...i, pageToggles: [t] } : i)) });
  assert.throws(() => checkTileType(bad({ key: "x", label: "X", panel: {} })), /panel needs a mount/);
  assert.throws(() => checkTileType(bad({ key: "x", label: "X", problems: "no" })), /problems must be a function/);
  assert.throws(() => checkTileType(bad({ key: "x", label: "X", bytes: 3 })), /bytes must be a function/);
  const pages = sample().pages;
  pages[1].picture = { bytes: new Uint8Array(100), contentType: "image/webp", width: 10, height: 10 };
  assert.equal(pagesBytes(pagesInput, pages), 100 + 5000);
  pages[2].sound = false; // switched off: its clip no longer counts
  assert.equal(pagesBytes(pagesInput, pages), 100);
});

test("plyr.fm song pages, cuts and fades", () => {
  assert.equal(plyrSongUrl(SONG.uri), `https://plyr.fm/at/${DID}/fm.plyr.track/3mabcde2xyz`);
  assert.equal(plyrSongUrl("at://did:plc:x/app.bsky.feed.post/1"), null);
  assert.equal(plyrSongUrl("javascript:alert(1)"), null);
  assert.deepEqual(cleanCut(10, 100, 281), { start: 10, end: 70 });
  assert.deepEqual(cleanCut(50, 20, 281), { start: 20, end: 50 });
  assert.deepEqual(cleanCut(-5, 0.2, 281), { start: 0, end: 1 });
  assert.deepEqual(cleanCut(280.9, 281, 281), { start: 280, end: 281 });
  assert.deepEqual(cleanCut(0, 60, 42.25), { start: 0, end: 42.3 });
  assert.deepEqual(cleanCut(1.234, 9.876, 100), { start: 1.2, end: 9.9 });
  const c = clipFromSong(SONG);
  assert.equal(c.start, 0);
  assert.equal(c.end, CLIP_MAX_SECONDS);
  assert.equal(c.title, "Drop Top");
  assert.equal(c.details, "Parlor Greens at Jam Cruise 2026");
  assert.equal(c.song.blobCid, SONG.blob.cid);
  assert.equal(c.status, "waiting");
  assert.equal(defaultDetails({ artist: "Parlor Greens", album: "Jam Cruise 2026" }), "Parlor Greens · Jam Cruise 2026");
  assert.deepEqual(clipFades(60), { fadeIn: 0.5, fadeOut: 1.5 });
  assert.deepEqual(clipFades(2), { fadeIn: 0.5, fadeOut: 2 / 3 });
});

test("a page's sound: ready only when made from its current cut", () => {
  const page = { id: "p2", sound: true, clip: readyClip() };
  assert.ok(soundReady(page));
  assert.ok(clipUpToDate(page.clip));
  const moved = { ...page, clip: { ...page.clip, end: 80 } };
  assert.ok(!soundReady(moved));
  assert.ok(!soundReady({ ...page, sound: false }));
  const spec = PAGES[2];
  assert.deepEqual(soundProblems(page, spec), []);
  assert.match(soundProblems(moved, spec)[0], /^Page 2: the sound is still being made/);
  assert.match(soundProblems({ id: "p2", sound: true }, spec)[0], /pick a song for its sound, or turn the sound off/);
  assert.match(soundProblems({ ...page, clip: { ...page.clip, status: "error", error: "the host answered 500." } }, spec)[0], /couldn't be made \(the host answered 500\)\. Try again/);
  assert.match(soundProblems({ ...page, clip: { ...page.clip, title: "  " } }, spec)[0], /needs a title/);
  assert.match(soundProblems({ id: "back", sound: true }, PAGES[7])[0], /^The back: pick a song/);
  // The pages input reports them, and a page with the switch off has none.
  const pages = emptyPages();
  pages[2].sound = true;
  assert.ok(pageProblems(pagesInput, pages, {}).some((m) => /Page 2: pick a song/.test(m)));
  pages[2].sound = false;
  assert.ok(!pageProblems(pagesInput, pages, {}).some((m) => /sound/.test(m)));
});

test("the rights confirmation shows with a sound and is needed to publish, not to build", () => {
  const v = sample();
  v.soundRights = false;
  const problems = checkInputs(zine, v);
  const rights = problems.find((p) => p.key === "soundRights");
  assert.ok(rights && rights.publishOnly, JSON.stringify(problems));
  assert.equal(buildProblems(problems).length, 0);
  v.soundRights = true;
  assert.ok(!checkInputs(zine, v).some((p) => p.key === "soundRights"));
  const quiet = { ...sample(), soundRights: false };
  quiet.pages = emptyPages();
  assert.ok(!checkInputs(zine, quiet).some((p) => p.key === "soundRights"));
});

test("the sound band takes word room on pages whose words fill them", () => {
  const values = { paper: "letter" };
  const words = { layout: "words", heading: "", sound: true };
  assert.equal(wordLimit(PAGES[1], { ...words, sound: false }, values) - wordLimit(PAGES[1], words, values), SOUND_COST);
  const both = { layout: "both", heading: "", sound: true };
  assert.equal(wordLimit(PAGES[1], { ...both, sound: false }, values) - wordLimit(PAGES[1], both, values), SOUND_COST);
  const quote = { layout: "quote", sound: true };
  assert.equal(wordLimit(PAGES[1], { ...quote, sound: false }, values) - wordLimit(PAGES[1], quote, values), QUOTE_SOUND_COST);
  const overlay = { layout: "overlay", sound: true };
  assert.equal(wordLimit(PAGES[1], overlay, values), wordLimit(PAGES[1], { ...overlay, sound: false }, values));
  // Measured in Chromium (768 cases): the worst, an A4 back page with the sprite and short lines.
  assert.equal(SOUND_COST, 240);
});

test("the sound band sits in the page's flow, before the back page's footer; a card loads only its cover", () => {
  assert.ok(READER_CSS.includes(".zp .snd-row {") && /\.snd-row \{[^}]*margin-top: auto/.test(READER_CSS));
  assert.ok(!/\.zp\.has-sound \{[^}]*padding-bottom/.test(READER_CSS), "no padding lane for the band");
  assert.ok(READER_JS.includes('e.insertBefore(row, e.querySelector(":scope > .foot"))'));
  assert.ok(READER_JS.includes('if (mode !== "card")'));
});

test("a zine with a sound: its file, the reader's config, and the recipe", () => {
  const v = sample();
  const tile = makeZineTile(v);
  const f = tile.files.find((x) => x.path === "/sounds/p2.mp3");
  assert.ok(f, tile.files.map((x) => x.path).join(", "));
  assert.equal(contentTypeFor("/sounds/p2.mp3"), "audio/mpeg");
  assert.equal(f.bytes.length, 5000);
  const config = zineConfig({ title: v.name, handle: v.handle, paper: "letter", pages: v.pages });
  assert.equal(config.sounds, true);
  assert.deepEqual(config.pages[2].sound, {
    src: "/sounds/p2.mp3", title: "Drop Top", seconds: 45.5, details: "Parlor Greens at Jam Cruise 2026",
    url: `https://plyr.fm/at/${DID}/fm.plyr.track/3mabcde2xyz`,
  });
  assert.ok(!config.pages[1].sound);
  const recipe = tile.recipeInputs;
  assert.deepEqual(recipe.pages[2].sound, {
    path: "/sounds/p2.mp3", title: "Drop Top", start: 30, end: 75.5, seconds: 45.5, details: "Parlor Greens at Jam Cruise 2026",
    source: { record: { uri: SONG.uri, cid: SONG.cid }, url: `https://plyr.fm/at/${DID}/fm.plyr.track/3mabcde2xyz` },
  });
  assert.ok(!JSON.stringify(recipe).includes("bytes"));
  // Switched off, or not made yet: nothing goes in.
  for (const change of [{ sound: false }, { clip: { ...readyClip(), end: 99 } }]) {
    const w = sample();
    Object.assign(w.pages[2], change);
    const t = makeZineTile(w);
    assert.ok(!t.files.some((x) => x.path.startsWith("/sounds/")));
    assert.ok(!zineRecipe(w).pages[2].sound);
    assert.ok(!zineConfig({ title: "x", pages: w.pages }).sounds);
  }
  // Text on the band is one plain line.
  const odd = sample();
  odd.pages[2].clip = { ...readyClip(), title: "Line one\nline <two>", details: "" };
  const s = soundForReader({ ...odd.pages[2], id: "p2" });
  assert.equal(s.title, "Line one line <two>");
  assert.ok(!("details" in s));
  assert.equal(soundPath("back"), "/sounds/back.mp3");
  assert.equal(soundRecipe({ id: "p1", sound: false }), null);
});

test("the size limit counts sounds", async () => {
  const v = sample();
  v.pages[2].clip = { ...readyClip(), bytes: mp3(21 * 1024 * 1024) };
  await assert.rejects(buildTile(zine, v, { final: false }), /up to 20/);
  const ok = await buildTile(zine, sample(), { final: false });
  assert.ok(ok.files.some((x) => x.path === "/sounds/p2.mp3"));
});

test("the preview asks the Foundry for sounds by a changing address", () => {
  const v = sample();
  const a = previewConfig(v);
  assert.match(a.pages[2].sound.src, /^clip:p2:\d+$/);
  assert.equal(previewConfig(v).pages[2].sound.src, a.pages[2].sound.src, "same clip, same address");
  v.pages[2].clip = { ...readyClip(), bytes: mp3(6000) };
  assert.notEqual(previewConfig(v).pages[2].sound.src, a.pages[2].sound.src, "a new cut gets a new address");
});

test("the reader loads files once, page by page, and plays sounds", () => {
  assert.doesNotThrow(() => new Function(READER_JS));
  // Pictures wait for their page (data-src), and each file is fetched once and kept.
  assert.ok(READER_JS.includes('img.setAttribute("data-src", pic.src)'));
  assert.ok(!/img\.src = pic\.src/.test(READER_JS));
  assert.ok(READER_JS.includes("wantPage(i, true)") && READER_JS.includes("wantPage(i, false)"));
  assert.ok(READER_JS.includes("URL.createObjectURL"));
  // Sounds: tap to play (never on their own), the stop pill, the timings, the footer credit.
  assert.ok(!/autoplay/i.test(READER_JS));
  assert.ok(READER_JS.includes(`var STILL_MS = ${LOAD_TIMES.still}, RETRY_MS = ${LOAD_TIMES.retry};`));
  assert.ok(READER_JS.includes('"Stop the sound"'));
  assert.ok(READER_JS.includes('link("Songs from plyr.fm ↗", "https://plyr.fm/")'));
  assert.ok(READER_CSS.includes(".card .zp .snd-row { display: none; }"));
  // The page stays safe: no inline handlers, no outside addresses beyond links.
  const html = renderZineHtml({ title: "t", config: zineConfig({ title: "t", pages: sample().pages }) });
  assert.ok(!/\son[a-z]+=/i.test(html));
  assert.ok(!/(src|href)=["']https?:/i.test(html));
});

test("slow downloads: 4 and 8 seconds, a note for pictures, a restart on this page, and a keep-alive", () => {
  assert.deepEqual({ ...LOAD_TIMES }, { still: 4000, retry: 8000, keepAlive: 20000 });
  assert.doesNotThrow(() => new Function(READER_JS));
  // Each download is timed from its own start (files come one at a time).
  assert.ok(READER_JS.includes("var w = job.watch = { slow: 0 };"));
  assert.ok(READER_JS.includes('"Still loading pictures…"') && READER_JS.includes('"Some pictures couldn\'t load."'));
  assert.ok(READER_JS.includes('img.setAttribute("data-want", src)'));
  assert.ok(!READER_JS.includes("function () { img.src = src; }"), "no second download behind the queue's back");
  // Try again: a failed picture is asked for again; a stuck one restarts the zine on this page.
  assert.ok(READER_JS.includes("function restart(pageId)") && READER_JS.includes('location.hash = "page=" + pageId;'));
  assert.ok(READER_JS.includes("return restart(config.pages[first].id)") && READER_JS.includes("restart(p.id);"));
  // Keep-alive: a message to the tile's own service worker, only while shown, never in the Foundry preview.
  assert.ok(READER_JS.includes('c.postMessage({ action: "tiles-keepalive" })'));
  assert.ok(READER_JS.includes(`setInterval(nudge, ${LOAD_TIMES.keepAlive})`) && READER_JS.includes('document.visibilityState !== "hidden"'));
  assert.ok(READER_CSS.includes(".loadnote {") && READER_CSS.includes(".card .loadnote { display: none; }"));
});

test("the panel's helpers: waveform peaks and times", () => {
  const n = 44100;
  const left = new Float32Array(n), right = new Float32Array(n);
  for (let i = n / 2; i < n; i++) left[i] = 0.5 * Math.sin(i / 10);
  const p = peaksFor(left, right, 10);
  assert.equal(p.length, 10);
  assert.equal(p[0], 0);
  assert.ok(p[9] > 0.9 && p[9] <= 1);
  assert.equal(clockTenths(62.34), "1:02.3");
  assert.equal(clockTenths(5), "0:05.0");
});
