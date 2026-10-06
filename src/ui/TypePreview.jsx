import { useEffect, useRef, useState } from "react";

// A live preview that the tile type runs in the page itself (see `preview` in
// src/core/contract.js), for types whose preview needs to talk to the form,
// such as Glass Lantern's painting of facets, or plays the built tile, such as
// Mixtape's player (it gets the latest built tile as `result`).

export function TypePreview({ type, values, setValue, result = null }) {
  const mountRef = useRef(null);
  const handle = useRef(null);
  const latest = useRef(values);
  const latestResult = useRef(result);
  latestResult.current = result;
  const [error, setError] = useState(null);
  latest.current = values;

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const h = await type.preview.mount(mountRef.current, { values: latest.current, setValue, result: latestResult.current });
        if (cancelled) h.dispose();
        else handle.current = h;
      } catch (e) {
        console.error("[preview]", e);
        if (!cancelled) setError(e.message || String(e));
      }
    })();
    return () => {
      cancelled = true;
      if (handle.current) handle.current.dispose();
      handle.current = null;
      // Start the next type's preview in an empty box, whatever this one left.
      if (mountRef.current) mountRef.current.replaceChildren();
    };
    // Mounted once per type; later changes go through update().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  // Types that play the built tile (preview.needsResult) also hear about each
  // new build; the others only about changed values, as before.
  const lastValues = useRef(values);
  useEffect(() => {
    const valuesChanged = lastValues.current !== values;
    lastValues.current = values;
    if (!handle.current) return;
    if (valuesChanged || type.preview.needsResult) handle.current.update(values, result);
  }, [values, result, type]);

  return (
    <>
      <div ref={mountRef} className="type-preview" />
      {error && <p className="field-error" role="alert">The preview could not start: {error}</p>}
    </>
  );
}
