import { createEncoderPool } from "../../core/audio/pool.js";

// One encoder pool for the whole Foundry page, made the first time a song is
// converted (browser only).
let pool = null;
export function sharedPool() {
  if (!pool) pool = createEncoderPool();
  return pool;
}
