import { test } from "node:test";
import assert from "node:assert/strict";
import {
  APP_PICTURE_SOURCES, pictureFromRecord, groupGrain, accountPictures, fetchAppPicture, pictureBlobUrl,
  cleanPictureSource, appsUsed, pictureSource,
} from "../src/core/app-pictures.js";
import { rawCid } from "../src/core/cid.js";
import { checkTileType } from "../src/core/contract.js";
import { zine } from "../src/tile-types/zine/index.js";
import { emptyPages, zineConfig } from "../src/tile-types/zine/pages.js";
import { zineRecipe } from "../src/tile-types/zine/tile.js";
import { READER_JS } from "../src/tile-types/zine/runtime/reader.js";

// Zine Scene stage 5, part 1: pictures from Grain and PinkSea.
// Record shapes copied from the owner's live records (pyxorium.com, Oct 9 2026).

const DID = "did:plc:rqbqpaaluty5v47jwciowpik";
const PDS = "https://meadow.us-east.host.bsky.network";
const OWNER = { did: DID, pds: PDS, handle: "pyxorium.com" };

const grainPhoto = (rkey, alt, link, w, h, extra = {}) => ({
  uri: `at://${DID}/social.grain.photo/${rkey}`,
  cid: `bafyrei${rkey}`,
  value: { alt, $type: "social.grain.photo", photo: { ref: { $link: link }, size: 876727, $type: "blob", mimeType: "image/jpeg" }, createdAt: "2026-10-09T11:45:06.488Z", aspectRatio: { width: w, height: h }, ...extra },
});
const GOLDEN = grainPhoto("3mxgvkq7iitqg", "Wall mural \"Golden\"", "bafkreicfcnqsho5k7xjasxofnyk3r6mjstcm2gco6wrjpfvfq3wr2c3ycm", 2000, 1500);
const CINEMA = grainPhoto("3mxgvkq7iisqg", "Neon sign \"Cinema\"", "bafkreic62yg6nwrnrnbhiq6vlasjumriaf253hfpkavfigqn7tjqxplgpu", 1500, 2000);
const GALLERY = { uri: `at://${DID}/social.grain.gallery/3mxgvkq7iiuqg`, cid: "bafyreig", value: { $type: "social.grain.gallery", title: "West Metro", createdAt: "2026-10-09T11:45:06.488Z" } };
const item = (rkey, photo, position) => ({ uri: `at://${DID}/social.grain.gallery.item/${rkey}`, value: { item: photo.uri, $type: "social.grain.gallery.item", gallery: GALLERY.uri, position, createdAt: "2026-10-09T11:45:06.488Z" } });
const ITEMS = [item("3mxgvkq7khcqg", GOLDEN, 1), item("3mxgvkq7ji4qg", CINEMA, 0)];
const GHOST_RANCH = {
  uri: `at://${DID}/com.shinolabs.pinksea.oekaki/3mxgv54uw6kcs`,
  cid: "bafyreipink",
  value: { nsfw: false, tags: [], $type: "com.shinolabs.pinksea.oekaki", image: { blob: { ref: { $link: "bafkreicq2uhfvqdfx4quhrozlk54gjjcnk4jfejjm4sa7awywoit4gap3a" }, size: 196546, $type: "blob", mimeType: "image/png" }, imageLink: { alt: "Ode to Ghost Ranch" } }, createdAt: "2026-10-09T11:37:33.1788723+00:00" },
};

