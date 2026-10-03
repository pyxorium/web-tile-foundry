// Glass Lantern stage 6: the creator's panel rules (panel.js).
// Run with:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  panelDefaults, applyPanelChange, resolvePanel, easyColors, faceColorsFor, isHandPainted, lookFor, shapeChoiceFor,
  GLASS_COLORS, LAMPS, panelRecipe, hasStylePalette,
} from "../src/tile-types/glass-lantern/panel.js";
import { getShape } from "../src/tile-types/glass-lantern/geometry/index.js";
import { kitLook, KITS } from "../src/tile-types/glass-lantern/lantern/kits.js";
import { glassLantern } from "../src/tile-types/glass-lantern/index.js";
import { checkInputs } from "../src/core/contract.js";

const d12 = getShape({ group: "classic", id: "d12" });
const base = () => panelDefaults();

test("the 15 glass colors are the three styles' five each, and every style's palette is among them", () => {
  assert.equal(GLASS_COLORS.length, 15);
  for (const k of KITS) for (const c of kitLook(k.id).palette) assert.ok(GLASS_COLORS.some((g) => g.value === c.toLowerCase()), `${k.id} ${c}`);
});

test("Easy spreads: alternate repeats, random is steady for a seed, fade runs top to bottom", () => {
  const v = { ...base(), palette: ["#d68a24", "#2c4fa3"] };
  assert.deepEqual(easyColors(v, d12).slice(0, 4), ["#d68a24", "#2c4fa3", "#d68a24", "#2c4fa3"]);
  const r = { ...v, spread: "random", spreadSeed: 42 };
  assert.deepEqual(easyColors(r, d12), easyColors(r, d12));
  assert.ok(easyColors(r, d12).every((c) => v.palette.includes(c)));
  const f = easyColors({ ...v, spread: "fade" }, d12);
  assert.equal(f[0], "#d68a24", "the top facet has the first color");
  assert.equal(f[f.length - 1], "#2c4fa3", "the bottom facet has the last color");
});

test("a new style resets colors, metal, background, tabletop and lamp to the style's", () => {
  const v = { ...base(), metal: "silver", background: "none", tabletop: false, lamp: "candle", palette: ["#5b2a86"] };
  const { values, confirm } = applyPanelChange("kit", "victorian", v);
  const look = kitLook("victorian");
  assert.equal(confirm, undefined);
  assert.equal(values.metal, look.metal);
  assert.equal(values.background, look.background);
  assert.equal(values.tabletop, Boolean(look.tabletop));
  assert.equal(values.lamp, "style");
  assert.deepEqual(values.palette, look.palette.map((c) => c.toLowerCase()));
});

test("Hands-on starts from Easy's colors; painting is kept when switching back and forth", () => {
  let v = applyPanelChange("colorMode", "handson", base()).values;
  assert.deepEqual(v.faceColors, easyColors(v, d12));
  assert.equal(isHandPainted(v), false);
  const painted = v.faceColors.slice();
  painted[3] = "#1f6f6a";
  v = applyPanelChange("faceColors", painted, v).values;
  assert.equal(isHandPainted(v), true);
  assert.equal(faceColorsFor(v, d12)[3], "#1f6f6a");
  v = applyPanelChange("colorMode", "easy", v).values;
  assert.notEqual(faceColorsFor(v, d12)[3], "#1f6f6a", "Easy shows Easy's colors");
  v = applyPanelChange("colorMode", "handson", v).values;
  assert.equal(faceColorsFor(v, d12)[3], "#1f6f6a", "the painting is still there");
});

test("changing style or shape after painting asks first, then resets the painting", () => {
  let v = applyPanelChange("colorMode", "handson", base()).values;
  const painted = v.faceColors.slice();
  painted[0] = "#4a4038";
  v = { ...v, faceColors: painted };
  for (const [key, value] of [["kit", "steampunk"], ["shape", "d6"], ["shape", "gem"]]) {
    const change = applyPanelChange(key, value, v);
    assert.match(change.confirm, /painted by hand/, `${key} ${value}`);
    assert.equal(isHandPainted(change.values), false);
  }
  // Without painting, no question.
  assert.equal(applyPanelChange("shape", "d6", base()).confirm, undefined);
});

