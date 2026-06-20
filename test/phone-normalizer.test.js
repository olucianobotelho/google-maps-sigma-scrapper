const assert = require("node:assert/strict");
const test = require("node:test");

const { normalizePhone } = require("../whatsapp/phone-normalizer");

test("normalizes Brazilian local numbers with default country code", () => {
  assert.deepEqual(normalizePhone("(21) 99999-8888"), {
    valid: true,
    number: "5521999998888",
  });
});

test("keeps explicit international numbers", () => {
  assert.deepEqual(normalizePhone("+1 212 555 1234"), {
    valid: true,
    number: "12125551234",
  });
});

test("rejects short phone numbers", () => {
  const result = normalizePhone("12345");
  assert.equal(result.valid, false);
});
