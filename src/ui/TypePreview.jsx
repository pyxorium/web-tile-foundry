import { useEffect, useRef, useState } from "react";

// A live preview that the tile type runs in the page itself (see `preview` in
// src/core/contract.js), for types whose preview needs to talk to the form,
// such as Glass Lantern's painting of facets.

export function TypePreview({ type, values, setValue }) {
  const mountRef = useRef(null);
  const handle = useRef(null);
  const latest = useRef(values);
  const [error, setError] = useState(null);
  latest.current = values;

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const h = await type.preview.mount(mountRef.current, { values: latest.current, setValue });
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
    };
    // Mounted once per type; later changes go through update().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  useEffect(() => {
    if (handle.current) handle.current.update(values);
  }, [values]);

  return (
    <>
      <div ref={mountRef} className="type-preview" />
      {error && <p className="field-error" role="alert">The preview could not start: {error}</p>}
    </>
  );
}