test("app pictures: Grain photos and PinkSea drawings read as picture items", () => {
  const g = pictureFromRecord("grain", GOLDEN, OWNER);
  assert.equal(g.blobCid, "bafkreicfcnqsho5k7xjasxofnyk3r6mjstcm2gco6wrjpfvfq3wr2c3ycm");
  assert.equal(g.alt, "Wall mural \"Golden\"");
  assert.deepEqual([g.width, g.height, g.mimeType, g.sensitive], [2000, 1500, "image/jpeg", false]);
  const p = pictureFromRecord("pinksea", GHOST_RANCH, OWNER);
  assert.equal(p.blobCid, "bafkreicq2uhfvqdfx4quhrozlk54gjjcnk4jfejjm4sa7awywoit4gap3a");
  assert.equal(p.alt, "Ode to Ghost Ranch");
  assert.equal(p.mimeType, "image/png");
  assert.equal(p.sensitive, false);
  // PinkSea's nsfw flag, the older shape (blob straight in image), an empty alt, a reply drawing.
  const older = { ...GHOST_RANCH, value: { ...GHOST_RANCH.value, nsfw: true, inResponseTo: { uri: "at://did:plc:x/com.shinolabs.pinksea.oekaki/1", cid: "c" }, image: { ref: { $link: "bafkreiold" }, mimeType: "image/png", size: 5 } } };
  const o = pictureFromRecord("pinksea", older, OWNER);
  assert.deepEqual([o.blobCid, o.alt, o.sensitive, o.reply], ["bafkreiold", "", true, true]);
  // Self-labels mark a Grain photo sensitive.
  const labelled = grainPhoto("x1", "", "bafkreilab", 10, 10, { labels: { $type: "com.atproto.label.defs#selfLabels", values: [{ val: "nudity" }] } });
  assert.equal(pictureFromRecord("grain", labelled, OWNER).sensitive, true);
  // Not pictures: no blob, a video, an unknown app.
  assert.equal(pictureFromRecord("grain", { uri: "at://x", value: { alt: "x" } }), null);
  assert.equal(pictureFromRecord("grain", grainPhoto("v", "", "bafkreiv", 1, 1, { photo: { ref: { $link: "bafkreiv" }, mimeType: "video/mp4", size: 1 } })), null);
  assert.equal(pictureFromRecord("flickr", GOLDEN), null);
});

test("app pictures: Grain photos come grouped by gallery, in gallery order, loose photos last", () => {
  const photos = [GOLDEN, CINEMA].map((r) => pictureFromRecord("grain", r, OWNER));
  const groups = groupGrain(photos, [GALLERY], ITEMS);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].title, "West Metro");
  assert.deepEqual(groups[0].items.map((i) => i.alt), ["Neon sign \"Cinema\"", "Wall mural \"Golden\""]); // position 0, then 1
  const extra = pictureFromRecord("grain", grainPhoto("3zz", "Loose one", "bafkreiloose", 1, 1), OWNER);
  const two = groupGrain([...photos, extra], [GALLERY], ITEMS);
  assert.deepEqual(two.map((g) => g.title), ["West Metro", "Other photos"]);
  assert.equal(two[1].items[0].alt, "Loose one");
  assert.deepEqual(groupGrain(photos, [], []).map((g) => g.title), ["Your photos"]);
  // A gallery labelled sensitive makes its photos sensitive.
  const nsfwGallery = { ...GALLERY, value: { ...GALLERY.value, labels: { values: [{ val: "porn" }] } } };
  assert.ok(groupGrain(photos, [nsfwGallery], ITEMS)[0].items.every((i) => i.sensitive));
});

function fakeServer(collections, blobs = new Map()) {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    calls.push(u.pathname + "?" + u.searchParams.get("collection"));
    if (u.pathname.endsWith("/com.atproto.repo.listRecords")) {
      const all = collections[u.searchParams.get("collection")] || [];
      const start = Number(u.searchParams.get("cursor") || 0);
      const limit = Number(u.searchParams.get("limit"));
      const records = all.slice(start, start + limit);
      return { ok: true, status: 200, json: async () => ({ records, ...(start + limit < all.length ? { cursor: String(start + limit) } : {}) }) };
    }
    if (u.pathname.endsWith("/com.atproto.sync.getBlob")) {
      const b = blobs.get(u.searchParams.get("cid"));
      if (!b) return { ok: false, status: 404 };
      return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
    }
    return { ok: false, status: 400 };
  };
  return { fetchImpl, calls };
}

test("app pictures: an account's pictures are listed with public reads (paged)", async () => {
  const many = Array.from({ length: 130 }, (_, i) => ({ ...GHOST_RANCH, uri: `${GHOST_RANCH.uri}${i}`, value: { ...GHOST_RANCH.value, createdAt: `2026-10-${String(1 + (i % 9)).padStart(2, "0")}T00:00:00Z` } }));
  const { fetchImpl } = fakeServer({ "social.grain.photo": [GOLDEN, CINEMA], "social.grain.gallery": [GALLERY], "social.grain.gallery.item": ITEMS, "com.shinolabs.pinksea.oekaki": many });
  const grain = await accountPictures("grain", OWNER, fetchImpl);
  assert.deepEqual(grain.map((g) => [g.title, g.items.length]), [["West Metro", 2]]);
  assert.equal(grain[0].items[0].owner.did, DID);
  const pink = await accountPictures("pinksea", OWNER, fetchImpl);
  assert.equal(pink[0].items.length, 130); // two pages of 100
  assert.ok(pink[0].items[0].createdAt >= pink[0].items[129].createdAt); // newest first
  const none = await accountPictures("grain", OWNER, fakeServer({}).fetchImpl);
  assert.deepEqual(none, []);
});

