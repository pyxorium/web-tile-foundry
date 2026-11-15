// Mixtape Burndown's importer (v0.35.0): reading a recording's folder
// (src/tile-types/mixtape/archive.js) and the stored songs' sizes
// (src/core/audio/opus.js). The info file below is made up, laid out like a
// real Live Music Archive info file (the owner's Nov 14 sample: one header
// line, a lineage line, "Taper: Unknown", discs whose track numbers restart,
// set breaks "-Set2-" and "Encores:", segue arrows, a closing Notes paragraph).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as A from "../src/tile-types/mixtape/archive.js";
import { bitrateFor, estimateBytes, BLOB_LIMIT } from "../src/core/audio/opus.js";

const INFO = `Test String Band, The Hall, Springfield, ST, 1999-07-04

SBD > DAT > ? > CDR > EAC(wav 16/44.1) > FLAC(16/44.1/Level 8)

Taper: Unknown
Ripped By: Someone

Disk 1
======
1. Intro > First Light
2. Tune Two
3. Third Tune
4. Long Road(Pt. 1)>
5. Bridge Jam >
6. Long Road(Pt. 2)
-Set2-
7. Intro > Night Run >
8. Back Again >
Disk 2
======
1. Slow One >
2. Night Run
Encores:
=======
3. Goodnight Waltz

Notes: Given to me on CD. Please don't sell this recording.
Not for commercial use, and keep it lossless when trading.`;

