// Revise a published Mixtape tape in place: its description, liner notes,
// dedication or label text. The page is also made again with the Foundry's
// current page template and player, so the tape gets the latest fixes (a tape
// made before Oct 7 2026 gets its player built into the page, and its separate
// /mixtape.js is taken out). The tape keeps its address (at://…), so links,
// embeds and posts keep working; the songs are not touched.
//
// Run from the web-tile-foundry folder:
//   node scripts/revise-tape.mjs at://did:plc:…/ing.dasl.masl/<record key>
//
// It shows the tape's current words, asks for new ones (Enter keeps each as
// it is), shows exactly what will change, asks for the account's app password
// (hidden as you type), saves a backup of the current record in
// scripts/backups/, and asks once more before replacing anything.

import readline from "node:readline";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { resolveDidDocument, pdsFromDidDocument, handleFromDidDocument, fetchPublicBlob } from "../src/core/atproto.js";
import { rawCid } from "../src/core/cid.js";
import { buildRecord, parseMimeMismatch, TILE_COLLECTION } from "../src/core/publish.js";
import { reviseTape } from "../src/tile-types/mixtape/revise.js";
import { TAPE_PATH } from "../src/tile-types/mixtape/tape.js";

/** The Foundry's current tape player, bundled the same way the Foundry does. */
async function bundleCurrentPlayer() {
  const esbuild = await import("esbuild");
  const { bundleRuntime } = await import("../src/tile-types/mixtape/runtime/bundle.js");
  return (await bundleRuntime(esbuild)).code;
}

const BACKUP_DIR = fileURLToPath(new URL("./backups/", import.meta.url));

