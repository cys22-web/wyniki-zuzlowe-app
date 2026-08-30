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

test("full audit runs off the UI thread and reports progress", () => {
  assert.match(app, /new Worker\('data-quality-worker\.js'\)/);
  assert.match(worker, /buildAuditInput\(database/);
  assert.match(worker, /auditDataQuality\(input/);
  assert.match(worker, /type: "progress"/);
  assert.match(worker, /type: "done"/);
});

test("audit cache is tied to the current WZDB hash", () => {
  assert.match(app, /currentDataQualityHash\(\)/);
  assert.match(app, /auditCacheKey\(hash\)/);
  assert.match(app, /isAuditCacheCurrent\(cached,hash\)/);
  assert.match(app, /dataQualityHash!==hash/);
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

test("data-quality assets are available offline without changing the v5.0 cache", () => {
  assert.match(sw, /"data-quality\.js"/);
  assert.match(sw, /"data-quality-worker\.js"/);
  assert.match(sw, /wz-v5-0-20260830-search-aliases/);
  assert.match(html, /<script src="data-quality\.js"><\/script>/);
});
