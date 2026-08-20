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

test("profile lists use the shared chronological sorter after filtering", () => {
  assert.match(html, /Wyniki: najnowsze pierwsze/);
  assert.match(html, /Najnowsze wyniki są u góry, a najstarsze na dole/);
  assert.match(app, /profileFilteredModel=CORE\.sortPlayerResults\(CORE\.filterRecords/);
  assert.match(app, /filtered=CORE\.sortPlayerResults\(scoped,sortMode\)\.map/);
  assert.match(app, /sorted=sortResultRefs\(rows,'new'\)/);
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
  assert.equal(storage.get("wz-pwa-controller-reload-v47"), "1");
});

test("v4.7 exposes dates, heats, start numbers and advanced track controls", () => {
  for (const id of ["multiTrackToggle", "multiTrackPanel", "multiTrackSearch", "multiTrackOptions"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(app, /eventDate:event\?\.eventDate/);
  assert.match(app, /Sprzeczne eventDate w fragmentach wydarzenia/);
  assert.match(app, /thresholdHeats/);
  assert.match(app, /Numer startowy/);
  assert.match(app, /tracks:\[\.\.\.advancedTrackSelection\]/);
  assert.match(app, /CORE\.sortPlayerResults\(analysis\.results/);
});

test("local PL2 import takes the start number from A without shifting existing fields", () => {
  const importer = app.match(/async function importWorkbook[\s\S]*?async function handleFile/)[0];
  assert.match(importer, /const name=clean\(row\[1\]\)/);
  assert.match(
    importer,
    /const rec=\[pid,S\(row\[2\]\),S\(row\[3\]\),S\(row\[4\]\),S\(row\[5\]\),S\(row\[6\]\),S\(row\[7\]\),S\(row\[8\]\),S\(row\[9\]\),S\(row\[10\]\),S\(row\[11\]\),S\(row\[12\]\),S\(row\[14\]\),S\(row\[15\]\),S\(row\[0\]\)\]/
  );
  assert.match(
    importer,
    /key=\[rec\[5\],rec\[6\],rec\[7\],rec\[8\],rec\[9\],rec\[10\],rec\[11\],rec\[12\]\]\.join\('\|'\)/
  );
  assert.doesNotMatch(importer, /S\(row\[13\]\)\],key=/);
});

test("legacy records and empty start numbers do not render an empty badge", () => {
  const valueExpression = app.match(/val=(i=>i\?STR\[i\]:'')/)[1];
  const context = { STR: ["", "95"] };
  vm.createContext(context);
  assert.equal(vm.runInContext(`(${valueExpression})(undefined)`, context), "");
  assert.equal(vm.runInContext(`(${valueExpression})(0)`, context), "");
  assert.equal(vm.runInContext(`(${valueExpression})(1)`, context), "95");
  assert.match(app, /startNumber\?` <span class="startNumber">/);
});
