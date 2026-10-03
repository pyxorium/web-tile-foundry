# Glass Lantern: plan and handoff for the Web Tile Foundry's second tile type

Written Oct 2 2026, at the end of the chat that built and launched the Web Tile Foundry (v0.8.3) and its blog post. This is the handoff for the chat that builds Glass Lantern. Read `claude/web-tile-foundry-progress.md` alongside it for how the Foundry works, hosting, and the user's workflow.

**Nothing is built yet.** Everything below is agreed direction, with the open questions marked.

---

## 1. What Glass Lantern is

A 3D tile: a dice-like object made of stained-glass panes held in metal, lit from inside, set against a designed background. Think Tiffany lamp, Victorian parlour or steampunk workshop. Viewers can turn it, roll it, zoom in, and choose whether it slowly rotates.

- **Type name:** Glass Lantern. Tagline: on hold.
- **Type id (permanent once published):** `glass-lantern`. Version 1.
- **Category word:** the user decided to keep **"type"** (as in "tile type"). It's real foundry language: a coin's design is its "type" to numismatists, and type foundries cast type. Alternatives that were considered and set aside: mold, pattern, order, theme, mint.

## 2. Scope of version 1 (agreed)

**Shapes, three groups**
1. **Classic dice:** d4, d6, d8, d10, d12, d20.
2. **Special:** the **chestahedron** (named after the artist Frank Chester). Seven faces: 4 equilateral triangles and 3 kites, **all seven of equal area**. It is a special case of the diminished trigonal trapezohedron (7 faces, 12 edges, 7 vertices). Room for more special solids later.
3. **Gem:** irregular facets, generated from a seed. Controls: "new shape" button and a facet-count control kept moderate (so hands-on colouring stays practical).

**Styles: three kits, chosen in the Foundry**
- **Tiffany, Victorian, Steampunk.** Picking a kit sets glass palette, metal, background and lighting in one click; people can then adjust. Starting ideas, to be tuned in the look lab:
  - Tiffany: amber, leaf green, cobalt, ruby, opalescent milky glass; copper or bronze came with a patina; warm lamp; dark wood or parlour background.
  - Victorian: deep jewel tones (garnet, emerald, sapphire, amethyst); pewter or blackened silver; gaslight glow; velvet and damask background.
  - Steampunk: amber, smoked and teal glass; brass with rivets; workshop background (gears, pipes); warm light with a cooler rim.

**Colouring: the user chooses Easy or Hands-on**
- **Easy:** pick colours from the kit's glass palette, then a spread: alternate, random, or fade (gradient top to bottom).
- **Hands-on:** paintbrush model. Pick a colour, then tap or click faces in the preview to set them.
- Switching Easy → Hands-on keeps the current colours, so people can start easy and fine-tune. Internally both produce the same thing: one colour per face.

**Look (the heart of it)**
- **Light from inside** the object, so panes glow like backlit glass. This matters more than any material setting.
- **Came:** raised metal strips along every edge (silver, pewter, brass, copper; rivets for steampunk).
- **Bezels:** each pane set slightly in, with a bevelled rim that catches highlights.
- **Glass surfaces by shader:** rippled cathedral glass, opalescent swirl, faceted jewel, smoked; hammered metal and patina on the came.
- **Reflections without the network:** a generated studio-style environment (for example three.js RoomEnvironment through PMREM), so metal reflects with nothing downloaded.
- **Background:** a design element per kit, drawn procedurally (no image downloads needed), and also selectable on its own.

**Viewer controls (inside the tile)**
- **Drag** to turn (always available).
- **Click or tap** to roll: a tumble that lands on a random face. The code picks the result, so even the chestahedron and gems are fair.
- **Zoom:** pinch on phones, wheel or trackpad on computers. Limits on how far; **double-tap to reset**.
- **Gear menu:** auto-rotate (slow turn) or still; reset view.
- **Reduced motion:** viewers who ask for it start still; rolling becomes a quick fade to the new face.

**Deliberately later (not version 1)**
- **Cameo:** the user's avatar or rpg.actor sprite set into one face like a Victorian portrait brooch.
- More kits (Gothic cathedral, Art Nouveau were floated), more special solids.
- **Two-person version** (section 9).
- The **pixel painter** type idea (paint a grid, tile replays the strokes). Parked in favour of Glass Lantern, but still the natural base for two-person painting.

## 3. Build stages, in order

Each stage ends with something the user can see or test. Bring the user along at stage 3 especially: it's the creative part and needs their eye and their phone.

