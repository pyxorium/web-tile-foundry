import { formatDuration } from "../../core/contract.js";
import { makeMixtapeTile } from "./tile.js";
import { shapesFor } from "./transitions.js";
import {
  SIDES, NAME_MAX, DESCRIPTION_MAX, LABEL_MAX, DEDICATION_MAX, NOTES_MAX, WORDS_MAX, MAX_TRACKS,
  LENGTHS, lengthById, sideSecondsOf, panelDefaults, applyPanelChange, tapeDetails, panelRecipe,
} from "./panel.js";
import { KITS } from "./kits.js";
import { hasArchiveSongs } from "./workshop.js";

// Tile type: Mixtape Burndown (the card's name since v0.34.0; the type id stays "mixtape").
// The name: the bonfire at the end of a festival night, each side's minutes
// counting down to a full tape, and burning a mix for a friend.
// The creator's own songs (plyr.fm uploads and, since v0.36.0, songs imported
// from Live Music Archive recordings, tracks.js) on a cassette, Side A and Side B, with the
// changes between songs baked into the audio. Three tape lengths (v0.33.0):
// C60, C90 and C120, 30, 45 or 60 minutes a side (panel.js LENGTHS). The song picker lives in
// picker.js, the song list's rules in workshop.js and panel.js, the tile's
// files in tile.js and tape.js, the player in runtime/, the preview in
// preview.js, the cassette looks in kits.js and the card pictures in art.js.

const BASE = (import.meta.env && import.meta.env.BASE_URL) || "/";

/** The player every tape carries (built into its page), bundled by the Foundry's build (vite.config.js). */
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
  title: "Mixtape Burndown",
  summary: "Your songs on a cassette, Side A and Side B: a C60, C90 or C120.",
  // On a Zine Scene page a tape shows as its J-card, with a link to the real tape.
  zinePage: "tape",
  // A full C120 is about 86 MB of songs (96 kbps); each song is still its own upload.
  maxBytes: 90 * 1024 * 1024,

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
      key: "tapeLength",
      kind: "choice",
      label: "Tape length",
      help: "A C60 holds 30 minutes a side, a C90 45 and a C120 a whole hour. Longer tapes are bigger to publish and to save in Tileman.",
      required: true,
      options: LENGTHS.map((l) => ({ value: l.id, label: l.id })),
    },
    {
      key: "tracks",
      kind: "tracks",
      label: "Songs",
      help: "Choose songs from your uploads; the window shows how much tape each side has left to burn. Each side holds as long as the tape length allows. \"Then\" is how a song leads into the next: straight on keeps a segue from a show; a pause or fade suits songs from different recordings.",
      required: true,
      sides: SIDES,
      maxSecondsPerSide: sideSecondsOf,
      maxTracks: MAX_TRACKS,
      transitions: true,
      picker,
    },
    // On the cassette and the J-card, so it's edited with the tape (not at the Publish step's review).
    { key: "name", kind: "text", label: "Tape title", help: "On the cassette and the J-card, and the title of the link preview card.", required: true, maxLength: NAME_MAX, group: "tape" },
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
    { key: "description", kind: "text", label: "Description (optional)", maxLength: DESCRIPTION_MAX, multiline: true, group: "card" },
    // One confirmation, its words following the songs (R3b-20): plyr.fm songs
    // only, or (V2-6) the broader words once any imported Archive song is on
    // the tape. panel.js unticks it when the words change.
    {
      key: "confirm",
      kind: "toggle",
      label: "These are my plyr.fm uploads, and I'm happy to publish them in a tile.",
      help: "A copy of each song goes into the tape, in your account.",
      mustBeOn: "Tick this to publish your tape.",
      showIf: (v) => !hasArchiveSongs(v.tracks),
    },
    {
      key: "confirmShared",
      kind: "toggle",
      label: "These songs are my own uploads or recordings, or come from artists who allow non-commercial sharing (such as the Live Music Archive), and this tape is free to listen to.",
      help: "A copy of each song goes into the tape, in your account.",
      mustBeOn: "Tick this to publish your tape.",
      showIf: (v) => hasArchiveSongs(v.tracks),
    },
  ],

  groups: [
    { id: "tape", title: "On the cassette" },
    { id: "words", title: "Genres, moods and tags (optional)", collapsed: true },
    { id: "card", title: "For display in the link preview card" },
  ],

  // For the Publish step's review, next to the size: "C90 · 14 songs · Side A 41:10 · Side B 43:45".
  reviewSummary(values) {
    const tracks = (values && values.tracks) || [];
    const sides = SIDES.map((side) => {
      const secs = tracks.filter((t) => t.side === side).reduce((n, t) => n + (t.seconds || 0), 0);
      return secs ? `Side ${side} ${formatDuration(secs)}` : "";
    });
    return [lengthById(values && values.tapeLength).id, `${tracks.length} song${tracks.length === 1 ? "" : "s"}`, ...sides].filter(Boolean).join(" · ");
  },

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
