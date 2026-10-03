import { useEffect, useRef, useState } from "react";
import { toMemoryTile, LOAD_DOMAIN } from "../core/loader-tile.js";

// Runs the tile through the REAL tile loader: the page's TileMothership talks
// to the tile server at LOAD_DOMAIN, which provides the runtime, service worker
// and sandbox, exactly as on webtil.es or the blog. The tile's files come from
// memory, so nothing is published. Follows the die demos' die-demo.js and
// dev-entry.js, and the blog's WebTile.astro.

export { LOAD_DOMAIN };
const HEIGHT = 360;

// One shared mothership for the whole page: two would each react to the
// other's messages (lesson from the die demos).
let loaderPromise = null;
let counter = 0;

function getLoader() {
  if (!loaderPromise) {
    loaderPromise = (async () => {
      const [{ TileMothership }, { MemoryTileLoader }] = await Promise.all([
        import("@dasl/tile-loader"),
        import("@dasl/tile-loader/memory"),
      ]);
      const mothership = new TileMothership({ loadDomain: LOAD_DOMAIN });
      mothership.init();
      const memory = new MemoryTileLoader();
      mothership.addLoader(memory);
      return { mothership, memory };
    })().catch((err) => {
      loaderPromise = null; // allow a retry
      throw err;
    });
  }
  return loaderPromise;
}

export function RealLoaderPreview({ result }) {
  const mountRef = useRef(null);
  const [status, setStatus] = useState({ state: "idle" });
  const [loadedFrom, setLoadedFrom] = useState(null);

  // Mark the loaded copy as out of date when the tile changes.
  const stale = loadedFrom !== null && loadedFrom !== result;

  async function load() {
    setStatus({ state: "loading" });
    try {
      const { mothership, memory } = await getLoader();
      // A fresh name every time, so a changed tile is never served from an old entry.
      const name = `foundry-${++counter}`;
      memory.addTile(name, toMemoryTile(result));
      const tile = await mothership.loadTile(`memory://${name}`);
      if (!tile) throw new Error("The loader returned nothing for this tile.");
      const frame = await tile.renderContent(HEIGHT);
      frame.setAttribute("title", `Real loader preview: ${result.name}`);
      frame.style.width = "100%";
      frame.style.border = "0";
      frame.style.display = "block";
      mountRef.current.replaceChildren(frame);
      setLoadedFrom(result);
      setStatus({ state: "ok", name });
    } catch (err) {
      console.error("[real loader preview]", err);
      setStatus({ state: "error", message: err && err.message ? err.message : String(err) });
    }
  }

  useEffect(() => () => mountRef.current && mountRef.current.replaceChildren(), []);

  return (
    <div className="real-loader">
      <div className="button-row">
        <button type="button" className="btn" onClick={load} disabled={status.state === "loading"}>
          {status.state === "loading" ? "Loading…" : loadedFrom ? "Load again" : "Load through the real tile loader"}
        </button>
        <span className="real-loader-note">
          Tile server: <span className="mono">{LOAD_DOMAIN}</span> · files from memory, nothing published
        </span>
      </div>
      {status.state === "error" && (
        <p className="field-error" role="alert">
          Could not load through the real loader: {status.message}. The browser console (F12) has details.
        </p>
      )}
      {stale && <p className="field-help">The tile has changed since this was loaded. Press “Load again” to see the new version.</p>}
      <div ref={mountRef} className="real-loader-mount" />
    </div>
  );
}
