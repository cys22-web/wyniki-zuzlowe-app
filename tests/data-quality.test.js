const assert = require("node:assert/strict");
const test = require("node:test");

const quality = require("../data-quality.js");

function rider(id, overrides = {}) {
  return {
    id,
    playerKey: `rider ${id}`,
    name: `Rider ${id}`,
    points: "3",
    heats: "3",
    startNumber: String(id),
    rowIndex: id,
    ...overrides,
  };
}

function event(key, overrides = {}) {
  const participants = overrides.participants || [rider(1), rider(2), rider(3), rider(4)];
  return {
    key,
    eventKey: key,
    season: "2026",
    eventDate: "2026-01-04",
    league: "Australia",
    track: "Albury-Wodonga",
    competition: "IM Australii",
    round: "2 runda",
    capacity: "",
    type: "individual",
    count: participants.length,
    fragmentCount: 1,
    rowStart: 4,
    rowEnd: 7,
    participants,
    ...overrides,
  };
}

function scopedDatabase() {
  const strings = [""];
  const intern = (value) => { strings.push(value); return strings.length - 1; };
  const points = intern("3"), heats = intern("3"), league = intern("Test League"), competition = intern("Test Cup"), round = intern("Finał");
  const track2025 = intern("Heusden Zolder"), track2026 = intern("Heusden-Zolder"), startNumber = intern("5");
  const players = Array.from({ length: 12 }, (_, index) => [`Rider ${index + 1}`, 0, "", `rider ${index + 1}`]);
  const rows = (track, count) => Array.from({ length: count }, (_, index) => [index, points, heats, 0, 0, 0, 0, 0, league, track, competition, round, 0, 0, startNumber]);
  return {
    strings,
    players,
    years: { "2025": rows(track2025, 12), "2026": rows(track2026, 4) },
    events: { "2025": [[0, 12, 1, [], "2025-06-01"]], "2026": [[0, 4, 1, [], "2026-06-01"]] },
    eventDateDiagnostics: [{ season: "2025", type: "missing" }, { season: "2026", type: "missing" }],
  };
}

test("old Albury layout is a HIGH split candidate", () => {
  const events = Array.from({ length: 4 }, (_, index) => event(`albury-${index}`, {
    participants: Array.from({ length: index === 3 ? 5 : 4 }, (__, riderIndex) => rider(index * 4 + riderIndex + 1)),
    rowStart: 4 + index * 4,
    rowEnd: index === 3 ? 20 : 7 + index * 4,
  }));
  const result = quality.findSplitCandidates(events);
  assert.equal(result.length, 1);
  assert.equal(result[0].confidence, "HIGH");
  assert.equal(result[0].logicalEvents, 4);
  assert.equal(result[0].participantsTotal, 17);
  assert.equal(result[0].rowContiguous, true);
  assert.equal(result[0].teamShaped, false);
});

test("team-shaped or non-contiguous split candidates stay REVIEW", () => {
  const events = Array.from({ length: 4 }, (_, index) => event(`team-fragment-${index}`, {
    away: `Team ${index + 1}`,
    score: String(40 - index),
    participants: [rider(index * 2 + 1), rider(index * 2 + 2)],
    rowStart: 4 + index * 3,
    rowEnd: 5 + index * 3,
  }));
  const [result] = quality.findSplitCandidates(events);
  assert.equal(result.confidence, "REVIEW");
  assert.equal(result.rowContiguous, false);
  assert.equal(result.teamShaped, true);
});

test("fixed Albury logical event is not a split candidate", () => {
  const fixed = event("albury-fixed", {
    count: 17,
    fragmentCount: 4,
    participants: Array.from({ length: 17 }, (_, index) => rider(index + 1)),
  });
  assert.deepEqual(quality.findSplitCandidates([fixed]), []);
});

