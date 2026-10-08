import { makeFile } from "../../core/fileset.js";
import { fetchPublishedTile, copyPaths, parseTileAddress, pageRefs, swapRefs } from "../../core/published-tile.js";
import { renderTileTestHtml } from "./template.js";

// Debug-only test type for Zine Scene stage 4, "tiles on a page"
// (claude/zine-maker-plan.md section 26). It copies one of the creator's
// published tiles, byte for byte, into this tile under /t1/, and its page tries
// four ways of running that tile inside this tile's own frame. Publish it, open
// it on appmosphe.re and in the thunderbird.cafe gallery, and copy the results.
// Remove it (folder, registration, test) when stage 4 is built.

const NAME_MAX = 64;
const FOLDER = "/t1";
const published = new Map(); // address -> Promise<published tile>, so rebuilds don't download again

function tileFor(address) {
  if (!published.has(address)) {
    const p = fetchPublishedTile(address);
    p.catch(() => published.delete(address));
    published.set(address, p);
  }
  return published.get(address);
}

export { pageRefs };

/** The page with those addresses moved into the folder (way B's copy). */
export function pageInFolder(html, refs, folder = FOLDER) {
  return swapRefs(html, Object.fromEntries(refs.map((r) => [r, `${folder}${r}`])));
}

export const zineTileTest = {
  id: "zine-tile-test",
  version: 1,
  title: "Zine Scene: tile test",
  summary: "Test only: one of your tiles running inside another tile.",
  maxBytes: 20 * 1024 * 1024,

  inputs: [
    { key: "name", kind: "text", label: "Title", required: true, maxLength: NAME_MAX },
    {
      key: "address",
      kind: "text",
      label: "One of your published tiles",
      help: "Paste its at:// address (from the Foundry's success screen) or its appmosphe.re link. A Glass Lantern is the best first test.",
      required: true,
      maxLength: 600,
    },
    { key: "description", kind: "text", label: "Description (optional)", maxLength: 200 },
  ],

  defaults() {
    return { name: "Zine Scene tile test", address: "", description: "" };
  },

  async build(inputs) {
    const address = String(inputs.address || "").trim();
    if (!address) throw new Error("Paste the address of one of your published tiles.");
    if (!parseTileAddress(address)) throw new Error("That doesn't look like a tile address. Paste its at:// address or its appmosphe.re link.");
    const pub = await tileFor(address);
    const copies = copyPaths(pub.files, FOLDER);
    const page = pub.files.find((f) => f.path === "/");
    const html = new TextDecoder().decode(page.bytes);
    const refs = pageRefs(html, pub.files.map((f) => f.path));
    const has = (p) => pub.files.some((f) => f.path === p);
    const tileName = String((pub.manifest && pub.manifest.name) || "Untitled tile").slice(0, 120);
    const title = String(inputs.name || "").trim().slice(0, NAME_MAX) || "Zine Scene tile test";
    const config = {
      title,
      tile: {
        name: tileName,
        by: pub.handle ? `@${pub.handle}` : pub.did,
        uri: pub.uri,
        page: `${FOLDER}/index.html`,
        pageB: `${FOLDER}/page-b.html`,
        refs,
        ...(has("/banner.png") ? { banner: `${FOLDER}/banner.png` } : {}),
      },
    };
    const files = [makeFile("/", renderTileTestHtml({ title, config }))];
    for (const c of copies) files.push(makeFile(c.path, c.bytes));
    files.push(makeFile(`${FOLDER}/page-b.html`, pageInFolder(html, refs)));
    // The copied tile's own card pictures serve as this test's (same bytes, so no extra room).
    const icon = pub.files.find((f) => f.path === "/icon.png");
    const banner = pub.files.find((f) => f.path === "/banner.png");
    if (icon) files.push(makeFile("/icon.png", icon.bytes));
    if (banner) files.push(makeFile("/banner.png", banner.bytes));
    const recipe = pub.recipe || {};
    return {
      name: title,
      description: String(inputs.description || "").trim().slice(0, 200) || `A test: ${tileName} running inside another tile.`,
      files,
      icons: icon ? [{ src: "/icon.png" }] : [],
      screenshots: banner ? [{ src: "/banner.png" }] : [],
      recipeInputs: {
        test: "zine-stage-4",
        tile: { uri: pub.uri, cid: pub.cid, type: recipe.type || null, typeVersion: recipe.typeVersion || null, foundryVersion: recipe.foundryVersion || null },
      },
    };
  },
};
