const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const groupsModule = import('../renderer/src/leadGroups.mjs');
const matchModule = import('../renderer/src/leadMatch.mjs');
const updateModule = import('../renderer/src/useUpdateStatus.mjs');

const LEADS = [
  { id: 'a', name: 'Odonto Lume', category: 'Dentista', city: 'Rio de Janeiro', phone: '+55 21 98765-0142', website: 'https://odontolume.com.br' },
  { id: 'b', name: 'Café Aurora', category: 'Cafeteria', city: 'Niterói', phone: '+55 21 90000-0002', instagram: '@cafe.aurora' },
  { id: 'c', name: 'Studio Prisma', category: 'Design', city: 'Rio de Janeiro', email: 'oi@prisma.design' },
  { id: 'd', name: 'Padaria Sem Contato', category: 'Padaria', city: 'Niterói' },
];

test('filtro "só com WhatsApp" mantém apenas quem tem telefone utilizável', async () => {
  const { filterLeads } = await groupsModule;
  const result = filterLeads(LEADS, { channels: { whatsapp: 'with' } });
  assert.deepEqual(result.map((l) => l.id), ['a', 'b']);
});

test('filtro "sem site" exclui quem já tem site', async () => {
  const { filterLeads } = await groupsModule;
  const result = filterLeads(LEADS, { channels: { site: 'without' } });
  assert.deepEqual(result.map((l) => l.id), ['b', 'c', 'd']);
});

test('filtros combinam: WhatsApp e sem site', async () => {
  const { filterLeads } = await groupsModule;
  const result = filterLeads(LEADS, { channels: { whatsapp: 'with', site: 'without' } });
  assert.deepEqual(result.map((l) => l.id), ['b']);
});

test('filtro "sem Instagram" e nota mínima juntos', async () => {
  const { filterLeads } = await groupsModule;
  const withRating = LEADS.map((lead) => (lead.id === 'c' ? { ...lead, rating: 4.9 } : { ...lead, rating: 3 }));
  const result = filterLeads(withRating, { channels: { instagram: 'without' }, minRating: 4 });
  assert.deepEqual(result.map((l) => l.id), ['c']);
});

test('preset alterna: clicar duas vezes remove o efeito', async () => {
  const { applyPreset, emptyFilters, presetActive, FILTER_PRESETS } = await groupsModule;
  const preset = FILTER_PRESETS.find((item) => item.id === 'wa-no-site');
  const applied = applyPreset(emptyFilters(), preset);
  assert.equal(applied.channels.whatsapp, 'with');
  assert.equal(applied.channels.site, 'without');
  assert.equal(presetActive(applied, preset), true);

  const removed = applyPreset(applied, preset);
  assert.equal(removed.channels.whatsapp, undefined);
  assert.equal(removed.channels.site, undefined);
});

test('grupo criado com chaves de identidade sobrevive à reimportação da base', async () => {
  const { createGroup, membersFromLeads } = await groupsModule;
  const { resolveGroupMembers } = await matchModule;

  const group = createGroup({ name: 'Sem site', members: membersFromLeads([LEADS[2]], LEADS) });

  // Nova importação: ids diferentes, mesmos dados de negócio.
  const reimported = LEADS.map((lead, index) => ({ ...lead, id: `import_9_${index}` }));
  const resolved = resolveGroupMembers(group, reimported);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].name, 'Studio Prisma');
});

test('grupo não empresta membros para outra empresa', async () => {
  const { createGroup, membersFromLeads } = await groupsModule;
  const { resolveGroupMembers } = await matchModule;
  const group = createGroup({ name: 'X', members: membersFromLeads([LEADS[0]], LEADS) });
  const otherBase = [{ id: 'z', name: 'Empresa Totalmente Diferente', city: 'Salvador' }];
  assert.equal(resolveGroupMembers(group, otherBase).length, 0);
});

test('payload do serviço carrega leadIds e mantém os membros', async () => {
  const { createGroup, membersFromLeads, toServiceGroups } = await groupsModule;
  const group = createGroup({ name: 'Grupo A', members: membersFromLeads([LEADS[1]], LEADS) });
  const [payload] = toServiceGroups([group]);
  assert.equal(payload.id, group.id);
  assert.equal(payload.name, 'Grupo A');
  assert.deepEqual(payload.leadIds, group.members);
});

