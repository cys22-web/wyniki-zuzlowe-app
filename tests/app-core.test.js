const assert = require("node:assert/strict");
const test = require("node:test");

const core = require("../app-core.js");

test("season statistics use the numeric part of Pkt", () => {
  const stats = core.seasonStats([
    { season: "2026", points: "7" },
    { season: "2026", points: "14+2" },
    { season: "2026", points: "d" },
    { season: "2025", points: "10,5" },
  ]);

  assert.equal(stats[0].season, "2026");
  assert.equal(stats[0].starts, 3);
  assert.equal(stats[0].numeric, 2);
  assert.equal(stats[0].total, 21);
  assert.equal(stats[0].bonus, 2);
  assert.equal(stats[0].avg, 10.5);
  assert.equal(stats[0].best, 14);
  assert.equal(stats[1].total, 10.5);
});

test("points parser recognizes only reliable numeric bonus notation", () => {
  assert.deepEqual(core.parsePointsBreakdown("14"), {
    points: 14,
    bonus: 0,
    totalWithBonus: 14,
    reliable: true,
    pointsReliable: true,
  });
  assert.deepEqual(core.parsePointsBreakdown("14+2"), {
    points: 14,
    bonus: 2,
    totalWithBonus: 16,
    reliable: true,
    pointsReliable: true,
  });
  assert.deepEqual(core.parsePointsBreakdown("3 + 1 miejsce w finale"), {
    points: 3,
    bonus: null,
    totalWithBonus: null,
    reliable: false,
    pointsReliable: true,
  });
  assert.equal(core.parsePointsBreakdown("d").reliable, false);
});

test("heat parser handles formats sampled from WZDB and excludes non-starts", () => {
  assert.deepEqual(core.parseHeats("3,2*,d,w,u,t,-,ns"), {
    rides: 5,
    points: 5,
    bonus: 1,
    tokens: 8,
    unknown: 0,
  });
  assert.equal(core.parseHeats("0").rides, 1);
  assert.equal(core.parseHeats("1*,0,0").rides, 3);
  assert.equal(core.parseHeats("w/2min,-,ns").rides, 0);
  assert.equal(core.parseHeats("").rides, 0);
});

const trackRecordsA = [
  { id: "a-k-26", season: "2026", league: "Polska", competition: "Ekstraliga", track: "Krosno", points: "10+1", heats: "3,2*,3,2", key: "k-26" },
  { id: "a-k-25", season: "2025", league: "Polska", competition: "Ekstraliga", track: "Krosno", points: "8", heats: "2,2,2,2", key: "k-25" },
  { id: "a-l-26", season: "2026", league: "Polska", competition: "Ekstraliga", track: "Lublin", points: "12", heats: "3,3,3,3", key: "l-26" },
  { id: "a-k-other", season: "2026", league: "Sparing", competition: "Memoriał", track: "Krosno", points: "6", heats: "3,3", key: "k-other" },
];

const trackRecordsB = [
  { id: "b-k-26", season: "2026", league: "Polska", competition: "Ekstraliga", track: "Krosno", points: "8+1", heats: "2*,2,2,2", key: "k-26" },
  { id: "b-t-25", season: "2025", league: "Polska", competition: "Ekstraliga", track: "Toruń", points: "9", heats: "3,2,2,2", key: "t-25" },
];

test("track filter drives starts, heat average and seasonal chart from one dataset", () => {
  const filtered = core.filterRecords(trackRecordsA, { track: "Krosno" });
  const metric = core.playerMetric(filtered);
  assert.equal(filtered.length, 3);
  assert.equal(metric.starts, filtered.length);
  assert.equal(metric.heats, 10);
  assert.equal(metric.total, 24);
  assert.equal(metric.bonus, 1);
  assert.equal(metric.heatAvg, 2.5);
  assert.deepEqual(metric.seasonStats.map(({ season, starts }) => [season, starts]), [
    ["2026", 2],
    ["2025", 1],
  ]);
  assert.ok(metric.seasonStats.every((season) => season.heatAvg !== null));
});

