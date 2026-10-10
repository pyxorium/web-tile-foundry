import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TREELINE, sportLabel, routePoints, metresBetween, trimEnds, privateRoute, routeShape, elevationsAlong, activityFromRecord,
  unitsFromPreferences, unitsFor, distanceText, heightText, durationText, treelineUrl, profileShape, activityPiece,
  activityForReader, activityRecipe, groupActivities, PROFILE_MIN_RANGE, mapLayout,
} from "../src/tile-types/zine/activities.js";
import { isLightInk } from "../src/tile-types/zine/looks.js";
import { pieceProblems, pieceFiles } from "../src/tile-types/zine/piece.js";
import { emptyPages, zineConfig, wordLimit, PAGES, LAYOUTS, ACTIVITY_ROOM, ACTIVITY_SPRITE_COST, ACTIVITY_SOUND_COST, ACTIVITY_PROFILE_COST } from "../src/tile-types/zine/pages.js";
import { makeZineTile, zineRecipe } from "../src/tile-types/zine/tile.js";
import { zine } from "../src/tile-types/zine/index.js";
import { READER_JS, READER_CSS } from "../src/tile-types/zine/runtime/reader.js";
import { pathPoints } from "../src/tile-types/zine/art.js";

// "An activity" pages from Treeline. The routes here are made up (a walk that
// heads north and climbs), shaped like the owner's live records (Oct 10 2026):
// coordinates as strings [lon, lat, elevation], stats in metres and seconds.

const DID = "did:plc:rqbqpaaluty5v47jwciowpik";
const OWNER = { did: DID, pds: "https://meadow.us-east.host.bsky.network", handle: "pyxorium.com" };

/** A made-up route: `n` points about `step` metres apart heading north-east, climbing `climb` metres. */
function makeRoute(n = 200, step = 25, climb = 220, lon0 = -100.5, lat0 = 40.25) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const lat = lat0 + (i * step * 0.7) / 111320;
    const lon = lon0 + (i * step * 0.7) / (111320 * Math.cos((lat0 * Math.PI) / 180)) + Math.sin(i / 9) * 0.0004;
    out.push([lon.toFixed(6), lat.toFixed(6), String(Math.round(1700 + (climb * i) / (n - 1)))]);
  }
  return out;
}
function lengthOf(coords) {
  const pts = coords.map((c) => c.map(Number));
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += metresBetween(pts[i - 1], pts[i]);
  return n;
}
function record(rkey, extra = {}, stats = {}) {
  const coordinates = extra.coordinates || makeRoute();
  const len = Math.round(lengthOf(coordinates));
  const { coordinates: _c, ...rest } = extra;
  return {
    uri: `at://${DID}/${TREELINE.collection}/${rkey}`,
    cid: `bafyrei${rkey}`,
    value: {
      $type: TREELINE.collection, sport: "hike", title: "Golden Hiking Nightbird Gulch Trail", description: "", privacy: "public",
      stats: { distanceMeters: len, elevationGainMeters: 224, elevationLossMeters: 228, movingDurationSeconds: 5381, elapsedDurationSeconds: 6297, ...stats },
      rawBlob: { $type: "blob", ref: { $link: "bafkreiraw" }, mimeType: "application/xml", size: 525312 },
      geometry: { type: "LineString", coordinates },
      startedAt: "2026-10-01T20:03:13.000Z", endedAt: "2026-10-01T21:48:10.000Z", createdAt: "2026-10-02T01:00:00.000Z",
      deviceInfo: { model: "Connect", manufacturer: "Garmin" }, hideStartEndMeters: 0,
      ...rest,
    },
  };
}

test("activities: sports read as words", () => {
  assert.equal(sportLabel("road_ride"), "Road ride");
  assert.equal(sportLabel("hike"), "Hike");
  assert.equal(sportLabel("trail_run"), "Trail run");
  assert.equal(sportLabel("mtb"), "Mountain bike");
  assert.equal(sportLabel("stand_up_paddle"), "Stand up paddle");
  assert.equal(sportLabel(""), "Activity");
});

