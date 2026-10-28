const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { normalizeAddress } = require('../utils/address-normalizer');
const { normalizeText } = require('../utils/text-normalizer');
const { normalizeWebsite, isRealWebsite } = require('../utils/lead-links');

const VERSION = 2;
const MAX_COLUMNS = 12;
const MAX_RULES = 50;
const MAX_EVENTS = 500;

const ALLOWED_FIELDS = new Set([
  'score',
  'priority',
  'hasPhone',
  'hasWebsite',
  'hasEmail',
  'category',
  'city',
  'source',
  'campaignStatus',
  'prospectingStatus',
]);

const ALLOWED_OPERATORS = new Set([
  'gte',
  'lte',
  'equals',
  'contains',
  'isTrue',
  'isFalse',
  'in',
]);

const ALLOWED_TRIGGERS = new Set([
  'any',
  'lead.imported',
  'scoring.completed',
  'campaign.sent',
  'campaign.replied',
  'deal.won',
  'deal.lost',
  'sync',
]);

const DEFAULT_COLUMNS = [
  { id: 'new', name: 'Novos', color: '#10a37f', position: 0, terminal: false, dealOutcome: null, wipLimit: null },
  { id: 'sent', name: 'Abordados', color: '#0ea5e9', position: 1, terminal: false, dealOutcome: null, wipLimit: null },
  { id: 'contacted', name: 'Responderam', color: '#3b82f6', position: 2, terminal: false, dealOutcome: null, wipLimit: null },
  { id: 'qualified', name: 'Qualificados', color: '#8b5cf6', position: 3, terminal: false, dealOutcome: null, wipLimit: null },
  { id: 'proposal', name: 'Proposta', color: '#f59e0b', position: 4, terminal: false, dealOutcome: null, wipLimit: null },
  { id: 'won', name: 'Vendeu', color: '#16a34a', position: 5, terminal: true, dealOutcome: 'won', wipLimit: null },
  { id: 'lost', name: 'Recusou', color: '#ef4444', position: 6, terminal: true, dealOutcome: 'lost', wipLimit: null },
];

const DEFAULT_AUTOMATIONS = [
  { id: 'message-sent', enabled: true, priority: 1, trigger: 'campaign.sent', match: 'all', when: [], action: { type: 'move', columnId: 'sent' } },
  { id: 'message-replied', enabled: true, priority: 2, trigger: 'campaign.replied', match: 'all', when: [], action: { type: 'move', columnId: 'contacted' } },
  { id: 'deal-won', enabled: true, priority: 3, trigger: 'deal.won', match: 'all', when: [], action: { type: 'move', columnId: 'won' } },
  { id: 'deal-lost', enabled: true, priority: 4, trigger: 'deal.lost', match: 'all', when: [], action: { type: 'move', columnId: 'lost' } },
];

const LEGACY_DEFAULT_COLUMN_IDS = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'];

// Cada fonte guarda seus próprios ids em sourceRefs; é isso que permite remover
// um lead que saiu da base sem apagar quem ainda existe em outra fonte.
const SOURCE_FIELDS = {
  maps: 'mapsIds',
  scoring: 'scoringIds',
  campaign: 'campaignRefs',
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function now() {
  return Date.now();
}

function cleanText(value, max = 160) {
  return normalizeText(value).slice(0, max);
}

function fold(value) {
  return cleanText(value, 500)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function toTimestamp(value) {
  if (value == null || value === '') return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 1e12 ? numeric * 1000 : numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizePhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 18 ? digits : '';
}

function slug(value, fallback) {
  const normalized = fold(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return normalized || fallback;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function sameArray(a = [], b = []) {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function sameShallow(a = {}, b = {}) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if ((a[key] ?? '') !== (b[key] ?? '')) return false;
  }
  return true;
}

function isHexColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value ?? ''));
}

function defaultState() {
  return {
    version: VERSION,
    revision: 1,
    board: {
      columns: clone(DEFAULT_COLUMNS),
      rules: clone(DEFAULT_AUTOMATIONS),
    },
    entities: {},
    cards: {},
    events: [],
    updatedAt: now(),
  };
}

function normalizeColumn(column, index, seen) {
  const fallbackId = `stage-${index + 1}`;
  let id = slug(column?.id || column?.name, fallbackId);
  let suffix = 2;
  while (seen.has(id)) {
    id = `${slug(column?.id || column?.name, fallbackId)}-${suffix}`;
    suffix += 1;
  }
  seen.add(id);
  const rawWip = Number(column?.wipLimit);
  return {
    id,
    name: cleanText(column?.name || 'Etapa', 60) || 'Etapa',
    color: isHexColor(column?.color) ? column.color.toLowerCase() : DEFAULT_COLUMNS[index % DEFAULT_COLUMNS.length].color,
    position: index,
    terminal: Boolean(column?.terminal),
    // Marca o significado comercial da etapa final, para "Ganhou/Perdeu"
    // saberem para onde mover o card.
    dealOutcome: ['won', 'lost'].includes(column?.dealOutcome) ? column.dealOutcome : null,
    wipLimit: Number.isInteger(rawWip) && rawWip > 0 && rawWip <= 999 ? rawWip : null,
  };
}

