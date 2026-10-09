// The tile-type contract.
//
// The Foundry core never knows what a particular kind of tile looks like. Each
// tile type is a plain object that follows this contract, and the core does
// everything else (checks, recipe, addresses, preview and, later, publishing).
// Adding a new kind of tile means adding a folder under src/tile-types/ and
// registering it; the core does not change.
//
// A tile type:
//   id        string   lowercase-kebab, e.g. "sprite-walker". Never changes once published.
//   version   integer  bump when the tile's output changes in a meaningful way.
//   title     string   shown on the "pick a tile type" card.
//   summary   string   one line under the title.
//   inputs    array    what the user fills in; each entry:
//               { key, kind, label, help?, required?, options?, maxLength?, multiline?, display?, showIf? }
//             kind is one of INPUT_KINDS below. The core renders the form from these.
//               sprite   an rpg.actor sprite sheet
//               choice   one of `options` ([{ value, label, color? }]; `color` adds a
//                        small dot of that color). With display: "swatches" it is
//                        shown as a grid of pictures: each option's `image` (a picture's
//                        address, made ahead of time), or else drawn by optionPreview (below).
//                        Pictures are drawn as pixel art unless the input has smooth: true.
//               text     a line or box of text (maxLength, multiline)
//               palette  several colors ticked from `colors` ([{ value: "#rrggbb", label }]);
//                        the value is a list of "#rrggbb", at least `min` (default 1)
//               brush    one color from `colors` (a paintbrush, for painting in the preview)
//               range    a number from `min` to `max` in steps of `step` (default 1), a slider
//               seed     a whole number with a button (`button`, its label) that picks a new random one;
//                        with editable: true the number shows and can be typed (up to `max`)
//               toggle   on or off (true or false), a switch
//                        With mustBeOn (a sentence), it must be on to PUBLISH, though
//                        the tile is still built and previewed while it is off (for
//                        a confirmation such as "these are my songs").
//               action   a button (`button`, its label). Pressing it calls
//                        applyChange(key, true, values), which does the work;
//                        nothing is kept under the key. disabledIf(values), optional,
//                        dims the button when there is nothing to do.
//               tracks   a list of songs, in playing order. Each song:
//                          { id, title, artist?, side, seconds, status, bytes?,
//                            progress?, error?, transition?, source? }
//                        status is "converting", "ready" (bytes holds the finished
//                        file) or "error" (error says why). transition is how the
//                        song leads into the next one on its side (TRANSITIONS).
//                        Options: sides (default ["A"]); maxSecondsPerSide;
//                        maxTracks; transitions: true shows the choice between songs;
//                        picker: { mount(element, { getTracks, setTracks, context })
//                        -> { update(tracks, context), dispose() } }, the type's own
//                        way of adding songs, shown above the list (update is also
//                        called when the context changes, e.g. the account's details
//                        arrive). Songs are converted by the type (src/core/audio/),
//                        which updates their status. When the creator picks a "Then",
//                        the song also gets transitionChosen: true.
//               pages    a fixed set of pages (a little book), each with a picture
//                        and words. Options: pages: [{ id, label, short?, fields?,
//                        layouts? }] in reading order. A page with layouts: true
//                        uses the input's `layouts` ([{ value, label, shows, labels?, fill? }],
//                        shows a list of "picture", "heading", "words"; labels, optional,
//                        renames fields for that layout, e.g. { words: "Quote" }; fill:
//                        "always" means its picture always fills, so no Fit / Fill choice); otherwise
//                        `fields` lists what it shows ("picture", "heading",
//                        "words", "subtitle"). headingMax, subtitleMax (characters);
//                        wordLimit(page, value, values) -> how much room the words
//                        on that page may take (as the type lays it out), measured
//                        by wordSize(text) (default: the number of characters).
//                        onSelect(id), optional: called when the creator opens a page
//                        in the editor (a preview can turn to it).
//                        The value is a list, one entry per page, in the same order:
//                          { id, layout?, heading?, subtitle?, words?, picture? }
//                        picture: { bytes (Uint8Array), contentType, width, height, alt?,
//                                   fill?, crop? }
//                        made small in the browser (src/core/pictures.js).
//                        With pictureFrame(page, value, values) -> { w, h } (the shape a
//                        picture fills on that page), the editor offers Fit / Fill and a
//                        crop (drag, and zoom from 1 to zoomMax, default 2): crop is
//                        { x, y, zoom }, x and y from 0 to 1 (see cropRect in pictures.js).
//                        pageToggles: [{ key, label, help?, unavailable?(values, context),
//                        panel?, problems?, bytes? }]: switches every page offers (stored
//                        as page[key] = true); unavailable returns a sentence when the
//                        switch can't be used. While a switch is on:
//                          panel: { mount(element, { getPage, patchPage, values, context })
//                            -> { update(page, values, context), dispose() } }, the type's
//                            own tools shown under the switch (plain DOM); patchPage(change)
//                            changes the page (always the latest one), getPage() reads it;
//                          problems(page, spec, values) -> sentences that stop building;
//                          bytes(page) -> how many bytes it adds (counted in the size meter);
//                          hide(page) -> true where the switch isn't offered (its problems
//                            and bytes still count if the page has it on).
//                        sizeLabel, optional: what the size meter counts (default "Pictures").
//                        piece: { panel, problems?, bytes? }, needed when a layout (or a
//                        page's fields) shows "piece": something the type manages itself
//                        and keeps in page.piece (Zine Scene: one of the creator's tiles).
//                        panel, problems and bytes work as for page toggles (above).
//             showIf(values): OPTIONAL; the input is shown (and checked) only when it returns true.
//             Inputs with the same `group` are shown together under that group's title.
//             The group "card" (the link preview card's words) is shown at the
//             Publish step's review, next to the card, with the confirmations
//             (see reviewInputs).
//   groups    array    OPTIONAL: [{ id, title, collapsed? }] titles for grouped inputs;
//                      collapsed: true starts the group closed (click its title to open).
//   reviewSummary(values)  OPTIONAL: a few words about the tile for the Publish
//             step's review, next to its size (e.g. "8 pages · 2 web tiles · 3 sounds").
//   applyChange(key, value, values)   OPTIONAL
//                      -> { values, confirm? }: the values after the user changes one
//                         input, for types where one change affects others (for example
//                         a new style resetting colors). With `confirm` (a question),
//                         the core asks first and changes nothing if the answer is no.
//   optionPreviewKey(key, values)     OPTIONAL
//                      -> string: swatch pictures for input `key` are redrawn when it
//                         changes (without it, when the sprite changes).
//   preview            OPTIONAL: a live preview run in the Foundry page instead of the
//                      built tile in a frame: { mount(element, { values, setValue, result })
//                      -> { update(values, result), dispose() }, caption?(values) }.
//                      `result` is the latest built tile (buildTile), or null while
//                      the inputs have problems. With needsResult: true, update is
//                      also called after each new build; other types ignore it.
//                      `setValue(key, value)` changes a value as if the user had.
//   zinePage           OPTIONAL: whether a published tile of this type can go on a
//                      Zine Scene page: "live" (copied in and run on the page) or
//                      "tape" (shown as a J-card with a link). Omitted: it can't.
//   credits            OPTIONAL: thanks shown with the type's panel, e.g. for
//                      outside work the type uses. A list of credits, each a list of
//                      parts: a string, or { text, href } for a link.
//   buildDelayMs       OPTIONAL: how long to wait after the last change before
//                      rebuilding the tile (default 250).
//   maxBytes           OPTIONAL: the most a tile of this type may weigh, all files
//                      together, in bytes. Default DEFAULT_MAX_TILE_BYTES (5 MB);
//                      never more than MAX_TILE_BYTES_CAP (60 MB). Types with big
//                      files (songs) raise it; each file is still uploaded on its own.
//   defaults(context)  -> object of starting input values. `context` may carry
//                         { handle } once sign-in exists.
//   optionPreview(key, value, inputs)   OPTIONAL
//                      -> Promise of PNG bytes (or null): the picture for one
//                         option of a "swatches" input, given the other inputs.
//   build(inputs, { final })  -> Promise of:
//               { name, description,
//                 files: [makeFile(...)],          must include "/" (the HTML page)
//                 icons?: [{ src: "/icon.png" }],  card icon(s), paths must be in files
//                 screenshots?: [{ src: "/banner.png" }],  card banner(s)
//                 recipeInputs: { ... } }           what to record in /foundry.json
//
// `final` is false while the creator is still making changes (the preview
// and Publish button use that build) and true just before publishing. A type
// whose card pictures are costly to draw may leave icons and screenshots out
// while `final` is false; the core builds again with `final: true` to publish.
//
// build() may run anywhere (browser now, perhaps a server later), so it must be
// async and must not touch the page outside what it is given.
//
// recipeInputs is PUBLIC: it is stored inside the tile for anyone to read.
// A type must only put in it what is safe to publish.

