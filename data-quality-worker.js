"use strict";

importScripts("app-core.js", "data-quality.js");

self.onmessage = (event) => {
  const started = performance.now();
  try {
    const { database, hash } = event.data || {};
    self.postMessage({ type: "progress", stage: "model", message: "Przygotowuję model wydarzeń…" });
    const buildStarted = performance.now();
    const input = self.WZDataQuality.buildAuditInput(database, { hash });
    const buildMs = performance.now() - buildStarted;
    self.postMessage({ type: "progress", stage: "audit", message: "Analizuję jakość danych…" });
    const report = self.WZDataQuality.auditDataQuality(input, { hash });
    report.buildMs = buildMs;
    report.totalMs = performance.now() - started;
    self.postMessage({ type: "done", report });
  } catch (error) {
    self.postMessage({ type: "error", message: error?.message || String(error) });
  }
};
