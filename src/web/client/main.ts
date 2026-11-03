/// <reference lib="dom" />
// Browser entry, bundled into the executable by Bun's HTML import.
// Placeholder until Phase 5: proves a script asset is embedded and executes.
const app = document.getElementById("app");
if (app) app.dataset.ready = "true";
