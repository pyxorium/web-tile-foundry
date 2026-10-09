// Pictures from the creator's other atproto apps (Zine Scene stage 5, part 1):
// Grain photos and PinkSea drawings, read from the creator's own accounts.
//
// Same rule as songs, sprites, tiles and tapes: only files stored in the
// creator's own account (blobs on their PDS) are copied in; reading is public,
// so no sign-in is used. Nothing here touches the page (no DOM), so the tests
// can run it in Node.
//
// Record shapes, checked against live records Oct 9 2026:
//   social.grain.photo        { photo: blob, alt, aspectRatio { width, height }, createdAt, labels? }
//   social.grain.gallery      { title, description?, createdAt, labels? }
//   social.grain.gallery.item { gallery: at-uri, item: at-uri (a photo), position (from 0), createdAt }
//   com.shinolabs.pinksea.oekaki { image: { blob, imageLink { alt } }, nsfw, tags, inResponseTo?, createdAt }
//     (an older shape with the blob straight in `image` is read too)
//
// A picture item, as the picker shows it:
//   { app, uri, cid, blobCid, mimeType, size, alt, width, height, sensitive,
//     reply, createdAt, owner { did, pds, handle } }

import { rawCid } from "./cid.js";

export const APP_PICTURE_SOURCES = Object.freeze({
  grain: Object.freeze({
    id: "grain",
    app: "Grain",
    menuLabel: "From Grain",
    collection: "social.grain.photo",
    noun: "photo",
    what: "Photos",
    home: "https://grain.social/",
    empty: "Nothing on Grain yet",
  }),
  pinksea: Object.freeze({
    id: "pinksea",
    app: "PinkSea",
    menuLabel: "From PinkSea",
    collection: "com.shinolabs.pinksea.oekaki",
    noun: "drawing",
    what: "Drawings",
    home: "https://pinksea.art/",
    empty: "Nothing on PinkSea yet",
  }),
});

export const GRAIN_GALLERY = "social.grain.gallery";
export const GRAIN_ITEM = "social.grain.gallery.item";

/** Self-labels that mean "sensitive" (atproto's adult-content and graphic labels). */
export const SENSITIVE_LABELS = Object.freeze(["porn", "sexual", "nudity", "graphic-media", "gore", "nsfw", "!warn"]);

const PICTURE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/bmp"];
const PAGE_SIZE = 100;
const MAX_RECORDS = 1000;
const TIMEOUT_MS = 12000;

function blobCidOf(blob) {
  if (!blob || typeof blob !== "object") return null;
  if (blob.ref && typeof blob.ref.$link === "string") return blob.ref.$link;
  if (typeof blob.cid === "string") return blob.cid; // the old blob shape
  return null;
}

function labelsSensitive(value) {
  const vals = value && value.labels && Array.isArray(value.labels.values) ? value.labels.values : [];
  return vals.some((l) => l && SENSITIVE_LABELS.includes(String(l.val || "").toLowerCase()));
}

function cleanAlt(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 200);
}

/** One record as a picture item, or null when it holds no usable picture. */
export function pictureFromRecord(app, record, owner = null) {
  const v = record && record.value;
  if (!v || typeof v !== "object") return null;
  let blob = null;
  let alt = "";
  let width = 0;
  let height = 0;
  let sensitive = false;
  let reply = false;
  if (app === "grain") {
    blob = v.photo;
    alt = v.alt;
    if (v.aspectRatio) { width = Number(v.aspectRatio.width) || 0; height = Number(v.aspectRatio.height) || 0; }
    sensitive = labelsSensitive(v);
  } else if (app === "pinksea") {
    const img = v.image || {};
    blob = img.blob || (img.ref ? img : null);
    alt = (img.imageLink && img.imageLink.alt) || "";
    sensitive = v.nsfw === true || labelsSensitive(v);
    reply = Boolean(v.inResponseTo);
  } else {
    return null;
  }
  const blobCid = blobCidOf(blob);
  const mimeType = String((blob && blob.mimeType) || "").toLowerCase();
  if (!blobCid || (mimeType && !PICTURE_TYPES.includes(mimeType))) return null;
  return {
    app,
    uri: String(record.uri || ""),
    cid: String(record.cid || ""),
    blobCid,
    mimeType: mimeType || "image/png",
    size: Number(blob.size) || 0,
    alt: cleanAlt(alt),
    width,
    height,
    sensitive,
    reply,
    createdAt: String(v.createdAt || ""),
    owner,
  };
}

/**
 * Grain photos grouped by gallery, in gallery order (position), galleries newest
 * first; photos in no gallery last ("Other photos"). A photo in several
 * galleries shows in each. Returns [{ key, title, sensitive, items }].
 */
