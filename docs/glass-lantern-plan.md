# Glass Lantern: plan and handoff for the Web Tile Foundry's second tile type

Written Oct 2 2026, at the end of the chat that built and launched the Web Tile Foundry (v0.8.3) and its blog post. Updated Oct 3 2026 after stage 2. Read `claude/web-tile-foundry-progress.md` alongside it for how the Foundry works, hosting, and the user's workflow.

**Status (Oct 3 2026): stages 1 and 2 done; stage 3 (look lab) in progress.** Stage 2 is on GitHub as commit `8f70e69`; three 0.186.1 and lil-gui 0.21.0 added in `92ceed9`. The look lab is built and the phone check is done (section 6): **real glass (transmission) is the main look**, the cheap glow is the backup for slow devices. Next: tuning the looks into the three kits. Stage 2 details in section 12, stage 3 in section 13. A copy of an earlier version of this plan also lives in the repo at `docs/glass-lantern-plan.md` (the user added it); this project doc is the current one.

---

## 1. What Glass Lantern is

A 3D tile: a dice-like object made of stained-glass panes held in metal, lit from inside, set against a designed background. Think Tiffany lamp, Victorian parlour or steampunk workshop. Viewers can turn it, roll it, zoom in, and choose whether it slowly rotates.

- **Type name:** Glass Lantern. Tagline: on hold.
- **Type id (permanent once published):** `glass-lantern`. Version 1.
- **Category word:** the user decided to keep **"type"** (as in "tile type"). It's real foundry language: a coin's design is its "type" to numismatists, and type foundries cast type. Alternatives that were considered and set aside: mold, pattern, order, theme, mint.

## 2. Scope of version 1 (agreed)

**Shapes, three groups** (all built in stage 2, see section 12)
1. **Classic dice:** d4, d6, d8, d10, d12, d20.
2. **Special:** the **chestahedron** (named after the artist Frank Chester). Seven faces: 4 equilateral triangles and 3 kites, **all seven of equal area**. It is a special case of the diminished trigonal trapezohedron (7 faces, 12 edges, 7 vertices). Room for more special solids later.
3. **Gem:** irregular facets, generated from a seed. Controls: "new shape" button and a facet-count control (10 to 24, default 14).

**Styles: three kits, chosen in the Foundry**
- **Tiffany, Victorian, Steampunk.** Picking a kit sets glass palette, metal, background and lighting in one click; people can then adjust. Starting ideas, to be tuned in the look lab:
  - Tiffany: amber, leaf green, cobalt, ruby, opalescent milky glass; copper or bronze came with a patina; warm lamp; dark wood or parlour background.
  - Victorian: deep jewel tones (garnet, emerald, sapphire, amethyst); pewter or blackened silver; gaslight glow; velvet and damask background.
  - Steampunk: amber, smoked and teal glass; brass with rivets; workshop background (gears, pipes); warm light with a cooler rim.

**Colouring: the user chooses Easy or Hands-on**
- **Easy:** pick colours from the kit's glass palette, then a spread: alternate, random, or fade (gradient top to bottom, following the fixed face order from stage 2).
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
- **Zoom:** pinch on phones, wheel or trackpad on computers. Limits on how far; **double-tap to reset** (but see open decision 8: a double-tap starts with a tap, which rolls).
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
2. **Shapes as geometry, no visuals.** **Done Oct 3 2026** (commit `8f70e69`). Details in section 12.
3. **Look lab, with lil-gui.** **In progress** (see section 13 for what exists). Agreed outline:
   - A standalone page outside the Foundry, `lab/glass-lantern.html`, run with `npm run dev`. Not part of the live site (keep it out of the production build).
   - One lantern built from the stage 2 shapes, with a shape picker. Inner glow, came, bezels, glass shaders and a procedural background, each on lil-gui sliders (glow strength, ripple, opalescence, came width, bezel depth, metal roughness, light warmth, background parameters), plus on/off switches for the expensive parts.
   - **Phone check first** (section 6): a bare-bones version with the expensive switches before any fine tuning. The user opens it on their phone over home Wi-Fi with `npm run dev -- --host`.
   - **User's first step:** `npm install three lil-gui` in the Foundry folder, commit `package.json` and `package-lock.json`, push. Then the build chat pulls the exact versions from GitHub (the sandbox can't reach npm; check whether the proxy serves the package tarballs, otherwise ask the user to attach `node_modules/three/build/three.module.js` and lil-gui's ESM file).
   - Tune together until it looks right; the settings we land on become the three kits.
