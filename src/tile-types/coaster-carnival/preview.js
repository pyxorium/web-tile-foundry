import { mountCoaster } from "./ride/mount.js";
import { trackFor, choicesOf, usableSprite, trackInput } from "./panel.js";
import { imageFromBytes } from "./art.js";
import { pictureUrl, DEFAULT_SPRITE_FILE } from "./pictures.js";

// The live preview in the Foundry: the same ride the tile runs (ride/mount.js),
// updated straight from the panel's values. A tap on the preview rides it (the
// test ride). Tapping the theme chip in the preview also changes the panel's
// Starting theme; the view chip changes only the preview.
//
// A new track takes a moment to make (up to about a second for big rides
// with a switch), so while a slider is being dragged it waits until the
// slider rests before making it.

const TRACK_WAIT = 300; // ms after the last track change before making the new track

export function mountPreview(element, { values, setValue }) {
  let current = values;
  let theme = values.theme;
  let trackKey = JSON.stringify(trackInput(values));
  let riderKey = null;
  let timer = null;
  let disposed = false;

  // Keys go to the preview only when it has focus, so typing in the panel never starts a ride.
  element.tabIndex = 0;
  element.setAttribute("aria-label", "Live preview of your coaster. Press Space or Enter to take a test ride.");

  const c = choicesOf(values);
  const coaster = mountCoaster(element, {
    track: trackFor(values),
    theme: c.theme,
    style: c.style,
    colors: c.colors,
    tunnel: c.tunnel,
    handle: c.handle,
    makeUrl: null,
    keyTarget: element,
    onTheme: (id) => {
      theme = id;
      if (current.theme !== id) setValue("theme", id);
    },
  });

  async function showRider(v) {
    const sprite = usableSprite(v);
    const key = sprite ? sprite.cid : "default";
    if (key === riderKey) return;
    riderKey = key;
    try {
      const image = sprite ? await imageFromBytes(sprite.bytes) : await loadImage(pictureUrl(DEFAULT_SPRITE_FILE));
      if (!disposed && riderKey === key) coaster.setRider(image);
    } catch (e) {
      console.warn("[coaster preview] The rider picture could not be shown.", e);
    }
  }
  showRider(values);

  return {
    update(next) {
      current = next;
      const nc = choicesOf(next);
      if (nc.theme !== theme) {
        theme = nc.theme;
        coaster.setTheme(nc.theme);
      }
      coaster.setStyle(nc.style);
      coaster.setColors(nc.colors);
      coaster.setTunnel(nc.tunnel);
      showRider(next);
      const key = JSON.stringify(trackInput(next));
      if (key !== trackKey) {
        trackKey = key;
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (disposed) return;
          coaster.setTrack(trackFor(current));
        }, TRACK_WAIT);
      }
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      coaster.dispose();
    },
  };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`No picture at ${url}`));
    image.src = url;
  });
}
