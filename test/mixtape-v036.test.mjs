// Foundry v0.36.0: imported Archive songs (cafe.thunderbird.audio.track) in
// the Choose songs window and on tapes (claude/mixtape-3b-v036-decisions.md,
// R3b-10, R3b-17 to R3b-20).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { trackFromRecord, songFromTrack, listTrackSongs, groupTrackShows, TRACK_COLLECTION } from "../src/tile-types/mixtape/tracks.js";
import { songFromRecord, groupShows, REASONS } from "../src/tile-types/mixtape/plyr.js";
import {
  songMatches, searchWords, sourceOf, sourceMatches, sourceLabel, mergeShows, artistShowLine,
  readMemory, writeMemory, MEMORY_KEY, SOURCE_FILTERS,
} from "../src/tile-types/mixtape/library.js";
import { trackFromSong, hasArchiveSongs, archiveNote, yearOf } from "../src/tile-types/mixtape/workshop.js";
import { applyPanelChange, panelDefaults, panelRecipe } from "../src/tile-types/mixtape/panel.js";
import { makeTape, cleanSource, cleanRights } from "../src/tile-types/mixtape/tape.js";
import { makeMixtapeTile } from "../src/tile-types/mixtape/tile.js";
import { bundleRuntime } from "../src/tile-types/mixtape/runtime/bundle.js";
import { songLine } from "../src/tile-types/mixtape/runtime/player.js";
import { mixtape } from "../src/tile-types/mixtape/index.js";
import { checkInputs, isShown } from "../src/core/contract.js";

const DID = "did:plc:rqbqpaaluty5v47jwciowpik";
const BAND = "Yonder Mountain String Band";
const SHOW = `${BAND} · The Fillmore · 2002-04-20`;
const ARCHIVE = "https://archive.org/details/ymsb2002-04-20.flac16.sbd";
const LINEAGE = "SBD > DAT > ? > CDR > GRIP(wav 16/44.1) > FLAC(16/44.1/Level 8)";
const BLOB = "bafkreibme22gw2h7y2h7tg2fhqotaqjucnbc24deqo72b6mkl2egezxhvy";
const CID = "bafyreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";

// A record as the importer writes it (archive.js buildTrackRecord), like the real show's.
function trackRecord(rkey, n, title, { createdAt = "2026-11-15T03:10:00.000Z", policyUrl, taper, mimeType = "audio/webm", blob = true } = {}) {
  const recording = { date: "2002-04-20", venue: "The Fillmore Auditorium", place: "Denver, CO", set: n > 12 ? "Set 2" : "Set 1", source: LINEAGE, archiveUrl: ARCHIVE };
  if (taper) recording.taper = taper;
  if (policyUrl) recording.policyUrl = policyUrl;
  const value = {
    $type: TRACK_COLLECTION,
    title,
    artist: BAND,
    album: SHOW,
    trackNumber: n,
    duration: 214.5,
    fileType: "webm",
    description: "Yonder Mountain String Band, The Fillmore, Denver, CO, 2002-04-20\n…",
    recording,
    createdAt,
  };
  if (blob) value.audioBlob = { $type: "blob", ref: { $link: BLOB }, mimeType, size: 2_660_000 };
  return { uri: `at://${DID}/${TRACK_COLLECTION}/${rkey}`, cid: CID, value };
}

function plyrRecord(rkey, title, album, createdAt) {
  return {
    uri: `at://${DID}/fm.plyr.track/${rkey}`,
    cid: CID,
    value: { title, album, artist: "pyxorium.com", duration: 300, createdAt, audioBlob: { $type: "blob", ref: { $link: BLOB }, mimeType: "audio/mpeg", size: 4_000_000 } },
  };
}

test("an imported track becomes a song like a plyr.fm one, with its recording's details", () => {
  const s = songFromTrack(trackFromRecord(trackRecord("3n2aaaaaaaa22", 2, "Loved You Enough")));
  assert.equal(s.kind, "archive");
  assert.equal(s.title, "Loved You Enough");
  assert.equal(s.artist, BAND, "an Archive song's artist is the performer, kept (unlike plyr.fm's uploader)");
  assert.equal(s.album, SHOW);
  assert.equal(s.trackNumber, 2);
  assert.equal(s.seconds, 214.5);
  assert.deepEqual(s.blob, { cid: BLOB, size: 2_660_000, mimeType: "audio/webm" });
  assert.ok(s.usable);
  assert.equal(s.venue, "The Fillmore Auditorium");
  assert.equal(s.place, "Denver, CO");
  assert.equal(s.archiveUrl, ARCHIVE);
  assert.equal(s.source, LINEAGE);
  assert.equal(s.policyUrl, "");
  const none = songFromTrack(trackFromRecord(trackRecord("3n2aaaaaaab22", 3, "x", { blob: false })));
  assert.equal(none.usable, false);
  assert.equal(none.reason, "noAudio");
  const odd = songFromTrack(trackFromRecord(trackRecord("3n2aaaaaaac22", 4, "y", { mimeType: "application/octet-stream" })));
  assert.equal(odd.reason, "format");
  assert.ok(REASONS.format && REASONS.noAudio);
  assert.equal(songFromRecord(plyrRecord("3lzaaaaaaaa22", "Jam", "Show", "2026-10-01T00:00:00Z")).kind, "plyr");
});

