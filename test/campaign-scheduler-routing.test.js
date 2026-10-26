const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { CampaignScheduler } = require('../campaigns/campaign-scheduler');
const { CampaignManager } = require('../campaigns/campaign-manager');

function makeScheduler(providers, campaign) {
  const campaigns = { [campaign.id]: campaign };
  const store = {
    get: (id) => campaigns[id] || null,
    update: (id, patch) => { Object.assign(campaigns[id], patch); },
    pushEvent: (c, entry) => { c.eventLog.push(entry); },
    recomputeStats: () => ({ sent: 0 }),
  };
  const manager = {
    getCampaignSettings: () => ({ workingHoursEnabled: false, manualUnlimited: true }),
    dailyQuota: null,
    registerMessageId() {},
  };
  return new CampaignScheduler(new Map(providers), store, null, manager);
}

const online = { isReady: () => true, getStatus: () => 'connected' };
const offline = { isReady: () => false, getStatus: () => 'disconnected' };

function campaignWith(overrides = {}) {
  return {
    id: 'c1',
    status: 'running',
    provider: 'baileys',
    connectionId: 'a',
    connectionIds: ['a'],
    leads: [{
      leadId: 'l1',
      phone: '5511900000001',
      status: 'pending',
      connectionId: 'a',
    }],
    template: 'Oi',
    schedule: { intervalMs: 5000, workingHours: { enabled: false } },
    stats: {},
    eventLog: [],
    ...overrides,
  };
}

test('não usa outra sessão quando o número da campanha está offline', () => {
  const scheduler = makeScheduler(
    [['a', offline], ['b', online]],
    campaignWith(),
  );

  const pick = scheduler._pickNextSend(campaignWith());
  assert.equal(pick.blocked, true);
  assert.equal(pick.reason, 'no_provider');
  assert.equal(pick.connectionId, undefined);
});

test('não usa outra sessão nem quando o lead foi criado com outro número', () => {
  const scheduler = makeScheduler(
    [['a', offline], ['b', online]],
    campaignWith(),
  );

  const campaign = campaignWith();
  campaign.leads[0].connectionId = 'a';
  const pick = scheduler._pickNextSend(campaign);
  assert.equal(pick.blocked, true);
  assert.equal(pick.connectionId, undefined);
});

test('campanha sem número definido ainda usa uma sessão online (legado)', () => {
  const scheduler = makeScheduler(
    [['a', offline], ['b', online]],
    campaignWith(),
  );

  const campaign = campaignWith({ connectionId: null, connectionIds: [] });
  campaign.leads[0].connectionId = null;
  const pick = scheduler._pickNextSend(campaign);
  assert.equal(pick.connectionId, 'b');
});

test('manager não troca o remetente quando o número da campanha caiu', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigma-campaign-routing-'));
  try {
    const manager = new CampaignManager(dir);
    const campaign = manager.create({
      name: 'Campanha A',
      provider: 'baileys',
      connectionId: 'a',
      connectionIds: ['a'],
      template: { text: 'Oi' },
      leadIds: [{ phone: '11999999999' }],
      schedule: { intervalMs: 5000 },
    });
    manager.setProvidersMap(new Map([
      ['a', offline],
      ['b', online],
    ]));

    const resolved = manager.resolveProviderForCampaign(campaign, 'b');
    assert.equal(resolved.ok, false);
    assert.match(resolved.error, /não está conectado/i);
    assert.ok(
      resolved.statuses.some((s) => s.id === 'b' && s.status === 'connected'),
      'a mensagem de erro deve listar as sessões disponíveis',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
