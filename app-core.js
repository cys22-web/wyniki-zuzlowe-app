(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.WZAppCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/ł/g, "l")
      .trim()
      .replace(/\s+/g, " ");
  }

  function eventDateValue(value) {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString().slice(0, 10);
    }
    const text = String(value).trim();
    if (/^\d+(?:\.\d+)?$/.test(text)) {
      const serial = Number(text);
      if (!Number.isFinite(serial)) throw new Error(`Invalid Excel date serial: ${text}`);
      return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000)
        .toISOString()
        .slice(0, 10);
    }
    let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      const local = text.match(/^(\d{2})[./](\d{2})[./](\d{4})$/);
      if (local) match = [local[0], local[3], local[2], local[1]];
    }
    if (!match) throw new Error(`Unsupported event date: ${text}`);
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    ) throw new Error(`Invalid event date: ${text}`);
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function resolveEventDate(values) {
    const dates = new Set();
    const invalidValues = [];
    for (const item of values || []) {
      const value = item && typeof item === "object" && "value" in item ? item.value : item;
      try {
        const parsed = eventDateValue(value);
        if (parsed) dates.add(parsed);
      } catch (error) {
        invalidValues.push({ value: String(value), error: error.message || String(error) });
      }
    }
    const eventDateCandidates = [...dates].sort();
    const eventDateConflict = eventDateCandidates.length > 1 || invalidValues.length > 0;
    return {
      eventDate: !eventDateConflict && eventDateCandidates.length === 1
        ? eventDateCandidates[0]
        : null,
      eventDateConflict,
      eventDateCandidates,
      invalidValues,
    };
  }

  function basePoints(value) {
    const match = String(value || "")
      .trim()
      .replace(",", ".")
      .match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function parsePointsBreakdown(value) {
    const text = String(value ?? "").trim();
    const match = text.match(
      /^(\d+(?:[.,]\d+)?)\s*(?:\+\s*(\d+(?:[.,]\d+)?))?$/
    );
    if (!match) {
      const leading = text.match(/^(\d+(?:[.,]\d+)?)/);
      const points = leading ? Number(leading[1].replace(",", ".")) : null;
      return {
        points,
        bonus: null,
        totalWithBonus: null,
        reliable: false,
        pointsReliable: points !== null,
      };
    }
    const points = Number(match[1].replace(",", "."));
    const bonus = match[2] ? Number(match[2].replace(",", ".")) : 0;
    return {
      points,
      bonus,
      totalWithBonus: points + bonus,
      reliable: true,
      pointsReliable: true,
    };
  }

  /*
   * WZDB stores one heat entry per comma-separated token. Numeric entries and
   * on-track codes (d/u/w/f) count as rides. Empty slots, '-', ns and tape/time
   * exclusions do not: they do not prove that a heat was actually ridden.
   */
  function parseHeats(value) {
    const text = String(value ?? "").trim();
    if (!text) {
      return { rides: 0, points: 0, bonus: 0, tokens: 0, unknown: 0 };
    }
    let rides = 0;
    let points = 0;
    let bonus = 0;
    let unknown = 0;
    const tokens = text.split(",").map((token) => token.trim());
    for (const original of tokens) {
      const token = original.toLowerCase().replace(/^[([]+|[)\]]+$/g, "").trim();
      if (!token || /^(?:-|–|—|ns|n|r|m|\?|z\/z)$/i.test(token)) continue;
      if (/^(?:t|tt|w\/(?:2m|2min))(?:\b|[!/])/i.test(token)) continue;
      const numeric = token.match(/^(\d+(?:[.]\d+)?)(\*)?/);
      if (numeric) {
        rides += 1;
        points += Number(numeric[1]);
        if (numeric[2]) bonus += 1;
        continue;
      }
      if (/^(?:d|u|w|f)(?:\b|[!/0-9])/i.test(token)) {
        rides += 1;
        continue;
      }
      unknown += 1;
    }
    return { rides, points, bonus, tokens: tokens.length, unknown };
  }

  function boundedDamerauLevenshtein(left, right, maxDistance = 2) {
    const a = normalize(left);
    const b = normalize(right);
    if (a === b) return 0;
    if (!a || !b) return Math.max(a.length, b.length);
    if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

    let previousPrevious = null;
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
      const current = [i];
      let rowMinimum = current[0];
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let distance = Math.min(
          current[j - 1] + 1,
          previous[j] + 1,
          previous[j - 1] + cost
        );
        if (
          previousPrevious &&
          i > 1 &&
          j > 1 &&
          a[i - 1] === b[j - 2] &&
          a[i - 2] === b[j - 1]
        ) {
          distance = Math.min(distance, previousPrevious[j - 2] + 1);
        }
        current[j] = distance;
        rowMinimum = Math.min(rowMinimum, distance);
      }
      if (rowMinimum > maxDistance) return maxDistance + 1;
      previousPrevious = previous;
      previous = current;
    }
    return previous[b.length];
  }

  function searchTier(entry, query) {
    const key = entry.key;
    const tokens = entry.tokens || key.split(" ");
    if (key === query || tokens.includes(query)) return [0, 0];
    if (key.startsWith(query) || tokens.some((token) => token.startsWith(query))) {
      return [1, 0];
    }
    if (key.includes(query)) return [2, 0];
    if (query.length < 4) return null;

    const maxDistance = query.length <= 7 ? 1 : 2;
    let distance = maxDistance + 1;
    for (const candidate of [...tokens, key]) {
      if (Math.abs(candidate.length - query.length) > maxDistance) continue;
      distance = Math.min(
        distance,
        boundedDamerauLevenshtein(candidate, query, maxDistance)
      );
      if (distance === 1) break;
    }
    return distance <= maxDistance ? [3, distance] : null;
  }

  function rankPlayers(entries, value, limit = 12) {
    const query = normalize(value);
    if (!query) return [];
    const ranked = [];
    for (const entry of entries) {
      const tier = searchTier(entry, query);
      if (!tier) continue;
      ranked.push({
        ...entry,
        tier: tier[0],
        distance: tier[1],
      });
    }
    ranked.sort(
      (a, b) =>
        a.tier - b.tier ||
        a.distance - b.distance ||
        Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) ||
        a.key.length - b.key.length ||
        a.key.localeCompare(b.key, "pl")
    );
    return ranked.slice(0, limit);
  }

  function seasonStats(records) {
    const grouped = new Map();
    for (const record of records || []) {
      const season = String(record.season ?? "");
      if (!season) continue;
      let item = grouped.get(season);
      if (!item) {
        item = {
          season,
          starts: 0,
          numeric: 0,
          total: 0,
          bonus: 0,
          totalWithBonus: 0,
          heats: 0,
          heatRides: 0,
          heatPoints: 0,
          heatAvg: null,
          avg: null,
          best: null,
        };
        grouped.set(season, item);
      }
      item.starts += 1;
      const breakdown = parsePointsBreakdown(record.points);
      const heats = parseHeats(record.heats);
      item.heats += heats.rides;
      if (!breakdown.pointsReliable) continue;
      const points = breakdown.points;
      item.numeric += 1;
      item.total += points;
      item.bonus += breakdown.reliable ? breakdown.bonus : 0;
      item.totalWithBonus += breakdown.reliable ? breakdown.totalWithBonus : points;
      if (heats.rides > 0) {
        item.heatRides += heats.rides;
        item.heatPoints += breakdown.reliable ? breakdown.totalWithBonus : points;
      }
      item.best = item.best === null ? points : Math.max(item.best, points);
    }
    return [...grouped.values()]
      .map((item) => ({
        ...item,
        avg: item.numeric ? item.total / item.numeric : null,
        heatAvg: item.heatRides ? item.heatPoints / item.heatRides : null,
      }))
      .sort((a, b) => Number(b.season) - Number(a.season));
  }

  function bestSeason(stats) {
    return [...(stats || [])]
      .filter((item) => item.avg !== null)
      .sort(
        (a, b) =>
          b.avg - a.avg ||
          b.numeric - a.numeric ||
          Number(b.season) - Number(a.season)
      )[0] || null;
  }

  function bestHeatSeason(stats) {
    return [...(stats || [])]
      .filter((item) => item.heatAvg !== null)
      .sort(
        (a, b) =>
          b.heatAvg - a.heatAvg ||
          b.heats - a.heats ||
          Number(b.season) - Number(a.season)
      )[0] || null;
  }

  function playerMetric(records) {
    const stats = seasonStats(records);
    const total = stats.reduce((sum, item) => sum + item.total, 0);
    const bonus = stats.reduce((sum, item) => sum + item.bonus, 0);
    const totalWithBonus = total + bonus;
    const heats = stats.reduce((sum, item) => sum + item.heats, 0);
    const heatRides = stats.reduce((sum, item) => sum + item.heatRides, 0);
    const heatPoints = stats.reduce((sum, item) => sum + item.heatPoints, 0);
    const numeric = stats.reduce((sum, item) => sum + item.numeric, 0);
    const bestValues = stats.map((item) => item.best).filter((value) => value !== null);
    return {
      starts: (records || []).length,
      numeric,
      total,
      bonus,
      totalWithBonus,
      heats,
      heatRides,
      heatPoints,
      avg: numeric ? total / numeric : null,
      heatAvg: heatRides ? heatPoints / heatRides : null,
      best: bestValues.length ? Math.max(...bestValues) : null,
      seasons: stats.length,
      bestSeason: bestSeason(stats),
      bestHeatSeason: bestHeatSeason(stats),
      seasonStats: stats,
    };
  }

  function filterRecords(records, filters = {}) {
    const search = normalize(filters.search);
    const selectedTracks = new Set(
      Array.isArray(filters.tracks)
        ? filters.tracks.map((value) => String(value)).filter(Boolean)
        : []
    );
    const trackMode = filters.trackMode === "exclude" ? "exclude" : "include";
    return (records || []).filter((record) => {
      if (filters.season && String(record.season) !== String(filters.season)) return false;
      if (filters.league && record.league !== filters.league) return false;
      if (filters.competition && record.competition !== filters.competition) return false;
      if (filters.track && record.track !== filters.track) return false;
      if (selectedTracks.size) {
        const selected = selectedTracks.has(String(record.track || ""));
        if (trackMode === "include" && !selected) return false;
        if (trackMode === "exclude" && selected) return false;
      }
      if (filters.homeAway && record.homeAway !== filters.homeAway) return false;
      if (search) {
        const haystack = normalize(
          record.searchText ||
            [record.league, record.competition, record.track, record.home, record.away]
              .filter(Boolean)
              .join(" ")
        );
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }

  const FILTER_FIELDS = ["season", "league", "competition", "track"];

  function cascadingFilterOptions(records, filters = {}, fields = FILTER_FIELDS) {
    const result = {};
    for (const field of fields) {
      const otherFilters = {};
      for (const candidate of fields) {
        if (candidate !== field && filters[candidate]) {
          otherFilters[candidate] = filters[candidate];
        }
      }
      result[field] = [...new Set(
        filterRecords(records, otherFilters)
          .map((record) => String(record[field] ?? "").trim())
          .filter(Boolean)
      )].sort((a, b) => field === "season"
        ? Number(b) - Number(a)
        : a.localeCompare(b, "pl"));
    }
    return result;
  }

  function chronologicalValue(record, fallback) {
    const season = Number(record?.season) || 0;
    const order = Number.isFinite(Number(record?.order)) ? Number(record.order) : fallback;
    return [season, order];
  }

  function resultDateValue(record) {
    const raw = record?.date ?? record?.eventDate;
    if (raw instanceof Date) {
      const value = raw.getTime();
      return Number.isFinite(value) ? value : null;
    }
    if (typeof raw !== "string" || !raw.trim()) return null;
    const value = Date.parse(raw.trim());
    return Number.isFinite(value) ? value : null;
  }

  function sortPlayerResults(records, direction = "new") {
    const multiplier = direction === "old" ? 1 : -1;
    const decorated = (records || []).map((record, index) => ({
      record,
      index,
      date: resultDateValue(record),
      chronological: chronologicalValue(record, index),
    }));
    return decorated
      .sort((a, b) =>
        (a.chronological[0] - b.chronological[0]) * multiplier ||
        (Number(b.date !== null) - Number(a.date !== null)) ||
        (a.date !== null && b.date !== null ? (a.date - b.date) * multiplier : 0) ||
        (a.chronological[1] - b.chronological[1]) * multiplier ||
        a.index - b.index
      )
      .map((item) => item.record);
  }

  function lastRecords(records, limit) {
    const count = Number(limit) || 0;
    if (!count) return sortPlayerResults(records, "old");
    return sortPlayerResults(records, "new").slice(0, count).reverse();
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function standardDeviation(values) {
    if (!values.length) return null;
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce(
      (sum, value) => sum + (value - average) ** 2,
      0
    ) / values.length;
    return Math.sqrt(variance);
  }

  function formStats(records, limit = 10) {
    const limited = lastRecords(records, limit);
    const metric = playerMetric(limited);
    const numeric = limited
      .map((record) => parsePointsBreakdown(record.points).points)
      .filter((value) => value !== null);
    return {
      requested: Number(limit) || limited.length,
      available: limited.length,
      records: limited,
      results: [...limited].reverse().map((record) => String(record.points ?? "").trim() || "—"),
      average: numeric.length
        ? numeric.reduce((sum, value) => sum + value, 0) / numeric.length
        : null,
      heatAverage: metric.heatAvg,
      min: numeric.length ? Math.min(...numeric) : null,
      max: numeric.length ? Math.max(...numeric) : null,
      standardDeviation: standardDeviation(numeric),
      numeric: numeric.length,
    };
  }

  function currentForm(records) {
    return {
      last5: formStats(records, 5),
      last10: formStats(records, 10),
    };
  }

  function sampleSizeLabel(size) {
    if (size < 5) return "bardzo mała próba";
    if (size < 10) return "mała próba";
    if (size < 20) return "umiarkowana próba";
    return "większa próba";
  }

  function analyzeThreshold(records, threshold, options = {}) {
    const line = Number(String(threshold).replace(",", "."));
    if (!Number.isFinite(line)) {
      return { threshold: null, sample: 0, over: 0, under: 0, push: 0, results: [] };
    }
    const pointsMode = options.pointsMode === "pointsBonus" ? "pointsBonus" : "points";
    const limited = lastRecords(records, options.lastN);
    const results = [];
    for (const record of limited) {
      const breakdown = parsePointsBreakdown(record.points);
      if (!breakdown.pointsReliable) continue;
      if (pointsMode === "pointsBonus" && !breakdown.reliable) continue;
      const value = pointsMode === "pointsBonus"
        ? breakdown.totalWithBonus
        : breakdown.points;
      const outcome = value > line ? "OVER" : value < line ? "UNDER" : "PUSH";
      results.push({ record, value, outcome });
    }
    const values = results.map((item) => item.value);
    const sample = values.length;
    const total = values.reduce((sum, value) => sum + value, 0);
    const mean = sample ? total / sample : null;
    const heatInfo = results.map((item) => parseHeats(item.record.heats));
    const totalHeats = heatInfo.reduce((sum, item) => sum + item.rides, 0);
    const heatPoints = results.reduce((sum, item, index) => {
      if (!heatInfo[index].rides) return sum;
      return sum + item.value;
    }, 0);
    const over = results.filter((item) => item.outcome === "OVER").length;
    const under = results.filter((item) => item.outcome === "UNDER").length;
    const push = results.filter((item) => item.outcome === "PUSH").length;
    return {
      threshold: line,
      pointsMode,
      sample,
      over,
      under,
      push,
      overPct: sample ? (over / sample) * 100 : 0,
      underPct: sample ? (under / sample) * 100 : 0,
      pushPct: sample ? (push / sample) * 100 : 0,
      mean,
      median: median(values),
      min: sample ? Math.min(...values) : null,
      max: sample ? Math.max(...values) : null,
      standardDeviation: standardDeviation(values),
      heats: totalHeats,
      averageHeats: sample ? totalHeats / sample : null,
      heatAverage: totalHeats ? heatPoints / totalHeats : null,
      sampleLabel: sampleSizeLabel(sample),
      results,
    };
  }

  function thresholdTrend(records, threshold, options = {}) {
    const chronological = lastRecords(records, Math.max(1, (records || []).length));
    const all = analyzeThreshold(chronological, threshold, { ...options, lastN: 0 });
    const last5 = analyzeThreshold(records, threshold, { ...options, lastN: 5 });
    const last10 = analyzeThreshold(records, threshold, { ...options, lastN: 10 });
    const newest = sortPlayerResults(
      all.results.map((item) => ({ ...item, ...item.record })),
      "new"
    );
    const outcome = newest[0]?.outcome || null;
    let streak = 0;
    while (streak < newest.length && newest[streak].outcome === outcome) streak += 1;
    return {
      last5: { over: last5.over, sample: last5.sample },
      last10: { over: last10.over, sample: last10.sample },
      streak: { outcome, count: streak },
    };
  }

  /*
   * Team-event rows in WZDB are stored as two contiguous rider blocks. We only
   * accept a split when both blocks reproduce the published match score and a
   * single most-balanced boundary exists; otherwise every rider stays UNKNOWN.
   */
  function classifyTeamEvent(records, event = {}) {
    const rows = records || [];
    const score = String(event.score || rows[0]?.score || "");
    const match = score.match(/(\d+(?:[.,]\d+)?)\s*[-:]\s*(\d+(?:[.,]\d+)?)/);
    const home = String(event.home || rows[0]?.home || "").trim();
    const away = String(event.away || rows[0]?.away || "").trim();
    const unknown = { classified: false, split: null, sides: rows.map(() => "UNKNOWN") };
    if (!home || !away || !match || rows.length < 6) return unknown;
    const homeScore = Number(match[1].replace(",", "."));
    const awayScore = Number(match[2].replace(",", "."));
    const points = rows.map((record) => parsePointsBreakdown(record.points).points ?? 0);
    const candidates = [];
    for (let split = 3; split <= rows.length - 3; split += 1) {
      const left = points.slice(0, split).reduce((sum, value) => sum + value, 0);
      const right = points.slice(split).reduce((sum, value) => sum + value, 0);
      if (Math.abs(left - homeScore) < 1e-9 && Math.abs(right - awayScore) < 1e-9) {
        candidates.push({ split, balance: Math.abs(split * 2 - rows.length) });
      }
    }
    candidates.sort((a, b) => a.balance - b.balance);
    if (!candidates.length || (candidates[1] && candidates[0].balance === candidates[1].balance)) {
      return unknown;
    }
    const split = candidates[0].split;
    return {
      classified: true,
      split,
      sides: rows.map((_, index) => index < split ? "HOME" : "AWAY"),
    };
  }

  function stableHash(value, seed = 0) {
    const text = String(value || "");
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ code, 2654435761);
      h2 = Math.imul(h2 ^ code, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
      Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
      Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    const combined = 4294967296 * (2097151 & h2) + (h1 >>> 0);
    return combined.toString(36);
  }

  const EVENT_FIELDS = [
    "season",
    "home",
    "away",
    "score",
    "league",
    "track",
    "competition",
    "round",
    "capacity",
  ];

  function eventSignature(event) {
    return EVENT_FIELDS.map((field) => normalize(event?.[field])).join("\u001f");
  }

  function stableEventKey(event, ordinal = 0) {
    const season = String(event?.season || "0").replace(/[^0-9a-z-]/gi, "");
    return `e${season}-${stableHash(eventSignature(event))}-${Number(ordinal).toString(36)}`;
  }

  const LOGICAL_EVENT_FIELDS = ["season", "league", "track", "competition", "round"];

  function logicalEventSignature(event) {
    return LOGICAL_EVENT_FIELDS.map((field) => normalize(event?.[field])).join("\u001f");
  }

  function standingTeam(event) {
    const home = String(event?.home || "").trim();
    const away = String(event?.away || "").trim();
    const score = String(event?.score || "").trim();
    if (!score || Boolean(home) === Boolean(away)) return null;
    return { name: home || away, score };
  }

  /*
   * Some multi-team meetings are exported as adjacent physical blocks: one
   * block per team. Merge only a strong, row-contiguous identity with at least
   * two distinct single-team standings. Ordinary two-team matches (both team
   * fields set) and individual categories therefore remain separate.
   */
  function mergeAdjacentEvents(events) {
    const source = events || [];
    const merged = [];

    const appendSeparate = (eventsToAppend) => {
      for (const event of eventsToAppend) {
        merged.push({
          ...event,
          fragmentCount: Number(event.fragmentCount || 1),
          multiTeam: Boolean(event.multiTeam),
          teams: Array.isArray(event.teams) ? event.teams : [],
          eventDate: event.eventDate || null,
          eventDateConflict: Boolean(event.eventDateConflict),
          eventDateCandidates: Array.isArray(event.eventDateCandidates) ? event.eventDateCandidates : [],
        });
      }
    };

    const appendMerged = (run, teams, multiTeam) => {
      const first = run[0];
      const last = run.at(-1);
      const eventDateCandidates = [...new Set(
        run.map((event) => String(event?.eventDate || "").trim()).filter(Boolean)
      )];
      const eventDateConflict = eventDateCandidates.length > 1;
      merged.push({
        ...first,
        count: Number(last.start) + Number(last.count) - Number(first.start),
        fragmentCount: run.reduce((sum, event) => sum + Number(event.fragmentCount || 1), 0),
        multiTeam,
        teams,
        eventDate: eventDateCandidates.length === 1 ? eventDateCandidates[0] : null,
        eventDateConflict,
        eventDateCandidates: eventDateConflict ? eventDateCandidates : [],
      });
    };

    for (let index = 0; index < source.length;) {
      const first = source[index];
      const signature = logicalEventSignature(first);
      const strong = Boolean(
        String(first?.season || "").trim() &&
        String(first?.track || "").trim() &&
        String(first?.competition || "").trim()
      );
      let end = index + 1;
      while (
        strong &&
        end < source.length &&
        logicalEventSignature(source[end]) === signature &&
        Number(source[end - 1].start) + Number(source[end - 1].count) === Number(source[end].start)
      ) end += 1;

      const run = source.slice(index, end);
      let groupIndex = 0;
      while (groupIndex < run.length) {
        /*
         * Capacity is an exact, hard boundary for every merge path. A blank
         * value is compatible only with another blank value.
         */
        const capacity = String(run[groupIndex]?.capacity || "").trim();
        let groupEnd = groupIndex + 1;
        while (
          groupEnd < run.length &&
          String(run[groupEnd]?.capacity || "").trim() === capacity
        ) groupEnd += 1;

        const capacityGroup = run.slice(groupIndex, groupEnd);
        const teams = [];
        const seenTeams = new Set();
        for (const event of capacityGroup) {
          const candidates = Array.isArray(event.teams) && event.teams.length
            ? event.teams
            : [standingTeam(event)].filter(Boolean);
          for (const team of candidates) {
            const key = normalize(team.name);
            if (!key || seenTeams.has(key)) continue;
            seenTeams.add(key);
            teams.push({ name: String(team.name), score: String(team.score || "") });
          }
        }

        if (strong && capacityGroup.length > 1 && teams.length > 1) {
          // Preserve the established merge for multi-team standings,
          // including legacy seasons, inside one capacity only.
          appendMerged(capacityGroup, teams, true);
        } else {
          /*
         * G:I is overloaded in PL2. Team matches store home/away/score there,
         * while individual meetings can store rider-specific final or
         * semi-final placing. Preserve those physical keys, then join only a
         * row-contiguous, fully dated, non-team occurrence.
         */
          const eventDate = String(capacityGroup[0]?.eventDate || "").trim();
          const sameDate = Boolean(eventDate) && capacityGroup.every(
            (event) => String(event?.eventDate || "").trim() === eventDate
          );
          const teamShaped = capacityGroup.some((event) =>
            (String(event?.score || "").trim() &&
              (String(event?.home || "").trim() || String(event?.away || "").trim())) ||
            (Array.isArray(event?.teams) && event.teams.length)
          );

          if (strong && capacityGroup.length > 1 && sameDate && !teamShaped) {
            appendMerged(capacityGroup, [], false);
          } else {
            appendSeparate(capacityGroup);
          }
        }
        groupIndex = groupEnd;
      }
      index = end;
    }
    return merged;
  }

  function comparisonTrackOptions(leftTracks, rightTracks) {
    const left = new Set((leftTracks || []).map(String).filter(Boolean));
    const right = new Set((rightTracks || []).map(String).filter(Boolean));
    return [...new Set([...left, ...right])]
      .map((value) => ({
        value,
        scope: left.has(value) && right.has(value) ? "both" : left.has(value) ? "left" : "right",
      }))
      .sort((a, b) =>
        Number(b.scope === "both") - Number(a.scope === "both") ||
        a.value.localeCompare(b.value, "pl")
      );
  }

  function playerDeepLinkKey(player) {
    return normalize(Array.isArray(player) ? player[3] || player[0] : player?.key || player);
  }

  function normalizeRoute(route) {
    if (route?.view === "player" && playerDeepLinkKey(route.playerKey)) {
      const playerRoute = {
        view: "player",
        playerKey: playerDeepLinkKey(route.playerKey),
      };
      if (["stats", "threshold"].includes(route.profileView)) playerRoute.profileView = route.profileView;
      if (route.threshold !== undefined && route.threshold !== null && route.threshold !== "") playerRoute.threshold = route.threshold;
      for (const field of ["season", "league", "competition", "track"]) {
        if (route[field]) playerRoute[field] = route[field];
      }
      if (Array.isArray(route.tracks)) {
        const tracks = [...new Set(route.tracks.map(String).map((value) => value.trim()).filter(Boolean))];
        if (tracks.length) {
          playerRoute.tracks = tracks;
          playerRoute.trackMode = route.trackMode === "exclude" ? "exclude" : "include";
          delete playerRoute.track;
        }
      }
      if (["HOME", "AWAY"].includes(route.homeAway)) playerRoute.homeAway = route.homeAway;
      if (Number(route.lastN)) playerRoute.lastN = Number(route.lastN);
      if (route.pointsMode === "pointsBonus") playerRoute.pointsMode = "pointsBonus";
      return playerRoute;
    }
    if (route?.view === "event" && route.eventKey) {
      return { view: "event", eventKey: String(route.eventKey) };
    }
    if (route?.view === "compare") {
      return {
        view: "compare",
        playerA: playerDeepLinkKey(route.playerA),
        playerB: playerDeepLinkKey(route.playerB),
      };
    }
    if (route?.view === "events") return { view: "events" };
    return { view: "home" };
  }

  function routeFromUrl(input) {
    const url = new URL(input, "https://app.invalid/");
    const eventKey = url.searchParams.get("event");
    if (eventKey) return { view: "event", eventKey };
    const playerKey = playerDeepLinkKey(url.searchParams.get("player"));
    if (playerKey) return normalizeRoute({
      view: "player",
      playerKey,
      profileView: url.searchParams.get("view"),
      threshold: url.searchParams.get("line") || undefined,
      season: url.searchParams.get("season"),
      league: url.searchParams.get("league"),
      competition: url.searchParams.get("competition"),
      track: url.searchParams.get("track"),
      tracks: (url.searchParams.get("tracks") || "").split(",").filter(Boolean),
      trackMode: url.searchParams.get("trackMode"),
      homeAway: url.searchParams.get("place"),
      lastN: url.searchParams.get("last"),
      pointsMode: url.searchParams.get("points"),
    });
    return { view: "home" };
  }

  function urlForRoute(input, route) {
    const url = new URL(input, "https://app.invalid/");
    url.searchParams.delete("player");
    url.searchParams.delete("event");
    for (const name of ["view", "line", "season", "league", "competition", "track", "tracks", "trackMode", "place", "last", "points"]) {
      url.searchParams.delete(name);
    }
    const normalized = normalizeRoute(route);
    if (normalized.view === "player") {
      url.searchParams.set("player", normalized.playerKey);
      if (normalized.profileView) url.searchParams.set("view", normalized.profileView);
      if (normalized.profileView === "threshold" && normalized.threshold !== undefined) url.searchParams.set("line", normalized.threshold);
      if (normalized.season) url.searchParams.set("season", normalized.season);
      if (normalized.league) url.searchParams.set("league", normalized.league);
      if (normalized.competition) url.searchParams.set("competition", normalized.competition);
      if (normalized.track) url.searchParams.set("track", normalized.track);
      if (normalized.tracks?.length) {
        url.searchParams.set("tracks", normalized.tracks.join(","));
        url.searchParams.set("trackMode", normalized.trackMode || "include");
      }
      if (normalized.homeAway) url.searchParams.set("place", normalized.homeAway);
      if (normalized.lastN) url.searchParams.set("last", normalized.lastN);
      if (normalized.pointsMode === "pointsBonus") url.searchParams.set("points", "pointsBonus");
    } else if (normalized.view === "event") {
      url.searchParams.set("event", normalized.eventKey);
    }
    url.hash = "";
    return url.toString();
  }

  function formatPlayerUrl(input, playerKey) {
    return urlForRoute(input, { view: "player", playerKey });
  }

  function formatEventUrl(input, eventKey) {
    return urlForRoute(input, { view: "event", eventKey });
  }

  function commonEvents(left, right) {
    const rightByKey = new Map((right || []).map((event) => [event.key, event]));
    const events = [];
    let leftWins = 0;
    let rightWins = 0;
    let ties = 0;
    let compared = 0;
    let leftTotal = 0;
    let rightTotal = 0;
    for (const leftEvent of left || []) {
      const rightEvent = rightByKey.get(leftEvent.key);
      if (!rightEvent) continue;
      const leftPoints = basePoints(leftEvent.points);
      const rightPoints = basePoints(rightEvent.points);
      let difference = null;
      if (leftPoints !== null && rightPoints !== null) {
        compared += 1;
        leftTotal += leftPoints;
        rightTotal += rightPoints;
        difference = leftPoints - rightPoints;
        if (difference > 0) leftWins += 1;
        else if (difference < 0) rightWins += 1;
        else ties += 1;
      }
      events.push({
        key: leftEvent.key,
        left: leftEvent,
        right: rightEvent,
        leftPoints,
        rightPoints,
        difference,
      });
    }
    return {
      events,
      leftWins,
      rightWins,
      ties,
      compared,
      leftAverage: compared ? leftTotal / compared : null,
      rightAverage: compared ? rightTotal / compared : null,
    };
  }

  function latestEventRefs(eventRefs, limit = 10) {
    return sortPlayerResults(eventRefs || [], "new").slice(0, limit);
  }

  return {
    EVENT_FIELDS,
    basePoints,
    bestHeatSeason,
    bestSeason,
    boundedDamerauLevenshtein,
    analyzeThreshold,
    cascadingFilterOptions,
    classifyTeamEvent,
    comparisonTrackOptions,
    commonEvents,
    currentForm,
    eventSignature,
    eventDateValue,
    formatEventUrl,
    formatPlayerUrl,
    filterRecords,
    formStats,
    latestEventRefs,
    logicalEventSignature,
    lastRecords,
    normalize,
    normalizeRoute,
    playerDeepLinkKey,
    playerMetric,
    parseHeats,
    parsePointsBreakdown,
    rankPlayers,
    mergeAdjacentEvents,
    resolveEventDate,
    routeFromUrl,
    seasonStats,
    sampleSizeLabel,
    sortPlayerResults,
    standardDeviation,
    stableEventKey,
    stableHash,
    thresholdTrend,
    urlForRoute,
  };
});
