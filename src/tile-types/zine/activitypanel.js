import { listAll } from "../../core/app-pictures.js";
import { myAccounts, nameOf } from "../../core/my-accounts.js";
import { reviewExcerpt } from "./books.js";
import {
  TREELINE, activityFromRecord, isPublicActivity, activityPiece, groupActivities, unitsFromPreferences, unitsFor,
  distanceText, heightText, treelineUrl,
} from "./activities.js";
import { PAGES, wordLimit, pageInUse } from "./pages.js";

// The "Your activity" panel on an "An activity" page: a list of your public
// Treeline activities from all your accounts (public reads), newest first,
// by month; pick one and the page draws it from its record (nothing is
// downloaded: the route, stats and elevations are in the record; the raw GPS
// file is never touched). Units follow your Treeline preferences. A switch
// turns the elevation profile off for this page.
// Plain DOM, mounted by the Foundry's page editor (the pages input's piece panel).

const lists = new Map(); // did -> Promise<{ activities, hidden }>
const prefs = new Map(); // did -> Promise<units | null>
const SVG = "http://www.w3.org/2000/svg";

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}

function timeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch { return undefined; }
}

function activitiesOf(a) {
  if (!lists.has(a.did)) {
    const owner = { did: a.did, pds: a.pds, handle: a.handle || null };
    const tz = timeZone();
    const p = listAll(a, TREELINE.collection).then((records) => ({
      activities: records.map((r) => activityFromRecord(r, owner, tz)).filter(Boolean),
      hidden: records.filter((r) => !isPublicActivity(r)).length,
    }));
    p.catch(() => lists.delete(a.did));
    lists.set(a.did, p);
  }
  return lists.get(a.did);
}

/** The account's Treeline unit choice (its public preferences record), or null. */
function unitsOf(a) {
  if (!prefs.has(a.did)) {
    const u = new URL(`${a.pds}/xrpc/com.atproto.repo.getRecord`);
    u.searchParams.set("repo", a.did);
    u.searchParams.set("collection", TREELINE.preferences);
    u.searchParams.set("rkey", "self");
    const p = fetch(u.toString()).then((res) => (res.ok ? res.json() : null)).then((j) => unitsFromPreferences(j && j.value)).catch(() => null);
    prefs.set(a.did, p);
  }
  return prefs.get(a.did);
}

/** A small drawing of the route, for the list and the card. */
function routeThumb(route, className) {
  const s = document.createElementNS(SVG, "svg");
  s.setAttribute("class", className);
  s.setAttribute("aria-hidden", "true");
  if (!route) return s;
  const pad = 60;
  s.setAttribute("viewBox", `${-pad} ${-pad} ${route.w + 2 * pad} ${route.h + 2 * pad}`);
  s.setAttribute("preserveAspectRatio", "xMidYMid meet");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", route.d);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "3");
  path.setAttribute("vector-effect", "non-scaling-stroke");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("stroke-linecap", "round");
  s.append(path);
  return s;
}

