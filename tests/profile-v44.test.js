const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");

test("profile filters precede tabs and the three views are separate", () => {
  assert.ok(html.indexOf('id="filtersPanel"') < html.indexOf('id="playerTabs"'));
  assert.ok(html.indexOf('id="playerTabs"') < html.indexOf('id="resultsSection"'));
  assert.match(html, /data-player-view="results"/);
  assert.match(html, /data-player-view="stats"/);
  assert.match(html, /data-player-view="threshold"/);
});

test("tab switching changes visibility without clearing shared filters", () => {
  const body = app.match(/function setPlayerView[\s\S]*?function hidePlayerV44/)[0];
  assert.doesNotMatch(body, /clearFilters|\.value\s*=\s*['"]{2}/);
  assert.match(body, /playerView==='threshold'/);
});

test("v4.5 profile exposes synchronized quick filters, current form and a metric toggle", () => {
  assert.match(html, /id="quickProfileFilters"/);
  assert.match(html, /id="currentForm"/);
  assert.match(html, /id="formChart"/);
  assert.match(html, /data-form-metric="points"/);
  assert.match(html, /data-form-metric="heat"/);
  assert.match(html, /id="thresholdRangeChips"/);
  assert.match(html, /id="thresholdPlaceChips"/);
  assert.match(html, /id="cmpForm"/);
  assert.match(app, /type==='competition'\)\$\('comp'\)\.value/);
  assert.match(app, /\$\('thresholdLast'\)\.value=button\.dataset\.thresholdLast/);
  assert.match(app, /\$\('thresholdPlace'\)\.value=button\.dataset\.thresholdPlace/);
});

test("small-sample warnings follow the requested 1-5 and 6-10 boundaries", () => {
  assert.match(app, /analysis\.sample>=1&&analysis\.sample<=5/);
  assert.match(app, /analysis\.sample<=10&&analysis\.sample>5/);
  assert.match(app, /Mała próba – wynik może być mało reprezentatywny/);
  assert.match(app, /Ograniczona próba – interpretuj wynik ostrożnie/);
});

test("service-worker controller change performs at most one guarded reload", async () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const source = scripts.at(-1)[1];
  const handlers = {};
  const storage = new Map();
  let reloads = 0;
  const context = {
    console,
    setTimeout() {},
    sessionStorage: {
      getItem(key) { return storage.get(key) || null; },
      setItem(key, value) { storage.set(key, value); },
      removeItem(key) { storage.delete(key); },
    },
    location: { reload() { reloads += 1; } },
    window: { addEventListener(type, handler) { handlers[`window:${type}`] = handler; } },
    navigator: { serviceWorker: {
      controller: {},
      addEventListener(type, handler) { handlers[type] = handler; },
      async register() { return { async update() {} }; },
    } },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  await handlers["window:load"]();
  handlers.controllerchange();
  handlers.controllerchange();
  assert.equal(reloads, 1);
  assert.equal(storage.get("wz-pwa-controller-reload-v46"), "1");
});
