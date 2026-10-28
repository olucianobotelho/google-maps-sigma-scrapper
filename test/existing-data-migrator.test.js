const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { migrateExistingData } = require('../utils/existing-data-migrator');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function withRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sigma-data-migration-'));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('migra os arquivos existentes e o localStorage, preservando backup e estrutura', () => withRoot((root) => {
  writeJson(path.join(root, 'campaigns.json'), {
    camp_1: { id: 'camp_1', status: 'cancelled', leads: [{ address: '\uE0C8 Rua São João, 10', phone: '5511999999999' }] },
  });
  writeJson(path.join(root, 'kanban.json'), {
    version: 1,
    revision: 3,
    board: { columns: [], rules: [] },
    entities: { e1: { profile: { name: 'Clínica', address: '\u202C Av. Brasil, 20' } } },
    cards: { e1: { entityKey: 'e1', columnId: 'new', rank: 1 } },
    events: [],
  });
  writeJson(path.join(root, 'lead-scoring', 'prospecting-leads.json'), {
    lead_1: { company: { name: 'Clínica', address: '\uD83D\uDCCD Rua das Flores, 30' } },
  });
  writeJson(path.join(root, 'lead-scoring', 'prospecting-groups.json'), { group_1: { members: ['lead_1'] } });
  writeJson(path.join(root, 'geocode-cache.json'), {
    '\uD83D\uDCCD Rua das Flores, 30': { lat: -22.9, lng: -43.2, ts: 10 },
  });

  const report = migrateExistingData(root, {
    localStorage: {
      sigma_leads: JSON.stringify([{ id: 'lead_1', address: '\uE0C8 Rua das Flores, 40', company: { address: '\u202C Rua das Flores, 40' } }]),
      sigma_analysis: JSON.stringify({ lead_1: { company: { address: '  Rua das Flores, 50  ' } } }),
    },
  });

  assert.equal(report.changed, true);
  assert.ok(report.backupDir);
  assert.ok(fs.existsSync(path.join(report.backupDir, 'campaigns.json')));
  assert.ok(fs.existsSync(path.join(report.backupDir, 'kanban.json')));
  assert.ok(fs.existsSync(path.join(report.backupDir, 'localStorage-before.json')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'campaigns.json'), 'utf8')).camp_1.status, 'cancelled');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'campaigns.json'), 'utf8')).camp_1.leads[0].address, 'Rua São João, 10');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'kanban.json'), 'utf8')).entities.e1.profile.address, 'Av. Brasil, 20');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'lead-scoring', 'prospecting-leads.json'), 'utf8')).lead_1.company.address, 'Rua das Flores, 30');
  assert.ok(report.localStorageUpdates.sigma_leads.includes('Rua das Flores, 40'));
  assert.ok(report.localStorageUpdates.sigma_analysis.includes('Rua das Flores, 50'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'geocode-cache.json'), 'utf8'))['rua das flores, 30'].lat, -22.9);

  const second = migrateExistingData(root, { localStorage: report.localStorageUpdates });
  assert.equal(second.changed, false);
}));

test('não altera arquivo ausente nem conteúdo sem endereço', () => withRoot((root) => {
  writeJson(path.join(root, 'campaigns.json'), { camp_1: { status: 'completed', leads: [{ phone: '5511999999999' }] } });
  const report = migrateExistingData(root);
  assert.equal(report.changed, false);
  assert.equal(report.files.find((entry) => entry.file === 'campaigns.json').status, 'clean');
  assert.equal(report.files.find((entry) => entry.file === 'kanban.json').status, 'missing');
  assert.equal(fs.existsSync(path.join(root, 'migrations')), false);
}));

test('limpa site e instagram já salvos na base', () => withRoot((root) => {
  writeJson(path.join(root, 'lead-scoring', 'prospecting-leads.json'), {
    lead_1: {
      company: {
        name: 'Odonto Lume',
        website: 'https://maps.app.goo.gl/abc123',
        instagram: 'https://www.instagram.com/odonto.lume/?igsh=xyz',
      },
    },
    lead_2: {
      company: { name: 'Café Aurora', website: 'https://cafeaurora.com?utm_source=gmaps', instagram: 'cafe.aurora' },
    },
  });

  const report = migrateExistingData(root, {
    localStorage: {
      sigma_leads: JSON.stringify([{
        id: 'lead_1',
        name: 'Odonto Lume',
        website: 'https://www.google.com/maps/place/Odonto',
        instagram: 'odonto.lume',
      }]),
    },
  });

  assert.equal(report.changed, true);
  const persisted = JSON.parse(fs.readFileSync(path.join(root, 'lead-scoring', 'prospecting-leads.json'), 'utf8'));
  assert.equal(persisted.lead_1.company.website, '');
  assert.equal(persisted.lead_1.company.instagram, '@odonto.lume');
  assert.equal(persisted.lead_2.company.website, 'https://cafeaurora.com/');
  assert.equal(persisted.lead_2.company.instagram, '@cafe.aurora');

  const stored = JSON.parse(report.localStorageUpdates.sigma_leads);
  assert.equal(stored[0].website, '');
  assert.equal(stored[0].instagram, '@odonto.lume');

  const second = migrateExistingData(root, { localStorage: report.localStorageUpdates });
  assert.equal(second.changed, false);
}));

test('migra URL de Instagram do website para o campo instagram mesmo sem chave prévia', () => withRoot((root) => {
  const report = migrateExistingData(root, {
    localStorage: {
      sigma_leads: JSON.stringify([
        { id: 'lead_ig', name: 'Barba e Cia', website: 'https://www.instagram.com/barbaecia.sp/' },
        { id: 'lead_lt', name: 'Studio Sorriso DF', website: 'https://linktr.ee/studiosorrisodf' },
      ]),
    },
  });

  assert.equal(report.changed, true);
  const stored = JSON.parse(report.localStorageUpdates.sigma_leads);
  assert.equal(stored[0].website, '');
  assert.equal(stored[0].instagram, '@barbaecia.sp');
  assert.equal(stored[1].website, '');
  assert.equal(stored[1].instagram, undefined);
}));
