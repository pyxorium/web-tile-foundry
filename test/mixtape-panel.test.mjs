// Mixtape stage 4: the panel (plyr.fm songs, the song list's conversions,
// the panel's rules) and the core additions it needed (credits, a
// confirmation needed only to publish).
// Run with:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { mixtape } from "../src/tile-types/mixtape/index.js";
import { songFromRecord, groupShows, listPlyrSongs, stripTrackNumber, REASONS } from "../src/tile-types/mixtape/plyr.js";
import { normalizeTracks, createWorkshop, trackFromSong, sideFor, SIDE_SECONDS } from "../src/tile-types/mixtape/workshop.js";
import { SIDES, panelDefaults, addShowsToNotes, splitWords, tapeDetails, panelRecipe, applyPanelChange, showsOf } from "../src/tile-types/mixtape/panel.js";
import { TIMING } from "../src/tile-types/mixtape/transitions.js";
import { KITS, DEFAULT_KIT, kitById, kitColors } from "../src/tile-types/mixtape/kits.js";
import { cassetteWords } from "../src/tile-types/mixtape/art.js";
import { cleanLabel } from "../src/tile-types/mixtape/tape.js";
import { checkTileType, checkInputs, buildProblems } from "../src/core/contract.js";
import { publishTile, REPO_DESTINATION } from "../src/core/publish.js";

const DID = "did:plc:rqbqpaaluty5v47jwciowpik";
const SHOW = "Parlor Greens at Jam Cruise 2026-02-07";
const BLOB = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";

// Shaped like the real records on pyxorium.com (Oct 2026).
function record(n, title, { album = SHOW, blob = true, gated = false, created = "2026-03-16T15:39:13Z", duration = 282 } = {}) {
  const value = {
    $type: "fm.plyr.track",
    album,
    title,
    artist: "pyxorium.com",
    audioUrl: "https://pub-d4ed8a1e39d44dac85263d86ad5676fd.r2.dev/audio/x.mp3",
    duration,
    fileType: "mp3",
    createdAt: created,
  };
  if (blob) value.audioBlob = { $type: "blob", ref: { $link: BLOB }, mimeType: "audio/mpeg", size: 6948090 };
  if (gated) value.supportGate = { type: "any" };
  return { uri: `at://${DID}/fm.plyr.track/3mh6s4oyoie${n}`, cid: "bafyreiddr5wxqighsg3jkqlo2vws5uat2ydajvcvhpvpwgqtak6z2a6f4u", value };
}

// ---- the type and the core additions ---------------------------------------------

test("the Mixtape type follows the contract and starts with an empty tape", () => {
  checkTileType(mixtape);
  const v = mixtape.defaults({ handle: "pyxorium.com" });
  assert.equal(v.name, "A mixtape from @pyxorium.com");
  assert.deepEqual(v.tracks, []);
  assert.equal(v.confirm, false);
  assert.equal(mixtape.maxBytes, 50 * 1024 * 1024);
  assert.ok(mixtape.credits[0].some((p) => p.text === "lamejs"));
});

test("an unticked confirmation stops publishing but not building or the preview", () => {
  const v = { ...panelDefaults({ handle: "pyxorium.com" }), tracks: [{ id: "a", title: "x", side: "A", seconds: 5, status: "ready", bytes: new Uint8Array([1]) }] };
  const problems = checkInputs(mixtape, v);
  assert.deepEqual(problems.map((p) => [p.key, !!p.publishOnly]), [["confirm", true]]);
  assert.deepEqual(buildProblems(problems), []);
  assert.deepEqual(checkInputs(mixtape, { ...v, confirm: true }), []);
  // No songs: a real problem.
  assert.ok(buildProblems(checkInputs(mixtape, { ...v, tracks: [] })).some((p) => p.key === "tracks"));
});

test("the contract checks credits and mustBeOn", () => {
  const base = { id: "t", version: 1, title: "T", summary: "s", defaults: () => ({}), build: async () => ({}) };
  assert.throws(() => checkTileType({ ...base, inputs: [{ key: "a", kind: "text", mustBeOn: "x" }] }), /mustBeOn/);
  assert.throws(() => checkTileType({ ...base, inputs: [], credits: [["ok", { text: "x", href: "javascript:alert(1)" }]] }), /credits/);
  assert.throws(() => checkTileType({ ...base, inputs: [], credits: "thanks" }), /credits/);
  checkTileType({ ...base, inputs: [], credits: [["Thanks to ", { text: "x", href: "https://x.example/" }, "."]] });
});

