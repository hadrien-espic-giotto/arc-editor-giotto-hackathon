"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const worker = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");

test("every DOM id requested by the app exists in the page", () => {
  const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const requestedIds = [...app.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
  const missing = requestedIds.filter((id) => !htmlIds.has(id));
  assert.deepEqual(missing, []);
});

test("submission page has every requested DOM id and is included in the public site", () => {
  const submissionHTML = fs.readFileSync(path.join(root, "submission.html"), "utf8");
  const submissionApp = fs.readFileSync(path.join(root, "submission.js"), "utf8");
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/pages.yml"), "utf8");
  const ids = new Set([...submissionHTML.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const requested = [...submissionApp.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
  assert.deepEqual(requested.filter((id) => !ids.has(id)), []);
  for (const file of ["submission.html", "submission.js"]) {
    assert.ok(worker.includes(`"./${file}"`));
    assert.ok(workflow.includes(`${file} \\`));
  }
  assert.ok(html.includes('href="submission.html"'));
});

test("page uses only local script and stylesheet assets", () => {
  const assets = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(assets.includes("core.js"));
  assert.ok(assets.includes("app.js"));
  assert.ok(assets.includes("styles.css"));
  assert.equal(assets.some((asset) => /^https?:\/\//.test(asset)), false);
});

test("offline app-shell entries exist", () => {
  const cachedPaths = [...worker.matchAll(/"\.\/([^"]*)"/g)]
    .map((match) => match[1])
    .filter(Boolean);
  cachedPaths.forEach((relativePath) => {
    assert.equal(fs.existsSync(path.join(root, relativePath)), true, `${relativePath} is missing`);
  });
  assert.ok(cachedPaths.includes("index.html"));
  assert.ok(cachedPaths.includes("app.js"));
  assert.ok(cachedPaths.includes("core.js"));
});

test("web app manifest is valid and references a real icon", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
  assert.equal(manifest.start_url, "./index.html");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons.length > 0);
  manifest.icons.forEach((icon) => assert.equal(fs.existsSync(path.join(root, icon.src)), true));
});
