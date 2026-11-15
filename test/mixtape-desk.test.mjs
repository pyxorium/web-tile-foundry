// The tape desk (v0.37.0, R3d-1 to R3d-9; src/tile-types/mixtape/library.js):
// the column's width, moving songs within and across sides, putting a song
// back or in at a spot, the selection after a removal, and the remembered width.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TAPE_WIDTH, LIBRARY_MIN, SHOW_LINE_WIDTH, tapeWidth, sideSongs, placeOf, putTrack, moveTrack, stepTrack, crossTrack,
  selectAfterRemove, movedLine, readMemory, writeMemory, MEMORY_KEY,
} from "../src/tile-types/mixtape/library.js";
import { normalizeTracks } from "../src/tile-types/mixtape/workshop.js";
import { shapesFor, fadesOf } from "../src/tile-types/mixtape/transitions.js";

const SIDES = ["A", "B"];
const t = (id, side) => ({ id, side, seconds: 200, status: "ready" });
// A list where the sides are mixed in the array, as the panel can leave it.
const list = () => [t("a1", "A"), t("b1", "B"), t("a2", "A"), t("a3", "A"), t("b2", "B")];
const order = (tracks, side) => sideSongs(tracks, side).map((x) => x.id);

function memoryStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), raw: m };
}

test("the column's width: 230 px at least, about half the window at most, the library keeping 480 px", () => {
  assert.equal(TAPE_WIDTH, 230);
  assert.equal(LIBRARY_MIN, 480);
  assert.equal(SHOW_LINE_WIDTH, 320);
  assert.equal(tapeWidth(0, 1170), 230, "nothing asked: the default");
  assert.equal(tapeWidth(100, 1170), 230, "never narrower than today");
  assert.equal(tapeWidth(400, 1170), 400);
  assert.equal(tapeWidth(5000, 1170), 585, "half the window");
  assert.equal(tapeWidth(5000, 900), 420, "the library keeps 480 px");
  assert.equal(tapeWidth(500, 600), 230, "a small window shrinks the column to the default");
  assert.equal(tapeWidth(500, 0), 230, "no room known yet");
});

test("moving within a side keeps the other side and the songs' order in the list", () => {
  const moved = moveTrack(list(), "a3", "A", 0);
  assert.deepEqual(order(moved, "A"), ["a3", "a1", "a2"]);
  assert.deepEqual(order(moved, "B"), ["b1", "b2"]);
  assert.deepEqual(order(moveTrack(list(), "a1", "A", 2), "A"), ["a2", "a3", "a1"], "to the end");
  assert.deepEqual(order(moveTrack(list(), "a1", "A", 99), "A"), ["a2", "a3", "a1"], "past the end means last");
  const same = list();
  assert.equal(moveTrack(same, "a2", "A", 1), same, "already there: the same list");
  assert.equal(moveTrack(same, "nope", "A", 0), same, "not on the tape: the same list");
});

test("moving across sides, into the middle, to the start and into an empty side", () => {
  let m = moveTrack(list(), "a2", "B", 1);
  assert.deepEqual(order(m, "A"), ["a1", "a3"]);
  assert.deepEqual(order(m, "B"), ["b1", "a2", "b2"]);
  assert.equal(m.find((x) => x.id === "a2").side, "B");
  m = moveTrack(list(), "b2", "A", 0);
  assert.deepEqual(order(m, "A"), ["b2", "a1", "a2", "a3"]);
  const onlyA = [t("a1", "A"), t("a2", "A")];
  m = moveTrack(onlyA, "a1", "B", 0);
  assert.deepEqual(order(m, "B"), ["a1"]);
  assert.deepEqual(order(m, "A"), ["a2"]);
  assert.equal(m.length, 2);
});

test("↑ and ↓ stay within the side; at its ends nothing changes", () => {
  assert.deepEqual(order(stepTrack(list(), "a2", -1), "A"), ["a2", "a1", "a3"]);
  assert.deepEqual(order(stepTrack(list(), "a2", 1), "A"), ["a1", "a3", "a2"]);
  const same = list();
  assert.equal(stepTrack(same, "a1", -1), same);
  assert.equal(stepTrack(same, "a3", 1), same);
  assert.equal(stepTrack(same, "b2", 1), same);
});

