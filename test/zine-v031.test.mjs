// Foundry v0.31.0 for Zine Scene: talking tiles are recognised (a "talks"
// badge, the "Talks to" menu lists only talking partners, "Show all tiles" /
// "Pair it anyway…" for the rest), and a shorter panel (the title in the
// Cover's panel, Paper and Pages as pills in one row, shorter sprite line).
// Plan: claude/zine-v031-plan.md.  Run with:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { textTalks, tileTalks, pairQualifies } from "../src/tile-types/zine/talk.js";
import { zine } from "../src/tile-types/zine/index.js";
import { PAGES } from "../src/tile-types/zine/pages.js";
import { checkInputs, checkTileType } from "../src/core/contract.js";

const enc = (s) => new TextEncoder().encode(s);
const appPiece = (files, extra = {}) => ({ kind: "tile", uri: "at://did:plc:x/ing.dasl.masl/3a", status: "ready", maker: "app", files: Object.entries(files).map(([path, text]) => ({ path, bytes: enc(text) })), ...extra });

// Shapes taken from the owner's real tiles (checked Oct 14).
const BOB = `window.addEventListener("message", (e) => { dispatch(e.data); });
if (window.parent && window.parent !== window) { _send = (payload) => window.parent.postMessage(Object.assign({ source: "bob-die" }, payload), "*"); }
const dataProtocol = await import("/.well-known/web-tiles/data.js");`;
const ATMO_LISTENS_ONLY = `window.addEventListener('message', (ev) => { if (ev.data && ev.data.type === 'sample') loadSample(ev.data); }); worker.postMessage({ cmd: 'start' });`;
const TREELINE = `var data = JSON.parse(document.getElementById("treeline-data").textContent); var satImg = new Image(); satImg.src = data.satellite.path;`;

test("a tile talks when it sends to its page or uses the tile protocol; listening alone doesn't count", () => {
  assert.equal(textTalks(BOB), true);
  assert.equal(textTalks("top.postMessage({ roll: 6 }, '*')"), true);
  assert.equal(textTalks("import('/.well-known/web-tiles/data.js')"), true);
  assert.equal(textTalks("const s = await window.makeWish('supply', {})"), true);
  assert.equal(textTalks(ATMO_LISTENS_ONLY), false, "ATMOSYNTH listens and talks to its own worker, not its page");
  assert.equal(textTalks(TREELINE), false);
  assert.equal(textTalks(""), false);
});

test("tileTalks reads the tile's own copied code; Foundry tiles and zines never count; null until copied", () => {
  assert.equal(tileTalks(appPiece({ "/": "<script>" + BOB + "</script>" })), true);
  assert.equal(tileTalks(appPiece({ "/": "<p>hi</p>", "/tile.js": BOB })), true, "a script file counts too");
  assert.equal(tileTalks(appPiece({ "/": "<p>hi</p>", "/notes.md": BOB })), false, "notes aren't code");
  assert.equal(tileTalks(appPiece({ "/": "<script>" + ATMO_LISTENS_ONLY + "</script>" })), false);
  assert.equal(tileTalks(appPiece({ "/": BOB }, { typeId: "zine" })), false, "a zine relays, it isn't a talker");
  assert.equal(tileTalks(appPiece({ "/": "" }, { typeId: "glass-lantern" })), false);
  assert.equal(tileTalks({ ...appPiece({ "/": BOB }), status: "loading", files: undefined }), null);
  assert.equal(tileTalks(null), false);
  assert.equal(tileTalks({ kind: "tape", uri: "x" }), false);
});

test("a pair counts when both talk, or when the creator paired them on purpose", () => {
  const talker = { piece: appPiece({ "/": BOB }) };
  const loner = { piece: appPiece({ "/": TREELINE }) };
  const copying = { piece: { ...appPiece({ "/": BOB }), status: "loading", files: undefined } };
  assert.equal(pairQualifies(talker, { piece: appPiece({ "/": "<script>parent.postMessage(1,'*')</script>" }) }), true);
  assert.equal(pairQualifies(talker, loner), false, "a talking tile paired with one that plays on its own ends");
  assert.equal(pairQualifies({ ...talker, pairAnyway: true }, { ...loner, pairAnyway: true }), true, "unless paired anyway");
  assert.equal(pairQualifies({ ...talker, pairAnyway: true }, loner), false, "on both pages");
  assert.equal(pairQualifies(talker, copying), true, "a tile still being copied doesn't end a pair");
});

test("the panel: Paper and Pages pills in a row, the title inside the Cover's panel, a shorter sprite line", () => {
  checkTileType(zine);
  const by = (k) => zine.inputs.find((i) => i.key === k);
  const keys = zine.inputs.map((i) => i.key);
  assert.deepEqual(keys.slice(0, 6), ["name", "paper", "pageCount", "look", "headingFont", "wordsFont"]);
  for (const k of ["paper", "pageCount"]) {
    assert.equal(by(k).display, "menu");
    assert.equal(by(k).row, "format");
    assert.equal(by(k).help, undefined, "no help line (owner)");
  }
  assert.equal(by("pageCount").label, "Pages");
  assert.equal(typeof by("pageCount").note, "function", "the put-aside line stays");
  const name = by("name");
  assert.equal(name.inPage, "cover");
  assert.equal(name.help, "On the cover, and the zine's name in feeds.");
  assert.equal(name.hint, "**bold**, *italic*");
  assert.deepEqual(checkInputs(zine, { ...zine.defaults({}), name: "" }).map((p) => [p.key, p.message]), [["name", "Title is required."]]);
  const pages = by("pages");
  assert.equal(pages.pageToggles.find((t) => t.key === "sprite").help, "Your rpg.actor sprite walks along the bottom. Readers can tap it to wave.");
  assert.equal(PAGES[0].note, "“by @you” is added from your account.");
});
