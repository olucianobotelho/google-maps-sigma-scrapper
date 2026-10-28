// Grupos de leads: definição de membros, filtros práticos e conversão para o
// formato do serviço de scoring. Compartilhado entre Base de Leads, Lead
// Scoring e o assistente de campanha para que os três vejam os mesmos grupos.

import { leadIdentityKeys, leadKey } from './leadMatch.mjs';
import { isRealWebsite } from './leadLinks.mjs';

export const CHANNELS = [
  { key: 'whatsapp', label: 'WhatsApp', hint: 'telefone utilizável' },
  { key: 'phone', label: 'Telefone', hint: 'número cadastrado' },
  { key: 'site', label: 'Site', hint: 'endereço próprio' },
  { key: 'instagram', label: 'Instagram', hint: 'perfil na base' },
  { key: 'email', label: 'E-mail', hint: 'contato por e-mail' },
];

// Cada canal aceita três estados: ausente (tanto faz), 'with' (só com) e
// 'without' (excluir quem tem). Isso cobre “só WhatsApp” e “sem site” sem
// inventar um operador novo para o usuário aprender.
export const CHANNEL_STATES = [
  { value: 'any', label: 'Tanto faz' },
  { value: 'with', label: 'Com' },
  { value: 'without', label: 'Sem' },
];

export const FILTER_PRESETS = [
  { id: 'whatsapp', label: 'Só com WhatsApp', channels: { whatsapp: 'with' } },
  { id: 'wa-no-site', label: 'WhatsApp e sem site', channels: { whatsapp: 'with', site: 'without' } },
  { id: 'no-site', label: 'Sem site', channels: { site: 'without' } },
  { id: 'no-ig', label: 'Sem Instagram', channels: { instagram: 'without' } },
  { id: 'no-site-ig', label: 'Sem site e sem Instagram', channels: { site: 'without', instagram: 'without' } },
  { id: 'with-site', label: 'Com site', channels: { site: 'with' } },
  { id: 'with-ig', label: 'Com Instagram', channels: { instagram: 'with' } },
];

export function emptyFilters() {
  return { channels: {}, minRating: 0, category: '', city: '', state: '', text: '' };
}

export function hasActiveFilters(filters) {
  const f = filters || {};
  const channels = Object.values(f.channels || {}).filter((value) => value === 'with' || value === 'without');
  return channels.length > 0
    || Number(f.minRating || 0) > 0
    || Boolean(f.category)
    || Boolean(f.city)
    || Boolean(f.state)
    || Boolean(String(f.text || '').trim());
}

function digits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

/** Presença de cada canal no lead, sempre pela mesma leitura. */
export function leadChannels(lead) {
  const source = lead?.company && typeof lead.company === 'object' ? { ...lead, ...lead.company } : (lead || {});
  const phone = digits(source.phone || source.tel || source.whatsapp);
  return {
    phone: phone.length >= 8,
    whatsapp: phone.length >= 8 || Boolean(source.whatsapp),
    site: isRealWebsite(source.website || source.site),
    instagram: Boolean(String(source.instagram || source.ig || '').trim()),
    email: Boolean(String(source.email || source.mail || '').trim()),
  };
}

