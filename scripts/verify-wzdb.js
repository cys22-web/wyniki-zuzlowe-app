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

let recordsWithStartNumber = 0;
let totalRecords = 0;
for (const rows of Object.values(database.years || {})) {
  for (const row of rows) {
    assert.ok(row.length >= 14, "Legacy record fields 0..13 are missing");
    assert.ok(row.length <= 15, "Unexpected fields after optional start number");
    for (const value of row.slice(0, 14)) {
      assert.ok(value === null || Number.isInteger(value), "Legacy record field is not an interned string id");
    }
    if (row.length === 15) {
      assert.ok(row[14] === null || Number.isInteger(row[14]), "Start number is not an interned string id");
      if (row[14] !== null && database.strings[row[14]]) recordsWithStartNumber += 1;
    }
    totalRecords += 1;
  }
}
assert.equal(totalRecords, database.stats.rows, "Record validation did not cover the database");
assert.ok(recordsWithStartNumber > 0, "No start numbers were exported from Excel column N");

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
let teamEvents = 0;
let classifiedTeamEvents = 0;
let teamRows = 0;
let classifiedTeamRows = 0;
for (const [season, refs] of Object.entries(database.events || {})) {
  const ordinals = new Map();
  for (const [start, count] of refs) {
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
    if (event.home && event.away && event.score) {
      const eventRows = database.years[season].slice(start, start + count);
      teamEvents += 1;
      teamRows += count;
      const sideResult = core.classifyTeamEvent(
        eventRows.map((record) => ({ points: database.strings[record[1]] || "" })),
        event
      );
      if (sideResult.classified) {
        classifiedTeamEvents += 1;
        classifiedTeamRows += count;
      }
    }
  }
}
assert.equal(checkedEvents, database.stats.events, "Stable keys did not cover every event");
assert.ok(classifiedTeamEvents / teamEvents > 0.9, "Too few team events have an unambiguous HOME/AWAY split");