test("app pictures: the file is downloaded from its own account and checked against its record", async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4, 5]);
  const cid = await rawCid(bytes);
  const it = { ...pictureFromRecord("pinksea", GHOST_RANCH, OWNER), blobCid: cid };
  assert.match(pictureBlobUrl(it), /^https:\/\/meadow\.us-east\.host\.bsky\.network\/xrpc\/com\.atproto\.sync\.getBlob\?did=did%3Aplc%3A.*&cid=/);
  const good = fakeServer({}, new Map([[cid, bytes]]));
  const blob = await fetchAppPicture(it, good.fetchImpl);
  assert.equal(blob.type, "image/png");
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
  const tampered = fakeServer({}, new Map([[cid, new Uint8Array([9, 9, 9])]]));
  await assert.rejects(fetchAppPicture(it, tampered.fetchImpl), /doesn't match its record/);
  await assert.rejects(fetchAppPicture(it, fakeServer({}).fetchImpl), /Couldn't download this drawing \(the server answered 404\)/);
});

test("app pictures: the zine's credits name each app and its pages, and the recipe records each picture's source", () => {
  const pages = emptyPages();
  const pic = (source) => ({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/webp", width: 1200, height: 900, alt: "x", ...(source ? { source } : {}) });
  const grainItem = pictureFromRecord("grain", GOLDEN, OWNER);
  pages[0].picture = pic(pictureSource(grainItem));
  pages[1].picture = pic(null);
  let c = zineConfig({ title: "T", handle: "pyxorium.com", paper: "letter", pages, src: () => "data:," });
  assert.deepEqual(c.credits, [{ what: "Photos", app: "Grain", href: "https://grain.social/", pages: "the cover" }]);
  pages[2].layout = "picture";
  pages[2].picture = pic(pictureSource(pictureFromRecord("pinksea", GHOST_RANCH, OWNER)));
  pages[3].picture = pic(pictureSource(grainItem));
  c = zineConfig({ title: "T", handle: "h", paper: "letter", pages, src: () => "data:," });
  assert.deepEqual(c.credits.map((x) => [x.what, x.app, x.pages]), [["Photos", "Grain", "the cover and page 3"], ["Drawings", "PinkSea", "page 2"]]);
  // A picture its layout hides isn't credited.
  pages[2].layout = "words";
  c = zineConfig({ title: "T", handle: "h", paper: "letter", pages, src: () => "data:," });
  assert.deepEqual(c.credits.map((x) => x.app), ["Grain"]);
  // Recipe: the record it came from, nothing else of it.
  const r = zineRecipe({ paper: "letter", look: "clean", pages });
  assert.deepEqual(r.pages[0].picture.source, { app: "grain", record: { uri: GOLDEN.uri, cid: GOLDEN.cid } });
  assert.equal(r.pages[1].picture.source, undefined);
  assert.equal(JSON.stringify(r).includes("autoAlt"), false);
  // No apps, no credits.
  assert.equal(zineConfig({ title: "T", handle: "h", paper: "letter", pages: emptyPages(), src: () => "" }).credits, undefined);
  // The reader opens them from a Credits button in the footer.
  assert.match(READER_JS, /config\.credits/);
  assert.match(READER_JS, /credits-open/);
});

test("app pictures: sources and the pages input option are checked", () => {
  assert.deepEqual(Object.keys(APP_PICTURE_SOURCES), ["grain", "pinksea"]);
  assert.equal(cleanPictureSource({ app: "flickr", uri: "at://x" }), null);
  assert.equal(cleanPictureSource({ app: "grain", uri: "https://grain.social/x" }), null);
  assert.deepEqual(appsUsed([{ source: { app: "pinksea" } }, null, { source: { app: "grain" } }, {}]), ["grain", "pinksea"]);
  const pagesInput = zine.inputs.find((i) => i.kind === "pages");
  assert.deepEqual(pagesInput.pictureSources, ["grain", "pinksea"]);
  assert.doesNotThrow(() => checkTileType(zine));
  const bad = { ...zine, inputs: zine.inputs.map((i) => (i.kind === "pages" ? { ...i, pictureSources: ["flickr"] } : i)) };
  assert.throws(() => checkTileType(bad), /pictureSources/);
});
