// The player's look. Everything is under .mt, so the same styles can run in
// the tile's own page and in the Foundry's preview without touching anything
// else. No web fonts (a tile can't fetch them); the label uses whatever
// handwriting-style font the device has. Handwriting fonts have long tails
// below the line (g, j, y), so the label is never clipped: it wraps instead
// (labels are short, at most 40 characters).

export const PLAYER_CSS = `
.mt { --bg: #1b1822; --panel: #26212f; --line: #3a3346; --ink: #f4ede1; --dim: #b0a596; --accent: #f2a93b;
  --label: #f3e8cc; --label-ink: #2b2340; --stripe1: #e2572c; --stripe2: #f2a93b;
  box-sizing: border-box; display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 260px;
  background: var(--bg); color: var(--ink); font: 14px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  position: relative; overflow: hidden; }
.mt *, .mt *::before, .mt *::after { box-sizing: border-box; }
.mt :where(button) { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
.mt button:focus-visible, .mt input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.mt-head { margin: 10px 10px 0; padding: 8px 12px 9px; border-radius: 6px; background: var(--label); color: var(--label-ink);
  position: relative; flex: none; }
.mt-head::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 6px; border-radius: 0 0 6px 6px;
  background: linear-gradient(var(--stripe2) 0 50%, var(--stripe1) 50% 100%); }
.mt-label { margin: 0 64px 4px 0; font: 22px/1.35 "Segoe Print", "Bradley Hand", "Comic Sans MS", "Chalkboard SE", cursive;
  overflow-wrap: anywhere; }
.mt-sub { margin: 0 64px 0 0; font-size: 12px; opacity: .78; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mt-ded { margin: 2px 0 4px; font-size: 12px; font-style: italic; opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mt-notes-btn { position: absolute; top: 8px; right: 10px; font-size: 12px; padding: 3px 8px;
  border-radius: 999px; border: 1px solid currentColor; color: var(--label-ink); }
.mt-sides { display: flex; gap: 6px; padding: 8px 10px 0; flex: none; }
.mt-side { padding: 4px 10px; border-radius: 999px; background: var(--panel); color: var(--dim);
  font-size: 13px; border: 1px solid var(--line); }
.mt-side[aria-pressed="true"] { color: var(--bg); background: var(--accent); border-color: var(--accent); font-weight: 600; }
.mt-body { position: relative; flex: 1 1 auto; min-height: 0; margin-top: 6px; }
.mt-list { list-style: none; margin: 0; padding: 0 6px 8px; height: 100%; overflow-y: auto; overscroll-behavior: contain; }
.mt-row { display: grid; grid-template-columns: 2.2em 1fr auto; align-items: center; gap: 6px; width: 100%;
  padding: 6px 8px; border-radius: 6px; text-align: left; }
.mt-row:hover { background: var(--panel); }
.mt-row[aria-current="true"] { background: var(--panel); box-shadow: inset 3px 0 0 var(--accent); }
.mt-n { color: var(--dim); font-variant-numeric: tabular-nums; font-size: 12px; text-align: right; padding-right: 4px; }
.mt-row[aria-current="true"] .mt-n { color: var(--accent); font-weight: 700; }
.mt-t { min-width: 0; }
.mt-tt { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mt-ta { display: block; color: var(--dim); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mt-d { color: var(--dim); font-size: 12px; font-variant-numeric: tabular-nums; }
.mt-elsewhere { display: block; width: calc(100% - 16px); margin: 4px 8px 6px; padding: 6px 10px; border-radius: 6px;
  border: 1px dashed var(--line); color: var(--dim); font-size: 12px; text-align: left; }
.mt-elsewhere:hover { color: var(--ink); border-color: var(--accent); }
.mt-end { margin: 6px 8px 10px; padding: 10px 12px; border-radius: 6px; border: 1px dashed var(--line); color: var(--dim); text-align: center; }
.mt-end button { margin-top: 6px; padding: 6px 14px; border-radius: 999px; background: var(--accent); color: var(--bg); font-weight: 600; }
.mt-notes { position: absolute; inset: 0; padding: 10px 14px 14px; background: var(--bg); overflow-y: auto; white-space: pre-wrap;
  overflow-wrap: anywhere; color: var(--ink); }
.mt-notes h2 { margin: 0 0 6px; font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: var(--dim); }
.mt-notes[hidden] { display: none; }
.mt-bar { flex: none; padding: 6px 10px 8px; border-top: 1px solid var(--line); background: var(--panel); }
.mt-now { font-size: 12px; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-height: 1.35em; }
.mt-now[data-error] { color: #ff9b85; }
.mt-ctrl { display: flex; align-items: center; gap: 6px; margin-top: 2px; }
.mt-btn { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; flex: none; }
.mt-btn svg { width: 18px; height: 18px; fill: currentColor; }
.mt-btn:disabled { opacity: .35; cursor: default; }
.mt-play { width: 40px; height: 40px; background: var(--accent); color: var(--bg); }
.mt-play svg { width: 20px; height: 20px; }
.mt-pos { flex: 1 1 auto; min-width: 40px; accent-color: var(--accent); margin: 0 4px; }
.mt-time { font-size: 12px; color: var(--dim); font-variant-numeric: tabular-nums; white-space: nowrap; }
.mt-make { position: absolute; right: 10px; bottom: 2px; font-size: 10px; color: var(--dim); opacity: .6; text-decoration: none; }
.mt-busy .mt-play { opacity: .7; }
@media (max-height: 300px) { .mt-ded, .mt-sub { display: none; } .mt-label { font-size: 18px; } }
`;
