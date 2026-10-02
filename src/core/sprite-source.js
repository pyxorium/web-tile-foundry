import { isPng, pngSize } from "./bytes.js";
import { rawCid } from "./cid.js";

// Where a tile's rpg.actor sprite comes from, as one value the "sprite" input
// kind passes around:
//
//   { bytes, cid, width, height,
//     geometry: { frameWidth, frameHeight, columns, rows },
//     origin:   { kind: "local-file", name }            (maker-lite)
//            or { kind: "record", uri, generator? }     (after sign-in) }
//
// rpg.actor's own record (actor.rpg.sprite, key "self") states its geometry,
// confirmed from a real record on Oct 2 2026:
//   spriteSheet (blob, image/png), width 144, height 192, frameWidth 48,
//   frameHeight 48, columns 3, rows 4, frames 12, source (generator record).
// A local PNG has no record, so its geometry is inferred as 3 columns x 4 rows.

export const DEFAULT_COLUMNS = 3;
export const DEFAULT_ROWS = 4;
const MAX_SPRITE_BYTES = 1024 * 1024;

export class SpriteError extends Error {
  constructor(message) {
    super(message);
    this.name = "SpriteError";
  }
}

/** Geometry for a sheet with no record: assume the standard 3 x 4 layout. */
export function geometryFromImage(width, height) {
  return {
    columns: DEFAULT_COLUMNS,
    rows: DEFAULT_ROWS,
    frameWidth: width / DEFAULT_COLUMNS,
    frameHeight: height / DEFAULT_ROWS,
  };
}

/** Geometry as stated by an actor.rpg.sprite record value. */
export function geometryFromRecord(value) {
  const columns = value.columns ?? DEFAULT_COLUMNS;
  const rows = value.rows ?? DEFAULT_ROWS;
  return {
    columns,
    rows,
    frameWidth: value.frameWidth ?? value.width / columns,
    frameHeight: value.frameHeight ?? value.height / rows,
  };
}

/** Problems with a geometry for an image of the given size (empty list = fine). */
export function checkGeometry(geometry, width, height) {
  const problems = [];
  const { columns, rows, frameWidth, frameHeight } = geometry;
  for (const [label, n] of Object.entries({ columns, rows, frameWidth, frameHeight })) {
    if (!Number.isInteger(n) || n < 1) problems.push(`${label} must be a whole number (got ${n}).`);
  }
  if (problems.length) return problems;
  if (columns * frameWidth !== width || rows * frameHeight !== height) {
    problems.push(
      `The sheet is ${width}×${height}, but ${columns} columns of ${frameWidth} and ${rows} rows of ${frameHeight} make ${columns * frameWidth}×${rows * frameHeight}.`
    );
  }
  return problems;
}

/** Builds a sprite value from PNG bytes, e.g. a file the user picked. */
export async function spriteFromBytes(bytes, origin, record = null) {
  bytes = new Uint8Array(bytes);
  if (!isPng(bytes)) throw new SpriteError("That file isn't a PNG image. rpg.actor sprites are PNG files.");
  if (bytes.length > MAX_SPRITE_BYTES) throw new SpriteError("That image is larger than 1 MB, which is far bigger than a sprite sheet.");
  const { width, height } = pngSize(bytes);
  const geometry = record ? geometryFromRecord(record) : geometryFromImage(width, height);
  const problems = checkGeometry(geometry, width, height);
  if (problems.length) {
    throw new SpriteError(
      record
        ? `This sprite's sheet doesn't match its own record. ${problems.join(" ")}`
        : `This image doesn't look like a 3 × 4 sprite sheet. ${problems.join(" ")}`
    );
  }
  return { bytes, cid: await rawCid(bytes), width, height, geometry, origin };
}
