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

  function validHash(value) {
    return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
  }

  function validateVersion(version) {
    if (!version || version.version !== 4 || !validHash(version.wzdb_sha256)) {
      throw new Error("Serwer zwrócił nieprawidłowe metadane bazy WZDB.");
    }
    return version;
  }

  async function fetchVersion(fetchImpl = fetch) {
    const response = await fetchImpl(VERSION_URL, { cache: "no-store" });
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
    VERSION_URL,
    DB_URL,
    databaseUrl,
    downloadDatabase,
    fetchVersion,
    formatBirthDateWithAge,
    formatLocalDateTime,
    needsDatabaseUpdate,
    sha256Hex,
    validateVersion,
  };
});
