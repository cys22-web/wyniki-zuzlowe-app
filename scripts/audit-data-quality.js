"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const quality = require(path.join(__dirname, "..", "data-quality.js"));

const input = process.argv[2];
if (!input) throw new Error("Usage: node scripts/audit-data-quality.js <latest.wzdb> [--full]");

const database = JSON.parse(zlib.gunzipSync(fs.readFileSync(input)));
const hash = process.argv.find((value) => value.startsWith("--hash="))?.slice(7) || "";

function run(label, seasons) {
  const buildStarted = performance.now();
  const model = quality.buildAuditInput(database, { hash, seasons });
  const buildMs = performance.now() - buildStarted;
  const report = quality.auditDataQuality(model, { hash });
  return {
    label,
    buildMs,
    auditMs: report.durationMs,
    events: model.events.length,
    records: report.diagnostics.recordCount,
    summary: report.summary,
    top20: report.issues.slice(0, 20),
  };
}

const latestSeason = String(Math.max(...Object.keys(database.years || {}).map(Number)));
const output = {
  source: path.resolve(input),
  latestSeason: run(latestSeason, [latestSeason]),
  allSeasons: run("all", null),
};

if (process.argv.includes("--summary")) {
  delete output.latestSeason.top20;
  delete output.allSeasons.top20;
}

process.stdout.write(JSON.stringify(output, null, 2));