4. **Interaction.** Drag, roll, zoom, gear, reduced motion, double-tap reset. Start from the user's existing pinch-zoom fix (section 5).
5. **Make it a real tile.** Self-contained files, security policy, size check, card art. Test through the real tile loader (the Foundry's `?debug` real-loader view), on webtil.es and on twinkl.social.
6. **Bring it into the Foundry.** New input kinds and panel (section 4), Easy/Hands-on colouring in the preview, recipe, card art. The tile-type picker appears automatically now there are two types. Sprite Walker must be unaffected (its tests stay green).
7. **Publish.** Test tiles on the user's account, then live. Possibly a blog post (same workflow as the Foundry post).

## 4. How it fits the Foundry's code

Read `src/core/contract.js` first: it is the contract every tile type follows. Glass Lantern is a new folder `src/tile-types/glass-lantern/` (stage 2 created `geometry/` inside it), registered in `src/tile-types/index.js` (not registered yet: do that in stage 6, when it becomes a real type). The core should need only the small additions listed here.

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

**Geometry is embedded, not regenerated.** The Foundry computes the shape (including gems from their seed) and writes the final vertex and face lists into the tile's config (`shapeForTile(shape)` in stage 2's `geometry/index.js` returns exactly `{ vertices, faces }`). The tile never reruns the generator, so floating-point differences between browsers can't reorder faces or change colours.

**Building the visuals**
- Each face: inset polygon (bezel) plus a bevel ring; glass material on the inset.
- Came: a rounded strip along each edge (stage 2 provides the edge list), metal material, optional rivets at vertices.
- Glass: **real glass (MeshPhysicalMaterial with transmission) is the main look** since the phone check (section 6); the cheap glow shader is the backup for slow devices. Heavy bloom is still avoided. See section 13.
- Background: procedural, drawn by shader or canvas per kit.

