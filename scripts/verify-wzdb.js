const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const core = require("../app-core.js");

const [wzdbArgument, versionArgument] = process.argv.slice(2);
if (!wzdbArgument || !versionArgument) {
  throw new Error("Usage: node scripts/verify-wzdb.js <latest.wzdb> <version.json>");
}

const wzdbPath = path.resolve(wzdbArgument);
const versionPath = path.resolve(versionArgument);
const bytes = fs.readFileSync(wzdbPath);
const version = JSON.parse(fs.readFileSync(versionPath, "utf8"));
const actualHash = crypto.createHash("sha256").update(bytes).digest("hex");

assert.equal(actualHash, version.wzdb_sha256, "WZDB hash differs from version.json");

const database = JSON.parse(zlib.gunzipSync(bytes).toString("utf8"));
assert.equal(database.version, 4);
assert.equal(database.strings[0], "");

const playerIds = database.players
  .map((player, id) => [player, id])
  .filter(([player]) => player[3] === "tyler haupt")
  .map(([, id]) => id);
assert.ok(playerIds.length > 0, "Tyler Haupt is missing from WZDB");

const decoded2026 = database.years["2026"]
  .filter((record) => playerIds.includes(record[0]))
  .map((record) => record.slice(1).map((value) =>
    value === null ? null : database.strings[value]
  ));
const points = decoded2026.map((record) => record[0]);

assert.ok(points.includes("7"), "Tyler Haupt score 7 is missing");
assert.ok(points.includes("14+2"), "Tyler Haupt score 14+2 is missing");
for (const staleValue of ["Holandia", "Dania", "Australia", "Rosja", "Szwecja"]) {
  assert.ok(!points.includes(staleValue), `Stale score detected: ${staleValue}`);
}

const eventKeys = new Set();
let checkedEvents = 0;
for (const [season, refs] of Object.entries(database.events || {})) {
  const ordinals = new Map();
  for (const [start] of refs) {
    const row = database.years[season][start];
    const event = {
      season,
      home: database.strings[row[5]] || "",
      away: database.strings[row[6]] || "",
      score: database.strings[row[7]] || "",
      league: database.strings[row[8]] || "",
      track: database.strings[row[9]] || "",
      competition: database.strings[row[10]] || "",
      round: database.strings[row[11]] || "",
      capacity: database.strings[row[12]] || "",
    };
    const signature = core.eventSignature(event);
    const ordinal = ordinals.get(signature) || 0;
    ordinals.set(signature, ordinal + 1);
    const key = core.stableEventKey(event, ordinal);
    assert.ok(!eventKeys.has(key), `Duplicate stable event key: ${key}`);
    eventKeys.add(key);
    checkedEvents += 1;
  }
}
assert.equal(checkedEvents, database.stats.events, "Stable keys did not cover every event");

const observedHeatCodes = new Set();
const krosnoRecords = [];
for (const [season, rows] of Object.entries(database.years)) {
  for (const row of rows) {
    const heats = database.strings[row[2]] || "";
    for (const token of heats.toLowerCase().split(",").map((value) => value.trim())) {
      if (["d", "w", "u", "t", "-", "ns"].includes(token)) observedHeatCodes.add(token);
    }
    if ((database.strings[row[9]] || "") === "Krosno") {
      krosnoRecords.push({
        season,
        points: database.strings[row[1]] || "",
        heats,
        track: "Krosno",
      });
    }
  }
}
assert.deepEqual([...observedHeatCodes].sort(), ["-", "d", "ns", "t", "u", "w"]);
assert.ok(krosnoRecords.length > 0, "No Krosno records found for track regression");
const krosnoMetric = core.playerMetric(core.filterRecords(krosnoRecords, { track: "Krosno" }));
assert.equal(krosnoMetric.starts, krosnoRecords.length);
assert.ok(krosnoMetric.heats > 0, "Krosno heat parser found no rides");
assert.ok(Number.isFinite(krosnoMetric.heatAvg), "Krosno heat average is not finite");

console.log(JSON.stringify({
  wzdb_sha256: actualHash,
  stats: database.stats,
  tylerHaupt2026Points: points,
  stableEventKeys: eventKeys.size,
  observedHeatCodes: [...observedHeatCodes].sort(),
  krosno: { records: krosnoMetric.starts, heats: krosnoMetric.heats, heatAvg: krosnoMetric.heatAvg },
}, null, 2));
