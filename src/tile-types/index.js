import { registerTileType } from "../core/registry.js";
import { spriteWalker } from "./sprite-walker/index.js";
import { glassLantern } from "./glass-lantern/index.js";
import { coasterCarnival } from "./coaster-carnival/index.js";
import { mixtape } from "./mixtape/index.js";
import { zine } from "./zine/index.js";
import { zineTileTest } from "./zine-tile-test/index.js";
import { DEBUG } from "../ui/debug.js";

// Every tile type the Foundry offers. To add one: make a folder next to
// sprite-walker/ that exports an object following src/core/contract.js,
// then register it here.
registerTileType(spriteWalker);
registerTileType(glassLantern);
registerTileType(coasterCarnival);
registerTileType(mixtape);
registerTileType(zine);
// Stage 4 host test (tiles on a zine page): only with ?debug on the owner's computer.
if (DEBUG) registerTileType(zineTileTest);
