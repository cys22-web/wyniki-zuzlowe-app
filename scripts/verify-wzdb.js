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
      const startNumber = row[14] === null ? "" : database.strings[row[14]] || "";
      if (startNumber) {
        assert.notEqual(startNumber, "2026", "Season from Excel column N was exported as a start number");
        recordsWithStartNumber += 1;
      }
    }
    totalRecords += 1;
  }
}
assert.equal(totalRecords, database.stats.rows, "Record validation did not cover the database");
assert.ok(recordsWithStartNumber > 0, "No start numbers were exported from Excel column A");

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
let logicalFragmentedIndividualEvents = 0;
const fragmentedIndividualEvents2026 = [];
const mergedEventExamples = [];
let hallstavikDivisionOne = null;
let hallstavikDivisionOneCount = 0;
let hallstavikCapacities = [];
let alburyRounds = [];
let zarnovicaZlataPrilba = null;
let zarnovicaPhysicalFragments = [];
let eventDateStats2026 = null;
const capacityBoundaryGroups2026 = [];
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
    if (event.multiTeam) {
      logicalMultiTeamEvents += 1;
      if (mergedEventExamples.length < 5) {
        mergedEventExamples.push({ season, league: event.league, track: event.track, competition: event.competition, round: event.round, participants: event.count, teams: event.teams.length });
      }
    } else if (event.fragmentCount > 1 && event.eventDate) {
      logicalFragmentedIndividualEvents += 1;
      if (season === "2026") {
        fragmentedIndividualEvents2026.push({
          date: event.eventDate,
          track: event.track,
          competition: event.competition,
          round: event.round,
          participants: event.count,
          fragments: event.fragmentCount,
        });
      }
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
      if (dates.length > 1) {
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
    const hallstavikEvents = logical.filter((event) =>
      event.league === "Szwecja" &&
      event.track === "Hallstavik" &&
      event.competition === "Division 1" &&
      event.round === "13 runda"
    );
    hallstavikDivisionOneCount = hallstavikEvents.length;
    hallstavikDivisionOne = hallstavikEvents[0] || hallstavikDivisionOne;
    hallstavikCapacities = [...new Set(physical.filter((event) =>
      event.league === "Szwecja" &&
      event.track === "Hallstavik" &&
      event.competition === "Division 1" &&
      event.round === "13 runda"
    ).map((event) => String(event.capacity || "").trim()))];
    alburyRounds = logical.filter((event) =>
      event.league === "Australia" &&
      event.track === "Albury-Wodonga" &&
      event.competition === "IM Australii" &&
      ["1 runda", "2 runda"].includes(event.round)
    );
    zarnovicaPhysicalFragments = physical.filter((event) =>
      event.eventDate === "2026-08-30" &&
      event.league === "Słowacja" &&
      event.track === "Żarnowica" &&
      event.competition === "Zlata Prilba" &&
      event.round === "" &&
      event.capacity === ""
    );
    zarnovicaZlataPrilba = logical.find((event) =>
      event.eventDate === "2026-08-30" &&
      event.league === "Słowacja" &&
      event.track === "Żarnowica" &&
      event.competition === "Zlata Prilba" &&
      event.round === "" &&
      event.capacity === ""
    );

    const broadIdentity = (event) => [
      event.season, event.league, event.track, event.competition, event.round,
    ].map((value) => String(value || "").trim()).join("\u0000");
    for (let physicalIndex = 0; physicalIndex < physical.length;) {
      const first = physical[physicalIndex];
      const identity = broadIdentity(first);
      let physicalEnd = physicalIndex + 1;
      while (
        physicalEnd < physical.length &&
        broadIdentity(physical[physicalEnd]) === identity &&
        physical[physicalEnd - 1].start + physical[physicalEnd - 1].count === physical[physicalEnd].start
      ) physicalEnd += 1;

      const run = physical.slice(physicalIndex, physicalEnd);
      const capacities = [...new Set(run.map((event) => String(event.capacity || "").trim()))];
      if (capacities.length > 1) {
        const runStart = run[0].start;
        const runEnd = run.at(-1).start + run.at(-1).count;
        const logicalEvents = logical.filter((event) =>
          event.start < runEnd && event.start + event.count > runStart
        );
        for (const event of logicalEvents) {
          const eventCapacities = [...new Set(run.filter((fragment) =>
            fragment.start >= event.start && fragment.start < event.start + event.count
          ).map((fragment) => String(fragment.capacity || "").trim()))];
          assert.ok(eventCapacities.length <= 1, "Logical event crosses a capacity boundary");
        }
        capacityBoundaryGroups2026.push({
          date: first.eventDate,
          track: first.track,
          competition: first.competition,
          round: first.round,
          capacities: capacities.map((value) => value || "(blank)"),
          physicalEvents: run.length,
          logicalEvents: logicalEvents.length,
        });
      }
      physicalIndex = physicalEnd;
    }
  }
}
const generatedLogicalCountFields = new Set(["logical_events", "dated_events"]);
for (const field of Object.keys(eventDateStats2026)) {
  if (generatedLogicalCountFields.has(field)) {
    // These two metadata counts describe the generator-time logical merger.
    // Runtime PWA fixes may legitimately reduce them without rewriting WZDB.
    assert.equal(database.dateStats[field], version.date_stats[field], `stored ${field} metadata differs`);
    assert.ok(database.dateStats[field] >= eventDateStats2026[field], `runtime ${field} unexpectedly exceeds stored metadata`);
  } else {
    assert.equal(database.dateStats[field], eventDateStats2026[field], `database.dateStats.${field} differs`);
    assert.equal(version.date_stats[field], eventDateStats2026[field], `version.date_stats.${field} differs`);
  }
}
assert.equal(eventDateStats2026.dated_events, eventDateStats2026.logical_events);
assert.equal(eventDateStats2026.dated_records, eventDateStats2026.records);
assert.equal(eventDateStats2026.ambiguous_events, 0);
assert.equal(eventDateStats2026.ambiguous_records, 0);
assert.equal(eventDateStats2026.unmatched_events, 0);
assert.equal(eventDateStats2026.unmatched_records, 0);
assert.equal(database.dateStats.conflicts, 0);
assert.equal(database.dateStats.events_without_date, 0);
assert.equal(database.dateStats.records_without_date, 0);
assert.equal(version.event_date_source, "PL2.xlsm:Q/Data");
assert.equal(version.dated_event_fragments, database.dateStats.dated_physical_events);
if (version.date_map_sha256 !== null) {
  assert.match(version.date_map_sha256, /^[0-9a-f]{64}$/);
  assert.equal(version.date_map_sha256, version.event_dates_sha256);
}
assert.ok(hallstavikDivisionOne, "Hallstavik Division 1 round 13 is missing");
assert.ok(logicalMultiTeamEvents > 100, "Too few multi-team fragment groups were recognized across WZDB");
assert.equal(logicalFragmentedIndividualEvents, 14, "The 13 established merges plus Žarnovica regressed");
assert.equal(capacityBoundaryGroups2026.length, 10, "Unexpected number of mixed-capacity groups in 2026");
assert.equal(hallstavikDivisionOneCount, 1, "Hallstavik Division 1 should be one logical event");
assert.equal(hallstavikDivisionOne.count, 13, "Hallstavik event does not contain all 13 riders");
assert.equal(hallstavikDivisionOne.fragmentCount, 4, "Hallstavik event did not merge four fragments");
assert.deepEqual(hallstavikDivisionOne.teams.map((team) => team.name), [
  "Team Campus Roslagen", "Smederna B", "Gnistorna Malmoe", "Piraterna B",
]);
assert.deepEqual(hallstavikCapacities, [""], "Hallstavik fragments should have compatible blank capacity");
assert.equal(alburyRounds.length, 2, "Albury IM Australii should have one logical event per round");
assert.deepEqual(alburyRounds.map((event) => ({
  round: event.round,
  date: event.eventDate,
  participants: event.count,
  fragments: event.fragmentCount,
})), [
  { round: "1 runda", date: "2026-01-03", participants: 17, fragments: 1 },
  { round: "2 runda", date: "2026-01-04", participants: 17, fragments: 4 },
]);
const landshutBayernCup = capacityBoundaryGroups2026.find((event) =>
  event.track === "Landshut" && event.competition === "ADAC Bayern Cup"
);
const stralsundLigaNord = capacityBoundaryGroups2026.find((event) =>
  event.track === "Stralsund" && event.competition === "Liga Nord"
);
assert.deepEqual(
  { physicalEvents: landshutBayernCup?.physicalEvents, logicalEvents: landshutBayernCup?.logicalEvents },
  { physicalEvents: 15, logicalEvents: 15 },
  "Landshut ADAC Bayern Cup capacity boundaries regressed"
);
assert.deepEqual(
  { physicalEvents: stralsundLigaNord?.physicalEvents, logicalEvents: stralsundLigaNord?.logicalEvents },
  { physicalEvents: 13, logicalEvents: 12 },
  "Stralsund Liga Nord capacity boundaries regressed"
);
assert.ok(zarnovicaZlataPrilba, "Zlata Prilba Žarnovica logical event is missing");
assert.equal(zarnovicaPhysicalFragments.length, 10, "Zlata Prilba should retain ten physical fragments");
assert.equal(zarnovicaZlataPrilba.count, 20, "Zlata Prilba should contain all 20 riders");
assert.equal(zarnovicaZlataPrilba.fragmentCount, 10, "Zlata Prilba should merge ten fragments");
assert.equal(zarnovicaZlataPrilba.multiTeam, false, "Zlata Prilba must remain individual");
assert.deepEqual(zarnovicaZlataPrilba.teams, [], "Zlata Prilba must not invent teams from G:I");

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
  storedEventDateStats2026: database.dateStats,
  tylerHaupt2026Points: points,
  stableEventKeys: eventKeys.size,
  logicalEvents: logicalEventCount,
  logicalMultiTeamEvents,
  logicalFragmentedIndividualEvents,
  fragmentedIndividualEvents2026,
  capacityBoundaryGroups2026,
  mergedEventExamples,
  hallstavikDivisionOne: {
    participants: hallstavikDivisionOne.count,
    fragments: hallstavikDivisionOne.fragmentCount,
    teams: hallstavikDivisionOne.teams,
    capacities: hallstavikCapacities.map((value) => value || "(blank)"),
  },
  alburyRounds: alburyRounds.map((event) => ({
    round: event.round,
    date: event.eventDate,
    participants: event.count,
    fragments: event.fragmentCount,
  })),
  zarnovicaZlataPrilba: {
    participants: zarnovicaZlataPrilba.count,
    fragments: zarnovicaZlataPrilba.fragmentCount,
    physicalFragments: zarnovicaPhysicalFragments.length,
    teams: zarnovicaZlataPrilba.teams,
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
