import { makeFile } from "../../core/fileset.js";
import { rawCid } from "../../core/cid.js";
import { TAPE_PATH, tapeJson, cleanText, cleanLabel, LIMITS } from "./tape.js";
import { renderMixtapeHtml, mixtapeConfig } from "./runtime/template.js";
import { RUNTIME_PATH } from "./runtime/paths.js";

// Revising a published tape's words in place: its description, liner notes,
// dedication and label text. The songs, their order and the player program are
// left exactly as they are. The page is made again with the Foundry's current
// page template (so it also gets fixes to the page's look), carrying the same
// settings as before and the revised tape.
//
// Used by scripts/revise-tape.mjs. Pure: no network, so the tests can run it.

const DESCRIPTION_MAX = 200;

/** The tape config inside a tape page (its <script id="mixtape-config">), or null. */
export function configFromPage(html) {
  const m = /<script type="application\/json" id="mixtape-config">([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/**
 * manifest: the record's current `tile` object.
 * page, tapeFile: the current "/" and "/tape.json" bytes.
 * edits: { description?, notes?, dedication?, label? }; a value of undefined
 *   leaves that part as it is, "" removes it.
 * player, runtime (optional): the tape's current /mixtape.js bytes, and the
 *   Foundry's current player text; given both and they differ, the player is
 *   replaced too.
 * Returns { manifest (without the new files' blob refs yet), files: [changed
 * files, each { path, bytes, contentType, cid }], changes: [readable lines] }.
 */
export async function reviseTape({ manifest, page, tapeFile, edits = {}, player = null, runtime = null }) {
  if (!manifest || !manifest.resources || !manifest.resources["/"] || !manifest.resources[TAPE_PATH]) {
    throw new Error("This tile isn't a Mixtape tape (it has no /tape.json).");
  }
  const html = new TextDecoder().decode(page);
  const config = configFromPage(html);
  if (!config || !config.tape) throw new Error("The tape's page doesn't carry its track list; it wasn't made by the Foundry.");
  const tape = JSON.parse(new TextDecoder().decode(tapeFile));
  const changes = [];

  const next = structuredClone(tape);
  const setText = (key, value, max, opts, label) => {
    if (value === undefined) return;
    const clean = cleanText(value, max, opts);
    const before = tape[key] || "";
    if (clean === before) return;
    if (clean) next[key] = clean;
    else delete next[key];
    changes.push(`${label}: ${JSON.stringify(before)} -> ${JSON.stringify(clean)}`);
  };
  setText("notes", edits.notes, LIMITS.notes, { lines: true }, "Liner notes");
  setText("dedication", edits.dedication, LIMITS.dedication, undefined, "Dedication");
  if (edits.label !== undefined) {
    const before = (tape.label && tape.label.text) || "";
    const lab = cleanLabel({ ...(tape.label || {}), text: edits.label });
    const after = (lab && lab.text) || "";
    if (after !== before) {
      if (lab) next.label = lab;
      else delete next.label;
      changes.push(`Label: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    }
  }

  const nextManifest = structuredClone(manifest);
  if (edits.description !== undefined) {
    const clean = cleanText(edits.description, DESCRIPTION_MAX);
    const before = manifest.description || "";
    if (clean !== before) {
      if (clean) nextManifest.description = clean;
      else delete nextManifest.description;
      changes.push(`Description: ${JSON.stringify(before)} -> ${JSON.stringify(clean)}`);
    }
  }

  // The page, made again with the current template: the same settings, the revised tape.
  const newConfig = mixtapeConfig({ tape: next, artwork: config.artwork || null });
  const newPage = renderMixtapeHtml({ title: manifest.name, config: newConfig });
  const made = [];
  if (newPage !== html) {
    made.push(makeFile("/", newPage));
    changes.push("Page (/): made again with the Foundry's current page template" + (changes.some((c) => !c.startsWith("Description")) ? ", with the changes above" : ""));
  }
  const newTapeJson = tapeJson(next);
  if (newTapeJson !== new TextDecoder().decode(tapeFile)) made.push(makeFile(TAPE_PATH, newTapeJson));
  if (typeof runtime === "string" && runtime && player && new TextDecoder().decode(player) !== runtime) {
    if (!manifest.resources[RUNTIME_PATH]) throw new Error("This tape has no player file to update.");
    made.push(makeFile(RUNTIME_PATH, runtime));
    changes.push("Player (/mixtape.js): updated to the Foundry's current version");
  }
  const files = [];
  for (const f of made) files.push({ ...f, cid: await rawCid(f.bytes) });
  return { manifest: nextManifest, files, changes, tape: next };
}