test("publishing takes a destination; only the public repo for now", async () => {
  assert.equal(REPO_DESTINATION.kind, "repo");
  await assert.rejects(publishTile({ xrpc: async () => ({}), fetchBlob: async () => null, did: DID, result: { files: [] }, destination: { kind: "space" } }), /isn't supported yet/);
});

// ---- plyr.fm songs -------------------------------------------------------------------

test("a plyr.fm record becomes a song; songs without a file on the account are kept but can't be used", () => {
  const s = songFromRecord(record("a", "15 My Sweet Lord"), { owner: "pyxorium.com" });
  assert.equal(s.title, "My Sweet Lord");
  assert.equal(s.trackNumber, 15);
  assert.equal(s.album, SHOW);
  assert.equal(s.artist, "", "plyr.fm's artist is the uploader's handle, not the band");
  assert.equal(s.seconds, 282);
  assert.deepEqual(s.blob, { cid: BLOB, size: 6948090, mimeType: "audio/mpeg" });
  assert.ok(s.usable);
  const old = songFromRecord(record("b", "15 Wharf Rat", { blob: false }));
  assert.equal(old.usable, false);
  assert.equal(old.reason, "storage");
  assert.ok(REASONS.storage);
  assert.equal(songFromRecord(record("c", "x", { gated: true })).reason, "gated");
  const band = songFromRecord({ ...record("d", "Jam"), value: { ...record("d", "Jam").value, artist: "Parlor Greens" } }, { owner: "pyxorium.com" });
  assert.equal(band.artist, "Parlor Greens");
  assert.equal(stripTrackNumber("03. The Ripper"), "The Ripper");
  assert.equal(stripTrackNumber("1999"), "1999");
});

test("songs are grouped by show, newest show first, in track order", () => {
  const songs = [
    record("1", "10 Ten", { album: "Old show", created: "2026-01-01T00:00:00Z", blob: false }),
    record("2", "2 Two"),
    record("3", "10 Ten"),
    record("4", "1 One"),
  ].map((r) => songFromRecord(r));
  const shows = groupShows(songs);
  assert.deepEqual(shows.map((g) => g.album), [SHOW, "Old show"]);
  assert.deepEqual(shows[0].songs.map((s) => s.trackNumber), [1, 2, 10]);
  assert.equal(shows[1].usable, 0);
});

test("all of an account's songs are listed, page by page", async () => {
  const pages = [
    { records: [record("1", "1 A"), record("2", "2 B")], cursor: "c1" },
    { records: [record("3", "3 C")], cursor: "c2" },
    { records: [] },
  ];
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(new URL(url));
    return { ok: true, json: async () => pages[seen.length - 1] };
  };
  const songs = await listPlyrSongs({ did: DID, pds: "https://pds.example", owner: "pyxorium.com", fetchImpl });
  assert.equal(songs.length, 3);
  assert.equal(seen[0].searchParams.get("collection"), "fm.plyr.track");
  assert.equal(seen[0].searchParams.get("repo"), DID);
  assert.equal(seen[1].searchParams.get("cursor"), "c1");
  await assert.rejects(listPlyrSongs({ did: DID, pds: "https://pds.example", fetchImpl: async () => ({ ok: false, status: 502 }) }), /502/);
});

// ---- the song list -------------------------------------------------------------------

const song = (n, title, extra = {}) => ({ id: `s${n}`, title, album: SHOW, side: "A", seconds: 60, status: "converting", ...extra });

test("back-to-back songs from a show go straight on until the creator picks otherwise", () => {
  const list = normalizeTracks([song(1, "x", { trackNumber: 3 }), song(2, "y", { trackNumber: 4 }), song(3, "z", { trackNumber: 9 })], SIDES);
  assert.deepEqual(list.map((t) => t.transition), ["straight", "fade", undefined]);
  const chosen = normalizeTracks([song(1, "x", { trackNumber: 3, transition: "pause", transitionChosen: true }), song(2, "y", { trackNumber: 4 })], SIDES);
  assert.equal(chosen[0].transition, "pause");
  const same = normalizeTracks(list, SIDES);
  assert.equal(same, list, "no change gives the same list");
});

test("a song whose audio no longer fits its place is converted again", () => {
  const fades = { fadeIn: 0, fadeOut: 0 };
  const ready = (n, extra) => song(n, "t", { status: "ready", bytes: new Uint8Array([1]), fades, ...extra });
  const list = normalizeTracks([ready(1, { transition: "straight", transitionChosen: true }), ready(2)], SIDES);
  assert.deepEqual(list.map((t) => t.status), ["ready", "ready"]);
  const changed = normalizeTracks([{ ...list[0], transition: "fade" }, list[1]], SIDES);
  assert.deepEqual(changed.map((t) => t.status), ["converting", "converting"], "fade-out on the first, fade-in on the second");
});

