/**
 * Renderiza as rotas principais em um BrowserWindow isolado e salva evidência visual.
 * Não usa dados/sessões reais: todos os IPCs de leitura são mocks determinísticos.
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const XLSX = require('xlsx');
const { KanbanStore } = require('../kanban/kanban-store');
const { ProspectingStore } = require('../lead-scoring/prospecting-store');

const outputDir = path.join(__dirname, '..', 'docs', 'qa', 'open-design-lote1');
const qaUserDataPath = path.join(os.tmpdir(), `sigma-gmaps-qa-${process.pid}`);
app.setPath('userData', qaUserDataPath);
const errors = [];
const now = Date.now();
const qaXlsxWorkbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(qaXlsxWorkbook, XLSX.utils.json_to_sheet([
  { Empresa: 'Consultório QA', Nicho: 'Odontologia', Cidade: 'Brasília', Estado: 'DF', Telefone: '+55 61 98888-0000' },
]), 'Leads');
const qaXlsxBase64 = XLSX.write(qaXlsxWorkbook, { type: 'base64', bookType: 'xlsx' });
const fixtureLeads = [
  { id: 'lead-1', searchId: 'search-odonto', name: 'Odonto Lume', category: 'Dentista', phone: '+55 21 98765-0142', email: 'contato@odontolume.com.br', website: 'https://odontolume.com.br', address: 'Av. Atlântica, 1000, Copacabana', city: 'Rio de Janeiro', state: 'RJ', latitude: -22.9711, longitude: -43.1822, coordSource: 'poi' },
  { id: 'lead-2', searchId: 'search-odonto', name: 'Clínica Sorriso', category: 'Clínica odontológica', phone: '+55 21 97654-8890', website: 'https://clinicasorriso.com.br', address: 'Rua Visconde de Pirajá, 420, Ipanema', city: 'Rio de Janeiro', state: 'RJ', latitude: -22.9833, longitude: -43.2096, coordSource: 'meta' },
  { id: 'lead-3', searchId: 'search-academia', name: 'Academia Pulso', category: 'Academia', phone: '+55 11 95555-1000', instagram: '@academiapulso', address: 'Av. Paulista, 1200, Bela Vista', city: 'São Paulo', state: 'SP', latitude: -23.5616, longitude: -46.6559, coordSource: 'poi' },
  { id: 'lead-4', searchId: 'importados', name: 'Café Importado', category: 'Cafeteria', phone: '+55 11 94444-2000', city: 'São Paulo', state: 'SP' },
  { id: 'lead-5', searchId: 'search-odonto', name: 'Studio Sorriso DF', category: 'Dentista', phone: '+55 61 93333-4000', website: 'https://linktr.ee/studiosorrisodf', address: 'SGAS 915, Asa Sul', city: 'Brasília', state: 'DF', latitude: -15.8344, longitude: -47.9136, coordSource: 'poi' },
  { id: 'lead-6', searchId: 'search-academia', name: 'Barba e Cia', category: 'Barbearia', phone: '+55 11 92222-5000', website: 'https://www.instagram.com/barbaecia.sp/', address: 'Rua Augusta, 500, Consolação', city: 'São Paulo', state: 'SP', latitude: -23.5505, longitude: -46.6600, coordSource: 'meta' },
];
const fixtureSearches = [
  { id: 'search-odonto', label: 'Dentistas · Rio de Janeiro', query: 'dentistas rio de janeiro', source: 'maps', timestamp: now - 120000 },
  { id: 'search-academia', label: 'Academias · São Paulo', query: 'academias são paulo', source: 'maps', timestamp: now - 3600000 },
  { id: 'importados', label: 'Planilhas importadas', source: 'spreadsheet', timestamp: now },
];
const fixtureGroups = [
  { id: 'group-demo', name: 'Odontologia · Zona Sul', members: ['lead-1', 'lead-2'], count: 2, color: '#10a37f' },
];

// O serviço de scoring gera id próprio (lead_<slug>). O fixture usa o mesmo
// formato de propósito: só casa com a base por identidade, nunca pelo id do
// renderer — exatamente o caminho que a tela precisa provar.
function scoringServiceId(lead) {
  return `lead_${String(lead.name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')}_${String(lead.city || '').slice(0, 6).toLowerCase()}`;
}

function scoringFixtureLead(lead, value, priority) {
  return {
    id: scoringServiceId(lead),
    company: {
      name: lead.name,
      address: lead.address,
      city: lead.city,
      state: lead.state,
      phone: lead.phone,
      website: lead.website || '',
      instagram: lead.instagram || '',
      reviewCount: 80,
      rating: 4.8,
    },
    score: { value, priority, reasons: ['Análise persistida no fixture de QA'] },
    updatedAt: now,
  };
}
const fixtureCampaigns = [
  {
    id: 'campaign-1', name: 'Odontologia · Zona Sul', status: 'running', createdAt: now - 7200000,
    connectionId: 'sigma-main', stats: { total: 3, sent: 3, read: 1, replied: 1 },
    leads: [
      {
        leadId: 'lead-1', name: 'Odonto Lume', phone: '5521987650142', phoneRaw: '+55 21 98765-0142',
        category: 'Dentista', status: 'replied', sentAt: now - 5000000, repliedAt: now - 4000000,
        kanbanStage: 'conversation', kanbanOrder: 0,
      },
      {
        leadId: 'lead-2', name: 'Clínica Sorriso', phone: '5521976548890', phoneRaw: '+55 21 97654-8890',
        category: 'Clínica odontológica', status: 'sent', sentAt: now - 3000000,
        kanbanStage: 'new', kanbanOrder: 1,
      },
      {
        leadId: 'lead-3', name: 'Academia Pulso', phone: '5511955551000', phoneRaw: '+55 11 95555-1000',
        category: 'Academia', status: 'failed', kanbanStage: 'finished', kanbanOrder: 2,
      },
    ],
  },
];
const fixtureChats = [
  { jid: '5521987650142@s.whatsapp.net', phone: '5521987650142', name: 'Odonto Lume', lastMessage: 'Pode me explicar melhor?', timestamp: Math.floor(now / 1000), unreadCount: 2 },
  { jid: '5521976548890@s.whatsapp.net', phone: '5521976548890', name: 'Clínica Sorriso', lastMessage: 'Obrigada pelo contato.', timestamp: Math.floor(now / 1000) - 3600, unreadCount: 0 },
];
const fixtureMessages = [
  { key: { id: 'msg-1', fromMe: true }, messageTimestamp: Math.floor(now / 1000) - 120, message: { conversation: 'Vi uma oportunidade simples no site de vocês. Posso mostrar?' } },
  { key: { id: 'msg-2', fromMe: false }, messageTimestamp: Math.floor(now / 1000) - 60, message: { conversation: 'Pode me explicar melhor?' } },
];
const fixtureConnectionState = { connected: true };
const fixtureFailureState = { connect: false, startChat: false, createCampaign: false, mapRepair: false };
let fixtureMapRepairRequests = 0;
// Store real dos grupos: o harness prova que um grupo criado na Base chega ao
// serviço (e portanto aparece no Lead Scoring e nas campanhas).
const fixtureScoringStore = new ProspectingStore(qaUserDataPath);
const fixtureKanbanStore = new KanbanStore(qaUserDataPath);
fixtureKanbanStore.syncLeads(fixtureLeads, 'maps');
fixtureKanbanStore.syncLeads(
  fixtureLeads.slice(0, 2).map((lead) => ({
    id: `score-${lead.id}`,
    company: lead,
    score: { value: lead.id === 'lead-1' ? 82 : 45, priority: lead.id === 'lead-1' ? 'alta' : 'media' },
  })),
  'scoring',
);
fixtureKanbanStore.syncCampaigns(fixtureCampaigns);

const mocks = {
  'migrate-existing-data': { success: true, changed: false, localStorageUpdates: {} },
  'update-status': { state: 'idle' },
  'metrics-get': {},
  'metrics-settings-get': { enabled: false },
  'ui-zoom-get': 1,
  'ui-zoom-set': 1,
  'ui-zoom-reset': 1,
  'whatsapp-get-chats': { chats: fixtureChats },
  'whatsapp-get-archived-chats': { chats: [] },
  'whatsapp-get-contacts': { contacts: fixtureChats },
  'whatsapp-get-profile-pic': { url: null },
  'whatsapp-load-messages': { messages: fixtureMessages },
  'whatsapp-mark-read': { success: true },
  'whatsapp-get-contact-info': { name: 'Odonto Lume', phone: '+55 21 98765-0142' },
  'whatsapp-get-settings': {},
  'whatsapp-labels-get': { success: true, catalog: [], byJid: {} },
  'campaign-get-all': { campaigns: fixtureCampaigns },
  'lead-scoring-get-all': {
    success: true,
    leads: [
      scoringFixtureLead(fixtureLeads[0], 82, 'alta'),
      scoringFixtureLead(fixtureLeads[1], 45, 'baixa'),
    ],
    total: 2,
    stats: { total: 2, highPriority: 1, goodOpportunity: 0, responded: 0, closed: 0, closedValue: 0 },
  },
  'lead-scoring-list-groups': () => ({ success: true, groups: fixtureScoringStore.listGroups() }),
  'lead-scoring-sync-groups': (_event, { groups } = {}) => ({
    success: true,
    groups: fixtureScoringStore.replaceGroups(groups || []),
  }),
  'lead-scoring-analyze-batch': {
    success: true,
    failures: 0,
    results: [
      { success: true, lead: scoringFixtureLead(fixtureLeads[0], 82, 'alta'), aiRefined: false },
      { success: true, lead: scoringFixtureLead(fixtureLeads[1], 45, 'baixa'), aiRefined: false },
    ],
  },
  'lead-scoring-analyze-lead': {
    success: true,
    lead: scoringFixtureLead(fixtureLeads[0], 82, 'alta'),
  },
  'lead-scoring-get-settings': {
    success: true,
    settings: {
      ai: { provider: 'opencode', model: 'muse-spark-1.3-contributor-free', hasApiKey: true },
      analysis: { autoAnalyzeAfterScrape: false },
      rules: {
        thresholds: { ignoreBelow: 40, goodFrom: 60, highFrom: 75 },
        digitalPain: { noWebsitePoints: 16, missingPixelPoints: 9 },
      },
    },
  },
  'lead-scoring-update-settings': { success: true, settings: { ai: { provider: 'opencode', model: 'muse-spark-1.3-contributor-free', hasApiKey: true } } },
  'lead-scoring-test-connection': { success: true, provider: 'opencode', model: 'muse-spark-1.3-contributor-free' },
  'update-status': {
    isPackaged: false,
    version: require('../package.json').version,
    hasUpdater: false,
    unavailableReason: 'Atualizações funcionam na versão instalada, não na prévia de desenvolvimento.',
    last: { status: 'idle', ts: now },
  },
  'update-check': { success: false, error: 'Atualizações funcionam na versão instalada, não na prévia de desenvolvimento.' },
};

Object.entries(mocks).forEach(([channel, value]) => {
  ipcMain.handle(channel, (event, payload) => (typeof value === 'function' ? value(event, payload) : value));
});

// Fluxo determinístico para exercitar o painel expansível da extração sem
// abrir navegador, Maps ou uma sessão real durante a QA visual.
ipcMain.handle('start-scrape', async (event, { queryId, progressContext = {} } = {}) => {
  const neighborhood = String(progressContext.neighborhood || 'Pesquisa regional');
  const liveLead = {
    id: `qa-${neighborhood.replace(/\W+/g, '-').toLowerCase()}`,
    name: `Lead ao vivo ${neighborhood}`,
    category: 'Dentista',
    address: `${neighborhood}, Brasília, DF`,
    city: 'Brasília',
    state: 'DF',
    latitude: -15.793889,
    longitude: -47.882778,
    coordSource: 'poi',
  };
  const baseProgress = {
    queryId,
    neighborhood,
    neighborhoodIndex: Number(progressContext.neighborhoodIndex) || 0,
    totalNeighborhoods: Number(progressContext.totalNeighborhoods) || 1,
    batchComplete: progressContext.batchComplete === true,
  };
  await new Promise((resolve) => setTimeout(resolve, 240));
  event.sender.send('progress', { ...baseProgress, status: 'started', current: 0, total: 8, found: 0, message: `Iniciando: ${neighborhood}` });
  await new Promise((resolve) => setTimeout(resolve, 240));
  event.sender.send('progress', { ...baseProgress, status: 'running', current: 3, total: 8, found: 6, message: '6 empresas encontradas na lista do Google Maps.' });
  event.sender.send('progress', {
    ...baseProgress,
    status: 'running',
    type: 'lead',
    current: 3,
    total: 8,
    found: 1,
    lead: liveLead,
    message: `Empresa 1 de 8 extraída: ${liveLead.name} · nota 4,8 · telefone encontrado.`,
  });
  await new Promise((resolve) => setTimeout(resolve, 640));
  event.sender.send('progress', { ...baseProgress, status: 'completed', current: 8, total: 8, found: 8, message: `Extração concluída: ${neighborhood}` });
  return {
    success: true,
    data: [liveLead],
    warnings: [],
  };
});

ipcMain.handle('whatsapp-status', () => ({
  status: fixtureConnectionState.connected ? 'connected' : 'disconnected',
  connectionId: 'sigma-main',
  activeConnectionId: 'sigma-main',
}));
ipcMain.handle('whatsapp-list-connections', () => ({
  activeConnectionId: 'sigma-main',
  connections: [{
    id: 'sigma-main',
    phoneNumber: '+55 21 90000-0001',
    status: fixtureConnectionState.connected ? 'connected' : 'disconnected',
    provider: 'baileys',
    active: true,
  }],
}));
ipcMain.handle('whatsapp-connect', () => ({
  success: !fixtureFailureState.connect,
  error: fixtureFailureState.connect ? 'Não foi possível gerar o QR de teste.' : undefined,
  connectionId: 'sigma-main',
  activeConnectionId: 'sigma-main',
  connections: [{ id: 'sigma-main', phoneNumber: '+55 21 90000-0001', status: 'connected', provider: 'baileys', active: true }],
}));
ipcMain.handle('whatsapp-start-chat', (_event, { phone, name }) => {
  const digits = String(phone || '').replace(/@.*$/, '').replace(/\D/g, '');
  if (fixtureFailureState.startChat) return { success: false, error: 'Falha controlada ao abrir conversa.' };
  return { success: Boolean(digits), jid: `${digits}@s.whatsapp.net`, phone: digits, name: name || digits };
});

ipcMain.handle('campaign-create', () => fixtureFailureState.createCampaign
  ? { success: false, error: 'Falha controlada ao criar campanha.' }
  : { success: true, campaign: fixtureCampaigns[0] });

ipcMain.handle('campaign-update', (_event, { id, updates }) => {
  const campaign = fixtureCampaigns.find((item) => item.id === id);
  if (!campaign) return { success: false, error: 'Campanha não encontrada no fixture' };
  if (Array.isArray(updates?.leads)) campaign.leads = updates.leads;
  return { success: true, campaign };
});

ipcMain.handle('kanban-get-board', () => ({ success: true, board: fixtureKanbanStore.getBoard() }));
ipcMain.handle('kanban-sync-maps', (_event, { leads } = {}) => ({
  success: true,
  board: fixtureKanbanStore.syncLeads(leads, 'maps', { replace: true, authoritative: true }),
}));
ipcMain.handle('kanban-save-config', (_event, { board, expectedRevision } = {}) => {
  try {
    return { success: true, board: fixtureKanbanStore.saveConfig(board, expectedRevision) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
ipcMain.handle('kanban-move-card', (_event, payload = {}) => {
  try {
    return { success: true, board: fixtureKanbanStore.moveCard(payload) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
ipcMain.handle('kanban-record-deal', (_event, payload = {}) => {
  try {
    return { success: true, board: fixtureKanbanStore.recordDeal(payload) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
ipcMain.handle('kanban-apply-rules', (_event, { force } = {}) => {
  try {
    const result = fixtureKanbanStore.applyRules({ force: Boolean(force) });
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
ipcMain.handle('kanban-resume-automation', (_event, { entityKey } = {}) => {
  try {
    return { success: true, board: fixtureKanbanStore.resumeAutomation(entityKey) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
ipcMain.handle('repair-map-addresses', (_event, { leads } = {}) => {
  const candidates = Array.isArray(leads) ? leads : [];
  fixtureMapRepairRequests += candidates.length;
  if (fixtureFailureState.mapRepair) {
    return {
      success: true,
      partial: true,
      repaired: candidates.map((lead) => ({
        key: lead.key,
        address: String(lead.address || '').replace(/^[\s\p{Cc}\p{Cf}\p{Co}\u{1F4CD}\u{FE0E}\u{FE0F}]+/u, ''),
      })),
      failures: candidates.map((lead) => ({ key: lead.key, error: 'Falha controlada de geocoding.' })),
    };
  }
  return {
    success: true,
    repaired: candidates.map((lead) => ({
      key: lead.key,
      address: String(lead.address || '').replace(/^[\s\p{Cc}\p{Cf}\p{Co}\u{1F4CD}\u{FE0E}\u{FE0F}]+/u, ''),
      latitude: -22.985,
      longitude: -43.205,
      coordSource: 'nominatim',
      geocodeConfidence: 'exact',
    })),
  };
});

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#f7f8f7',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: true,
    },
  });

  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 3 && !/Electron Security Warning/i.test(message)) {
      console.log(`[renderer-error] ${message}`);
      errors.push(message);
    }
  });
  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    errors.push(`FAIL_LOAD ${code} ${description} ${url}`);
  });

  await win.loadURL(pathToFileURL(path.join(__dirname, '..', 'renderer', 'dist', 'index.html')).href);
  await win.webContents.executeJavaScript(`
    localStorage.setItem('sigma_onboarding_done', '1');
    localStorage.setItem('sigma_ls_ai_onboard_skipped', '1');
    localStorage.setItem('sigma_leads', ${JSON.stringify(JSON.stringify(fixtureLeads))});
    localStorage.setItem('sigma_searches', ${JSON.stringify(JSON.stringify(fixtureSearches))});
    localStorage.setItem('sigma_groups', ${JSON.stringify(JSON.stringify(fixtureGroups))});
    localStorage.setItem('sigma_ref', ${JSON.stringify(JSON.stringify({ lat: -22.975, lng: -43.19, accuracy: 12, timestamp: now }))});
    document.documentElement.setAttribute('data-theme', 'light');
  `);
  await win.reload();
  await pause(900);
  await win.webContents.insertCSS('*{animation:none!important;transition:none!important;scroll-behavior:auto!important}');

  // Fluxo determinístico para validar a fila de lembretes da Visão Geral com
  // volume realista: 30 entradas, chegada mais recente no topo e rolagem.
  if (process.env.SIGMA_QA_NOTIFICATIONS_ONLY === '1') {
    const notificationErrors = [];
    const reminderFixture = Array.from({ length: 30 }, (_item, index) => ({
      id: `qa-reminder-${index + 1}`,
      key: `qa-reminder-key-${index + 1}`,
      jid: `551199999${String(index + 1).padStart(4, '0')}@s.whatsapp.net`,
      phone: `551199999${String(index + 1).padStart(4, '0')}`,
      name: `Lembrete ${String(30 - index).padStart(2, '0')}`,
      reminderAt: now + ((index + 1) * 86400000),
      note: `Retorno de teste ${index + 1}`,
      createdAt: now - (index * 1000),
    }));
    await win.webContents.executeJavaScript(`(() => {
      localStorage.setItem('sigma_whatsapp_reminders', ${JSON.stringify(JSON.stringify(reminderFixture))});
      window.dispatchEvent(new Event('sigma:reminders-updated'));
    })()`);
    await pause(240);
    await win.webContents.executeJavaScript(`document.querySelector('.overview-crm-reminder')?.click()`);
    await pause(240);
    const notificationUi = await win.webContents.executeJavaScript(`(() => {
      const trigger = document.querySelector('.overview-crm-reminder');
      const popover = document.querySelector('#overview-pending-popover');
      const list = popover?.querySelector('.overview-pending-popover-list');
      const items = [...(list?.querySelectorAll('.overview-pending-popover-item') || [])];
      const triggerRect = trigger?.getBoundingClientRect();
      const popoverRect = popover?.getBoundingClientRect();
      const style = popover ? getComputedStyle(popover) : null;
      const listStyle = list ? getComputedStyle(list) : null;
      return {
        open: Boolean(popover),
        count: items.length,
        first: items[0]?.querySelector('b')?.textContent?.trim() || '',
        last: items.at(-1)?.querySelector('b')?.textContent?.trim() || '',
        opensDown: Boolean(triggerRect && popoverRect && popoverRect.top >= triggerRect.bottom),
        notClipped: Boolean(popoverRect && popoverRect.top >= 0 && popoverRect.bottom <= window.innerHeight),
        scrollable: Boolean(list && list.scrollHeight > list.clientHeight),
        overflowY: listStyle?.overflowY || '',
        containerOverflowY: style?.overflowY || '',
        position: style?.position || '',
        rect: popoverRect ? { top: Math.round(popoverRect.top), bottom: Math.round(popoverRect.bottom), height: Math.round(popoverRect.height) } : null,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
    })()`);
    if (!notificationUi.open || notificationUi.count !== 30 || notificationUi.first !== 'Lembrete 30' || notificationUi.last !== 'Lembrete 01' || !notificationUi.opensDown || !notificationUi.notClipped || !notificationUi.scrollable || !/auto|scroll/.test(notificationUi.overflowY) || notificationUi.position !== 'fixed') {
      notificationErrors.push(`Visão Geral: fila de lembretes não ficou segura/ordenada ${JSON.stringify(notificationUi)}`);
    }
    await pause(280);
    await win.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    fs.writeFileSync(path.join(outputDir, 'lead-fixes-notifications-1440x900.png'), (await win.capturePage()).toPNG());
    console.log(JSON.stringify({ outputDir, errors: [...errors, ...notificationErrors], scope: 'notifications-only', notificationUi }, null, 2));
    win.destroy();
    app.exit((errors.length || notificationErrors.length) ? 1 : 0);
    return;
  }

  // Fluxo direcionado para as correções da Base/Scoring/Kanban solicitadas.
  // Mantém a QA curta e determinística quando o harness completo de campanhas
  // não é necessário.
  if (process.env.SIGMA_QA_FIXES_ONLY === '1') {
    const fixErrors = [];
    await win.webContents.executeJavaScript(`localStorage.setItem('sigma_scgroup', 'group-demo'); location.hash = '#scoring';`);
    await pause(520);
    const scoringUi = await win.webContents.executeJavaScript(`(() => {
      const line = document.querySelector('#scCfgLine')?.textContent || '';
      const groupSelect = document.querySelector('#scGroupBtn');
      const groupOptions = [...(groupSelect?.options || [])].map((option) => (option.textContent || '').trim());
      return {
        work: Boolean(document.querySelector('#scWork')),
        groupOptions,
        groupValue: groupSelect?.value || '',
        configLine: line,
        configurePrimary: document.querySelector('#scCfgBtn')?.classList.contains('btn-primary') || false,
        actionLabel: document.querySelector('#scRunBtn')?.textContent?.trim() || '',
        hasActionCount: Boolean(document.querySelector('#scRunN')),
        hasBands: /Faixas|alta ≥|boa ≥|ignorar </.test(line),
      };
    })()`);
    if (!scoringUi.work || !scoringUi.groupOptions.some((label) => /Odontologia/.test(label)) || scoringUi.groupValue !== 'group-demo') {
      fixErrors.push(`Scoring: grupo não ficou selecionável ${JSON.stringify(scoringUi)}`);
    }
    if (!/\bIA\b/.test(scoringUi.configLine) || !/Foco/.test(scoringUi.configLine) || scoringUi.hasBands || !scoringUi.configurePrimary || scoringUi.hasActionCount || !/Analisar grupo|Pausar análise/.test(scoringUi.actionLabel)) {
      fixErrors.push(`Scoring: hierarquia visual não foi simplificada ${JSON.stringify(scoringUi)}`);
    }
    fs.writeFileSync(path.join(outputDir, 'lead-fixes-scoring-1440x900.png'), (await win.capturePage()).toPNG());

    await win.webContents.executeJavaScript(`location.hash = '#kanban';`);
    await pause(760);
    await win.webContents.executeJavaScript(`([...document.querySelectorAll('button')].find((node) => (node.textContent || '').includes('Adicionar lead manualmente')))?.click()`);
    await pause(300);
    await win.webContents.executeJavaScript(`([...document.querySelectorAll('.kanban-manual-source button')].find((node) => (node.textContent || '').includes('Escolher conversa')))?.click()`);
    await pause(220);
    const manualUi = await win.webContents.executeJavaScript(`(() => {
      const modal = document.querySelector('.kanban-manual-lead-modal');
      const selects = [...(modal?.querySelectorAll('.kanban-manual-lead-body select') || [])];
      return {
        open: Boolean(modal),
        chatOptions: [...(selects[0]?.options || [])].filter((option) => option.value).length,
        selectCount: selects.length,
        contactInputs: modal?.querySelectorAll('.kanban-manual-lead-body .field input').length || 0,
        submitDisabled: Boolean(modal?.querySelector('button[type="submit"]')?.disabled),
      };
    })()`);
    if (!manualUi.open || manualUi.chatOptions < 1 || manualUi.selectCount < 2 || manualUi.contactInputs !== 0) {
      fixErrors.push(`Kanban: escolha de conversa ainda exibe campos redundantes ${JSON.stringify(manualUi)}`);
    }
    fs.writeFileSync(path.join(outputDir, 'lead-fixes-manual-conversation-1440x900.png'), (await win.capturePage()).toPNG());

    const moveResult = await win.webContents.executeJavaScript(`(() => {
      const modal = document.querySelector('.kanban-manual-lead-modal');
      const selects = [...(modal?.querySelectorAll('.kanban-manual-lead-body select') || [])];
      const setValue = (node, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(node, value);
        node.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const chat = [...(selects[0]?.options || [])].find((option) => option.value);
      const stage = [...(selects[1]?.options || [])].find((option) => option.value && option.value !== selects[1]?.value);
      if (!modal || !chat || !stage) return { ok: false, reason: 'opção de conversa/etapa ausente' };
      setValue(selects[0], chat.value);
      setValue(selects[1], stage.value);
      return { ok: true, chat: chat.textContent?.trim() || '', stage: stage.value };
    })()`);
    await pause(180);
    const selectionState = await win.webContents.executeJavaScript(`(() => {
      const modal = document.querySelector('.kanban-manual-lead-modal');
      const selects = [...(modal?.querySelectorAll('.kanban-manual-lead-body select') || [])];
      return {
        chatValue: selects[0]?.value || '',
        stageValue: selects[1]?.value || '',
        submitDisabled: Boolean(modal?.querySelector('button[type="submit"]')?.disabled),
        error: modal?.querySelector('[role="alert"]')?.textContent || '',
      };
    })()`);
    await win.webContents.executeJavaScript(`document.querySelector('.kanban-manual-lead-modal button[type="submit"]')?.click()`);
    await pause(950);
    const moveCheck = moveResult?.ok ? await win.webContents.executeJavaScript(`(() => {
      const cards = [...document.querySelectorAll('.kanban-card')];
      const card = cards.find((node) => /Odonto Lume/.test(node.querySelector('.kanban-card-title strong')?.textContent || ''));
      return {
        modalClosed: !document.querySelector('.kanban-manual-lead-modal'),
        movedValue: card?.querySelector('.kanban-card-move select')?.value || '',
        notice: document.querySelector('.kanban-feedback.success')?.textContent || '',
        error: document.querySelector('.kanban-manual-lead-modal [role="alert"]')?.textContent || '',
      };
    })()`) : { modalClosed: false, movedValue: '', notice: '' };
    if (!moveResult?.ok || selectionState.submitDisabled || !moveCheck.modalClosed || moveCheck.movedValue !== moveResult.stage) {
      fixErrors.push(`Kanban: conversa não foi movida para a etapa escolhida ${JSON.stringify({ moveResult, selectionState, moveCheck })}`);
    }

    const report = {
      generatedAt: new Date().toISOString(),
      version: require('../package.json').version,
      scope: 'lead-fixes-only',
      scoringUi,
      manualUi,
      moveResult,
      selectionState,
      moveCheck,
      errors: fixErrors,
      passed: fixErrors.length === 0,
    };
    fs.writeFileSync(path.join(outputDir, 'lead-fixes-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ outputDir, ...report }, null, 2));
    win.destroy();
    app.exit(fixErrors.length ? 1 : 0);
    return;
  }

  for (const route of ['overview', 'scraper', 'base', 'scoring', 'kanban', 'whatsapp', 'dashboard', 'settings']) {
    await win.webContents.executeJavaScript(`location.hash = '#${route}'; window.dispatchEvent(new HashChangeEvent('hashchange'));`);
    const targetLabel = ({ overview: 'visão geral', scraper: 'scraper maps', base: 'base de leads', scoring: 'lead scoring', kanban: 'kanban', whatsapp: 'whatsapp', dashboard: 'dashboard', settings: 'configurações' })[route];
    const navResult = await win.webContents.executeJavaScript(`(() => {
      const item = [...document.querySelectorAll('.app-sidebar .nav-item')]
        .find((node) => (node.textContent || '').toLowerCase().includes(${JSON.stringify(targetLabel)}));
      if (item) item.click();
      return { found: !!item, title: item?.textContent?.trim() || '' };
    })()`);
    await pause(route === 'scraper' || route === 'kanban' || route === 'whatsapp' ? 1200 : 600);
    if (route === 'whatsapp') {
      await win.webContents.executeJavaScript(`document.querySelector('.chat-thread')?.click()`);
      await pause(300);
    }
    const diagnostic = await win.webContents.executeJavaScript(`(() => {
      const view = document.querySelector('.view-transition');
      const child = view?.firstElementChild;
      const rect = (node) => node ? Object.fromEntries(['x','y','width','height'].map((key) => [key, Math.round(node.getBoundingClientRect()[key])])) : null;
      const flow = document.querySelector('.ls-open-design-steps');
      const visibleOverlays = [...document.querySelectorAll('.overlay, .modal-overlay, [class*="backdrop"]')]
        .filter((node) => { const style = getComputedStyle(node); const box = node.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0; })
        .map((node) => node.id || node.className || node.tagName);
      return { active: document.querySelector('.app-sidebar .nav-item.active')?.textContent?.trim(), view: rect(view), child: rect(child), visibleOverlays, flow: rect(flow), flowDisplay: flow ? getComputedStyle(flow).display : null, childClass: child?.className || '', text: (child?.innerText || '').slice(0, 80) };
    })()`);
    const image = await win.capturePage();
    const file = path.join(outputDir, `${route}-1440x900.png`);
    fs.writeFileSync(file, image.toPNG());
    console.log(`[capture] ${route}: ${navResult.found ? 'ok' : 'fallback'} ${JSON.stringify(diagnostic)} -> ${file}`);
  }

  if (process.env.SIGMA_QA_ROUTES_ONLY === '1') {
    console.log(JSON.stringify({ outputDir, errors, scope: 'routes-only' }, null, 2));
    win.destroy();
    app.exit(errors.length ? 1 : 0);
    return;
  }

  const navigateTo = async (label, wait = 450) => {
    const found = await win.webContents.executeJavaScript(`(() => {
      const item = [...document.querySelectorAll('.app-sidebar .nav-item')]
        .find((node) => (node.textContent || '').toLowerCase().includes(${JSON.stringify(label)}));
      item?.click();
      return Boolean(item);
    })()`);
    if (!found) errors.push(`Navegação de modal não encontrou: ${label}`);
    await pause(wait);
  };

  const captureModal = async (name, openScript, selector) => {
    await win.webContents.executeJavaScript(`(() => {
      ${openScript}
    })()`);
    await pause(220);
    const opened = await win.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    if (!opened) {
      errors.push(`Modal não abriu: ${name}`);
      return;
    }
    const modalRect = await win.webContents.executeJavaScript(`(() => { const node = document.querySelector(${JSON.stringify(selector)})?.querySelector('[role="dialog"], .modal, .cmdk, .camp-wizard, .sigma-campaign-dialog'); if (!node) return null; const rect = node.getBoundingClientRect(); return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height), display: getComputedStyle(node).display }; })()`);
    if (name === 'qr-modal') {
      const qrDiagnostic = await win.webContents.executeJavaScript(`(() => { const node = document.querySelector('.wa-qr'); const cell = node?.querySelector('i.on'); if (!node) return null; const style = getComputedStyle(node); const cellStyle = cell ? getComputedStyle(cell) : null; const box = node.getBoundingClientRect(); const cellBox = cell?.getBoundingClientRect(); return { box: { width: Math.round(box.width), height: Math.round(box.height) }, aspectRatio: style.aspectRatio, gridRows: style.gridTemplateRows, alignItems: style.alignItems, cell: cellBox ? { width: Math.round(cellBox.width), height: Math.round(cellBox.height), background: cellStyle.backgroundColor } : null }; })()`);
      console.log(`[capture] qr ${JSON.stringify(qrDiagnostic)}`);
    }
    fs.writeFileSync(path.join(outputDir, `${name}-1440x900.png`), (await win.capturePage()).toPNG());
    console.log(`[capture] modal ${name} ${JSON.stringify(modalRect)} -> ${path.join(outputDir, `${name}-1440x900.png`)}`);
    await win.webContents.executeJavaScript(`(() => {
      const target = document.querySelector(${JSON.stringify(selector)});
      target?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    })()`);
    await pause(120);
  };

  await navigateTo('visão geral');
  await captureModal('busca-global-modal', `document.querySelector('.header-search-wrap')?.click();`, '#cmdkOv');
  await captureModal('nova-extracao-modal', `document.querySelector('.btn-new-extraction')?.click();`, '.modal-overlay');

  // Distrito Federal precisa aparecer como opção explícita e o detalhamento
  // da extração deve refletir bairros reais, não um texto estático.
  await win.webContents.executeJavaScript(`document.querySelector('.btn-new-extraction')?.click()`);
  await pause(140);
  await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('#wzNicho');
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Dentistas');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('.ac-item')].find((node) => (node.textContent || '').includes('Dentistas'))?.click();
  })()`);
  await pause(140);
  await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('#wzCidade');
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'DF');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await pause(140);
  let dfSuggestion = false;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    dfSuggestion = await win.webContents.executeJavaScript(`(() => [...document.querySelectorAll('.ac-item')].map((node) => node.textContent || '').some((text) => text.includes('Distrito Federal') && text.includes('DF')))()`);
    if (dfSuggestion) break;
    await pause(200);
  }
  if (!dfSuggestion) errors.push('Nova extração: Distrito Federal (DF) não apareceu nas sugestões');
  fs.writeFileSync(path.join(outputDir, 'nova-extracao-df-1440x900.png'), (await win.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`([...document.querySelectorAll('.ac-item')].find((node) => (node.textContent || '').includes('Distrito Federal') && (node.textContent || '').includes('DF')))?.click()`);
  await pause(120);
  for (const neighborhood of ['Asa Sul', 'Asa Norte']) {
    await win.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('#wzBairro');
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(neighborhood)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      [...document.querySelectorAll('.hood-add button')].find((node) => (node.textContent || '').includes('Adicionar'))?.click();
    })()`);
    await pause(80);
  }
  await win.webContents.executeJavaScript(`([...document.querySelectorAll('.modal-foot button')].find((node) => (node.textContent || '').includes('Iniciar extração')))?.click()`);
  await pause(560);
  const progressDetailAvailable = await win.webContents.executeJavaScript(`Boolean(document.querySelector('[data-od-id="scraper-progress-info"]'))`);
  if (!progressDetailAvailable) errors.push('Scraper: ícone de detalhes da extração não apareceu');
  await win.webContents.executeJavaScript(`document.querySelector('[data-od-id="scraper-progress-info"]')?.click()`);
  await pause(120);
  const progressDetail = await win.webContents.executeJavaScript(`(() => ({
    open: Boolean(document.querySelector('.map-progress-detail')),
    found: document.querySelector('.map-progress-stats b')?.textContent || '',
    text: document.querySelector('.map-progress-detail')?.textContent || '',
    liveFeed: document.querySelector('#feedCount')?.textContent || '',
    liveCard: document.querySelector('.lead-live')?.textContent || '',
  }))()`);
  if (!progressDetail.open || !/Asa Sul|Asa Norte/.test(progressDetail.text)) errors.push(`Scraper: detalhe por bairro inválido ${JSON.stringify(progressDetail)}`);
  if (!/chegando agora/i.test(progressDetail.liveFeed) || !/ao vivo/i.test(progressDetail.liveCard) || /\bFound\b|\bExtracting\b/i.test(progressDetail.text)) {
    errors.push(`Scraper: lead ao vivo ou logs em português inválidos ${JSON.stringify(progressDetail)}`);
  }
  fs.writeFileSync(path.join(outputDir, 'scraper-progresso-detalhado-1440x900.png'), (await win.capturePage()).toPNG());
  await pause(2200);

  await navigateTo('base de leads');
  await captureModal('importar-leads-modal', `(() => {
    const input = document.querySelector('[data-od-id="base-import"]')?.previousElementSibling;
    if (!input || input.type !== 'file') return;
    const csv = new File(['Empresa;Nicho;Cidade;Estado;Telefone\\nClÃ­nica QA;Dermatologia;BrasÃ­lia;DF;+55 61 99999-0000'], 'leads-qa.csv', { type: 'text/csv;charset=utf-8' });
    const transfer = new DataTransfer();
    transfer.items.add(csv);
    Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, '.modal-overlay');
  await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('[data-od-id="base-import"]')?.previousElementSibling;
    if (!input || input.type !== 'file') return;
    const binary = atob(${JSON.stringify(qaXlsxBase64)});
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'leads-qa.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await pause(320);
  const xlsxPreview = await win.webContents.executeJavaScript(`(() => ({
    open: Boolean(document.querySelector('.import-file-summary')),
    text: document.querySelector('.import-preview-list')?.textContent || '',
  }))()`);
  if (!xlsxPreview.open || !/Consultório QA/.test(xlsxPreview.text)) errors.push(`Base: prévia XLSX inválida ${JSON.stringify(xlsxPreview)}`);
  await win.webContents.executeJavaScript(`document.querySelector('.modal-overlay')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await pause(100);
  await captureModal('exportar-leads-modal', `([...document.querySelectorAll('button')].find((node) => (node.textContent || '').trim() === 'Exportar'))?.click();`, '.overlay.on');
  await win.webContents.executeJavaScript(`document.querySelector('.base-leads-view tbody .rowcheck')?.click()`);
  await pause(100);
  await captureModal('criar-grupo-modal', `([...document.querySelectorAll('.selbar button')].find((node) => (node.textContent || '').includes('Criar grupo')))?.click();`, '.overlay.on');

  // Criar grupo precisa permitir filtrar a base, não só usar a seleção.
  await win.webContents.executeJavaScript(`([...document.querySelectorAll('.selbar button')].find((node) => (node.textContent || '').includes('Criar grupo')))?.click()`);
  await pause(160);
  const groupFilterPanel = await win.webContents.executeJavaScript(`(() => {
    const modal = document.querySelector('.overlay.on .modal');
    const filterTab = [...(modal?.querySelectorAll('.grp-modes button') || [])].find((node) => (node.textContent || '').includes('Filtrar a base'));
    filterTab?.click();
    return { modes: modal?.querySelectorAll('.grp-modes button').length || 0, hasTab: Boolean(filterTab) };
  })()`);
  await pause(160);
  const groupFilterUi = await win.webContents.executeJavaScript(`(() => {
    const modal = document.querySelector('.overlay.on .modal');
    const presets = [...(modal?.querySelectorAll('.grp-presets .grp-chip') || [])];
    const label = (node) => (node.textContent || '').trim();
    const before = modal?.querySelector('[data-od-id="group-preview"]')?.innerText || '';
    presets.find((node) => label(node).includes('Sem site'))?.click();
    return { presets: presets.map(label), channels: modal?.querySelectorAll('.grp-channel').length || 0, before };
  })()`);
  await pause(160);
  const groupFilterResult = await win.webContents.executeJavaScript(`(() => {
    const modal = document.querySelector('.overlay.on .modal');
    const selected = modal?.querySelector('.grp-presets .grp-chip.on');
    const preview = modal?.querySelector('[data-od-id="group-preview"]')?.innerText || '';
    const createButton = [...(modal?.querySelectorAll('.modal-foot button') || [])].find((node) => (node.textContent || '').includes('Criar grupo com'));
    return { selected: (selected?.textContent || '').trim(), preview, createLabel: (createButton?.textContent || '').trim(), disabled: Boolean(createButton?.disabled) };
  })()`);
  if (!groupFilterPanel.hasTab || groupFilterUi.presets.length < 4 || groupFilterUi.channels < 4) {
    errors.push(`Grupo: filtros ausentes ${JSON.stringify({ ...groupFilterPanel, ...groupFilterUi })}`);
  }
  if (!/Sem site/i.test(groupFilterResult.selected) || !/lead\(s\) entram neste grupo/i.test(groupFilterResult.preview)) {
    errors.push(`Grupo: filtro "Sem site" não refletiu na prévia ${JSON.stringify(groupFilterResult)}`);
  }
  fs.writeFileSync(path.join(outputDir, 'criar-grupo-filtros-1440x900.png'), (await win.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.querySelector('.overlay.on')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await pause(120);

  // O grupo criado na Base precisa chegar ao serviço — é o que faz ele aparecer
  // no Lead Scoring e no assistente de campanha.
  const groupSynced = await (async () => {
    await win.webContents.executeJavaScript(`window.dispatchEvent(new Event('sigma:groups-updated'))`);
    await pause(80);
    await win.webContents.executeJavaScript(`([...document.querySelectorAll('.selbar button')].find((node) => (node.textContent || '').includes('Criar grupo')))?.click()`);
    await pause(140);
    await win.webContents.executeJavaScript(`(() => {
      const modal = document.querySelector('.overlay.on .modal');
      const input = modal?.querySelector('#grpName');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'QA sem site');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      [...(modal?.querySelectorAll('.grp-modes button') || [])].find((node) => (node.textContent || '').includes('Filtrar a base'))?.click();
    })()`);
    await pause(140);
    await win.webContents.executeJavaScript(`(() => {
      const modal = document.querySelector('.overlay.on .modal');
      [...(modal?.querySelectorAll('.grp-presets .grp-chip') || [])].find((node) => (node.textContent || '').includes('Sem site'))?.click();
    })()`);
    await pause(140);
    await win.webContents.executeJavaScript(`(() => {
      const modal = document.querySelector('.overlay.on .modal');
      [...(modal?.querySelectorAll('.modal-foot button') || [])].find((node) => (node.textContent || '').includes('Criar grupo'))?.click();
    })()`);
    await pause(320);
    return win.webContents.executeJavaScript(`(async () => {
      const res = await window.leadScoringAPI.listGroups();
      const group = (res?.groups || []).find((item) => item.name === 'QA sem site');
      return { found: Boolean(group), members: (group?.leadIds || []).length, listed: (res?.groups || []).length };
    })()`);
  })();
  if (!groupSynced.found || groupSynced.members < 1) {
    errors.push(`Grupo da Base não chegou ao serviço de scoring ${JSON.stringify(groupSynced)}`);
  }

  await win.webContents.executeJavaScript(`document.querySelector('.overlay.on')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await pause(100);

  await captureModal('adicionar-grupo-modal', `([...document.querySelectorAll('.selbar button')].find((node) => (node.textContent || '').includes('Adicionar a grupo')))?.click();`, '.overlay.on');
  await captureModal('detalhe-lead-modal', `document.querySelector('.base-leads-view tbody td b')?.click();`, '.overlay.on');

  // A aba Scoring da Base precisa mostrar o score real, casado por identidade
  // (o serviço salva com id próprio, diferente do id da base). O lead usado é
  // o "Odonto Lume", que tem score no fixture — os demais seguem sem análise.
  const baseScoringTab = await win.webContents.executeJavaScript(`(() => {
    const cell = [...document.querySelectorAll('.base-leads-view tbody td b')]
      .find((node) => (node.textContent || '').includes('Odonto Lume'))
      || document.querySelector('.base-leads-view tbody td b');
    cell?.click();
    return Boolean(cell);
  })()`);
  if (!baseScoringTab) errors.push('Base de leads: detalhe do lead não abriu para checar scoring');
  await pause(200);
  await win.webContents.executeJavaScript(`([...document.querySelectorAll('.ltabs button')].find((node) => (node.textContent || '').includes('Scoring')))?.click()`);
  await pause(160);
  const baseScoringPanel = await win.webContents.executeJavaScript(`(() => {
    const body = document.querySelector('.modal-body');
    const text = body?.innerText || '';
    return { text, hasScore: /82/.test(text), hasBand: /Alta/.test(text) };
  })()`);
  if (!baseScoringPanel.hasScore || !baseScoringPanel.hasBand) {
    errors.push(`Base de leads: aba Scoring sem score real ${JSON.stringify({ hasScore: baseScoringPanel.hasScore, hasBand: baseScoringPanel.hasBand, text: baseScoringPanel.text.slice(0, 160) })}`);
  }
  await win.webContents.executeJavaScript(`document.querySelector('.modal-foot button')?.click()`);
  await pause(120);

  await navigateTo('lead scoring');
  // O grupo criado na Base precisa estar listado aqui, com membros reais.
  const scoringGroupList = await win.webContents.executeJavaScript(`(() => {
    const select = document.querySelector('#scGroupPick, #scGroupBtn, .ls-open-design-step select');
    const options = [...(select?.options || [])].map((option) => ({ value: option.value, label: (option.textContent || '').trim() }));
    return { options, hasGroup: options.some((option) => /QA sem site/.test(option.label)) };
  })()`);
  if (!scoringGroupList.hasGroup) {
    errors.push(`Lead scoring: grupo da base não apareceu na lista ${JSON.stringify(scoringGroupList.options)}`);
  }
  await win.webContents.executeJavaScript(`(() => { const select = document.querySelector('#scGroupPick, #scGroupBtn, .ls-open-design-step select'); const option = [...(select?.options || [])].find((item) => item.value); if (select && option) { select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); } })()`);
  await pause(180);
  const scoringRows = await win.webContents.executeJavaScript(`(() => {
    const rows = [...document.querySelectorAll('#scResults tbody tr')];
    const scoreCells = rows.map((row) => row.querySelector('td:nth-child(3)')?.textContent?.trim() || '');
    return { rows: rows.length, scores: scoreCells, text: document.querySelector('#scResults')?.innerText || '' };
  })()`);
  if (!/82/.test(scoringRows.text) || !/45/.test(scoringRows.text)) {
    errors.push(`Lead scoring: score do serviço não apareceu na tabela ${JSON.stringify(scoringRows.scores)}`);
  }
  await captureModal('configurar-ia-modal', `document.querySelector('#scCfgBtn')?.click();`, '#aiCfgOv');
  const scoreRules = await win.webContents.executeJavaScript(`(() => ({
    fields: document.querySelectorAll('#scRules .sc-rule-field').length,
    highFrom: document.querySelector('#scRules .sc-rule-field input')?.value || '',
    autoToggle: Boolean(document.querySelector('.sc-toggle input')),
    configLine: document.querySelector('#scCfgLine')?.textContent || '',
    configurePrimary: document.querySelector('#scCfgBtn')?.classList.contains('btn-primary') || false,
    actionLabel: document.querySelector('#scRunBtn')?.textContent?.trim() || '',
  }))()`);
  if (
    scoreRules.fields < 6
    || scoreRules.highFrom !== '75'
    || !scoreRules.autoToggle
    || !/\bIA\b/.test(scoreRules.configLine)
    || !/\bFoco\b/.test(scoreRules.configLine)
    || /alta ≥|boa ≥|ignorar </.test(scoreRules.configLine)
    || !scoreRules.configurePrimary
    || !/Analisar grupo|Pausar análise/.test(scoreRules.actionLabel)
  ) {
    errors.push(`Lead scoring: regras do score incompletas ${JSON.stringify(scoreRules)}`);
  }
  await captureModal('detalhe-scoring-modal', `document.querySelector('#scResults tbody td b')?.click();`, '.overlay.on');

  await navigateTo('kanban', 900);
  const globalKanban = await win.webContents.executeJavaScript(`(() => ({
    board: Boolean(document.querySelector('[data-od-id="global-kanban"]')),
    columns: document.querySelectorAll('.kanban-column').length,
    cards: document.querySelectorAll('.kanban-card').length,
    settings: Boolean([...document.querySelectorAll('button')].find((node) => (node.textContent || '').includes('Configurar Kanban'))),
  }))()`);
  if (!globalKanban.board || globalKanban.columns < 3 || globalKanban.cards < 3 || !globalKanban.settings) {
    errors.push(`Kanban geral não renderizou corretamente: ${JSON.stringify(globalKanban)}`);
  }
  fs.writeFileSync(path.join(outputDir, 'kanban-geral-1440x900.png'), (await win.capturePage()).toPNG());
  const globalMove = await win.webContents.executeJavaScript(`(() => {
    const select = document.querySelector('.kanban-card-move select');
    const card = select?.closest('.kanban-card');
    const name = card?.querySelector('.kanban-card-title strong')?.textContent || '';
    const next = [...(select?.options || [])].find((option) => option.value !== select.value)?.value;
    if (!select || !next) return null;
    select.value = next;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return { name, next };
  })()`);
  await pause(320);
  const globalMovePersisted = globalMove && await win.webContents.executeJavaScript(`(() => {
    const cards = [...document.querySelectorAll('.kanban-card')];
    const card = cards.find((node) => node.querySelector('.kanban-card-title strong')?.textContent === ${JSON.stringify(globalMove.name)});
    return card?.querySelector('.kanban-card-move select')?.value === ${JSON.stringify(globalMove.next)};
  })()`);
  if (!globalMove || !globalMovePersisted) errors.push('Kanban geral: movimento manual não persistiu visualmente');
  await win.webContents.executeJavaScript(`([...document.querySelectorAll('button')].find((node) => (node.textContent || '').includes('Configurar Kanban')))?.click()`);
  await pause(180);
  const automationPanel = await win.webContents.executeJavaScript(`(() => ({
    level: Boolean(document.querySelector('.kanban-settings-modal .kanban-level-card')),
    recipes: document.querySelectorAll('.kanban-settings-modal .kanban-recipe').length,
    badges: document.querySelectorAll('.kanban-settings-modal .kanban-badge').length,
    simpleRows: document.querySelectorAll('.kanban-settings-modal .kanban-simple-row').length,
    simpleConfigured: [...document.querySelectorAll('.kanban-settings-modal .kanban-simple-row select')].filter((node) => node.value).length,
  }))()`);
  if (!automationPanel.level || automationPanel.recipes < 4 || automationPanel.badges < 4 || automationPanel.simpleRows !== 4 || automationPanel.simpleConfigured !== 4) {
    errors.push(`Kanban geral: painel de automação incompleto ${JSON.stringify(automationPanel)}`);
  }
  const recipeApplied = await win.webContents.executeJavaScript(`(() => {
    const recipe = document.querySelector('.kanban-settings-modal .kanban-recipe:not(.done)');
    recipe?.click();
    return Boolean(recipe);
  })()`);
  await pause(120);
  if (!recipeApplied) errors.push('Kanban geral: atalho de automação não aplicado');
  await win.webContents.executeJavaScript(`([...document.querySelectorAll('.kanban-settings-modal button')].find((node) => (node.textContent || '').includes('Regra do zero')))?.click()`);
  await pause(100);
  const ruleEditorVisible = await win.webContents.executeJavaScript(`document.querySelectorAll('.kanban-settings-modal .kanban-rule-editor').length === 1`);
  if (!ruleEditorVisible) errors.push('Kanban geral: regra de negócio não foi adicionada');
  fs.writeFileSync(path.join(outputDir, 'kanban-configuracao-1440x900.png'), (await win.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`([...document.querySelectorAll('.kanban-settings-modal button')].find((node) => (node.textContent || '').includes('Salvar Kanban')))?.click()`);
  await pause(260);
  const ruleSaved = await win.webContents.executeJavaScript(`document.querySelectorAll('.kanban-rule-editor').length === 0 && /Kanban salvo/i.test(document.body.innerText)`);
  if (!ruleSaved) errors.push('Kanban geral: regra/configuração não foi salva');
  const activityPanel = await win.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('.kanban-actions button')].find((node) => (node.textContent || '').includes('Histórico'));
    button?.click();
    return Boolean(button);
  })()`);
  await pause(140);
  const activityVisible = await win.webContents.executeJavaScript(`Boolean(document.querySelector('.kanban-activity'))`);
  if (!activityPanel || !activityVisible) errors.push('Kanban geral: histórico de atividade não abriu');
  await captureModal('configurar-kanban-modal', `([...document.querySelectorAll('button')].find((node) => (node.textContent || '').includes('Configurar Kanban')))?.click();`, '.kanban-modal-overlay');
  await captureModal('kanban-negocio-modal', `document.querySelector('.kanban-card')?.click();`, '.kanban-modal-overlay');

  // Venda registrada pela interface precisa mover o card e alimentar a receita.
  await win.webContents.executeJavaScript(`document.querySelector('.kanban-card')?.click()`);
  await pause(140);
  await win.webContents.executeJavaScript(`(() => {
    const box = document.querySelector('.kanban-deal-box');
    const selects = box?.querySelectorAll('select') || [];
    const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    if (selects[0]) {
      selectSetter.call(selects[0], 'won');
      selects[0].dispatchEvent(new Event('change', { bubbles: true }));
    }
  })()`);
  await pause(100);
  await win.webContents.executeJavaScript(`(() => {
    const valueInput = document.querySelector('.kanban-deal-box input[inputmode="decimal"]');
    const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    if (valueInput) {
      inputSetter.call(valueInput, '1250,50');
      valueInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`);
  await pause(100);
  await win.webContents.executeJavaScript(`([...document.querySelectorAll('.kanban-modal-foot button')].find((node) => (node.textContent || '').includes('Salvar negócio')))?.click()`);
  await pause(260);
  const savedDeal = await win.webContents.executeJavaScript(`(() => ({
    notice: document.body.innerText,
    outcome: document.querySelector('.kanban-deal-box select')?.value || '',
    value: document.querySelector('.kanban-deal-box input[inputmode="decimal"]')?.value || '',
  }))()`);
  if (!/Venda registrada/i.test(savedDeal.notice) || savedDeal.outcome !== 'won' || !/1\.250,50|1250,50/.test(savedDeal.value)) {
    errors.push(`Kanban geral: venda não foi salva pela interface ${JSON.stringify(savedDeal)}`);
  }
  await win.webContents.executeJavaScript(`document.querySelector('.kanban-modal-overlay')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await pause(100);
  await navigateTo('visão geral', 520);
  const revenueSummary = await win.webContents.executeJavaScript(`(() => {
    const strip = document.querySelector('.overview-deal-strip');
    return { present: Boolean(strip), text: strip?.innerText || '' };
  })()`);
  if (!revenueSummary.present || !/1\.250,50/.test(revenueSummary.text) || !/Vendas fechadas\s*1/i.test(revenueSummary.text)) {
    errors.push(`Visão Geral: receita da venda não apareceu ${JSON.stringify(revenueSummary)}`);
  }
  fs.writeFileSync(path.join(outputDir, 'overview-venda-1440x900.png'), (await win.capturePage()).toPNG());

  // O bloco de WhatsApp é o mais sensível a tempo (wizard + QR) e já tem
  // cobertura própria. Em iterações de Kanban/Base/Scoring, pule-o para
  // fechar o relatório sem depender de animações do wizard.
  const skipWhatsApp = process.env.SIGMA_QA_SKIP_WHATSAPP === '1';
  if (!skipWhatsApp) {
  await navigateTo('whatsapp', 800);
  await captureModal('nova-conversa-modal', `document.querySelector('[data-od-id="wa-new-chat"]')?.click();`, '#chatOv');
  await captureModal('nova-campanha-modal', `document.querySelector('[data-od-id="wa-new-campaign"]')?.click();`, '.camp-wizard-backdrop');
  await captureModal('campanhas-modal', `document.querySelector('[data-od-id="wa-sigma-campaigns"]')?.click();`, '.sigma-campaign-overlay');
  await win.webContents.executeJavaScript(`document.querySelector('[data-od-id="wa-account-selector"]')?.click()`);
  await pause(100);
  await captureModal('conexoes-modal', `([...document.querySelectorAll('.wa-menu button')].find((node) => (node.textContent || '').includes('Gerenciar conexões')))?.click();`, '#connOv');
  await win.webContents.executeJavaScript(`document.querySelector('[data-od-id="wa-session-menu"]')?.click()`);
  await pause(100);
  await captureModal('perfil-modal', `([...document.querySelectorAll('.wa-menu button')].find((node) => (node.textContent || '').includes('Meu perfil')))?.click();`, '#profileOv');
  await win.webContents.executeJavaScript(`document.querySelector('[data-od-id="wa-session-menu"]')?.click()`);
  await pause(100);
  await captureModal('qr-modal', `([...document.querySelectorAll('.wa-menu button')].find((node) => (node.textContent || '').includes('Trocar número')))?.click();`, '#qrOv');
  await win.webContents.executeJavaScript(`document.querySelector('.chat-thread')?.click()`);
  await pause(250);
  await win.webContents.executeJavaScript(`document.querySelector('.chat-bubble-action-btn[title="Mais"]')?.click()`);
  await pause(100);
  await captureModal('encaminhar-modal', `([...document.querySelectorAll('.chat-msg-menu button')].find((node) => (node.textContent || '').includes('Encaminhar')))?.click();`, '#fwdOv');
  // Error handling: failures must stay inside the current flow and explain recovery.
  fixtureFailureState.startChat = true;
  await win.webContents.executeJavaScript(`document.querySelector('[data-od-id="wa-new-chat"]')?.click()`);
  await pause(150);
  await win.webContents.executeJavaScript(`document.querySelector('#chatOv .wa-newchat button')?.click()`);
  await pause(180);
  const newChatError = await win.webContents.executeJavaScript(`document.querySelector('#chatOv .field-err')?.textContent || ''`);
  if (!/Falha controlada/i.test(newChatError)) errors.push('Erro de nova conversa não ficou visível no modal');
  fs.writeFileSync(path.join(outputDir, 'error-nova-conversa-1440x900.png'), (await win.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.querySelector('#chatOv')?.click()`);
  fixtureFailureState.startChat = false;

  fixtureFailureState.connect = true;
  await win.webContents.executeJavaScript(`document.querySelector('[data-od-id="wa-session-menu"]')?.click()`);
  await pause(80);
  await win.webContents.executeJavaScript(`([...document.querySelectorAll('.wa-menu button')].find((node) => (node.textContent || '').includes('Trocar número')))?.click()`);
  await pause(180);
  const qrFailure = await win.webContents.executeJavaScript(`document.querySelector('#qrOv .field-err')?.textContent || ''`);
  if (!/Não foi possível gerar o QR/i.test(qrFailure)) errors.push('Erro de QR não ficou visível no modal');
  fs.writeFileSync(path.join(outputDir, 'error-qr-1440x900.png'), (await win.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.querySelector('#qrOv')?.click()`);
  fixtureFailureState.connect = false;

  fixtureFailureState.createCampaign = true;
  await win.webContents.executeJavaScript(`document.querySelector('[data-od-id="wa-new-campaign"]')?.click()`);
  await pause(450);
  for (let step = 0; step < 4; step += 1) {
    await win.webContents.executeJavaScript(`document.querySelector('.camp-wizard-footer .btn-primary')?.click()`);
    await pause(180);
  }
  const campaignFailure = await win.webContents.executeJavaScript(`document.querySelector('.camp-alert.error')?.textContent || ''`);
  if (!/Falha controlada/i.test(campaignFailure)) errors.push('Erro de campanha não ficou visível no wizard');
  fs.writeFileSync(path.join(outputDir, 'error-campanha-1440x900.png'), (await win.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.querySelector('.camp-wizard-backdrop')?.click()`);
  fixtureFailureState.createCampaign = false;
  await pause(150);

  await win.webContents.executeJavaScript(`([...document.querySelectorAll('.app-sidebar .nav-item')].find((node) => (node.textContent || '').toLowerCase().includes('whatsapp')))?.click()`);
  await pause(600);
  await win.webContents.executeJavaScript(`([...document.querySelectorAll('.wa-open-design-actions button')].find((node) => (node.textContent || '').includes('Campanhas')))?.click()`);
  await pause(250);
  fs.writeFileSync(path.join(outputDir, 'whatsapp-campaigns-1440x900.png'), (await win.capturePage()).toPNG());
  const kanbanOpened = await win.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('.camp-card-actions button')]
      .find((node) => (node.textContent || '').includes('Kanban'));
    button?.click();
    return !!button;
  })()`);
  if (!kanbanOpened) errors.push('Kanban: botão não encontrado');
  await pause(250);
  const kanbanDiagnostic = await win.webContents.executeJavaScript(`(() => ({
    board: !!document.querySelector('.campaign-kanban-layer'),
    columns: [...document.querySelectorAll('.campaign-kanban-column')].map((column) => ({
      stage: [...column.classList].find((name) => name.startsWith('stage-')),
      cards: column.querySelectorAll('.campaign-kanban-card').length,
    })),
  }))()`);
  if (!kanbanDiagnostic.board || kanbanDiagnostic.columns.length !== 3) {
    errors.push('Kanban: painel ou três etapas não renderizados');
  }
  fs.writeFileSync(path.join(outputDir, 'whatsapp-campaign-kanban-1440x900.png'), (await win.capturePage()).toPNG());
  const moved = await win.webContents.executeJavaScript(`(() => {
    const select = [...document.querySelectorAll('.campaign-kanban-card select')]
      .find((node) => node.value === 'new');
    if (!select) return false;
    select.value = 'conversation';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!moved) errors.push('Kanban: seletor de movimento não encontrado');
  await pause(250);
  const movedCount = await win.webContents.executeJavaScript(`document.querySelectorAll('.campaign-kanban-column.stage-conversation .campaign-kanban-card').length`);
  if (moved && movedCount !== 2) errors.push(`Kanban: movimento não persistiu (esperado 2, recebido ${movedCount})`);
  await win.webContents.executeJavaScript(`document.querySelector('.campaign-kanban-header .btn-secondary')?.click()`);
  await pause(150);
  await win.webContents.executeJavaScript(`document.querySelector('.sigma-campaign-dialog .btn-primary')?.click()`);
  await pause(350);
  fs.writeFileSync(path.join(outputDir, 'whatsapp-campaign-wizard-1440x900.png'), (await win.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.querySelector('.camp-wizard-close')?.click()`);
  await win.webContents.executeJavaScript(`document.querySelector('.sigma-campaign-head-actions .wa-icon-button')?.click()`);
  fixtureConnectionState.connected = false;
  await win.webContents.executeJavaScript(`([...document.querySelectorAll('.app-sidebar .nav-item')].find((node) => (node.textContent || '').toLowerCase().includes('base de leads')))?.click()`);
  await pause(700);
  await win.webContents.executeJavaScript(`([...document.querySelectorAll('.app-sidebar .nav-item')].find((node) => (node.textContent || '').toLowerCase().includes('whatsapp')))?.click()`);
  await pause(1200);
  const offlineWizardOpened = await win.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('.wa-open-design-actions button')]
      .find((node) => (node.textContent || '').includes('Nova campanha'));
    button?.click();
    return !!button;
  })()`);
  if (!offlineWizardOpened) errors.push('Rascunho offline: botão Nova campanha não encontrado');
  await pause(250);
  const offlineDraftVisible = await win.webContents.executeJavaScript(`!!document.querySelector('.camp-alert')`);
  if (!offlineDraftVisible) errors.push('Rascunho offline: aviso de conexão não renderizado');
  fs.writeFileSync(path.join(outputDir, 'whatsapp-campaign-offline-draft-1440x900.png'), (await win.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.querySelector('.camp-wizard-close')?.click()`);
  await win.webContents.executeJavaScript(`document.querySelector('.sigma-campaign-head-actions .wa-icon-button')?.click()`);
  }

  // Regressão do mapa: todos os leads com coordenada devem ter marcador, sem
  // corte invisível em 100 itens; registros antigos também são normalizados.
  await navigateTo('scraper maps', 900);
  await win.webContents.executeJavaScript(`(() => {
    const base = ${JSON.stringify(fixtureLeads)};
    const stress = Array.from({ length: 125 }, (_, index) => ({
      id: 'map-stress-' + index,
      name: 'Lead de mapa ' + index,
      category: 'Teste',
      address: index === 0 ? '\\uE0C8Rua São João, 10, Rio de Janeiro, RJ' : 'Rua de teste, ' + (index + 1) + ', Rio de Janeiro, RJ',
      city: 'Rio de Janeiro',
      state: 'RJ',
      latitude: -22.98 + (index % 20) * 0.0001,
      longitude: -43.20 + (index % 20) * 0.0001,
      coordSource: 'poi',
    }));
    localStorage.setItem('sigma_leads', JSON.stringify([...base, ...stress, ...Array.from({ length: 29 }, (_, index) => ({
      id: 'map-dirty-no-coords-' + index,
      name: 'Endereco antigo sem coordenada ' + index,
      category: 'Teste',
      address: '\\uE0C8Rua Sao Joao, ' + (12 + index) + ', Rio de Janeiro, RJ',
      city: 'Rio de Janeiro',
      state: 'RJ',
    })), {
      id: 'map-dirty-no-coords',
      name: 'Endereço antigo sem coordenada',
      category: 'Teste',
      address: '\\uE0C8Rua São João, 11, Rio de Janeiro, RJ',
      city: 'Rio de Janeiro',
      state: 'RJ',
    }]));
    window.dispatchEvent(new Event('sigma:leads-updated'));
  })()`);
  await pause(1300);
  const mapStress = await win.webContents.executeJavaScript(`(() => {
    const saved = JSON.parse(localStorage.getItem('sigma_leads') || '[]');
    return {
      markers: document.querySelectorAll('#realMap .lp').length,
      dirtyAddress: saved.find((lead) => lead.id === 'map-dirty-no-coords')?.address || '',
      dirtyAddressRepaired: saved.find((lead) => lead.id === 'map-dirty-no-coords')?.needsMapAddressRepair === false,
      repairedDirtyAddresses: saved.filter((lead) => String(lead.id || '').startsWith('map-dirty-no-coords')).filter((lead) => lead.needsMapAddressRepair === false && Number.isFinite(Number(lead.latitude)) && Number.isFinite(Number(lead.longitude))).length,
      repairRequests: ${fixtureMapRepairRequests},
      map: (() => { const node = document.querySelector('#realMap'); const box = node?.getBoundingClientRect(); return box ? { width: Math.round(box.width), height: Math.round(box.height) } : null; })(),
    };
  })()`);
  if (mapStress.markers < 158) errors.push(`Mapa: corte de marcadores detectado (${mapStress.markers}/158)`);
  if (/^[\s\p{Cc}\p{Cf}\p{Co}\u{1F4CD}\u{FE0E}\u{FE0F}]/u.test(mapStress.dirtyAddress)) errors.push('Mapa: endereço antigo com prefixo especial não foi corrigido');
  if (!mapStress.dirtyAddressRepaired || mapStress.repairedDirtyAddresses < 30 || mapStress.repairRequests < 30) errors.push('Mapa: lote completo de endereços antigos sem coordenadas não foi reparado');
  fs.writeFileSync(path.join(outputDir, 'mapa-158-marcadores-1440x900.png'), (await win.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`localStorage.setItem('sigma_leads', ${JSON.stringify(JSON.stringify(fixtureLeads))}); window.dispatchEvent(new Event('sigma:leads-updated'));`);
  await pause(450);

  fixtureFailureState.mapRepair = true;
  await win.webContents.executeJavaScript(`localStorage.setItem('sigma_leads', JSON.stringify([{ id: 'map-repair-failure', name: 'Teste de falha', address: '\\uE0C8Rua Teste, 1, Rio de Janeiro, RJ', city: 'Rio de Janeiro', state: 'RJ' }])); window.dispatchEvent(new Event('sigma:leads-updated'));`);
  await pause(350);
  const mapRepairFailure = await win.webContents.executeJavaScript(`document.querySelector('.toast-warning .toast-message')?.textContent || ''`);
  if (!/não puderam ser geocodificados/i.test(mapRepairFailure)) errors.push('Mapa: falha de geocoding não ficou visível para recuperação');
  fixtureFailureState.mapRepair = false;
  await win.webContents.executeJavaScript(`localStorage.setItem('sigma_leads', ${JSON.stringify(JSON.stringify(fixtureLeads))}); window.dispatchEvent(new Event('sigma:leads-updated'));`);
  await pause(220);

  // O Leaflet não pode executar callbacks atrasados após o unmount da rota.
  const errorsBeforeRapidMapNavigation = errors.length;
  await navigateTo('scraper maps', 20);
  await navigateTo('kanban', 20);
  await pause(240);
  if (errors.slice(errorsBeforeRapidMapNavigation).some((error) => /leaflet_pos|invalidateSize/i.test(error))) {
    errors.push('Mapa: callback do Leaflet falhou ao trocar de rota rapidamente');
  }

  await navigateTo('configurações', 420);
  const updateCard = await win.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('[data-od-id="settings-updates"]');
    const checkButton = [...(card?.querySelectorAll('button') || [])].find((node) => (node.textContent || '').includes('Verificar agora'));
    const text = card?.innerText || '';
    return { present: Boolean(card), hasCheck: Boolean(checkButton), hasVersion: /v\\d+\\.\\d+\\.\\d+/.test(text), text: text.slice(0, 200) };
  })()`);
  if (!updateCard.present || !updateCard.hasCheck || !updateCard.hasVersion) {
    errors.push(`Configurações: seção de atualizações incompleta ${JSON.stringify(updateCard)}`);
  }
  await captureModal('limpar-base-modal', `document.querySelector('[data-od-id="settings-clear-leads"]')?.click();`, '.modal-overlay');

  const desktopViewports = [];
  const inspectDesktop = async ({ width, height, label, route, file }) => {
    win.setSize(width, height);
    await pause(260);
    await navigateTo(label, route === 'whatsapp' ? 850 : 700);
    if (route === 'whatsapp') {
      await win.webContents.executeJavaScript(`document.querySelector('.chat-thread')?.click()`);
      await pause(220);
    }
    const diagnostic = await win.webContents.executeJavaScript(`(() => {
      const rect = (selector) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const box = node.getBoundingClientRect();
        return { width: Math.round(box.width), height: Math.round(box.height) };
      };
      const visible = (node) => {
        if (!node) return false;
        const style = getComputedStyle(node);
        const box = node.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
      };
      return {
        viewport: String(window.innerWidth) + 'x' + String(window.innerHeight),
        scrollWidth: document.documentElement.scrollWidth,
        noGlobalHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
        windowControls: [...document.querySelectorAll('.window-control-buttons .win-btn')].filter(visible).length,
        windowControlDetails: [...document.querySelectorAll('.window-control-buttons .win-btn')].map((node) => {
          const box = node.getBoundingClientRect();
          const icon = node.querySelector('svg');
          const iconBox = icon?.getBoundingClientRect();
          return {
            x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height),
            color: getComputedStyle(node).color, opacity: getComputedStyle(node).opacity,
            iconWidth: Math.round(iconBox?.width || 0), iconHeight: Math.round(iconBox?.height || 0),
          };
        }),
        kanbanColumns: document.querySelectorAll('.kanban-column').length,
        map: rect('#realMap'),
        mapMarkers: document.querySelectorAll('#realMap .lp').length,
        chatShell: rect('.chat-shell'),
        chatList: rect('.chat-list'),
        chatRoom: rect('.chat-room'),
      };
    })()`);
    desktopViewports.push({ requested: `${width}x${height}`, route, ...diagnostic });
    if (!diagnostic.noGlobalHorizontalOverflow || diagnostic.windowControls !== 3) {
      errors.push(`Desktop ${width}x${height}/${route}: overflow ou controles de janela ausentes (${JSON.stringify(diagnostic)})`);
    }
    if (route === 'kanban' && diagnostic.kanbanColumns < 3) errors.push(`Desktop ${width}x${height}/kanban: colunas insuficientes`);
    if (route === 'scraper' && (!diagnostic.map || diagnostic.map.width < 450 || diagnostic.map.height < 280 || diagnostic.mapMarkers < 3)) {
      errors.push(`Desktop ${width}x${height}/mapa: área ou marcadores inválidos (${JSON.stringify(diagnostic)})`);
    }
    if (route === 'whatsapp' && (!diagnostic.chatShell || !diagnostic.chatList || !diagnostic.chatRoom || diagnostic.chatList.width < 220 || diagnostic.chatRoom.width < 320)) {
      errors.push(`Desktop ${width}x${height}/WhatsApp: painel de conversa inválido (${JSON.stringify(diagnostic)})`);
    }
    fs.writeFileSync(path.join(outputDir, file), (await win.capturePage()).toPNG());
  };
  await inspectDesktop({ width: 1024, height: 768, label: 'kanban', route: 'kanban', file: 'desktop-1024x768-kanban.png' });
  await inspectDesktop({ width: 1440, height: 900, label: 'scraper maps', route: 'scraper', file: 'desktop-1440x900-mapa.png' });
  if (!skipWhatsApp) {
    await inspectDesktop({ width: 1920, height: 1080, label: 'whatsapp', route: 'whatsapp', file: 'desktop-1920x1080-whatsapp.png' });
  }

  const finalCapture = await win.capturePage();
  const viewport = finalCapture.getSize();
  const report = {
    generatedAt: new Date().toISOString(),
    version: require('../package.json').version,
    desktopOnly: true,
    viewport: `${viewport.width}x${viewport.height}`,
    routes: 8,
    modals: 18,
    controlledErrorScenarios: 4,
    functionalScenarios: 6,
    desktopViewports,
    errors,
    passed: errors.length === 0,
  };
  fs.writeFileSync(path.join(outputDir, 'qa-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ outputDir, ...report }, null, 2));
  win.destroy();
  app.exit(errors.length ? 1 : 0);
}).catch((error) => {
  console.error('[fatal]', error && error.stack ? error.stack : error);
  try {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'qa-report.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), fatal: String((error && error.stack) || error), passed: false, errors }, null, 2)}\n`);
  } catch {}
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