function normalizeRule(rule, index, columnIds) {
  const when = Array.isArray(rule?.when) ? rule.when.slice(0, 6) : [];
  const normalizedWhen = when.map((condition) => {
    const field = ALLOWED_FIELDS.has(condition?.field) ? condition.field : 'score';
    const operator = ALLOWED_OPERATORS.has(condition?.operator) ? condition.operator : 'gte';
    return {
      field,
      operator,
      value: cleanText(condition?.value, 160),
    };
  });
  const columnId = String(rule?.action?.columnId || '');
  // Etapa removida não redireciona a regra em silêncio: a regra fica desativada
  // e marcada para revisão até o usuário escolher um destino válido.
  const missingColumn = !columnIds.has(columnId);
  return {
    id: slug(rule?.id || `rule-${index + 1}`, `rule-${index + 1}`),
    enabled: missingColumn ? false : rule?.enabled !== false,
    priority: Math.max(0, Math.min(999, Math.trunc(toNumber(rule?.priority)))),
    trigger: ALLOWED_TRIGGERS.has(rule?.trigger) ? rule.trigger : 'sync',
    match: rule?.match === 'any' ? 'any' : 'all',
    when: normalizedWhen,
    action: { type: 'move', columnId: missingColumn ? '' : columnId },
    problem: missingColumn ? 'missing_column' : null,
  };
}

function normalizeBoard(board) {
  const storedColumns = Array.isArray(board?.columns) && board.columns.length
    ? board.columns.slice(0, MAX_COLUMNS)
    : null;
  // Migrate only the exact old default. Custom pipelines stay untouched.
  const hasLegacyDefault = Array.isArray(storedColumns)
    && storedColumns.length === LEGACY_DEFAULT_COLUMN_IDS.length
    && storedColumns.every((column, index) => String(column?.id || '') === LEGACY_DEFAULT_COLUMN_IDS[index]);
  const sourceColumns = storedColumns && !hasLegacyDefault
    ? storedColumns
    : DEFAULT_COLUMNS;
  const seen = new Set();
  const columns = sourceColumns.map((column, index) => normalizeColumn(column, index, seen));
  const columnIds = new Set(columns.map((column) => column.id));
  const seenRuleIds = new Set();
  const rules = (Array.isArray(board?.rules) ? board.rules : [])
    .slice(0, MAX_RULES)
    .map((rule, index) => normalizeRule(rule, index, columnIds))
    .filter(Boolean)
    .map((rule, index) => ({ ...rule, id: uniqueRuleId(rule.id, index, seenRuleIds) }));
  return { columns, rules };
}

function uniqueRuleId(value, index, seen) {
  let id = slug(value, `rule-${index + 1}`);
  let suffix = 2;
  while (seen.has(id)) {
    id = `${slug(value, `rule-${index + 1}`)}-${suffix}`;
    suffix += 1;
  }
  seen.add(id);
  return id;
}

function profileFrom(raw = {}) {
  const company = raw.company && typeof raw.company === 'object' ? raw.company : raw;
  const scoreSource = raw.score?.value ?? raw.score ?? company.score?.value ?? company.score;
  const priority = raw.score?.priority ?? raw.priority ?? raw.prioridade ?? company.score?.priority ?? company.priority ?? company.prioridade;
  return {
    name: cleanText(company.name || company.company || raw.name || raw.companyName || '', 140),
    phone: normalizePhone(company.phone || company.whatsapp || raw.phone || raw.whatsapp || raw.phoneRaw || raw.jid),
    website: normalizeWebsite(company.website || company.site || raw.website || raw.site || ''),
    email: cleanText(company.email || company.mail || raw.email || raw.mail || '', 180),
    category: cleanText(company.category || company.cat || raw.category || raw.cat || '', 100),
    address: cleanText(normalizeAddress(company.address || raw.address || ''), 220),
    city: cleanText(company.city || company.cidade || raw.city || raw.cidade || '', 100),
    state: cleanText(company.state || company.uf || raw.state || raw.uf || '', 8),
    score: toNumber(scoreSource),
    priority: cleanText(priority, 40),
    prospectingStatus: cleanText(raw.prospecting?.status || raw.status || company.prospecting?.status || '', 60),
    campaignStatus: cleanText(raw.campaignStatus || raw.status || '', 60),
    lastInteractionAt: toTimestamp(raw.repliedAt || raw.readAt || raw.deliveredAt || raw.sentAt || raw.updatedAt || company.updatedAt),
  };
}

