// Give one of your published Web Tiles a PNG screenshot, in place.
//
// Link previews (Bluesky and most others) can't show SVG pictures, so a tile
// whose screenshot is an SVG (ATMOSYNTH exports, for example) gets a card with
// no picture. This adds a PNG to the tile as /screenshot.png and makes it the
// tile's screenshot. Nothing else about the tile changes, and it keeps its
// address (at://…), so links and embeds keep working. Any other tile (made with
// the Foundry or not) works the same way.
//
// Run from the web-tile-foundry folder:
//   node scripts/set-tile-screenshot.mjs at://did:plc:…/ing.dasl.masl/<record key> path\to\picture.png
//
// It reads the tile, checks it understands the record (its manifest address
// must recompute exactly), shows what will change, asks for the account's app
// password (hidden as you type), saves a backup of the current record in
// scripts/backups/, and asks once more before replacing anything. The record is
// replaced only if it hasn't changed since it was read.

import readline from "node:readline";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { resolveDidDocument, pdsFromDidDocument, handleFromDidDocument } from "../src/core/atproto.js";
import { rawCid } from "../src/core/cid.js";
import { dagCborCid } from "../src/core/dagcbor.js";
import { buildRecord, parseMimeMismatch, TILE_COLLECTION } from "../src/core/publish.js";

const BACKUP_DIR = fileURLToPath(new URL("./backups/", import.meta.url));
export const SCREENSHOT_PATH = "/screenshot.png";

function parseUri(uri) {
  const m = /^at:\/\/(did:[a-z]+:[A-Za-z0-9._:%-]+)\/([A-Za-z0-9.-]+)\/([A-Za-z0-9._~:-]+)$/.exec(String(uri || "").trim());
  if (!m || m[2] !== TILE_COLLECTION) throw new Error("Give the tile's address, like at://did:plc:…/ing.dasl.masl/<record key>.");
  return { did: m[1], rkey: m[3] };
}

/** Width and height of a PNG, or an error if the bytes aren't a PNG. */
export function pngSize(bytes) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || !sig.every((b, i) => bytes[i] === b)) throw new Error("That file isn't a PNG picture.");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

async function getJson(fetchImpl, url, init) {
  const res = await fetchImpl(url, init);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = new Error((body && (body.message || body.error)) || `Request failed (${res.status})`);
    err.status = res.status;
    err.error = body && body.error;
    throw err;
  }
  return body;
}

/** The tile's manifest with the PNG as its screenshot (the PNG's src still to be filled in). */
export function withScreenshot(manifest, { width, height }) {
  const m = structuredClone(manifest);
  m.resources = { ...m.resources, [SCREENSHOT_PATH]: { "content-type": "image/png" } };
  m.screenshots = [{ src: SCREENSHOT_PATH, type: "image/png", sizes: `${width}x${height}` }];
  return m;
}

/**
 * The whole change. Everything outside (network, questions, files) is passed
 * in, so the tests can run it against a stand-in server.
 */
