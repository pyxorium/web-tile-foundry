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
//               action   a button (`button`, its label). Pressing it calls
//                        applyChange(key, true, values), which does the work;
//                        nothing is kept under the key. disabledIf(values), optional,
//                        dims the button when there is nothing to do.
//             showIf(values): OPTIONAL; the input is shown (and checked) only when it returns true.
//             Inputs with the same `group` are shown together under that group's title.
//   groups    array    OPTIONAL: [{ id, title, collapsed? }] titles for grouped inputs;
//                      collapsed: true starts the group closed (click its title to open).
//   applyChange(key, value, values)   OPTIONAL
//                      -> { values, confirm? }: the values after the user changes one
//                         input, for types where one change affects others (for example
//                         a new style resetting colors). With `confirm` (a question),
//                         the core asks first and changes nothing if the answer is no.
//   optionPreviewKey(key, values)     OPTIONAL
//                      -> string: swatch pictures for input `key` are redrawn when it
//                         changes (without it, when the sprite changes).
//   preview            OPTIONAL: a live preview run in the Foundry page instead of the
//                      built tile in a frame: { mount(element, { values, setValue })
//                      -> { update(values), dispose() }, caption?(values) }.
//                      `setValue(key, value)` changes a value as if the user had.
//   buildDelayMs       OPTIONAL: how long to wait after the last change before
//                      rebuilding the tile (default 250).
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

export const INPUT_KINDS = Object.freeze(["sprite", "choice", "text", "palette", "brush", "range", "seed", "toggle", "action"]);

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
    if (input.showIf !== undefined && typeof input.showIf !== "function") {
      throw new Error(`${where}: showIf on "${input.key}" must be a function.`);
    }
  }
  const groupIds = new Set((type.groups || []).map((g) => g.id));
  for (const input of type.inputs) {
    if (input.group && !groupIds.has(input.group)) throw new Error(`${where}: input "${input.key}" names an unknown group "${input.group}".`);
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

/** Checks the values a user entered against a type's inputs. Returns a list of problems. */
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
    }
  }
  return problems;
}

/** Whether an input is shown for these values (see showIf). */
export function isShown(input, values) {
  return typeof input.showIf !== "function" || Boolean(input.showIf(values));
}
