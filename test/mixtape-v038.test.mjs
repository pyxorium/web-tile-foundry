// Foundry v0.38.0, Mixtape Burndown's importer fixes and the whole-show tick
// (claude/foundry-0.38-decisions.md, items 1 to 9). The info files in
// test/fixtures/lma are the owner's real ones (Nov 15 to 17); the two
// "*.head.flac" files are only the metadata of two of Todd Snider's 2005 FLACs
// (their tags, no audio).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as A from "../src/tile-types/mixtape/archive.js";
import { sidesInOrder, sideFor } from "../src/tile-types/mixtape/workshop.js";
import { mixtape } from "../src/tile-types/mixtape/index.js";

const fx = (name) => new URL(`./fixtures/lma/${name}`, import.meta.url);
const text = (name) => readFileSync(fx(name), "utf8");
const head = (name) => new Uint8Array(readFileSync(fx(name)));

test("“1-07 Unknown Track.flac” is disc 1, track 7 (it was read as track 1: every song stored as 1)", () => {
  assert.deepEqual(A.parseSongFileName("1-07 Unknown Track.flac"), { disc: 1, track: 7 });
  assert.deepEqual(A.parseSongFileName("1-15 goodnight.flac"), { disc: 1, track: 15 });
  assert.deepEqual(A.parseSongFileName("2-03 Encore.flac"), { disc: 2, track: 3 });
  // The older patterns still read as before.
  assert.deepEqual(A.parseSongFileName("05 Some Song.flac"), { disc: 1, track: 5 });
  assert.deepEqual(A.parseSongFileName("Trout Steak Revival 2018-11-30_CD Track 01.flac"), { disc: 1, track: 1 });
  assert.deepEqual(A.parseSongFileName("BillyStrings2018-07-20.HighMeadow.4041.t12.flac"), { disc: 1, track: 12 });
  assert.deepEqual(A.parseSongFileName("TS 2010-01-09 The Bluebird Theater - Denver, CO t19.flac"), { disc: 1, track: 19 });
  // Track tags written "1-07" or "7/15".
  assert.equal(A.tagNumber("7"), 7);
  assert.equal(A.tagNumber("7/15"), 7);
  assert.equal(A.tagNumber("1-07"), 7);
  assert.ok(Number.isNaN(A.tagNumber("")));
});

test("Todd Snider 2005: the real files' tags and setlist give each song its own number", () => {
  const info = A.parseInfoText(text("ToddSnider2005-10-02.txt"));
  const flacs = ["1-07 Unknown Track.flac", "1-15 goodnight.flac"].map((name) => ({
    name, size: 1, meta: A.readFlacMeta(head(`ToddSnider2005-10-02 ${name.replace(".flac", ".head.flac")}`)),
  }));
  assert.equal(flacs[0].meta.tags.TRACKNUMBER, "7", "the tag says 7");
  const { songs, note } = A.buildSongs(flacs, info.setlist);
  assert.deepEqual(songs.map((s) => [s.trackNumber, s.title]), [[7, "Unknown Track"], [15, "Goodnight"]]);
  assert.equal(note, "", "no shared numbers, nothing unmatched");
  // The venue and place on one line, split at the comma.
  assert.equal(info.venue, "Hardly Strictly Bluegrass Festival");
  assert.equal(info.place, "San Francisco CA");
});

