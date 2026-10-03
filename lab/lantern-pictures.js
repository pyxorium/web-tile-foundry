import { getShape } from "../src/tile-types/glass-lantern/geometry/index.js";
import { makeSwatch } from "../src/tile-types/glass-lantern/art.js";
import { shapeChoiceFor, GEM_DEFAULT_SEED, GEM_DEFAULT_FACETS } from "../src/tile-types/glass-lantern/panel.js";
import {
  SHAPE_PICTURE_IDS, STYLE_PICTURE_IDS, shapePictureFile, stylePictureFile, shapePictureLook, shapePictureColors, stylePicture,
} from "../src/tile-types/glass-lantern/pictures.js";

// Glass Lantern picture maker (development only, never part of the live site).
// Run `npm run dev`, open /lab/lantern-pictures.html, and save each picture
// into public/glass-lantern/ under the name shown.

const grid = document.getElementById("grid");
const status = document.getElementById("status");
window.pictures = {}; // file name -> data URL (for automated saving)

async function show(file, bytes) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  const reader = new FileReader();
  window.pictures[file] = await new Promise((resolve) => {
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(new Blob([bytes], { type: "image/png" }));
  });
  const fig = document.createElement("figure");
  fig.innerHTML = `<img alt="" src="${url}"><figcaption><span>${file}</span><a download="${file}" href="${url}">Save</a></figcaption>`;
  grid.append(fig);
}

const values = { gemSeed: GEM_DEFAULT_SEED, gemFacets: GEM_DEFAULT_FACETS };
for (const id of SHAPE_PICTURE_IDS) {
  const shape = getShape(shapeChoiceFor({ ...values, shape: id }));
  await show(shapePictureFile(id), await makeSwatch({ shape, look: shapePictureLook(), colors: shapePictureColors(shape) }));
}
const d6 = getShape({ group: "classic", id: "d6" });
for (const id of STYLE_PICTURE_IDS) {
  await show(stylePictureFile(id), await makeSwatch({ shape: d6, ...stylePicture(id, d6) }));
}
status.textContent = "Done.";
window.picturesDone = true;