function activityFrom(raw = {}) {
  return {
    messageSentAt: Math.max(toTimestamp(raw.deliveredAt), toTimestamp(raw.sentAt)),
    repliedAt: Math.max(toTimestamp(raw.repliedAt), toTimestamp(raw.firstReplyAt), toTimestamp(raw.lastReplyAt)),
    reminderAt: toTimestamp(raw.nextFollowUpAt || raw.prospecting?.nextFollowUpAt),
  };
}

/** Valor do negócio: aceita as chaves que a base e o scoring já usam. */
function dealValueFrom(raw = {}) {
  const company = raw.company && typeof raw.company === 'object' ? raw.company : raw;
  const candidates = [
    raw.dealValue,
    raw.closedValue,
    raw.prospecting?.closedValue,
    raw.prospecting?.dealValue,
    company.dealValue,
    company.closedValue,
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) return Math.round(value * 100) / 100;
  }
  return 0;
}

function identityKeys(profile) {
  const name = fold(profile.name);
  const address = fold(profile.address);
  const place = fold(`${profile.name}|${profile.address}|${profile.city}|${profile.state}`);
  const website = fold(profile.website);
  const values = [];
  if (profile.phone) values.push(`phone:${profile.phone}`);
  // O Maps nem sempre retorna cidade/UF, enquanto o scoring as deriva do
  // endereço. A chave nome+endereço mantém as duas fontes no mesmo card.
  if (name && address.length > 4) values.push(`name-address:${hash(`${name}|${address}`)}`);
  if (name && place.replace(/\|/g, '').length > 4) values.push(`place:${hash(place)}`);
  if (website && name) values.push(`web:${hash(`${name}|${website}`)}`);
  if (name && profile.city) values.push(`name-city:${hash(`${name}|${fold(profile.city)}`)}`);
  return unique(values);
}

function sourceReference(source, raw, profile) {
  const rawId = cleanText(raw?.id || raw?.leadId || raw?.jid || profile.phone || '', 160);
  if (source === 'scoring') return { field: 'scoringIds', value: rawId };
  if (source === 'campaign') return { field: 'campaignRefs', value: cleanText(`${raw?.campaignId || ''}:${rawId}`, 180) || rawId };
  return { field: 'mapsIds', value: rawId };
}

function eventForSource(source, raw = {}) {
  if (source === 'scoring') return 'scoring.completed';
  if (source === 'campaign') {
    if (raw.status === 'replied') return 'campaign.replied';
    if (raw.status === 'sent' || raw.status === 'delivered' || raw.status === 'read') return 'campaign.sent';
    // Pendente/falha apenas atualiza o card: não é um evento de automação.
    return 'campaign.updated';
  }
  return 'lead.imported';
}

function getFieldValue(entity, field) {
  const profile = entity?.profile || {};
  if (field === 'hasPhone') return Boolean(profile.phone);
  if (field === 'hasWebsite') return isRealWebsite(profile.website);
  if (field === 'hasEmail') return Boolean(profile.email);
  if (field === 'source') {
    const refs = entity?.sourceRefs || {};
    return [
      refs.mapsIds?.length ? 'maps' : '',
      refs.scoringIds?.length ? 'scoring' : '',
      refs.campaignRefs?.length ? 'campaign' : '',
    ].filter(Boolean).join(',');
  }
  return profile[field] ?? '';
}

function matchCondition(entity, condition) {
  const actual = getFieldValue(entity, condition.field);
  const expected = condition.value;
  if (condition.operator === 'isTrue') return Boolean(actual);
  if (condition.operator === 'isFalse') return !actual;
  if (condition.operator === 'gte') return toNumber(actual) >= toNumber(expected);
  if (condition.operator === 'lte') return toNumber(actual) <= toNumber(expected);
  if (condition.operator === 'equals') return fold(actual) === fold(expected);
  if (condition.operator === 'contains') return fold(actual).includes(fold(expected));
  if (condition.operator === 'in') return String(expected || '').split(',').map(fold).includes(fold(actual));
  return false;
}

function ruleMatches(entity, rule) {
  if (!rule.when.length) return true;
  const results = rule.when.map((condition) => matchCondition(entity, condition));
  return rule.match === 'any' ? results.some(Boolean) : results.every(Boolean);
}

