import { registerTileType } from "../core/registry.js";
import { spriteWalker } from "./sprite-walker/index.js";
import { glassLantern } from "./glass-lantern/index.js";
import { coasterCarnival } from "./coaster-carnival/index.js";
import { mixtape } from "./mixtape/index.js";
import { DEBUG } from "../ui/debug.js";

// Every tile type the Foundry offers. To add one: make a folder next to
// sprite-walker/ that exports an object following src/core/contract.js,
// then register it here.
registerTileType(spriteWalker);
registerTileType(glassLantern);
registerTileType(coasterCarnival);
// Mixtape is still being finished (card pictures, then publishing tests), so
// for now it is offered only in debug mode, on this computer (?debug).
if (DEBUG) registerTileType(mixtape);