/** Size budget for a tile when its type doesn't set maxBytes. */
export const DEFAULT_MAX_TILE_BYTES = 5 * 1024 * 1024;
/** The most any type may allow (each file is a separate upload; seen accepted up to 25 MB). */
export const MAX_TILE_BYTES_CAP = 60 * 1024 * 1024;

/** The size budget for tiles of this type. */
export function maxBytesFor(type) {
  return type && type.maxBytes != null ? type.maxBytes : DEFAULT_MAX_TILE_BYTES;
}

export const INPUT_KINDS = Object.freeze(["sprite", "choice", "text", "palette", "brush", "range", "seed", "toggle", "action", "tracks", "pages"]);

/** What a page in a "pages" input can show. */
export const PAGE_FIELDS = Object.freeze(["picture", "heading", "words", "subtitle", "piece"]);
/** How a published tile of a type can go on a Zine Scene page (a type's zinePage). */
export const ZINE_PAGE_KINDS = Object.freeze(["live", "tape"]);
/** Picture types a "pages" input keeps (see src/core/pictures.js). */
export const PAGE_PICTURE_TYPES = Object.freeze(["image/webp", "image/jpeg"]);

/** How a song leads into the next one (tracks input): straight on, a short pause, or fade out and in with a pause. */
export const TRANSITIONS = Object.freeze(["straight", "pause", "fade"]);
export const TRACK_TITLE_MAX = 120;

