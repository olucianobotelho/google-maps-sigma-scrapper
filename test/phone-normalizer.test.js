const assert = require("node:assert/strict");
const test = require("node:test");

const { normalizePhone, isServiceNumber } = require("../whatsapp/phone-normalizer");

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

test("rejects empty and non-string input", () => {
  assert.equal(normalizePhone("").valid, false);
  assert.equal(normalizePhone(null).valid, false);
  assert.equal(normalizePhone(5511999999999).valid, false);
});

// ─── Matriz de números reais de operadoras/empresas ────────────────────────
// Fixo e móvel das principais operadoras, em formatos como o Google Maps
// entrega. O resultado esperado é sempre DDI + DDD + número.
const CARRIER_CASES = [
  // Vivo (fixo e móvel)
  { input: "(11) 3322-4455", expected: "551133224455", label: "Vivo fixo SP" },
  { input: "(11) 99999-0000", expected: "5511999990000", label: "Vivo móvel SP" },
  { input: "11 98888-7777", expected: "5511988887777", label: "Vivo móvel sem parênteses" },
  // Claro (fixo 4004 e móvel)
  { input: "(11) 4004-1001", expected: "551140041001", label: "Claro fixo corporativo 4004" },
  { input: "(31) 99999-1111", expected: "5531999991111", label: "Claro móvel MG" },
  // Oi (fixo e móvel)
  { input: "(21) 3131-2000", expected: "552131312000", label: "Oi fixo RJ" },
  { input: "(71) 98888-2222", expected: "5571988882222", label: "Oi móvel BA" },
  // TIM
  { input: "(41) 99999-3333", expected: "5541999993333", label: "TIM móvel PR" },
  { input: "(85) 98888-4444", expected: "5585988884444", label: "TIM móvel CE" },
  // Nextel / Algar e afins
  { input: "(11) 99999-5555", expected: "5511999995555", label: "Nextel móvel SP" },
  // Embratel / operadora fixa corporativa
  { input: "(21) 4004-6000", expected: "552140046000", label: "Embratel fixo corporativo" },
  // Telefone com zero de discagem (como sai de planilhas antigas)
  { input: "011 98888-6666", expected: "5511988886666", label: "Móvel com zero de discagem" },
  { input: "021 3131-2000", expected: "552131312000", label: "Fixo com zero de discagem" },
  // Já internacional
  { input: "+55 11 99999-7777", expected: "5511999997777", label: "Móvel com +55" },
  { input: "5511999997777", expected: "5511999997777", label: "Móvel já com DDI" },
  { input: "551133224455", expected: "551133224455", label: "Fixo já com DDI" },
];

for (const { input, expected, label } of CARRIER_CASES) {
  test(`accepts ${label}: ${input}`, () => {
    assert.deepEqual(normalizePhone(input), { valid: true, number: expected });
  });
}

// DDD 55 (Santa Maria/RS): o prefixo "55" é DDD, não código de país.
const DDD_55_CASES = [
  { input: "(55) 99999-9999", expected: "5555999999999", label: "móvel" },
  { input: "55 99999-9999", expected: "5555999999999", label: "móvel sem parênteses" },
  { input: "55999999999", expected: "5555999999999", label: "móvel sem máscara" },
  { input: "(55) 3222-1234", expected: "555532221234", label: "fixo" },
  { input: "5532221234", expected: "555532221234", label: "fixo sem máscara" },
  { input: "+55 55 99999-9999", expected: "5555999999999", label: "móvel com +55" },
  { input: "5555999999999", expected: "5555999999999", label: "móvel já com DDI" },
];

for (const { input, expected, label } of DDD_55_CASES) {
  test(`accepts DDD 55 (${label}): ${input}`, () => {
    assert.deepEqual(normalizePhone(input), { valid: true, number: expected });
  });
}

test("DDD 55 numbers are not mistaken for country code", () => {
  const local = normalizePhone("(55) 3222-1234");
  const international = normalizePhone("+55 55 3222-1234");
  assert.equal(local.valid, true, "fixo com DDD 55 precisa ser aceito");
  assert.equal(international.valid, true);
  assert.equal(local.number, international.number);
});

test("rejects service numbers that cannot receive WhatsApp", () => {
  for (const input of [
    "0800 123 4567",
    "0800-591-1234",
    "0300 210 1234",
    "0500 123 4567",
    "0900 123 4567",
  ]) {
    const result = normalizePhone(input);
    assert.equal(result.valid, false, `${input} deveria ser recusado`);
    assert.match(result.reason, /servi/i);
  }
});

test("flags service numbers before stripping the dialing zero", () => {
  assert.equal(isServiceNumber("0800 123 4567"), true);
  assert.equal(isServiceNumber("011 98888-6666"), false);
  assert.equal(isServiceNumber("(55) 99999-9999"), false);
});

test("rejects numbers without DDD", () => {
  assert.equal(normalizePhone("4004-1001").valid, false);
  assert.equal(normalizePhone("1052").valid, false);
});
