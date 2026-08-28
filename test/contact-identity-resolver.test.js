const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveContactIdentity, canonicalIdentityKey } = require('../whatsapp/contact-identity-resolver');

test('resolve nome pela prioridade definida', () => {
  assert.equal(resolveContactIdentity({ phone: '5511999999999', manualName: 'Manual', pushName: 'Push' }).source, 'manual');
  assert.equal(resolveContactIdentity({ phone: '5511999999999', savedName: 'Agenda', pushName: 'Push' }).source, 'saved_contact');
  assert.equal(resolveContactIdentity({ phone: '5511999999999', pushName: 'Push' }).displayName, 'Push');
  assert.equal(resolveContactIdentity({ phone: '5511999999999' }).displayName, '+5511999999999');
});

test('PN e LID compartilham chave quando PN existe', () => {
  assert.equal(canonicalIdentityKey({ phoneJid: '5511999999999@s.whatsapp.net', lidJid: '12345@lid' }), '5511999999999');
});
