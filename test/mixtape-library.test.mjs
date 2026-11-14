// The Choose songs window's rules (v0.34.0, src/tile-types/mixtape/library.js):
// search, the side meters' "to burn" lines, a whole show's tick, and what the
// window remembers.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  searchWords, songMatches, sideMeter, sideMeters, tapeBurnedDown, showTick, showKey,
  readMemory, writeMemory, MEMORY_KEY, tapeLine,
} from "../src/tile-types/mixtape/library.js";
import { mixtape } from "../src/tile-types/mixtape/index.js";

const song = (uri, title, extra = {}) => ({ uri, title, artist: "", album: "", seconds: 300, usable: true, ...extra });
const track = (id, side, seconds) => ({ id, side, seconds, status: "ready" });

test("search: every word must match the title, the performer or the show", () => {
  const words = searchWords("  Galactic 1997 ");
  assert.deepEqual(words, ["galactic", "1997"]);
  const s = song("u1", "Shibuya", { artist: "" });
  assert.ok(songMatches(s, words, "Galactic · Moguls · 1997-08-15"));
  assert.ok(!songMatches(s, ["galactic", "2011"], "Galactic · Moguls · 1997-08-15"));
  assert.ok(songMatches(s, searchWords("moguls"), "Galactic · Moguls · 1997-08-15"), "a venue in the show's name");
  assert.ok(songMatches(s, searchWords("SHIB"), "x"), "any case, part of a word");
  assert.ok(songMatches(s, [], "x"), "an empty search matches everything");
  assert.ok(songMatches(song("u2", "Jolene", { artist: "Parlor Greens" }), searchWords("parlor jolene")), "the performer");
});

test("side meters: what's left to burn, exactly full, and over", () => {
  const tracks = [track("a", "A", 1500), track("b", "A", 1002), track("c", "B", 2700)];
  assert.deepEqual(sideMeter(tracks, "A", 2700), { side: "A", total: 2502, max: 2700, left: 198, over: false, line: "3:18 to burn" });
  assert.equal(sideMeter(tracks, "B", 2700).line, "Burned down");
  const over = sideMeter([track("a", "A", 2736)], "A", 2700);
  assert.equal(over.over, true);
  assert.equal(over.line, "0:36 over");
  assert.equal(sideMeter(tracks, "A", 0).line, "", "no limit, no line");
  assert.equal(sideMeter([], "A", 3600).line, "1:00:00 to burn");
  assert.deepEqual(sideMeters(tracks, ["A", "B"], 2700).map((m) => m.side), ["A", "B"]);
});

test("a tape is burned down when every side has under a minute left and none is over", () => {
  assert.ok(tapeBurnedDown(sideMeters([track("a", "A", 1790), track("b", "B", 1745)], ["A", "B"], 1800)));
  assert.ok(!tapeBurnedDown(sideMeters([track("a", "A", 1790), track("b", "B", 1700)], ["A", "B"], 1800)), "side B has 1:40 left");
  assert.ok(!tapeBurnedDown(sideMeters([track("a", "A", 1810), track("b", "B", 1790)], ["A", "B"], 1800)), "side A is over");
  assert.ok(!tapeBurnedDown([]));
});

test("a show's tick: all, some or none of its usable songs", () => {
  const show = { songs: [song("u1", "One"), song("u2", "Two"), song("u3", "Off", { usable: false })] };
  assert.equal(showTick(show, []), "none");
  assert.equal(showTick(show, [track("u1", "A", 1)]), "some");
  assert.equal(showTick(show, [track("u1", "A", 1), track("u2", "B", 1)]), "all", "songs that can't be used don't count");
  assert.equal(showTick({ songs: [song("u3", "Off", { usable: false })] }, []), "none");
  assert.equal(showKey("did:plc:x", "Galactic"), "did:plc:x|Galactic");
});

function fakeStorage(start = {}) {
  const m = new Map(Object.entries(start));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
}

test("the window remembers open shows and where it was scrolled, and survives bad storage", () => {
  const st = fakeStorage();
  assert.deepEqual(readMemory(st), { open: [], scroll: 0 });
  writeMemory(st, { open: ["d|A", "d|B"], scroll: 812.4 });
  assert.deepEqual(readMemory(st), { open: ["d|A", "d|B"], scroll: 812 });
  assert.deepEqual(readMemory(fakeStorage({ [MEMORY_KEY]: "{not json" })), { open: [], scroll: 0 });
  assert.deepEqual(readMemory(fakeStorage({ [MEMORY_KEY]: JSON.stringify({ open: [1, "x"], scroll: -4 }) })), { open: ["x"], scroll: 0 });
  assert.deepEqual(readMemory(null), { open: [], scroll: 0 });
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); } };
  assert.deepEqual(readMemory(broken), { open: [], scroll: 0 });
  assert.doesNotThrow(() => writeMemory(broken, { open: ["x"], scroll: 3 }));
});

test("the tape's line for phones", () => {
  assert.equal(tapeLine([track("a", "A", 1), track("b", "A", 1), track("c", "B", 1)], ["A", "B"]), "Side A · 2 songs · Side B · 1 song");
});

test("the card is Mixtape Burndown, and its summary and help no longer name plyr.fm", () => {
  assert.equal(mixtape.id, "mixtape", "the type id stays");
  assert.equal(mixtape.title, "Mixtape Burndown");
  assert.equal(mixtape.summary, "Your songs on a cassette, Side A and Side B: a C60, C90 or C120.");
  const songs = mixtape.inputs.find((i) => i.key === "tracks");
  assert.ok(!/plyr\.fm/.test(songs.help), songs.help);
  assert.match(songs.help, /left to burn/);
});