test("track combines with season, league and competition as logical AND", () => {
  assert.deepEqual(
    core.filterRecords(trackRecordsA, { track: "Krosno", season: "2025" }).map((record) => record.id),
    ["a-k-25"]
  );
  assert.deepEqual(
    core.filterRecords(trackRecordsA, { track: "Krosno", league: "Polska" }).map((record) => record.id),
    ["a-k-26", "a-k-25"]
  );
  assert.deepEqual(
    core.filterRecords(trackRecordsA, { track: "Krosno", competition: "Memoriał" }).map((record) => record.id),
    ["a-k-other"]
  );
  assert.deepEqual(
    core.filterRecords(trackRecordsA, { track: "Krosno", search: "memorial" }).map((record) => record.id),
    ["a-k-other"]
  );
});

test("comparison keeps a rider with no starts on selected track", () => {
  const left = core.playerMetric(core.filterRecords(trackRecordsA, { track: "Lublin" }));
  const right = core.playerMetric(core.filterRecords(trackRecordsB, { track: "Lublin" }));
  assert.equal(left.starts, 1);
  assert.equal(left.heatAvg, 3);
  assert.equal(right.starts, 0);
  assert.equal(right.heats, 0);
  assert.equal(right.heatAvg, null);
});

test("common events and their result use the same track-filtered records", () => {
  const left = core.filterRecords(trackRecordsA, { track: "Krosno", league: "Polska" });
  const right = core.filterRecords(trackRecordsB, { track: "Krosno", league: "Polska" });
  const common = core.commonEvents(left, right);
  assert.equal(common.events.length, 1);
  assert.equal(common.events[0].key, "k-26");
  assert.equal(common.leftWins, 1);
});

test("best season is selected by average without inventing zeroes", () => {
  const metric = core.playerMetric([
    { season: "2024", points: "8" },
    { season: "2025", points: "9" },
    { season: "2025", points: "11+1" },
    { season: "2026", points: "u" },
  ]);

  assert.equal(metric.bestSeason.season, "2025");
  assert.equal(metric.bestSeason.avg, 10);
  assert.equal(metric.seasons, 3);
});

test("fuzzy search ranks Zmarzlik for the Zmarzilk typo", () => {
  const entries = [
    { id: 1, key: "bartosz zmarzlik", tokens: ["bartosz", "zmarzlik"] },
    { id: 2, key: "dominika zmarz", tokens: ["dominika", "zmarz"] },
    { id: 3, key: "dominik kubera", tokens: ["dominik", "kubera"] },
  ];

  assert.equal(core.rankPlayers(entries, "Zmarzilk")[0].id, 1);
  assert.equal(core.rankPlayers(entries, "Kubera")[0].id, 3);
  assert.equal(core.rankPlayers(entries, "Dominik Kubera")[0].tier, 0);
});

test("player deep-link key is stable and independent from array position", () => {
  const player = ["Bartosz Zmarzlik", 12, "1995-04-12", "bartosz zmarzlik"];
  const movedPlayer = ["Bartosz Zmarzlik", 21, "1995-04-12", "bartosz zmarzlik"];

  assert.equal(core.playerDeepLinkKey(player), core.playerDeepLinkKey(movedPlayer));
  const url = core.formatPlayerUrl("https://wyniki-zuzlowe.vercel.app/", player[3]);
  assert.equal(core.routeFromUrl(url).playerKey, "bartosz zmarzlik");
});

test("event key is deterministic, canonical and distinguishes identical occurrences", () => {
  const event = {
    season: "2026",
    home: "Sparta Wrocław",
    away: "Motor Lublin",
    score: "48:42",
    league: "Ekstraliga",
    track: "Wrocław",
    competition: "Mecz",
    round: "Finał",
    capacity: "13000",
  };

  assert.equal(core.stableEventKey(event, 0), core.stableEventKey({ ...event }, 0));
  assert.notEqual(core.stableEventKey(event, 0), core.stableEventKey(event, 1));
  assert.notEqual(
    core.stableEventKey(event, 0),
    core.stableEventKey({ ...event, track: "Lublin" }, 0)
  );
});

