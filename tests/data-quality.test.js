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
});

test("fixed Albury logical event is not a split candidate", () => {
  const fixed = event("albury-fixed", {
    count: 17,
    fragmentCount: 4,
    participants: Array.from({ length: 17 }, (_, index) => rider(index + 1)),
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

test("audit cache key and hash invalidate old reports", () => {
  const entry = { hash: "new", report: { summary: {} } };
  assert.equal(quality.auditCacheKey("abc"), "wz2:data-quality:abc");
  assert.equal(quality.isAuditCacheCurrent(entry, "new"), true);
  assert.equal(quality.isAuditCacheCurrent(entry, "old"), false);
});
