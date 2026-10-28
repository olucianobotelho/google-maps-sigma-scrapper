const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { KanbanStore } = require('../kanban/kanban-store');

function withStore(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sigma-kanban-test-'));
  try {
    return fn(new KanbanStore(root), root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('Kanban reúne o mesmo lead vindo do Maps e do scoring', () => withStore((store) => {
  store.syncLeads([{
    id: 'maps-1',
    name: 'Odonto Lume',
    address: 'Avenida Atlântica, 1000',
    city: 'Rio de Janeiro',
    state: 'RJ',
    category: 'Dentista',
  }], 'maps');

  const board = store.syncLeads([{
    id: 'score-1',
    company: {
      name: 'Odonto Lume',
      address: 'Avenida Atlântica, 1000',
      city: 'Rio de Janeiro',
      state: 'RJ',
      phone: '+55 21 98765-0142',
    },
    score: { value: 92, priority: 'alta' },
  }], 'scoring');

  assert.equal(board.cards.length, 1);
  assert.equal(board.cards[0].entity.profile.phone, '5521987650142');
  assert.deepEqual(board.cards[0].entity.sourceRefs.mapsIds, ['maps-1']);
  assert.deepEqual(board.cards[0].entity.sourceRefs.scoringIds, ['score-1']);
}));

test('pipeline padrão inclui Enviados e move campanhas enviadas/respondidas', () => withStore((store) => {
  const initial = store.getBoard();
  assert.deepEqual(initial.board.columns.map((column) => column.id), [
    'new', 'sent', 'contacted', 'qualified', 'proposal', 'won', 'lost',
  ]);
  assert.equal(initial.board.rules.filter((rule) => rule.enabled).length, 4);

  const sent = store.syncCampaigns([{
    id: 'campaign-1',
    leads: [{ id: 'lead-1', name: 'Clínica Aurora', phone: '+55 11 95555-1000', status: 'sent' }],
  }]);
  assert.equal(sent.cards[0].columnId, 'sent');

  const replied = store.syncCampaigns([{
    id: 'campaign-1',
    leads: [{ id: 'lead-1', name: 'Clínica Aurora', phone: '+55 11 95555-1000', status: 'replied' }],
  }]);
  assert.equal(replied.cards[0].columnId, 'contacted');
}));

test('automação padrão pode ser desligada sem movimento oculto', () => withStore((store) => {
  const initial = store.getBoard();
  store.saveConfig({
    columns: initial.board.columns,
    rules: initial.board.rules.filter((rule) => rule.trigger !== 'campaign.sent'),
  }, initial.revision);

  const board = store.syncCampaigns([{
    id: 'campaign-1',
    leads: [{ id: 'lead-1', name: 'Clínica Aurora', phone: '+55 11 95555-1000', status: 'sent' }],
  }]);
  assert.equal(board.cards[0].columnId, 'new');
}));

test('reconstrói índice e mescla Maps sem cidade/UF com scoring normalizado', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sigma-kanban-index-'));
  try {
    const initial = new KanbanStore(root);
    initial.syncLeads([{
      id: 'maps-sem-local',
      name: 'Odonto Lume',
      address: 'Avenida Atlântica, 1000, Rio de Janeiro, RJ',
    }], 'maps');

    const reloaded = new KanbanStore(root);
    const board = reloaded.syncLeads([{
      id: 'score-com-local',
      company: {
        name: 'Odonto Lume',
        address: 'Avenida Atlântica, 1000, Rio de Janeiro, RJ',
        city: 'Rio de Janeiro',
        state: 'RJ',
        phone: '+55 21 98765-0142',
      },
    }], 'scoring');

    assert.equal(board.cards.length, 1);
    assert.deepEqual(board.cards[0].entity.sourceRefs.mapsIds, ['maps-sem-local']);
    assert.deepEqual(board.cards[0].entity.sourceRefs.scoringIds, ['score-com-local']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('regras declarativas movem cards e override manual bloqueia automação', () => withStore((store) => {
  const initial = store.getBoard();
  const board = store.saveConfig({
    columns: [
      { id: 'new', name: 'Novos', color: '#10a37f' },
      { id: 'qualified', name: 'Qualificados', color: '#8b5cf6' },
    ],
    rules: [{
      id: 'high-score',
      enabled: true,
      priority: 1,
      trigger: 'any',
      match: 'all',
      when: [{ field: 'score', operator: 'gte', value: '80' }],
      action: { type: 'move', columnId: 'qualified' },
    }],
  }, initial.revision);

  const synced = store.syncLeads([{ id: 'lead-1', name: 'Clínica Sorriso', phone: '+55 11 95555-1000', score: 88 }], 'maps');
  const card = synced.cards[0];
  assert.equal(card.columnId, 'qualified');

  const moved = store.moveCard({ entityKey: card.entityKey, toColumnId: 'new', expectedRevision: card.revision, manual: true });
  const manuallyMoved = moved.cards[0];
  assert.equal(manuallyMoved.columnId, 'new');
  assert.equal(manuallyMoved.manualOverride, true);

  const skipped = store.applyRules({ force: false }).board.cards[0];
  assert.equal(skipped.columnId, 'new');

  const reapplied = store.applyRules({ force: true }).board.cards[0];
  assert.equal(reapplied.columnId, 'qualified');
}));

test('configuração inválida não executa código e migra cards de etapas removidas', () => withStore((store) => {
  const first = store.syncLeads([{ id: 'lead-1', name: 'Café Aurora', city: 'Rio de Janeiro' }], 'maps');
  const card = first.cards[0];
  store.moveCard({ entityKey: card.entityKey, toColumnId: 'contacted', expectedRevision: card.revision });

  const next = store.saveConfig({
    columns: [{ id: 'new', name: 'Entrada', color: '#10a37f' }],
    rules: [{
      id: 'unsafe',
      enabled: true,
      trigger: 'sync',
      when: [{ field: '__proto__', operator: 'eval', value: 'process.exit()' }],
      action: { type: 'script', columnId: 'new' },
    }],
  });

  assert.equal(next.cards[0].columnId, 'new');
  assert.equal(next.board.rules[0].when[0].field, 'score');
  assert.equal(next.board.rules[0].when[0].operator, 'gte');
  assert.equal(next.board.rules[0].action.type, 'move');
}));

test('Kanban geral não corta silenciosamente uma base acima de 5 mil leads', () => withStore((store) => {
  const leads = Array.from({ length: 5001 }, (_, index) => ({
    id: `bulk-${index}`,
    name: `Empresa ${index}`,
    city: 'São Paulo',
  }));
  const board = store.syncLeads(leads, 'maps');
  assert.equal(board.cards.length, 5001);
  assert.equal(board.cards.some((card) => card.entity.sourceRefs.mapsIds.includes('bulk-5000')), true);
}));

test('JSON corrompido é preservado antes de iniciar um Kanban novo', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sigma-kanban-corrupt-'));
  try {
    fs.writeFileSync(path.join(root, 'kanban.json'), '{not-json');
    const store = new KanbanStore(root);
    assert.equal(store.getBoard().cards.length, 0);
    assert.equal(fs.readdirSync(root).some((name) => name.startsWith('kanban.json.corrupt-')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('perfil do card não guarda Linktree/Instagram como website', () => {
  const { profileFrom } = require('../kanban/kanban-store');
  const linktree = profileFrom({ name: 'Café Aurora', website: 'https://linktr.ee/cafe.aurora' });
  assert.equal(linktree.website, '');
  const instagram = profileFrom({ name: 'Café Aurora', website: 'https://instagram.com/cafe.aurora' });
  assert.equal(instagram.website, '');
  const real = profileFrom({ name: 'Café Aurora', website: 'https://cafeaurora.com.br?utm_source=gmaps' });
  assert.equal(real.website, 'https://cafeaurora.com.br/');
});

test('regra hasWebsite não casa lead só com link-in-bio', () => {
  const { profileFrom, getFieldValue } = (() => {
    const mod = require('../kanban/kanban-store');
    return { profileFrom: mod.profileFrom, getFieldValue: null };
  })();
  const lead = profileFrom({ name: 'Café Aurora', website: 'https://linktr.ee/cafe.aurora' });
  assert.equal(Boolean(lead.website), false);
});