test("imported songs are listed page by page from the account's own server", async () => {
  const pages = [
    { records: [trackRecord("3n2aaaaaaaa22", 2, "Loved You Enough"), trackRecord("3n2aaaaaaab22", 7, "Lord Only Knows (Pt. 1)")], cursor: "c1" },
    { records: [trackRecord("3n2aaaaaaac22", 1, "Darling One")] },
  ];
  const asked = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    asked.push(u);
    const page = u.searchParams.get("cursor") ? pages[1] : pages[0];
    return { ok: true, status: 200, json: async () => page };
  };
  const songs = await listTrackSongs({ did: DID, pds: "https://meadow.us-east.host.bsky.network", fetchImpl });
  assert.equal(songs.length, 3);
  assert.equal(asked[0].searchParams.get("collection"), "cafe.thunderbird.audio.track");
  assert.equal(asked[1].searchParams.get("cursor"), "c1");
  const [g] = groupTrackShows(songs);
  assert.equal(g.kind, "archive");
  assert.equal(g.album, SHOW);
  assert.equal(g.usable, 3);
  assert.deepEqual(g.songs.map((s) => s.trackNumber), [1, 2, 7], "in the show's order");
});

test("one library: recordings and plyr.fm shows together, newest added first", () => {
  const plyr = groupShows([
    songFromRecord(plyrRecord("3lzaaaaaaaa22", "Jam", "Galactic · Moguls · 1997-08-15", "2026-10-20T00:00:00Z")),
    songFromRecord(plyrRecord("3lzaaaaaaab22", "Ripper", "Band of Heathens · Grey Eagle · 2011-02-17", "2026-11-14T12:00:00Z")),
  ]);
  const old = groupTrackShows([songFromTrack(trackFromRecord(trackRecord("3n2aaaaaaaa22", 2, "Loved You Enough", { createdAt: "2026-11-15T03:10:00.000Z" })))]);
  const list = mergeShows(plyr, old);
  assert.deepEqual(list.map((g) => g.album), [SHOW, "Band of Heathens · Grey Eagle · 2011-02-17", "Galactic · Moguls · 1997-08-15"], "a 2002 concert imported today is at the top");
  assert.deepEqual(list.map(sourceLabel), ["Archive", "plyr.fm", "plyr.fm"]);
  assert.deepEqual(list.map(sourceOf), ["archive", "plyr", "plyr"]);
  assert.deepEqual(SOURCE_FILTERS.map((f) => f.label), ["All", "plyr.fm", "Archive"]);
  assert.deepEqual(list.filter((g) => sourceMatches(g, "archive")).map((g) => g.album), [SHOW]);
  assert.equal(list.filter((g) => sourceMatches(g, "plyr")).length, 2);
  assert.equal(list.filter((g) => sourceMatches(g, "all")).length, 3);
});

test("search also finds an imported song's venue, place, taper and date", () => {
  const s = songFromTrack(trackFromRecord(trackRecord("3n2aaaaaaaa22", 2, "Loved You Enough", { taper: "Jim Smith" })));
  assert.ok(songMatches(s, searchWords("auditorium"), s.album), "the venue (the show name says only The Fillmore)");
  assert.ok(songMatches(s, searchWords("denver"), s.album));
  assert.ok(songMatches(s, searchWords("smith yonder"), s.album));
  assert.ok(songMatches(s, searchWords("2002-04"), s.album));
  assert.ok(!songMatches(s, searchWords("boulder"), s.album));
});

test("the window remembers the source filter; anything else reads as All", () => {
  const m = new Map();
  const st = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
  writeMemory(st, { open: ["x"], scroll: 10, source: "archive" });
  assert.deepEqual(readMemory(st), { open: ["x"], scroll: 10, source: "archive" });
  m.set(MEMORY_KEY, JSON.stringify({ open: [], scroll: 0, source: "spotify" }));
  assert.equal(readMemory(st).source, "all");
});

