export function readLocalArray(key) {
  try {
    const data = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

import { isRealWebsite } from './leadLinks.mjs';

// Espelha o normalizador do processo principal para recuperar registros já
// persistidos no navegador antes da correção do scraper.
export function normalizeLeadAddress(value) {
  return repairMojibake(value)
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{Co}\u{1F4CD}\u{FE0E}\u{FE0F}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function hasLeadingLeadAddressNoise(value) {
  return /^[\s\p{Cc}\p{Cf}\p{Co}\u{1F4CD}\u{FE0E}\u{FE0F}]+/u
    .test(String(value ?? '').normalize('NFC'));
}

function hasUsableLeadCoordinates(lead) {
  const lat = Number(lead?.latitude ?? lead?.lat);
  const lng = Number(lead?.longitude ?? lead?.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
    && !(lat === 0 && lng === 0)) return true;
  let mapsUrl = String(lead?.googleMapsUrl || lead?.mapsUrl || lead?.google_maps_url || '');
  try { mapsUrl = decodeURIComponent(mapsUrl); } catch {}
  return /!3d-?\d+(?:\.\d+)?!4d-?\d+(?:\.\d+)?/.test(mapsUrl);
}

const MOJIBAKE_SEQUENCE = /(?:[\u00c2\u00c3][\u0080-\u00bf]|\u00e2[\u0080-\u00bf]{1,2}|\u00f0[\u0080-\u00bf]{1,3})/u;
const MOJIBAKE_SEQUENCE_GLOBAL = /(?:[\u00c2\u00c3][\u0080-\u00bf]|\u00e2[\u0080-\u00bf]{1,2}|\u00f0[\u0080-\u00bf]{1,3})/gu;

function mojibakeScore(value) {
  const text = String(value ?? '');
  return (text.match(MOJIBAKE_SEQUENCE_GLOBAL) || []).length * 10
    + (text.match(/[\u0080-\u009f]/gu) || []).length * 3
    + (text.match(/\ufffd/gu) || []).length * 20;
}

// Só converte sequências inequívocas de UTF-8 lido como Latin-1/Windows-1252.
// Ex.: "ClÃ­nica" vira "Clínica"; "Ângela" não é alterado.
export function repairMojibake(value) {
  let current = String(value ?? '');
  for (let pass = 0; pass < 3 && MOJIBAKE_SEQUENCE.test(current); pass += 1) {
    try {
      const codePoints = Array.from(current, (char) => char.codePointAt(0));
      if (codePoints.some((point) => point > 255)) break;
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(codePoints));
      if (!decoded || decoded === current || mojibakeScore(decoded) >= mojibakeScore(current)) break;
      current = decoded;
    } catch {
      break;
    }
  }
  return current.normalize('NFC');
}

function normalizeOptionalText(value) {
  return typeof value === 'string' ? repairMojibake(value).replace(/\s+/gu, ' ').trim() : value;
}

function foldText(value) {
  return repairMojibake(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Taxonomia conservadora da base. Só reúne sinônimos inequívocos para não
 * reclassificar negócios diferentes sem confirmação do usuário.
 */
export function normalizeLeadCategory(value) {
  const cleaned = repairMojibake(value).replace(/\s+/g, ' ').trim();
  const folded = foldText(cleaned);

  if (!folded || /^(sem categoria|nao informado|n\/a|null|undefined|-)$/.test(folded)) {
    return 'Sem categoria';
  }

  if (
    /(?:odont|dentist|ortodont|endodont|periodont|implantodont)/.test(folded)
    || /cirurgiao dentista|protese dentaria/.test(folded)
  ) {
    return 'Odontologia';
  }

  return cleaned;
}

export function normalizeLeadRecord(lead) {
  if (!lead || typeof lead !== 'object') return lead;
  const name = normalizeOptionalText(lead.name);
  const category = normalizeLeadCategory(lead.category);
  const address = normalizeLeadAddress(lead.address);
  const city = normalizeOptionalText(lead.city ?? lead.cidade);
  const state = normalizeOptionalText(lead.state ?? lead.uf);
  const neighborhood = normalizeOptionalText(lead.neighborhood ?? lead.bairro);
  const company = lead.company && typeof lead.company === 'object'
    ? {
        ...lead.company,
        name: normalizeOptionalText(lead.company.name),
        category: normalizeOptionalText(lead.company.category),
        address: normalizeLeadAddress(lead.company.address),
        city: normalizeOptionalText(lead.company.city),
        state: normalizeOptionalText(lead.company.state),
        neighborhood: normalizeOptionalText(lead.company.neighborhood ?? lead.company.bairro),
      }
    : normalizeOptionalText(lead.company);
  const needsMapAddressRepair = !hasUsableLeadCoordinates(lead) && address.length >= 4;
  const companyChanged = JSON.stringify(company) !== JSON.stringify(lead.company);
  return name === lead.name
    && category === lead.category
    && address === lead.address
    && city === (lead.city ?? lead.cidade)
    && state === (lead.state ?? lead.uf)
    && neighborhood === (lead.neighborhood ?? lead.bairro)
    && !companyChanged
    && needsMapAddressRepair === Boolean(lead.needsMapAddressRepair)
    ? lead
    : { ...lead, name, category, address, city, state, neighborhood, company, needsMapAddressRepair };
}

export function normalizeLeadCollection(leads = []) {
  return Array.isArray(leads) ? leads.map(normalizeLeadRecord).filter(Boolean) : [];
}

export function isImportedSearch(search) {
  if (!search || typeof search !== 'object') return false;
  const haystack = foldText([
    search.id,
    search.label,
    search.query,
    search.source,
    search.type,
    search.kind,
  ].filter(Boolean).join(' '));
  return /(?:^|\s)(?:importados?|planilhas?|spreadsheet|csv|xlsx?)(?:\s|$)/.test(haystack);
}

function searchTimestamp(search, fallback = 0) {
  const raw = search?.timestamp ?? search?.createdAt ?? search?.created ?? search?.date;
  const parsed = typeof raw === 'number' ? raw : Date.parse(raw || '');
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  const idAsNumber = Number(search?.id);
  return Number.isFinite(idAsNumber) && idAsNumber > 1e11 ? idAsNumber : fallback;
}

/** Retorna somente extrações reais do Maps, sem agrupadores de importação. */
export function getExtractionSearches(searches = []) {
  const seen = new Set();
  return (Array.isArray(searches) ? searches : [])
    .map((search, index) => ({ search, index }))
    .filter(({ search }) => search && typeof search === 'object' && search.id != null && !isImportedSearch(search))
    .filter(({ search }) => {
      const key = String(search.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => searchTimestamp(b.search, b.index) - searchTimestamp(a.search, a.index))
    .map(({ search }) => search);
}

export function getLeadIdentity(lead) {
  return `${lead?.name || ""}||${normalizeLeadAddress(lead?.address)}`.toLowerCase().trim();
}

export function dedupeLeads(leads = []) {
  const seen = new Set();
  return leads.filter((lead) => {
    const key = getLeadIdentity(lead);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function countLeadsByField(leads = [], field) {
  return leads.filter((lead) => lead?.[field]).length;
}

export function getLeadStats(leads = []) {
  return {
    total: leads.length,
    phoneCount: leads.filter((lead) => lead?.phone || lead?.tel || lead?.whatsapp).length,
    webCount: leads.filter((lead) => isRealWebsite(lead?.website || lead?.site)).length,
    igCount: leads.filter((lead) => lead?.instagram || lead?.ig).length,
    emailCount: leads.filter((lead) => lead?.email || lead?.mail).length,
  };
}

export function getSearchLeadCount(leads = [], searchId) {
  return leads.filter((lead) => String(lead?.searchId ?? '') === String(searchId ?? '')).length;
}
