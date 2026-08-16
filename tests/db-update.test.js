const assert = require("node:assert/strict");
const { createHash, webcrypto } = require("node:crypto");
const test = require("node:test");

const update = require("../db-update.js");

const NEW_HASH = "a".repeat(64);
const version = {
  version: 4,
  built: "2026-08-16T10:54:43Z",
  source_sha256: "b".repeat(64),
  wzdb_sha256: NEW_HASH,
};

test("old or missing local hash requires a one-time WZDB download", () => {
  assert.equal(
    update.needsDatabaseUpdate({ built: "2026-08-15T00:00:00Z" }, version),
    true
  );
  assert.equal(
    update.needsDatabaseUpdate({ wzdb_sha256: "c".repeat(64) }, version),
    true
  );
});

test("matching local wzdb_sha256 skips the large database download", () => {
  assert.equal(update.needsDatabaseUpdate({ wzdb_sha256: NEW_HASH }, version), false);
});

test("database URL is cache-busted with wzdb_sha256", () => {
  assert.equal(
    update.databaseUrl(version),
    `${update.DB_URL}?v=${NEW_HASH}`
  );
});

test("version.json is always fetched with cache no-store", async () => {
  let request;
  const result = await update.fetchVersion(async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => version };
  });

  assert.equal(request.url, update.VERSION_URL);
  assert.deepEqual(request.options, { cache: "no-store" });
  assert.equal(result.wzdb_sha256, NEW_HASH);
});

test("WZDB download uses hash URL, no-store and verifies SHA-256", async () => {
  const bytes = new TextEncoder().encode("fresh-wzdb");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const freshVersion = { ...version, wzdb_sha256: hash };
  let request;

  const downloaded = await update.downloadDatabase(freshVersion, {
    cryptoImpl: webcrypto,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        arrayBuffer: async () => bytes.buffer,
      };
    },
  });

  assert.equal(request.url, `${update.DB_URL}?v=${hash}`);
  assert.deepEqual(request.options, { cache: "no-store" });
  assert.deepEqual(downloaded, bytes);
});

test("a SHA-256 mismatch rejects the new WZDB", async () => {
  const bytes = new TextEncoder().encode("stale-wzdb");

  await assert.rejects(
    update.downloadDatabase(version, {
      cryptoImpl: webcrypto,
      fetchImpl: async () => ({
        ok: true,
        arrayBuffer: async () => bytes.buffer,
      }),
    }),
    /nieprawidłową sumę SHA-256/
  );
});

test("birth date includes exact age and invalid dates remain unchanged", () => {
  const today = new Date(2026, 7, 16);
  assert.equal(update.formatBirthDateWithAge("2010-01-01", today), "01.01.2010 (16 l.)");
  assert.equal(update.formatBirthDateWithAge("2010-12-01", today), "01.12.2010 (15 l.)");
  assert.equal(update.formatBirthDateWithAge("2010-02-31", today), "2010-02-31");
  assert.equal(update.formatBirthDateWithAge("2010", today), "2010");
});
