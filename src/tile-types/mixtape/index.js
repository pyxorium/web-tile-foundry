import { makeMixtapeTile } from "./tile.js";
import { shapesFor } from "./transitions.js";
import {
  SIDES, NAME_MAX, DESCRIPTION_MAX, LABEL_MAX, DEDICATION_MAX, NOTES_MAX, WORDS_MAX, MAX_TRACKS,
  panelDefaults, applyPanelChange, tapeDetails, panelRecipe,
} from "./panel.js";
import { SIDE_SECONDS } from "./workshop.js";
import { KITS } from "./kits.js";

// Tile type: Mixtape.
// The creator's own plyr.fm songs on a cassette, Side A and Side B, with the
// changes between songs baked into the audio. The song picker lives in
// picker.js, the song list's rules in workshop.js and panel.js, the tile's
// files in tile.js and tape.js, the player in runtime/, the preview in
// preview.js, the cassette looks in kits.js and the card pictures in art.js.

const BASE = (import.meta.env && import.meta.env.BASE_URL) || "/";

/** The player every tape carries (/mixtape.js), bundled by the Foundry's build (vite.config.js). */
async function loadRuntime() {
  const mod = await import("virtual:mixtape-runtime");
  return mod.default;
}

const picker = {
  mount: async (element, options) => (await import("./picker.js")).mountPicker(element, { ...options, sides: SIDES, maxTracks: MAX_TRACKS }),
};

export const mixtape = {
  id: "mixtape",
  version: 1,
  title: "Mixtape C60",
  summary: "Your plyr.fm songs on a cassette, Side A and Side B.",
  maxBytes: 50 * 1024 * 1024,

  credits: [
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

  inputs: [
    {
      key: "tracks",
      kind: "tracks",
      label: "Songs",
      help: "Pick songs from your plyr.fm uploads. Each side of the cassette can hold 30 minutes. \"Then\" is how a song leads into the next: straight on keeps a segue from a show; a pause or fade suits songs from different recordings.",
      required: true,
      sides: SIDES,
      maxSecondsPerSide: SIDE_SECONDS,
      maxTracks: MAX_TRACKS,
      transitions: true,
      picker,
    },
    {
      key: "kit",
      kind: "choice",
      label: "Shell color",
      required: true,
      options: KITS.map((k) => ({ value: k.id, label: k.label, color: k.shell })),
      group: "tape",
    },
    { key: "label", kind: "text", label: "Label (optional)", help: "Handwritten on the cassette, like JAM CRUISE '26. Without one, the cassette shows the tape's title.", maxLength: LABEL_MAX, group: "tape" },
    { key: "dedication", kind: "text", label: "Dedication (optional)", help: "Like \"For Sam, summer 2026\".", maxLength: DEDICATION_MAX, group: "tape" },
    { key: "notes", kind: "text", label: "Liner notes (J-card, optional)", multiline: true, maxLength: NOTES_MAX, group: "tape" },
    { key: "addShows", kind: "action", button: "Add the shows to the notes", disabledIf: (v) => !(v.tracks && v.tracks.some((t) => t.album)), group: "tape" },
    { key: "genres", kind: "text", label: "Genres", help: "Words separated by commas, like funk, soul.", maxLength: WORDS_MAX, group: "words" },
    { key: "moods", kind: "text", label: "Moods", help: "Like mellow, upbeat.", maxLength: WORDS_MAX, group: "words" },
    { key: "tags", kind: "text", label: "Tags", help: "Anything else, like live, road trip.", maxLength: WORDS_MAX, group: "words" },
    { key: "name", kind: "text", label: "Tape title", help: "Also the title of the link preview card.", required: true, maxLength: NAME_MAX, group: "card" },
    { key: "description", kind: "text", label: "Description (optional)", maxLength: DESCRIPTION_MAX, multiline: true, group: "card" },
    {
      key: "confirm",
      kind: "toggle",
      label: "These are my plyr.fm uploads, and I'm happy to publish them in a tile.",
      help: "A copy of each song goes into the tile in your account, and stays there even if you later delete it from plyr.fm.",
      mustBeOn: "Tick this to publish your tape.",
    },
  ],

  groups: [
    { id: "tape", title: "On the cassette" },
    { id: "words", title: "Genres, moods and tags (optional)", collapsed: true },
    { id: "card", title: "Title, and the link preview card" },
  ],

  defaults(context = {}) {
    return panelDefaults(context);
  },

  applyChange: applyPanelChange,

  preview: {
    needsResult: true,
    mount: async (element, options) => (await import("./preview.js")).mountPreview(element, options),
    caption: () => "Your tape as listeners will hear it. Your songs and Side A/B choices show up here, so keep mixing and playing until you're happy with it.",
  },

  // Each build joins and fingerprints every song (tens of MB), so it waits a little longer.
  buildDelayMs: 700,

  // The card pictures are drawn for the final build (Publish, and the debug
  // views), not on every change.
  async build(values, { final = true } = {}) {
    const runtime = await loadRuntime();
    const tracks = values.tracks || [];
    const needsSilence = [...shapesFor(tracks, SIDES).values()].some((s) => s.pause > 0);
    let silence = null;
    if (needsSilence) {
      const [{ makeSilence }, { sharedPool }] = await Promise.all([import("../../core/audio/convert.js"), import("./shared.js")]);
      silence = await makeSilence(10, { pool: sharedPool() });
    }
    return makeMixtapeTile({
      name: values.name,
      description: values.description,
      tape: tapeDetails(values),
      sides: SIDES,
      tracks,
      silence,
      recipe: panelRecipe(values),
      runtime,
      drawArt: final ? async (tape) => (await import("./art.js")).makeCardArt({ tape, kit: values.kit }) : null,
    });
  },
};