test("the info file: header, lineage, taper, setlist with discs and sets, terms lines", () => {
  const info = A.parseInfoText(INFO);
  assert.equal(info.band, "Test String Band");
  assert.equal(info.venue, "The Hall");
  assert.equal(info.place, "Springfield, ST");
  assert.equal(info.date, "1999-07-04");
  assert.equal(info.taper, "", "Taper: Unknown is no taper");
  assert.equal(info.source, "SBD > DAT > ? > CDR > EAC(wav 16/44.1) > FLAC(16/44.1/Level 8)");
  assert.equal(info.setlist.length, 11, "the lineage line isn't a song");
  assert.deepEqual(info.setlist.map((s) => `${s.disc}.${s.n} ${s.set}`), [
    "1.1 Set 1", "1.2 Set 1", "1.3 Set 1", "1.4 Set 1", "1.5 Set 1", "1.6 Set 1",
    "1.7 Set 2", "1.8 Set 2", "2.1 Set 2", "2.2 Set 2", "2.3 Encore",
  ]);
  assert.equal(info.setlist[0].title, "Intro > First Light");
  assert.ok(info.termsLines.some((l) => /don't sell/.test(l)));
  assert.ok(info.termsLines.some((l) => /lossless/.test(l)));
  assert.ok(!info.termsLines.some((l) => /^SBD/.test(l)), "the lineage line (FLAC) isn't a terms line");
});

test("the info file: other layouts (one thing per line, written dates, inline encores, Set I)", () => {
  const info = A.parseInfoText(`Other Band
Red Rocks Amphitheatre
Morrison, CO
August 15, 1997

Source: Schoeps MK4 > Sony D8 (DAT)
Taped by: Jo Q.

Set I
01. Opener
02. Second
Set II
03. Third
E: Closer`);
  assert.equal(info.band, "Other Band");
  assert.equal(info.venue, "Red Rocks Amphitheatre");
  assert.equal(info.place, "Morrison, CO");
  assert.equal(info.date, "1997-08-15");
  assert.equal(info.taper, "Jo Q.");
  assert.match(info.source, /Schoeps/);
  assert.deepEqual(info.setlist.map((s) => [s.title, s.set]), [["Opener", "Set 1"], ["Second", "Set 1"], ["Third", "Set 2"], ["Closer", "Encore"]]);
  const none = A.parseInfoText("");
  assert.deepEqual(none.setlist, []);
  assert.equal(none.band, "");
  assert.equal(A.parseInfoText("Band\n1. Song\n2. Song Two").setlist[0].set, "", "no set markers: no sets");
});

test("folder names, song file names and dates", () => {
  assert.deepEqual(A.parseFolderName("ymsb2002-04-20.flac16.sbd"), {
    identifier: "ymsb2002-04-20.flac16.sbd", archiveUrl: "https://archive.org/details/ymsb2002-04-20.flac16.sbd", date: "2002-04-20", sourceHint: "Soundboard",
  });
  assert.equal(A.parseFolderName("galactic1997-08-15.flac16").sourceHint, "");
  assert.equal(A.parseFolderName("band1999-01-01.aud.smith.flac").sourceHint, "Audience");
  assert.equal(A.parseFolderName("My Recordings").archiveUrl, null, "not an Archive identifier");
  assert.deepEqual(A.parseSongFileName("ymsb2002-04-20d1t02.flac"), { disc: 1, track: 2 });
  assert.deepEqual(A.parseSongFileName("band1997-08-15d2t03.flac"), { disc: 2, track: 3 });
  assert.deepEqual(A.parseSongFileName("gd77-05-08 d3 t11.flac"), { disc: 3, track: 11 });
  assert.deepEqual(A.parseSongFileName("show-t07.flac"), { disc: 1, track: 7 });
  assert.deepEqual(A.parseSongFileName("05 Some Song.flac"), { disc: 1, track: 5 });
  assert.equal(A.parseSongFileName("song.flac"), null);
  assert.equal(A.findDate("1997.08.15").date, "1997-08-15");
  assert.equal(A.findDate("8/15/97").date, "1997-08-15");
  assert.equal(A.findDate("no date"), null);
});

test("titles: an arrow at the end is dropped, one between two names stays (R3b-16); placeholders", () => {
  assert.equal(A.cleanTitle("Bolton Stretch >"), "Bolton Stretch");
  assert.equal(A.cleanTitle("Lord Only Knows(Pt. 1) >"), "Lord Only Knows (Pt. 1)");
  assert.equal(A.cleanTitle("Mothers Only Son ->"), "Mothers Only Son");
  assert.equal(A.cleanTitle("Intro > New Horizons"), "Intro > New Horizons");
  assert.equal(A.cleanTitle("Intro > Ramblin' In The Rambler >"), "Intro > Ramblin' In The Rambler");
  for (const p of ["Track 03", "Unknown", "Untitled", "???", "", "07", "audio track 2"]) assert.ok(A.isPlaceholder(p), p);
  assert.ok(A.isPlaceholder("ymsb2002-04-20d1t02", "ymsb2002-04-20d1t02"), "the file name itself");
  assert.ok(!A.isPlaceholder("Jam"));
});

test("FLAC tags and length from a real (tiny) FLAC file; more bytes asked for when cut short", () => {
  const bytes = new Uint8Array(readFileSync(new URL("./fixtures/tone1999-07-04d1t03.flac", import.meta.url)));
  const meta = A.readFlacMeta(bytes);
  assert.equal(meta.sampleRate, 8000);
  assert.equal(meta.channels, 1);
  assert.equal(meta.bits, 16);
  assert.equal(meta.seconds, 0.5);
  assert.equal(meta.tags.TITLE, "Tune Two >");
  assert.equal(meta.tags.TRACKNUMBER, "03");
  assert.ok(A.readFlacMeta(bytes.subarray(0, 60)).needBytes > 60);
  assert.throws(() => A.readFlacMeta(new TextEncoder().encode("RIFF....WAVE")), /isn't a FLAC/);
});

const meta = (title, seconds = 240) => ({ sampleRate: 44100, seconds, tags: title ? { TITLE: title } : {} });

test("the song list: a few files of a long show are matched by disc and track, no count note", () => {
  const info = A.parseInfoText(INFO);
  const flacs = [
    { name: "tone1999-07-04d1t02.flac", size: 10, meta: meta("Tune Two") },
    { name: "tone1999-07-04d1t04.flac", size: 10, meta: meta("Long Road(Pt. 1) >") },
    { name: "tone1999-07-04d2t01.flac", size: 10, meta: meta("") },
    { name: "tone1999-07-04d2t03.flac", size: 10, meta: meta("Track 03") },
  ];
  const { songs, note } = A.buildSongs(flacs, info.setlist);
  assert.equal(note, "");
  assert.deepEqual(songs.map((s) => [s.trackNumber, s.title, s.from, s.set]), [
    [2, "Tune Two", "tags", "Set 1"],
    [4, "Long Road (Pt. 1)", "tags", "Set 1"],
    [9, "Slow One", "setlist", "Set 2"],
    [11, "Goodnight Waltz", "setlist", "Encore"],
  ]);
  assert.ok(songs.every((s) => !s.unknownName));
});

test("the song list: count notes, file names as a last resort, unknown names marked", () => {
  const setlist = A.parseInfoText("1. One\n2. Two").setlist;
  const three = ["x1999-01-01t01.flac", "x1999-01-01t02.flac", "x1999-01-01t03.flac"].map((name) => ({ name, size: 1, meta: meta("") }));
  const a = A.buildSongs(three, setlist);
  assert.equal(a.note, "The setlist has 2 songs but the folder has 3 files: please check the names.");
  assert.equal(a.songs[2].title, "x1999-01-01t03");
  assert.equal(a.songs[2].from, "file");
  assert.ok(a.songs[2].unknownName);
  const b = A.buildSongs([{ name: "x1999-01-01d2t05.flac", size: 1, meta: meta("") }], setlist);
  assert.match(b.note, /^1 file has no matching song in the setlist/);
  assert.equal(A.buildSongs(three, []).note, "", "no setlist: nothing to compare");
  const c = A.buildSongs([{ name: "broken.flac", size: 1, meta: null }], []);
  assert.equal(c.songs[0].seconds, 0);
});

test("files: only the FLACs and the info .txt of an Archive folder downloaded whole", () => {
  const names = [
    "x1999d1t01.flac", "x1999d1t02.FLAC", "x1999.txt", "x1999d1t01.mp3", "x1999d1t01.ogg", "x1999d1t01.png", "x1999d1t01.afpk",
    "x1999d1t01_esshigh.json.gz", "x1999d1t01_esslow.json.gz", "x1999d1t01_spectrogram.png", "x1999_files.xml", "x1999_meta.xml",
    "x1999_reviews.xml", "x1999_archive.torrent", "cover.jpg", "x1999.ffp", "x1999.md5", "x1999.ffp.txt", "x1999_files.txt",
  ];
  const { flacs, texts, ignored } = A.sortFiles(names.map((name) => ({ name })));
  assert.deepEqual(flacs.map((f) => f.name), ["x1999d1t01.flac", "x1999d1t02.FLAC"]);
  assert.deepEqual(texts.map((f) => f.name), ["x1999.txt"]);
  assert.equal(ignored.length, names.length - 3);
  assert.equal(A.folderOf([{ webkitRelativePath: "x1999.flac16/x1999.txt" }]), "x1999.flac16");
  const best = A.pickInfo([{ name: "a.txt", text: "just words" }, { name: "b.txt", text: INFO }]);
  assert.equal(best.name, "b.txt");
});

test("“Where these came from”, prefilled (R3b-5); the policy link remembered per band", () => {
  const info = A.parseInfoText(INFO);
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  A.rememberPolicy(storage, "Test  String band", "https://example.org/policy");
  const v = A.prefill({ folder: "tone1999-07-04.flac16.sbd", info, infoText: INFO, songs: [], policies: A.readPolicies(storage) });
  assert.deepEqual({ ...v, description: v.description.slice(0, 16) }, {
    band: "Test String Band", album: "Test String Band · The Hall · 1999-07-04", date: "1999-07-04", venue: "The Hall", place: "Springfield, ST",
    taper: "", source: "SBD > DAT > ? > CDR > EAC(wav 16/44.1) > FLAC(16/44.1/Level 8)",
    archiveUrl: "https://archive.org/details/tone1999-07-04.flac16.sbd", policyUrl: "https://example.org/policy", description: "Test String Band",
  });
  // No info file: the songs' tags fill in what they can.
  const tagged = [{ tagArtist: "Tag Band", tagAlbum: "The Hall, Springfield, ST, 1999-07-04" }];
  const w = A.prefill({ folder: "My recordings", songs: tagged });
  assert.equal(w.band, "Tag Band");
  assert.equal(w.venue, "The Hall");
  assert.equal(w.archiveUrl, "");
  const broken = { getItem: () => "{not json", setItem() { throw new Error("full"); } };
  assert.deepEqual(A.readPolicies(broken), {});
  A.rememberPolicy(broken, "X", "https://x.example");
});

test("the record: lexicon field names, empty parts left out, limits checked", () => {
  const show = { band: "Test String Band", album: "Test String Band · The Hall · 1999-07-04", date: "1999-07-04", venue: "The Hall", place: "", taper: " ", source: "SBD", archiveUrl: "https://archive.org/details/x", policyUrl: "", description: "notes" };
  const blob = { $type: "blob", ref: { $link: "bafkreiabc" }, mimeType: "audio/webm", size: 123 };
  const r = A.buildTrackRecord({ show, song: { title: " Tune Two ", trackNumber: 2, set: "Set 1" }, audioBlob: blob, seconds: 214.37, createdAt: "2026-11-14T00:00:00.000Z" });
  assert.deepEqual(r, {
    $type: "cafe.thunderbird.audio.track", title: "Tune Two", artist: "Test String Band", album: "Test String Band · The Hall · 1999-07-04",
    trackNumber: 2, duration: 214, audioBlob: blob, fileType: "webm", description: "notes",
    recording: { date: "1999-07-04", venue: "The Hall", set: "Set 1", source: "SBD", archiveUrl: "https://archive.org/details/x" },
    createdAt: "2026-11-14T00:00:00.000Z",
  });
  const bare = A.buildTrackRecord({ show: {}, song: { title: "Jam" }, audioBlob: blob, seconds: 0 });
  assert.equal(bare.recording, undefined);
  assert.equal(bare.duration, undefined);
  assert.deepEqual(A.showProblems({ date: "4/20/2002", archiveUrl: "archive.org/x", band: "x".repeat(257) }).map((p) => p.key), ["band", "date", "archiveUrl"]);
  assert.deepEqual(A.showProblems(show), []);
  assert.deepEqual(A.songProblems({ title: "" }).map((p) => p.key), ["title"]);
  assert.deepEqual(A.songProblems({ title: "ok", trackNumber: 1000 }).map((p) => p.key), ["trackNumber"]);
  const long = A.fitDescription(("a line of notes\n").repeat(400));
  assert.ok(long.cut && new TextEncoder().encode(long.text).length <= 5000 && long.text.endsWith("…"));
  assert.deepEqual(A.fitDescription("short"), { text: "short", cut: false });
});

test("already imported: matched by Archive address (or show name) and track number (R3b-15)", () => {
  const keys = A.importedKeys([{ archiveUrl: "https://archive.org/details/x/", album: "Show", trackNumber: 2 }]);
  assert.ok(A.isImported(keys, { archiveUrl: "https://archive.org/details/x" }, { trackNumber: 2 }));
  assert.ok(!A.isImported(keys, { archiveUrl: "https://archive.org/details/x" }, { trackNumber: 3 }));
  assert.ok(A.isImported(keys, { archiveUrl: "", album: "show" }, { trackNumber: 2 }), "no address: the show name");
  assert.ok(!A.isImported(keys, { archiveUrl: "https://archive.org/details/y" }, { trackNumber: 2 }));
});

test("stored sizes: 96 kbps, 64 for long songs, too long beyond (R3b-9)", () => {
  assert.ok(estimateBytes(3600) < BLOB_LIMIT, "an hour fits at 96");
  assert.deepEqual(bitrateFor(300).kbps, 96);
  const seventyFive = bitrateFor(75 * 60);
  assert.equal(seventyFive.kbps, 64);
  assert.ok(seventyFive.long && !seventyFive.tooLong);
  assert.ok(bitrateFor(110 * 60).tooLong);
});
