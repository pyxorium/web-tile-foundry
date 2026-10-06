import { makeFile } from "../../core/fileset.js";
import { rawCid } from "../../core/cid.js";
import { scanMp3, isTapeFormat, describeFormat, joinMp3, cutSilence } from "../../core/audio/mp3.js";
import { shapeFor, sameFades, fadesOf, TIMING } from "./transitions.js";
import { makeTape, tapeJson, trackPath, TAPE_PATH } from "./tape.js";
import { mixtapeConfig, renderMixtapeHtml } from "./runtime/template.js";
import { RUNTIME_PATH } from "./runtime/paths.js";

// Puts a Mixtape tile together from finished parts. Kept apart from the tile
// type (index.js, stage 4) so the tests can run it in Node: the converted
// songs, the silence, the program text (`runtime`) and the card pictures
// (`art`) are handed in.
//
//   name, description  the card's title and description (the title is also the tape's)
//   tape     { artist?, madeBy?, dedication?, notes?, label?: { text }, describe? }
//   sides    the side names in order, e.g. ["A", "B"]
//   tracks   the song list (the tracks input's value), in order: each
//            { id, title, artist?, album?, year?, side, transition?, source?,
//              bytes (the converted song), fades? ({ fadeIn, fadeOut } it was
//              converted with; checked against its place on the tape) }
//   silence  a silent MP3 in the tape format, at least as long as the longest
//            pause (makeSilence in src/core/audio/convert.js)
//   recipe   the panel's choices for /foundry.json
//   runtime  the text of /mixtape.js (see runtime/bundle.js)
//   art      { icon, banner }: PNG bytes, or null while editing
//
// Each song becomes one file, /tracks/a1.mp3 and so on, with the silence
// after it baked in, so the files join into one continuous side (Tileman) and
// sound the same in every player.

export async function makeMixtapeTile({ name, description = "", tape = {}, sides = ["A"], tracks, silence = null, recipe = {}, runtime, art = null }) {
  if (typeof runtime !== "string" || !runtime) throw new Error("The tape's player (/mixtape.js) is missing.");
  if (!Array.isArray(tracks) || !tracks.length) throw new Error("The tape has no songs.");
  const title = String(name || "").trim();

  const files = [];
  const tapeSides = [];
  const recipeTracks = [];
  for (const [sideIndex, side] of sides.entries()) {
    const list = tracks.filter((t) => t.side === side);
    const out = [];
    for (const [i, t] of list.entries()) {
      const label = `"${String(t.title || "").trim() || "A song"}"`;
      if (!(t.bytes instanceof Uint8Array) || !t.bytes.length) throw new Error(`${label} isn't converted yet.`);
      const shape = shapeFor(list, i);
      if (t.fades && !sameFades(t.fades, fadesOf(shape))) throw new Error(`${label} needs converting again for its new place on the tape.`);
      const scan = scanMp3(t.bytes);
      if (!isTapeFormat(scan)) throw new Error(`${label} is ${describeFormat(scan)}, not the tape format.`);
      let parts = [t.bytes];
      if (shape.pause > 0) {
        if (!silence) throw new Error("The silence between songs is missing.");
        parts.push(cutSilence(silence, shape.pause));
      }
      const joined = joinMp3(parts);
      const path = trackPath(side, sideIndex, i + 1);
      const file = makeFile(path, joined.bytes);
      files.push(file);
      out.push({
        path,
        cid: await rawCid(file.bytes),
        title: t.title,
        artist: t.artist,
        album: t.album,
        year: t.year,
        duration: joined.total,
        source: t.source,
        transition: transitionRecord(shape),
      });
      recipeTracks.push({
        side,
        title: String(t.title || "").trim(),
        seconds: Math.round(scan.seconds * 100) / 100,
        then: shape.into,
        source: t.source && t.source.record ? t.source.record : null,
      });
    }
    tapeSides.push({ name: side, tracks: out });
  }

  const tapeObj = makeTape({ ...tape, title, sides: tapeSides });
  const config = mixtapeConfig({ tape: tapeObj, artwork: art ? "/icon.png" : null });
  const html = renderMixtapeHtml({ title, config });
  files.unshift(makeFile("/", html), makeFile(RUNTIME_PATH, runtime), makeFile(TAPE_PATH, tapeJson(tapeObj)));
  if (art) files.push(makeFile("/icon.png", art.icon), makeFile("/banner.png", art.banner));

  return {
    name: title,
    description: String(description || "").trim(),
    files,
    tape: tapeObj,
    icons: art ? [{ src: "/icon.png" }] : [],
    screenshots: art ? [{ src: "/banner.png" }] : [],
    recipeInputs: {
      panel: recipe,
      sides: tapeObj.sides.map((s) => s.name),
      tracks: recipeTracks,
      timing: TIMING,
    },
  };
}

/** How a song leads into the next, as written in tape.json (already in the audio, so players do nothing). */
function transitionRecord(shape) {
  if (!shape.into) return undefined;
  const rec = { kind: shape.into };
  if (shape.fadeOut) rec.fadeOut = shape.fadeOut;
  if (shape.pause) rec.pause = shape.pause;
  if (shape.into === "fade") rec.fadeIn = TIMING.fade.fadeIn;
  rec.baked = true;
  return rec;
}