test("the band isn't shown twice on a song's line (R3b-18), in the window's rules and the tile's player", () => {
  for (const line of [artistShowLine, songLine]) {
    assert.equal(line(BAND, SHOW), SHOW);
    assert.equal(line("yonder mountain string band", SHOW), SHOW, "any case");
    assert.equal(line("Galactic", "Moguls · 1997-08-15"), "Galactic · Moguls · 1997-08-15");
    assert.equal(line("Yonder", SHOW), `Yonder · ${SHOW}`, "only the whole artist name counts");
    assert.equal(line("", SHOW), SHOW);
    assert.equal(line(BAND, ""), BAND);
    assert.equal(line(BAND, BAND), `${BAND} · ${BAND}`, "a show named just the band is left alone");
  }
});

test("an imported song on the tape carries its year and credits: Archive address, taper and source, policy link", () => {
  const s = songFromTrack(trackFromRecord(trackRecord("3n2aaaaaaaa22", 2, "Loved You Enough", { taper: "Jim Smith", policyUrl: "https://archive.org/details/YonderMountainStringBand" })));
  const t = trackFromSong(s, "A");
  assert.equal(t.kind, "archive");
  assert.equal(t.year, 2002);
  assert.equal(t.artist, BAND);
  assert.deepEqual(t.source, { record: { uri: s.uri, cid: CID }, url: ARCHIVE, note: `Taper: Jim Smith · ${LINEAGE}` });
  assert.deepEqual(t.rights, { url: "https://archive.org/details/YonderMountainStringBand" });
  const bare = trackFromSong(songFromTrack(trackFromRecord(trackRecord("3n2aaaaaaab22", 7, "Lord Only Knows (Pt. 1)"))), "A");
  assert.equal(bare.source.note, LINEAGE, "no taper (the sample's \"Taper: Unknown\" was left empty)");
  assert.ok(!("rights" in bare), "no policy link: no rights");
  const plyr = trackFromSong(songFromRecord(plyrRecord("3lzaaaaaaaa22", "Jam", "Show", "2026-10-01T00:00:00Z")), "A");
  assert.ok(!("kind" in plyr) && !("rights" in plyr) && !("year" in plyr));
  assert.deepEqual(Object.keys(plyr.source), ["record"]);
  assert.equal(archiveNote({}), "");
  assert.equal(yearOf("1997-08"), 1997);
  assert.equal(yearOf("summer"), undefined);
});

test("tape.json keeps source.note and rights.url, checked", () => {
  assert.deepEqual(cleanSource({ url: ARCHIVE, note: "  Taper: X\n · SBD  " }), { url: ARCHIVE, note: "Taper: X · SBD" });
  assert.deepEqual(cleanRights({ url: "https://example.com/policy", license: "x" }), { url: "https://example.com/policy" });
  assert.equal(cleanRights({ url: "http://example.com/policy" }), null, "https only");
  assert.equal(cleanRights({ url: "javascript:alert(1)" }), null);
  assert.equal(cleanRights(null), null);
  const tape = makeTape({
    title: "Mixed",
    sides: [{ name: "A", tracks: [{ path: "/tracks/a1.mp3", cid: BLOB, title: "Loved You Enough", artist: BAND, album: SHOW, year: 2002, duration: 214.5, rights: { url: "https://example.com/p" }, source: { record: { uri: `at://${DID}/${TRACK_COLLECTION}/3n2aaaaaaaa22`, cid: CID }, url: ARCHIVE, note: LINEAGE } }] }],
  });
  const t = tape.sides[0].tracks[0];
  assert.equal(t.year, 2002);
  assert.deepEqual(t.rights, { url: "https://example.com/p" });
  assert.deepEqual(t.source, { record: { uri: `at://${DID}/${TRACK_COLLECTION}/3n2aaaaaaaa22`, cid: CID }, url: ARCHIVE, note: LINEAGE });
});

