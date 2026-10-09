// Filling a little book's pages from a gallery (Zine Scene stage 5, part 3).
// No DOM, so the tests can use it. The page editor (src/ui/InputForm.jsx) asks
// for a plan, then downloads and adds the photos one at a time.
//
// Two ways (owner, Oct 9):
//   "fill"     the picked photos go into the empty pages, in page order;
//   "replace"  every page starts over: the first photo on the first page (the
//              cover), the last on the last page (the back), the others on the
//              pages between, in order; pages left over stay empty.

/**
 * Which page gets which photo: [{ pageId, index }] (index into the picked photos).
 *   pages:   the pages' specs, in order ([{ id }])
 *   values:  the pages' current values (same order)
 *   count:   how many photos were picked
 *   mode:    "fill" | "replace"
 *   isEmpty: (page) -> true when a page has nothing on it
 */
export function planGalleryFill(pages, values, count, mode, isEmpty) {
  const n = Math.max(0, count | 0);
  if (!n || !pages.length) return [];
  if (mode === "replace") {
    if (n === 1) return [{ pageId: pages[0].id, index: 0 }];
    const middle = pages.slice(1, -1);
    const out = [{ pageId: pages[0].id, index: 0 }];
    const between = Math.min(n - 2, middle.length);
    for (let i = 0; i < between; i++) out.push({ pageId: middle[i].id, index: i + 1 });
    out.push({ pageId: pages[pages.length - 1].id, index: n - 1 });
    return out;
  }
  const empty = pages.filter((spec, i) => isEmpty(values[i]));
  return empty.slice(0, n).map((spec, i) => ({ pageId: spec.id, index: i }));
}

/** How many of the picked photos a plan leaves out. */
export function leftOver(plan, count) {
  return Math.max(0, count - plan.length);
}

/** "the cover", "page 1", "pages 1 to 6 and the back" (for the note after filling). */
export function describePages(ids, pages) {
  const label = (id) => {
    const s = pages.find((p) => p.id === id);
    return s ? s.label : id;
  };
  const nums = [];
  const named = [];
  for (const id of ids) {
    const m = /^Page (\d+)$/.exec(label(id));
    if (m) nums.push(Number(m[1]));
    else named.push(`the ${label(id).toLowerCase()}`);
  }
  // Page numbers: a run of three or more reads "1 to 6"; others are listed.
  nums.sort((a, b) => a - b);
  const tokens = [];
  let i = 0;
  while (i < nums.length) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    if (j - i >= 2) tokens.push(`${nums[i]} to ${nums[j]}`);
    else for (let k = i; k <= j; k++) tokens.push(String(nums[k]));
    i = j + 1;
  }
  const parts = [];
  if (tokens.length) parts.push(`${nums.length === 1 ? "page" : "pages"} ${andList(tokens)}`);
  const cover = named.filter((x) => x === "the cover");
  const rest = named.filter((x) => x !== "the cover");
  return andList([...cover, ...parts, ...rest]);
}

function andList(items) {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