/** 75 -> "1:15" */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? h + ":" : ""}${mm}:${String(r).padStart(2, "0")}`;
}

const HEX = /^#[0-9a-f]{6}$/i;

const ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Throws a readable error if a tile type does not follow the contract. */
export function checkTileType(type) {
  const where = `Tile type ${JSON.stringify(type && type.id)}`;
  if (!type || typeof type !== "object") throw new Error("A tile type must be an object.");
  if (typeof type.id !== "string" || !ID_PATTERN.test(type.id)) throw new Error(`${where}: id must be lowercase-kebab.`);
  if (!Number.isInteger(type.version) || type.version < 1) throw new Error(`${where}: version must be a whole number from 1.`);
  for (const field of ["title", "summary"]) {
    if (typeof type[field] !== "string" || !type[field]) throw new Error(`${where}: missing ${field}.`);
  }
  if (type.reviewSummary !== undefined && typeof type.reviewSummary !== "function") throw new Error(`${where}: reviewSummary must be a function.`);
  if (!Array.isArray(type.inputs)) throw new Error(`${where}: inputs must be an array.`);
  const keys = new Set();
  for (const input of type.inputs) {
    if (!input || typeof input.key !== "string") throw new Error(`${where}: every input needs a key.`);
    if (keys.has(input.key)) throw new Error(`${where}: duplicate input key "${input.key}".`);
    keys.add(input.key);
    if (!INPUT_KINDS.includes(input.kind)) throw new Error(`${where}: input "${input.key}" has unknown kind "${input.kind}".`);
    if (input.kind === "choice" && (!Array.isArray(input.options) || input.options.length === 0)) {
      throw new Error(`${where}: choice input "${input.key}" needs options.`);
    }
    if ((input.kind === "palette" || input.kind === "brush") && (!Array.isArray(input.colors) || input.colors.length === 0 || !input.colors.every((c) => c && HEX.test(c.value)))) {
      throw new Error(`${where}: ${input.kind} input "${input.key}" needs colors, each { value: "#rrggbb" }.`);
    }
    if (input.kind === "range" && !(Number.isFinite(input.min) && Number.isFinite(input.max) && input.min < input.max)) {
      throw new Error(`${where}: range input "${input.key}" needs min and max.`);
    }
    if (input.kind === "action" && (typeof input.button !== "string" || !input.button || typeof type.applyChange !== "function")) {
      throw new Error(`${where}: action input "${input.key}" needs a button label, and the type needs applyChange.`);
    }
    if (input.kind === "tracks") {
      const sides = input.sides === undefined ? ["A"] : input.sides;
      if (!Array.isArray(sides) || !sides.length || !sides.every((x) => typeof x === "string" && x) || new Set(sides).size !== sides.length) {
        throw new Error(`${where}: tracks input "${input.key}" needs sides, a list of different names.`);
      }
      if (input.maxSecondsPerSide !== undefined && !(Number.isFinite(input.maxSecondsPerSide) && input.maxSecondsPerSide > 0)) {
        throw new Error(`${where}: tracks input "${input.key}": maxSecondsPerSide must be a positive number.`);
      }
      if (input.maxTracks !== undefined && !(Number.isInteger(input.maxTracks) && input.maxTracks > 0)) {
        throw new Error(`${where}: tracks input "${input.key}": maxTracks must be a positive whole number.`);
      }
      if (input.picker !== undefined && (!input.picker || typeof input.picker.mount !== "function")) {
        throw new Error(`${where}: tracks input "${input.key}": picker needs mount(element, options).`);
      }
    }
    if (input.kind === "pages") checkPagesInput(where, input);
    if (input.showIf !== undefined && typeof input.showIf !== "function") {
      throw new Error(`${where}: showIf on "${input.key}" must be a function.`);
    }
  }
  const groupIds = new Set((type.groups || []).map((g) => g.id));
  for (const input of type.inputs) {
    if (input.group && !groupIds.has(input.group)) throw new Error(`${where}: input "${input.key}" names an unknown group "${input.group}".`);
  }
  for (const input of type.inputs) {
    if (input.mustBeOn !== undefined && (input.kind !== "toggle" || typeof input.mustBeOn !== "string" || !input.mustBeOn)) {
      throw new Error(`${where}: mustBeOn on "${input.key}" must be a sentence, on a toggle.`);
    }
  }
  if (type.credits !== undefined) {
    const part = (x) => (typeof x === "string" && x) || (x && typeof x.text === "string" && x.text && typeof x.href === "string" && /^(https:\/\/|\/)/.test(x.href));
    if (!Array.isArray(type.credits) || !type.credits.every((c) => Array.isArray(c) && c.length && c.every(part))) {
      throw new Error(`${where}: credits must be a list of credits, each a list of strings and { text, href } links.`);
    }
  }
  if (type.zinePage !== undefined && !ZINE_PAGE_KINDS.includes(type.zinePage)) {
    throw new Error(`${where}: zinePage must be one of ${ZINE_PAGE_KINDS.join(", ")}.`);
  }
  if (type.maxBytes !== undefined && !(Number.isInteger(type.maxBytes) && type.maxBytes > 0 && type.maxBytes <= MAX_TILE_BYTES_CAP)) {
    throw new Error(`${where}: maxBytes must be a whole number of bytes from 1 to ${MAX_TILE_BYTES_CAP}.`);
  }
  if (typeof type.defaults !== "function") throw new Error(`${where}: defaults(context) is missing.`);
  if (typeof type.build !== "function") throw new Error(`${where}: build(inputs) is missing.`);
  for (const hook of ["applyChange", "optionPreviewKey"]) {
    if (type[hook] !== undefined && typeof type[hook] !== "function") throw new Error(`${where}: ${hook} must be a function.`);
  }
  if (type.preview !== undefined && (!type.preview || typeof type.preview.mount !== "function")) {
    throw new Error(`${where}: preview needs mount(element, { values, setValue }).`);
  }
  if (type.optionPreview !== undefined && typeof type.optionPreview !== "function") {
    throw new Error(`${where}: optionPreview must be a function.`);
  }
  const needsDrawing = (i) => i.display === "swatches" && !(i.options || []).every((o) => typeof o.image === "string");
  if (type.inputs.some(needsDrawing) && typeof type.optionPreview !== "function") {
    throw new Error(`${where}: a "swatches" input needs optionPreview(key, value, inputs).`);
  }
  return type;
}

function checkPagesInput(where, input) {
  const name = `${where}: pages input "${input.key}"`;
  if (!Array.isArray(input.pages) || !input.pages.length) throw new Error(`${name} needs pages.`);
  const ids = new Set();
  const layouts = input.layouts || [];
  for (const l of layouts) {
    if (!l || typeof l.value !== "string" || !Array.isArray(l.shows) || !l.shows.every((f) => PAGE_FIELDS.includes(f))) {
      throw new Error(`${name}: each layout needs a value and shows (a list of ${PAGE_FIELDS.join(", ")}).`);
    }
    if (l.labels !== undefined && !(l.labels && typeof l.labels === "object" && Object.entries(l.labels).every(([k, v]) => PAGE_FIELDS.includes(k) && typeof v === "string" && v))) {
      throw new Error(`${name}: layout "${l.value}": labels must name fields (${PAGE_FIELDS.join(", ")}) with text.`);
    }
    if (l.fill !== undefined && l.fill !== "always") throw new Error(`${name}: layout "${l.value}": fill can only be "always".`);
  }
  for (const page of input.pages) {
    if (!page || typeof page.id !== "string" || !page.id || ids.has(page.id)) throw new Error(`${name}: every page needs its own id.`);
    ids.add(page.id);
    if (page.layouts) {
      if (!layouts.length) throw new Error(`${name}: page "${page.id}" uses layouts, but the input has none.`);
    } else if (!Array.isArray(page.fields) || !page.fields.length || !page.fields.every((f) => PAGE_FIELDS.includes(f))) {
      throw new Error(`${name}: page "${page.id}" needs fields (some of ${PAGE_FIELDS.join(", ")}) or layouts: true.`);
    }
  }
  if (input.wordLimit !== undefined && typeof input.wordLimit !== "function") throw new Error(`${name}: wordLimit must be a function.`);
  if (input.wordSize !== undefined && typeof input.wordSize !== "function") throw new Error(`${name}: wordSize must be a function.`);
  if (input.onSelect !== undefined && typeof input.onSelect !== "function") throw new Error(`${name}: onSelect must be a function.`);
  if (input.pictureFrame !== undefined && typeof input.pictureFrame !== "function") throw new Error(`${name}: pictureFrame must be a function.`);
  for (const t of input.pageToggles || []) {
    if (!t || typeof t.key !== "string" || !t.key || typeof t.label !== "string" || PAGE_FIELDS.includes(t.key) || ["id", "layout"].includes(t.key)) {
      throw new Error(`${name}: each page toggle needs its own key and a label.`);
    }
    if (t.unavailable !== undefined && typeof t.unavailable !== "function") throw new Error(`${name}: a page toggle's unavailable must be a function.`);
    for (const f of ["problems", "bytes", "hide"]) {
      if (t[f] !== undefined && typeof t[f] !== "function") throw new Error(`${name}: a page toggle's ${f} must be a function.`);
    }
    if (t.panel !== undefined && !(t.panel && typeof t.panel.mount === "function")) throw new Error(`${name}: a page toggle's panel needs a mount function.`);
  }
  if (input.zoomMax !== undefined && !(Number.isFinite(input.zoomMax) && input.zoomMax >= 1)) throw new Error(`${name}: zoomMax must be a number from 1.`);
  const usesPiece = layouts.some((l) => l.shows.includes("piece")) || input.pages.some((p) => !p.layouts && p.fields.includes("piece"));
  if (usesPiece || input.piece !== undefined) {
    const pc = input.piece;
    if (!(pc && pc.panel && typeof pc.panel.mount === "function")) throw new Error(`${name}: a layout shows "piece", so the input needs piece: { panel } with a mount function.`);
    for (const f of ["problems", "bytes"]) {
      if (pc[f] !== undefined && typeof pc[f] !== "function") throw new Error(`${name}: piece ${f} must be a function.`);
    }
  }
}