test("new songs go on side A until it is full", () => {
  const full = [song(1, "a", { seconds: SIDE_SECONDS - 100 })];
  assert.equal(sideFor([], SIDES, 300), "A");
  assert.equal(sideFor(full, SIDES, 300), "B");
  assert.equal(sideFor(full, SIDES, 50), "A");
  const t = trackFromSong(songFromRecord(record("a", "15 My Sweet Lord")), "B");
  assert.equal(t.id, `at://${DID}/fm.plyr.track/3mh6s4oyoiea`);
  assert.equal(t.side, "B");
  assert.equal(t.blobCid, BLOB);
  assert.deepEqual(t.source.record.cid, "bafyreiddr5wxqighsg3jkqlo2vws5uat2ydajvcvhpvpwgqtak6z2a6f4u");
});

// A stand-in for the Foundry: the song list as state, normalized on every
// change (the type's applyChange), and the workshop told after each change
// (the picker's update).
function harness({ failFirst = null } = {}) {
  let state = [];
  const downloads = [];
  const conversions = [];
  let fail = failFirst;
  let workshop;
  const setTracks = (next) => {
    const resolved = typeof next === "function" ? next(state) : next;
    state = applyPanelChange("tracks", resolved, { tracks: state }).values.tracks;
    queueMicrotask(() => workshop.sync(state));
  };
  workshop = createWorkshop({
    sides: SIDES,
    setTracks,
    download: async (t) => {
      downloads.push(t.id);
      if (fail === t.id) {
        fail = null;
        throw new Error("network down");
      }
      return new Uint8Array([t.id.length]);
    },
    convert: async (bytes, fades, onProgress) => {
      conversions.push({ bytes: bytes[0], ...fades });
      onProgress("encoding", 50);
      await new Promise((r) => setTimeout(r, 2));
      return { bytes: new Uint8Array([bytes[0], fades.fadeIn * 10, fades.fadeOut * 10]), seconds: 60 };
    },
  });
  const settle = async () => {
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 5));
      if (state.every((t) => t.status !== "converting")) return;
    }
    throw new Error("still converting: " + JSON.stringify(state.map((t) => [t.id, t.status])));
  };
  return { get state() { return state; }, setTracks, workshop, settle, downloads, conversions };
}

test("songs convert with the fades their place calls for, and moving one converts only what changed", async () => {
  const h = harness();
  h.setTracks([song(1, "One", { trackNumber: 1 }), song(2, "Two", { trackNumber: 2 }), song(3, "Nine", { trackNumber: 9 })]);
  await h.settle();
  // 1 -> 2 straight (back to back), 2 -> 3 fade.
  assert.deepEqual(h.state.map((t) => [t.status, t.fades]), [
    ["ready", { fadeIn: 0, fadeOut: 0 }],
    ["ready", { fadeIn: 0, fadeOut: TIMING.fade.fadeOut }],
    ["ready", { fadeIn: TIMING.fade.fadeIn, fadeOut: 0 }],
  ]);
  assert.equal(h.conversions.length, 3);
  assert.equal(h.downloads.length, 3);

  // Move song 3 to the top: it loses its fade-in and fades out into song 1, which fades in;
  // song 2 is now last, so no fade-out.
  const [a, b, c] = h.state;
  h.setTracks([c, a, b]);
  await h.settle();
  assert.equal(h.conversions.length, 6, "three songs changed");
  assert.equal(h.downloads.length, 3, "each song is downloaded once");

  // Move it back: every conversion is kept, so nothing converts again.
  const [c2, a2, b2] = h.state;
  h.setTracks([a2, b2, c2]);
  await h.settle();
  assert.equal(h.conversions.length, 6);
  assert.deepEqual(h.state.map((t) => t.status), ["ready", "ready", "ready"]);

  // "Short pause" instead of "Fade and pause" after song 2: song 2 no longer
  // fades out (it was made that way when it was last, so that's reused) and
  // song 3 no longer fades in (new).
  h.setTracks(h.state.map((t, i) => (i === 1 ? { ...t, transition: "pause", transitionChosen: true } : t)));
  await h.settle();
  assert.equal(h.conversions.length, 7);
  assert.deepEqual(h.state.map((t) => t.fades), [{ fadeIn: 0, fadeOut: 0 }, { fadeIn: 0, fadeOut: 0 }, { fadeIn: 0, fadeOut: 0 }]);
  assert.equal(h.state[1].transition, "pause");
});

