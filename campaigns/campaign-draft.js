const CAMPAIGN_DRAFT_VERSION = 1;

function createCampaignDraft(input = {}) {
  return {
    version: CAMPAIGN_DRAFT_VERSION,
    id: input.id || null,
    name: input.name || '',
    connectionIds: Array.isArray(input.connectionIds) ? [...input.connectionIds] : [],
    recipients: Array.isArray(input.recipients) ? input.recipients.map(normalizeRecipient) : [],
    template: { text: input.template?.text || '', media: input.template?.media || null },
    schedule: { mode: input.schedule?.mode || 'interval', intervalMs: Number(input.schedule?.intervalMs || 30000), startAt: input.schedule?.startAt || null },
    dirty: false,
    source: input.source || 'manual',
  };
}

function normalizeRecipient(value = {}) {
  return { ...value, leadId: value.leadId || value.id || value.phone || value.jid || '', name: String(value.name || ''), phone: value.phone || value.jid || '', source: value.source || 'manual' };
}

function validateCampaignDraft(draft) {
  const errors = [];
  if (!draft || draft.version !== CAMPAIGN_DRAFT_VERSION) errors.push('Versão de draft inválida');
  if (!String(draft?.name || '').trim()) errors.push('Nome da campanha obrigatório');
  if (!Array.isArray(draft?.recipients) || !draft.recipients.length) errors.push('Adicione ao menos um destinatário');
  if (!String(draft?.template?.text || '').trim() && !draft?.template?.media) errors.push('Mensagem ou mídia obrigatória');
  return { valid: errors.length === 0, errors };
}

module.exports = { CAMPAIGN_DRAFT_VERSION, createCampaignDraft, normalizeRecipient, validateCampaignDraft };