test("picking Random shuffles anew", () => {
  const v = applyPanelChange("spread", "random", base(), () => 0.5).values;
  assert.equal(v.spreadSeed, 2147483648);
});

test("the look: lamp, filament, metal, tabletop and background choices reach it", () => {
  const tiffany = kitLook("tiffany");
  assert.equal(lookFor(base()).lampWarmth, tiffany.lampWarmth, "Style's own");
  assert.equal(lookFor({ ...base(), lamp: "candle" }).lampWarmth, LAMPS.candle);
  assert.equal(base().filament, true, "the filament shows at first");
  assert.equal(lookFor(base()).showGlow, true);
  const hidden = lookFor({ ...base(), filament: false });
  assert.equal(hidden.showGlow, false, "only the glowing spot is hidden");
  assert.equal(hidden.lampBrightness, lookFor(base()).lampBrightness, "the lamp itself is unchanged");
  assert.equal(hidden.showBulb, false);
  assert.equal(lookFor({ ...base(), metal: "pewter" }).metal, "pewter");
  assert.equal(lookFor({ ...base(), tabletop: false }).tabletop, false);
  const none = lookFor({ ...base(), background: "none" });
  assert.equal(none.background, "plain");
  assert.equal(none.bgHalo, 0);
  assert.equal(lookFor({ ...base(), background: "workshop" }).background, "workshop");
});

test("gems use their seed and facets; every panel value set passes the type's checks", () => {
  const v = { ...base(), shape: "gem", gemSeed: 7, gemFacets: 20 };
  assert.deepEqual(shapeChoiceFor(v), { group: "gem", id: "gem", seed: 7, facets: 20 });
  assert.equal(resolvePanel(v).shape.faces.length, 20);
  assert.deepEqual(checkInputs(glassLantern, v), []);
  assert.equal(checkInputs(glassLantern, { ...v, gemFacets: 40 }).length, 1);
  assert.equal(checkInputs(glassLantern, { ...base(), palette: [] }).length, 1, "at least one color");
  assert.deepEqual(checkInputs(glassLantern, { ...base(), colorMode: "handson", palette: [] }), [], "the palette is hidden in Hands-on");
  assert.equal(panelRecipe(v).gemSeed, 7);
  assert.equal(panelRecipe(base()).gemSeed, undefined);
});

test("the Shape and Style pictures are saved files in the Foundry, one for every option", async () => {
  const { existsSync } = await import("node:fs");
  const shape = glassLantern.inputs.find((i) => i.key === "shape");
  const kit = glassLantern.inputs.find((i) => i.key === "kit");
  for (const o of [...shape.options, ...kit.options]) {
    assert.match(o.image, /^\/glass-lantern\/(shape|style)-[a-z0-9]+\.png$/);
    assert.ok(existsSync(new URL(`../public${o.image}`, import.meta.url)), o.image);
  }
  assert.equal(glassLantern.optionPreview, undefined, "nothing is drawn for the picture cards");
});

test("Reset to style default colors ticks the style's five again; Start over repaints, asking first", () => {
  let v = { ...base(), palette: ["#5b2a86"] };
  assert.equal(hasStylePalette(v), false);
  v = applyPanelChange("resetPalette", true, v).values;
  assert.equal(hasStylePalette(v), true);
  assert.ok(!("resetPalette" in v), "nothing kept under the button's key");

  v = applyPanelChange("colorMode", "handson", v).values;
  const painted = v.faceColors.slice();
  painted[2] = "#8a3b1c";
  v = { ...v, faceColors: painted };
  const change = applyPanelChange("startOver", true, v);
  assert.match(change.confirm, /Start over/);
  assert.equal(isHandPainted(change.values), false);
  assert.ok(!("startOver" in change.values));
  assert.equal(applyPanelChange("startOver", true, change.values).confirm, undefined, "nothing painted: no question");
});