class KanbanStore {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'kanban.json');
    this.state = this._load();
    this.state.board = normalizeBoard(this.state.board);
    this.identityIndex = new Map();
    this.nextRankByColumn = new Map();
    this._dirty = false;
    this._rebuildIdentityIndex();
    this._rebuildRankIndex();
  }

  _load() {
    if (!fs.existsSync(this.filePath)) return defaultState();
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Formato inválido');
      const state = {
        ...defaultState(),
        ...parsed,
        version: VERSION,
        entities: parsed.entities && typeof parsed.entities === 'object' ? parsed.entities : {},
        cards: parsed.cards && typeof parsed.cards === 'object' ? parsed.cards : {},
        events: Array.isArray(parsed.events) ? parsed.events.slice(-MAX_EVENTS) : [],
      };
      // v1 tinha movimentos automáticos invisíveis para enviado/respondido.
      // Na v2 eles viram regras reais, visíveis e desligáveis no modo fácil.
      if (toNumber(parsed.version) < 2 && !(state.board?.rules || []).length) {
        state.board = { ...(state.board || {}), rules: clone(DEFAULT_AUTOMATIONS) };
      }
      return state;
    } catch (error) {
      const corruptPath = `${this.filePath}.corrupt-${now()}`;
      try { fs.renameSync(this.filePath, corruptPath); } catch {}
      return defaultState();
    }
  }

  _writeAtomic() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    const backup = `${this.filePath}.bak`;
    if (fs.existsSync(this.filePath)) {
      try { fs.copyFileSync(this.filePath, backup); } catch {}
    }
    fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
  }

  _touch() {
    this.state.updatedAt = now();
    this.state.revision = Math.max(1, toNumber(this.state.revision) + 1);
  }

  _record(type, payload = {}) {
    this.state.events.push({ id: `evt_${now()}_${Math.random().toString(36).slice(2, 8)}`, type, at: now(), ...payload });
    this.state.events = this.state.events.slice(-MAX_EVENTS);
  }

  _rebuildIdentityIndex() {
    this.identityIndex.clear();
    for (const [entityKey, entity] of Object.entries(this.state.entities)) {
      if (!entity || typeof entity !== 'object') continue;
      const aliases = unique([
        ...(Array.isArray(entity.identityKeys) ? entity.identityKeys : []),
        ...identityKeys(entity.profile || {}),
      ]);
      entity.identityKeys = aliases;
      this._indexEntity(entityKey, entity);
    }
  }

  _indexEntity(entityKey, entity) {
    for (const key of Array.isArray(entity?.identityKeys) ? entity.identityKeys : []) {
      if (!key || (this.identityIndex.has(key) && this.identityIndex.get(key) !== entityKey)) continue;
      this.identityIndex.set(key, entityKey);
    }
  }

  _rebuildRankIndex() {
    this.nextRankByColumn.clear();
    for (const card of Object.values(this.state.cards)) {
      if (!card || typeof card !== 'object' || !card.columnId) continue;
      const nextRank = toNumber(card.rank) + 1;
      const current = this.nextRankByColumn.get(card.columnId) || 0;
      if (nextRank > current) this.nextRankByColumn.set(card.columnId, nextRank);
    }
  }

  _findEntityByIdentity(keys) {
    for (const key of keys) {
      const entityKey = this.identityIndex.get(key);
      if (entityKey && this.state.entities[entityKey]) return entityKey;
    }
    return null;
  }

  _mergeProfile(current = {}, incoming = {}) {
    const merged = { ...current };
    for (const [key, value] of Object.entries(incoming)) {
      if (key === 'score') {
        merged.score = Math.max(toNumber(current.score), toNumber(value));
      } else if (key === 'lastInteractionAt') {
        merged.lastInteractionAt = Math.max(toNumber(current.lastInteractionAt), toNumber(value));
      } else if (value !== '' && value != null) {
        merged[key] = value;
      }
    }
    return merged;
  }

  _columnById(columnId) {
    return this.state.board.columns.find((column) => column.id === columnId) || null;
  }

  _columnLoad(columnId) {
    return Object.values(this.state.cards).filter((card) => card.columnId === columnId).length;
  }

  _columnAccepts(column, entityKey) {
    if (!column?.wipLimit) return true;
    const others = Object.entries(this.state.cards)
      .filter(([key, card]) => card.columnId === column.id && key !== entityKey).length;
    return others < column.wipLimit;
  }

  /**
   * Decide a etapa do card. O retorno informa o motivo para a UI explicar o que
   * aconteceu (regra, override manual, WIP cheio ou etapa final).
   */
  _stageFor(entity, card, trigger, force = false, options = {}) {
    const allTriggers = options.allTriggers === true;
    if (card.manualOverride && !force) return { columnId: card.columnId, reason: 'manual' };
    const currentColumn = this._columnById(card.columnId);
    // Etapa final é ponto de chegada: só sai de lá por movimento manual.
    if (currentColumn?.terminal && options.allowTerminalExit !== true) return { columnId: card.columnId, reason: 'terminal' };

    const rules = this.state.board.rules
      .filter((rule) => rule.enabled && rule.action?.columnId
        && (allTriggers || rule.trigger === 'any' || rule.trigger === trigger))
      .sort((a, b) => {
        const aSpecificity = a.trigger === trigger ? 0 : 1;
        const bSpecificity = b.trigger === trigger ? 0 : 1;
        return aSpecificity - bSpecificity || a.priority - b.priority;
      });

    for (const rule of rules) {
      if (!ruleMatches(entity, rule)) continue;
      const column = this._columnById(rule.action.columnId);
      if (!column) continue;
      if (column.id === card.columnId) return { columnId: column.id, reason: 'rule', ruleId: rule.id };
      if (!this._columnAccepts(column, card.entityKey)) return { columnId: card.columnId, reason: 'wip', ruleId: rule.id, columnName: column.name };
      return { columnId: column.id, reason: 'rule', ruleId: rule.id };
    }

    return { columnId: card.columnId || this.state.board.columns[0].id, reason: 'keep' };
  }

  _nextRank(columnId) {
    const rank = this.nextRankByColumn.get(columnId) || 0;
    this.nextRankByColumn.set(columnId, rank + 1);
    return rank;
  }

  _upsertEntity(raw, source, trigger) {
    const profile = profileFrom(raw);
    const keys = identityKeys(profile);
    if (!keys.length) return null;
    let entityKey = this._findEntityByIdentity(keys);
    if (!entityKey) entityKey = keys.find((key) => key.startsWith('phone:')) || keys[0];
    const previousEntity = this.state.entities[entityKey] || null;
    const current = previousEntity || {
      entityKey,
      identityKeys: [],
      sourceRefs: { mapsIds: [], scoringIds: [], campaignRefs: [] },
      profile: {},
      createdAt: now(),
    };
    const previousProfile = previousEntity ? { ...previousEntity.profile } : null;
    const previousKeys = previousEntity ? [...(previousEntity.identityKeys || [])] : [];
    const previousRefs = previousEntity
      ? {
        mapsIds: [...(previousEntity.sourceRefs?.mapsIds || [])],
        scoringIds: [...(previousEntity.sourceRefs?.scoringIds || [])],
        campaignRefs: [...(previousEntity.sourceRefs?.campaignRefs || [])],
      }
      : null;
    const ref = sourceReference(source, raw, profile);
    current.identityKeys = unique([...(current.identityKeys || []), ...keys]);
    current.sourceRefs = {
      mapsIds: unique(current.sourceRefs?.mapsIds || []),
      scoringIds: unique(current.sourceRefs?.scoringIds || []),
      campaignRefs: unique(current.sourceRefs?.campaignRefs || []),
    };
    if (ref.value) current.sourceRefs[ref.field] = unique([...current.sourceRefs[ref.field], ref.value]);
    current.profile = this._mergeProfile(current.profile, profile);
    current.updatedAt = now();
    this.state.entities[entityKey] = current;
    this._indexEntity(entityKey, current);

    if (!previousEntity
      || !sameShallow(previousProfile, current.profile)
      || !sameArray(previousKeys, current.identityKeys)
      || !sameArray(previousRefs.mapsIds, current.sourceRefs.mapsIds)
      || !sameArray(previousRefs.scoringIds, current.sourceRefs.scoringIds)
      || !sameArray(previousRefs.campaignRefs, current.sourceRefs.campaignRefs)) {
      this._dirty = true;
    }

    const existingCard = this.state.cards[entityKey] || {
      entityKey,
      columnId: this.state.board.columns[0].id,
      rank: this._nextRank(this.state.board.columns[0].id),
      revision: 1,
      manualOverride: false,
      dealValue: 0,
      dealStatus: 'open',
      messageSentAt: null,
      repliedAt: null,
      reminderAt: null,
      reminderNote: '',
      reminderCreatedAt: null,
      movedAt: now(),
      createdAt: now(),
    };
    const activity = activityFrom(raw);
    for (const key of ['messageSentAt', 'repliedAt']) {
      const incoming = toTimestamp(activity[key]);
      if (incoming > toTimestamp(existingCard[key])) {
        existingCard[key] = incoming;
        this._dirty = true;
      }
    }
    if (!existingCard.reminderAt && activity.reminderAt) {
      existingCard.reminderAt = activity.reminderAt;
      existingCard.reminderCreatedAt = now();
      this._dirty = true;
    }
    // Valor já registrado no scoring entra no card sem sobrescrever o que o
    // usuário digitou aqui.
    const incomingValue = dealValueFrom(raw);
    if (incomingValue > 0 && !toNumber(existingCard.dealValue)) {
      existingCard.dealValue = incomingValue;
      this._dirty = true;
    }
    if (!this.state.cards[entityKey]) this._dirty = true;
    const target = this._stageFor(current, existingCard, trigger, false, { allTriggers: false });
    const targetColumnId = target.reason === 'wip' ? existingCard.columnId : target.columnId;
    if (targetColumnId !== existingCard.columnId) {
      existingCard.columnId = targetColumnId;
      existingCard.rank = this._nextRank(targetColumnId);
      existingCard.revision = toNumber(existingCard.revision) + 1;
      existingCard.movedAt = now();
      this._dirty = true;
    }
    existingCard.updatedAt = now();
    this.state.cards[entityKey] = existingCard;
    return entityKey;
  }

  syncLeads(leads, source = 'maps', options = {}) {
    const list = Array.isArray(leads) ? leads : [];
    const replace = options.replace === true;
    const authoritative = options.authoritative === true;
    const existingOnly = options.existingOnly === true;
    this._dirty = false;
    let synced = 0;
    // Numa sincronização autoritativa, o que não veio da fonte deixa de existir.
    // Sem isso o quadro só crescia: leads apagados da base continuavam aqui.
    const seenKeys = new Set();
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue;
      if (existingOnly) {
        const existingKey = this._findEntityByIdentity(identityKeys(profileFrom(raw)));
        if (!existingKey) continue;
      }
      const entityKey = this._upsertEntity(raw, source, eventForSource(source, raw));
      if (entityKey) {
        synced += 1;
        seenKeys.add(entityKey);
      }
    }
    let removed = 0;
    if (replace) removed = this._retainSource(source, seenKeys);
    if (authoritative) removed += this._retainEntities(seenKeys);
    if (this._dirty) {
      this._record('leads_synced', { source, count: synced, removed });
      this._touch();
      this._writeAtomic();
    }
    this._dirty = false;
    return this.getBoard();
  }

  /**
   * Remove da fonte tudo que não veio nesta rodada. Um card só é apagado de
   * verdade quando perde todas as fontes; se ainda existe em outra, ele fica.
   */
  _retainSource(source, keepEntityKeys) {
    const field = SOURCE_FIELDS[source];
    let removed = 0;
    for (const [entityKey, entity] of Object.entries(this.state.entities)) {
      const refs = entity.sourceRefs?.[field] || [];
      if (!refs.length) continue;
      if (keepEntityKeys.has(entityKey)) continue;
      entity.sourceRefs[field] = [];
      entity.updatedAt = now();
      this._dirty = true;
      if (this._hasAnySource(entity)) continue;
      this._removeEntity(entityKey);
      removed += 1;
    }
    return removed;
  }

  _retainEntities(keepEntityKeys) {
    let removed = 0;
    for (const entityKey of Object.keys(this.state.entities)) {
      if (keepEntityKeys.has(entityKey)) continue;
      this._removeEntity(entityKey);
      this._dirty = true;
      removed += 1;
    }
    return removed;
  }

  _removeEntity(entityKey) {
    delete this.state.entities[entityKey];
    delete this.state.cards[entityKey];
    for (const [key, value] of this.identityIndex) {
      if (value === entityKey) this.identityIndex.delete(key);
    }
  }

  _hasAnySource(entity) {
    const refs = entity?.sourceRefs || {};
    return Boolean(refs.mapsIds?.length || refs.scoringIds?.length || refs.campaignRefs?.length);
  }

  /** Apaga tudo: usado por "Limpar base de leads". */
  reset() {
    this.state.entities = {};
    this.state.cards = {};
    this.state.events = [];
    this.identityIndex.clear();
    this.nextRankByColumn.clear();
    this._record('board_reset', {});
    this._touch();
    this._writeAtomic();
    return this.getBoard();
  }

  syncCampaigns(campaigns, options = {}) {
    const list = Array.isArray(campaigns) ? campaigns : [];
    const flattened = [];
    for (const campaign of list) {
      for (const lead of Array.isArray(campaign?.leads) ? campaign.leads : []) {
        flattened.push({ ...lead, campaignId: campaign.id, campaignStatus: campaign.status });
      }
    }
    return this.syncLeads(flattened, 'campaign', options);
  }

  applyRules({ force = false, trigger = 'sync', allTriggers = true } = {}) {
    let moved = 0;
    let blockedByWip = 0;
    let preservedManual = 0;
    let preservedTerminal = 0;
    for (const [entityKey, entity] of Object.entries(this.state.entities)) {
      const card = this.state.cards[entityKey];
      if (!card) continue;
      const result = this._stageFor(entity, card, trigger, force, { allTriggers });
      if (result.reason === 'manual') { preservedManual += 1; continue; }
      if (result.reason === 'terminal') { preservedTerminal += 1; continue; }
      if (result.reason === 'wip') { blockedByWip += 1; continue; }
      if (result.columnId !== card.columnId) {
        card.columnId = result.columnId;
        card.rank = this._nextRank(result.columnId);
        card.revision = toNumber(card.revision) + 1;
        card.movedAt = now();
        card.updatedAt = now();
        moved += 1;
      }
    }
    if (moved) {
      this._record('rules_applied', { moved, force: Boolean(force), trigger });
      this._touch();
      this._writeAtomic();
    }
    return { moved, blockedByWip, preservedManual, preservedTerminal, board: this.getBoard() };
  }

  saveConfig(board, expectedRevision) {
    if (expectedRevision != null && toNumber(expectedRevision) !== toNumber(this.state.revision)) {
      const error = new Error('O Kanban mudou em outra tela. Atualize e tente novamente.');
      error.code = 'KANBAN_CONFLICT';
      throw error;
    }
    const normalized = normalizeBoard(board);
    if (!normalized.columns.length) throw new Error('O Kanban precisa ter pelo menos uma etapa.');
    this.state.board = normalized;
    const fallback = normalized.columns[0].id;
    for (const card of Object.values(this.state.cards)) {
      if (!this._columnById(card.columnId)) {
        card.columnId = fallback;
        card.rank = this._nextRank(fallback);
        card.revision = toNumber(card.revision) + 1;
      }
    }
    this._record('board_configured', { columns: normalized.columns.length, rules: normalized.rules.length });
    this._touch();
    this._writeAtomic();
    return this.getBoard();
  }

  moveCard({ entityKey, toColumnId, expectedRevision, manual = true }) {
    const key = cleanText(entityKey, 180);
    const card = this.state.cards[key];
    if (!card || !this.state.entities[key]) throw new Error('Lead não encontrado no Kanban.');
    const column = this._columnById(toColumnId);
    if (!column) throw new Error('Etapa do Kanban inválida.');
    if (expectedRevision != null && toNumber(expectedRevision) !== toNumber(card.revision)) {
      const error = new Error('Este card foi alterado em outra tela. Atualize e tente novamente.');
      error.code = 'KANBAN_CONFLICT';
      throw error;
    }
    if (card.columnId !== column.id && column.wipLimit) {
      const current = Object.values(this.state.cards).filter((item) => item.columnId === column.id).length;
      if (current >= column.wipLimit) throw new Error(`A etapa “${column.name}” atingiu o limite de ${column.wipLimit} cards.`);
    }
    card.columnId = column.id;
    card.rank = this._nextRank(column.id);
    card.manualOverride = Boolean(manual);
    card.movedAt = now();
    card.updatedAt = now();
    card.revision = toNumber(card.revision) + 1;
    this._record('card_moved', { entityKey: key, columnId: column.id, manual: Boolean(manual) });
    this._touch();
    this._writeAtomic();
    return this.getBoard();
  }

  /**
   * Registra o desfecho comercial do card: valor fechado e se ganhou ou perdeu.
   * É o que alimenta "valor ganho" na visão geral.
   */
  recordDeal({ entityKey, outcome, value, note, reminderAt, reminderNote } = {}) {
    const key = cleanText(entityKey, 180);
    const card = this.state.cards[key];
    if (!card || !this.state.entities[key]) throw new Error('Lead não encontrado no Kanban.');
    if (!['won', 'lost', 'open'].includes(outcome)) throw new Error('Desfecho inválido.');

    const numeric = Number(value);
    card.dealValue = Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric * 100) / 100 : 0;
    card.dealStatus = outcome;
    card.dealNote = cleanText(note, 200);
    card.dealAt = outcome === 'open' ? null : now();
    card.reminderAt = toTimestamp(reminderAt) || null;
    card.reminderNote = card.reminderAt ? cleanText(reminderNote, 200) : '';
    card.reminderCreatedAt = card.reminderAt ? now() : null;
    if (outcome !== 'open') card.manualOverride = true;

    // Primeiro respeita a automação simples configurada pelo usuário. Sem uma
    // regra para o desfecho, usa a etapa final padrão correspondente.
    if (outcome !== 'open') {
      const automatic = this._stageFor(this.state.entities[key], card, `deal.${outcome}`, true, {
        allTriggers: false,
        allowTerminalExit: true,
      });
      const target = automatic.reason === 'rule'
        ? this._columnById(automatic.columnId)
        : this.state.board.columns.find((column) => column.dealOutcome === outcome)
          || this._columnById(outcome === 'won' ? 'won' : 'lost');
      if (target && target.id !== card.columnId) {
        card.columnId = target.id;
        card.rank = this._nextRank(target.id);
        card.movedAt = now();
      }
    }
    card.updatedAt = now();
    card.revision = toNumber(card.revision) + 1;
    this._record('deal_recorded', { entityKey: key, outcome, value: card.dealValue, reminderAt: card.reminderAt });
    this._touch();
    this._writeAtomic();
    return this.getBoard();
  }

  resumeAutomation(entityKey) {
    const key = cleanText(entityKey, 180);
    const card = this.state.cards[key];
    if (!card) throw new Error('Lead não encontrado no Kanban.');
    const entity = this.state.entities[key];
    card.manualOverride = false;
    // Retoma de verdade: o card volta a obedecer às regras no mesmo instante.
    if (entity) {
      const result = this._stageFor(entity, card, 'sync', false, { allTriggers: true });
      if (result.reason !== 'wip' && result.columnId !== card.columnId) {
        card.columnId = result.columnId;
        card.rank = this._nextRank(result.columnId);
        card.movedAt = now();
      }
    }
    card.updatedAt = now();
    card.revision = toNumber(card.revision) + 1;
    this._record('automation_resumed', { entityKey: key });
    this._touch();
    this._writeAtomic();
    return this.getBoard();
  }

  _stats() {
    const cards = Object.values(this.state.cards);
    const byColumn = {};
    for (const column of this.state.board.columns) byColumn[column.id] = 0;
    let manual = 0;
    let wonValue = 0;
    let wonCount = 0;
    let lostCount = 0;
    let openValue = 0;
    let pendingCount = 0;
    let reminderCount = 0;
    let dueReminderCount = 0;
    let nextReminderAt = 0;
    for (const card of cards) {
      if (byColumn[card.columnId] != null) byColumn[card.columnId] += 1;
      if (card.manualOverride) manual += 1;
      const value = toNumber(card.dealValue);
      if (card.dealStatus === 'won') {
        wonCount += 1;
        wonValue += value;
      } else if (card.dealStatus === 'lost') {
        lostCount += 1;
      } else if (value > 0) {
        openValue += value;
        pendingCount += 1;
      }
      const reminderAt = toTimestamp(card.reminderAt);
      if (reminderAt) {
        reminderCount += 1;
        if (reminderAt <= now()) dueReminderCount += 1;
        if (reminderAt > now() && (!nextReminderAt || reminderAt < nextReminderAt)) nextReminderAt = reminderAt;
      }
    }
    const rules = this.state.board.rules;
    return {
      total: cards.length,
      manual,
      byColumn,
      wonCount,
      wonValue: Math.round(wonValue * 100) / 100,
      lostCount,
      openValue: Math.round(openValue * 100) / 100,
      pendingValue: Math.round(openValue * 100) / 100,
      pendingCount,
      reminderCount,
      dueReminderCount,
      nextReminderAt: nextReminderAt || null,
      ticketAverage: wonCount ? Math.round((wonValue / wonCount) * 100) / 100 : 0,
      rules: rules.length,
      enabledRules: rules.filter((rule) => rule.enabled && rule.action?.columnId).length,
      brokenRules: rules.filter((rule) => rule.problem === 'missing_column').length,
      terminalStages: this.state.board.columns.filter((column) => column.terminal).length,
    };
  }

  getBoard() {
    const columns = [...this.state.board.columns].sort((a, b) => a.position - b.position);
    const cards = Object.entries(this.state.cards)
      .map(([entityKey, card]) => ({
        ...clone(card),
        entity: clone(this.state.entities[entityKey] || {}),
      }))
      .filter((card) => card.entity?.entityKey)
      .sort((a, b) => a.rank - b.rank || a.entity.profile.name.localeCompare(b.entity.profile.name, 'pt-BR'));
    return clone({
      version: VERSION,
      revision: this.state.revision,
      board: { columns, rules: this.state.board.rules },
      cards,
      events: this.state.events.slice(-40).reverse(),
      stats: this._stats(),
      updatedAt: this.state.updatedAt,
    });
  }
}

module.exports = {
  KanbanStore,
  ALLOWED_FIELDS,
  ALLOWED_OPERATORS,
  ALLOWED_TRIGGERS,
  defaultState,
  normalizeBoard,
  profileFrom,
  identityKeys,
  ruleMatches,
};
