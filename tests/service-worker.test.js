const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function serviceWorkerContext() {
  const handlers = {};
  const fetches = [];
  const context = {
    URL,
    Promise,
    caches: {
      keys: async () => [],
      delete: async () => true,
      match: async () => null,
      open: async () => ({
        addAll: async () => {},
        match: async () => null,
        put: async () => {},
      }),
    },
    fetch: async (request, options) => {
      fetches.push({ request, options });
      return { ok: true, clone() { return this; } };
    },
    self: {
      location: { origin: "https://app.example" },
      addEventListener(type, handler) { handlers[type] = handler; },
      clients: { claim: async () => {} },
      skipWaiting: async () => {},
    },
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.resolve(__dirname, "../sw.js"), "utf8"),
    context
  );
  return { context, fetches, handlers };
}

test("service worker recognizes versioned database requests without stripping query", () => {
  const { context } = serviceWorkerContext();
  assert.equal(
    context.isDatabaseRequest(new URL(
      "https://raw.githubusercontent.com/cys22-web/wyniki-zuzlowe-db/main/db/latest.wzdb?v=NEW_HASH"
    )),
    true
  );
  assert.equal(
    context.isDatabaseRequest(new URL(
      "https://raw.githubusercontent.com/cys22-web/wyniki-zuzlowe-db/main/db/version.json"
    )),
    true
  );
  assert.equal(context.isDatabaseRequest(new URL("https://app.example/app.js")), false);
});

test("service worker sends WZDB directly to network with the original request", async () => {
  const { fetches, handlers } = serviceWorkerContext();
  const request = {
    method: "GET",
    url: "https://raw.githubusercontent.com/cys22-web/wyniki-zuzlowe-db/main/db/latest.wzdb?v=NEW_HASH",
  };
  let responsePromise;

  handlers.fetch({
    request,
    respondWith(value) { responsePromise = value; },
  });
  await responsePromise;

  assert.equal(fetches.length, 1);
  assert.equal(fetches[0].request, request);
  assert.equal(fetches[0].options.cache, "no-store");
});