test('serviço substitui os grupos pelo que a base enviou', () => {
  const { ProspectingStore } = require('../lead-scoring/prospecting-store');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigma-groups-'));
  try {
    const store = new ProspectingStore(dir);
    store.upsert({ id: 'lead_a', company: { name: 'A' }, score: { value: 90, priority: 'alta' } });

    const written = store.replaceGroups([
      { id: 'g1', name: 'Sem site', leadIds: ['lead_a', 'phone:5521987650142'], createdAt: 1, updatedAt: 2 },
      { id: 'g2', name: 'Sem nome', leadIds: [] },
      { id: '', name: 'Ignorado', leadIds: [] },
    ]);
    assert.deepEqual(written.map((group) => group.name).sort(), ['Sem nome', 'Sem site']);

    // O lead analisado acompanha o vínculo do grupo.
    assert.deepEqual(store.get('lead_a').groupIds, ['g1']);
    assert.equal(store.getAll({ groupId: 'g1' }).length, 1);

    // Recarrega do disco: o replace é persistente.
    const reloaded = new ProspectingStore(dir);
    assert.equal(reloaded.listGroups().length, 2);

    // Substituir por vazio limpa de verdade, sem sobras.
    reloaded.replaceGroups([]);
    assert.equal(reloaded.listGroups().length, 0);
    assert.deepEqual(reloaded.get('lead_a').groupIds, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('eventos de atualização viram estados previsíveis', async () => {
  const { reduceUpdateEvent } = await updateModule;
  assert.deepEqual(reduceUpdateEvent({ status: 'checking' }), { type: 'checking' });
  assert.deepEqual(reduceUpdateEvent({ status: 'available', version: '1.2.0' }), { type: 'available', version: '1.2.0' });
  assert.deepEqual(reduceUpdateEvent({ status: 'not-available' }), { type: 'up-to-date' });
  assert.deepEqual(reduceUpdateEvent({ status: 'downloaded', version: '1.2.0' }), { type: 'downloaded', version: '1.2.0' });
  assert.deepEqual(reduceUpdateEvent({ status: 'error', message: 'sem rede' }), { type: 'error', message: 'sem rede' });
  const progress = reduceUpdateEvent({ status: 'progress', percent: 42.6, transferred: 1024, total: 2048 });
  assert.equal(progress.type, 'progress');
  assert.equal(progress.percent, 42.6);
  assert.equal(progress.transferred, 1024);
  assert.equal(reduceUpdateEvent({ status: 'desconhecido' }), null);
  assert.equal(reduceUpdateEvent(null), null);
});

test('progresso é limitado entre 0 e 100', async () => {
  const { reduceUpdateEvent } = await updateModule;
  assert.equal(reduceUpdateEvent({ status: 'progress', percent: 180 }).percent, 100);
  assert.equal(reduceUpdateEvent({ status: 'progress', percent: -20 }).percent, 0);
});

test('filtro "sem site" trata Linktree/Instagram como sem site', async () => {
  const { filterLeads, leadChannels } = await groupsModule;
  const base = [
    { id: 'real', name: 'Com Site Real', website: 'https://cafeaurora.com.br' },
    { id: 'linktree', name: 'Só Linktree', website: 'https://linktr.ee/cafe.aurora' },
    { id: 'instagram', name: 'Só Instagram', website: 'https://instagram.com/cafe.aurora' },
    { id: 'none', name: 'Sem Nada' },
  ];

  const withSite = filterLeads(base, { channels: { site: 'with' } });
  assert.deepEqual(withSite.map((lead) => lead.id), ['real']);

  const withoutSite = filterLeads(base, { channels: { site: 'without' } });
  assert.deepEqual(withoutSite.map((lead) => lead.id), ['linktree', 'instagram', 'none']);

  assert.equal(leadChannels(base[0]).site, true);
  assert.equal(leadChannels(base[1]).site, false);
  assert.equal(leadChannels(base[2]).site, false);
  assert.equal(leadChannels(base[3]).site, false);
});