test("Zlata Prilba split fixture is HIGH before merge and absent after merge", () => {
  const placements = [
    ["1", "miejsce w finale", ""],
    ["2", "miejsce w finale", ""],
    ["3", "miejsce w finale", ""],
    ["2", "miejsce w barażu", "4m w finale"],
    ["1", "miejsce w barażu", "5, w finale"],
    ["6", "miejsce w finale", ""],
    ["3", "miejsce w barażu", ""],
    ["4", "miejsce w barażu", ""],
    ["5", "miejsce w barażu", ""],
    ["", "", ""],
  ];
  let nextRow = 16470;
  const split = placements.map(([home, away, score], index) => {
    const count = index === placements.length - 1 ? 11 : 1;
    const rowStart = nextRow;
    nextRow += count;
    return event(`zarnowica-${index}`, {
      eventDate: "2026-08-30",
      league: "Słowacja",
      track: "Żarnowica",
      competition: "Zlata Prilba",
      round: "",
      home,
      away,
      score,
      count,
      rowStart,
      rowEnd: nextRow - 1,
      participants: Array.from({ length: count }, (__, riderIndex) => rider(rowStart + riderIndex)),
    });
  });

  const [candidate] = quality.findSplitCandidates(split);
  assert.equal(candidate.confidence, "HIGH");
  assert.equal(candidate.logicalEvents, 10);
  assert.equal(candidate.participantsTotal, 20);
  assert.equal(candidate.teamShaped, false);

  const fixed = event("zarnowica-fixed", {
    eventDate: "2026-08-30",
    league: "Słowacja",
    track: "Żarnowica",
    competition: "Zlata Prilba",
    round: "",
    count: 20,
    fragmentCount: 10,
    rowStart: 16470,
    rowEnd: 16489,
    participants: Array.from({ length: 20 }, (__, index) => rider(16470 + index)),
  });
  assert.deepEqual(quality.findSplitCandidates([fixed]), []);
});

test("capacity is a hard boundary for split detection", () => {
  const left = event("125", { capacity: "125 cc" });
  const right = event("250", { capacity: "250 cc", participants: [rider(5), rider(6), rider(7), rider(8)] });
  assert.deepEqual(quality.findSplitCandidates([left, right]), []);
});

test("correct Hallstavik multi-team event is not a split candidate", () => {
  const hallstavik = event("hallstavik", {
    eventDate: "2026-06-01",
    league: "Szwecja",
    track: "Hallstavik",
    competition: "Division 1",
    round: "",
    type: "multi",
    count: 13,
    fragmentCount: 4,
    multiTeam: true,
    teamKeys: ["Team Campus Roslagen", "Smederna B", "Gnistorna Malmoe", "Piraterna B"],
    participants: Array.from({ length: 13 }, (_, index) => rider(index + 1)),
  });
  assert.deepEqual(quality.findSplitCandidates([hallstavik]), []);
});

test("participant count statistics alone stay REVIEW", () => {
  const events = Array.from({ length: 10 }, (_, index) => event(`typical-${index}`, {
    eventDate: `2026-02-${String(index + 1).padStart(2, "0")}`,
    participants: Array.from({ length: 12 }, (__, riderIndex) => rider(index * 20 + riderIndex + 1)),
  }));
  events.push(event("small-group", {
    eventDate: "2026-03-01",
    participants: [rider(501), rider(502), rider(503), rider(504)],
  }));
  const report = quality.auditDataQuality({ events, latestSeason: "2026" });
  const outlier = report.sections.participantOutliers.find((item) => item.eventKey === "small-group");
  assert.equal(outlier.confidence, "REVIEW");
});

test("very small events also need evidence beyond participant statistics", () => {
  const events = Array.from({ length: 5 }, (_, index) => event(`full-${index}`, {
    participants: Array.from({ length: 12 }, (__, riderIndex) => rider(index * 20 + riderIndex + 1)),
  }));
  events.push(event("two-riders", { participants: [rider(501), rider(502)] }));
  const issue = quality.findSmallEvents(events).find((item) => item.eventKey === "two-riders");
  assert.equal(issue.confidence, "REVIEW");
});