**Interaction details**
- **Pinch fix: start from the user's proven fix**, documented in the project file `bobindex.html`: track every active pointer by id, apply rotation only when exactly one pointer is active, and when one finger lifts mid-pinch, resync the drag start to the remaining finger. The user said they can supply the fix when needed; ask for their latest version at stage 4.
- Tell a tap (roll) from a drag by a movement threshold.
- Wheel zoom must not hijack page scrolling: listen with `passive: false` only on the canvas, and only zoom while the pointer is over the object.
- Roll: pick a random face, compute the rotation that brings its normal to face the viewer (stage 2 provides unit outward normals and face centres), animate a tumble (a few extra spins, eased), settle.
- **Open:** how dragging on phones coexists with page scrolling (`touch-action` is fixed per element, so "drag only when starting on the object" isn't directly possible in CSS). Tile hosts often need a click to activate a tile first (twinkl has an "auto-activate on load" option), which may make this moot. Decide in stage 4 after testing on webtil.es and twinkl.

**Performance**
- Cap device pixel ratio (about 2); render only when something changes when the lantern is still; pause when the tab is hidden.
- If the phone check is poor, step quality down automatically on slow devices.

## 6. Phone check (done Oct 3 2026)

Phone: **Samsung Galaxy S25 Ultra** (a top-end phone, 120 Hz screen). Results in the first look lab:
- Real glass (transmission) on: a steady 60 fps, slowest frame 17 ms (exactly one refresh: no missed frames). While dragging it rises to about 110 fps (the phone runs idle pages at 60 to save battery, faster while touched).
- Worst case (real glass, 24-facet gem, sharpness at device pixel ratio): about the same.
- The user found real glass "really good, glass like", and the detail "such intricate and amazing detail".

**Decision:** real glass is the main look. Because the test phone is so fast, the cheap glow stays as an **automatic backup** for slower devices: build that switch in stage 5 (for example, measure the first second or two of frames and step down to the backup glass, then lower pixel ratio, if it can't hold about 45 fps). Still worth a check on an older or mid-range phone if one is available.

## 7. Tests

Follow the Foundry's existing style (Node built-in test runner, `npm test`, all must pass before every push; GitHub Actions runs them too).
- **Geometry (done in stage 2):** every shape is closed and convex; Euler's formula (V − E + F = 2); faces are planar; face counts (4, 6, 8, 10, 12, 20, 7); outward normals.
- **Chestahedron (done):** exactly 4 triangles and 3 kites; all seven face areas equal; triangles equilateral; fold angle locked.
- **Gems (done):** same seed and facet count give identical geometry; different seeds differ; facet count respected.
- **Determinism:** same inputs give byte-identical tile files (as Sprite Walker).
- **Contract:** the new input kinds are checked; Sprite Walker still passes untouched.
- **Size:** the built tile stays well under `MAX_TILE_BYTES`; record the runtime's size.
- **Browser checks** with Playwright screenshots (the build sandbox has Chromium; WebGL runs in software there, so judge looks on the user's real screens).

## 8. The recipe (`/foundry.json`, public)

Always store the full result, not just the choices, so tiles can be continued or edited later:
- `shape`: group (classic, special, gem), which one, and for gems the seed and facet count; plus the geometry fingerprint (stage 2 computes it on every shape).
- `faces`: **one colour per face, always**, in the fixed face order from stage 2, even in Easy mode (also record the Easy settings used, if any). This is what makes Hands-on editing and the two-person version possible.
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
2. ~~Gem facet range and fade order~~ **Settled Oct 3:** 10 to 24 facets, default 14; "fade" follows the fixed face order (top to bottom, then around), which works on every shape including gems.
3. Phone dragging versus page scrolling (section 5), after testing on webtil.es and twinkl.
4. Whether background is chosen separately from the kit in version 1, or only through the kit (agreed it's a design element; confirm the control).
5. Default tile size in hosts (the Astro snippet uses height 400; check that a 3D object reads well at that size).
6. The tagline (on hold).
7. **d10 proportions (new, look lab):** the stage 2 d10 is the mathematically pure one (dual of the regular pentagonal antiprism) and comes out tall and narrow: tip height is 1.81 × the ring radius. Physical d10s are squatter. The ring's zig-zag height can change freely (the tips are recomputed so the kites stay flat); if changed, update the d10's locked fingerprint in the test, which is fine since nothing is published yet.
8. **Double-tap reset versus tap to roll (new, stage 4):** a double-tap begins with a single tap, which would roll. Options: wait about 250 ms after a tap to see if a second follows before rolling, or drop double-tap and keep reset in the gear menu only.
9. **bobmodel.glb (deferred by the user):** the attached project file is the hand-written d6 from the earlier rotatable tile (one mesh, "dice"). Not used in stage 2; ask later whether it was meant as a reference.
10. **The lamp (open, user unsure):** the round ball looked out of place next to the glass ("a disconnect from the visual quality of the glass"), so the default is now a soft glow with no hard edge; the ball stays behind a "show bulb" switch. Per-kit lamps (Tiffany frosted bulb, Victorian candle or gas mantle, Steampunk Edison filament) remain an idea; decide while tuning.

## 11. Working with the user (carry over)

- The user works in VS Code and PowerShell on Windows, folder `C:\thunderbird-cafe\web-tile-foundry\`. Deliver a zip to copy **over** the folder (keeping `node_modules` and `package-lock.json`), then `npm test`, `git add -A`, `git commit -m "..."`, `git push`, **one line at a time** (pasting several lines leaves PowerShell at `>>`).
- **The zip contains a top-level `web-tile-foundry` folder.** Tell the user: right-click, Extract All, set the destination to `C:\thunderbird-cafe` (Windows suggests a new folder named after the zip, which nests it one level too deep), and choose "Replace the files in the destination". Check: `C:\thunderbird-cafe\web-tile-foundry\src\tile-types\glass-lantern\` exists and there is no `web-tile-foundry\web-tile-foundry`. In VS Code, open the folder `C:\thunderbird-cafe\web-tile-foundry` (the one with `package.json`) and use Terminal > New Terminal.
- Build the zip from `git ls-files -co --exclude-standard` minus `package-lock.json` (no `.git`, no `node_modules`), and run `npm test` on the unzipped copy before sending. (`rsync` isn't in the sandbox.)
- The repo is public, so the build chat can clone it read-only (`add_repo` pyxorium/web-tile-foundry, then a shallow clone) to start from the user's exact code and to confirm pushes landed. It can't push; the user pushes.
- In instructions, never show prompt text like `PS C:\...>`: it gets pasted as a command.
- App passwords: all were deleted Oct 2; a new one will be needed for Sequoia or scripts. Use `$env:BSKY_APP_PASSWORD = Read-Host "App password"`, leaving the quoted label alone; paste at the prompt with right-click.
- Novice-simple UI wording; no double dashes in user-facing text and blog posts.
- The build sandbox can't reach npm (Oct 3: `registry.npmjs.org` is not on the egress allowlist). **How three and lil-gui got into the sandbox:** the session is linked to the user's Windows computer; with the user's OK, read access was granted to just `C:\thunderbird-cafe\web-tile-foundry\node_modules\three` and `...\lil-gui`, and these files were staged into the sandbox's `node_modules`: three's `package.json`, `LICENSE`, `build/three.module.js`, `build/three.core.js`, `examples/jsm/environments/RoomEnvironment.js`; lil-gui's `package.json`, `LICENSE.md`, `dist/lil-gui.esm.js`, `dist/lil-gui.css`. A new chat must do the same (or ask the user to attach them). The sandbox has esbuild at `/opt/npm-tools/node_modules/@esbuild/linux-x64/bin/esbuild` and Playwright Chromium (WebGL via SwiftShader: slow, correct; never run several screenshot browsers at once, they time out). Vite is not in the sandbox; bundle the lab with esbuild and serve it with `python3 -m http.server` to screenshot it.
- **Running the lab on the user's machine:** `npm run lab` (added in stage 3; it runs `vite --host --open /lab/glass-lantern.html`). Don't tell the user `npm run dev -- --host`: PowerShell swallows the `--`, so Vite never gets `--host` and prints no Network line. If needed, `npx vite --host` works. The phone opens the **Network** address Vite prints in the terminal plus `/lab/glass-lantern.html`, in its browser, on the same Wi-Fi (the user first looked for it in the phone's Wi-Fi list: say clearly it's typed into the browser). Windows may ask to allow Node.js on private networks.
- **Check in before building.** The user asked for frequent check-ins and approval before each build step, and a task list in the app to track progress. They like to discuss first ("no build yet") and then say go.
- The account holds attorney-client privileged material: keep work private (files and project docs, no published pages) unless the user says otherwise.

## 12. Stage 2 results (Oct 3 2026)

**Files** (all new, nothing existing changed; not registered as a tile type yet, so the Foundry UI and Sprite Walker are untouched)
- `src/tile-types/glass-lantern/geometry/polyhedron.js`: vector helpers, `hullFaces` (brute-force convex hull that keeps coplanar points as one polygon face), `orderLoop`, `finishShape` (centre, scale, round, canonical order, derived data, fingerprint), `checkShape` (closed, consistently wound, Euler, flat, convex, outward), `fingerprintOf`.
- `geometry/dice.js`: `CLASSIC_DICE`, `classicDie(id)`.
- `geometry/chestahedron.js`: `chestahedron()`, `CHESTAHEDRON_FOLD`.
- `geometry/gem.js`: `gem({ seed, facets })`, `GEM_FACETS`, `seededRandom` (mulberry32), `randomSeed()` (for the "new shape" button only), `checkGemOptions`.
- `geometry/index.js`: `SHAPE_GROUPS`, `getShape({ group, id, seed?, facets? })`, `shapeForTile(shape)`.
- `test/glass-lantern-geometry.test.mjs`: 19 tests. Whole suite 62/62.

**Shape data format** (every shape): `{ id, group, vertices: [[x,y,z]], faces: [[i,j,k,...]] (corner loops, counter-clockwise seen from outside), normals (unit, outward), centres (area centroids), areas, edges: [[a,b]] (a < b, sorted), fingerprint }`, plus `seed` and `facets` on gems.

**Conventions** (these decide face order, so face colours depend on them; never change them for a published shape)
- z is up. Centred on the average of the corners; scaled so the farthest corner is at distance 1 (switching shapes keeps framing).
- Fixed order for vertices and faces: top to bottom (by z, then face centre z), then around by angle from +x towards +y. Each face loop starts at its lowest vertex index.
- Coordinates rounded to 9 decimal places, no negative zero.
- **Fingerprints locked in the test:** d4 `8a6eb9b3`, d6 `94d9da0d`, d8 `d2235f0e`, d10 `85506c16`, d12 `6189e6db`, d20 `bd334729`, chestahedron `6645feed`, gem seed 42 / 14 facets `1532655a`. A change that alters geometry fails the test first, on purpose.

**Classic dice:** listed as corner points; faces from the hull. Every die has all faces of identical area (fair). d10 is built as the dual (polar) of the regular pentagonal antiprism, so its ten kites are exactly flat and identical (see open decision 7 about its proportions).

**Chestahedron: how the coordinates were derived**
- Base: equilateral triangle, side 1, at z = 0. Over each base edge, an equilateral triangle (side 1) hinged on that edge and folded up by angle `fold`; its free corner is U. A tip P on the axis.
- Each kite is P, U, L, U' around a base corner L. The two U's are mirror images across the plane through the axis and L, so the kite is flat exactly when P lies on the line from L through the midpoint of U U'. That fixes P for any fold.
- One free number remains (the fold). Kites shrink as the fold rises, so one fold makes kite area equal triangle area. Solved by bisection: **fold = 85.169°, so the triangles meet the base at 94.83°**, matching the angle usually quoted for Chester's chestahedron (independent confirmation). Areas agree to about 1e-9 after rounding.

**Gems: plane cuts**
- Slice a ball with N planes; each plane is one pane, so the facet count is exact and the shape is always convex. Plane directions: a Fibonacci sphere of N points, turned to a random orientation, each nudged sideways by up to about 25% of the spacing; each plane at a random depth 0.85 to 1.0; the stone stretched 1.0 to 1.3 along its height.
- A candidate is rejected and the next drawn (same seeded sequence, still deterministic) if a plane makes no pane, the smallest pane is under 25% of the average pane (too small to tap), or the shortest edge is under 12% of the average edge (a stub of came). Up to 200 attempts.
- Tuning history: a fixed minimum edge (0.08) and a 0.35 nudge failed 68 of 1,500 seeds and were slow; the relative edge check at 12% with a 0.25 nudge passed all 1,500 (facets 10 to 24 × 100 seeds), worst case 40 ms. Panes come out mostly pentagons and hexagons (sides seen: 3 rare, 4 to 7 common, 8 rare).

**Preview:** a matplotlib picture of every shape was made in the build chat to check them by eye (colours just cycled). Not part of the repo.

## 13. Stage 3 so far (Oct 3 2026)

**Files**
- `lab/glass-lantern.html`, `lab/glass-lantern-lab.js`: the look lab. Development only; Vite's production build only includes `index.html`, so the lab never reaches the live site. lil-gui panel (closed on narrow screens), big fps counter, temporary drag to turn, slow turn, settings saved per device in localStorage (`glass-lantern-lab-v2`), "Show settings to copy" prints JSON for the user to paste into the chat.
- `src/tile-types/glass-lantern/lantern/` (reused by the tile in stage 5 and the Foundry preview in stage 6):
  - `settings.js`: `DEFAULT_SETTINGS` (every look setting; a rough Tiffany-ish placeholder, not a kit), `METALS`, `PIXEL_RATIOS`, `kelvinToHex`, `alternateColours`. Plain data, no three.js.
  - `meshes.js`: `buildPanes(shape, colours, settings)` (each pane is a true inset of its face, set back by `bezelDepth`, with a sloping bevel ring; attributes position, normal, color, `aFace`, `aRim`), `buildCame(shape, settings)` (flattened strip per edge lying between its two faces, sphere joint per corner, bigger with rivets), `insetPolygon`, `maxInset`. Each pane's available inset is measured and shared between the metal margin and the bevel, so small gem panes never get an inside-out bevel (that bug was found and fixed).
  - `materials.js`: shared uniforms; real glass = MeshPhysicalMaterial (transmission, thickness, ior, roughness as frost, dispersion) plus injected ripple (bends the surface normal from object-space noise) and opal (milky mix after the transmission chunk); backup glass = MeshStandardMaterial plus injected fake backlight glow, ripple and opal; metal = MeshStandardMaterial.
  - `lamp.js`: the soft glow, a camera-facing sprite with a generated radial texture, additive, **kept in the opaque list** (`transparent: false`, `depthWrite: false`, `renderOrder` 2).
  - `background.js`: placeholder full-screen gradient, halo and vignette shader.
  - `scene.js`: `createLantern(canvas, settings)` returning `{ group, renderer, setShape, setColours, update, resize, render, dispose }`. Renderer ACES tone mapping, sRGB; generated RoomEnvironment through PMREM for reflections; camera fits narrow screens by width.
- `test/glass-lantern-lantern.test.mjs`: pane and came geometry for every shape, colours on the right faces, panes inside their faces with outward normals, inset maths, settings. Whole suite 68/68.

**Things learned about three.js 0.186 transmission (important for stage 5)**
- Real glass only shows **opaque** objects behind it: the transmission pass renders the opaque list only. That's why the lamp glow is an opaque-list additive sprite.
- three's own way to show the far side of transmissive glass (DoubleSide) renders backfaces into the transmission target **only when the `WEBGL_multisampled_render_to_texture` extension is absent**, which it often isn't on Android. So the far panes are a separate mesh sharing the panes' geometry, `BackSide`, using the (opaque) backup glass material; they show through the near panes on every device.
- Without far panes, a pane in front of a dark background looks dark: transmission only shows what's behind. The far panes and the lamp glow are what fill the glass with colour.

**Defaults now:** real glass on, far side on, rainbow edges 0.25, ripple 0.35, lamp brightness 2.5, glow size 0.55, warmth 2400 K, brass came. All are starting points for tuning.

**Automatic quality (added Oct 3, after the desktop crash)**
- The user's computer: **Intel UHD Graphics 620** (laptop graphics) on an **ultrawide monitor**. Real glass at full screen made Chrome lose the WebGL context (white page, sad face). Reproduced in the app's built-in browser at 1920×1080; at 1024×768 it ran at 30 fps.
- `lantern/quality.js`: `QUALITY_STEPS` (in order: real glass at half resolution, rainbow edges off, far side off, sharpness 1, backup glass), `createQualityGovernor()` (settle 500 ms, measure 1.5 s, target 45 fps, step at once after 2 frames over 150 ms), `overridesFor(n)`, `SAFE_SETTINGS`. Pure logic, tested in Node.
- `settings.js`: `pixelRatioFor()` and `maxPixels` (1.6 million: a big phone at sharpness 2 is about 1.5 million), so a huge canvas draws at lower resolution and scales up; `glassResolution` ("half" sets three's `renderer.transmissionResolutionScale` to 0.5).
- `scene.js`: `setOverrides()` lays the steps on top of the settings without changing them; `effective` and `pixels` getters.
- Lab: auto quality on by default (switch and "Check quality again"), the fps box says what was stepped down and when a big window is drawn at lower resolution; on `webglcontextlost` the page reloads as `?safe=crashed`; `?safe` opens the lightest look; "Leave safe mode" button. Tested in the sandbox: steps all the way down there, and a simulated crash reloads into safe mode. Tests 73/73.
- **The tile (stage 5) should reuse exactly this:** pixel budget, governor, and a context-loss fallback (a tile can't reload itself with a query string, so recover in place: recreate the renderer with the safe settings).

**Results after auto quality:** desktop (ultrawide, Intel UHD 620): 55 fps, full look, "Big window: drawing at 81% resolution", no crash. Phone: "Auto quality: full look". The user prefers the soft glow to the ball (the "show bulb" switch stays for a possible per-kit lamp).

**The user's tuning (Oct 3):** Bending (ior) 1, Thickness 0, Frost 0, Rainbow edges 0: clear, flat glass with no refraction ("my eye seems to like low bending, which seems to cancel out or dampen effects of other parameters": correct, thickness and dispersion only act through refraction). Came width 0.02, Round↔flat 0.38, metal roughness 0.47. **Idea to test:** with zero bending, a plain see-through tinted glass (no transmission pass) may look almost the same and run fast everywhere; try it as a "clear glass" option before stage 5.

**Kits (drafts, `lantern/kits.js`):** `KIT_BASE` (the user's tuning above, shared by all), `KITS` (Tiffany: user's colours, opal 0.25, bronze, 2400 K, warm wood; Victorian: garnet, emerald, sapphire, amethyst, old gold, pewter, 3000 K, plum velvet; Steampunk: amber, smoked, teal, honey, rust, brass with rivets, 2100 K, ripple 0.5, sooty workshop), `DEVICE_KEYS` (never set by a kit), `kitLook(id)`, `getKit(id)`. Lab: "Kit" dropdown at the top; "Show settings to copy" includes the kit id. Tests 75/75.

**Kits tuned by the user (Oct 3), locked in `kits.js` with `tuned: "2026-10-03"`:**
- **Tiffany:** palette amber #d68a24, leaf green #5d8f3a, cobalt #2c4fa3, ruby #a11c30, milky #eadfc6; ripple 0.47 (scale 12); opal 0.33 (scale 2.8, glow 1.06); polished bronze (roughness 0.15); flat came 0.02 / 0.38; lamp 2400 K; no bending.
- **Victorian:** garnet #7a1022, emerald #0f5e3c, sapphire #1d3b8c, amethyst #5b2a86, old gold #c9a043; ripple 0.2 (scale 12); **opal 0** (user's choice: clear jewel glass); blackened silver, roughness 0.44, came 0.02 / 0.61; reflections 1.5; gaslight 3050 K; no bending.
- **Steampunk:** amber #c77a1a, smoked #4a4038, teal #1f6f6a, honey #e0a642, rust #8a3b1c; ripple 0.5 (scale 6); faint opal 0.09 (scale 7.1, kept by the user); **a little bending** (ior 1.29, thickness 0.11); nearly round shiny brass rods (0.026 / 0.87, roughness 0.24) with rivets; lamp 2600 K, smaller glow 0.36; outside light 1.3, reflections 0.65.
- Lesson: the "Phone check > Opalescent" switch had been left off on the user's phone, so opal was invisible while tuning Victorian and Steampunk; explain the difference between the opal **slider** (saved in the kit) and the **switch** (device test only) when it comes up. A later cleanup could drop the per-effect switches from the lab now that auto quality exists.
- In the lab, tuned kits show without "(draft)".

**Next:** kit backgrounds (parlour wood, velvet damask, workshop) as their own round, check in first; then the "clear glass" test (no transmission pass when bending is 0, as in Tiffany and Victorian); then stage 4 (interaction).

**Earlier next step (done):** the user checks the desktop (should no longer crash) and the new glow, far side and real-glass sliders on the phone (fps with far side and rainbow edges on), then tuning toward the three kits; decide the lamp (open decision 10) and the d10 proportions (7).
