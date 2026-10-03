import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { productionClientMetadata, CLIENT_METADATA_FILE } from "./src/auth/client-config.js";

// Writes the sign-in file (oauth.json) into the built site, generated from the same
// settings the sign-in code uses (src/auth/client-config.js), so the hosted
// file and the code can never disagree about the scope.
function clientMetadataFile() {
  return {
    name: "foundry-client-metadata",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: CLIENT_METADATA_FILE,
        source: JSON.stringify(productionClientMetadata(), null, 2) + "\n",
      });
    },
  };
}

// Look lab live sync (development only: `npm run lab`, never in the built site).
// Every device with the lab open sends its look changes here, and the server
// passes them on to all the others over Vite's own connection, so a slider
// moved on the computer shows on the phone a moment later. Nothing leaves the
// home network; the last look is kept in memory so a device that joins late
// catches up.
function labSync() {
  let latest = null;
  return {
    name: "glass-lantern-lab-sync",
    apply: "serve",
    configureServer(server) {
      server.ws.on("lab:update", (data) => {
        latest = data;
        server.ws.send("lab:update", data);
      });
      server.ws.on("lab:hello", (_data, client) => {
        if (latest) client.send("lab:update", latest);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), clientMetadataFile(), labSync()],
  server: {
    // Sign-in on this computer (atproto's localhost client mode) needs the page
    // at 127.0.0.1, not "localhost".
    host: "127.0.0.1",
    port: 5173,
  },
  build: {
    // The tile's runtime is copied into each tile as text
    // (see sprite-walker/walker-runtime.js). That works in a minified build
    // because those functions are self-contained; the tests check it.
    target: "es2020",
  },
});
