const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { saveToCSV } = require("../utils/csv");
const { percent } = require("../utils/stats");

test("saveToCSV creates a header-only file for empty data", () => {
  const file = path.join(os.tmpdir(), `sigma-empty-${Date.now()}.csv`);
  saveToCSV([], file);
  const content = fs.readFileSync(file, "utf-8");
  fs.unlinkSync(file);
  assert.match(content, /^name,category,rating,totalReviews,phone,website,instagram,email,address/);
});

test("saveToCSV serializes nested objects as JSON", () => {
  const file = path.join(os.tmpdir(), `sigma-nested-${Date.now()}.csv`);
  saveToCSV([{ name: "A", photos: { count: 2 } }], file);
  const content = fs.readFileSync(file, "utf-8");
  fs.unlinkSync(file);
  assert.match(content, /\{""count"":2\}/);
});

test("percent returns 0.0 for empty arrays", () => {
  assert.equal(percent([], () => true), "0.0");
});
