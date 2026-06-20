const assert = require("node:assert/strict");
const test = require("node:test");
const os = require("node:os");
const path = require("node:path");

const {
  assertConnectionId,
  createConnectionId,
  resolveInside,
} = require("../utils/security");

test("connection ids are generated in the allowed shape", () => {
  const id = createConnectionId();
  assert.equal(assertConnectionId(id), id);
});

test("connection id rejects traversal and absolute paths", () => {
  assert.throws(() => assertConnectionId(".."));
  assert.throws(() => assertConnectionId("../wa_x"));
  assert.throws(() => assertConnectionId("C:\\temp\\wa_x"));
  assert.throws(() => assertConnectionId("wa_ok/evil"));
});

test("resolveInside rejects paths outside base", () => {
  const base = path.join(os.tmpdir(), "sigma-security-base");
  assert.equal(resolveInside(base, "child").startsWith(path.resolve(base)), true);
  assert.throws(() => resolveInside(base, "..", "outside"));
  assert.throws(() => resolveInside(base, path.resolve(os.tmpdir(), "outside")));
});