test("common events are joined only by the stable event key", () => {
  const result = core.commonEvents(
    [
      { key: "event-a", points: "12+1" },
      { key: "same-name-but-different-event", points: "15" },
      { key: "event-b", points: "8" },
    ],
    [
      { key: "event-a", points: "10" },
      { key: "event-b", points: "8+2" },
      { key: "another-event", points: "15" },
    ]
  );

  assert.equal(result.events.length, 2);
  assert.equal(result.leftWins, 1);
  assert.equal(result.rightWins, 0);
  assert.equal(result.ties, 1);
});

test("routing state round-trips player and event URLs", () => {
  const base = "https://wyniki-zuzlowe.vercel.app/?legacy=1#old";
  const playerUrl = core.urlForRoute(base, {
    view: "player",
    playerKey: "Bartosz Zmarzlik",
  });
  const eventUrl = core.urlForRoute(playerUrl, {
    view: "event",
    eventKey: "e2026-example-0",
  });

  assert.deepEqual(core.routeFromUrl(playerUrl), {
    view: "player",
    playerKey: "bartosz zmarzlik",
  });
  assert.deepEqual(core.routeFromUrl(eventUrl), {
    view: "event",
    eventKey: "e2026-example-0",
  });
  assert.equal(new URL(eventUrl).searchParams.has("player"), false);
  assert.equal(new URL(eventUrl).hash, "");
});

test("latest events reverse sheet order inside the newest season", () => {
  const latest = core.latestEventRefs([
    { season: "2025", order: 99, key: "old" },
    { season: "2026", order: 1, key: "first" },
    { season: "2026", order: 3, key: "last" },
    { season: "2026", order: 2, key: "middle" },
  ], 3);

  assert.deepEqual(latest.map((event) => event.key), ["last", "middle", "first"]);
});

const thresholdRecords = [
  { id: "old", season: "2024", order: 1, league: "Polska", track: "Wrocław", competition: "Liga", homeAway: "AWAY", points: "7", heats: "2,2,2,1" },
  { id: "middle", season: "2025", order: 2, league: "Polska", track: "Lublin", competition: "Liga", homeAway: "HOME", points: "8", heats: "2,2,2,2" },
  { id: "new", season: "2026", order: 3, league: "Polska", track: "Wrocław", competition: "Liga", homeAway: "AWAY", points: "10+2", heats: "3,3,2*,2" },
  { id: "dnf", season: "2026", order: 4, league: "Szwecja", track: "Malilla", competition: "Liga", homeAway: "UNKNOWN", points: "d", heats: "d" },
];

test("threshold analysis counts over and under 8.5", () => {
  const result = core.analyzeThreshold(thresholdRecords, 8.5);
  assert.equal(result.sample, 3);
  assert.equal(result.over, 1);
  assert.equal(result.under, 2);
  assert.ok(Math.abs(result.overPct - 100 / 3) < 1e-12);
});

test("integer threshold reports push separately", () => {
  const result = core.analyzeThreshold(thresholdRecords, 8);
  assert.deepEqual([result.over, result.under, result.push], [1, 1, 1]);
});

test("points and points plus bonus use the requested settlement", () => {
  assert.equal(core.analyzeThreshold([thresholdRecords[2]], 11, { pointsMode: "points" }).under, 1);
  assert.equal(core.analyzeThreshold([thresholdRecords[2]], 11, { pointsMode: "pointsBonus" }).over, 1);
  assert.equal(core.analyzeThreshold([{ points: "3 + 1 miejsce w finale" }], 2, { pointsMode: "pointsBonus" }).sample, 0);
});

test("threshold median and population standard deviation are deterministic", () => {
  const result = core.analyzeThreshold(thresholdRecords, 8.5);
  assert.equal(result.median, 8);
  assert.ok(Math.abs(result.standardDeviation - Math.sqrt(14 / 9)) < 1e-12);
});

