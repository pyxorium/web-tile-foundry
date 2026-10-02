import { useEffect, useRef, useState } from "react";

// Handle suggestions while typing, as in House Dice: a community-run actor
// search (not Bluesky's own API), used ONLY for suggestions. Signing in still
// goes through the normal handle resolution and OAuth, whatever is picked.
// Known trade-off: what is typed in the box is sent to that service.

export const TYPEAHEAD_URL = "https://typeahead.waow.tech";
const CLIENT_LABEL = "foundry.thunderbird.cafe";
const DEBOUNCE_MS = 150;

export async function searchActors(query, fetchImpl = fetch) {
  const q = query.trim().replace(/^@/, "");
  if (q.length < 2) return [];
  try {
    const res = await fetchImpl(
      `${TYPEAHEAD_URL}/xrpc/tech.waow.typeahead.searchActors?q=${encodeURIComponent(q)}&limit=6`,
      { headers: { "X-Client": CLIENT_LABEL } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.actors) ? data.actors.filter((a) => a && a.handle) : [];
  } catch {
    return [];
  }
}

export function HandleTypeahead({ id, value, onChange, onPick, disabled, placeholder }) {
  const [suggestions, setSuggestions] = useState([]);
  const [active, setActive] = useState(-1);
  const skipNextSearch = useRef(false);
  const listId = `${id}-suggestions`;

  useEffect(() => {
    if (skipNextSearch.current) {
      skipNextSearch.current = false;
      return undefined;
    }
    // A slow, earlier request must never overwrite newer suggestions.
    let cancelled = false;
    const t = setTimeout(async () => {
      const results = await searchActors(value);
      if (!cancelled) {
        setSuggestions(results);
        setActive(-1);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [value]);

  function pick(actor) {
    skipNextSearch.current = true;
    setSuggestions([]);
    setActive(-1);
    onPick(actor.handle);
  }

  function onKeyDown(e) {
    if (!suggestions.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault(); // choose the suggestion; don't submit yet
      pick(suggestions[active]);
    } else if (e.key === "Escape") {
      setSuggestions([]);
      setActive(-1);
    }
  }

  const open = suggestions.length > 0;
  return (
    <div className="typeahead">
      <input
        id={id}
        className="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck="false"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setSuggestions([]), 150)}
      />
      {open && (
        <ul id={listId} className="typeahead-list" role="listbox">
          {suggestions.map((actor, i) => (
            <li
              key={actor.did || actor.handle}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`typeahead-item ${i === active ? "on" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(actor);
              }}
            >
              {actor.avatar ? (
                <img src={actor.avatar} alt="" className="typeahead-avatar" width="32" height="32" />
              ) : (
                <span className="typeahead-avatar typeahead-avatar-blank" aria-hidden="true" />
              )}
              <span className="typeahead-text">
                <span className="typeahead-handle">@{actor.handle}</span>
                {actor.displayName && <span className="typeahead-name">{actor.displayName}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
