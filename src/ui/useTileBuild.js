import { useEffect, useRef, useState } from "react";
import { buildTile } from "../core/build.js";

// Rebuilds the tile shortly after the inputs stop changing, so the preview
// always shows exactly what would be published. Returns
// { result, error, building }.
// `final`: build exactly what would be published (card pictures included).
// While editing, types may leave out costly parts (see build() in contract.js).
export function useTileBuild(type, inputs, ready, delayMs = 250, final = true) {
  const [state, setState] = useState({ result: null, error: null, building: false });
  const run = useRef(0);

  useEffect(() => {
    if (!type || !ready) {
      setState({ result: null, error: null, building: false });
      return undefined;
    }
    const mine = ++run.current;
    setState((s) => ({ ...s, building: true }));
    const timer = setTimeout(async () => {
      try {
        const result = await buildTile(type, inputs, { final });
        if (mine === run.current) setState({ result, error: null, building: false });
      } catch (error) {
        if (mine === run.current) setState({ result: null, error, building: false });
      }
    }, delayMs);
    return () => clearTimeout(timer);
  }, [type, inputs, ready, delayMs, final]);

  return state;
}

// Object URLs for a built tile's files (for images and downloads), revoked
// automatically when the tile changes.
export function useFileUrls(result) {
  const [urls, setUrls] = useState({});
  useEffect(() => {
    if (!result) {
      setUrls({});
      return undefined;
    }
    const made = {};
    for (const f of result.files) made[f.path] = URL.createObjectURL(new Blob([f.bytes], { type: f.contentType }));
    setUrls(made);
    return () => Object.values(made).forEach((u) => URL.revokeObjectURL(u));
  }, [result]);
  return urls;
}
