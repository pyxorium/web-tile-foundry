import { registerTileType } from "../core/registry.js";
import { spriteWalker } from "./sprite-walker/index.js";
import { glassLantern } from "./glass-lantern/index.js";
import { coasterCarnival } from "./coaster-carnival/index.js";
import { isLoopbackHost } from "../auth/client-config.js";

// Every tile type the Foundry offers. To add one: make a folder next to
// sprite-walker/ that exports an object following src/core/contract.js,
// then register it here.
registerTileType(spriteWalker);
registerTileType(glassLantern);
// Coaster Carnival is offered only on this computer (127.0.0.1) until it is
// checked on webtil.es and phones (stage 7); then this line loses its "if".
if (typeof location !== "undefined" && isLoopbackHost(location.hostname)) registerTileType(coasterCarnival);
