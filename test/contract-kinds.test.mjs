// The Foundry's newer input kinds (stage 6, for Glass Lantern; any type may use them).
// Run with:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkTileType, checkInputs, isShown, INPUT_KINDS } from "../src/core/contract.js";

const COLORS = [{ value: "#aa0000", label: "Red" }, { value: "#00aa00", label: "Green" }, { value: "#0000aa", label: "Blue" }];

function typeWith(inputs, extra = {}) {
  return { id: "test-type", version: 1, title: "Test", summary: "Test", inputs, defaults: () => ({}), build: async () => ({}), ...extra };
}

test("the new kinds are known", () => {
  for (const k of ["palette", "brush", "range", "seed", "toggle"]) assert.ok(INPUT_KINDS.includes(k), k);
});

test("palette and brush need colors; range needs min and max; showIf must be a function", () => {
  assert.throws(() => checkTileType(typeWith([{ key: "p", kind: "palette" }])), /needs colors/);
  assert.throws(() => checkTileType(typeWith([{ key: "b", kind: "brush", colors: [{ value: "red" }] }])), /needs colors/);
  assert.throws(() => checkTileType(typeWith([{ key: "r", kind: "range", min: 5, max: 5 }])), /min and max/);
  assert.throws(() => checkTileType(typeWith([{ key: "t", kind: "toggle", showIf: true }])), /showIf/);
  assert.throws(() => checkTileType(typeWith([], { preview: {} })), /preview/);
  assert.throws(() => checkTileType(typeWith([], { applyChange: 1 })), /applyChange/);
  checkTileType(typeWith([
    { key: "p", kind: "palette", colors: COLORS },
    { key: "b", kind: "brush", colors: COLORS },
    { key: "r", kind: "range", min: 1, max: 9 },
    { key: "s", kind: "seed", button: "New" },
    { key: "t", kind: "toggle", showIf: (v) => v.r > 2 },
  ], { preview: { mount() {} }, applyChange: () => ({}) }));
});

test("values of the new kinds are checked", () => {
  const type = typeWith([
    { key: "p", kind: "palette", colors: COLORS, min: 2 },
    { key: "b", kind: "brush", colors: COLORS },
    { key: "r", kind: "range", min: 10, max: 24 },
    { key: "s", kind: "seed" },
    { key: "t", kind: "toggle" },
  ]);
  const good = { p: ["#AA0000", "#0000aa"], b: "#00aa00", r: 14, s: 123, t: false };
  assert.deepEqual(checkInputs(type, good), []);
  assert.equal(checkInputs(type, { ...good, p: ["#aa0000"] }).length, 1, "too few colors");
  assert.equal(checkInputs(type, { ...good, p: ["#123456", "#aa0000"] }).length, 1, "a color not offered");
  assert.equal(checkInputs(type, { ...good, b: "#ffffff" }).length, 1);
  assert.equal(checkInputs(type, { ...good, r: 30 }).length, 1);
  assert.equal(checkInputs(type, { ...good, s: 1.5 }).length, 1);
  assert.equal(checkInputs(type, { ...good, t: "yes" }).length, 1);
});

test("hidden inputs are neither shown nor checked", () => {
  const input = { key: "b", kind: "brush", colors: COLORS, showIf: (v) => v.mode === "paint" };
  const type = typeWith([input]);
  assert.equal(isShown(input, { mode: "easy" }), false);
  assert.deepEqual(checkInputs(type, { mode: "easy", b: "nonsense" }), []);
  assert.equal(checkInputs(type, { mode: "paint", b: "nonsense" }).length, 1);
});

test("buildTile tells the type whether this is the final build, and says so in the result", async () => {
  const { buildTile } = await import("../src/core/build.js");
  const { makeFile } = await import("../src/core/fileset.js");
  const { TILE_CSP_META } = await import("../src/core/policy.js");
  const seen = [];
  const type = typeWith([], {
    build: async (_inputs, { final }) => {
      seen.push(final);
      return { name: "T", files: [makeFile("/", `<html><head>${TILE_CSP_META}</head></html>`)], recipeInputs: {} };
    },
  });
  assert.equal((await buildTile(type, {}, { final: false })).final, false);
  assert.equal((await buildTile(type, {})).final, true, "final unless told otherwise");
  assert.deepEqual(seen, [false, true]);
});

test("an action input needs a button label and the type's applyChange", () => {
  assert.throws(() => checkTileType(typeWith([{ key: "a", kind: "action" }], { applyChange: () => ({}) })), /button label/);
  assert.throws(() => checkTileType(typeWith([{ key: "a", kind: "action", button: "Go" }])), /applyChange/);
  checkTileType(typeWith([{ key: "a", kind: "action", button: "Go" }], { applyChange: () => ({}) }));
});