export function groupGrain(photos, galleries, items) {
  const byUri = new Map(photos.map((p) => [p.uri, p]));
  const placed = new Set();
  const sorted = galleries.slice().sort((a, b) => String((b.value || {}).createdAt || "").localeCompare(String((a.value || {}).createdAt || "")));
  const groups = [];
  for (const g of sorted) {
    const inIt = items
      .filter((i) => i && i.value && i.value.gallery === g.uri && byUri.has(i.value.item))
      .sort((a, b) => (Number(a.value.position) || 0) - (Number(b.value.position) || 0) || String(a.uri).localeCompare(String(b.uri)));
    if (!inIt.length) continue;
    const gSensitive = labelsSensitive(g.value);
    const list = [];
    for (const i of inIt) {
      const p = byUri.get(i.value.item);
      placed.add(p.uri);
      list.push(gSensitive && !p.sensitive ? { ...p, sensitive: true } : p);
    }
    groups.push({ key: g.uri, title: cleanAlt((g.value && g.value.title) || "") || "Untitled gallery", sensitive: gSensitive, items: list });
  }
  const loose = photos.filter((p) => !placed.has(p.uri)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (loose.length) groups.push({ key: "loose", title: groups.length ? "Other photos" : "Your photos", sensitive: false, items: loose });
  return groups;
}

async function getJson(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`the server answered ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err && err.name === "AbortError") throw new Error("your account's server took too long");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** All of an account's records in one collection (public listRecords, paged). */
export async function listAll(account, collection, fetchImpl = fetch) {
  const records = [];
  let cursor = null;
  do {
    const u = new URL(`${account.pds}/xrpc/com.atproto.repo.listRecords`);
    u.searchParams.set("repo", account.did);
    u.searchParams.set("collection", collection);
    u.searchParams.set("limit", String(PAGE_SIZE));
    if (cursor) u.searchParams.set("cursor", cursor);
    const page = await getJson(u.toString(), fetchImpl);
    const got = Array.isArray(page.records) ? page.records : [];
    for (const r of got) records.push(r);
    cursor = page.cursor && got.length ? page.cursor : null;
  } while (cursor && records.length < MAX_RECORDS);
  return records;
}

/**
 * One account's pictures from one app, grouped:
 *   Grain   → its galleries in order, then other photos
 *   PinkSea → one group, newest first
 * Returns [{ key, title, sensitive, items }].
 */
export async function accountPictures(app, account, fetchImpl = fetch) {
  const source = APP_PICTURE_SOURCES[app];
  if (!source) throw new Error(`Unknown picture source: ${app}`);
  const owner = { did: account.did, pds: account.pds, handle: account.handle || null };
  const photos = (await listAll(account, source.collection, fetchImpl)).map((r) => pictureFromRecord(app, r, owner)).filter(Boolean);
  if (!photos.length) return [];
  if (app === "grain") {
    const [galleries, items] = await Promise.all([
      listAll(account, GRAIN_GALLERY, fetchImpl).catch(() => []),
      listAll(account, GRAIN_ITEM, fetchImpl).catch(() => []),
    ]);
    return groupGrain(photos, galleries, items);
  }
  photos.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return [{ key: "all", title: "Your drawings", sensitive: false, items: photos }];
}

/** Where a picture's file is (public getBlob on its own account's server). */
export function pictureBlobUrl(item) {
  const u = new URL(`${item.owner.pds}/xrpc/com.atproto.sync.getBlob`);
  u.searchParams.set("did", item.owner.did);
  u.searchParams.set("cid", item.blobCid);
  return u.toString();
}

/**
 * Downloads a picture's file from its own account and checks it is the file
 * the record points to. Returns a Blob (with the record's picture type), ready
 * for shrinkPicture().
 */
export async function fetchAppPicture(item, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let bytes;
  try {
    const res = await fetchImpl(pictureBlobUrl(item), { signal: controller.signal });
    if (!res.ok) throw new Error(`Couldn't download this ${nounOf(item)} (the server answered ${res.status}).`);
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    if (err && err.name === "AbortError") throw new Error(`Downloading this ${nounOf(item)} took too long. Try again.`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if ((await rawCid(bytes)) !== item.blobCid) throw new Error(`The downloaded ${nounOf(item)} doesn't match its record. Try again.`);
  return new Blob([bytes], { type: item.mimeType });
}

function nounOf(item) {
  return (APP_PICTURE_SOURCES[item && item.app] || {}).noun || "picture";
}

/** What a page's picture keeps about where it came from (in the editor and the recipe). */
export function pictureSource(item) {
  return { app: item.app, uri: item.uri, cid: item.cid };
}

/** A picture's source, cleaned for the recipe (null when it isn't from an app). */
export function cleanPictureSource(source) {
  if (!source || !APP_PICTURE_SOURCES[source.app] || !/^at:\/\//.test(String(source.uri || ""))) return null;
  return { app: source.app, record: { uri: String(source.uri), cid: String(source.cid || "") } };
}

/** The apps a set of page pictures came from, in a fixed order (for credits). */
export function appsUsed(pictures) {
  const used = new Set((pictures || []).map((p) => p && p.source && p.source.app).filter((a) => APP_PICTURE_SOURCES[a]));
  return Object.keys(APP_PICTURE_SOURCES).filter((a) => used.has(a));
}
