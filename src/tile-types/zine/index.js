import { makeZineTile } from "./tile.js";
import {
  PAGES, LAYOUTS, PAPERS, HEADING_MAX, SUBTITLE_MAX, TITLE_MAX, DESCRIPTION_MAX,
  emptyPages, defaultPaper, wordLimit, wordSize, madeLabel, fillFrame, FILL_ZOOM_MAX, usableSprite,
} from "./pages.js";
import { LOOK_OPTIONS, INK_OPTIONS, DEFAULT_LOOK, DEFAULT_INK } from "./looks.js";

// Tile type: Zine Scene.
// A little zine, the classic 8-page mini-zine (cover, pages 1 to 6, back),
// made in the Foundry and kept in the creator's own repo. Each page has a
// picture and words; the reader inside the tile shows the cover, one page at a
// time, or a two-page spread, whichever suits the space the host gives.
// Looks (stage 2): Clean, Photocopy, Collage and Riso (with six ink pairs).
// Plan and decisions: claude/zine-maker-plan.md.

// Opening a page in the editor turns the preview to it.
const selectListeners = new Set();
function onSelect(fn) {
  selectListeners.add(fn);
  return () => selectListeners.delete(fn);
}

export const zine = {
  id: "zine",
  version: 1,
  title: "Zine Scene",
  summary: "Make a little zine: eight pages of pictures and words.",
  maxBytes: 10 * 1024 * 1024,
  credits: [["Sprites from ", { text: "rpg.actor", href: "https://rpg.actor/" }, "."]],
  buildDelayMs: 400,

  inputs: [
    {
      key: "name",
      kind: "text",
      label: "Title",
      help: "Big on the cover, and the tile's name.",
      required: true,
      maxLength: TITLE_MAX,
    },
    {
      key: "paper",
      kind: "choice",
      label: "Paper",
      help: "Sets the shape of the pages, on screen and when printed.",
      required: true,
      options: PAPERS,
    },
    {
      key: "look",
      kind: "choice",
      display: "swatches",
      smooth: true,
      label: "Look",
      help: "How the whole zine is printed. Your pictures stay as they are; the look is applied as the zine is shown.",
      options: LOOK_OPTIONS,
    },
    {
      key: "ink",
      kind: "choice",
      display: "swatches",
      smooth: true,
      label: "Inks",
      help: "Riso prints with two inks: the first for words and dark parts, the second for color.",
      options: INK_OPTIONS,
      showIf: (v) => v.look === "riso",
    },
    {
      key: "pages",
      kind: "pages",
      label: "Pages",
      help: "Pick a page to fill it in. Pictures are made smaller on your computer before they're added.",
      pages: PAGES,
      layouts: LAYOUTS,
      headingMax: HEADING_MAX,
      subtitleMax: SUBTITLE_MAX,
      wordLimit,
      wordSize,
      // The shape a picture fills on a page (edge to edge on the cover and on picture-only pages).
      pictureFrame: (spec, page, values) => fillFrame(spec, { ...page, picture: { ...(page.picture || {}), fill: true } }, values),
      zoomMax: FILL_ZOOM_MAX,
      pageToggles: [
        {
          key: "sprite",
          label: "Add my sprite",
          help: "Your rpg.actor sprite walks along the bottom of this page. Readers can tap it to wave.",
          unavailable(values, context) {
            if (usableSprite(values.sprite)) return null;
            const own = (context && context.ownSprite) || {};
            if (own.state === "loading") return "Looking for your rpg.actor sprite…";
            if (own.state === "error") return "Your rpg.actor sprite couldn't be loaded, so it can't be added just now.";
            return "Your account has no rpg.actor sprite yet. Make one at rpg.actor to add it here.";
          },
        },
      ],
      onSelect: (id) => selectListeners.forEach((fn) => fn(id)),
    },
    {
      key: "description",
      kind: "text",
      label: "Description (optional)",
      help: "Leave it empty to use: “Title”, a little zine by @you, eight pages to flip through.",
      maxLength: DESCRIPTION_MAX,
      multiline: true,
      group: "card",
    },
  ],
  groups: [{ id: "card", title: "For display in the link preview card" }],

  defaults(context = {}) {
    return {
      name: context.handle ? `@${context.handle}'s zine` : "My zine",
      paper: defaultPaper(),
      look: DEFAULT_LOOK,
      ink: DEFAULT_INK,
      pages: emptyPages(),
      description: "",
      handle: context.handle || "",
      sprite: null,
    };
  },

  preview: {
    async mount(element, { values, setValue }) {
      const { mountZinePreview } = await import("./preview.js");
      return mountZinePreview(element, { values, setValue, onSelect });
    },
    caption: () => "Live preview. Turn the pages with the arrows; it opens the page you're editing.",
  },

  async build(inputs, { final } = {}) {
    // The card pictures are drawn only for the final build (Publish, and the
    // debug views); while editing, the preview shows the pages themselves.
    let art = null;
    if (final) {
      const { drawZineArt } = await import("./art.js");
      art = await drawZineArt(inputs);
    }
    return makeZineTile({
      name: inputs.name,
      description: inputs.description,
      handle: inputs.handle,
      paper: inputs.paper,
      look: inputs.look,
      ink: inputs.ink,
      pages: inputs.pages,
      sprite: inputs.sprite,
      made: madeLabel(),
      art,
    });
  },
};
