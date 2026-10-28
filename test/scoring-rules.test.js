const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateScore, classify, resolveRules, DEFAULT_RULES } = require('../lead-scoring/scoring-engine');
const { defaultRules, defaultSettings, mergeSettings } = require('../lead-scoring/prospecting-store');

const COMPANY = {
  name: 'Clinica Teste',
  category: 'Clinica odontologica',
  website: 'https://clinica.example',
  phone: '(21) 99999-9999',
  reviewCount: 120,
  rating: 4.8,
};

const WEAK_SITE = {
  hasHttps: false,
  hasOwnDomain: true,
  performance: { loadTimeMs: 6000 },
  content: { title: 'Clinica', description: '', h1: '' },
  mobile: { isResponsive: false },
  conversion: { hasWhatsappButton: false, hasForm: false, ctaStrength: 'baixa' },
  tracking: {},
  crawl: { httpErrors: [] },
};

test('preset do motor e preset do store são o mesmo objeto', () => {
  assert.deepEqual(defaultRules(), JSON.parse(JSON.stringify(DEFAULT_RULES)));
});

test('pesos configurados mudam o resultado de verdade', () => {
  const lead = { company: COMPANY };
  const base = calculateScore(lead, WEAK_SITE);
  const tuned = calculateScore(lead, WEAK_SITE, {}, {
    rules: { digitalPain: { missingPixelPoints: 0, missingHttpsPoints: 0, notResponsivePoints: 0, missingWhatsappPoints: 0, multiPainBoostPoints: 0 } },
  });
  assert.ok(tuned.value < base.value, 'zerar pesos de dor deve reduzir o score');
  assert.ok(tuned.components.digitalPain < base.components.digitalPain);

  const boosted = calculateScore(lead, WEAK_SITE, {}, { rules: { commercialFit: { reviewsMidPoints: 40, maxPoints: 60 } } });
  assert.ok(boosted.components.commercialFit > base.components.commercialFit);
});

test('faixas configuradas mudam a classificação', () => {
  assert.equal(classify(80), 'alta');
  assert.equal(classify(80, { highFrom: 90, goodFrom: 60, ignoreBelow: 40 }), 'boa');
  assert.equal(classify(45, { highFrom: 90, goodFrom: 60, ignoreBelow: 50 }), 'ignorar');
});

test('configuração inválida cai no preset em vez de quebrar', () => {
  const rules = resolveRules({ rules: { digitalPain: { missingPixelPoints: 'abc', slowLoadMs: null } } });
  assert.equal(rules.digitalPain.missingPixelPoints, DEFAULT_RULES.digitalPain.missingPixelPoints);
  assert.equal(rules.digitalPain.slowLoadMs, DEFAULT_RULES.digitalPain.slowLoadMs);
});

test('mergeSettings preserva pesos salvos pelo usuário', () => {
  const merged = mergeSettings(defaultSettings(), {
    rules: { thresholds: { highFrom: 88 }, digitalPain: { noWebsitePoints: 25 } },
  });
  assert.equal(merged.rules.thresholds.highFrom, 88);
  assert.equal(merged.rules.digitalPain.noWebsitePoints, 25);
  assert.equal(merged.rules.thresholds.goodFrom, DEFAULT_RULES.thresholds.goodFrom);
});

test('patch parcial de regras não apaga ajustes já salvos', () => {
  const first = mergeSettings(defaultSettings(), {
    rules: { digitalPain: { missingPixelPoints: 21 }, commercialFit: { reviewsHighPoints: 11 } },
  });
  const second = mergeSettings(first, { rules: { thresholds: { highFrom: 90 } } });
  assert.equal(second.rules.digitalPain.missingPixelPoints, 21);
  assert.equal(second.rules.commercialFit.reviewsHighPoints, 11);
  assert.equal(second.rules.thresholds.highFrom, 90);
  assert.equal(second.rules.digitalPain.noWebsitePoints, DEFAULT_RULES.digitalPain.noWebsitePoints);
});

test('Linktree/Instagram no campo website contam como sem site no score', () => {
  const linktreeLead = { company: { ...COMPANY, website: 'https://linktr.ee/clinica.teste' } };
  const instagramLead = { company: { ...COMPANY, website: 'https://instagram.com/clinica.teste' } };
  const noSiteLead = { company: { ...COMPANY, website: '' } };

  const linktreeScore = calculateScore(linktreeLead, {});
  const instagramScore = calculateScore(instagramLead, {});
  const noSiteScore = calculateScore(noSiteLead, {});

  assert.equal(linktreeScore.components.digitalPain, noSiteScore.components.digitalPain);
  assert.equal(instagramScore.components.digitalPain, noSiteScore.components.digitalPain);
  assert.ok(noSiteScore.components.digitalPain >= DEFAULT_RULES.digitalPain.noWebsitePoints);

  const realSiteScore = calculateScore({ company: COMPANY }, WEAK_SITE);
  assert.ok(realSiteScore.components.conversionPotential > noSiteScore.components.conversionPotential);
});
