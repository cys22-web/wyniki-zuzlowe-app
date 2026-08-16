const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

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

console.log(JSON.stringify({
  wzdb_sha256: actualHash,
  stats: database.stats,
  tylerHaupt2026Points: points,
}, null, 2));
