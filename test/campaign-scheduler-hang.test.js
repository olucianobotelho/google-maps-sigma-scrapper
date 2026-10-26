const assert = require('node:assert/strict');
const test = require('node:test');

const { CampaignScheduler } = require('../campaigns/campaign-scheduler');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeCampaign(id, phone, overrides = {}) {
  return {
    id,
    status: 'running',
    provider: 'baileys',
    connectionId: 'a',
    connectionIds: ['a'],
    leads: [{ leadId: `${id}-1`, phone, status: 'pending', connectionId: 'a' }],
    template: 'Olá {{nome}}',
    schedule: { intervalMs: 5000, workingHours: { enabled: false } },
    stats: {},
    eventLog: [],
    ...overrides,
  };
}

function makeScheduler(campaigns, provider) {
  const store = {
    get: (id) => campaigns[id] || null,
    update: (id, patch) => { Object.assign(campaigns[id], patch); },
    pushEvent: (campaign, entry) => { campaign.eventLog.push(entry); },
    recomputeStats: () => ({ sent: 0 }),
  };
  const manager = {
    getCampaignSettings: () => ({
      workingHoursEnabled: false,
      manualUnlimited: true,
    }),
    dailyQuota: null,
    registerMessageId() {},
  };
  return new CampaignScheduler(new Map([['a', provider]]), store, null, manager);
}

test('envio pendurado não congela outras campanhas', async () => {
  const campaigns = {
    c1: makeCampaign('c1', '5511900000001'),
    c2: makeCampaign('c2', '5511900000002'),
  };
  const sent = [];
  const provider = {
    isReady: () => true,
    getStatus: () => 'connected',
    sendMessage(to) {
      if (to === '5511900000001') return new Promise(() => {}); // nunca resolve
      sent.push(to);
      return Promise.resolve({ success: true, messageId: 'm1', jid: `${to}@s.whatsapp.net` });
    },
  };

  const scheduler = makeScheduler(campaigns, provider);
  scheduler._sendTimeoutMs = 60;
  scheduler._tickWatchdogMs = 500;
  scheduler.addCampaign('c1');
  scheduler.addCampaign('c2');
  scheduler.start();

  await wait(1000);
  scheduler.stop();

  assert.deepEqual(sent, ['5511900000002'], 'a campanha c2 precisa enviar mesmo com c1 travada');
  assert.equal(campaigns.c1.leads[0].status, 'failed');
  assert.match(campaigns.c1.leads[0].errorMessage, /Tempo esgotado/i);
  assert.equal(campaigns.c1.leads[0].nextAttemptAt, null, 'timeout não deve repetir sozinho');
});

test('start() rearma o timer quando ele se perde', async () => {
  const campaigns = { c1: makeCampaign('c1', '5511900000001') };
  const sent = [];
  const provider = {
    isReady: () => true,
    getStatus: () => 'connected',
    sendMessage(to) {
      sent.push(to);
      return Promise.resolve({ success: true, messageId: 'm1', jid: 'x' });
    },
  };

  const scheduler = makeScheduler(campaigns, provider);
  scheduler.addCampaign('c1');
  // Simula timer morto com o loop ainda marcado como ativo.
  scheduler.running = true;
  scheduler._tickTimer = null;
  scheduler._tickInFlight = 0;

  scheduler.start();
  await wait(900);
  scheduler.stop();

  assert.equal(sent.length, 1, 'start() precisa rearmar o loop em vez de retornar');
});

test('watchdog do tick rearma o loop mesmo com tick pendurado', async () => {
  const campaigns = { c1: makeCampaign('c1', '5511900000001') };
  const sent = [];
  const provider = {
    isReady: () => true,
    getStatus: () => 'connected',
    sendMessage(to) {
      sent.push(to);
      return Promise.resolve({ success: true, messageId: 'm1', jid: 'x' });
    },
  };

  const scheduler = makeScheduler(campaigns, provider);
  const realTick = scheduler.tick.bind(scheduler);
  let hang = true;
  scheduler.tick = () => (hang ? new Promise(() => {}) : realTick());
  scheduler._tickWatchdogMs = 60;

  scheduler.addCampaign('c1');
  scheduler.start();

  await wait(750); // primeiro tick dispara em ~500ms e o watchdog libera em ~560ms
  hang = false;
  await wait(1400); // próximo tick é agendado 1s depois do watchdog
  scheduler.stop();

  assert.ok(sent.length >= 1, 'o loop precisa voltar a rodar depois do watchdog');
});
