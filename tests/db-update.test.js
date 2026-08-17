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
  }, "startup-123");

  assert.equal(request.url, `${update.VERSION_URL}?check=startup-123`);
  assert.deepEqual(request.options, { cache: "no-store" });
  assert.equal(result.wzdb_sha256, NEW_HASH);
});

test("each version check can bypass the shared raw GitHub cache", () => {
  assert.equal(update.versionUrl(100), `${update.VERSION_URL}?check=100`);
  assert.equal(update.versionUrl(101), `${update.VERSION_URL}?check=101`);
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

test("lifecycle checks wait for online, visible and stale state", () => {
  const now = Date.parse("2026-08-17T12:30:00Z");
  const stale = "2026-08-17T12:00:00Z";
  const fresh = "2026-08-17T12:25:00Z";

  assert.equal(update.shouldCheckVersion({ now, lastChecked: stale }), true);
  assert.equal(update.shouldCheckVersion({ now, lastChecked: fresh }), false);
  assert.equal(update.shouldCheckVersion({ now, lastChecked: stale, online: false }), false);
  assert.equal(update.shouldCheckVersion({ now, lastChecked: stale, visible: false }), false);
  assert.equal(update.shouldCheckVersion({ now, lastChecked: fresh, force: true }), true);
});

test("server hash change downloads, validates, persists and activates the new database", async () => {
  const calls = [];
  const localRecord = {
    built: "2026-08-15T00:00:00Z",
    wzdb_sha256: "c".repeat(64),
  };
  const bytes = new Uint8Array([1, 2, 3]);
  const database = { version: 4, marker: "new" };

  const result = await update.synchronizeDatabase({
    localRecord,
    fetchVersionImpl: async () => version,
    downloadDatabaseImpl: async (receivedVersion) => {
      calls.push(["download", receivedVersion.wzdb_sha256]);
      return bytes;
    },
    parseDatabase: async (receivedBytes) => {
      calls.push(["parse", receivedBytes]);
      return database;
    },
    persistDatabase: async (receivedDatabase, receivedVersion) => {
      calls.push(["persist", receivedDatabase, receivedVersion.wzdb_sha256]);
    },
    activateDatabase: async (receivedDatabase) => {
      calls.push(["activate", receivedDatabase]);
    },
  });

  assert.equal(result.updated, true);
  assert.deepEqual(calls.map(([name]) => name), ["download", "parse", "persist", "activate"]);
});

test("matching hash keeps local data and skips the large WZDB", async () => {
  let downloaded = false;
  const result = await update.synchronizeDatabase({
    localRecord: { wzdb_sha256: NEW_HASH },
    fetchVersionImpl: async () => version,
    downloadDatabaseImpl: async () => {
      downloaded = true;
    },
    parseDatabase: async () => ({}),
    persistDatabase: async () => {},
  });

  assert.equal(result.updated, false);
  assert.equal(downloaded, false);
});

test("legacy local data without wzdb_sha256 is refreshed once", async () => {
  let downloads = 0;
  await update.synchronizeDatabase({
    localRecord: { built: "2026-08-15T00:00:00Z", source_sha256: "b".repeat(64) },
    fetchVersionImpl: async () => version,
    downloadDatabaseImpl: async () => {
      downloads += 1;
      return new Uint8Array([4]);
    },
    parseDatabase: async () => ({ version: 4 }),
    persistDatabase: async () => {},
  });
  assert.equal(downloads, 1);
});

test("parse failure never overwrites or activates the working local database", async () => {
  let persisted = false;
  let activated = false;
  await assert.rejects(
    update.synchronizeDatabase({
      localRecord: { wzdb_sha256: "c".repeat(64) },
      fetchVersionImpl: async () => version,
      downloadDatabaseImpl: async () => new Uint8Array([9]),
      parseDatabase: async () => {
        throw new Error("invalid database");
      },
      persistDatabase: async () => {
        persisted = true;
      },
      activateDatabase: async () => {
        activated = true;
      },
    }),
    /invalid database/
  );
  assert.equal(persisted, false);
  assert.equal(activated, false);
});

test("activation failure invokes rollback of the previous persisted database", async () => {
  let rolledBack = false;
  await assert.rejects(
    update.synchronizeDatabase({
      localRecord: { wzdb_sha256: "c".repeat(64) },
      fetchVersionImpl: async () => version,
      downloadDatabaseImpl: async () => new Uint8Array([7]),
      parseDatabase: async () => ({ version: 4 }),
      persistDatabase: async () => {},
      activateDatabase: async () => {
        throw new Error("activation failed");
      },
      rollbackDatabase: async () => {
        rolledBack = true;
      },
    }),
    /activation failed/
  );
  assert.equal(rolledBack, true);
});

test("birth date includes exact age and invalid dates remain unchanged", () => {
  const today = new Date(2026, 7, 16);
  assert.equal(update.formatBirthDateWithAge("2010-01-01", today), "01.01.2010 (16 l.)");
  assert.equal(update.formatBirthDateWithAge("2010-12-01", today), "01.12.2010 (15 l.)");
  assert.equal(update.formatBirthDateWithAge("2010-02-31", today), "2010-02-31");
  assert.equal(update.formatBirthDateWithAge("2010", today), "2010");
});