/** The layout a page uses ({ value, label, shows, ... }), or null for a page without layouts. */
export function pageLayout(input, page, value) {
  if (!page.layouts) return null;
  const layouts = input.layouts || [];
  return layouts.find((l) => l.value === (value && value.layout)) || layouts[0];
}

/** What one page of a "pages" input shows, given its value (its layout). */
export function pageShows(input, page, value) {
  if (!page.layouts) return page.fields;
  const layouts = input.layouts || [];
  const layout = layouts.find((l) => l.value === (value && value.layout)) || layouts[0];
  return layout.shows;
}

/** How full a page's words make it, in percent (0 when it has no limit). */
export function pageFullness(input, spec, page, values = {}) {
  if (!input.wordLimit) return 0;
  const limit = input.wordLimit(spec, page, values);
  const words = typeof (page && page.words) === "string" ? page.words : "";
  const size = input.wordSize ? input.wordSize(words) : words.length;
  if (!words) return 0;
  return limit > 0 ? Math.ceil((size / limit) * 100) : 999;
}

/** Problems with a "pages" input's value, as plain sentences (empty when all is well). */
export function pageProblems(input, pages, values = {}) {
  if (!Array.isArray(pages) || pages.length !== input.pages.length) return ["The pages are missing."];
  const out = [];
  input.pages.forEach((spec, i) => {
    const p = pages[i];
    const name = spec.label || spec.id;
    if (!p || p.id !== spec.id) {
      out.push(`${name} is out of place.`);
      return;
    }
    if (spec.layouts && !(input.layouts || []).some((l) => l.value === p.layout)) out.push(`${name} has an unknown layout.`);
    const shows = pageShows(input, spec, p);
    const text = (k) => (typeof p[k] === "string" ? p[k] : "");
    if (shows.includes("heading") && input.headingMax && text("heading").length > input.headingMax) {
      out.push(`${name}: the heading is longer than ${input.headingMax} characters.`);
    }
    if (shows.includes("subtitle") && input.subtitleMax && text("subtitle").length > input.subtitleMax) {
      out.push(`${name}: the short line is longer than ${input.subtitleMax} characters.`);
    }
    if (shows.includes("words") && input.wordLimit) {
      const pct = pageFullness(input, spec, p, values);
      if (pct > 100) out.push(`Too many words for ${name.toLowerCase().startsWith("page") ? name.toLowerCase() : "the " + name.toLowerCase()} (about ${pct}% of the room on it). Shorten them${pageShows(input, spec, p).includes("picture") ? ", or pick a layout without a picture" : ""}.`);
    }
    const pic = p.picture;
    if (shows.includes("picture") && pic) {
      const ok = pic.bytes instanceof Uint8Array && pic.bytes.length > 0 && PAGE_PICTURE_TYPES.includes(pic.contentType)
        && Number.isInteger(pic.width) && pic.width > 0 && Number.isInteger(pic.height) && pic.height > 0;
      if (!ok) out.push(`${name}: the picture isn't ready. Choose it again.`);
      const c = pic.crop;
      const inRange = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
      if ((pic.fill !== undefined && typeof pic.fill !== "boolean")
        || (c !== undefined && c !== null && !(inRange(c.x, 0, 1) && inRange(c.y, 0, 1) && inRange(c.zoom, 1, input.zoomMax || 2)))) {
        out.push(`${name}: the picture's crop isn't valid. Choose Fit, then Fill again.`);
      }
    }
    for (const t of input.pageToggles || []) {
      if (p[t.key] && t.problems) for (const m of t.problems(p, spec, values) || []) out.push(m);
    }
    if (shows.includes("piece") && input.piece && input.piece.problems) {
      for (const m of input.piece.problems(p, spec, values) || []) out.push(m);
    }
  });
  return out;
}

