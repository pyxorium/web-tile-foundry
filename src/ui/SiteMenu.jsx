// The menu at the right of the sign: a button with three bars that opens a short list of links.
// Every link opens in a new tab, so a tile half made in this page is never lost.
// Closes on Escape (focus goes back to the button), a click outside, or choosing a link.
import { useEffect, useId, useRef, useState } from "react";

export const SITE_MENU_LINKS = [
  { label: "Blog", href: "https://thunderbird.cafe/blog/" },
];

export function SiteMenu({ links = SITE_MENU_LINKS }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const button = useRef(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrap.current && !wrap.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <nav className="site-menu" ref={wrap} aria-label="Site">
      <button
        ref={button}
        type="button"
        className="site-menu-button"
        aria-expanded={open}
        aria-controls={listId}
        aria-label="Menu"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="site-menu-bars" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>
      {open && (
        <ul className="site-menu-list" id={listId}>
          {links.map((l) => (
            <li key={l.href}>
              <a href={l.href} target="_blank" rel="noopener" onClick={() => setOpen(false)}>
                {l.label}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
