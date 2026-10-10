// "An activity" pages: one of the creator's Treeline activities (a hike, a
// ride, a walk…), drawn from its record: the route as a line in the zine's
// look, an elevation profile, the title, sport, date, distance, climb and
// time, in the units the creator chose on Treeline. Nothing is downloaded:
// everything comes from the record itself. No DOM here, so the tests can use
// it; the panel that picks an activity is activitypanel.js.
//
// world.treeline.activity.record (Treeline's lexicon, checked Oct 10 2026):
//   sport ("walk", "hike", "road_ride", …), title, description, privacy ("public"…),
//   stats { distanceMeters, elevationGainMeters, elevationLossMeters,
//   movingDurationSeconds, elapsedDurationSeconds }, geometry (a GeoJSON
//   LineString whose coordinates are strings: [lon, lat, elevation m]),
//   rawBlob (the original GPS file, full and untrimmed: NEVER copied or read),
//   startedAt, endedAt, createdAt, deviceInfo, hideStartEndMeters.
// world.treeline.actor.preferences (rkey "self"): unitSystem, distanceUnits
//   ("mi" | "km"), elevationUnits ("ft" | "m"), temperatureUnits.
//
// Privacy (agreed Oct 10): only public activities; the raw GPS file is never
// used; Treeline already trims hideStartEndMeters off both ends of the route in
// the record (checked on the owner's records), and if a record's route looks
// untrimmed (it's nearly as long as the whole activity), it's trimmed here too.
// No coordinates go into the zine: only the route's shape, scaled to a box.
//
// A page with the "An activity" layout keeps its activity in page.piece:
//   { kind: "activity", uri, cid, did, own, name, status: "ready", files: [],
//     showProfile: true | false,
//     activity: { title, sport, date, distance, gain, moving, elapsed,
//                 route: { w, h, d, start: [x, y], end: [x, y] } | null,
//                 elevations: [metres, …] | null,      (evenly spaced along the route)
//                 units: { distance: "mi" | "km", elevation: "ft" | "m" } | null } }
// The page's words are the creator's own (filled with the activity's
// description when it has one, as books fill a line from the review).

export const TREELINE = Object.freeze({
  app: "Treeline",
  collection: "world.treeline.activity.record",
  preferences: "world.treeline.actor.preferences",
  home: "https://treeline.world/",
});

export const ACTIVITY_TITLE_MAX = 120;
const ROUTE_BOX = 1000; // the route's longest side, in drawing units
const ROUTE_POINTS_MAX = 400;
const PROFILE_POINTS = 120;
export const PROFILE_MIN_RANGE = 100; // metres: an honest scale, so a flat walk looks flat
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const SPORTS = {
  walk: "Walk", hike: "Hike", run: "Run", road_run: "Road run", trail_run: "Trail run",
  ride: "Ride", road_ride: "Road ride", gravel: "Gravel ride", gravel_ride: "Gravel ride", mtb: "Mountain bike",
  ski: "Ski", backcountry_ski: "Backcountry ski", nordic_ski: "Nordic ski", snowshoe: "Snowshoe",
  swim: "Swim", paddle: "Paddle", kayak: "Kayak", climb: "Climb", workout: "Workout",
};