export async function runSetScreenshot({ uri, png, fetchImpl = fetch, ask, askHidden, log = console.log, saveBackup, now = () => new Date() }) {
  const { did, rkey } = parseUri(uri);
  const { width, height } = pngSize(png);
  const pngCid = await rawCid(png);

  const doc = await resolveDidDocument(did, fetchImpl);
  const pds = pdsFromDidDocument(doc);
  const handle = handleFromDidDocument(doc);
  const recordUrl = `${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${TILE_COLLECTION}&rkey=${encodeURIComponent(rkey)}`;
  const current = await getJson(fetchImpl, recordUrl);
  const manifest = current.value && current.value.tile;
  if (!manifest || !manifest.resources) throw new Error("That record isn't a Web Tile.");

  // Only touch a record whose manifest address we can reproduce exactly.
  if (current.value.cid !== (await dagCborCid(manifest))) {
    throw new Error("This tile's manifest address doesn't recompute the way this script expects, so it stopped without changing anything.");
  }
  const existing = manifest.resources[SCREENSHOT_PATH];
  if (existing && existing.src && existing.src.ref && existing.src.ref.$link === pngCid && (manifest.screenshots || [])[0]?.src === SCREENSHOT_PATH) {
    log("\nThis tile already has that PNG as its screenshot. Nothing to change.");
    return { changed: false };
  }

  log(`\nTile: ${manifest.name}  (@${handle || did})`);
  log(`Address: ${uri}`);
  log(`Current screenshot: ${JSON.stringify((manifest.screenshots || []).map((s) => s.src))}`);
  log("\nThis will:");
  log(`  - add the picture as ${SCREENSHOT_PATH} (${width} × ${height}, ${(png.length / 1024).toFixed(1)} KB, ${pngCid})${existing ? ", replacing the one there" : ""}`);
  log(`  - make ${SCREENSHOT_PATH} the tile's screenshot`);
  log("  - leave every other file and setting as it is (the old screenshot file stays in the tile)\n");

  const password = await askHidden(`App password for @${handle || did} (hidden): `);
  if (!password) throw new Error("No app password given; nothing was changed.");
  const session = await getJson(fetchImpl, `${pds}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: did, password }),
  });
  if (session.did !== did) throw new Error("That app password belongs to a different account; nothing was changed.");
  const auth = { Authorization: `Bearer ${session.accessJwt}` };

  const ok = (await ask(`Update the tile at ${uri}? [y/N] `)).trim().toLowerCase();
  if (ok !== "y" && ok !== "yes") {
    log("Stopped; nothing was changed.");
    return { changed: false };
  }

  const backupName = `backup-${rkey}-${now().toISOString().replace(/[:.]/g, "-")}.json`;
  saveBackup(backupName, JSON.stringify(current, null, 2) + "\n");
  log(`Saved a backup of the current record: scripts/backups/${backupName}`);

  // Upload the PNG as a PNG, and use the server's own answer in the record.
  const res = await getJson(fetchImpl, `${pds}/xrpc/com.atproto.repo.uploadBlob`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "image/png" },
    body: png,
  });
  const link = res && res.blob && res.blob.ref && res.blob.ref.$link;
  if (link !== pngCid) throw new Error("The server stored the picture under a different address than expected; nothing was replaced.");
  const ref = { $type: "blob", ref: { $link: link }, mimeType: res.blob.mimeType || "image/png", size: res.blob.size ?? png.length };
  log(`Uploaded ${SCREENSHOT_PATH}`);

  const next = withScreenshot(manifest, { width, height });
  const apply = () => {
    const m = structuredClone(next);
    m.resources[SCREENSHOT_PATH] = { ...m.resources[SCREENSHOT_PATH], src: ref };
    return m;
  };
  let record = await buildRecord(apply(), current.value.createdAt || now().toISOString());
  let put;
  for (let attempt = 1; ; attempt++) {
    try {
      put = await getJson(fetchImpl, `${pds}/xrpc/com.atproto.repo.putRecord`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ repo: did, collection: TILE_COLLECTION, rkey, record, validate: false, swapRecord: current.cid }),
      });
      break;
    } catch (err) {
      // A server that already held these bytes under another type says so; use its type once.
      const mismatch = err.error === "InvalidMimeType" ? parseMimeMismatch(err.message) : null;
      if (attempt === 1 && mismatch && ref.mimeType === mismatch.got) {
        ref.mimeType = mismatch.expected;
        record = await buildRecord(apply(), current.value.createdAt || now().toISOString());
        continue;
      }
      throw new Error(`Replacing the record failed: ${err.message}. The old record is unchanged.`);
    }
  }

  const after = await getJson(fetchImpl, recordUrl);
  if (!after.value || after.value.cid !== record.cid) {
    throw new Error("The record was replaced, but reading it back didn't match. Check it, and restore the backup if needed.");
  }
  log(`\nDone. The tile at ${uri} now has ${SCREENSHOT_PATH} as its screenshot (record ${put.cid}).`);
  log("Link previews may keep showing the old card for a while where they cached it.");
  return { changed: true, record };
}

// ---- running from the command line ------------------------------------------------

function makeAsk() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let muted = false;
  const write = rl._writeToOutput.bind(rl);
  rl._writeToOutput = (s) => {
    if (!muted || s.includes("\n")) write(muted ? "\n" : s);
  };
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
  const askHidden = (q) =>
    new Promise((resolve) => {
      process.stdout.write(q);
      muted = true;
      rl.question("", (a) => {
        muted = false;
        resolve(a.trim());
      });
    });
  return { ask, askHidden, close: () => rl.close() };
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const [uri, file] = process.argv.slice(2);
  if (!uri || !file) {
    console.error("Usage: node scripts/set-tile-screenshot.mjs at://did:…/ing.dasl.masl/<record key> picture.png");
    process.exitCode = 1;
  } else {
    const io = makeAsk();
    runSetScreenshot({
      uri,
      png: new Uint8Array(readFileSync(file)),
      ask: io.ask,
      askHidden: io.askHidden,
      saveBackup: (name, text) => {
        mkdirSync(BACKUP_DIR, { recursive: true });
        writeFileSync(BACKUP_DIR + name, text);
      },
    })
      .catch((err) => {
        console.error(`\n${err.message}`);
        process.exitCode = 1;
      })
      .finally(() => io.close());
  }
}
