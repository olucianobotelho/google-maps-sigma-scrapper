const fs = require('fs');
const path = require('path');
const { normalizeAddress } = require('./address-normalizer');
const { isDisplayTextKey, normalizeText } = require('./text-normalizer');
const { normalizeLeadLinks } = require('./lead-links');

const MIGRATION_ID = 'lead-normalization-v3';
const ADDRESS_KEYS = new Set(['address', 'endereco']);
const WEBSITE_KEYS = ['website', 'site'];
const INSTAGRAM_KEYS = ['instagram', 'ig'];
const LOCAL_STORAGE_KEYS = [
  'sigma_leads',
  'sigma_scoring',
  'sigma_analysis',
  'sigma_prospecting_leads',
];

function clone(value) {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.migration-tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
}

function createStats(file) {
  return {
    file,
    fields: 0,
    changed: 0,
    records: 0,
    examples: [],
  };
}

function normalizeAddressFields(value, stats, seen = new WeakSet(), pathLabel = '') {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => normalizeAddressFields(item, stats, seen, `${pathLabel}[${index}]`));
    return value;
  }

  for (const [key, current] of Object.entries(value)) {
    const childPath = pathLabel ? `${pathLabel}.${key}` : key;
    // `raw` conserva o valor originalmente recebido para auditoria e rollback.
    if (String(key).toLowerCase() === 'raw') continue;
    if (ADDRESS_KEYS.has(String(key).toLowerCase()) && typeof current === 'string') {
      stats.fields += 1;
      const normalized = normalizeAddress(current);
      if (normalized !== current) {
        value[key] = normalized;
        stats.changed += 1;
        if (stats.examples.length < 5) stats.examples.push({ path: childPath, before: current, after: normalized });
      }
      continue;
    }
    if (isDisplayTextKey(key) && typeof current === 'string') {
      stats.fields += 1;
      const normalized = normalizeText(current);
      if (normalized !== current) {
        value[key] = normalized;
        stats.changed += 1;
        if (stats.examples.length < 5) stats.examples.push({ path: childPath, before: current, after: normalized });
      }
      continue;
    }
    if (current && typeof current === 'object') normalizeAddressFields(current, stats, seen, childPath);
  }
  return value;
}

/**
 * Limpa website/instagram já salvos: link do Google deixa de aparecer como
 * site da empresa e Instagram passa a ser @handle, nunca URL completa.
 */
function normalizeLinkFields(value, stats, seen = new WeakSet(), pathLabel = '') {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => normalizeLinkFields(item, stats, seen, `${pathLabel}[${index}]`));
    return value;
  }

  const hasWebsiteKey = WEBSITE_KEYS.some((key) => typeof value[key] === 'string' || value[key] === null);
  const hasInstagramKey = INSTAGRAM_KEYS.some((key) => typeof value[key] === 'string' || value[key] === null);
  if (hasWebsiteKey || hasInstagramKey) {
    const links = normalizeLeadLinks(value);
    for (const key of WEBSITE_KEYS) {
      if (value[key] === undefined) continue;
      stats.fields += 1;
      if (value[key] !== links.website) {
        if (stats.examples.length < 5) stats.examples.push({ path: pathLabel ? `${pathLabel}.${key}` : key, before: value[key], after: links.website });
        value[key] = links.website;
        stats.changed += 1;
      }
    }
    for (const key of INSTAGRAM_KEYS) {
      if (value[key] === undefined) {
        const missingEverywhere = INSTAGRAM_KEYS.every((candidate) => value[candidate] === undefined);
        if (key === INSTAGRAM_KEYS[0] && links.instagram && missingEverywhere) {
          if (stats.examples.length < 5) stats.examples.push({ path: pathLabel ? `${pathLabel}.${key}` : key, before: undefined, after: links.instagram });
          value[key] = links.instagram;
          stats.changed += 1;
        }
        continue;
      }
      stats.fields += 1;
      if (value[key] !== links.instagram) {
        if (stats.examples.length < 5) stats.examples.push({ path: pathLabel ? `${pathLabel}.${key}` : key, before: value[key], after: links.instagram });
        value[key] = links.instagram;
        stats.changed += 1;
      }
    }
  }

  for (const [key, current] of Object.entries(value)) {
    if (String(key).toLowerCase() === 'raw') continue;
    if (current && typeof current === 'object') {
      normalizeLinkFields(current, stats, seen, pathLabel ? `${pathLabel}.${key}` : key);
    }
  }
  return value;
}

