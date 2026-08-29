"use strict";

const fs = require("node:fs");
const zlib = require("node:zlib");
const path = require("node:path");
const core = require(path.join(__dirname, "..", "app-core.js"));

const input = process.argv[2];
if (!input) throw new Error("Usage: node scripts/audit-aliases.js <latest.wzdb>");
const database = JSON.parse(zlib.gunzipSync(fs.readFileSync(input)));
const text = (index) => index ? String(database.strings[index] || "") : "";
const tracks = new Map();
const teams = new Map();

function add(target, value, season) {
  const display = String(value || "").trim();
  if (!display) return;
  let item = target.get(display);
  if (!item) target.set(display, item = { value: display, count: 0, seasons: new Set() });
  item.count += 1;
  item.seasons.add(String(season));
}

for (const [season, rows] of Object.entries(database.years || {})) {
  for (const row of rows || []) {
    add(tracks, text(row[9]), season);
    const home = text(row[5]), away = text(row[6]), score = text(row[7]);
    if (score && home) add(teams, home, season);
    if (score && away) add(teams, away, season);
  }
}

const entries = (source) => [...source.values()].map((item) => ({
  value: item.value,
  count: item.count,
  seasons: [...item.seasons].sort(),
}));
const trackCandidates = core.findAliasCandidates(entries(tracks), { type: "track" });
const teamCandidates = core.findAliasCandidates(entries(teams), { type: "team" });
const all = [...trackCandidates, ...teamCandidates].sort((a, b) =>
  Number(b.confidence === "HIGH") - Number(a.confidence === "HIGH") ||
  (b.countA + b.countB) - (a.countA + a.countB) ||
  a.variantA.localeCompare(b.variantA, "pl")
);
const count = (items, confidence) => items.filter((item) => item.confidence === confidence).length;

const report = {
  source: path.resolve(input),
  distinct: { tracks: tracks.size, teams: teams.size },
  summary: {
    track: { HIGH: count(trackCandidates, "HIGH"), REVIEW: count(trackCandidates, "REVIEW") },
    team: { HIGH: count(teamCandidates, "HIGH"), REVIEW: count(teamCandidates, "REVIEW") },
  },
  top20: all.slice(0, 20),
  candidates: { track: trackCandidates, team: teamCandidates },
};
if (process.argv.includes("--summary")) delete report.candidates;
process.stdout.write(JSON.stringify(report, null, 2));