test("activities: the record's route reads as numbers; bad points are dropped", () => {
  const pts = routePoints({ type: "LineString", coordinates: [["-105.1", "39.7", "1661"], ["x", "39"], ["-200", "39"], [-105.2, 39.8], ["-105.3", "39.9", "nope"]] });
  assert.deepEqual(pts, [[-105.1, 39.7, 1661], [-105.2, 39.8, null], [-105.3, 39.9, null]]);
  assert.deepEqual(routePoints(null), []);
  assert.deepEqual(routePoints({ type: "Point", coordinates: [1, 2] }), []);
});

test("activities: privacy: a route that wasn't trimmed is trimmed here; a trimmed one is left alone", () => {
  const coords = makeRoute(300, 25);
  const pts = routePoints({ type: "LineString", coordinates: coords });
  const full = lengthOf(coords);
  // Untrimmed (the record's route is as long as the whole activity): 500 m comes off each end.
  const cut = privateRoute(pts, 500, full);
  assert.ok(cut.length < pts.length);
  let front = 0;
  for (let i = 1; i < pts.length && pts[i - 1] !== undefined; i++) {
    if (pts[i][0] === cut[0][0] && pts[i][1] === cut[0][1]) break;
    front += metresBetween(pts[i - 1], pts[i]);
  }
  assert.ok(metresBetween(pts[0], cut[0]) > 400, "the start is well away from where the activity began");
  assert.ok(metresBetween(pts[pts.length - 1], cut[cut.length - 1]) > 400, "and the end from where it ended");
  // Already trimmed by Treeline (the route is ~1 km shorter than the activity): kept as it is.
  const trimmed = trimEnds(pts, 500);
  assert.deepEqual(privateRoute(trimmed, 500, full), trimmed);
  // Nothing hidden: the whole route.
  assert.deepEqual(privateRoute(pts, 0, full), pts);
  // A distance we don't know: trimmed to be safe.
  assert.ok(privateRoute(pts, 500, null).length < pts.length);
});

test("activities: the route's shape keeps no coordinates, fits a 1000 box, and is simplified", () => {
  const pts = routePoints({ type: "LineString", coordinates: makeRoute(2000, 5) });
  const s = routeShape(pts);
  assert.ok(Math.max(s.w, s.h) === 1000);
  const xy = pathPoints(s.d);
  assert.ok(xy.length <= 400 && xy.length > 10);
  for (const [x, y] of xy) assert.ok(Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x <= 1000 && y <= 1000);
  assert.deepEqual(s.start, xy[0]);
  assert.deepEqual(s.end, xy[xy.length - 1]);
  assert.ok(!/-?\d+\.\d{3,}/.test(s.d), "no latitudes or longitudes in the drawing");
  assert.equal(routeShape([[1, 1, null]]), null);
});

test("activities: elevations evenly along the route; an honest profile scale", () => {
  const pts = routePoints({ type: "LineString", coordinates: makeRoute(200, 25, 220) });
  const e = elevationsAlong(pts);
  assert.equal(e.length, 120);
  assert.ok(e[0] < 1710 && e[e.length - 1] > 1905);
  // A climb fills the box; a flat walk (6 m of wobble) stays a low, nearly flat line.
  const ys = (s) => pathPoints(s.line).map((p) => p[1]);
  const climb = ys(profileShape(e));
  assert.ok(Math.max(...climb) - Math.min(...climb) > 150);
  const flat = ys(profileShape(Array.from({ length: 120 }, (_, i) => 1600 + 3 * Math.sin(i))));
  assert.ok(Math.max(...flat) - Math.min(...flat) < (200 * 6) / PROFILE_MIN_RANGE + 1);
  assert.ok(Math.min(...flat) > 100, "and it sits low in its box");
  assert.equal(elevationsAlong([[0, 0, null], [0, 1, null]]), null);
});

test("activities: only public activities; the raw GPS file isn't kept", () => {
  assert.equal(activityFromRecord(record("p1", { privacy: "followers" }), OWNER), null);
  assert.equal(activityFromRecord(record("p2", { privacy: undefined }), OWNER), null);
  const a = activityFromRecord(record("pub"), OWNER, "America/Denver");
  assert.equal(a.title, "Golden Hiking Nightbird Gulch Trail");
  assert.equal(a.sport, "Hike");
  assert.equal(a.date, "October 1, 2026");
  assert.equal(a.gain, 224);
  assert.ok(a.route && a.elevations);
  assert.ok(!JSON.stringify(a).includes("bafkreiraw"), "the raw GPS file is never referenced");
  assert.ok(!JSON.stringify(activityPiece(a)).match(/-100\.|40\.2/), "no coordinates in what the page keeps");
});

