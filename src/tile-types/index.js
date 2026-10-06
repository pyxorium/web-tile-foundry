import { registerTileType } from "../core/registry.js";
import { spriteWalker } from "./sprite-walker/index.js";
import { glassLantern } from "./glass-lantern/index.js";
import { coasterCarnival } from "./coaster-carnival/index.js";
import { mixtape } from "./mixtape/index.js";

// Every tile type the Foundry offers. To add one: make a folder next to
// sprite-walker/ that exports an object following src/core/contract.js,
// then register it here.
registerTileType(spriteWalker);
registerTileType(glassLantern);
registerTileType(coasterCarnival);
registerTileType(mixtape);
