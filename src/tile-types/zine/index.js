import { makeZineTile } from "./tile.js";
import {
  PAGES, LAYOUTS, PAPERS, HEADING_MAX, SUBTITLE_MAX, TITLE_MAX, DESCRIPTION_MAX,
  emptyPages, defaultPaper, wordLimit, wordSize, madeLabel, fillFrame, FILL_ZOOM_MAX, usableSprite, showsOf,
} from "./pages.js";
import { LOOK_OPTIONS, INK_OPTIONS, DEFAULT_LOOK, DEFAULT_INK } from "./looks.js";
import { soundProblems, soundBytes } from "./sound.js";
import { pieceProblems, pieceBytes } from "./piece.js";

const BASE = (import.meta.env && import.meta.env.BASE_URL) || "/";

// Tile type: Zine Scene.
// A little zine, the classic 8-page mini-zine (cover, pages 1 to 6, back),
// made in the Foundry and kept in the creator's own repo. Each page has a
// picture and words; the reader inside the tile shows the cover, one page at a
// time, or a two-page spread, whichever suits the space the host gives.
// Looks (stage 2): Clean, Photocopy, Collage and Riso (with six ink pairs).
// Sounds (stage 3): a short clip from one of your plyr.fm songs on any page;
// pictures and sounds load page by page as the zine is read.
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
  summary: "Make a little zine: eight pages of pictures, words, and more.",
  maxBytes: 20 * 1024 * 1024,
  credits: [
    ["Sprites from ", { text: "rpg.actor", href: "https://rpg.actor/" }, ". Songs from ", { text: "plyr.fm", href: "https://plyr.fm/" }, "."],
    [
      "MP3 encoding by ",
      { text: "lamejs", href: "https://github.com/zhuker/lamejs" },
      ", a port of ",
      { text: "LAME", href: "https://lame.sourceforge.io/" },
      ", unmodified under the ",
      { text: "LGPL", href: "https://www.gnu.org/licenses/lgpl-3.0.html" },
      " (",
      { text: "details", href: `${BASE}vendor/lamejs/README.txt` },
      ").",
    ],
  ],
  buildDelayMs: 400,

  // For the Publish step's review, next to the size: "8 pages · 3 pictures · 1 web tile · 2 sounds".
  reviewSummary(values) {
    const pages = (values && values.pages) || [];
    const count = (fn) => PAGES.filter((spec, i) => pages[i] && fn(pages[i], showsOf(spec, pages[i]))).length;
    const of = (n, one) => (n ? `${n} ${one}${n === 1 ? "" : "s"}` : "");
    return [
      `${PAGES.length} pages`,
      of(count((p, shows) => p.picture && shows.includes("picture")), "picture"),
      of(count((p, shows) => p.layout === "tile" && p.piece && shows.includes("piece")), "web tile"),
      of(count((p, shows) => p.layout === "tape" && p.piece && shows.includes("piece")), "mixtape"),
      of(count((p) => p.sound && p.clip), "sound"),
    ].filter(Boolean).join(" · ");
  },

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
      sizeLabel: "Pictures, sounds and tiles",
      // "A tile" pages: one of your published tiles, copied in and run on the page.
      piece: {
        panel: {
          async mount(element, api) {
            const { mountTilePanel } = await import("./tilepanel.js");
            return mountTilePanel(element, api);
          },
        },
        problems: (page, spec) => pieceProblems(page, spec),
        bytes: pieceBytes,
      },
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
        {
          key: "sound",
          label: "Add a sound",
          help: "Up to a minute of one of your plyr.fm songs, on a band near the bottom of the page. Readers tap to play it; it plays on as they turn the pages.",
          panel: {
            async mount(element, api) {
              const { mountSoundPanel } = await import("./soundpanel.js");
              return mountSoundPanel(element, api);
            },
          },
          problems: (page, spec) => soundProblems(page, spec),
          bytes: soundBytes,
          // On a tape page the sound is the tape's own taste, set in the tape's panel.
          hide: (page) => Boolean(page && page.layout === "tape"),
        },
      ],
      onSelect: (id) => selectListeners.forEach((fn) => fn(id)),
    },
    {
      key: "soundRights",
      kind: "toggle",
      label: "These are my plyr.fm uploads, and I'm happy to publish clips of them in this zine.",
      help: "A copy of each clip goes into the zine in your account, and stays there even if you later delete the song from plyr.fm.",
      mustBeOn: "Confirm that the sounds are from your own plyr.fm uploads before publishing.",
      showIf: (v) => (v.pages || []).some((p) => p && p.sound),
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
      soundRights: false,
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