/** The bytes a pages input's value adds up to: pictures, plus whatever switched-on page toggles add. */
export function pagesBytes(input, pages) {
  let n = 0;
  (Array.isArray(pages) ? pages : []).forEach((p, i) => {
    if (!p) return;
    const spec = input.pages[i];
    const shows = spec ? pageShows(input, spec, p) : [];
    if (p.picture && p.picture.bytes && (!spec || shows.includes("picture"))) n += p.picture.bytes.length;
    if (shows.includes("piece") && input.piece && input.piece.bytes) n += Number(input.piece.bytes(p)) || 0;
    for (const t of input.pageToggles || []) if (p[t.key] && t.bytes) n += Number(t.bytes(p)) || 0;
  });
  return n;
}

/**
 * Checks the values a user entered against a type's inputs. Returns a list of
 * problems, each { key, message, publishOnly? }. A publishOnly problem (a
 * toggle with mustBeOn that is off) stops publishing but not building.
 */
export function checkInputs(type, values) {
  const problems = [];
  for (const input of type.inputs) {
    if (!isShown(input, values)) continue;
    const v = values[input.key];
    const empty = v == null || (typeof v === "string" && v.trim() === "");
    if (input.required && empty) {
      problems.push({ key: input.key, message: `${input.label || input.key} is required.` });
      continue;
    }
    if (empty && input.kind === "toggle" && input.mustBeOn) problems.push({ key: input.key, message: input.mustBeOn, publishOnly: true });
    if (empty) continue;
    if (input.kind === "choice" && !input.options.some((o) => o.value === v)) {
      problems.push({ key: input.key, message: `${input.label || input.key} has an unknown choice.` });
    }
    if (input.kind === "text" && input.maxLength && v.length > input.maxLength) {
      problems.push({ key: input.key, message: `${input.label || input.key} is longer than ${input.maxLength} characters.` });
    }
    const allowed = (c) => input.colors.some((o) => o.value.toLowerCase() === String(c).toLowerCase());
    if (input.kind === "palette") {
      const min = input.min ?? 1;
      if (!Array.isArray(v) || !v.every(allowed)) problems.push({ key: input.key, message: `${input.label || input.key} has a color that is not offered.` });
      else if (v.length < min) problems.push({ key: input.key, message: `Pick at least ${min} ${min === 1 ? "color" : "colors"}.` });
    }
    if (input.kind === "brush" && !allowed(v)) {
      problems.push({ key: input.key, message: `${input.label || input.key} is not one of the colors offered.` });
    }
    if (input.kind === "range" && !(typeof v === "number" && v >= input.min && v <= input.max)) {
      problems.push({ key: input.key, message: `${input.label || input.key} must be from ${input.min} to ${input.max}.` });
    }
    if (input.kind === "seed" && !Number.isInteger(v)) {
      problems.push({ key: input.key, message: `${input.label || input.key} must be a whole number.` });
    }
    if (input.kind === "toggle" && typeof v !== "boolean") {
      problems.push({ key: input.key, message: `${input.label || input.key} must be on or off.` });
    } else if (input.kind === "toggle" && input.mustBeOn && v !== true) {
      problems.push({ key: input.key, message: input.mustBeOn, publishOnly: true });
    }
    if (input.kind === "tracks") {
      for (const message of trackProblems(input, v)) problems.push({ key: input.key, message });
    }
    if (input.kind === "pages") {
      for (const message of pageProblems(input, v, values)) problems.push({ key: input.key, message });
    }
  }
  return problems;
}