test("to Side B puts a song first on B, to Side A last on A (across the flip)", () => {
  let m = crossTrack(list(), "a3", SIDES, 1);
  assert.deepEqual(order(m, "A"), ["a1", "a2"]);
  assert.deepEqual(order(m, "B"), ["a3", "b1", "b2"]);
  m = crossTrack(list(), "b1", SIDES, -1);
  assert.deepEqual(order(m, "A"), ["a1", "a2", "a3", "b1"]);
  assert.deepEqual(order(m, "B"), ["b2"]);
  const same = list();
  assert.equal(crossTrack(same, "a1", SIDES, -1), same, "no side before A");
  assert.equal(crossTrack(same, "b1", SIDES, 1), same, "no side after B");
});

test("putting a song back (Undo) or in from the library at a spot", () => {
  const removed = list().filter((x) => x.id !== "a2");
  const back = putTrack(removed, t("a2", "A"), "A", 1);
  assert.deepEqual(order(back, "A"), ["a1", "a2", "a3"]);
  const fresh = putTrack(list(), { id: "new", side: "A", seconds: 100, status: "converting" }, "B", 1);
  assert.deepEqual(order(fresh, "B"), ["b1", "new", "b2"]);
  assert.equal(fresh.find((x) => x.id === "new").side, "B");
  assert.deepEqual(order(putTrack([], { id: "x", side: "A" }, "B", 0), "B"), ["x"]);
});

test("where a song is, the selection after removing one, and what a screen reader hears", () => {
  assert.deepEqual(placeOf(list(), "a3"), { side: "A", index: 2 });
  assert.equal(placeOf(list(), "nope"), null);
  assert.equal(selectAfterRemove(list(), "a1"), "a2", "the next on its side");
  assert.equal(selectAfterRemove(list(), "a3"), "a2", "the last: the one before");
  assert.equal(selectAfterRemove([t("a1", "A"), t("b1", "B")], "a1"), null, "alone on its side: none");
  assert.equal(movedLine(moveTrack(list(), "a1", "B", 2), "a1", SIDES), "Moved to Side B, position 3");
  assert.equal(movedLine([t("x", "A")], "x", ["A"]), "Moved to the tape, position 1");
});

test("a move changes the fades of the songs around it only, so only those convert again", () => {
  // Songs converted for their places (the list's own rules fill in the transitions).
  const fresh = normalizeTracks(list().map((x) => ({ ...x, status: "converting" })), SIDES);
  const ready = normalizeTracks(fresh, SIDES); // stable
  assert.equal(ready, fresh);
  // Pretend each finished with the fades its place wanted.
  const shapes = shapesFor(ready, SIDES);
  const done = ready.map((x) => ({ ...x, status: "ready", fades: fadesOf(shapes.get(x.id)) }));
  const after = normalizeTracks(stepTrack(done, "b2", -1), SIDES);
  const again = after.filter((x) => x.status === "converting").map((x) => x.id).sort();
  assert.ok(again.length <= 2 && again.every((id) => id === "b1" || id === "b2"), again.join(","));
  assert.ok(after.filter((x) => x.side === "A").every((x) => x.status === "ready"), "Side A untouched");
});

test("the window remembers the column's width (0 means the default) and older memory still reads", () => {
  const s = memoryStore();
  writeMemory(s, { open: ["k"], scroll: 10, source: "archive", width: 412.4 });
  assert.deepEqual(readMemory(s), { open: ["k"], scroll: 10, source: "archive", width: 412 });
  writeMemory(s, { open: [], scroll: 0, source: "all", width: 0 });
  assert.deepEqual(JSON.parse(s.raw.get(MEMORY_KEY)), { open: [], scroll: 0, source: "all" }, "the default isn't written");
  assert.equal(readMemory(s).width, 0);
  s.setItem(MEMORY_KEY, JSON.stringify({ open: ["x"], scroll: 3, source: "plyr" }));
  assert.deepEqual(readMemory(s), { open: ["x"], scroll: 3, source: "plyr", width: 0 }, "v0.36 memory");
  s.setItem(MEMORY_KEY, JSON.stringify({ width: "wide" }));
  assert.equal(readMemory(s).width, 0, "a broken width");
  s.setItem(MEMORY_KEY, JSON.stringify({ width: 100 }));
  assert.equal(readMemory(s).width, 0, "narrower than the default");
});
