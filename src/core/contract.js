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
//               { key, kind, label, help?, required?, options?, maxLength?, multiline?, display? }
//             kind is one of INPUT_KINDS below. The core renders the form from these.
//             A "choice" with display: "swatches" is shown as a grid of pictures,
//             drawn by optionPreview (below). Inputs with the same `group` are
//             shown together under that group's title.
//   groups    array    OPTIONAL: [{ id, title }] titles for grouped inputs.
//   defaults(context)  -> object of starting input values. `context` may carry
//                         { handle } once sign-in exists.
//   optionPreview(key, value, inputs)   OPTIONAL
//                      -> Promise of PNG bytes (or null): the picture for one
//                         option of a "swatches" input, given the other inputs.
//   build(inputs)      -> Promise of:
//               { name, description,
//                 files: [makeFile(...)],          must include "/" (the HTML page)
//                 icons?: [{ src: "/icon.png" }],  card icon(s), paths must be in files
//                 screenshots?: [{ src: "/banner.png" }],  card banner(s)
//                 recipeInputs: { ... } }           what to record in /foundry.json
//
// build() may run anywhere (browser now, perhaps a server later), so it must be
// async and must not touch the page outside what it is given.
//
// recipeInputs is PUBLIC: it is stored inside the tile for anyone to read.
// A type must only put in it what is safe to publish.

export const INPUT_KINDS = Object.freeze(["sprite", "choice", "text"]);

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
  }
  const groupIds = new Set((type.groups || []).map((g) => g.id));
  for (const input of type.inputs) {
    if (input.group && !groupIds.has(input.group)) throw new Error(`${where}: input "${input.key}" names an unknown group "${input.group}".`);
  }
  if (typeof type.defaults !== "function") throw new Error(`${where}: defaults(context) is missing.`);
  if (typeof type.build !== "function") throw new Error(`${where}: build(inputs) is missing.`);
  if (type.optionPreview !== undefined && typeof type.optionPreview !== "function") {
    throw new Error(`${where}: optionPreview must be a function.`);
  }
  if (type.inputs.some((i) => i.display === "swatches") && typeof type.optionPreview !== "function") {
    throw new Error(`${where}: a "swatches" input needs optionPreview(key, value, inputs).`);
  }
  return type;
}

/** Checks the values a user entered against a type's inputs. Returns a list of problems. */
export function checkInputs(type, values) {
  const problems = [];
  for (const input of type.inputs) {
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
  }
  return problems;
}
