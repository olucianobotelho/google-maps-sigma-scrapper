const assert = require('node:assert/strict');
const test = require('node:test');

const { CampaignScheduler } = require('../campaigns/campaign-scheduler');

function makeScheduler(settings = {}, campaigns = {}) {
  const store = {
    get: (id) => campaigns[id] || null,
    update: (id, patch) => { Object.assign(campaigns[id], patch); },
    pushEvent: (campaign, entry) => { campaign.eventLog.push(entry); },
    recomputeStats: () => ({ sent: 0 }),
  };
  const manager = {
    getCampaignSettings: () => ({
      workingHoursEnabled: true,
      workingHoursStart: '07:00',
      workingHoursEnd: '18:00',
      ...settings,
    }),
    dailyQuota: null,
    registerMessageId() {},
  };
  return { scheduler: new CampaignScheduler(new Map(), store, null, manager), campaigns };
}

test('fora da janela: aponta o próximo início (07:00 do dia seguinte)', () => {
  const { scheduler } = makeScheduler();
  const at19 = new Date(2026, 9, 26, 19, 0).getTime();
  const next = scheduler.nextWindowStartAt({ schedule: {} }, at19);
  const nextDate = new Date(next);

  assert.equal(nextDate.getDate(), 27);
  assert.equal(nextDate.getHours(), 7);
  assert.equal(nextDate.getMinutes(), 0);
});

test('dentro da janela: não há próximo início', () => {
  const { scheduler } = makeScheduler();
  const at9 = new Date(2026, 9, 26, 9, 0).getTime();
  assert.equal(scheduler.nextWindowStartAt({ schedule: {} }, at9), null);
});

test('janela desligada: sempre elegível', () => {
  const { scheduler } = makeScheduler({ workingHoursEnabled: false });
  const at23 = new Date(2026, 9, 26, 23, 0).getTime();
  assert.equal(scheduler.nextWindowStartAt({ schedule: {} }, at23), null);
});

test('janela da campanha sobrepõe a global', () => {
  const { scheduler } = makeScheduler();
  const at22 = new Date(2026, 9, 26, 22, 0).getTime();
  const campaign = { schedule: { workingHours: { enabled: true, start: '20:00', end: '23:00' } } };
  assert.equal(scheduler.nextWindowStartAt(campaign, at22), null);
});

test('cota renova à meia-noite local', () => {
  const { scheduler } = makeScheduler();
  const now = new Date(2026, 9, 26, 15, 30).getTime();
  const reset = new Date(scheduler._nextQuotaResetAt(now));

  assert.equal(reset.getDate(), 27);
  assert.equal(reset.getHours(), 0);
  assert.equal(reset.getMinutes(), 0);
});

test('retoma sozinha a campanha pausada por cota quando o dia vira', async () => {
  const paused = {
    id: 'c1',
    status: 'paused',
    pauseReason: 'daily_limit',
    leads: [],
    eventLog: [],
    stats: {},
  };
  const { scheduler, campaigns } = makeScheduler({}, { c1: paused });

  let resumed = 0;
  scheduler.campaignManager.resume = (id) => {
    resumed += 1;
    campaigns[id].status = 'running';
    campaigns[id].pauseReason = null;
  };
  scheduler._quotaWaiting.set('c1', Date.now() - 1000);

  await scheduler.tick();

  assert.equal(resumed, 1, 'a campanha precisa ser retomada quando a cota renova');
  assert.equal(scheduler._quotaWaiting.size, 0);
  assert.ok(campaigns.c1.eventLog.some((e) => e.type === 'daily_limit_reset'));
  assert.equal(campaigns.c1.nextResumeAt, null);
});

test('não retoma quando autoResumeDailyLimit está desligado', async () => {
  const paused = {
    id: 'c1',
    status: 'paused',
    pauseReason: 'daily_limit',
    leads: [],
    eventLog: [],
    stats: {},
  };
  const { scheduler } = makeScheduler({ autoResumeDailyLimit: false }, { c1: paused });

  let resumed = 0;
  scheduler.campaignManager.resume = () => { resumed += 1; };
  scheduler._quotaWaiting.set('c1', Date.now() - 1000);

  await scheduler.tick();

  assert.equal(resumed, 0);
  assert.equal(scheduler._quotaWaiting.size, 1);
});

test('mantém a espera quando o WhatsApp está offline na hora de retomar', async () => {
  const paused = {
    id: 'c1',
    status: 'paused',
    pauseReason: 'daily_limit',
    leads: [],
    eventLog: [],
    stats: {},
  };
  const { scheduler } = makeScheduler({}, { c1: paused });

  scheduler.campaignManager.resume = () => {
    throw new Error('WhatsApp não está conectado');
  };
  scheduler._quotaWaiting.set('c1', Date.now() - 1000);

  await scheduler.tick();

  assert.equal(scheduler._quotaWaiting.size, 1, 'não pode perder a campanha da fila');
});
