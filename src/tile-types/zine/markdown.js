// Light Markdown for Zine Scene (v0.30.0): **bold**, *italic*, `code` and
// [link text](https://…) in the creator's words; **bold** and *italic* only in
// headings and the zine's title. Plan and decisions: claude/zine-v030-plan.md.
//
// Safe by construction: this never makes HTML. It turns one line of text into
// runs ({ t: text, b?, i?, c?, h? }), and the reader builds <strong>, <em>,
// <code> and <a> elements from them itself. Only https:// links, and at://
// addresses of web tiles (opened on lexicographer.space), become links; any
// other address stays plain text, as written.
//
// Stray asterisks stay as written: a pair counts only when it hugs its words
// ("*so*", not "a * b"), and not inside a word ("5*3*2" stays as it is). A
// backslash keeps a marker as itself ("\*").
//
// mdRuns is self-contained (no outside names, plain old JavaScript), so the
// zine's reader carries its source too (runtime/reader.js).

/**
 * The runs of one line of text. `rich` true: bold, italic, code and links
 * (the words boxes); false: bold and italic only (headings and the title).
 */
export function mdRuns(text, rich) {
  var VIEWER = "https://lexicographer.space";
  var full = rich === true;
  var s = String(text == null ? "" : text);
  function isSpace(c) { return !c || /\s/.test(c); }
  function isWord(c) { return Boolean(c) && /[0-9A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/.test(c); }
  function starRun(at) { var e = at; while (s.charAt(e) === "*") e++; return e - at; }
  // Where an address goes: an https:// page as it is; an at:// tile on the viewer; anything else nowhere.
  function linkOf(u) {
    if (/^https:\/\/[^\s<>"'`()\[\]{}\\]+$/.test(u) && /^https:\/\/[^\/?#@:]+\.[^\/?#@:]+(?:[\/?#]|$)/.test(u)) return u;
    var m = /^at:\/\/(did:(?:plc|web):[A-Za-z0-9._:%-]+|[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)\/ing\.dasl\.masl\/([A-Za-z0-9._~:-]{1,512})$/.exec(u);
    if (m) return VIEWER + "/@" + (m[1].indexOf("did:") === 0 ? m[1] : m[1].toLowerCase()) + "/" + m[2];
    return null;
  }
  // The closing marker for an opener of `n` stars (1 or 2) at or after `from`,
  // before `end`: a run of stars that hugs the word before it and doesn't run
  // into a word after. Italic closes on a run of 1 or 3+, bold on 2+.
  function closer(from, end, n) {
    var i = from;
    while (i < end) {
      var k = s.indexOf("*", i);
      if (k < 0 || k >= end) return -1;
      var len = starRun(k);
      var stop = Math.min(k + len, end);
      len = stop - k;
      var at = stop - n;
      var ok = n === 1 ? (len === 1 || len >= 3) : len >= 2;
      if (ok && at > from && !isSpace(s.charAt(k - 1)) && s.charAt(k - 1) !== "\\" && !isWord(s.charAt(stop))) return at;
      i = stop;
    }
    return -1;
  }
  var out = [];
  function push(t, f) {
    if (!t) return;
    var last = out[out.length - 1];
    if (last && !last.c && !f.c && Boolean(last.b) === Boolean(f.b) && Boolean(last.i) === Boolean(f.i) && (last.h || "") === (f.h || "")) { last.t += t; return; }
    var r = { t: t };
    if (f.b) r.b = 1;
    if (f.i) r.i = 1;
    if (f.c) r.c = 1;
    if (f.h) r.h = f.h;
    out.push(r);
  }
  function walk(from, end, f) {
    var buf = "";
    var i = from;
    function flush() { push(buf, f); buf = ""; }
    while (i < end) {
      var c = s.charAt(i);
      if (c === "\\" && i + 1 < end && "*`[]\\".indexOf(s.charAt(i + 1)) >= 0) { buf += s.charAt(i + 1); i += 2; continue; }
      if (c === "`" && full && !f.h) {
        var q = s.indexOf("`", i + 1);
        if (q > i + 1 && q < end) { flush(); push(s.slice(i + 1, q), { c: 1, b: f.b, i: f.i }); i = q + 1; continue; }
      }
      if (c === "[" && full && !f.h) {
        var m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(s.slice(i, end));
        var href = m && linkOf(m[2]);
        if (href) {
          flush();
          walk(i + 1, i + 1 + m[1].length, { b: f.b, i: f.i, h: href });
          i += m[0].length;
          continue;
        }
      }
      if (c === "*") {
        var run = starRun(i);
        if (i + run > end) run = end - i;
        var opens = !isSpace(s.charAt(i + run)) && !isWord(s.charAt(i - 1)) && i + run < end;
        if (opens) {
          // Bold first (**), then italic (*); a run of three is both.
          var n = run >= 2 && !f.b ? 2 : 1;
          if (n === 1 && f.i) n = 0;
          if (n) {
            var at = closer(i + n, end, n);
            if (at > i + n) {
              flush();
              walk(i + n, at, n === 2 ? { b: 1, i: f.i, h: f.h } : { b: f.b, i: 1, h: f.h });
              i = at + n;
              continue;
            }
          }
        }
        buf += s.slice(i, i + run);
        i += run;
        continue;
      }
      buf += c;
      i++;
    }
    flush();
  }
  walk(0, s.length, {});
  return out;
}

/** The text as it reads, without the markers or link addresses (each line on its own). */
export function mdPlain(text, rich = true) {
  return String(text == null ? "" : text).split("\n").map((line) => mdRuns(line, rich).map((r) => r.t).join("")).join("\n");
}

/** Whether text uses any formatting (so a hint or a check can tell). */
export function mdFormatted(text, rich = true) {
  return String(text == null ? "" : text).split("\n").some((line) => mdRuns(line, rich).some((r) => r.b || r.i || r.c || r.h));
}

/**
 * How much room formatted words take, in characters of plain text (see
 * wordSize in pages.js): bold letters are a little wider, code a little more.
 */
export function mdRoom(text, rich = true) {
  let n = 0;
  for (const line of String(text == null ? "" : text).split("\n")) {
    for (const r of mdRuns(line, rich)) n += r.t.length * (r.c ? 1.15 : r.b ? 1.08 : 1);
  }
  return Math.ceil(n);
}