test("two songs with one number: marked, and the note says so before storing", () => {
  const flacs = [{ name: "a.flac", meta: { seconds: 10, tags: { TRACKNUMBER: "1", TITLE: "One" } } }, { name: "b.flac", meta: { seconds: 10, tags: { TRACKNUMBER: "1", TITLE: "Two" } } }, { name: "c.flac", meta: { seconds: 10, tags: { TRACKNUMBER: "3", TITLE: "Three" } } }];
  const { songs, note, sharedNumbers } = A.buildSongs(flacs, []);
  assert.deepEqual(sharedNumbers, [1]);
  assert.deepEqual(songs.map((s) => s.sharedNumber), [true, true, false]);
  assert.match(note, /More than one song has the number 1: they'd be stored with the same number\./);
});

test("Trout Steak Revival: Recorded by, Source and Lineage after the setlist; mtx is a matrix; the dated track 11 keeps its place", () => {
  const folder = "tsr2018-11-30.akg460_AT853_sbd.mtx";
  const raw = text(`${folder}.txt`);
  const info = A.parseInfoText(raw);
  assert.equal(info.taper, "Perry Phillipps", "Recorded by: …, not Mixed and Mastered by: …");
  assert.equal(info.source, "AKG460/ck61 (DIN) + AT853c (DIN) + SBD, BOB/DFC/10' high> F8 (24/48) · Audition (re-mixing, mastering, tracking)> FLAC24> Foobar (tagging)");
  assert.equal(info.setlist.length, 20, "all twenty lines, the dated track 11 too");
  assert.equal(info.setlist[10].n, 11);
  assert.equal(info.setlist[11].title, "I Got My Mind Set On You (George Harrison)", "track 12 stays track 12");
  assert.equal(A.parseFolderName(folder).sourceHint, "Matrix", "sbd is one part of the matrix");
  const v = A.prefill({ folder, info, infoText: raw, songs: [] });
  assert.equal(v.source, info.source, "the info file's lines win over the folder name's guess");
  assert.equal(v.taper, "Perry Phillipps");
  assert.deepEqual([v.band, v.venue, v.place, v.date], ["Trout Steak Revival", "Cervantes Masterpiece Ballroom", "Denver, CO", "2018-11-30"]);
  // The folder's guess still fills in when the file says nothing.
  assert.equal(A.prefill({ folder: "band2001-01-01.sbd.flac16", infoText: "Band\n01 Song" }).source, "Soundboard");
});

test("Galactic and Molly Tuttle: TAPED BY at the end, numbered Source lines, Recorded & Mastered By", () => {
  const g = A.parseInfoText(text("galactic2007-07-25.088624.akg414.dsbd.flac16.txt"));
  assert.equal(g.taper, "Mike Horgan");
  assert.equal(g.source, "Matrix - AKG414s onstage + soundboard > Edirol R4");
  assert.equal(g.setlist.length, 21);
  assert.equal(g.setlist[7].title, "Cissy Strut (2)(3)", "footnote markers are kept (owner, Nov 17)");
  const m = A.parseInfoText(text("MollyTuttleMedeirosMaster.txt"));
  assert.equal(m.taper, "Scott Medeiros", "not “Tracked By Mike Boge”");
  assert.match(m.source, /^Schoeps CMC -6 MK41 \+ SBD .* · Telefunken M60 FET .* · SD & CF/);
  assert.equal(m.setlist.length, 20);
});

test("Already imported: songs stored with one number for all mark only themselves (matched by name too)", () => {
  const where = "https://archive.org/details/ToddSnider2005-10-02";
  const stored = ["Introduction Todd Snider by Laura Ellen KPIG", "I Can't Complain", "Goodnight"].map((title) => ({ archiveUrl: where, album: "Todd Snider · HSBF", trackNumber: 1, title }));
  const keys = A.importedKeys(stored);
  const show = { archiveUrl: where };
  assert.ok(A.isImported(keys, show, { trackNumber: 1, title: "Introduction Todd Snider by Laura Ellen KPIG" }));
  assert.ok(!A.isImported(keys, show, { trackNumber: 7, title: "Unknown Track" }), "a song never stored isn't marked");
  assert.ok(!A.isImported(keys, show, { trackNumber: 1, title: "Unknown Track" }), "the shared number alone isn't enough");
  // Once renumbered, the number alone decides again (names may have been edited since).
  const fixed = A.importedKeys([{ archiveUrl: where, trackNumber: 1, title: "Intro" }, { archiveUrl: where, trackNumber: 2, title: "Renamed" }]);
  assert.ok(A.isImported(fixed, show, { trackNumber: 2, title: "I Can't Complain" }));
  // Two songs in the folder with one number: the name decides.
  assert.ok(!A.isImported(fixed, show, { trackNumber: 1, title: "Something else", sharedNumber: true }));
  assert.ok(A.isImported(fixed, show, { trackNumber: 1, title: "intro", sharedNumber: true }));
});

test("a whole show ticked at once keeps its running order across the flip (the Todd Snider C60, Nov 16)", () => {
  // Songs 1 to 8 come to 26:29; then Just Like Old Times (4:20) doesn't fit,
  // and Too Much To Think About (3:16) and Goodnight (0:15) would have gone back to Side A.
  const firsts = [200, 200, 200, 200, 200, 200, 200, 189].map((seconds, i) => ({ uri: `s${i + 1}`, seconds }));
  assert.equal(firsts.reduce((n, s) => n + s.seconds, 0), 26 * 60 + 29);
  const later = [{ uri: "s9", seconds: 260 }, { uri: "s10", seconds: 196 }, { uri: "s11", seconds: 15 }];
  const placed = sidesInOrder([], ["A", "B"], [...firsts, ...later], 30 * 60);
  assert.deepEqual(placed, ["A", "A", "A", "A", "A", "A", "A", "A", "B", "B", "B"]);
  // The old one-at-a-time rule, for comparison (still used for a single tick).
  const old = [];
  let tracks = [];
  for (const s of [...firsts, ...later]) {
    const side = sideFor(tracks, ["A", "B"], s.seconds, 30 * 60);
    old.push(side);
    tracks = [...tracks, { side, seconds: s.seconds }];
  }
  assert.deepEqual(old.slice(8), ["B", "A", "A"], "the bug, as seen");
  // Songs already on the tape count; the first new song goes where it fits.
  assert.deepEqual(sidesInOrder([{ side: "A", seconds: 1790 }], ["A", "B"], [{ seconds: 60 }, { seconds: 5 }], 1800), ["B", "B"]);
  // A show too long for the tape: the rest stays on the last side (its meter shows it's over).
  assert.deepEqual(sidesInOrder([], ["A", "B"], [{ seconds: 1000 }, { seconds: 1000 }, { seconds: 1000 }, { seconds: 1000 }], 1800), ["A", "B", "B", "B"]);
});

test("the support line is the maker's (under the preview), and the C120 line is gone from the tape's J-card", () => {
  assert.equal(mixtape.preview.note, "Please support bands and venues that allow taping by buying merch and attending shows.");
  const player = readFileSync(new URL("../src/tile-types/mixtape/runtime/player.js", import.meta.url), "utf8");
  assert.ok(!/thin tape|Don't let the deck eat it/.test(player), "no C120 joke in the tile's player");
  assert.ok(!/support bands/.test(player), "the support line isn't on the tape");
});

test("Billy Strings 2018: venue lines ending in commas, “Recorded & Transfered by:”, playing times after the names", () => {
  const folder = "BillyStrings2018-07-20.HighMeadow.4041.flac16";
  const raw = text(`${folder}.txt`);
  const info = A.parseInfoText(raw);
  const v = A.prefill({ folder, info, infoText: raw, songs: [] });
  assert.equal(v.band, "Billy Strings");
  assert.equal(v.date, "2018-07-20");
  assert.equal(v.venue, "Grey Fox Bluegrass Festival, High Meadow Stage, Walsh Farm", "the comma lines joined; “[10:15 pm start]” left out");
  assert.equal(v.place, "Oak Hill, NY");
  assert.equal(v.taper, "Seth Nochajski & Keith Januszak");
  assert.match(v.source, /^Audio-Technica 4041s > NADY Audio DMP-2 > Tascam DR-05 \[24\/48\] · MicroSD > PC/);
  assert.equal(info.setlist.length, 12);
  assert.equal(info.setlist[1].title, "Slow Train", "no playing time in the name");
  assert.equal(A.cleanTitle(info.setlist[3].title), "instrumental > How Mountain Girls Can Love");
  assert.deepEqual(info.termsLines, ["Never For Sale"]);
});