/** Problems with a tracks input's value, as plain sentences (empty when all is well). */
export function trackProblems(input, tracks) {
  if (!Array.isArray(tracks)) return ["The song list is missing."];
  const out = [];
  const sides = input.sides || ["A"];
  if (input.required && tracks.length === 0) out.push("Add at least one song.");
  if (input.maxTracks && tracks.length > input.maxTracks) out.push(`A tile can hold up to ${input.maxTracks} songs.`);
  const ids = new Set();
  let converting = 0;
  for (const t of tracks) {
    if (!t || typeof t.id !== "string" || !t.id || ids.has(t.id)) {
      out.push("Two songs share the same id.");
      break;
    }
    ids.add(t.id);
  }
  for (const t of tracks) {
    if (!t) continue;
    const name = typeof t.title === "string" && t.title.trim() ? `"${t.title.trim()}"` : "A song";
    if (!sides.includes(t.side)) out.push(`${name} is on an unknown side.`);
    if (typeof t.title !== "string" || !t.title.trim()) out.push("Every song needs a title.");
    else if (t.title.length > TRACK_TITLE_MAX) out.push(`${name}'s title is longer than ${TRACK_TITLE_MAX} characters.`);
    if (t.transition !== undefined && !TRANSITIONS.includes(t.transition)) out.push(`${name} has an unknown change to the next song.`);
    if (t.status === "converting") converting++;
    else if (t.status === "error") out.push(`${name} couldn't be converted: ${String(t.error || "unknown problem").replace(/[.\s]+$/, "")}. Remove it or try again.`);
    else if (t.status !== "ready" || !(t.bytes instanceof Uint8Array) || !t.bytes.length) out.push(`${name} isn't ready.`);
    else if (!(Number.isFinite(t.seconds) && t.seconds > 0)) out.push(`${name} has no length.`);
  }
  if (converting) out.unshift(`${converting === 1 ? "1 song is" : converting + " songs are"} still converting.`);
  if (input.maxSecondsPerSide) {
    for (const side of sides) {
      const total = tracks.filter((t) => t && t.side === side).reduce((n, t) => n + (Number(t.seconds) || 0), 0);
      if (total > input.maxSecondsPerSide) {
        out.push(`${sides.length > 1 ? "Side " + side : "The tape"} is ${formatDuration(total)} long; it holds up to ${formatDuration(input.maxSecondsPerSide)}.`);
      }
    }
  }
  return out;
}

/** Whether an input is shown for these values (see showIf). */
export function isShown(input, values) {
  return typeof input.showIf !== "function" || Boolean(input.showIf(values));
}

/**
 * The inputs shown at the Publish step's review, next to the card, instead of
 * while making the tile: those in the "card" group (the link preview card's
 * words) and the confirmations (toggles with mustBeOn). Words that are drawn in
 * the tile itself (a zine's title on its cover, a tape's title on the cassette)
 * belong outside the "card" group, so they're edited with the rest of the tile.
 * Returns a Set of input keys.
 */
export function reviewInputs(type) {
  return new Set((type.inputs || []).filter((i) => i.group === "card" || (i.kind === "toggle" && i.mustBeOn)).map((i) => i.key));
}

/** The problems that stop the tile being built (all but the publish-only ones). */
export function buildProblems(problems) {
  return problems.filter((p) => !p.publishOnly);
}
