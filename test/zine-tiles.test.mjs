import { test } from "node:test";
import assert from "node:assert/strict";
import { checkTileType, pageProblems, pagesBytes, PAGE_FIELDS, ZINE_PAGE_KINDS } from "../src/core/contract.js";
import { buildTile } from "../src/core/build.js";
import { zine } from "../src/tile-types/zine/index.js";
import { emptyPages, wordLimit, zineConfig, PAGES, LAYOUTS, WORD_LIMITS } from "../src/tile-types/zine/pages.js";
import { tileFolder, tilePath, pieceReady, pieceBytes, pieceProblems, pieceFiles, tileForReader, pieceRecipe, tilePlacement } from "../src/tile-types/zine/piece.js";
import { READER_JS, READER_CSS } from "../src/tile-types/zine/runtime/reader.js";
import { renderZineHtml } from "../src/tile-types/zine/runtime/template.js";
import { previewConfig } from "../src/tile-types/zine/preview.js";
import { spriteWalker } from "../src/tile-types/sprite-walker/index.js";
import { glassLantern } from "../src/tile-types/glass-lantern/index.js";
import { coasterCarnival } from "../src/tile-types/coaster-carnival/index.js";
import { mixtape } from "../src/tile-types/mixtape/index.js";

// Zine Scene stage 4: one of the creator's own tiles on an "A tile" page.

const DID = "did:plc:joer5rzmwgec3dkr4srfmq45";
const enc = (s) => new TextEncoder().encode(s);
const PAGE = '<!DOCTYPE html><html><body><script type="application/json" id="lantern-config">{}</script><script src="/lantern.js"></script></body></html>';
function lanternFiles() {
  return [
    { path: "/", bytes: enc(PAGE), contentType: "text/html" },
    { path: "/lantern.js", bytes: enc("console.log(1)"), contentType: "text/javascript" },
    { path: "/banner.png", bytes: new Uint8Array([137, 80, 78, 71, 9]), contentType: "image/png" },
    { path: "/icon.png", bytes: new Uint8Array([137, 80, 78, 71, 8]), contentType: "image/png" },
    { path: "/foundry.json", bytes: enc("{}"), contentType: "application/json" },
  ];
}
function piece(extra = {}) {
  return {
    kind: "tile", uri: `at://${DID}/ing.dasl.masl/3mlantern`, cid: "bafyreirec", name: "Glass lantern", did: DID, handle: "thunderbirdwine.bsky.social",
    typeId: "glass-lantern", typeVersion: 1, foundryVersion: "0.9.0", status: "ready", files: lanternFiles(), ...extra,
  };
}
const pagesInput = zine.inputs.find((i) => i.kind === "pages");
function sample() {
  const pages = emptyPages();
  pages[1].layout = "tile";
  pages[1].heading = "My lantern";
  pages[1].words = "Spin it.";
  pages[1].piece = piece();
  return { name: "Tiles", paper: "letter", look: "clean", pages, description: "", handle: "thunderbirdwine.bsky.social" };
}

test("the contract: a piece field, and which types go on zine pages", () => {
  assert.ok(PAGE_FIELDS.includes("piece"));
  assert.deepEqual([...ZINE_PAGE_KINDS], ["live", "tape"]);
  checkTileType(zine);
  assert.ok(pagesInput.piece && typeof pagesInput.piece.panel.mount === "function");
  assert.equal(spriteWalker.zinePage, "live");
  assert.equal(glassLantern.zinePage, "live");
  assert.equal(coasterCarnival.zinePage, "live");
  assert.equal(mixtape.zinePage, "tape");
  assert.equal(zine.zinePage, undefined, "no zines inside zines");
  const bad = { ...zine, inputs: zine.inputs.map((i) => (i.kind === "pages" ? { ...i, piece: undefined } : i)) };
  assert.throws(() => checkTileType(bad), /piece: \{ panel \}/);
  assert.throws(() => checkTileType({ ...zine, zinePage: "maybe" }), /zinePage/);
});