test("duplicate logical events require strong participant overlap", () => {
  const left = event("dup-a", { participants: [rider(1), rider(2), rider(3), rider(4)] });
  const right = event("dup-b", { participants: [rider(1), rider(2), rider(3), rider(4)] });
  const result = quality.findDuplicateEvents([left, right]);
  assert.equal(result.length, 1);
  assert.equal(result[0].confidence, "HIGH");
  assert.equal(result[0].participantSimilarity, 1);
});

test("missing and invalid dates are reported without escalating historical absence", () => {
  const missingLatest = event("missing", { eventDate: "" });
  const missingOld = event("old", { season: "2018", eventDate: "" });
  const invalid = event("invalid", { eventDate: "2026-02-31" });
  const result = quality.findDateIssues([missingLatest, missingOld, invalid], [], "2026");
  assert.equal(result.find((item) => item.eventKey === "missing").confidence, "HIGH");
  assert.equal(result.find((item) => item.eventKey === "old").confidence, "REVIEW");
  assert.equal(result.find((item) => item.eventKey === "invalid").category, "invalid_date");
});

test("suspicious start number catches years and unusual values", () => {
  assert.equal(quality.suspiciousStartNumber("2026").type, "looks_like_year");
  assert.equal(quality.suspiciousStartNumber("1234567890123").type, "too_long");
  assert.equal(quality.suspiciousStartNumber("nr pięć").type, "unusual_format");
  assert.equal(quality.suspiciousStartNumber("5"), null);
});

test("track and team REVIEW candidates reuse the canonical alias audit", () => {
  const track = quality.aliasIssues([
    { value: "Częstochowa", count: 30, seasons: ["2026"] },
    { value: "Częstochwa", count: 1, seasons: ["2026"] },
  ], "track");
  const team = quality.aliasIssues([
    { value: "Lahti I", count: 2, seasons: ["2026"] },
    { value: "Lahti II", count: 1, seasons: ["2026"] },
  ], "team");
  assert.equal(track[0].confidence, "REVIEW");
  assert.equal(team[0].confidence, "REVIEW");
});

test("player duplicate candidate uses full name plus identity evidence", () => {
  const result = quality.findPlayerDuplicates([
    { id: 1, key: "jan kowalski", name: "Jan Kowalski", birthDate: "2000-01-01", nationality: "Polska", count: 12, seasons: ["2025", "2026"] },
    { id: 2, key: "kowalski jan", name: "Kowalski Jan", birthDate: "2000-01-01", nationality: "Polska", count: 8, seasons: ["2026"] },
    { id: 3, key: "adam kowalski", name: "Adam Kowalski", birthDate: "1998-01-01", nationality: "Polska", count: 10, seasons: ["2026"] },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].confidence, "HIGH");
  assert.match(result[0].reason, /zamieniona kolejność/);
});

test("unknown birth markers never create HIGH player identity evidence", () => {
  const result = quality.findPlayerDuplicates([
    { id: 1, key: "ernst frank", name: "Ernst Frank", birthDate: "?", nationality: "Niemcy", count: 4, seasons: ["2020"] },
    { id: 2, key: "frank ernst", name: "Frank Ernst", birthDate: "?", nationality: "Niemcy", count: 3, seasons: ["2020"] },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].confidence, "REVIEW");
  assert.doesNotMatch(result[0].reason, /data urodzenia/);
});

test("classified team score mismatch is HIGH", () => {
  const match = event("match", {
    type: "team",
    home: "A",
    away: "B",
    score: "10-8",
    participants: [
      rider(1, { points: "3" }), rider(2, { points: "3" }), rider(3, { points: "3" }),
      rider(4, { points: "2" }), rider(5, { points: "2" }), rider(6, { points: "2" }),
    ],
    classification: { classified: true, sides: ["HOME", "HOME", "HOME", "AWAY", "AWAY", "AWAY"] },
  });
  const result = quality.findScoreIssues([match]);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].confidence, "HIGH");
});

test("unknown team classification does not create a mismatch alarm", () => {
  const match = event("unknown", {
    type: "team",
    home: "A",
    away: "B",
    score: "40-40",
    participants: [rider(1), rider(2), rider(3), rider(4), rider(5), rider(6)],
    classification: { classified: false, sides: Array(6).fill("UNKNOWN") },
  });
  const result = quality.findScoreIssues([match]);
  assert.equal(result.issues.length, 0);
  assert.equal(result.unknown, 1);
});