test("activities: units follow the creator's Treeline choice, else the paper", () => {
  assert.deepEqual(unitsFromPreferences({ unitSystem: "imperial", distanceUnits: "mi", elevationUnits: "ft", temperatureUnits: "f" }), { distance: "mi", elevation: "ft" });
  assert.deepEqual(unitsFromPreferences({ unitSystem: "metric" }), { distance: "km", elevation: "m" });
  assert.deepEqual(unitsFromPreferences({ distanceUnits: "km", elevationUnits: "ft" }), { distance: "km", elevation: "ft" });
  assert.equal(unitsFromPreferences({}), null);
  assert.deepEqual(unitsFor(null, "letter"), { distance: "mi", elevation: "ft" });
  assert.deepEqual(unitsFor(null, "a4"), { distance: "km", elevation: "m" });
  assert.deepEqual(unitsFor({ distance: "km", elevation: "m" }, "letter"), { distance: "km", elevation: "m" });
  assert.equal(distanceText(4517, "mi"), "2.8 mi");
  assert.equal(distanceText(4517, "km"), "4.5 km");
  assert.equal(distanceText(167299, "km"), "167 km");
  assert.equal(heightText(224, "ft"), "735 ft");
  assert.equal(heightText(1026, "m"), "1,026 m");
  assert.equal(durationText(5381), "1h 30m");
  assert.equal(durationText(2721), "45m");
  assert.equal(treelineUrl(`at://${DID}/world.treeline.activity.record/3mwzp47fmse2p`), "https://treeline.world/?activity=at%3A%2F%2Fdid%3Aplc%3Arqbqpaaluty5v47jwciowpik%2Fworld.treeline.activity.record%2F3mwzp47fmse2p");
});

test("activities: grouped by month, newest first", () => {
  const list = [
    activityFromRecord(record("a", { startedAt: "2026-09-25T18:00:00Z", title: "Clear Creek" }), OWNER),
    activityFromRecord(record("b", { startedAt: "2026-10-07T20:45:33Z", title: "Van Bibber" }), OWNER),
    activityFromRecord(record("c", { startedAt: "2026-10-01T20:03:13Z", title: "Nightbird" }), OWNER),
  ];
  const g = groupActivities(list);
  assert.deepEqual(g.map((x) => x.title), ["October 2026", "September 2026"]);
  assert.deepEqual(g[0].items.map((a) => a.title), ["Van Bibber", "Nightbird"]);
});

function activityPages(extra = {}, pieceExtra = {}) {
  const pages = emptyPages();
  const a = activityFromRecord(record("3mwzp47fmse2p", {}, { distanceMeters: 4517 }), OWNER, "America/Denver");
  pages[1] = { ...pages[1], layout: "activity", piece: { ...activityPiece(a, { distance: "mi", elevation: "ft" }), ...pieceExtra }, words: "Golden aspens all the way up.", ...extra };
  return pages;
}