function oneLine(s, max) {
  return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** "road_ride" → "Road ride"; unknown sports are tidied the same way. */
export function sportLabel(sport) {
  const s = String(sport || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 40);
  if (SPORTS[s]) return SPORTS[s];
  const t = s.replace(/_+/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "Activity";
}

const num = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
const nonNeg = (v) => (Number.isFinite(num(v)) && num(v) >= 0 ? num(v) : null);

/** Metres between two [lon, lat] points. */
export function metresBetween(a, b) {
  const r = Math.PI / 180, R = 6371000;
  const dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The record's route as numbers: [[lon, lat, elevation | null], …] (bad points dropped). */
export function routePoints(geometry) {
  const c = geometry && geometry.type === "LineString" && Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  const out = [];
  for (const p of c.slice(0, 20000)) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const lon = num(p[0]), lat = num(p[1]), e = p.length > 2 ? num(p[2]) : NaN;
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) continue;
    out.push([lon, lat, Number.isFinite(e) && Math.abs(e) < 10000 ? e : null]);
  }
  return out;
}

function lengthOf(points) {
  let n = 0;
  for (let i = 1; i < points.length; i++) n += metresBetween(points[i - 1], points[i]);
  return n;
}

/** The route with `metres` cut off each end (along the route). */
export function trimEnds(points, metres) {
  if (!(metres > 0) || points.length < 2) return points.slice();
  const cut = (pts) => {
    let gone = 0;
    for (let i = 1; i < pts.length; i++) {
      gone += metresBetween(pts[i - 1], pts[i]);
      if (gone >= metres) return pts.slice(i);
    }
    return [];
  };
  const front = cut(points);
  return cut(front.slice().reverse()).reverse();
}

/**
 * The route as it may appear in a zine: Treeline trims `hide` metres off both
 * ends already; if this record's route is still about as long as the whole
 * activity (so it wasn't trimmed), it's trimmed here.
 */
export function privateRoute(points, hide, distance) {
  const h = Number.isFinite(hide) && hide > 0 ? Math.min(hide, 20000) : 0;
  if (!h) return points;
  const len = lengthOf(points);
  const untrimmed = !(distance > 0) || len > distance - h;
  return untrimmed ? trimEnds(points, h) : points;
}

// Douglas–Peucker on drawing coordinates.
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    let far = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
      if (d > far) { far = d; idx = i; }
    }
    if (far > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * The route's shape for drawing: projected around its middle, scaled so its
 * longest side is 1000 units, simplified. No coordinates are kept.
 *   { w, h, d: "M x y L x y …", start: [x, y], end: [x, y], m: metres per unit } or null
 */
export function routeShape(points) {
  if (points.length < 2) return null;
  const lat0 = points.reduce((n, p) => n + p[1], 0) / points.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xy = points.map((p) => [p[0] * k, -p[1]]);
  const xs = xy.map((p) => p[0]), ys = xy.map((p) => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX, spanY = Math.max(...ys) - minY;
  const span = Math.max(spanX, spanY);
  if (!(span > 0)) return null;
  const s = ROUTE_BOX / span;
  let pts = xy.map((p) => [Math.round((p[0] - minX) * s), Math.round((p[1] - minY) * s)]);
  let tol = 1.2;
  pts = simplify(pts, tol);
  while (pts.length > ROUTE_POINTS_MAX && tol < 40) { tol *= 1.6; pts = simplify(pts, tol); }
  const w = Math.max(1, Math.round(spanX * s)), h = Math.max(1, Math.round(spanY * s));
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join("");
  // Metres per drawing unit, for the scale bar and the grid (a scale, not a place).
  const m = Math.round((111320 / s) * 1000) / 1000;
  return { w, h, d, start: pts[0], end: pts[pts.length - 1], m };
}

/** Elevations evenly spaced along the route (lightly smoothed), or null without them. */
export function elevationsAlong(points, count = PROFILE_POINTS) {
  const pts = points.filter((p) => p[2] != null);
  if (pts.length < 2) return null;
  const at = [0];
  for (let i = 1; i < pts.length; i++) at.push(at[i - 1] + metresBetween(pts[i - 1], pts[i]));
  const total = at[at.length - 1];
  if (!(total > 0)) return null;
  const out = [];
  let j = 0;
  for (let i = 0; i < count; i++) {
    const want = (total * i) / (count - 1);
    while (j < pts.length - 2 && at[j + 1] < want) j++;
    const span = at[j + 1] - at[j] || 1;
    const t = Math.min(1, Math.max(0, (want - at[j]) / span));
    out.push(pts[j][2] + (pts[j + 1][2] - pts[j][2]) * t);
  }
  // A light smoothing evens out GPS wobble without flattening real climbs.
  return out.map((e, i) => {
    const a = out[Math.max(0, i - 1)], b = out[Math.min(out.length - 1, i + 1)];
    return Math.round(((a + 2 * e + b) / 4) * 10) / 10;
  });
}

/** "October 1, 2026" from a date and time, in the given time zone (the creator's, when picked). */
export function dateLabel(iso, timeZone) {
  const t = Date.parse(String(iso || ""));
  if (!Number.isFinite(t)) return "";
  try {
    return new Date(t).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", ...(timeZone ? { timeZone } : {}) });
  } catch {
    const d = new Date(t);
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  }
}

/**
 * One world.treeline.activity.record as an activity for the list, or null.
 * Only public activities. The raw GPS file is not touched.
 */
export function activityFromRecord(record, owner = null, timeZone) {
  const v = record && record.value;
  if (!v || typeof v !== "object") return null;
  if (String(v.privacy || "") !== "public") return null;
  const stats = v.stats && typeof v.stats === "object" ? v.stats : {};
  const distance = nonNeg(stats.distanceMeters);
  const hide = nonNeg(v.hideStartEndMeters) || 0;
  const points = privateRoute(routePoints(v.geometry), hide, distance);
  const title = oneLine(v.title, ACTIVITY_TITLE_MAX) || sportLabel(v.sport);
  return {
    uri: String(record.uri || ""),
    cid: String(record.cid || ""),
    title,
    sport: sportLabel(v.sport),
    startedAt: Number.isFinite(Date.parse(v.startedAt)) ? new Date(Date.parse(v.startedAt)).toISOString() : "",
    date: dateLabel(v.startedAt, timeZone),
    distance,
    gain: nonNeg(stats.elevationGainMeters),
    moving: nonNeg(stats.movingDurationSeconds),
    elapsed: nonNeg(stats.elapsedDurationSeconds),
    description: typeof v.description === "string" ? v.description.slice(0, 5000) : "",
    route: routeShape(points),
    elevations: elevationsAlong(points),
    owner,
  };
}

/** Whether a record is one we'd list (public); counts the others for the panel's note. */
export function isPublicActivity(record) {
  return Boolean(record && record.value && record.value.privacy === "public");
}

/** The creator's units from their Treeline preferences record, or null. */
export function unitsFromPreferences(value) {
  if (!value || typeof value !== "object") return null;
  const sys = String(value.unitSystem || "");
  const distance = value.distanceUnits === "mi" || value.distanceUnits === "km" ? value.distanceUnits : sys === "imperial" ? "mi" : sys === "metric" ? "km" : null;
  const elevation = value.elevationUnits === "ft" || value.elevationUnits === "m" ? value.elevationUnits : sys === "imperial" ? "ft" : sys === "metric" ? "m" : null;
  return distance && elevation ? { distance, elevation } : null;
}

/** The units a page uses: the creator's Treeline choice, else by paper (Letter: miles and feet). */
export function unitsFor(units, paper) {
  if (units && (units.distance === "mi" || units.distance === "km") && (units.elevation === "ft" || units.elevation === "m")) return units;
  return paper === "a4" ? { distance: "km", elevation: "m" } : { distance: "mi", elevation: "ft" };
}

const group3 = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** "2.8 mi", "56.4 km", "167 km". */
export function distanceText(metres, unit) {
  if (metres == null) return "";
  const v = unit === "mi" ? metres / 1609.344 : metres / 1000;
  return `${v >= 100 ? group3(v) : v.toFixed(1)} ${unit === "mi" ? "mi" : "km"}`;
}

/** "735 ft", "1,026 m". */
export function heightText(metres, unit) {
  if (metres == null) return "";
  return `${group3(unit === "ft" ? metres * 3.28084 : metres)} ${unit === "ft" ? "ft" : "m"}`;
}

/** "1h 29m", "45m", "7h 04m". */
export function durationText(seconds) {
  if (seconds == null) return "";
  const m = Math.round(seconds / 60);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

/** The link to an activity on Treeline. */
export function treelineUrl(uri) {
  return `${TREELINE.home}?activity=${encodeURIComponent(String(uri || ""))}`;
}

/**
 * The elevation profile, drawn to an honest scale: at least PROFILE_MIN_RANGE
 * metres tall, so a flat walk looks flat. In a 1000 × 200 box:
 *   { line: "M…", area: "M…Z", low, high } (metres) or null
 */
export function profileShape(elevations, minRange = PROFILE_MIN_RANGE) {
  if (!Array.isArray(elevations) || elevations.length < 2) return null;
  const lo = Math.min(...elevations), hi = Math.max(...elevations);
  const range = Math.max(minRange, hi - lo);
  const base = lo - (range - (hi - lo)) * 0.25; // a flat route sits low, not in the middle
  const W = 1000, H = 200, pad = 8;
  const y = (e) => Math.round((H - pad - ((e - base) / range) * (H - 2 * pad)) * 10) / 10;
  const x = (i) => Math.round((i / (elevations.length - 1)) * W * 10) / 10;
  const line = elevations.map((e, i) => `${i ? "L" : "M"}${x(i)} ${y(e)}`).join("");
  return { line, area: `${line}L${W} ${H}L0 ${H}Z`, low: lo, high: hi };
}

/** A piece for a page, from a listed activity (units from the creator's Treeline preferences). */
export function activityPiece(a, units = null, showProfile = true) {
  return {
    kind: "activity", uri: a.uri, cid: a.cid, did: a.owner && a.owner.did, own: true, name: a.title,
    status: "ready", files: [], showProfile: showProfile !== false,
    activity: {
      title: a.title, sport: a.sport, date: a.date, distance: a.distance, gain: a.gain, moving: a.moving, elapsed: a.elapsed,
      route: a.route, elevations: a.elevations, units: units || null,
    },
  };
}

export function activityReady(piece) {
  return Boolean(piece && piece.kind === "activity" && piece.status === "ready" && piece.activity && piece.activity.title);
}

/**
 * A page's activity as the reader gets it, or null:
 *   { title, sport, date, url, stats: [{ label, value }], route?: { w, h, d, start, end, unit, m? },
 *     profile?: { line, area, low, high } }
 * (low and high as text in the creator's units.)
 */
export function activityForReader(page, paper) {
  const p = page && page.piece;
  if (!activityReady(p)) return null;
  const a = p.activity;
  const u = unitsFor(a.units, paper);
  const stats = [];
  if (a.distance != null) stats.push({ label: "Distance", value: distanceText(a.distance, u.distance) });
  if (a.gain != null) stats.push({ label: "Climb", value: `↑ ${heightText(a.gain, u.elevation)}` });
  const t = a.moving != null ? a.moving : a.elapsed;
  if (t != null) stats.push({ label: "Time", value: durationText(t) });
  const out = { title: oneLine(a.title, ACTIVITY_TITLE_MAX), sport: oneLine(a.sport, 40), date: oneLine(a.date, 40), url: treelineUrl(p.uri), stats };
  const r = a.route;
  if (r && typeof r.d === "string" && /^[ML0-9 .-]+$/.test(r.d) && r.w > 0 && r.h > 0) {
    out.route = { w: r.w, h: r.h, d: r.d, start: r.start, end: r.end, unit: u.distance };
    if (Number.isFinite(r.m) && r.m > 0) out.route.m = r.m;
  }
  if (p.showProfile !== false) {
    const s = profileShape(a.elevations);
    if (s) out.profile = { line: s.line, area: s.area, low: heightText(s.low, u.elevation), high: heightText(s.high, u.elevation) };
  }
  return out;
}

/** A page's activity in the zine's public recipe: the record it came from (no route, no coordinates). */
export function activityRecipe(page) {
  const p = page && page.piece;
  if (!activityReady(p)) return null;
  return { kind: "activity", uri: p.uri, cid: p.cid, title: oneLine(p.activity.title, ACTIVITY_TITLE_MAX), profile: p.showProfile !== false };
}

/** Activities grouped by month ("October 2026"), newest first. */
export function groupActivities(list) {
  const sorted = list.slice().sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  const groups = [];
  for (const a of sorted) {
    const t = Date.parse(a.startedAt);
    const key = Number.isFinite(t) ? `${MONTHS[new Date(t).getMonth()]} ${new Date(t).getFullYear()}` : "Other activities";
    let g = groups.find((x) => x.title === key);
    if (!g) { g = { key, title: key, items: [] }; groups.push(g); }
    g.items.push(a);
  }
  return groups;
}

/**
 * Where the map's pieces go in a box of W × H pixels (the zine's page, or the
 * card art): the route's scale and offset, the compass rose's corner, and a
 * true scale bar (whose length is also the grid's square). The rose tries the
 * top right, then top left, then the bottom corners; the scale bar tries the
 * bottom left, then bottom right, then the top; neither may cover the route
 * or its start and finish. If no pair of corners is free, the route is nudged
 * within its spare room, then drawn a little smaller (down to 75%); failing
 * that, it's drawn full size and the two sit on small paper plates (overlap).
 * Self-contained (no outside names), so the zine's page carries its source.
 *   route: { w, h, d, start, end, m? }, unit: "mi" | "km"
 *   → { s, x, y, rose: { x, y, w, h }, scale: { x, y, w, h, bar, label } | null, grid, overlap }
 */
export function mapLayout(route, W, H, unit) {
  var PAD = 12, INSET = 6, ROSE_W = 34, ROSE_H = 44, SCALE_H = 22, MARK = 10, EDGE = 3;
  var pts = [];
  var re = /[ML]\s*(-?[\d.]+)\s+(-?[\d.]+)/g, m;
  while ((m = re.exec(String(route.d || "")))) pts.push([Number(m[1]), Number(m[2])]);
  var MI = 1609.344;
  var steps = unit === "mi" ? [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200] : [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
  function scaleFor(s) {
    if (!(route.m > 0)) return null;
    var perPx = route.m / s; // metres per pixel
    var want = W * 0.28 * perPx, pick = steps[0];
    for (var i = 0; i < steps.length; i++) if (steps[i] * (unit === "mi" ? MI : 1000) <= want) pick = steps[i];
    var metres = pick * (unit === "mi" ? MI : 1000);
    var bar = metres / perPx;
    var label = unit === "mi" ? pick + " mi" : pick < 1 ? Math.round(pick * 1000) + " m" : pick + " km";
    return { bar: bar, label: label, w: Math.max(bar, 34) + 10, h: SCALE_H };
  }
  function corner(c, w, h) {
    return { x: c[1] === "l" ? INSET : W - INSET - w, y: c[0] === "t" ? INSET : H - INSET - h, w: w, h: h };
  }
  function hitsSeg(r, a, b) {
    var x0 = r.x - EDGE, y0 = r.y - EDGE, x1 = r.x + r.w + EDGE, y1 = r.y + r.h + EDGE;
    var t0 = 0, t1 = 1, dx = b[0] - a[0], dy = b[1] - a[1];
    var p = [-dx, dx, -dy, dy], q = [a[0] - x0, x1 - a[0], a[1] - y0, y1 - a[1]];
    for (var i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return false; continue; }
      var t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return true;
  }
  function hitsDot(r, c) {
    var nx = Math.max(r.x, Math.min(c[0], r.x + r.w)), ny = Math.max(r.y, Math.min(c[1], r.y + r.h));
    return (nx - c[0]) * (nx - c[0]) + (ny - c[1]) * (ny - c[1]) < MARK * MARK;
  }
  function free(r, P) {
    for (var i = 1; i < P.length; i++) if (hitsSeg(r, P[i - 1], P[i])) return false;
    if (P.length && (hitsDot(r, P[0]) || hitsDot(r, P[P.length - 1]))) return false;
    return true;
  }
  function apart(a, b) { return a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y; }
  var base = Math.min((W - 2 * PAD) / route.w, (H - 2 * PAD) / route.h);
  var ROSE = ["tr", "tl", "br", "bl"], SCALE = ["bl", "br", "tl", "tr"];
  var zooms = [1, 0.95, 0.9, 0.85, 0.8, 0.75];
  for (var z = 0; z < zooms.length; z++) {
    var s = base * zooms[z];
    var sx = W - 2 * PAD - route.w * s, sy = H - 2 * PAD - route.h * s;
    var xs = [sx / 2, 0, sx], ys = [sy / 2, 0, sy];
    var sc = scaleFor(s);
    for (var a = 0; a < 3; a++) for (var b = 0; b < 3; b++) {
      var ox = PAD + xs[a], oy = PAD + ys[b];
      var P = pts.map(function (q) { return [ox + q[0] * s, oy + q[1] * s]; });
      for (var i = 0; i < ROSE.length; i++) {
        var rr = corner(ROSE[i], ROSE_W, ROSE_H);
        if (!free(rr, P)) continue;
        if (!sc) return { s: s, x: ox, y: oy, rose: rr, scale: null, grid: 0, overlap: false };
        for (var j = 0; j < SCALE.length; j++) {
          if (SCALE[j] === ROSE[i]) continue;
          var sr = corner(SCALE[j], sc.w, sc.h);
          if (apart(rr, sr) && free(sr, P)) {
            return { s: s, x: ox, y: oy, rose: rr, scale: { x: sr.x, y: sr.y, w: sr.w, h: sr.h, bar: sc.bar, label: sc.label }, grid: sc.bar, overlap: false };
          }
        }
      }
    }
  }
  var s1 = base, sc1 = scaleFor(s1);
  var fx = PAD + (W - 2 * PAD - route.w * s1) / 2, fy = PAD + (H - 2 * PAD - route.h * s1) / 2;
  var r1 = corner("tr", ROSE_W, ROSE_H);
  var s2 = sc1 ? corner("bl", sc1.w, sc1.h) : null;
  return { s: s1, x: fx, y: fy, rose: r1, scale: s2 ? { x: s2.x, y: s2.y, w: s2.w, h: s2.h, bar: sc1.bar, label: sc1.label } : null, grid: sc1 ? sc1.bar : 0, overlap: true };
}

