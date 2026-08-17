const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

for (const file of ["app-core.js", "db-update.js", "app.js", "sw.js"]) {
  new vm.Script(read(file), { filename: file });
}

const html = read("index.html");
for (const asset of [
  "style.css",
  "app-core.js",
  "db-update.js",
  "app.js",
  "manifest.webmanifest",
]) {
  assert.match(html, new RegExp(`[\"']${asset.replace(".", "\\.")}[\"']`));
  assert.ok(fs.existsSync(path.join(root, asset)), `Missing ${asset}`);
}

const app = read("app.js");
assert.match(app, /UPDATE\.fetchVersion\(\)/);
assert.match(app, /UPDATE\.downloadDatabase\(version\)/);
assert.match(app, /await saveCustomDB\([\s\S]*await activateUpdatedDB/);
assert.match(app, /renderLatestEvents/);
assert.match(app, /renderPlayerAnalytics/);
assert.match(app, /renderCommonEvents/);
assert.match(app, /renderCurrentForm/);
assert.match(app, /renderComparisonForm/);
assert.match(app, /thresholdTrend/);
assert.match(app, /history\.pushState/);
assert.match(app, /window\.addEventListener\('popstate'/);
assert.match(app, /activateUpdatedDB=async function\(db\)[\s\S]*captureViewContext[\s\S]*applyRoute/);

const core = require(path.join(root, "app-core.js"));
assert.equal(core.normalizeRoute({ view: "player", playerKey: "bartosz zmarzlik" }).view, "player");
assert.equal(core.latestEventRefs([
  { season: "2026", order: 2 },
  { season: "2026", order: 5 },
], 1)[0].order, 5);

const serviceWorker = read("sw.js");
assert.match(serviceWorker, /isDatabaseRequest/);
assert.match(serviceWorker, /event\.respondWith\(fetch\(event\.request\)\)/);
assert.match(serviceWorker, /skipWaiting/);
assert.match(serviceWorker, /clients\.claim/);
assert.match(serviceWorker, /app-core\.js/);
assert.match(serviceWorker, /wz-v4-5-/);

console.log("Static PWA build check passed.");