test("a failed download shows as an error and can be tried again", async () => {
  const h = harness({ failFirst: "s1" });
  h.setTracks([song(1, "One")]);
  await h.settle();
  assert.equal(h.state[0].status, "error");
  assert.match(h.state[0].error, /network down/);
  h.workshop.retry("s1");
  await h.settle();
  assert.equal(h.state[0].status, "ready");
  assert.equal(h.downloads.length, 2);
});

test("a song removed while converting doesn't come back", async () => {
  const h = harness();
  h.setTracks([song(1, "One"), song(2, "Two")]);
  h.setTracks((list) => list.filter((t) => t.id !== "s2"));
  await h.settle();
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(h.state.map((t) => t.id), ["s1"]);
});

// ---- the panel's rules ------------------------------------------------------------------

test("liner notes can list the shows, words become terms, and the recipe stays public-safe", () => {
  const tracks = [song(1, "a"), song(2, "b"), song(3, "c", { album: "Another show" })];
  assert.deepEqual(showsOf(tracks), [SHOW, "Another show"]);
  assert.equal(addShowsToNotes("", tracks), `Songs from:\n${SHOW}\nAnother show`);
  assert.equal(addShowsToNotes(`Great night.\n${SHOW}`, tracks), `Great night.\n${SHOW}\nAnother show`);
  assert.equal(applyPanelChange("addShows", true, { notes: "", tracks }).values.notes, `Songs from:\n${SHOW}\nAnother show`);
  assert.deepEqual(splitWords(" funk, soul ,,live\njam"), ["funk", "soul", "live", "jam"]);
  const v = { ...panelDefaults({ handle: "pyxorium.com" }), label: "JAM CRUISE '26", genres: "funk, soul", confirm: true,
    tracks: [{ ...song(1, "a"), transitionChosen: true, source: { record: { uri: `at://${DID}/fm.plyr.track/x`, cid: "bafy" } } }] };
  const d = tapeDetails(v);
  assert.deepEqual(d.label, { text: "JAM CRUISE '26", style: "cassette-classic", colors: kitColors("cassette-classic") });
  assert.deepEqual(d.describe.genres, ["funk", "soul"]);
  assert.deepEqual(d.madeBy, { handle: "pyxorium.com" });
  assert.deepEqual(panelRecipe(v), { songsFrom: [{ kind: "plyr.fm", did: DID }], kit: "cassette-classic", chosenTransitions: 1, confirmed: true });
});

// ---- stage 5: cassette looks and card pictures -------------------------------------

test("every cassette look has valid colors, and tapes record their look and colors", () => {
  const hex = /^#[0-9a-f]{6}$/;
  assert.equal(DEFAULT_KIT, "cassette-classic");
  assert.equal(new Set(KITS.map((k) => k.id)).size, KITS.length);
  for (const k of KITS) for (const c of [k.shell, k.edge, k.paper, k.ink, k.stripe1, k.stripe2, ...k.backdrop]) assert.match(c, hex, k.id);
  assert.equal(kitById("nonsense").id, DEFAULT_KIT);
  assert.ok(mixtape.inputs.find((i) => i.key === "kit").options.every((o) => o.color));
  assert.deepEqual(cleanLabel({ text: " Hi ", style: "cassette-ocean", colors: { ...kitColors("cassette-ocean"), ink: "red", extra: "#000000" } }),
    { text: "Hi", style: "cassette-ocean", colors: { shell: "#1f4e79", paper: "#f2efe6", stripe1: "#f28c38", stripe2: "#f6c85f" } });
  assert.equal(cleanLabel({ style: "Bad Style!" }), null);
});

test("the cassette shows the label (or title), the maker, and each side's length", () => {
  const tape = { title: "Road Trip", label: { text: "ROAD TRIP '26" }, madeBy: { handle: "pyxorium.com" },
    sides: [{ name: "A", tracks: [{ duration: 600 }, { duration: 790.4 }] }, { name: "B", tracks: [{ duration: 224 }] }] };
  assert.deepEqual(cassetteWords(tape), { label: "ROAD TRIP '26", sub: "Road Trip · made by @pyxorium.com", left: ["SIDE A", "23:10"], right: ["SIDE B", "3:44"] });
  assert.deepEqual(cassetteWords({ title: "T", sides: [{ name: "A", tracks: [] }] }), { label: "T", sub: "", left: ["SIDE A", "0:00"], right: null });
});