test("activities: the page as the reader gets it, the recipe, credits and problems", () => {
  const pages = activityPages();
  const config = zineConfig({ title: "Fall", handle: "pyxorium.com", paper: "letter", look: "clean", pages });
  const z = config.pages[1];
  assert.equal(z.activity.title, "Golden Hiking Nightbird Gulch Trail");
  assert.deepEqual(z.activity.stats, [{ label: "Distance", value: "2.8 mi" }, { label: "Climb", value: "↑ 735 ft" }, { label: "Time", value: "1h 30m" }]);
  assert.ok(z.activity.route.d.startsWith("M"));
  assert.ok(z.activity.profile.line && /ft$/.test(z.activity.profile.high));
  assert.equal(z.activity.url, treelineUrl(`at://${DID}/world.treeline.activity.record/3mwzp47fmse2p`));
  assert.equal(z.words, "Golden aspens all the way up.");
  assert.deepEqual(config.credits.find((c) => c.app === "Treeline"), { what: "Activities", app: "Treeline", href: "https://treeline.world/", pages: "page 1" });
  // The profile switched off.
  const off = zineConfig({ title: "Fall", handle: "x", paper: "letter", look: "clean", pages: activityPages({}, { showProfile: false }) });
  assert.equal(off.pages[1].activity.profile, undefined);
  // Without the creator's units, the paper decides.
  const a4 = zineConfig({ title: "Fall", handle: "x", paper: "a4", look: "clean", pages: activityPages({}, { activity: { ...pages[1].piece.activity, units: null } }) });
  assert.equal(a4.pages[1].activity.stats[0].value, "4.5 km");
  // The recipe names the record, never the route.
  const recipe = zineRecipe({ paper: "letter", look: "clean", pages });
  assert.deepEqual(recipe.pages[1].activity, { kind: "activity", uri: `at://${DID}/world.treeline.activity.record/3mwzp47fmse2p`, cid: "bafyrei3mwzp47fmse2p", title: "Golden Hiking Nightbird Gulch Trail", profile: true });
  assert.ok(!JSON.stringify(recipe).includes("M0 "), "no route drawing in the recipe");
  // Problems: none when ready; a page with the layout but no activity asks for one.
  assert.deepEqual(pieceProblems(pages[1], PAGES[1]), []);
  const empty = emptyPages();
  empty[2] = { ...empty[2], layout: "activity" };
  assert.deepEqual(pieceProblems(empty[2], PAGES[2]), ["Page 2: choose one of your activities, or pick another layout."]);
  // No files: everything is drawn from the record.
  assert.deepEqual(pieceFiles(pages[1], "p1"), []);
  assert.equal(activityRecipe({ piece: { kind: "activity", status: "loading" } }), null);
  assert.equal(activityForReader({ piece: null }, "letter"), null);
});

test("activities: the zine builds; the layout, words room, review summary and reader know about it", () => {
  const pages = activityPages();
  const tile = makeZineTile({ name: "Fall", handle: "pyxorium.com", pages });
  assert.deepEqual(tile.files.map((f) => f.path), ["/"]);
  const html = new TextDecoder().decode(tile.files[0].bytes);
  assert.ok(html.includes("Golden Hiking Nightbird Gulch Trail") && html.includes("treeline.world"));
  assert.ok(!html.includes("bafkreiraw"));
  assert.ok(LAYOUTS.some((l) => l.value === "activity" && l.label === "An activity"));
  assert.equal(wordLimit(PAGES[1], { layout: "activity" }, { paper: "letter" }), ACTIVITY_ROOM.letter.page);
  assert.equal(wordLimit(PAGES[7], { layout: "activity" }, { paper: "a4" }), ACTIVITY_ROOM.a4.back);
  assert.equal(wordLimit(PAGES[1], { layout: "activity", sound: true }, { paper: "letter" }), ACTIVITY_ROOM.letter.page - ACTIVITY_SOUND_COST);
  const sprite = { bytes: new Uint8Array(4), geometry: { columns: 3, rows: 4, frameWidth: 48, frameHeight: 48 } };
  assert.equal(wordLimit(PAGES[1], { layout: "activity", sprite: true }, { paper: "letter", sprite }), ACTIVITY_ROOM.letter.page - ACTIVITY_SPRITE_COST);
  // The profile takes its room only when it's shown (on by default, off with the switch).
  assert.equal(wordLimit(PAGES[1], pages[1], { paper: "letter" }), ACTIVITY_ROOM.letter.page - ACTIVITY_PROFILE_COST);
  assert.equal(wordLimit(PAGES[1], { ...pages[1], piece: { ...pages[1].piece, showProfile: false } }, { paper: "letter" }), ACTIVITY_ROOM.letter.page);
  // The smallest case (A4 back with the sprite, a sound and the profile) has no room left for words.
  assert.equal(wordLimit(PAGES[7], { ...pages[1], sound: true, sprite: true }, { paper: "a4", sprite }), 0);
  assert.match(zine.reviewSummary({ pages }), /1 activity/);
  assert.ok(READER_JS.includes("activityBlock") && READER_CSS.includes(".act-route"));
  assert.ok(JSON.stringify(zine.credits).includes("treeline.world"));
});

// The map: compass rose and scale bar in corners the route leaves free.
const shape = (pts, m = 3) => ({ w: 1000, h: 1000, m, d: pts.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join(""), start: pts[0], end: pts[pts.length - 1] });
const inside = (r, W, H) => r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H;
function covers(L, route, rect) {
  const P = [...route.d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [L.x + Number(m[1]) * L.s, L.y + Number(m[2]) * L.s]);
  for (let i = 0; i <= 200; i++) {
    for (let k = 1; k < P.length; k++) {
      const t = i / 200, x = P[k - 1][0] + (P[k][0] - P[k - 1][0]) * t, y = P[k - 1][1] + (P[k][1] - P[k - 1][1]) * t;
      if (x > rect.x && x < rect.x + rect.w && y > rect.y && y < rect.y + rect.h) return true;
    }
  }
  return false;
}