let logicalEventCount = 0;
let logicalMultiTeamEvents = 0;
const mergedEventExamples = [];
let hallstavikDivisionOne = null;
let eventDateStats2026 = null;
for (const [season, refs] of Object.entries(database.events || {})) {
  const rows = database.years[season];
  const physical = refs.map(([start, count, fragmentCount, teams, eventDateIndex]) => {
    const row = rows[start];
    const eventDate = Number.isInteger(eventDateIndex) ? database.strings[eventDateIndex] || null : null;
    if (eventDate) assert.match(eventDate, /^\d{4}-\d{2}-\d{2}$/, "Invalid ISO event date");
    return {
      start,
      count,
      season,
      home: database.strings[row[5]] || "",
      away: database.strings[row[6]] || "",
      score: database.strings[row[7]] || "",
      league: database.strings[row[8]] || "",
      track: database.strings[row[9]] || "",
      competition: database.strings[row[10]] || "",
      round: database.strings[row[11]] || "",
      capacity: database.strings[row[12]] || "",
      fragmentCount: Number(fragmentCount) || 1,
      teams: Array.isArray(teams) ? teams : [],
      eventDate,
    };
  });
  const logical = core.mergeAdjacentEvents(physical);
  logicalEventCount += logical.length;
  for (const event of logical) {
    if (!event.multiTeam) continue;
    logicalMultiTeamEvents += 1;
    if (mergedEventExamples.length < 5) {
      mergedEventExamples.push({ season, league: event.league, track: event.track, competition: event.competition, round: event.round, participants: event.count, teams: event.teams.length });
    }
  }
  if (season === "2026") {
    let datedEvents = 0;
    let unmatchedEvents = 0;
    let ambiguousEvents = 0;
    let datedRecords = 0;
    let unmatchedRecords = 0;
    let ambiguousRecords = 0;
    for (const event of logical) {
      const fragments = physical.filter((fragment) =>
        fragment.start >= event.start && fragment.start < event.start + event.count
      );
      const dates = [...new Set(fragments.map((fragment) => fragment.eventDate).filter(Boolean))];
      const hasUndatedFragment = fragments.some((fragment) => !fragment.eventDate);
      if (dates.length > 1 || (dates.length === 1 && hasUndatedFragment)) {
        ambiguousEvents += 1;
        ambiguousRecords += event.count;
      } else if (dates.length === 1) {
        assert.equal(event.eventDate, dates[0], "Logical event lost an unambiguous date");
        datedEvents += 1;
        datedRecords += event.count;
      } else {
        assert.equal(event.eventDate, null, "Undated logical event unexpectedly has a date");
        unmatchedEvents += 1;
        unmatchedRecords += event.count;
      }
    }
    eventDateStats2026 = {
      logical_events: logical.length,
      records: rows.length,
      dated_events: datedEvents,
      ambiguous_events: ambiguousEvents,
      unmatched_events: unmatchedEvents,
      dated_records: datedRecords,
      ambiguous_records: ambiguousRecords,
      unmatched_records: unmatchedRecords,
    };
    hallstavikDivisionOne = logical.find((event) =>
      event.league === "Szwecja" &&
      event.track === "Hallstavik" &&
      event.competition === "Division 1" &&
      event.round === "13 runda"
    ) || hallstavikDivisionOne;
  }
}
for (const field of Object.keys(eventDateStats2026)) {
  assert.equal(database.dateStats[field], eventDateStats2026[field], `database.dateStats.${field} differs`);
  assert.equal(version.date_stats[field], eventDateStats2026[field], `version.date_stats.${field} differs`);
}
assert.equal(database.dateStats.date_map_mapping_keys, 1882);
assert.equal(database.dateStats.matching_mapping_keys, 1882);
assert.equal(database.dateStats.stale_mapping_keys, 0);
assert.equal(eventDateStats2026.dated_events, 1029);
assert.equal(eventDateStats2026.dated_records, 14720);
assert.equal(eventDateStats2026.ambiguous_events, 0);
assert.equal(eventDateStats2026.ambiguous_records, 0);
assert.match(version.date_map_sha256, /^[0-9a-f]{64}$/);
assert.equal(version.date_map_sha256, version.event_dates_sha256);
assert.equal(version.dated_event_fragments, 1882);
assert.ok(hallstavikDivisionOne, "Hallstavik Division 1 round 13 is missing");
assert.ok(logicalMultiTeamEvents > 100, "Too few multi-team fragment groups were recognized across WZDB");
assert.equal(hallstavikDivisionOne.count, 13, "Hallstavik event does not contain all 13 riders");
assert.equal(hallstavikDivisionOne.fragmentCount, 4, "Hallstavik event did not merge four fragments");
assert.deepEqual(hallstavikDivisionOne.teams.map((team) => team.name), [
  "Team Campus Roslagen", "Smederna B", "Gnistorna Malmoe", "Piraterna B",
]);

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
  recordsWithStartNumber,
  eventDateStats2026,
  tylerHaupt2026Points: points,
  stableEventKeys: eventKeys.size,
  logicalEvents: logicalEventCount,
  logicalMultiTeamEvents,
  mergedEventExamples,
  hallstavikDivisionOne: {
    participants: hallstavikDivisionOne.count,
    fragments: hallstavikDivisionOne.fragmentCount,
    teams: hallstavikDivisionOne.teams,
  },
  homeAwayClassification: {
    teamEvents,
    classifiedTeamEvents,
    eventPercent: classifiedTeamEvents / teamEvents * 100,
    teamRows,
    classifiedTeamRows,
    rowPercent: classifiedTeamRows / teamRows * 100,
  },
  observedHeatCodes: [...observedHeatCodes].sort(),
  krosno: { records: krosnoMetric.starts, heats: krosnoMetric.heats, heatAvg: krosnoMetric.heatAvg },
}, null, 2));
