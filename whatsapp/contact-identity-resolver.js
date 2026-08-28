const SOURCES = [
  ['manual', 1], ['saved_contact', 0.95], ['verified_name', 0.9],
  ['push_name', 0.8], ['chat_name', 0.7], ['maps', 0.6], ['phone', 0.2],
];

function validName(value, phone = '') {
  const name = String(value || '').trim();
  return !!name && name !== phone && !/^\+?[\d\s().-]+$/.test(name);
}

function resolveContactIdentity(input = {}) {
  const phone = input.phoneJid || input.phone || input.jid || '';
  const candidates = [
    ['manual', input.manualName], ['saved_contact', input.savedName || input.contactName],
    ['verified_name', input.verifiedName], ['push_name', input.pushName],
    ['chat_name', input.chatName], ['maps', input.companyName || input.mapsName],
  ];
  const chosen = candidates.find(([, value]) => validName(value, phone));
  const source = chosen ? chosen[0] : 'phone';
  const displayName = chosen ? String(chosen[1]).trim() : formatPhone(phone);
  return { displayName, source, confidence: SOURCES.find(([key]) => key === source)?.[1] || 0.2, updatedAt: Date.now(), jid: input.jid || '', phoneJid: input.phoneJid || phone, lidJid: input.lidJid || '' };
}

function formatPhone(value) { const text = String(value || '').replace(/@.*$/, ''); return text ? (text.startsWith('+') ? text : `+${text}`) : 'Número desconhecido'; }
function canonicalIdentityKey(input = {}) { return String(input.phoneJid || input.phone || input.lidJid || input.jid || '').replace(/@.*$/, '').replace(/\D/g, ''); }

module.exports = { resolveContactIdentity, canonicalIdentityKey, formatPhone };