test("last 5 and last 10 are selected only after the supplied filters", () => {
  const records = Array.from({ length: 12 }, (_, index) => ({ season: "2026", order: index, points: String(index) }));
  assert.deepEqual(core.analyzeThreshold(records, 0, { lastN: 5 }).results.map((item) => item.value), [7, 8, 9, 10, 11]);
  assert.deepEqual(core.analyzeThreshold(records, 0, { lastN: 10 }).results.map((item) => item.value), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  const filtered = core.filterRecords(thresholdRecords, { league: "Polska", track: "Wrocław" });
  assert.equal(core.analyzeThreshold(filtered, 8.5, { lastN: 5 }).sample, 2);
});

test("league, track and their combination filter the threshold dataset", () => {
  assert.equal(core.filterRecords(thresholdRecords, { league: "Polska" }).length, 3);
  assert.equal(core.filterRecords(thresholdRecords, { track: "Wrocław" }).length, 2);
  assert.deepEqual(core.filterRecords(thresholdRecords, { league: "Polska", track: "Wrocław" }).map((item) => item.id), ["old", "new"]);
});

test("home, away, unknown and away plus track are explicit", () => {
  assert.deepEqual(core.filterRecords(thresholdRecords, { homeAway: "HOME" }).map((item) => item.id), ["middle"]);
  assert.deepEqual(core.filterRecords(thresholdRecords, { homeAway: "AWAY" }).map((item) => item.id), ["old", "new"]);
  assert.deepEqual(core.filterRecords(thresholdRecords, { homeAway: "UNKNOWN" }).map((item) => item.id), ["dnf"]);
  assert.deepEqual(core.filterRecords(thresholdRecords, { homeAway: "AWAY", track: "Wrocław" }).map((item) => item.id), ["old", "new"]);
});

test("team side is classified only when a unique score-confirmed split exists", () => {
  const rows = [10, 9, 8, 7, 6, 5, 11, 10, 9, 8, 7, 6].map((points) => ({ points: String(points) }));
  const classified = core.classifyTeamEvent(rows, { home: "A", away: "B", score: "45-51" });
  assert.equal(classified.classified, true);
  assert.deepEqual(classified.sides, ["HOME", "HOME", "HOME", "HOME", "HOME", "HOME", "AWAY", "AWAY", "AWAY", "AWAY", "AWAY", "AWAY"]);
  assert.equal(core.classifyTeamEvent(rows, { home: "A", away: "B", score: "40-40" }).classified, false);
});

test("cascading filter options come from the player dataset and other active filters", () => {
  const options = core.cascadingFilterOptions(thresholdRecords, { league: "Polska", season: "2026" });
  assert.deepEqual(options.track, ["Wrocław"]);
  assert.deepEqual(options.competition, ["Liga"]);
  assert.deepEqual(options.league, ["Polska", "Szwecja"]);
  assert.equal(options.track.includes("Malilla"), false);
});

test("results, statistics and threshold can consume the identical filtered array", () => {
  const filtered = core.filterRecords(thresholdRecords, { league: "Polska", track: "Wrocław" });
  assert.equal(core.playerMetric(filtered).starts, filtered.length);
  assert.equal(core.analyzeThreshold(filtered, 8.5).sample, filtered.length);
});

test("threshold deep link round-trips stable player key and core analysis filters", () => {
  const url = core.urlForRoute("https://wyniki-zuzlowe.vercel.app/", {
    view: "player", playerKey: "Bartosz Zmarzlik", profileView: "threshold",
    threshold: "8.5", league: "Polska", track: "Wrocław", homeAway: "AWAY", lastN: 10,
  });
  const route = core.routeFromUrl(url);
  assert.equal(route.playerKey, "bartosz zmarzlik");
  assert.equal(route.profileView, "threshold");
  assert.equal(route.track, "Wrocław");
  assert.equal(route.homeAway, "AWAY");
  assert.equal(route.lastN, 10);
});
