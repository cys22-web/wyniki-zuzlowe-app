const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = read("app.js");
const html = read("index.html");
const worker = read("data-quality-worker.js");
const sw = read("sw.js");

test("data-quality audit is an explicit action and not part of ordinary startup", () => {
  assert.match(html, /id="dataQualityBtn"/);
  assert.match(app, /\$\('dataQualityBtn'\)\.onclick=.*openDataQuality/);
  const startupBody = app.match(/async function startup\(\)\{([\s\S]*?)\n\}/)?.[1] || "";
  assert.doesNotMatch(startupBody, /runDataQualityAudit|buildAuditInput|auditDataQuality/);
});

test("scoped audit runs off the UI thread and reports progress", () => {
  assert.match(app, /new Worker\('data-quality-worker\.js'\)/);
  assert.match(worker, /const \{ database, hash, seasons \}/);
  assert.match(worker, /buildAuditInput\(database, \{ hash, seasons \}\)/);
  assert.match(worker, /auditDataQuality\(input/);
  assert.match(worker, /type: "progress"/);
  assert.match(worker, /type: "done"/);
});

test("audit cache is tied to the current WZDB hash and season scope", () => {
  assert.match(app, /currentDataQualityHash\(\)/);
  assert.match(app, /auditCacheKey\(hash,scope\)/);
  assert.match(app, /isAuditCacheCurrent\(cached,hash,scope\)/);
  assert.match(app, /dataQualityHash!==hash/);
});

test("season choices come from DB years and trigger a new scoped audit", () => {
  assert.match(app, /Object\.keys\(DB\?\.years\|\|\{\}\)/);
  assert.match(app, /\$\('dqSeason'\)\.onchange=.*runDataQualityAudit\(false,\$\('dqSeason'\)\.value\)/);
  assert.match(app, /\$\('dqAllSeasons'\)\.onclick=.*runDataQualityAudit\(false,''\)/);
  assert.match(app, /worker\.postMessage\(\{database:DB,hash,seasons\}\)/);
});

test("data-quality actions preserve panel history before navigating", () => {
  assert.match(app, /function navigateFromDataQuality\(action\)\{\s*persistHistoryContext\(\)/);
  assert.match(app, /navigateFromDataQuality\(\(\)=>openEventDetail/);
  assert.match(app, /navigateFromDataQuality\(\(\)=>selectPlayer/);
  assert.match(app, /navigateFromDataQuality\(\(\)=>openEventsWithFilters/);
  assert.match(app, /pushCurrentRoute\(\)/);
});

test("panel exposes required filters, expandable issues and CSV export", () => {
  for (const id of ["dqSeason", "dqConfidence", "dqCategory", "dqLeague", "dqTrack", "dqSort", "dataQualityExport", "dataQualityList"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(app, /<details class="dqIssue"/);
  assert.match(app, /issuesToCSV\(dataQualityFiltered\)/);
  assert.match(app, /data-dq-event/);
  assert.match(app, /data-dq-player/);
  assert.match(app, /data-dq-track/);
});

test("data-quality assets are available offline in the v5.1.1 cache", () => {
  assert.match(sw, /"data-quality\.js"/);
  assert.match(sw, /"data-quality-worker\.js"/);
  assert.match(sw, /wz-v5-1-1-20260831-data-quality-scope/);
  assert.match(html, /<script src="data-quality\.js"><\/script>/);
});
