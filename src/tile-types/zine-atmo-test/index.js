import { makeFile } from "../../core/fileset.js";
import { fetchPublishedTile, copyPaths, parseTileAddress } from "../../core/published-tile.js";
import { renderAtmoTestHtml } from "./template.js";

// Debug-only host test: an ATMOSYNTH tile on a zine page
// (claude/atmosynth-collab.md). It copies one of the creator's published
// ATMOSYNTH tiles, byte for byte, into this tile under /t1/, and its page tries
// three ways of running it inside this tile's own frame. Publish it, open it on
// appmosphe.re and in the thunderbird.cafe gallery, play, turn the knobs, and
// copy the results. Remove it (folder, registration, test) once the real
// ATMOSYNTH zine page is built.
//
// ATMOSYNTH tiles differ from Foundry tiles: no /foundry.json (they're
// recognised by the manifest's generator), relative addresses ("./tile.js"),
// and the player fetches ./patch.json, ./tile.json and ./samples.json itself.

const NAME_MAX = 64;
export const FOLDER = "/t1";
export const GENERATOR = "ATMOSYNTH";
const published = new Map(); // address -> Promise<published tile>, so rebuilds don't download again

function tileFor(address) {
  if (!published.has(address)) {
    const p = fetchPublishedTile(address);
    p.catch(() => published.delete(address));
    published.set(address, p);
  }
  return published.get(address);
}

/** Whether a published tile was made by ATMOSYNTH's exporter. */
export function isAtmosynthTile(manifest) {
  return !!manifest && String(manifest.generator || "").trim().toUpperCase() === GENERATOR;
}

/**
 * The tile's own files its page loads by address, as written in the page:
 * [{ ref: "./tile.js", path: "/tile.js" }, …]. Relative ("./x", "x") and root ("/x") forms.
 */
export function atmoPageRefs(html, paths) {
  const out = [];
  for (const path of paths) {
    if (path === "/") continue;
    for (const ref of [`.${path}`, path, path.slice(1)]) {
      if (html.includes(`"${ref}"`) || html.includes(`'${ref}'`)) out.push({ ref, path });
    }
  }
  return out;
}

/** The JSON files the player fetches for itself (by "./name.json"). */
export const FETCHED = ["/patch.json", "/tile.json", "/samples.json"];

export const zineAtmoTest = {
  id: "zine-atmo-test",
  version: 1,
  title: "Zine Scene: ATMOSYNTH tile test",
  summary: "Test only: one of your ATMOSYNTH tiles running inside another tile.",
  maxBytes: 20 * 1024 * 1024,

  inputs: [
    { key: "name", kind: "text", label: "Title", required: true, maxLength: NAME_MAX },
    {
      key: "address",
      kind: "text",
      label: "One of your ATMOSYNTH tiles",
      help: "Paste its at:// address or its appmosphe.re link.",
      required: true,
      maxLength: 600,
    },
    { key: "description", kind: "text", label: "Description (optional)", maxLength: 200 },
  ],

  defaults() {
    return { name: "ATMOSYNTH zine test", address: "", description: "" };
  },

  async build(inputs) {
    const address = String(inputs.address || "").trim();
    if (!address) throw new Error("Paste the address of one of your ATMOSYNTH tiles.");
    if (!parseTileAddress(address)) throw new Error("That doesn't look like a tile address. Paste its at:// address or its appmosphe.re link.");
    const pub = await tileFor(address);
    if (!isAtmosynthTile(pub.manifest)) throw new Error("That tile wasn't made by ATMOSYNTH (its manifest has no ATMOSYNTH generator).");
    const copies = copyPaths(pub.files, FOLDER);
    const page = pub.files.find((f) => f.path === "/");
    const html = new TextDecoder().decode(page.bytes);
    const paths = pub.files.map((f) => f.path);
    const refs = atmoPageRefs(html, paths);
    const fetched = FETCHED.filter((p) => paths.includes(p));
    const types = Object.fromEntries(copies.map((c) => [c.from, c.contentType]));
    const tileName = String((pub.manifest && pub.manifest.name) || "Untitled tile").slice(0, 120);
    const title = String(inputs.name || "").trim().slice(0, NAME_MAX) || "ATMOSYNTH zine test";
    const shot = paths.includes("/screenshot.png") ? `${FOLDER}/screenshot.png` : null;
    const config = {
      title,
      folder: FOLDER,
      tile: {
        name: tileName,
        by: pub.handle ? `@${pub.handle}` : pub.did,
        uri: pub.uri,
        page: `${FOLDER}/index.html`,
        refs,
        fetched,
        types,
        ...(shot ? { poster: shot } : {}),
      },
    };
    const files = [makeFile("/", renderAtmoTestHtml({ title, config }))];
    // Each copy keeps the type the account's server already holds its bytes under.
    for (const c of copies) files.push(c.storedType ? { ...makeFile(c.path, c.bytes), storedType: c.storedType } : makeFile(c.path, c.bytes));
    return {
      name: title,
      description: String(inputs.description || "").trim().slice(0, 200) || `A test: ${tileName} (ATMOSYNTH) running inside another tile.`,
      files,
      icons: [],
      screenshots: shot ? [{ src: shot }] : [],
      recipeInputs: {
        test: "zine-atmosynth",
        tile: { uri: pub.uri, cid: pub.cid, generator: GENERATOR },
      },
    };
  },
};