export function mountActivityPanel(root, { getPage, patchPage, values, context }) {
  let page = getPage() || {};
  let lastValues = values;
  let lastContext = context;
  let accounts = null;
  let accountsKey = "";
  let all = null; // by uri
  let hidden = 0;
  let units = new Map(); // did -> units | null
  let browsing = false;
  let ticket = 0;
  let disposed = false;
  let listKey = "";

  const box = el("div", "book-panel activity-panel");
  root.append(box);
  const status = el("p", "snd-status");
  status.setAttribute("aria-live", "polite");
  const card = el("div", "tile-card book-card");
  const thumbBox = el("span", "activity-thumb");
  const about = el("div", "tile-about");
  const title = el("strong", "tile-name");
  const sub = el("span", "field-help tile-kind");
  const link = el("a", "activity-link", "See it on Treeline ↗");
  link.target = "_blank";
  link.rel = "noopener";
  const another = el("button", "btn btn-quiet btn-small", "Choose another activity");
  another.type = "button";
  about.append(title, sub, link, another);
  card.append(thumbBox, about);

  const profileLabel = el("label", "toggle activity-profile");
  const profileBox = el("input");
  profileBox.type = "checkbox";
  profileBox.setAttribute("role", "switch");
  const profileTrack = el("span", "toggle-track");
  profileTrack.setAttribute("aria-hidden", "true");
  profileLabel.append(profileBox, profileTrack, el("span", null, "Show the elevation profile"));
  const profileHelp = el("p", "field-help", "Drawn to an honest scale, so a flat walk looks flat and a climb looks like a climb.");
  const profileRow = el("div", "activity-profile-row");
  profileRow.append(profileLabel, profileHelp);

  const listHead = el("div", "book-list-head");
  const listTitle = el("span", "book-list-title", "Your Treeline activities");
  const refresh = el("button", "btn btn-quiet btn-small", "Refresh");
  refresh.type = "button";
  listHead.append(listTitle, refresh);
  const list = el("div", "book-list");
  list.setAttribute("role", "list");
  const help = el("p", "field-help", "Only your public activities are listed. The route, distance, climb and time come from Treeline, in the units you chose there; the start and end you hide on Treeline stay hidden here too.");
  box.append(status, card, profileRow, listHead, list, help);

  const piece = () => (page && page.piece && page.piece.kind === "activity" ? page.piece : null);

  function setStatus(text, error = false) {
    status.textContent = text || "";
    status.hidden = !text;
    status.classList.toggle("is-error", error);
  }

  function usedOn(uri) {
    const pages = (lastValues && lastValues.pages) || [];
    for (let i = 0; i < PAGES.length; i++) {
      const p = pages[i];
      if (!pageInUse(PAGES[i], lastValues)) continue; // put aside by a shorter zine
      if (!p || p.id === page.id || p.layout !== "activity" || !p.piece || p.piece.uri !== uri) continue;
      const s = PAGES[i];
      return s.kind === "back" ? "the back" : s.label.toLowerCase();
    }
    return null;
  }

  const unitsFrom = (a) => unitsFor(units.get(a.owner && a.owner.did) || null, lastValues && lastValues.paper);
  const subLine = (a) => {
    const u = unitsFrom(a);
    return [a.sport, a.date, distanceText(a.distance, u.distance), a.gain != null ? `↑ ${heightText(a.gain, u.elevation)}` : ""].filter(Boolean).join(" · ");
  };

  async function loadList(force = false) {
    if (!accounts) return;
    const mine = ++ticket;
    if (force) for (const a of accounts) { lists.delete(a.did); prefs.delete(a.did); }
    setStatus("Looking for your Treeline activities…");
    const [results, unitResults] = await Promise.all([
      Promise.allSettled(accounts.map((a) => activitiesOf(a))),
      Promise.all(accounts.map((a) => unitsOf(a))),
    ]);
    if (mine !== ticket || disposed) return;
    units = new Map(accounts.map((a, i) => [a.did, unitResults[i]]));
    const found = [];
    const failed = [];
    hidden = 0;
    results.forEach((r, i) => {
      if (r.status === "fulfilled") { found.push(...r.value.activities); hidden += r.value.hidden; } else failed.push({ a: accounts[i], err: r.reason });
    });
    all = new Map(found.map((a) => [a.uri, a]));
    listKey = "";
    drawList(found);
    let text = "";
    if (failed.length) text = `${failed.map((f) => nameOf(f.a)).join(", ")}: couldn't be listed (${(failed[0].err && failed[0].err.message) || "unknown problem"}). Press Refresh to try again. `;
    if (!found.length && !failed.length) text = hidden ? "Your Treeline activities are all private, so none can go in a zine." : `You haven't recorded any activities on Treeline from ${accounts.length > 1 ? "your accounts" : "this account"} yet.`;
    else if (hidden) text += `${hidden} private ${hidden === 1 ? "activity isn't" : "activities aren't"} listed.`;
    setStatus(text.trim(), Boolean(failed.length && !found.length));
    // The chosen activity takes the creator's units once they're known.
    const p = piece();
    const a = p && all.get(p.uri);
    if (a && p.activity && !p.activity.units && units.get(a.owner.did)) {
      patchPage((pg) => (pg.piece && pg.piece.uri === a.uri ? { piece: { ...pg.piece, activity: { ...pg.piece.activity, units: units.get(a.owner.did) } } } : null));
    }
    drawCard();
  }

  function drawList(found) {
    list.replaceChildren();
    const several = new Set(found.map((a) => a.owner.did)).size > 1;
    const p = piece();
    for (const g of groupActivities(found)) {
      list.append(el("p", "book-group", g.title));
      for (const a of g.items) {
        const row = el("button", "book-row");
        row.type = "button";
        row.setAttribute("role", "listitem");
        if (p && p.uri === a.uri) row.classList.add("on");
        const pic = el("span", "book-row-cover activity-row-route");
        pic.append(routeThumb(a.route, "activity-route-svg"));
        const text = el("span", "book-row-text");
        text.append(el("span", "book-row-title", a.title));
        text.append(el("span", "book-row-sub", [subLine(a), several ? nameOf(a.owner) : ""].filter(Boolean).join(" · ")));
        const used = usedOn(a.uri);
        if (used) text.append(el("span", "book-row-used", `On ${used}`));
        row.append(pic, text);
        row.setAttribute("aria-label", [a.title, subLine(a), used ? `already on ${used}` : ""].filter(Boolean).join(", "));
        row.addEventListener("click", () => choose(a));
        list.append(row);
      }
    }
  }

  function limitFor(pg) {
    const spec = PAGES.find((s) => s.id === pg.id) || PAGES[1];
    return wordLimit(spec, pg, lastValues || {});
  }

  function choose(a) {
    browsing = false;
    const now = getPage() || page;
    const before = now.piece && now.piece.kind === "activity" ? now.piece : null;
    const change = { piece: activityPiece(a, units.get(a.owner.did) || null, before ? before.showProfile !== false : true) };
    // The activity's own description, when it has one, fills the words unless the creator has written their own.
    const mineWords = String(now.words || "").trim() && now.words !== now.autoWords;
    if (!mineWords) {
      const line = reviewExcerpt(a.description, Math.floor(limitFor({ ...now, layout: "activity", piece: change.piece }) * 0.9));
      change.words = line;
      change.autoWords = line;
    }
    patchPage(change);
  }

  refresh.addEventListener("click", () => loadList(true));
  another.addEventListener("click", () => {
    browsing = !browsing;
    drawCard();
    const first = browsing && list.querySelector(".book-row");
    if (first) first.focus();
  });
  profileBox.addEventListener("change", () => {
    const on = profileBox.checked;
    patchPage((pg) => (pg.piece && pg.piece.kind === "activity" ? { piece: { ...pg.piece, showProfile: on } } : null));
  });

  function drawCard() {
    const p = piece();
    const chosen = Boolean(p && p.uri);
    card.hidden = !chosen;
    profileRow.hidden = !chosen;
    const showList = !chosen || browsing;
    list.hidden = !showList || !all;
    listHead.hidden = !showList || !accounts;
    another.textContent = browsing ? "Keep this activity" : "Choose another activity";
    if (!chosen) return;
    const a = p.activity || {};
    title.textContent = a.title || p.name || "Untitled activity";
    const u = unitsFor(a.units, lastValues && lastValues.paper);
    sub.textContent = [a.sport, a.date, distanceText(a.distance, u.distance), a.gain != null ? `↑ ${heightText(a.gain, u.elevation)}` : ""].filter(Boolean).join(" · ");
    link.href = treelineUrl(p.uri);
    thumbBox.replaceChildren(routeThumb(a.route, "activity-route-svg"));
    thumbBox.classList.toggle("none", !a.route);
    profileBox.checked = p.showProfile !== false;
    profileBox.disabled = !(Array.isArray(a.elevations) && a.elevations.length > 1);
    profileHelp.textContent = profileBox.disabled
      ? "This activity has no elevations recorded, so there's no profile to show."
      : "Drawn to an honest scale, so a flat walk looks flat and a climb looks like a climb.";
  }

  function useAccounts(ctx) {
    const mine = myAccounts(ctx);
    if (mine.state !== "ok") {
      accounts = null;
      accountsKey = "";
      all = null;
      list.replaceChildren();
      setStatus(mine.state === "out" ? "Sign in to pick one of your Treeline activities." : mine.state === "lookup" ? "Your account's details couldn't be looked up, so your activities can't be listed yet." : "Looking up your account…");
      drawCard();
      return false;
    }
    if (accounts && accountsKey === mine.key) return true;
    accounts = mine.list;
    accountsKey = mine.key;
    loadList();
    return true;
  }

  function update(next, nextValues, ctx) {
    if (disposed) return;
    page = next || getPage() || {};
    if (nextValues) lastValues = nextValues;
    if (ctx) lastContext = ctx;
    useAccounts(ctx || lastContext);
    const p = piece();
    if (all) {
      const key = [(p && p.uri) || "", (lastValues && lastValues.paper) || "", ...((lastValues && lastValues.pages) || []).map((q) => (q && q.layout === "activity" && q.piece && q.piece.uri) || "")].join("|");
      if (key !== listKey) { listKey = key; drawList([...all.values()]); }
    }
    drawCard();
  }

  update(page, values, context);
  return {
    update,
    dispose() {
      disposed = true;
      box.remove();
    },
  };
}