export function leadRating(lead) {
  const raw = lead?.company?.rating ?? lead?.rating ?? lead?.rn ?? 0;
  const parsed = parseFloat(String(raw).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function fold(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim();
}

/** Um lead entra no grupo quando passa em TODOS os filtros ativos. */
export function matchesLeadFilters(lead, filters = {}) {
  const channels = leadChannels(lead);
  for (const [key, state] of Object.entries(filters.channels || {})) {
    if (state !== 'with' && state !== 'without') continue;
    const has = Boolean(channels[key]);
    if (state === 'with' && !has) return false;
    if (state === 'without' && has) return false;
  }
  const minRating = Number(filters.minRating || 0);
  if (minRating > 0 && leadRating(lead) < minRating) return false;
  const source = lead?.company && typeof lead.company === 'object' ? { ...lead, ...lead.company } : (lead || {});
  if (filters.category && fold(source.category) !== fold(filters.category)) return false;
  if (filters.city && fold(source.city || source.cidade) !== fold(filters.city)) return false;
  if (filters.state && fold(source.state || source.uf) !== fold(filters.state)) return false;
  const text = String(filters.text || '').trim();
  if (text) {
    const haystack = fold([source.name, source.category, source.city, source.address, source.phone, source.website, source.instagram].filter(Boolean).join(' '));
    if (!haystack.includes(fold(text))) return false;
  }
  return true;
}

export function filterLeads(leads = [], filters = {}) {
  return (Array.isArray(leads) ? leads : []).filter((lead) => matchesLeadFilters(lead, filters));
}

/** Presets são alternáveis: clicar de novo remove o efeito do preset. */
export function presetActive(filters, preset) {
  return Object.entries(preset.channels)
    .every(([key, state]) => (filters?.channels || {})[key] === state);
}

export function applyPreset(filters, preset) {
  const next = { ...emptyFilters(), ...(filters || {}), channels: { ...((filters || {}).channels || {}) } };
  if (presetActive(filters, preset)) {
    for (const key of Object.keys(preset.channels)) delete next.channels[key];
    return next;
  }
  Object.assign(next.channels, preset.channels);
  return next;
}

/**
 * Chaves de pertencimento: o id visível e as identidades estáveis (telefone,
 * nome+endereço…). Guardar as duas formas faz o grupo sobreviver a uma
 * reimportação, em que os ids do renderer mudam.
 */
export function membershipKeys(lead, index = 0) {
  return [...new Set([leadKey(lead, index), ...leadIdentityKeys(lead)])];
}

export function membersFromLeads(leads = [], allLeads = null) {
  const positions = new Map();
  (Array.isArray(allLeads) ? allLeads : []).forEach((lead, position) => positions.set(lead, position));
  const keys = [];
  (Array.isArray(leads) ? leads : []).forEach((lead, index) => {
    keys.push(...membershipKeys(lead, positions.get(lead) ?? index));
  });
  return [...new Set(keys)];
}

export function createGroup({ name, description, color, members, leads, created }) {
  const cleanName = String(name || '').trim().slice(0, 80);
  if (!cleanName) throw new Error('Informe um nome para o grupo');
  const resolvedMembers = Array.isArray(members) && members.length
    ? members
    : membersFromLeads(leads || []);
  return {
    id: `g${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: cleanName,
    description: String(description || '').slice(0, 240),
    color: String(color || '').slice(0, 20),
    members: [...new Set(resolvedMembers.map(String).filter(Boolean))],
    created: Number(created) || Date.now(),
    updated: Date.now(),
  };
}

/** Formato aceito pelo serviço de scoring (mesma lista, campo `leadIds`). */
export function toServiceGroup(group) {
  return {
    id: String(group?.id || '').slice(0, 80),
    name: String(group?.name || '').slice(0, 80),
    description: String(group?.description || '').slice(0, 240),
    color: String(group?.color || '').slice(0, 20),
    leadIds: [...new Set([...(group?.members || []), ...(group?.leadIds || [])].map(String).filter(Boolean))],
    segment: group?.segment && typeof group.segment === 'object' ? group.segment : null,
    createdAt: Number(group?.createdAt || group?.created) || Date.now(),
    updatedAt: Number(group?.updatedAt || group?.updated) || Date.now(),
  };
}

export function toServiceGroups(groups = []) {
  return (Array.isArray(groups) ? groups : [])
    .filter((group) => group?.id && group?.name)
    .map(toServiceGroup);
}

/**
 * Empurra os grupos do renderer para o processo principal. É a única ponte
 * entre a Base de Leads e o serviço: um replace idempotente, sem operações
 * parciais que possam divergir.
 */
export async function syncGroupsToService(groups = []) {
  const payload = toServiceGroups(groups);
  const api = typeof window !== 'undefined' ? window.leadScoringAPI : null;
  if (!api?.syncGroups) return { success: false, skipped: true };
  try {
    const response = await api.syncGroups(payload);
    return response?.success ? { success: true, groups: response.groups || [] } : { success: false, error: response?.error };
  } catch (error) {
    return { success: false, error: error?.message || 'Não foi possível salvar os grupos' };
  }
}

export function notifyGroupsChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('sigma:groups-updated'));
}
