const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

for (const file of ["app-core.js", "data-quality.js", "data-quality-worker.js", "db-update.js", "app.js", "sw.js"]) {
  new vm.Script(read(file), { filename: file });
}

const html = read("index.html");
const style = read("style.css");
for (const asset of [
  "style.css",
  "app-core.js",
  "data-quality.js",
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
assert.match(app, /UPDATE\.synchronizeDatabase/);
assert.match(app, /window\.addEventListener\('online'/);
assert.match(app, /document\.addEventListener\('visibilitychange'/);
assert.match(app, /renderLatestEvents/);
assert.match(app, /renderPlayerAnalytics/);
assert.match(app, /renderCommonEvents/);
assert.match(app, /renderCurrentForm/);
assert.match(app, /renderComparisonForm/);
assert.match(app, /CORE\.mergeAdjacentEvents\(physical\)/);
assert.match(app, /renderComparisonResults\(\)/);
assert.match(app, /comparisonTrackOptions/);
assert.match(app, /thresholdTrend/);
assert.match(app, /history\.pushState/);
assert.match(app, /window\.addEventListener\('popstate'/);
assert.match(app, /activateUpdatedDB=async function\(db\)[\s\S]*captureViewContext[\s\S]*applyRoute/);
assert.match(app, /new Worker\('data-quality-worker\.js'\)/);
assert.match(app, /WZDataQuality\.auditCacheKey\(hash,scope\)/);
assert.match(app, /worker\.postMessage\(\{database:DB,hash,seasons\}\)/);
assert.match(app, /view:'data-quality'/);

for (const id of ["cmpResultsA", "cmpResultsB", "cmpOverall", "cmpForm", "cmpChart", "cmpSeasons", "commonEvents", "eventTeams", "multiTrackPanel", "multiTrackOptions"]) {
  assert.match(html, new RegExp(`id=["']${id}["']`));
}
const comparisonOrder = ["commonEvents", "cmpResultsA", "cmpResultsB", "cmpOverall", "cmpForm", "cmpChart", "cmpSeasons"]
  .map((id) => html.indexOf(`id="${id}"`));
assert.ok(comparisonOrder.every((position) => position >= 0));
assert.ok(comparisonOrder.every((position, index) => index === 0 || position > comparisonOrder[index - 1]));
assert.match(style, /@media\(max-width:620px\)\{\.cmpResultLists\{grid-template-columns:1fr\}/);

const core = require(path.join(root, "app-core.js"));
assert.equal(core.normalizeRoute({ view: "player", playerKey: "bartosz zmarzlik" }).view, "player");
assert.equal(core.latestEventRefs([
  { season: "2026", order: 2 },
  { season: "2026", order: 5 },
], 1)[0].order, 5);

const serviceWorker = read("sw.js");
assert.match(serviceWorker, /isDatabaseRequest/);
assert.match(serviceWorker, /event\.respondWith\(fetch\(event\.request, \{ cache: "no-store" \}\)\)/);
assert.match(serviceWorker, /skipWaiting/);
assert.match(serviceWorker, /clients\.claim/);
assert.match(serviceWorker, /app-core\.js/);
assert.match(serviceWorker, /data-quality\.js/);
assert.match(serviceWorker, /data-quality-worker\.js/);
assert.match(serviceWorker, /wz-v5-1-/);
assert.match(app, /eventDateForRow/);
assert.match(app, /S\(row\[0\]\)\],key=/);
assert.doesNotMatch(app, /S\(row\[13\]\)\],key=/);
assert.match(app, /row\[16\]/);
assert.match(app, /CORE\.resolveEventDate\(eventDateCells\)/);
assert.match(app, /thresholdHeats/);

console.log("Static PWA build check passed.");
