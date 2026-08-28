const test = require('node:test');
const assert = require('node:assert/strict');
const { createCampaignDraft, validateCampaignDraft } = require('../campaigns/campaign-draft');

test('draft tem schema estável e valida revisão', () => {
  const draft = createCampaignDraft({ name: 'Teste', recipients: [{ phone: '5511', name: 'A' }], template: { text: 'Oi {{name}}' }, source: 'lead_scoring' });
  assert.equal(draft.version, 1);
  assert.equal(validateCampaignDraft(draft).valid, true);
  assert.equal(validateCampaignDraft(createCampaignDraft()).valid, false);
});
