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
    return (records || []).filter((record) => {
      if (filters.season && String(record.season) !== String(filters.season)) return false;
      if (filters.league && record.league !== filters.league) return false;
      if (filters.competition && record.competition !== filters.competition) return false;
      if (filters.track && record.track !== filters.track) return false;
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

  function playerDeepLinkKey(player) {
    return normalize(Array.isArray(player) ? player[3] || player[0] : player?.key || player);
  }

  function normalizeRoute(route) {
    if (route?.view === "player" && playerDeepLinkKey(route.playerKey)) {
      return { view: "player", playerKey: playerDeepLinkKey(route.playerKey) };
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
    if (playerKey) return { view: "player", playerKey };
    return { view: "home" };
  }

  function urlForRoute(input, route) {
    const url = new URL(input, "https://app.invalid/");
    url.searchParams.delete("player");
    url.searchParams.delete("event");
    const normalized = normalizeRoute(route);
    if (normalized.view === "player") {
      url.searchParams.set("player", normalized.playerKey);
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
    for (const leftEvent of left || []) {
      const rightEvent = rightByKey.get(leftEvent.key);
      if (!rightEvent) continue;
      const leftPoints = basePoints(leftEvent.points);
      const rightPoints = basePoints(rightEvent.points);
      let difference = null;
      if (leftPoints !== null && rightPoints !== null) {
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
    return { events, leftWins, rightWins, ties };
  }

  function latestEventRefs(eventRefs, limit = 10) {
    return [...(eventRefs || [])]
      .sort(
        (a, b) =>
          Number(b.season) - Number(a.season) || Number(b.order) - Number(a.order)
      )
      .slice(0, limit);
  }

  return {
    EVENT_FIELDS,
    basePoints,
    bestHeatSeason,
    bestSeason,
    boundedDamerauLevenshtein,
    commonEvents,
    eventSignature,
    formatEventUrl,
    formatPlayerUrl,
    filterRecords,
    latestEventRefs,
    normalize,
    normalizeRoute,
    playerDeepLinkKey,
    playerMetric,
    parseHeats,
    parsePointsBreakdown,
    rankPlayers,
    routeFromUrl,
    seasonStats,
    stableEventKey,
    stableHash,
    urlForRoute,
  };
});