function parseUri(uri) {
  const m = /^at:\/\/(did:[a-z]+:[A-Za-z0-9._:%-]+)\/([A-Za-z0-9.-]+)\/([A-Za-z0-9._~:-]+)$/.exec(String(uri || "").trim());
  if (!m || m[2] !== TILE_COLLECTION) throw new Error("Give the tape's address, like at://did:plc:…/ing.dasl.masl/<record key>.");
  return { did: m[1], rkey: m[3] };
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

/** "line one\nline two" typed at the prompt becomes two lines. */
function unescapeLines(s) {
  return s.replace(/\\n/g, "\n");
}

/**
 * The whole revision. Everything outside (network, questions, files) is passed
 * in, so the tests can run it against a stand-in server.
 */
export async function runRevision({ uri, fetchImpl = fetch, ask, askHidden, log = console.log, saveBackup, now = () => new Date(), bundlePlayer = bundleCurrentPlayer }) {
  const { did, rkey } = parseUri(uri);
  const doc = await resolveDidDocument(did, fetchImpl);
  const pds = pdsFromDidDocument(doc);
  const handle = handleFromDidDocument(doc);

  const current = await getJson(fetchImpl, `${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${TILE_COLLECTION}&rkey=${encodeURIComponent(rkey)}`);
  const manifest = current.value && current.value.tile;
  if (!manifest || !manifest.resources || !manifest.resources[TAPE_PATH]) throw new Error("That record isn't a Mixtape tape.");

  const download = async (path) => {
    const cid = manifest.resources[path].src.ref.$link;
    const bytes = await fetchPublicBlob(did, pds, cid, fetchImpl);
    if ((await rawCid(bytes)) !== cid) throw new Error(`${path} didn't download intact.`);
    return bytes;
  };
  const page = await download("/");
  const tapeFile = await download(TAPE_PATH);
  const tape = JSON.parse(new TextDecoder().decode(tapeFile));

  log(`\nTape: ${manifest.name}  (@${handle || did})`);
  log(`Address: ${uri}\n`);
  log(`  Description:  ${JSON.stringify(manifest.description || "")}`);
  log(`  Label:        ${JSON.stringify((tape.label && tape.label.text) || "")}`);
  log(`  Dedication:   ${JSON.stringify(tape.dedication || "")}`);
  log(`  Liner notes:  ${JSON.stringify(tape.notes || "")}\n`);
  log("Type new words for each, or press Enter to keep it as it is.");
  log("In the liner notes, type \\n where you want a new line. Type - on its own to remove something.\n");

  const edits = {};
  for (const [key, label] of [["description", "Description"], ["label", "Label"], ["dedication", "Dedication"], ["notes", "Liner notes"]]) {
    const answer = (await ask(`New ${label.toLowerCase()}: `)).trim();
    if (answer === "") continue;
    edits[key] = answer === "-" ? "" : key === "notes" ? unescapeLines(answer) : answer;
  }

  const runtime = await bundlePlayer();
  const revised = await reviseTape({ manifest, page, tapeFile, edits, runtime });
  if (!revised.changes.length) {
    log("\nNothing to change.");
    return { changed: false };
  }
  log("\nThese changes will be made:");
  for (const c of revised.changes) log(`  - ${c}`);
  log(`Files to upload: ${revised.files.map((f) => f.path).join(", ") || "none"}`);
  const dropped = Object.keys(manifest.resources).filter((p) => !revised.manifest.resources[p]);
  if (dropped.length) log(`Files taken out: ${dropped.join(", ")}`);
  log("The songs and the card pictures stay as they are.\n");

  const password = await askHidden(`App password for @${handle || did} (hidden): `);
  if (!password) throw new Error("No app password given; nothing was changed.");
  const session = await getJson(fetchImpl, `${pds}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: did, password }),
  });
  if (session.did !== did) throw new Error("That app password belongs to a different account; nothing was changed.");
  const auth = { Authorization: `Bearer ${session.accessJwt}` };

  const ok = (await ask(`Replace the tape at ${uri}? [y/N] `)).trim().toLowerCase();
  if (ok !== "y" && ok !== "yes") {
    log("Stopped; nothing was changed.");
    return { changed: false };
  }

  const backupName = `backup-${rkey}-${now().toISOString().replace(/[:.]/g, "-")}.json`;
  saveBackup(backupName, JSON.stringify(current, null, 2) + "\n");
  log(`Saved a backup of the current record: scripts/backups/${backupName}`);

  // Upload the changed files, checking each address.
  const refs = {};
  for (const f of revised.files) {
    const res = await getJson(fetchImpl, `${pds}/xrpc/com.atproto.repo.uploadBlob`, {
      method: "POST",
      headers: { ...auth, "Content-Type": f.contentType },
      body: f.bytes,
    });
    const link = res && res.blob && res.blob.ref && res.blob.ref.$link;
    if (link !== f.cid) throw new Error(`The server stored ${f.path} under a different address than expected; nothing was replaced.`);
    refs[f.path] = { $type: "blob", ref: { $link: link }, mimeType: res.blob.mimeType, size: res.blob.size ?? f.bytes.length };
    log(`Uploaded ${f.path}`);
  }

  // Replace the record, only if it hasn't changed since it was read.
  const apply = () => {
    const m = structuredClone(revised.manifest);
    for (const [path, ref] of Object.entries(refs)) m.resources[path] = { ...m.resources[path], src: ref };
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
      const mismatch = err.error === "InvalidMimeType" ? parseMimeMismatch(err.message) : null;
      if (attempt === 1 && mismatch && Object.values(refs).some((r) => r.mimeType === mismatch.got)) {
        for (const r of Object.values(refs)) if (r.mimeType === mismatch.got) r.mimeType = mismatch.expected;
        record = await buildRecord(apply(), current.value.createdAt || now().toISOString());
        continue;
      }
      throw new Error(`Replacing the record failed: ${err.message}. The old record is unchanged.`);
    }
  }

  // Read it back.
  const after = await getJson(fetchImpl, `${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${TILE_COLLECTION}&rkey=${encodeURIComponent(rkey)}`);
  if (!after.value || after.value.cid !== record.cid) {
    throw new Error("The record was replaced, but reading it back didn't match. Check it, and restore the backup if needed.");
  }
  log(`\nDone. The tape at ${uri} now has the changes (record ${put.cid}).`);
  log("Tileman shows Update on this tape; tap it to save the new version on your phone.");
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
  const uri = process.argv[2];
  const io = makeAsk();
  runRevision({
    uri,
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
