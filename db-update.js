(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.WZDBUpdate = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION_URL =
    "https://raw.githubusercontent.com/cys22-web/wyniki-zuzlowe-db/main/db/version.json";
  const DB_URL =
    "https://raw.githubusercontent.com/cys22-web/wyniki-zuzlowe-db/main/db/latest.wzdb";
  const DEFAULT_CHECK_INTERVAL_MS = 15 * 60 * 1000;

  function validHash(value) {
    return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
  }

  function validateVersion(version) {
    if (!version || version.version !== 4 || !validHash(version.wzdb_sha256)) {
      throw new Error("Serwer zwrócił nieprawidłowe metadane bazy WZDB.");
    }
    return version;
  }

  function versionUrl(checkToken = Date.now()) {
    return `${VERSION_URL}?check=${encodeURIComponent(String(checkToken))}`;
  }

  async function fetchVersion(fetchImpl = fetch, checkToken = Date.now()) {
    const response = await fetchImpl(versionUrl(checkToken), { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Nie można sprawdzić wersji bazy (${response.status}).`);
    }
    return validateVersion(await response.json());
  }

  function databaseUrl(version) {
    validateVersion(version);
    return `${DB_URL}?v=${encodeURIComponent(version.wzdb_sha256)}`;
  }

  function needsDatabaseUpdate(localRecord, version) {
    validateVersion(version);
    return (
      !localRecord ||
      !validHash(localRecord.wzdb_sha256) ||
      localRecord.wzdb_sha256.toLowerCase() !== version.wzdb_sha256.toLowerCase()
    );
  }

  function shouldCheckVersion({
    online = true,
    visible = true,
    force = false,
    now = Date.now(),
    lastChecked = null,
    minIntervalMs = DEFAULT_CHECK_INTERVAL_MS,
  } = {}) {
    if (!online || !visible) return false;
    if (force) return true;
    const checkedAt =
      typeof lastChecked === "number" ? lastChecked : Date.parse(lastChecked || "");
    return !Number.isFinite(checkedAt) || now - checkedAt >= minIntervalMs;
  }

  async function sha256Hex(bytes, cryptoImpl = globalThis.crypto) {
    if (!cryptoImpl || !cryptoImpl.subtle) return null;
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const digest = await cryptoImpl.subtle.digest("SHA-256", view);
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
  }

  async function downloadDatabase(
    version,
    { fetchImpl = fetch, cryptoImpl = globalThis.crypto } = {}
  ) {
    const response = await fetchImpl(databaseUrl(version), { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Nie można pobrać bazy WZDB (${response.status}).`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const actualHash = await sha256Hex(bytes, cryptoImpl);
    if (actualHash && actualHash.toLowerCase() !== version.wzdb_sha256.toLowerCase()) {
      throw new Error("Pobrana baza ma nieprawidłową sumę SHA-256.");
    }
    return bytes;
  }

  async function synchronizeDatabase({
    localRecord = null,
    fetchVersionImpl = fetchVersion,
    downloadDatabaseImpl = downloadDatabase,
    parseDatabase,
    persistDatabase,
    activateDatabase = async () => {},
    rollbackDatabase = async () => {},
    onStage = () => {},
  } = {}) {
    if (typeof parseDatabase !== "function" || typeof persistDatabase !== "function") {
      throw new TypeError("Synchronizacja WZDB wymaga parsera i magazynu danych.");
    }
    await onStage("checking");
    const version = await fetchVersionImpl();
    await onStage("checked", { version });
    if (!needsDatabaseUpdate(localRecord, version)) {
      return { updated: false, version, bytes: null, database: null };
    }

    await onStage("downloading", { version });
    const bytes = await downloadDatabaseImpl(version);
    await onStage("parsing", { version, bytes });
    const database = await parseDatabase(bytes, version);
    await onStage("persisting", { version, bytes, database });
    await persistDatabase(database, version, bytes);
    try {
      await onStage("activating", { version, database });
      await activateDatabase(database, version);
    } catch (error) {
      try {
        await rollbackDatabase(error);
      } catch (rollbackError) {
        console.error("Nie udało się przywrócić poprzedniej bazy WZDB.", rollbackError);
      }
      throw error;
    }
    return { updated: true, version, bytes, database };
  }

  function formatLocalDateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? String(value)
      : new Intl.DateTimeFormat("pl-PL", {
          dateStyle: "short",
          timeStyle: "medium",
        }).format(date);
  }

  function formatBirthDateWithAge(value, now = new Date()) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return String(value || "");
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const checked = new Date(Date.UTC(year, month - 1, day));
    if (
      checked.getUTCFullYear() !== year ||
      checked.getUTCMonth() !== month - 1 ||
      checked.getUTCDate() !== day
    ) {
      return String(value);
    }
    let age = now.getFullYear() - year;
    if (
      now.getMonth() + 1 < month ||
      (now.getMonth() + 1 === month && now.getDate() < day)
    ) {
      age -= 1;
    }
    return `${match[3]}.${match[2]}.${match[1]} (${age} l.)`;
  }

  return {
    DEFAULT_CHECK_INTERVAL_MS,
    VERSION_URL,
    DB_URL,
    databaseUrl,
    downloadDatabase,
    fetchVersion,
    formatBirthDateWithAge,
    formatLocalDateTime,
    needsDatabaseUpdate,
    sha256Hex,
    shouldCheckVersion,
    synchronizeDatabase,
    validateVersion,
    versionUrl,
  };
});