test("a mixed tape tile: the Archive song's credits are in tape.json", async () => {
  const esbuild = await import("esbuild");
  const runtime = (await bundleRuntime(esbuild)).code;
  const tone = new Uint8Array(readFileSync(new URL("./fixtures/audio/tone-a-96k-32k.mp3", import.meta.url)));
  const arch = trackFromSong(songFromTrack(trackFromRecord(trackRecord("3n2aaaaaaaa22", 2, "Loved You Enough", { policyUrl: "https://example.com/p" }))), "A");
  const plyr = trackFromSong(songFromRecord(plyrRecord("3lzaaaaaaaa22", "Jam", "Galactic · Moguls · 1997-08-15", "2026-10-01T00:00:00Z")), "A");
  const tracks = [arch, plyr].map((t) => ({ ...t, status: "ready", bytes: tone, seconds: 1, transition: "straight" }));
  const tile = await makeMixtapeTile({ name: "Mixed", sides: ["A", "B"], tracks, runtime, recipe: panelRecipe({ tracks, confirmShared: true }) });
  const tape = JSON.parse(new TextDecoder().decode(tile.files.find((f) => f.path === "/tape.json").bytes));
  const [a1, a2] = tape.sides[0].tracks;
  assert.equal(a1.year, 2002);
  assert.deepEqual(a1.rights, { url: "https://example.com/p" });
  assert.equal(a1.source.url, ARCHIVE);
  assert.equal(a1.source.note, LINEAGE);
  assert.equal(a1.source.record.uri, arch.id);
  assert.ok(!("rights" in a2));
  assert.deepEqual(tile.recipeInputs.panel.songsFrom, [{ kind: "audio.track", did: DID }, { kind: "plyr.fm", did: DID }]);
  assert.equal(tile.recipeInputs.panel.confirmed, true);
});

test("the confirmation follows the songs (R3b-20) and unticks when its words change", () => {
  const plyr = { ...trackFromSong(songFromRecord(plyrRecord("3lzaaaaaaaa22", "Jam", "Show", "2026-10-01T00:00:00Z")), "A"), status: "ready", seconds: 1 };
  const plyr2 = { ...trackFromSong(songFromRecord(plyrRecord("3lzaaaaaaab22", "Ripper", "Show", "2026-10-01T00:00:00Z")), "A"), status: "ready", seconds: 1 };
  const arch = { ...trackFromSong(songFromTrack(trackFromRecord(trackRecord("3n2aaaaaaaa22", 2, "Loved You Enough"))), "A"), status: "ready", seconds: 1 };
  const confirm = mixtape.inputs.find((i) => i.key === "confirm");
  const shared = mixtape.inputs.find((i) => i.key === "confirmShared");
  assert.equal(confirm.label, "These are my plyr.fm uploads, and I'm happy to publish them in a tile.");
  assert.equal(shared.label, "These songs are my own uploads or recordings, or come from artists who allow non-commercial sharing (such as the Live Music Archive), and this tape is free to listen to.");
  for (const i of [confirm, shared]) {
    assert.equal(i.help, "A copy of each song goes into the tape, in your account.");
    assert.ok(!/delete/i.test(i.help), "nothing about deleting");
  }

  let v = { ...panelDefaults({ handle: "pyxorium.com" }), name: "Mixed", tracks: [plyr], confirm: true };
  assert.ok(isShown(confirm, v) && !isShown(shared, v));
  assert.ok(!checkInputs(mixtape, v).some((p) => p.key === "confirm" || p.key === "confirmShared"), "a plyr.fm-only tape: today's tick is enough");
  v = applyPanelChange("tracks", [plyr, plyr2], v).values;
  assert.equal(v.confirm, true, "another plyr.fm song: the words don't change, the tick stays");

  v = applyPanelChange("tracks", [plyr, plyr2, arch], v).values;
  assert.equal(v.confirm, false, "the first Archive song: unticked");
  assert.ok(!isShown(confirm, v) && isShown(shared, v));
  assert.ok(checkInputs(mixtape, v).some((p) => p.key === "confirmShared" && p.publishOnly), "the broader words must be ticked to publish");
  v = { ...v, confirmShared: true };
  assert.ok(!checkInputs(mixtape, v).some((p) => p.key === "confirmShared"));
  assert.equal(panelRecipe(v).confirmed, true);
  v = applyPanelChange("tracks", [arch, plyr], v).values;
  assert.equal(v.confirmShared, true, "moving songs about: still ticked");

  v = applyPanelChange("tracks", [plyr], v).values;
  assert.equal(v.confirmShared, false, "the last Archive song taken off: unticked again");
  assert.equal(v.confirm, false);
  assert.ok(isShown(confirm, v));
  assert.equal(panelRecipe(v).confirmed, false);
  assert.ok(hasArchiveSongs([{ id: `at://${DID}/${TRACK_COLLECTION}/3n2x` }]), "known by its record type too (a draft made before kind was kept)");
  assert.ok(!hasArchiveSongs([plyr]));
});
