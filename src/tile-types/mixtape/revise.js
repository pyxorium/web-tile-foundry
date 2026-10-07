import { makeFile } from "../../core/fileset.js";
import { rawCid } from "../../core/cid.js";
import { TAPE_PATH, tapeJson, cleanText, cleanLabel, LIMITS } from "./tape.js";
import { renderMixtapeHtml, mixtapeConfig } from "./runtime/template.js";
import { RUNTIME_PATH } from "./runtime/paths.js";

// Revising a published tape in place: its description, liner notes,
// dedication and label text. The songs and their order are left exactly as
// they are. The page is made again with the Foundry's current page template
// and player (so it also gets fixes to the page's look and the player),
// carrying the same settings as before and the revised tape. Tapes made before
// Oct 7 2026 loaded the player as a separate /mixtape.js; the new page has the
// player built in, so that file is taken out of the tile.
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
 * runtime: the Foundry's current player program (runtime/bundle.js).
 * Returns { manifest (without the new files' blob refs yet), files: [changed
 * files, each { path, bytes, contentType, cid }], changes: [readable lines] }.
 */
/** The player built into a tape page (its last plain <script>), or null for an older page. */
export function playerInPage(html) {
  const m = /<script>([\s\S]*?)<\/script>\s*<\/body>/.exec(html);
  return m ? m[1] : null;
}

export async function reviseTape({ manifest, page, tapeFile, edits = {}, runtime }) {
  if (typeof runtime !== "string" || !runtime) throw new Error("The Foundry's current player is needed to remake the page.");
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

  // The page, made again with the current template and player: the same settings, the revised tape.
  const newConfig = mixtapeConfig({ tape: next, artwork: config.artwork || null });
  const newPage = renderMixtapeHtml({ title: manifest.name, config: newConfig, runtime });
  const made = [];
  const oldPlayer = playerInPage(html);
  if (newPage !== html) {
    made.push(makeFile("/", newPage));
    changes.push("Page (/): made again with the Foundry's current page template" + (changes.some((c) => !c.startsWith("Description")) ? ", with the changes above" : ""));
    if (oldPlayer === null) changes.push("Player: now built into the page, so the tape draws sooner (the separate /mixtape.js is taken out)");
    else if (oldPlayer !== runtime) changes.push("Player: updated to the Foundry's current version");
  }
  if (nextManifest.resources[RUNTIME_PATH] && !newPage.includes(`src="${RUNTIME_PATH}"`)) delete nextManifest.resources[RUNTIME_PATH];
  const newTapeJson = tapeJson(next);
  if (newTapeJson !== new TextDecoder().decode(tapeFile)) made.push(makeFile(TAPE_PATH, newTapeJson));
  const files = [];
  for (const f of made) files.push({ ...f, cid: await rawCid(f.bytes) });
  return { manifest: nextManifest, files, changes, tape: next };
}