function normalizeGeocodeCache(cache, stats) {
  if (!cache || typeof cache !== 'object' || Array.isArray(cache)) return cache;
  const next = {};
  for (const [key, entry] of Object.entries(cache)) {
    const normalizedKey = normalizeAddress(key).toLowerCase();
    const targetKey = normalizedKey || key;
    if (targetKey !== key) stats.changed += 1;
    // Keep the newest entry if a dirty and clean key collapse to the same value.
    const previous = next[targetKey];
    if (!previous || Number(entry?.ts || 0) >= Number(previous?.ts || 0)) next[targetKey] = entry;
  }
  if (stats.changed) {
    stats.fields = Object.keys(cache).length;
    return next;
  }
  return cache;
}

function parseJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false, value: null };
  try {
    return { exists: true, value: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
  } catch (error) {
    return { exists: true, value: null, error };
  }
}

function backupFile(filePath, backupDir) {
  fs.mkdirSync(backupDir, { recursive: true });
  const relativeName = path.basename(filePath);
  const backupPath = path.join(backupDir, relativeName);
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function migrateJsonFile(filePath, backupDir, transform) {
  const parsed = parseJsonFile(filePath);
  const stats = createStats(path.basename(filePath));
  if (!parsed.exists) return { ...stats, status: 'missing' };
  if (parsed.error) return { ...stats, status: 'invalid', error: parsed.error.message };

  const original = JSON.stringify(parsed.value);
  const value = clone(parsed.value);
  const transformed = transform(value, stats) || value;
  const changed = JSON.stringify(transformed) !== original;
  if (changed) {
    const backupPath = backupFile(filePath, backupDir);
    atomicWrite(filePath, transformed);
    return { ...stats, status: 'migrated', backupPath };
  }
  return { ...stats, status: 'clean' };
}

function parseLocalStorageValue(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return { value: raw, parsed: false };
  try {
    return { value: JSON.parse(raw), parsed: true };
  } catch {
    return { value: raw, parsed: false };
  }
}

/**
 * Normaliza os arquivos persistidos pelo desktop e, quando fornecido, os
 * valores JSON do localStorage. A operação é idempotente e só cria backup
 * quando encontrou dados que realmente mudaram.
 */
function migrateExistingData(userDataPath, options = {}) {
  const root = path.resolve(userDataPath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(root, 'migrations', `${MIGRATION_ID}-${timestamp}`);
  const files = [
    path.join(root, 'campaigns.json'),
    path.join(root, 'kanban.json'),
    path.join(root, 'lead-scoring', 'prospecting-leads.json'),
    path.join(root, 'lead-scoring', 'prospecting-groups.json'),
    path.join(root, 'geocode-cache.json'),
  ];
  const reports = [];
  let changed = false;

  for (const filePath of files) {
    const result = migrateJsonFile(filePath, backupDir, (value, stats) => {
      if (path.basename(filePath) === 'geocode-cache.json') return normalizeGeocodeCache(value, stats);
      normalizeAddressFields(value, stats);
      return normalizeLinkFields(value, stats);
    });
    reports.push({ ...result, file: path.relative(root, filePath) });
    if (result.status === 'migrated') changed = true;
  }

  const localStorageUpdates = {};
  const localStorageReport = [];
  const localStorage = options.localStorage && typeof options.localStorage === 'object'
    ? options.localStorage
    : {};
  for (const key of LOCAL_STORAGE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(localStorage, key)) continue;
    const parsed = parseLocalStorageValue(localStorage[key]);
    if (!parsed.parsed || !parsed.value || typeof parsed.value !== 'object') continue;
    const stats = createStats(`localStorage:${key}`);
    const value = clone(parsed.value);
    normalizeAddressFields(value, stats);
    normalizeLinkFields(value, stats);
    if (stats.changed) {
      localStorageUpdates[key] = JSON.stringify(value);
      localStorageReport.push({ key, ...stats, status: 'migrated' });
      changed = true;
    } else {
      localStorageReport.push({ key, ...stats, status: 'clean' });
    }
  }

  const migratedFiles = reports.filter((entry) => entry.status === 'migrated');
  const hasBackup = migratedFiles.length > 0 || localStorageReport.some((entry) => entry.status === 'migrated');
  let persistedBackupDir = null;
  if (hasBackup) {
    fs.mkdirSync(backupDir, { recursive: true });
    if (localStorageReport.some((entry) => entry.status === 'migrated')) {
      atomicWrite(path.join(backupDir, 'localStorage-before.json'), localStorage);
    }
    persistedBackupDir = backupDir;
  }

  const report = {
    migrationId: MIGRATION_ID,
    ranAt: new Date().toISOString(),
    root,
    changed,
    backupDir: persistedBackupDir,
    files: reports,
    localStorage: localStorageReport,
    localStorageUpdates,
  };
  if (changed) {
    atomicWrite(path.join(root, 'migrations', `${MIGRATION_ID}-latest.json`), report);
  }
  return report;
}

module.exports = {
  MIGRATION_ID,
  LOCAL_STORAGE_KEYS,
  normalizeAddressFields,
  normalizeLinkFields,
  migrateExistingData,
};