test("points and heats inconsistency is conservative but visible", () => {
  const bad = event("bad-heats", {
    participants: [rider(1, { points: "20", heats: "3,3,3" })],
  });
  const result = quality.findPointsHeatIssues([bad]);
  assert.equal(result.length, 1);
  assert.equal(result[0].confidence, "HIGH");
});

test("unknown heat tokens prevent HIGH confidence", () => {
  const incomplete = event("incomplete-heats", {
    participants: [rider(1, { points: "20", heats: "3,3,3,X" })],
  });
  const result = quality.findPointsHeatIssues([incomplete]);
  assert.equal(result.length, 1);
  assert.equal(result[0].confidence, "REVIEW");
  assert.equal(result[0].heats.unknown, 1);
});

test("sorting puts HIGH before REVIEW by default", () => {
  const sorted = quality.sortIssues([
    { category: "b", confidence: "REVIEW", season: "2026", date: "2026-08-01" },
    { category: "a", confidence: "HIGH", season: "2025", date: "2025-01-01" },
  ]);
  assert.equal(sorted[0].confidence, "HIGH");
});

test("CSV generation escapes technical fields", () => {
  const csv = quality.issuesToCSV([{
    category: "split_candidate",
    confidence: "HIGH",
    season: "2026",
    reason: 'To samo, ale "podzielone"',
  }]);
  assert.match(csv, /^category,confidence,season/);
  assert.match(csv, /"To samo, ale ""podzielone"""/);
});

test("season audit builds a genuinely scoped model instead of filtering a full report", () => {
  const database = scopedDatabase();
  const scoped = quality.auditDataQuality(quality.buildAuditInput(database, { seasons: ["2026"] }));
  const full = quality.auditDataQuality(quality.buildAuditInput(database));
  assert.equal(scoped.issues.some((item) => item.category.startsWith("track_alias_")), false);
  assert.equal(quality.filterIssues(full.issues, { season: "2026" }).some((item) => item.category.startsWith("track_alias_")), true);
});

test("season audit scopes participant distributions, players and date diagnostics", () => {
  const model = quality.buildAuditInput(scopedDatabase(), { seasons: ["2026"] });
  assert.equal(model.events.length, 1);
  assert.equal(model.events[0].count, 4);
  assert.equal(model.players.length, 4);
  assert.deepEqual(model.dateDiagnostics.map((item) => item.season), ["2026"]);
});

test("all-season audit still includes the complete database", () => {
  const model = quality.buildAuditInput(scopedDatabase());
  assert.equal(model.events.length, 2);
  assert.equal(model.events.reduce((sum, item) => sum + item.count, 0), 16);
  assert.deepEqual(model.trackEntries.flatMap((item) => item.seasons).sort(), ["2025", "2026"]);
});

test("latest season is calculated inside the selected audit scope", () => {
  const model = quality.buildAuditInput(scopedDatabase(), { seasons: ["2025"] });
  assert.equal(model.latestSeason, "2025");
  assert.deepEqual(model.events.map((item) => item.season), ["2025"]);
});

test("audit cache key and hash invalidate old reports", () => {
  const entry = { hash: "new", season: "", report: { summary: {} } };
  const seasonEntry = { hash: "new", season: "2026", report: { summary: {} } };
  assert.equal(quality.auditCacheKey("abc"), "wz2:data-quality:abc");
  assert.equal(quality.auditCacheKey("abc", "2026"), "wz2:data-quality:abc:season:2026");
  assert.equal(quality.isAuditCacheCurrent(entry, "new"), true);
  assert.equal(quality.isAuditCacheCurrent(entry, "old"), false);
  assert.equal(quality.isAuditCacheCurrent(seasonEntry, "new", "2026"), true);
  assert.equal(quality.isAuditCacheCurrent(seasonEntry, "new"), false);
  assert.equal(quality.isAuditCacheCurrent(entry, "new", "2026"), false);
});
