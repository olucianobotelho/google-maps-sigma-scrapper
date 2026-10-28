// Ponte entre a base de leads (plana) e o resultado do Lead Scoring (aninhado).
// O serviço salva cada análise com id próprio, então a única forma confiável de
// reencontrar o score de um lead é casar identidade (telefone, nome+endereço,
// site), nunca o id do renderer.
import { isNonSiteUrl } from './leadLinks.mjs';

export const DEFAULT_SCORE_THRESHOLDS = Object.freeze({
  ignoreBelow: 40,
  goodFrom: 60,
  highFrom: 75,
});

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeThresholds(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    ignoreBelow: toNumber(source.ignoreBelow, DEFAULT_SCORE_THRESHOLDS.ignoreBelow),
    goodFrom: toNumber(source.goodFrom, DEFAULT_SCORE_THRESHOLDS.goodFrom),
    highFrom: toNumber(source.highFrom, DEFAULT_SCORE_THRESHOLDS.highFrom),
  };
}

/** Faixa de prioridade do score, sempre pelas mesmas faixas do motor. */
export function scoreBand(score, thresholds) {
  const limits = normalizeThresholds(thresholds);
  const value = toNumber(score, 0);
  if (value >= limits.highFrom) return { key: 'high', label: 'Alta' };
  if (value >= limits.goodFrom) return { key: 'mid', label: 'Média' };
  return { key: 'low', label: 'Baixa' };
}

export function fold(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();
}

function digits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function hostKey(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.includes(' ') || !raw.includes('.')) return '';
  if (isNonSiteUrl(raw)) return '';
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.toLocaleLowerCase('en-US').replace(/^www\./, '');
  } catch {
    return '';
  }
}

function companyOf(lead) {
  return lead?.company && typeof lead.company === 'object' ? lead.company : (lead || {});
}

/** Id usado pela Base de Leads: o do lead quando existe, senão o índice. */
export function leadKey(lead, index = 0) {
  const id = lead?.id ?? lead?.leadId ?? '';
  return String(id || `lead-${index}`);
}

/** Chaves de identidade compartilhadas entre a base plana e o lead analisado. */
export function leadIdentityKeys(lead) {
  const company = companyOf(lead);
  const name = fold(company.name || lead?.name);
  const address = fold(company.address || lead?.address);
  const city = fold(company.city || lead?.city || lead?.cidade);
  const phone = digits(company.phone || company.whatsapp || lead?.phone || lead?.whatsapp);
  const host = hostKey(company.website || lead?.website || lead?.site);
  const keys = [];
  if (phone.length >= 8) keys.push(`phone:${phone}`);
  if (name && address.length > 4) keys.push(`name-address:${name}|${address}`);
  if (name && city) keys.push(`name-city:${name}|${city}`);
  if (host) keys.push(`web:${host}`);
  return keys;
}

/** Índice reverso: identidade → lead da base. */
export function buildLeadIndex(leads = []) {
  const index = new Map();
  (Array.isArray(leads) ? leads : []).forEach((lead, position) => {
    const key = leadKey(lead, position);
    if (!index.has(`id:${key}`)) index.set(`id:${key}`, lead);
    for (const identity of leadIdentityKeys(lead)) {
      if (!index.has(identity)) index.set(identity, lead);
    }
  });
  return index;
}

/** Índice reverso: identidade → lead já analisado pelo serviço de scoring. */
export function buildScoringIndex(savedLeads = []) {
  const index = new Map();
  for (const saved of Array.isArray(savedLeads) ? savedLeads : []) {
    if (!saved) continue;
    if (saved.id && !index.has(`id:${saved.id}`)) index.set(`id:${saved.id}`, saved);
    for (const identity of leadIdentityKeys(saved)) {
      if (!index.has(identity)) index.set(identity, saved);
    }
  }
  return index;
}

function lookup(index, keys) {
  if (!(index instanceof Map)) return null;
  for (const key of keys) {
    const found = index.get(key);
    if (found) return found;
  }
  return null;
}

/** Encontra o lead analisado correspondente a um lead da base. */
export function findScoringLead(scoringIndex, lead, position = 0) {
  const keys = [`id:${leadKey(lead, position)}`, ...leadIdentityKeys(lead)];
  return lookup(scoringIndex, keys);
}

/** Encontra o lead da base correspondente a um resultado do scoring. */
export function findBaseLead(leadIndex, savedLead) {
  const keys = [`id:${savedLead?.id || ''}`, ...leadIdentityKeys(savedLead)];
  return lookup(leadIndex, keys);
}

/** Membros de um grupo criado na Base de Leads (ids locais). */
export function resolveGroupMembers(group, leads = []) {
  const wanted = new Set([...(group?.members || []), ...(group?.leadIds || [])].map(String));
  if (!wanted.size) return [];
  const resolved = [];
  const seen = new Set();
  (Array.isArray(leads) ? leads : []).forEach((lead, position) => {
    const key = leadKey(lead, position);
    const matches = wanted.has(key) || leadIdentityKeys(lead).some((identity) => wanted.has(identity));
    if (!matches || seen.has(key)) return;
    seen.add(key);
    resolved.push(lead);
  });
  return resolved;
}

/** Membros de um grupo criado pelo próprio serviço de scoring (ids do serviço). */
export function resolveServiceGroupMembers(group, leads = [], scoringIndex) {
  const wanted = new Set([...(group?.leadIds || []), ...(group?.members || [])].map(String));
  if (!wanted.size) return [];
  const resolved = [];
  (Array.isArray(leads) ? leads : []).forEach((lead, position) => {
    const saved = findScoringLead(scoringIndex, lead, position);
    if (saved && wanted.has(String(saved.id))) resolved.push(lead);
  });
  return resolved;
}