1. **Plan** (this doc). Done.
2. **Shapes as geometry, no visuals.** Classic dice, chestahedron, seeded gems, as plain data (vertices, faces as ordered vertex loops, face normals and centres). Unit tests (section 7).
3. **Look lab, with lil-gui.** A standalone page outside the Foundry: one lantern, every look setting on lil-gui sliders (glow strength, ripple, opalescence, came width, bezel depth, metal roughness, light warmth, background parameters). Tune together until it looks right; the settings we land on become the three kits. **Check on the user's phone early in this stage** (section 6), before investing in expensive effects.
4. **Interaction.** Drag, roll, zoom, gear, reduced motion, double-tap reset. Start from the user's existing pinch-zoom fix (section 5).
5. **Make it a real tile.** Self-contained files, security policy, size check, card art. Test through the real tile loader (the Foundry's `?debug` real-loader view), on webtil.es and on twinkl.social.
6. **Bring it into the Foundry.** New input kinds and panel (section 4), Easy/Hands-on colouring in the preview, recipe, card art. The tile-type picker appears automatically now there are two types. Sprite Walker must be unaffected (its tests stay green).
7. **Publish.** Test tiles on the user's account, then live. Possibly a blog post (same workflow as the Foundry post).

## 4. How it fits the Foundry's code

Read `src/core/contract.js` first: it is the contract every tile type follows. Glass Lantern is a new folder `src/tile-types/glass-lantern/`, registered in `src/tile-types/index.js`. The core should need only the small additions listed here.

**What existing machinery already covers**
- Shape, kit, metal, background: `kind: "choice"` with `display: "swatches"` and `optionPreview(key, value, inputs)` returning PNG bytes. For Glass Lantern the swatch pictures are small offscreen renders of the real lantern.
- Title and description: the existing `card` group ("For display in the link preview card"), exactly as Sprite Walker.
- `build(inputs)` returns `{ name, description, files, icons, screenshots, recipeInputs }`; the core adds `/foundry.json`, checks the security policy, computes addresses, and enforces `MAX_TILE_BYTES` (5 MB, in `src/core/build.js`).

**New input kinds to add to `INPUT_KINDS`** (generic, so future types can reuse them)
- A **palette** input: pick several colours from a set (Easy mode's colours).
- A **face colours** input: one colour per face, set by tapping faces in the preview (Hands-on mode). Needs the preview to report which face was tapped.
- A plain **choice** (not swatches) for the Easy/Hands-on switch and the spread (alternate, random, fade).
- Extend `checkTileType` and `checkInputs` for the new kinds, with tests. Update the contract comment block.

**Panel layout (agreed in sketch form):** preview large on the left on computers (on top on phones); on the right, in order: Shape (picture cards) → Style (picture cards) → Glass colours (Easy | Hands-on switch, then palette or brush) → "Metal, light and background" (collapsed by default) → card title and description. Novice-simple: the kit should already look good with nothing else touched.

**lil-gui is for development only:** look lab, and behind `?debug` in the Foundry. Never the creator's panel.

**Preview in the Foundry:** for editing (especially Hands-on tapping), run the lantern runtime directly in the Foundry page with an edit mode that reports face picks. The published tile uses the same runtime code. The `?debug` real-loader view still checks the real built files.

**Card art:** render the lantern offscreen at **1280×720 banner** and **256×256 icon** (the sizes the tile loader shows: 16:9 box, 48×48 icon), as Sprite Walker's `art.js` does.

## 5. The tile itself (runtime)

**Engine:** three.js is the default choice (materials, environment reflections, geometry helpers, and it was used for the House Dice tunnel). Bundle with esbuild, tree-shaken; measure the size. Earlier tiles (the Wish Demo cube, `bobindex.html` in the project) used raw WebGL, which is the fallback if three.js proves too heavy.

**Files in each tile**
- `/` the HTML page: security policy meta tag, the tile's config (shape geometry, face colours, kit settings, background) as JSON, and a script tag for the runtime.
- **`/lantern.js` the runtime, identical bytes in every Glass Lantern tile.** Because files are content-addressed, the PDS stores it once per account and later tiles reuse it, so only the small HTML differs per tile. To do: add `".js": "text/javascript"` to `CONTENT_TYPES` in `src/core/fileset.js` and never upload JS under any other type (the InvalidMimeType trap). **Verify in stage 5 that the tile loader serves a separate script file correctly**; fallback is inlining the runtime into the HTML (works, but then every tile carries its own copy).
- `/icon.png`, `/banner.png`. The Foundry adds `/foundry.json`.
- Runtime versioning: a change to the runtime changes its address; old tiles keep their old runtime and keep working. Record the runtime version in the recipe.

**Geometry is embedded, not regenerated.** The Foundry computes the shape (including gems from their seed) and writes the final vertex and face lists into the tile's config. The tile never reruns the generator, so floating-point differences between browsers can't reorder faces or change colours.

**Building the visuals**
- Each face: inset polygon (bezel) plus a bevel ring; glass material on the inset.
- Came: a rounded strip along each edge, metal material, optional rivets at vertices.
- Glass: prefer a custom shader (or `onBeforeCompile` on a standard material) that fakes backlight: glow from the inner lamp through the pane, fresnel edge brightening, ripple or opalescent noise, environment reflection. **Avoid true transmission/refraction passes and heavy bloom** unless the phone check shows they're affordable; a cheap glow is preferred.
- Background: procedural, drawn by shader or canvas per kit.

**Interaction details**
- **Pinch fix: start from the user's proven fix**, documented in the project file `bobindex.html`: track every active pointer by id, apply rotation only when exactly one pointer is active, and when one finger lifts mid-pinch, resync the drag start to the remaining finger. The user said they can supply the fix when needed; ask for their latest version at stage 4.
- Tell a tap (roll) from a drag by a movement threshold.
- Wheel zoom must not hijack page scrolling: listen with `passive: false` only on the canvas, and only zoom while the pointer is over the object.
- Roll: pick a random face, compute the rotation that brings its normal to face the viewer, animate a tumble (a few extra spins, eased), settle.
- **Open:** how dragging on phones coexists with page scrolling (`touch-action` is fixed per element, so "drag only when starting on the object" isn't directly possible in CSS). Tile hosts often need a click to activate a tile first (twinkl has an "auto-activate on load" option), which may make this moot. Decide in stage 4 after testing on webtil.es and twinkl.

**Performance**
- Cap device pixel ratio (about 2); render only when something changes when the lantern is still; pause when the tab is hidden.
- If the phone check is poor, step quality down automatically on slow devices.

## 6. Phone check (do early in stage 3)

Before tuning dozens of settings, run the look lab on the user's phone with the expensive pieces switched on and off (glow, environment reflections, ripple noise, pixel ratio). Decide what the lantern can afford. The user tests on a real phone and reports back; screenshots welcome.

## 7. Tests

Follow the Foundry's existing style (Node built-in test runner, `npm test`, all must pass before every push; GitHub Actions runs them too).
- **Geometry:** every shape is closed and convex; Euler's formula (V − E + F = 2); faces are planar; face counts (4, 6, 8, 10, 12, 20, 7); outward normals.
- **Chestahedron:** exactly 4 triangles and 3 kites; **all seven face areas equal** (within a tiny tolerance); triangles equilateral. Derive the coordinates (numerically solving the equal-area condition is fine) and lock them in with this test.
- **Gems:** same seed and facet count give identical geometry; different seeds differ; facet count respected.
- **Determinism:** same inputs give byte-identical tile files (as Sprite Walker).
- **Contract:** the new input kinds are checked; Sprite Walker still passes untouched.
- **Size:** the built tile stays well under `MAX_TILE_BYTES`; record the runtime's size.
- **Browser checks** with Playwright screenshots (the build sandbox has Chromium; WebGL runs in software there, so judge looks on the user's real screens).

## 8. The recipe (`/foundry.json`, public)

Always store the full result, not just the choices, so tiles can be continued or edited later:
- `shape`: group (classic, special, gem), which one, and for gems the seed and facet count; plus a short geometry fingerprint.
- `faces`: **one colour per face, always**, even in Easy mode (also record the Easy settings used, if any). This is what makes Hands-on editing and the two-person version possible.
- `kit` (id and version), `metal`, `light`, `background` (id and version), any overridden look settings.
- `runtime` version.
- Nothing private: the recipe is readable by anyone.

## 9. Two-person version (later, design noted now)

A tile can't change after it's published and can't use the network, so turns happen in the Foundry, not inside a tile:
1. Person A makes a lantern and mints it in **their** repo.
2. A shares a "continue this lantern" link (the Foundry with A's tile address).
3. Person B opens it; the Foundry reads A's recipe from A's tile, B sets the glass of some faces, and mints the result in **B's** repo, crediting both and linking back to A's tile.

The result is a chain of tiles, each owned by whoever made that turn. It needs no server and no new sign-in permissions. It depends on the recipe storing one colour per face (section 8), which is why that rule is set now.

## 10. Open decisions for the build chat

1. Exact kit palettes, metals and backgrounds: settled by tuning in the look lab.
2. How many gem facets (range) and how the "fade" spread orders faces on irregular shapes.
3. Phone dragging versus page scrolling (section 5), after testing on webtil.es and twinkl.
4. Whether background is chosen separately from the kit in version 1, or only through the kit (agreed it's a design element; confirm the control).
5. Default tile size in hosts (the Astro snippet uses height 400; check that a 3D object reads well at that size).
6. The tagline (on hold).

## 11. Working with the user (carry over)

- The user works in VS Code and PowerShell on Windows, folder `C:\thunderbird-cafe\web-tile-foundry\`. Deliver a zip to copy **over** the folder (keeping `node_modules` and `package-lock.json`), then `npm test`, `git add -A`, `git commit -m "..."`, `git push`, **one line at a time** (pasting several lines leaves PowerShell at `>>`).
- In instructions, never show prompt text like `PS C:\...>`: it gets pasted as a command.
- App passwords: all were deleted Oct 2; a new one will be needed for Sequoia or scripts. Use `$env:BSKY_APP_PASSWORD = Read-Host "App password"`, leaving the quoted label alone; paste at the prompt with right-click.
- Novice-simple UI wording; no double dashes in user-facing text and blog posts.
- The build sandbox can't reach npm; use what's installed there (esbuild, React, Playwright Chromium). **three.js and lil-gui were not present in the sandbox on Oct 2.** First thing in the build chat: check again (npm and CDN access vary by session); if still blocked, have the user run `npm install three lil-gui` in the Foundry folder and attach the needed files, or add them to `package.json` so their machine and GitHub Actions install them.
- Ask before building when a choice is expensive to redo; the user likes to discuss first ("no build yet") and then say go.