test("the A tile layout: its fields, word room and the sprite lane and sound band", () => {
  const l = LAYOUTS.find((x) => x.value === "tile");
  assert.deepEqual(l.shows, ["piece", "heading", "words"]);
  for (const paper of ["letter", "a4"]) assert.ok(WORD_LIMITS[paper].tile);
  const values = { paper: "letter" };
  const page = { layout: "tile", heading: "" };
  assert.equal(wordLimit(PAGES[1], page, values), WORD_LIMITS.letter.tile.page[0]);
  assert.ok(wordLimit(PAGES[1], { ...page, sound: true }, values) < wordLimit(PAGES[1], page, values), "the sound band takes room here too");
});

test("which of your tiles can go on a page", () => {
  const types = [spriteWalker, glassLantern, coasterCarnival, mixtape, zine];
  const getType = (id) => types.find((t) => t.id === id);
  const r = (type, extra = {}) => ({ madeWith: "Web Tile Foundry", foundryVersion: "0.9.0", type, typeVersion: 1, inputs: {}, ...extra });
  assert.equal(tilePlacement(r("glass-lantern"), getType).ok, true);
  assert.equal(tilePlacement(r("sprite-walker"), getType).ok, true);
  assert.equal(tilePlacement(r("coaster-carnival"), getType).ok, true);
  assert.match(tilePlacement(r("mixtape"), getType).reason, /A tape/);
  assert.match(tilePlacement(r("zine"), getType).reason, /can't go on a zine page/);
  assert.match(tilePlacement(r("glass-lantern", { typeVersion: 99 }), getType).reason, /newer Foundry/);
  assert.match(tilePlacement(r("unknown-kind"), getType).reason, /doesn't know/);
  assert.match(tilePlacement(null, getType).reason, /Not made with the Foundry/);
});

test("a page's tile: problems, size, files copied byte for byte, the reader's view, the recipe", () => {
  const spec = PAGES[1];
  assert.deepEqual(pieceProblems({ layout: "tile" }, spec), ["Page 1: choose one of your tiles, or pick another layout."]);
  assert.match(pieceProblems({ piece: piece({ status: "loading", files: undefined }) }, spec)[0], /still being copied/);
  assert.match(pieceProblems({ piece: piece({ status: "error", error: "no network." }) }, spec)[0], /couldn't be copied \(no network\)/);
  assert.deepEqual(pieceProblems({ piece: piece() }, spec), []);
  const page = { id: "p1", layout: "tile", piece: piece() };
  assert.ok(pieceReady(page));
  assert.equal(pieceBytes(page), lanternFiles().reduce((n, f) => n + f.bytes.length, 0));
  const files = pieceFiles(page, "p1");
  assert.deepEqual(files.map((f) => f.path).sort(), ["/tiles/p1/banner.png", "/tiles/p1/foundry.json", "/tiles/p1/icon.png", "/tiles/p1/index.html", "/tiles/p1/lantern.js"]);
  assert.deepEqual(files.find((f) => f.path === "/tiles/p1/index.html").bytes, enc(PAGE), "the page itself is unchanged");
  assert.equal(tileFolder("p1"), "/tiles/p1");
  assert.equal(tilePath("p1", "/"), "/tiles/p1/index.html");
  const r = tileForReader(page, "p1");
  assert.deepEqual(r, {
    name: "Glass lantern", by: "@thunderbirdwine.bsky.social", page: "/tiles/p1/index.html",
    refs: [{ ref: "/lantern.js", src: "/tiles/p1/lantern.js" }],
    url: `https://appmosphe.re/@${DID}/3mlantern`, poster: "/tiles/p1/banner.png",
  });
  assert.deepEqual(pieceRecipe(page, "p1"), { kind: "tile", uri: piece().uri, cid: "bafyreirec", name: "Glass lantern", folder: "/tiles/p1", type: "glass-lantern", typeVersion: 1, foundryVersion: "0.9.0" });
});

test("the size meter and the page problems count the tile only on an A tile page", () => {
  const v = sample();
  const withTile = pagesBytes(pagesInput, v.pages);
  assert.ok(withTile >= pieceBytes(v.pages[1]));
  const other = v.pages.map((p, i) => (i === 1 ? { ...p, layout: "words" } : p));
  assert.equal(pagesBytes(pagesInput, other), withTile - pieceBytes(v.pages[1]));
  const blank = v.pages.map((p, i) => (i === 1 ? { ...p, piece: null } : p));
  assert.ok(pageProblems(pagesInput, blank, v).some((m) => /choose one of your tiles/.test(m)));
});

test("a zine with a tile: its files, the reader's config, the preview's addresses and the recipe", async () => {
  const v = sample();
  const result = await buildTile(zine, v, { final: false });
  const paths = result.files.map((f) => f.path);
  for (const p of ["/tiles/p1/index.html", "/tiles/p1/lantern.js", "/tiles/p1/banner.png"]) assert.ok(paths.includes(p), p);
  assert.deepEqual(result.files.find((f) => f.path === "/tiles/p1/lantern.js").bytes, enc("console.log(1)"));
  const recipe = JSON.parse(new TextDecoder().decode(result.files.find((f) => f.path === "/foundry.json").bytes));
  assert.equal(recipe.inputs.pages[1].layout, "tile");
  assert.equal(recipe.inputs.pages[1].tile.uri, piece().uri);
  assert.ok(!JSON.stringify(recipe).includes("bytes"));
  const c = zineConfig({ title: "T", handle: "x", paper: "letter", look: "clean", pages: v.pages });
  assert.equal(c.pages[1].tile.page, "/tiles/p1/index.html");
  const pv = previewConfig(v);
  assert.match(pv.pages[1].tile.page, /^piece:p1:\d+\/$/);
  assert.match(pv.pages[1].tile.refs[0].src, /^piece:p1:\d+\/lantern\.js$/);
  assert.equal(previewConfig(v).pages[1].tile.page, pv.pages[1].tile.page, "same files, same address");
  v.pages[1].piece = piece({ files: lanternFiles() });
  assert.notEqual(previewConfig(v).pages[1].tile.page, pv.pages[1].tile.page, "copied again, new address");
});

test("the reader: tap to start, files handed over, stop off the page, frames per look", () => {
  assert.doesNotThrow(() => new Function(READER_JS));
  assert.ok(READER_JS.includes('page.layout === "tile"') && READER_JS.includes("function startTile(p)") && READER_JS.includes("function stopTilesOffPage()"));
  assert.ok(READER_JS.includes('URL.createObjectURL(new Blob([swapRefs(made.html, map)], { type: "text/html" }))'), "way C: the frame gets blob: copies");
  assert.ok(READER_JS.includes("var SEALED = location.origin === \"null\";") && READER_JS.includes("f.srcdoc = made.srcdoc;"), "sealed (the Foundry preview): files written into the frame");
  assert.ok(!READER_JS.includes("</script"), "nothing in the reader ends its script early");
  assert.ok(READER_JS.includes("stopTilesOffPage();"), "leaving the page stops the tile");
  assert.ok(READER_JS.includes('"▶ Play"') && READER_JS.includes('"… Loading"') && READER_JS.includes('"Open it ↗"'));
  assert.ok(!READER_JS.includes("tile-stop"), "no Stop: turning the page stops a tile");
  assert.ok(READER_JS.includes('if (t.by && t.by !== "@" + config.handle)'), "the maker shows only when it isn't the zine's author");
  assert.ok(!/\.tile-play \{[^}]*position: absolute/.test(READER_CSS), "controls sit in the caption line, not on the tile");
  assert.ok(READER_JS.includes('frame.addEventListener("click"'), "the banner itself starts the tile");
  assert.ok(/\/\^\(clip\|piece\):\//.test(READER_JS), "the preview asks the Foundry for tile files");
  for (const look of ["photocopy", "collage", "riso"]) assert.ok(READER_CSS.includes(`[data-look="${look}"] .zp .tileframe`), look);
  assert.ok(!/\[data-look="photocopy"\] \.zp \.tileframe[^{]*\{[^}]*filter/.test(READER_CSS), "the tile keeps its own colors");
  const html = renderZineHtml({ title: "T", config: zineConfig({ title: "T", handle: "x", paper: "letter", look: "clean", pages: sample().pages }) });
  assert.ok(!/\son[a-z]+=/i.test(html));
  assert.ok(!/(src|href)=["']https?:/i.test(html));
});

// ---- Part 2: tapes as J-card pages, with an optional taste ----

import { tapeFromJson, tapeForReader, tasteSongs } from "../src/tile-types/zine/piece.js";
import { clipFromSong, soundForReader } from "../src/tile-types/zine/sound.js";

const TAPE_JSON = {
  v: 2, title: "Parlor Greens at Jam Cruise", dedication: "For the boat.", notes: "Long liner notes that stay on the tape's own page.",
  label: { text: "JAM CRUISE '26", colors: { shell: "#222222" } },
  sides: [
    { name: "A", tracks: [
      { path: "/tracks/a1.mp3", cid: "bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", title: "Drop Top", duration: 281.4,
        source: { record: { uri: "at://did:plc:rqbqpaaluty5v47jwciowpik/fm.plyr.track/3mabc", cid: "bafyreiplyr" }, url: "https://plyr.fm/track/42" } },
      { path: "/tracks/a2.mp3", cid: "bafkreibbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", title: "Jolene", duration: 224 },
    ] },
    { name: "B", tracks: [{ path: "/tracks/b1.mp3", cid: "bafkreicccccccccccccccccccccccccccccccccccccccccccccccccccc", title: "Parlor <Strut>", duration: 541 }] },
  ],
};
function tapePiece(extra = {}) {
  return {
    kind: "tape", uri: "at://did:plc:rqbqpaaluty5v47jwciowpik/ing.dasl.masl/3mtape", cid: "bafyreitape", name: "Parlor Greens at Jam Cruise",
    did: "did:plc:rqbqpaaluty5v47jwciowpik", handle: "pyxorium.com", typeId: "mixtape", typeVersion: 1, status: "ready",
    files: [{ path: "/banner.png", bytes: new Uint8Array([137, 80, 78, 71, 7]), contentType: "image/png" }],
    tape: tapeFromJson(TAPE_JSON), ...extra,
  };
}

test("tapes: what the J-card keeps from tape.json (no liner notes), and placement", () => {
  const t = tapeFromJson(TAPE_JSON);
  assert.equal(t.title, "Parlor Greens at Jam Cruise");
  assert.equal(t.dedication, "For the boat.");
  assert.equal(t.notes, undefined, "liner notes stay on the tape's own page");
  assert.deepEqual(t.sides.map((s) => [s.name, s.tracks.map((x) => x.title)]), [["A", ["Drop Top", "Jolene"]], ["B", ["Parlor <Strut>"]]]);
  assert.equal(t.sides[0].tracks[0].url, "https://plyr.fm/track/42");
  assert.equal(tapeFromJson({ sides: [] }), null);
  assert.equal(tapeFromJson(null), null);
  const types = [glassLantern, mixtape, zine];
  const getType = (id) => types.find((x) => x.id === id);
  const r = (type) => ({ madeWith: "Web Tile Foundry", type, typeVersion: 1 });
  assert.equal(tilePlacement(r("mixtape"), getType, "tape").ok, true);
  assert.match(tilePlacement(r("glass-lantern"), getType, "tape").reason, /A tile/);
  assert.match(tilePlacement(r("mixtape"), getType, "live").reason, /A tape/);
});

test("a tape page: problems, only the banner copied, the reader's J-card, the recipe", () => {
  const spec = PAGES[2];
  assert.match(pieceProblems({ layout: "tape" }, spec)[0], /choose one of your tapes/);
  assert.match(pieceProblems({ layout: "tape", piece: piece() }, spec)[0], /choose one of your tapes/, "a tile on a tape page doesn't count");
  assert.match(pieceProblems({ layout: "tile", piece: tapePiece() }, spec)[0], /choose one of your tiles/);
  const page = { id: "p2", layout: "tape", piece: tapePiece(), subtitle: "Side B is the one." };
  assert.deepEqual(pieceProblems(page, spec), []);
  assert.deepEqual(pieceFiles(page, "p2").map((f) => f.path), ["/tiles/p2/banner.png"], "the songs aren't copied");
  const r = tapeForReader(page, "p2");
  assert.deepEqual(r, {
    name: "Parlor Greens at Jam Cruise", title: "Parlor Greens at Jam Cruise",
    sides: [{ name: "A", songs: ["Drop Top", "Jolene"] }, { name: "B", songs: ["Parlor <Strut>"] }],
    dedication: "For the boat.", url: "https://appmosphe.re/@did:plc:rqbqpaaluty5v47jwciowpik/3mtape", poster: "/tiles/p2/banner.png",
  });
  assert.equal(pieceRecipe(page, "p2").kind, "tape");
  assert.equal(tileForReader(page, "p2"), null);
});

test("a taste: the tape's own songs by side, each from its song file, with its plyr.fm link", () => {
  const songs = tasteSongs(tapePiece());
  assert.equal(songs.length, 3);
  assert.deepEqual(songs.map((s) => s.album), ["Side A", "Side A", "Side B"]);
  assert.equal(songs[0].blob.cid, TAPE_JSON.sides[0].tracks[0].cid, "cut from the tape's own song file");
  assert.equal(songs[0].uri, TAPE_JSON.sides[0].tracks[0].source.record.uri);
  assert.equal(songs[1].uri, `${tapePiece().uri}#/tracks/a2.mp3`);
  const clip = { ...clipFromSong(songs[0]), status: "ready", bytes: new Uint8Array(9), seconds: 60, start: 0, end: 60, made: { start: 0, end: 60 } };
  assert.equal(clip.details, "From Parlor Greens at Jam Cruise");
  const s = soundForReader({ id: "p2", sound: true, clip });
  assert.equal(s.url, "https://plyr.fm/track/42");
  assert.equal(s.details, "From Parlor Greens at Jam Cruise");
  assert.deepEqual(tasteSongs(piece()), [], "only tapes have tastes");
});

test("a zine with a tape page: the banner and the taste go in; the Add a sound switch steps aside there", async () => {
  const v = sample();
  v.pages[2].layout = "tape";
  v.pages[2].piece = tapePiece();
  v.pages[2].subtitle = "Side B is the one.";
  const songs = tasteSongs(v.pages[2].piece);
  v.pages[2].sound = true;
  v.pages[2].clip = { ...clipFromSong(songs[2]), status: "ready", bytes: new Uint8Array(20), seconds: 30, start: 10, end: 40, made: { start: 10, end: 40 } };
  v.soundRights = true;
  const result = await buildTile(zine, v, { final: false });
  const paths = result.files.map((f) => f.path);
  assert.ok(paths.includes("/tiles/p2/banner.png") && paths.includes("/sounds/p2.mp3"));
  assert.ok(!paths.some((p) => p.startsWith("/tiles/p2/tracks")));
  const c = zineConfig({ title: "T", handle: "pyxorium.com", paper: "letter", look: "clean", pages: v.pages });
  assert.equal(c.pages[2].tape.title, "Parlor Greens at Jam Cruise");
  assert.equal(c.pages[2].subtitle, "Side B is the one.");
  assert.equal(c.pages[2].sound.details, "From Parlor Greens at Jam Cruise");
  const recipe = JSON.parse(new TextDecoder().decode(result.files.find((f) => f.path === "/foundry.json").bytes));
  assert.equal(recipe.inputs.pages[2].tape.kind, "tape");
  const soundToggle = pagesInput.pageToggles.find((t) => t.key === "sound");
  assert.equal(soundToggle.hide({ layout: "tape" }), true);
  assert.equal(soundToggle.hide({ layout: "both" }), false);
  assert.ok(LAYOUTS.some((l) => l.value === "tape" && l.shows.join() === "piece,subtitle"));
  assert.ok(READER_JS.includes("function fitTape(pageEl)") && READER_JS.includes('"▶ Play this tape ↗"') && READER_JS.includes('" more"'));
});