test("map: the rose goes top right, the scale bar bottom left, when the route leaves them free", () => {
  const route = shape([[400, 100], [500, 500], [600, 900]]);
  const L = mapLayout(route, 286, 200, "mi");
  assert.equal(L.overlap, false);
  assert.ok(L.rose.x > 200 && L.rose.y < 20, "top right");
  assert.ok(L.scale.x < 20 && L.scale.y > 150, "bottom left");
  assert.ok(inside(L.rose, 286, 200) && inside(L.scale, 286, 200));
  // The scale bar is true: its pixels times metres per pixel make its label.
  const perPx = route.m / L.s;
  const metres = L.scale.bar * perPx;
  assert.match(L.scale.label, /^[\d.]+ mi$/);
  assert.ok(Math.abs(metres - parseFloat(L.scale.label) * 1609.344) < 1);
  assert.equal(L.grid, L.scale.bar, "grid squares match the scale bar");
  assert.equal(mapLayout(route, 286, 200, "km").scale.label.match(/ (k?m)$/) !== null, true);
});

test("map: a route that starts bottom left and ends top right moves the rose and the scale bar", () => {
  const route = shape([[0, 1000], [300, 650], [700, 300], [1000, 0]]);
  const L = mapLayout(route, 200, 200, "mi");
  assert.equal(L.overlap, false);
  assert.ok(!(L.rose.x > 100 && L.rose.y < 100), "not top right, where the route ends");
  assert.ok(!(L.scale.x < 100 && L.scale.y > 100), "not bottom left, where it starts");
  assert.ok(!covers(L, route, L.rose) && !covers(L, route, L.scale));
});

test("map: a route that fills every corner is nudged or drawn smaller, never covered", () => {
  const loop = shape([[0, 0], [1000, 0], [1000, 1000], [0, 1000], [0, 0]]);
  const L = mapLayout(loop, 286, 286, "km");
  if (!L.overlap) {
    assert.ok(L.s < Math.min(262 / 1000, 262 / 1000) - 1e-9, "drawn smaller");
    assert.ok(!covers(L, loop, L.rose) && !covers(L, loop, L.scale));
  }
  // A squiggle across the whole box: drawn smaller and slid aside until two corners are free.
  const pts = [];
  for (let i = 0; i <= 40; i++) pts.push([i % 2 ? 1000 : 0, i * 25]);
  const Q = mapLayout(shape(pts), 200, 200, "mi");
  assert.equal(Q.overlap, false);
  assert.ok(!covers(Q, shape(pts), Q.rose) && !covers(Q, shape(pts), Q.scale));
  // A box too small for the rose and the scale bar to both stay clear: full size, on paper plates.
  const S = mapLayout(shape(pts), 70, 70, "mi");
  assert.equal(S.overlap, true);
  assert.equal(S.s, Math.min(46 / 1000, 46 / 1000));
  assert.ok(inside(S.rose, 70, 70));
});

test("map: no scale bar without a scale; light Riso inks are recognised", () => {
  const L = mapLayout({ w: 500, h: 1000, d: "M0 0L500 1000", start: [0, 0], end: [500, 1000] }, 286, 200, "mi");
  assert.equal(L.scale, null);
  assert.equal(L.grid, 0);
  assert.deepEqual(["#ff48b0", "#ff6c2f", "#00a95c", "#ffe800", "#ffb511", "#f15060"].map(isLightInk), [false, false, false, true, true, false]);
  const pages = activityPages();
  const riso = zineConfig({ title: "x", handle: "x", paper: "letter", look: "riso", ink: "burgundy-yellow", pages });
  assert.equal(riso.ink.light, true);
  assert.equal(zineConfig({ title: "x", handle: "x", paper: "letter", look: "riso", ink: "blue-pink", pages }).ink.light, undefined);
  assert.ok(riso.pages[1].activity.route.m > 0 && riso.pages[1].activity.route.unit === "mi");
  assert.ok(READER_JS.includes("function mapLayout"), "the zine's page carries the same placement");
});
