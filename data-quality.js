(function (root, factory) {
  const core = typeof module === "object" && module.exports
    ? require("./app-core.js")
    : root.WZAppCore;
  const api = factory(core);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.WZDataQuality = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (CORE) {
  "use strict";

  const CONFIDENCE_ORDER = { HIGH: 0, REVIEW: 1, OK: 2, UNKNOWN: 3 };

  function text(value) {
    return String(value ?? "").trim().replace(/\s+/g, " ");
  }

  function normalize(value) {
    return text(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/ł/g, "l")
      .replace(/[.'’`]/g, "")
      .replace(/[\-‐‑‒–—−]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function stableId(parts) {
    const input = parts.map(text).join("\u0000");
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function issue(category, confidence, source = {}, reason = "") {
    const result = {
      category,
      confidence,
      season: text(source.season),
      date: text(source.date || source.eventDate),
      eventKey: text(source.eventKey || source.key),
      track: text(source.track),
      canonicalTrack: text(source.canonicalTrack || (source.track && CORE?.canonicalTrackKey(source.track))),
      league: text(source.league),
      competition: text(source.competition),
      round: text(source.round),
      capacity: text(source.capacity),
      player: text(source.player || source.playerName),
      playerKey: text(source.playerKey),
      value: text(source.value),
      rowStart: Number.isInteger(source.rowStart) ? source.rowStart : null,
      rowEnd: Number.isInteger(source.rowEnd) ? source.rowEnd : null,
      reason: text(reason),
    };
    result.id = `${category}:${stableId([
      result.season, result.date, result.eventKey, result.track,
      result.competition, result.round, result.capacity, result.player,
      result.value, result.reason,
    ])}`;
    return result;
  }

  function median(values) {
    const sorted = (values || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function participants(event) {
    return Array.isArray(event?.participants) ? event.participants : [];
  }

  function participantKey(player) {
    return text(player?.playerKey || player?.key || player?.playerId || player?.id || player?.name);
  }

  function participantSet(event) {
    return new Set(participants(event).map(participantKey).filter(Boolean));
  }

  function jaccard(left, right) {
    if (!left.size || !right.size) return 0;
    let intersection = 0;
    for (const value of left) if (right.has(value)) intersection += 1;
    return intersection / (left.size + right.size - intersection);
  }

  function eventGroupKey(event, { includeType = true } = {}) {
    return JSON.stringify([
      text(event.season),
      text(event.eventDate || event.date),
      CORE?.canonicalTrackKey(event.track) || normalize(event.track),
      normalize(event.league),
      normalize(event.competition),
      normalize(event.round),
      text(event.capacity),
      includeType ? text(event.type) : "",
    ]);
  }

  function groupBy(items, keyFor) {
    const groups = new Map();
    for (const item of items || []) {
      const key = keyFor(item);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    return groups;
  }

  function findSplitCandidates(events) {
    const candidates = [];
    const groups = groupBy((events || []).filter((event) => text(event.eventDate || event.date)), eventGroupKey);
    for (const grouped of groups.values()) {
      if (grouped.length < 2) continue;
      const first = grouped[0];
      if (text(first.type) === "team" || grouped.some((event) => text(event.capacity) !== text(first.capacity))) continue;
      const sets = grouped.map(participantSet);
      let maximumOverlap = 0;
      for (let left = 0; left < sets.length; left += 1) {
        for (let right = left + 1; right < sets.length; right += 1) {
          maximumOverlap = Math.max(maximumOverlap, jaccard(sets[left], sets[right]));
        }
      }
      const counts = grouped.map((event) => Number(event.count) || participants(event).length || 0);
      const total = counts.reduce((sum, count) => sum + count, 0);
      const largest = Math.max(...counts);
      const byRow = [...grouped].sort((a, b) => (a.rowStart ?? Number.MAX_SAFE_INTEGER) - (b.rowStart ?? Number.MAX_SAFE_INTEGER));
      const rowContiguous = byRow.every((event, index) => index === 0 || (
        Number.isInteger(byRow[index - 1].rowEnd)
        && Number.isInteger(event.rowStart)
        && event.rowStart === byRow[index - 1].rowEnd + 1
      ));
      const teamShaped = CORE.teamStructureEvidence(grouped).teamShaped;
      const high = rowContiguous && !teamShaped && grouped.length >= 3 && total >= 8 && total <= 40
        && largest <= Math.max(6, Math.ceil(total * 0.55)) && maximumOverlap < 0.25;
      const result = issue("split_candidate", high ? "HIGH" : "REVIEW", first,
        high
          ? `${grouped.length} małych logical events tworzy ciągły blok wierszy bez struktury drużynowej.`
          : `${grouped.length} logical events ma wspólną tożsamość, ale bez wystarczającego dowodu fizycznego rozbicia.`);
      Object.assign(result, {
        eventKeys: grouped.map((event) => text(event.eventKey || event.key)),
        logicalEvents: grouped.length,
        physicalFragments: grouped.reduce((sum, event) => sum + (Number(event.fragmentCount) || 1), 0),
        participantCounts: counts,
        participantsTotal: total,
        maximumParticipantOverlap: maximumOverlap,
        rowContiguous,
        teamShaped,
        rowStart: Math.min(...grouped.map((event) => Number.isInteger(event.rowStart) ? event.rowStart : Number.MAX_SAFE_INTEGER)),
        rowEnd: Math.max(...grouped.map((event) => Number.isInteger(event.rowEnd) ? event.rowEnd : -1)),
      });
      if (result.rowStart === Number.MAX_SAFE_INTEGER) result.rowStart = null;
      if (result.rowEnd < 0) result.rowEnd = null;
      candidates.push(result);
    }
    return candidates;
  }

  function participantDistributions(events) {
    const distributions = new Map();
    for (const event of events || []) {
      const count = Number(event.count) || participants(event).length || 0;
      const key = [text(event.type), normalize(event.competition), normalize(event.league)].join("\u0000");
      if (!distributions.has(key)) distributions.set(key, []);
      distributions.get(key).push(count);
    }
    return distributions;
  }

  function findSmallEvents(events) {
    const distributions = participantDistributions(events);
    const issues = [];
    for (const event of events || []) {
      const count = Number(event.count) || participants(event).length || 0;
      if (count > 3) continue;
      const key = [text(event.type), normalize(event.competition), normalize(event.league)].join("\u0000");
      const sample = distributions.get(key) || [];
      const typical = median(sample);
      const result = issue("small_event", "REVIEW", event,
        `${count} uczestników; typowa mediana dla tej serii: ${typical ?? "brak próby"}.`);
      result.participants = count;
      result.fragmentCount = Number(event.fragmentCount) || 1;
      result.eventType = text(event.type);
      result.typicalMedian = typical;
      result.sample = sample.length;
      issues.push(result);
    }
    return issues;
  }

  function findParticipantOutliers(events) {
    const distributions = participantDistributions(events);
    const issues = [];
    for (const event of events || []) {
      const count = Number(event.count) || participants(event).length || 0;
      if (count <= 3) continue;
      const key = [text(event.type), normalize(event.competition), normalize(event.league)].join("\u0000");
      const sample = distributions.get(key) || [];
      if (sample.length < 6) continue;
      const typical = median(sample);
      if (!typical || typical < 6) continue;
      const low = count <= Math.max(4, Math.floor(typical * 0.5)) && typical - count >= 4;
      const high = count >= Math.ceil(typical * 2.5) && count - typical >= 8;
      if (!low && !high) continue;
      const result = issue("participant_outlier", "REVIEW", event,
        `${count} uczestników przy medianie ${typical} w ${sample.length} podobnych eventach.`);
      result.participants = count;
      result.typicalMedian = typical;
      result.sample = sample.length;
      issues.push(result);
    }
    return issues;
  }

  function findDuplicateEvents(events) {
    const duplicates = [];
    const groups = groupBy((events || []).filter((event) => text(event.eventDate || event.date)), eventGroupKey);
    for (const grouped of groups.values()) {
      if (grouped.length < 2) continue;
      for (let left = 0; left < grouped.length; left += 1) {
        for (let right = left + 1; right < grouped.length; right += 1) {
          const a = grouped[left], b = grouped[right];
          const similarity = jaccard(participantSet(a), participantSet(b));
          if (similarity < 0.75) continue;
          const countA = Number(a.count) || participants(a).length;
          const countB = Number(b.count) || participants(b).length;
          const result = issue("duplicate_event", similarity === 1 && countA === countB ? "HIGH" : "REVIEW", a,
            `Możliwy duplikat: podobieństwo uczestników ${(similarity * 100).toFixed(1)}%.`);
          Object.assign(result, {
            eventKeyA: text(a.eventKey || a.key),
            eventKeyB: text(b.eventKey || b.key),
            eventKeys: [text(a.eventKey || a.key), text(b.eventKey || b.key)],
            countA,
            countB,
            participantSimilarity: similarity,
          });
          duplicates.push(result);
        }
      }
    }
    return duplicates;
  }

  function validISODate(value) {
    const match = text(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return false;
    const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
    return date.getUTCFullYear() === +match[1] && date.getUTCMonth() === +match[2] - 1 && date.getUTCDate() === +match[3];
  }

  function findDateIssues(events, diagnostics = [], latestSeason = "") {
    const issues = [];
    for (const event of events || []) {
      const date = text(event.eventDate || event.date);
      const candidates = [...new Set((event.eventDateCandidates || event.dateCandidates || []).map(text).filter(Boolean))];
      if (!date) {
        issues.push(issue("missing_date", text(event.season) === text(latestSeason) ? "HIGH" : "REVIEW", event,
          "Logical event nie ma eventDate."));
      } else if (!validISODate(date)) {
        issues.push(issue("invalid_date", "HIGH", { ...event, value: date }, "Nieprawidłowy format lub wartość eventDate."));
      }
      if (event.eventDateConflict || candidates.length > 1) {
        const result = issue("date_conflict", "HIGH", event, "Logical event zawiera więcej niż jednego kandydata daty.");
        result.dateCandidates = candidates;
        issues.push(result);
      }
    }
    for (const diagnostic of diagnostics || []) {
      const category = diagnostic.type === "invalid_source_date" || diagnostic.invalid_values?.length ? "invalid_date" : "date_conflict";
      const result = issue(category, "HIGH", {
        season: diagnostic.season,
        eventKey: diagnostic.eventKey,
        value: (diagnostic.invalid_values || []).map((value) => value.value || value).join(" | "),
        rowStart: diagnostic.source_rows?.[0] ?? diagnostic.start,
        rowEnd: diagnostic.source_rows?.[1] ?? (Number.isInteger(diagnostic.start) && Number.isInteger(diagnostic.count) ? diagnostic.start + diagnostic.count - 1 : null),
      }, category === "invalid_date" ? "Źródło zawiera nieprawidłową datę." : "Źródło zawiera konflikt dat.");
      result.dateCandidates = diagnostic.dates || diagnostic.eventDateCandidates || [];
      issues.push(result);
    }
    return issues;
  }

  function suspiciousStartNumber(value) {
    const raw = text(value);
    if (!raw) return { type: "missing", confidence: "REVIEW", reason: "Brak numeru startowego." };
    if (/^20(?:1\d|2\d|30)$/.test(raw)) return { type: "looks_like_year", confidence: "HIGH", reason: "Wartość wygląda jak rok 2010–2030." };
    if (raw.length > 12) return { type: "too_long", confidence: "HIGH", reason: "Podejrzanie długa wartość numeru startowego." };
    if (!/^(?:\d{1,3}[A-Za-z]?|[A-Za-z]\d{1,3}|\d{1,3}[/.]\d{1,3})$/.test(raw)) {
      return { type: "unusual_format", confidence: "REVIEW", reason: "Nietypowy format numeru startowego." };
    }
    return null;
  }

  function findStartNumberIssues(events, latestSeason = "") {
    const issues = [];
    for (const event of events || []) {
      for (const player of participants(event)) {
        const found = suspiciousStartNumber(player.startNumber);
        if (!found) continue;
        const confidence = found.type === "missing" && text(event.season) !== text(latestSeason) ? "REVIEW" : found.confidence;
        const result = issue("start_number", confidence, {
          ...event,
          player: player.name,
          playerKey: player.playerKey || player.key,
          value: player.startNumber,
          rowStart: Number.isInteger(player.rowIndex) ? player.rowIndex : event.rowStart,
          rowEnd: Number.isInteger(player.rowIndex) ? player.rowIndex : event.rowEnd,
        }, found.reason);
        result.problemType = found.type;
        issues.push(result);
      }
    }
    return issues;
  }

  function aliasIssues(entries, type) {
    const candidates = CORE.findAliasCandidates(entries || [], { type });
    return candidates.map((candidate) => {
      const category = `${type}_alias_${candidate.confidence.toLowerCase()}`;
      const result = issue(category, candidate.confidence, {
        value: `${candidate.variantA} ↔ ${candidate.variantB}`,
      }, candidate.confidence === "HIGH"
        ? `Canonical HIGH → ${candidate.proposedCanonical}.`
        : `Podobna pisownia wymaga ręcznej oceny; propozycja: ${candidate.proposedCanonical}.`);
      Object.assign(result, candidate, { seasons: candidate.seasons || [] });
      return result;
    });
  }

  function aliasSafetyIssues(events, aliasCandidates) {
    const issues = [];
    for (const candidate of (aliasCandidates || []).filter((item) => item.confidence === "HIGH")) {
      if (candidate.type === "team") {
        const conflict = (events || []).find((event) => {
          const values = (event.teamKeys || []).map(text);
          return values.includes(candidate.variantA) && values.includes(candidate.variantB);
        });
        if (conflict) {
          const result = issue("alias_safety", "HIGH", conflict,
            `Oba warianty drużyny HIGH występują jednocześnie w jednym evencie: ${candidate.variantA} / ${candidate.variantB}.`);
          result.variantA = candidate.variantA;
          result.variantB = candidate.variantB;
          issues.push(result);
        }
      } else {
        const datesA = new Set((events || []).filter((event) => text(event.track) === candidate.variantA).map((event) => `${event.season}|${event.eventDate || event.date}`));
        const conflict = (events || []).find((event) => text(event.track) === candidate.variantB && datesA.has(`${event.season}|${event.eventDate || event.date}`));
        if (conflict) {
          const result = issue("alias_safety", "REVIEW", conflict,
            `Dwa warianty toru HIGH występują tego samego dnia: ${candidate.variantA} / ${candidate.variantB}.`);
          result.variantA = candidate.variantA;
          result.variantB = candidate.variantB;
          issues.push(result);
        }
      }
    }
    return issues;
  }

  function boundedDistance(a, b, limit = 1) {
    if (Math.abs(a.length - b.length) > limit) return limit + 1;
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let left = 1; left <= a.length; left += 1) {
      const current = [left];
      let rowMin = current[0];
      for (let right = 1; right <= b.length; right += 1) {
        current[right] = Math.min(
          current[right - 1] + 1,
          previous[right] + 1,
          previous[right - 1] + Number(a[left - 1] !== b[right - 1])
        );
        rowMin = Math.min(rowMin, current[right]);
      }
      if (rowMin > limit) return limit + 1;
      previous = current;
    }
    return previous[b.length];
  }

  function findPlayerDuplicates(players) {
    const issues = [];
    const prepared = (players || []).map((player) => ({
      ...player,
      normalizedName: normalize(player.name),
      swappedName: normalize(player.name).split(" ").sort().join(" "),
    })).filter((player) => player.normalizedName);
    const signatures = new Map();
    const addSignature = (signature, player) => {
      if (!signatures.has(signature)) signatures.set(signature, []);
      signatures.get(signature).push(player);
    };
    for (const player of prepared) {
      addSignature(`exact:${player.normalizedName}`, player);
      addSignature(`swapped:${player.swappedName}`, player);
      for (let index = 0; index < player.normalizedName.length; index += 1) {
        addSignature(`delete:${player.normalizedName.slice(0, index)}${player.normalizedName.slice(index + 1)}`, player);
      }
    }
    const checked = new Set();
    for (const bucket of signatures.values()) {
      if (bucket.length < 2 || bucket.length > 80) continue;
      for (let left = 0; left < bucket.length; left += 1) {
        for (let right = left + 1; right < bucket.length; right += 1) {
          const a = bucket[left], b = bucket[right];
          if (String(a.id) === String(b.id)) continue;
          const pair = [String(a.id), String(b.id)].sort().join("\u0000");
          if (checked.has(pair)) continue;
          checked.add(pair);
          const nameA = a.normalizedName, nameB = b.normalizedName;
          const swapped = a.swappedName === b.swappedName;
          const distance = nameA === nameB ? 0 : boundedDistance(nameA, nameB, 1);
          if (!swapped && distance > 1) continue;
          const knownIdentity = (value) => {
            const raw = text(value);
            return raw && !/^(?:\?|[-—]|n\/?a|unknown|brak)$/i.test(raw);
          };
          const birthMatch = knownIdentity(a.birthDate) && text(a.birthDate) === text(b.birthDate);
          const nationMatch = knownIdentity(a.nationality) && normalize(a.nationality) === normalize(b.nationality);
          const overlap = (a.seasons || []).some((season) => (b.seasons || []).map(String).includes(String(season)));
          if (!birthMatch && !nationMatch && !swapped) continue;
          const confidence = birthMatch && (distance === 0 || swapped) ? "HIGH" : "REVIEW";
          const result = issue("player_duplicate", confidence, {
            player: `${a.name} ↔ ${b.name}`,
            playerKey: a.key,
          }, [
            swapped ? "zamieniona kolejność członów" : distance === 0 ? "identyczna nazwa znormalizowana" : "różnica jednej litery",
            birthMatch ? "zgodna data urodzenia" : "",
            nationMatch ? "zgodna narodowość" : "",
            overlap ? "nakładające się sezony" : "",
          ].filter(Boolean).join("; "));
          Object.assign(result, {
            playerA: a,
            playerB: b,
            playerKeyA: text(a.key),
            playerKeyB: text(b.key),
            seasons: [...new Set([...(a.seasons || []), ...(b.seasons || [])].map(String))].sort(),
          });
          issues.push(result);
        }
      }
    }
    return issues;
  }

  function scoreNumbers(score) {
    const match = text(score).match(/(\d+(?:[.,]\d+)?)\s*[-:]\s*(\d+(?:[.,]\d+)?)/);
    return match ? [Number(match[1].replace(",", ".")), Number(match[2].replace(",", "."))] : null;
  }

  function buildAuditInput(database, options = {}) {
    const strings = database?.strings || [""];
    const value = (index) => index ? text(strings[index]) : "";
    const events = [];
    const trackMap = new Map();
    const teamMap = new Map();
    const playerStats = Array.from({ length: database?.players?.length || 0 }, () => ({ count: 0, seasons: new Set() }));
    const addAlias = (target, display, season) => {
      const cleaned = text(display);
      if (!cleaned) return;
      let item = target.get(cleaned);
      if (!item) target.set(cleaned, item = { value: cleaned, count: 0, seasons: new Set() });
      item.count += 1;
      item.seasons.add(String(season));
    };
    const selectedSeasons = options.seasons ? new Set(options.seasons.map(String)) : null;
    const includedSeasons = Object.keys(database?.years || {}).filter((season) => !selectedSeasons || selectedSeasons.has(String(season))).sort((a, b) => +b - +a);
    for (const season of includedSeasons) {
      if (selectedSeasons && !selectedSeasons.has(String(season))) continue;
      const rows = database.years[season] || [];
      for (const row of rows) {
        const stats = playerStats[row[0]];
        if (stats) {
          stats.count += 1;
          stats.seasons.add(String(season));
        }
        addAlias(trackMap, value(row[9]), season);
        const home = value(row[5]), away = value(row[6]), score = value(row[7]);
        if (score && home) addAlias(teamMap, home, season);
        if (score && away) addAlias(teamMap, away, season);
      }
      const physical = (database.events?.[season] || []).map(([start, count, fragmentCount = 1, teams = [], eventDateIndex]) => {
        const row = rows[start] || [];
        return {
          start,
          count,
          fragmentCount,
          teams,
          eventDate: typeof eventDateIndex === "string" ? eventDateIndex : value(eventDateIndex),
          season: String(season),
          home: value(row[5]),
          away: value(row[6]),
          score: value(row[7]),
          league: value(row[8]),
          track: value(row[9]),
          competition: value(row[10]),
          round: value(row[11]),
          capacity: value(row[12]),
        };
      });
      const logical = CORE.mergeAdjacentEvents(physical);
      const signatures = new Map();
      for (const merged of logical) {
        const row = rows[merged.start] || [];
        const home = value(row[5]), away = value(row[6]), score = value(row[7]);
        const teams = Array.isArray(merged.teams) ? merged.teams : [];
        const classicTeam = CORE.hasClassicTeamStructure({ home, away, score });
        const multiTeam = (Number(merged.fragmentCount) || 1) > 1 && teams.length > 1;
        const identity = {
          season: String(season),
          home: multiTeam ? "" : home,
          away: multiTeam ? "" : away,
          score: multiTeam ? "" : score,
          league: value(row[8]),
          track: value(row[9]),
          competition: value(row[10]),
          round: value(row[11]),
          capacity: value(row[12]),
        };
        const signature = CORE.eventSignature(identity);
        const ordinal = signatures.get(signature) || 0;
        signatures.set(signature, ordinal + 1);
        const eventKey = CORE.stableEventKey(identity, ordinal);
        const eventParticipants = rows.slice(merged.start, merged.start + merged.count).map((record, offset) => {
          const player = database.players?.[record[0]] || [];
          return {
            playerId: record[0],
            playerKey: text(player[3] || player[0]),
            name: text(player[0]),
            nationality: value(player[1]),
            birthDate: text(player[2]),
            points: value(record[1]),
            heats: value(record[2]),
            startNumber: value(record[14]),
            rowIndex: merged.start + offset,
          };
        });
        const classificationRows = eventParticipants.map((player) => ({ points: player.points, home, away, score }));
        const classification = classicTeam ? CORE.classifyTeamEvent(classificationRows, { home, away, score }) : null;
        events.push({
          ...identity,
          key: eventKey,
          eventKey,
          eventDate: merged.eventDate || "",
          eventDateConflict: !!merged.eventDateConflict,
          eventDateCandidates: merged.eventDateCandidates || [],
          type: CORE.eventType({ classicTeam, multiTeam }),
          classicTeam,
          multiTeam,
          count: Number(merged.count) || eventParticipants.length,
          fragmentCount: Number(merged.fragmentCount) || 1,
          teams,
          teamKeys: [...new Set([home, away, ...teams.map((team) => team.name)].filter(Boolean))],
          participants: eventParticipants,
          classification,
          rowStart: merged.start,
          rowEnd: merged.start + merged.count - 1,
        });
      }
    }
    const aliasEntries = (source) => [...source.values()].map((item) => ({
      value: item.value,
      count: item.count,
      seasons: [...item.seasons].sort(),
    }));
    const players = (database?.players || []).map((player, id) => ({
      id,
      key: text(player[3] || player[0]),
      name: text(player[0]),
      nationality: value(player[1]),
      birthDate: text(player[2]),
      count: playerStats[id]?.count || 0,
      seasons: [...(playerStats[id]?.seasons || [])].sort(),
    })).filter((player) => player.count > 0);
    const latestSeason = Math.max(0, ...includedSeasons.map(Number));
    const dateDiagnostics = (database?.eventDateDiagnostics || []).filter((item) => !selectedSeasons || selectedSeasons.has(String(item?.season ?? item?.year ?? "")));
    return {
      hash: text(options.hash),
      latestSeason: String(latestSeason || ""),
      events,
      players,
      trackEntries: aliasEntries(trackMap),
      teamEntries: aliasEntries(teamMap),
      dateDiagnostics,
      databaseStats: database?.stats || {},
    };
  }

  function findScoreIssues(events) {
    const issues = [];
    let unknown = 0;
    for (const event of (events || []).filter((item) => text(item.type) === "team")) {
      const rows = participants(event).map((player) => ({
        points: player.points,
        home: event.home,
        away: event.away,
        score: event.score,
      }));
      const classification = event.classification || CORE.classifyTeamEvent(rows, event);
      if (!classification?.classified) {
        unknown += 1;
        continue;
      }
      const sums = [0, 0];
      participants(event).forEach((player, index) => {
        const points = CORE.parsePointsBreakdown(player.points).points;
        const side = classification.sides?.[index];
        if (Number.isFinite(points) && side === "HOME") sums[0] += points;
        if (Number.isFinite(points) && side === "AWAY") sums[1] += points;
      });
      const stored = scoreNumbers(event.score);
      if (!stored || (Math.abs(stored[0] - sums[0]) < 1e-9 && Math.abs(stored[1] - sums[1]) < 1e-9)) continue;
      const result = issue("score_mismatch", "HIGH", event,
        `Suma zawodników ${sums[0]}-${sums[1]} różni się od wyniku ${event.score}.`);
      result.calculatedScore = sums;
      result.storedScore = stored;
      issues.push(result);
    }
    return { issues, unknown };
  }

  function findPointsHeatIssues(events) {
    const issues = [];
    for (const event of events || []) {
      for (const player of participants(event)) {
        const points = CORE.parsePointsBreakdown(player.points);
        const heats = CORE.parseHeats(player.heats);
        const rawHeats = text(player.heats);
        const numericHeatTokens = rawHeats.split(",").map((token) => Number(token.trim().replace("*", "").replace(",", "."))).filter(Number.isFinite);
        const standardSpeedwayScale = !(/\d\.\d/.test(rawHeats) && !rawHeats.includes(",")) && numericHeatTokens.length > 0 && numericHeatTokens.every((value) => value >= 0 && value <= 3);
        const reasons = [];
        let confidence = "REVIEW";
        if (heats.unknown >= 2 || (heats.tokens >= 3 && heats.unknown / heats.tokens >= 0.4)) reasons.push(`${heats.unknown} nierozpoznanych tokenów biegowych`);
        if (heats.rides > 9) reasons.push(`nietypowa liczba biegów: ${heats.rides}`);
        if (standardSpeedwayScale && points.pointsReliable && heats.rides > 0 && points.points > heats.rides * 4) {
          reasons.push(`punkty ${points.points} przekraczają 4 × ${heats.rides} biegów`);
          if (heats.unknown === 0) confidence = "HIGH";
        } else if (standardSpeedwayScale && points.pointsReliable && heats.rides > 0 && heats.unknown === 0 && Math.abs(points.points - heats.points) > 2) {
          reasons.push(`punkty ${points.points} nie zgadzają się z sumą biegów ${heats.points}`);
        }
        if (!reasons.length) continue;
        const result = issue("points_heats", confidence, {
          ...event,
          player: player.name,
          playerKey: player.playerKey || player.key,
          value: `${text(player.points)} | ${text(player.heats)}`,
          rowStart: Number.isInteger(player.rowIndex) ? player.rowIndex : event.rowStart,
          rowEnd: Number.isInteger(player.rowIndex) ? player.rowIndex : event.rowEnd,
        }, reasons.join("; "));
        result.points = points;
        result.heats = heats;
        issues.push(result);
      }
    }
    return issues;
  }

  function sortIssues(issues, sort = "confidence") {
    return [...(issues || [])].sort((a, b) => {
      const confidence = (CONFIDENCE_ORDER[a.confidence] ?? 9) - (CONFIDENCE_ORDER[b.confidence] ?? 9);
      const season = Number(b.season || 0) - Number(a.season || 0);
      const date = text(b.date).localeCompare(text(a.date));
      const category = text(a.category).localeCompare(text(b.category), "pl");
      if (sort === "season") return season || confidence || date || category;
      if (sort === "type") return category || confidence || season || date;
      return confidence || season || date || category;
    });
  }

  function summaryFor(issues, diagnostics = {}) {
    const count = (predicate) => issues.filter(predicate).length;
    return {
      HIGH: count((item) => item.confidence === "HIGH"),
      REVIEW: count((item) => item.confidence === "REVIEW"),
      suspiciousEvents: count((item) => ["split_candidate", "participant_outlier"].includes(item.category)),
      splitCandidates: count((item) => item.category === "split_candidate"),
      smallEvents: count((item) => item.category === "small_event"),
      duplicateEvents: count((item) => item.category === "duplicate_event"),
      dateProblems: count((item) => ["missing_date", "invalid_date", "date_conflict"].includes(item.category)),
      missingDates: count((item) => item.category === "missing_date"),
      dateConflicts: count((item) => item.category === "date_conflict"),
      suspiciousStartNumbers: count((item) => item.category === "start_number"),
      trackHigh: count((item) => item.category === "track_alias_high"),
      trackReview: count((item) => item.category === "track_alias_review"),
      teamHigh: count((item) => item.category === "team_alias_high"),
      teamReview: count((item) => item.category === "team_alias_review"),
      playerDuplicateCandidates: count((item) => item.category === "player_duplicate"),
      scoreMismatches: count((item) => item.category === "score_mismatch"),
      pointsHeatIssues: count((item) => item.category === "points_heats"),
      aliasSafety: count((item) => item.category === "alias_safety"),
      unknownTeamClassifications: diagnostics.unknownTeamClassifications || 0,
    };
  }

  function auditDataQuality(input = {}, options = {}) {
    const started = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    const events = input.events || [];
    const latestSeason = text(input.latestSeason || Math.max(0, ...events.map((event) => Number(event.season) || 0)));
    const trackAliases = aliasIssues(input.trackEntries || [], "track");
    const teamAliases = aliasIssues(input.teamEntries || [], "team");
    const score = findScoreIssues(events);
    const sections = {
      splitCandidates: findSplitCandidates(events),
      smallEvents: findSmallEvents(events),
      participantOutliers: findParticipantOutliers(events),
      duplicateEvents: findDuplicateEvents(events),
      dateIssues: findDateIssues(events, input.dateDiagnostics, latestSeason),
      startNumberIssues: findStartNumberIssues(events, latestSeason),
      trackAliases,
      teamAliases,
      playerDuplicates: findPlayerDuplicates(input.players || []),
      scoreIssues: score.issues,
      pointsHeatIssues: findPointsHeatIssues(events),
      aliasSafety: aliasSafetyIssues(events, [...trackAliases, ...teamAliases]),
    };
    const issues = sortIssues(Object.values(sections).flat());
    const ended = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    const diagnostics = {
      unknownTeamClassifications: score.unknown,
      eventCount: events.length,
      recordCount: events.reduce((sum, event) => sum + (Number(event.count) || participants(event).length), 0),
      seasonStats: {},
      databaseStats: input.databaseStats || {},
    };
    for (const event of events) {
      const season = text(event.season);
      if (!diagnostics.seasonStats[season]) diagnostics.seasonStats[season] = { events: 0, records: 0, datedEvents: 0 };
      diagnostics.seasonStats[season].events += 1;
      diagnostics.seasonStats[season].records += Number(event.count) || participants(event).length;
      if (text(event.eventDate || event.date)) diagnostics.seasonStats[season].datedEvents += 1;
    }
    return {
      version: 1,
      hash: text(options.hash || input.hash),
      generatedAt: new Date().toISOString(),
      durationMs: ended - started,
      latestSeason,
      sections,
      issues,
      diagnostics,
      summary: summaryFor(issues, diagnostics),
    };
  }

  function filterIssues(issues, filters = {}) {
    return sortIssues((issues || []).filter((item) => {
      if (filters.season && item.season !== String(filters.season) && !(item.seasons || []).map(String).includes(String(filters.season))) return false;
      if (filters.confidence && filters.confidence !== "all" && item.confidence !== filters.confidence) return false;
      if (filters.category && item.category !== filters.category) return false;
      if (filters.league && item.league !== filters.league) return false;
      if (filters.track && (item.canonicalTrack || CORE.canonicalTrackKey(item.track)) !== CORE.canonicalTrackKey(filters.track)) return false;
      return true;
    }), filters.sort);
  }

  const CSV_FIELDS = [
    "category", "confidence", "season", "date", "eventKey", "track", "competition",
    "round", "capacity", "player", "value", "rowStart", "rowEnd", "reason",
  ];

  function csvCell(value) {
    const raw = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
    return /[",\r\n;]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
  }

  function issuesToCSV(issues, fields = CSV_FIELDS) {
    const rows = [fields.join(",")];
    for (const item of issues || []) rows.push(fields.map((field) => csvCell(item[field])).join(","));
    return rows.join("\r\n");
  }

  function auditCacheKey(hash, season = "") {
    const base = `wz2:data-quality:${text(hash) || "local"}`;
    return text(season) ? `${base}:season:${text(season)}` : base;
  }

  function isAuditCacheCurrent(entry, hash, season = "") {
    return !!entry && text(entry.hash) === text(hash) && text(entry.season) === text(season) && !!entry.report;
  }

  return {
    CSV_FIELDS,
    aliasIssues,
    auditCacheKey,
    auditDataQuality,
    buildAuditInput,
    filterIssues,
    findDateIssues,
    findDuplicateEvents,
    findPlayerDuplicates,
    findPointsHeatIssues,
    findScoreIssues,
    findSmallEvents,
    findSplitCandidates,
    findStartNumberIssues,
    isAuditCacheCurrent,
    issuesToCSV,
    sortIssues,
    summaryFor,
    suspiciousStartNumber,
  };
});
