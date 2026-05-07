// ─── i18n ──────────────────────────────────
const i18n = {
  'pt-BR': {
    all_leads: 'Todos os leads',
    ph_niche: 'Nicho (ex: Academia)', ph_neigh: 'Bairro (ex: Paciência)', ph_city: 'Cidade',
    add_queue: 'Adicionar à fila', process_queue: 'Processar fila', cancel_btn: 'Cancelar',
    queue_title: 'Fila de pesquisas',
    st_total: 'Resultados', st_phone: 'Com Telefone', st_web: 'Com Site', st_ig: 'Com Instagram', st_email: 'Com Email',
    col_name: 'Nome', col_cat: 'Categoria', col_rating: 'Nota', col_rev: 'Reviews',
    col_phone: 'Telefone', col_web: 'Site', col_ig: 'Instagram', col_email: 'Email', col_addr: 'Endereço',
    filter_ph: 'Filtrar por nome, telefone, email, endereço...', filter_cat: 'Todas categorias',
    table_title: 'Leads capturados', empty_hint: 'Monte sua fila de pesquisas e processe',
    term_log: 'Log de execução', rename: 'Renomear', del_search: 'Apagar',
    rename_title: 'Renomear pesquisa',
    toast_saved: 'Arquivo salvo!', toast_deleted: 'Pesquisa removida',
    confirm_del: 'Apagar esta pesquisa e seus leads?',
    searching: 'Buscando...', found: 'encontrados', done: 'concluído!', error: 'Erro',
    nav_dash: 'Dashboard', dash_total: 'Total de leads',
    dash_phone: 'Com telefone', dash_web: 'Com site', dash_ig: 'Com Instagram', dash_email: 'Com email',
    dash_categories: 'Categorias principais', dash_recent: 'Buscas recentes',
  },
  'en': {
    all_leads: 'All leads',
    ph_niche: 'Niche (e.g. Gym)', ph_neigh: 'Neighborhood', ph_city: 'City',
    add_queue: 'Add to queue', process_queue: 'Process queue', cancel_btn: 'Cancel',
    queue_title: 'Search queue',
    st_total: 'Results', st_phone: 'With Phone', st_web: 'With Website', st_ig: 'With Instagram', st_email: 'With Email',
    col_name: 'Name', col_cat: 'Category', col_rating: 'Rating', col_rev: 'Reviews',
    col_phone: 'Phone', col_web: 'Website', col_ig: 'Instagram', col_email: 'Email', col_addr: 'Address',
    filter_ph: 'Filter by name, phone, email, address...', filter_cat: 'All categories',
    table_title: 'Captured leads', empty_hint: 'Build your search queue and process',
    term_log: 'Execution log', rename: 'Rename', del_search: 'Delete',
    rename_title: 'Rename search',
    toast_saved: 'File saved!', toast_deleted: 'Search removed',
    confirm_del: 'Delete this search and its leads?',
    searching: 'Searching...', found: 'found', done: 'done!', error: 'Error',
    nav_dash: 'Dashboard', dash_total: 'Total leads',
    dash_phone: 'With phone', dash_web: 'With website', dash_ig: 'With Instagram', dash_email: 'With email',
    dash_categories: 'Top categories', dash_recent: 'Recent searches',
  },
  'es': {
    all_leads: 'Todos los leads',
    ph_niche: 'Nicho (ej. Gimnasio)', ph_neigh: 'Barrio', ph_city: 'Ciudad',
    add_queue: 'Añadir a cola', process_queue: 'Procesar cola', cancel_btn: 'Cancelar',
    queue_title: 'Cola de búsquedas',
    st_total: 'Resultados', st_phone: 'Con Teléfono', st_web: 'Con Sitio', st_ig: 'Con Instagram', st_email: 'Con Email',
    col_name: 'Nombre', col_cat: 'Categoría', col_rating: 'Nota', col_rev: 'Reseñas',
    col_phone: 'Teléfono', col_web: 'Sitio', col_ig: 'Instagram', col_email: 'Email', col_addr: 'Dirección',
    filter_ph: 'Filtrar por nombre, teléfono, email, dirección...', filter_cat: 'Todas categorías',
    table_title: 'Leads capturados', empty_hint: 'Arma tu cola de búsquedas y procesa',
    term_log: 'Registro de ejecución', rename: 'Renombrar', del_search: 'Eliminar',
    rename_title: 'Renombrar búsqueda',
    toast_saved: '¡Archivo guardado!', toast_deleted: 'Búsqueda eliminada',
    confirm_del: '¿Eliminar esta búsqueda y sus leads?',
    searching: 'Buscando...', found: 'encontrados', done: '¡completado!', error: 'Error',
    nav_dash: 'Dashboard', dash_total: 'Total de leads',
    dash_phone: 'Con teléfono', dash_web: 'Con sitio', dash_ig: 'Con Instagram', dash_email: 'Con email',
    dash_categories: 'Categorías principales', dash_recent: 'Búsquedas recientes',
  }
};

let lang = localStorage.getItem('sigma_lang') || 'pt-BR';
function t(k) { return i18n[lang]?.[k] || k; }
function setLang(l) { lang = l; localStorage.setItem('sigma_lang', l); applyI18n(); }
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(e => e.textContent = t(e.dataset.i18n));
  document.querySelectorAll('[data-i18n-placeholder]').forEach(e => e.placeholder = t(e.dataset.i18nPlaceholder));
  document.querySelectorAll('[data-i18n-title]').forEach(e => e.title = t(e.dataset.i18nTitle));
  document.querySelectorAll('.sl button').forEach(b => b.classList.toggle('act', b.dataset.lang === lang));
  document.documentElement.lang = lang;
  renderSidebar();
  renderStats();
}

// ─── SOUND ─────────────────────────────────
function playDone() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [523.25, 659.25, 783.99].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.15);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.4);
      o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.15); o.stop(ctx.currentTime + i * 0.15 + 0.4);
    });
  } catch(e) {}
}

// ─── DOM ───────────────────────────────────
const $ = id => document.getElementById(id);
let cancelled = false;
let activeSearchId = '__all__';
let renameTargetId = null;

// ─── DATA ──────────────────────────────────
let searches = JSON.parse(localStorage.getItem('sigma_searches') || '[]');
let leads = JSON.parse(localStorage.getItem('sigma_leads') || '[]');
let queue = JSON.parse(localStorage.getItem('sigma_queue') || '[]');

function save() {
  localStorage.setItem('sigma_searches', JSON.stringify(searches));
  localStorage.setItem('sigma_leads', JSON.stringify(leads));
  localStorage.setItem('sigma_queue', JSON.stringify(queue));
}

function getVisibleLeads() {
  let list = activeSearchId === '__all__' ? leads : leads.filter(l => l.searchId === activeSearchId);
  if (activeSearchId === '__all__') {
    const seen = new Set();
    list = list.filter(l => { const k = `${l.name}||${l.address}`.toLowerCase().trim(); if (seen.has(k)) return false; seen.add(k); return true; });
  }
  const ft = $('filterText').value.toLowerCase().trim();
  if (ft) list = list.filter(l => `${l.name} ${l.phone} ${l.email} ${l.address} ${l.category}`.toLowerCase().includes(ft));
  const fc = $('filterCategory').value;
  if (fc && fc !== 'all') list = list.filter(l => l.category === fc);
  const fh = $('filterHas').value;
  if (fh === 'phone') list = list.filter(l => l.phone);
  if (fh === 'website') list = list.filter(l => l.website);
  if (fh === 'instagram') list = list.filter(l => l.instagram);
  if (fh === 'email') list = list.filter(l => l.email);
  return list;
}

// ─── SIDEBAR ───────────────────────────────
function renderSidebar() {
  $('sideNav').querySelectorAll('.si').forEach(e => e.remove());
  const total = (() => {
    const seen = new Set();
    return leads.filter(l => { const k = `${l.name}||${l.address}`.toLowerCase().trim(); if (seen.has(k)) return false; seen.add(k); return true; }).length;
  })();
  $('allCount').textContent = total;

  searches.forEach(s => {
    const count = leads.filter(l => l.searchId === s.id).length;
    const div = document.createElement('div');
    div.className = 'ni si' + (activeSearchId === s.id ? ' act' : '');
    div.dataset.search = s.id;
    const label = s.label || s.query;
    div.innerHTML = `🔍 ${label}<span class="nb">${count}</span>`;
    div.addEventListener('click', () => selectSearch(s.id));
    $('sideNav').appendChild(div);
  });

  $('renameSearchBtn').style.display = activeSearchId !== '__all__' && searches.find(s => s.id === activeSearchId) ? '' : 'none';
  $('deleteSearchBtn').style.display = activeSearchId !== '__all__' ? '' : 'none';
  $('exportCsvBtn').style.display = leads.length > 0 ? '' : 'none';
  $('exportJsonBtn').style.display = leads.length > 0 ? '' : 'none';
}

function selectSearch(id) {
  activeSearchId = id;
  document.querySelectorAll('.ni').forEach(i => i.classList.remove('act'));
  const el = document.querySelector(`.ni[data-search="${id}"]`);
  if (el) el.classList.add('act');
  updateUI();
}

// ─── TABLE + STATS ─────────────────────────
function updateUI() {
  const list = getVisibleLeads();
  if (list.length === 0) { $('dataTable').style.display = 'none'; $('emptyState').style.display = 'flex'; }
  else { $('dataTable').style.display = ''; $('emptyState').style.display = 'none'; }

  $('tableBody').innerHTML = '';
  list.forEach((item, idx) => {
    const rating = item.rating ? `<span class="rate">${item.rating} ★</span>` : '-';
    const web = item.website ? `<a href="${item.website}" target="_blank">🔗</a>` : '-';
    const ig = item.instagram ? `<a href="${item.instagram}" target="_blank">📷</a>` : '-';
    const em = item.email ? `<span title="${item.email}">✉️</span>` : '-';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${idx + 1}</td><td><strong>${item.name || '-'}</strong></td><td>${item.category || '-'}</td><td>${rating}</td><td>${item.totalReviews || '-'}</td><td>${item.phone || '-'}</td><td>${web}</td><td>${ig}</td><td>${em}</td><td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${item.address || ''}">${item.address || '-'}</td>`;
    $('tableBody').appendChild(tr);
  });

  renderStats();
  populateCategoryFilter();
  renderSidebar();
}

function renderStats() {
  const list = getVisibleLeads();
  const n = list.length;
  const ph = list.filter(l => l.phone).length, wb = list.filter(l => l.website).length;
  const ig = list.filter(l => l.instagram).length, em = list.filter(l => l.email).length;
  const pct = x => n > 0 ? Math.round((x / n) * 100) : 0;
  $('stTotal').textContent = n; $('stPhone').textContent = ph; $('stPhonePct').textContent = `${pct(ph)}%`;
  $('stWeb').textContent = wb; $('stWebPct').textContent = `${pct(wb)}%`;
  $('stIg').textContent = ig; $('stIgPct').textContent = `${pct(ig)}%`;
  $('stEmail').textContent = em; $('stEmailPct').textContent = `${pct(em)}%`;
}

function populateCategoryFilter() {
  const cats = new Set();
  const all = activeSearchId === '__all__' ? leads : leads.filter(l => l.searchId === activeSearchId);
  all.forEach(l => { if (l.category) cats.add(l.category); });
  $('filterCategory').innerHTML = `<option value="all">${t('filter_cat')}</option>`;
  [...cats].sort().forEach(c => { $('filterCategory').innerHTML += `<option value="${c}">${c}</option>`; });
}

// ─── TERMINAL ──────────────────────────────
function log(msg) {
  const time = new Date().toLocaleTimeString();
  $('terminalOutput').textContent += `[${time}] ${msg}\n`;
  const tc = $('terminalContent'); tc.scrollTop = tc.scrollHeight;
}

// ─── TOAST ─────────────────────────────────
function toast(msg, type = 's') {
  const d = document.createElement('div');
  d.className = `toast toast${type}`;
  d.textContent = msg;
  $('toastContainer').appendChild(d);
  setTimeout(() => { d.style.opacity = '0'; d.style.transition = 'opacity 0.3s'; setTimeout(() => d.remove(), 300); }, 3000);
}

// ─── QUEUE ─────────────────────────────────
function renderQueue() {
  $('queueList').innerHTML = '';
  if (queue.length === 0) { $('queuePanel').style.display = 'none'; return; }
  $('queuePanel').style.display = 'block';
  queue.forEach((q, i) => {
    const div = document.createElement('div');
    div.className = 'q-item';
    div.innerHTML = `<span>${q.niche} • ${q.neigh} • ${q.city} (${q.max} resultados)</span><button data-idx="${i}">✕</button>`;
    div.querySelector('button').addEventListener('click', () => { queue.splice(i, 1); save(); renderQueue(); });
    $('queueList').appendChild(div);
  });
}

$('addQueueBtn').addEventListener('click', () => {
  const niche = $('inNiche').value.trim();
  const neigh = $('inNeigh').value.trim();
  const city = $('inCity').value.trim();
  if (!niche || !neigh) return toast('Preencha nicho e bairro', 'e');
  queue.push({ niche, neigh, city, max: parseInt($('inMax').value) || 30 });
  save();
  renderQueue();
  $('inNiche').value = ''; $('inNeigh').value = '';
  toast('Adicionado à fila');
});

// ─── PROCESS QUEUE ─────────────────────────
$('processBtn').addEventListener('click', async () => {
  if (queue.length === 0) return toast('Fila vazia', 'e');

  cancelled = false;
  $('processBtn').style.display = 'none';
  $('cancelBtn').style.display = '';
  $('spinner').style.display = '';
  $('terminalOutput').textContent = '';

  // Create one search group for all queue items
  const searchId = Date.now().toString();
  const qLabels = queue.map(q => `${q.niche} em ${q.neigh}, ${q.city}`);
  const searchLabel = qLabels.join(' | ');
  const searchQuery = queue.map(q => `${q.niche} ${q.neigh} ${q.city}`).join(' | ');
  searches.push({ id: searchId, query: searchQuery, label: searchLabel, timestamp: Date.now() });
  save();

  let totalAdded = 0;
  for (let qi = 0; qi < queue.length; qi++) {
    if (cancelled) break;
    const q = queue[qi];
    const qstr = `${q.niche} ${q.neigh} ${q.city}`;
    log(`[${qi + 1}/${queue.length}] ${t('searching')} "${qstr}"`);

    const result = await window.electronAPI.startScrape(qstr, q.max);
    if (cancelled) break;

    if (result.success && result.data.length > 0) {
      const existing = new Set(leads.map(l => `${l.name}||${l.address}`.toLowerCase().trim()));
      const newLeads = result.data
        .filter(l => l.name)
        .map(l => ({ ...l, id: (Math.random().toString(36).slice(2)), searchId }));
      const added = newLeads.filter(l => !existing.has(`${l.name}||${l.address}`.toLowerCase().trim()));
      leads.push(...added);
      totalAdded += added.length;
      log(`  ${result.count} ${t('found')}, ${added.length} novos`);
    }
  }

  save();
  queue = []; save();
  renderQueue();

  $('processBtn').style.display = '';
  $('cancelBtn').style.display = 'none';
  $('spinner').style.display = 'none';
  $('processBtn').innerHTML = `▶️ <span data-i18n="process_queue">${t('process_queue')}</span>`;

  if (!cancelled) {
    activeSearchId = searchId;
    updateUI();
    renderSidebar();
    playDone();
    log(`${t('done')} ${totalAdded} leads`);
    toast(`+${totalAdded} leads`);
  }
});

// ─── PROGRESS ──────────────────────────────
window.electronAPI.onProgress(msg => {
  log(msg);
  const m = msg.match(/\[(\d+)\/(\d+)\]/);
  if (m) {
    const pct = Math.round((parseInt(m[1]) / parseInt(m[2])) * 100);
    $('processBtn').innerHTML = `⏳ ${pct}%`;
  }
});

// ─── EVENTS ────────────────────────────────
$('cancelBtn').addEventListener('click', () => { cancelled = true; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') cancelled = true; });

$('btnMin').addEventListener('click', () => window.electronAPI.winMinimize());
$('btnMax').addEventListener('click', () => window.electronAPI.winMaximize());
$('btnClose').addEventListener('click', () => window.electronAPI.winClose());
window.electronAPI.onWinState(max => { $('btnMax').textContent = max ? '❐' : '☐'; });

$('terminalToggle').addEventListener('click', () => {
  $('terminalContent').classList.toggle('v');
  $('terminalToggle').style.color = $('terminalContent').classList.contains('v') ? 'var(--text)' : '';
});

document.querySelector('.ni.all').addEventListener('click', () => selectSearch('__all__'));
$('filterText').addEventListener('input', updateUI);
$('filterCategory').addEventListener('change', updateUI);
$('filterHas').addEventListener('change', updateUI);

document.querySelectorAll('.sl button').forEach(b => b.addEventListener('click', () => setLang(b.dataset.lang)));

// Export
$('exportCsvBtn').addEventListener('click', async () => {
  const data = getVisibleLeads();
  const res = await window.electronAPI.exportLeads(data, 'csv');
  toast(res.success ? t('toast_saved') : (res.message || 'Error'), res.success ? 's' : 'e');
});
$('exportJsonBtn').addEventListener('click', async () => {
  const data = getVisibleLeads();
  const res = await window.electronAPI.exportLeads(data, 'json');
  toast(res.success ? t('toast_saved') : (res.message || 'Error'), res.success ? 's' : 'e');
});

// Delete search
$('deleteSearchBtn').addEventListener('click', () => {
  if (activeSearchId === '__all__') return;
  if (!confirm(t('confirm_del'))) return;
  leads = leads.filter(l => l.searchId !== activeSearchId);
  searches = searches.filter(s => s.id !== activeSearchId);
  activeSearchId = '__all__';
  save();
  renderSidebar();
  updateUI();
  toast(t('toast_deleted'));
});

// Rename
$('renameSearchBtn').addEventListener('click', () => {
  if (activeSearchId === '__all__') return;
  const s = searches.find(x => x.id === activeSearchId);
  if (!s) return;
  renameTargetId = activeSearchId;
  $('renameInput').value = s.label || s.query;
  $('renameModal').classList.add('v');
});
$('renameCancel').addEventListener('click', () => $('renameModal').classList.remove('v'));
$('renameSave').addEventListener('click', () => {
  const s = searches.find(x => x.id === renameTargetId);
  if (s) { s.label = $('renameInput').value.trim(); save(); }
  $('renameModal').classList.remove('v');
  renderSidebar();
});

// ─── DASHBOARD ─────────────────────────────
function renderDashboard() {
  const deduped = (() => {
    const seen = new Set();
    return leads.filter(l => { const k = `${l.name}||${l.address}`.toLowerCase().trim(); if (seen.has(k)) return false; seen.add(k); return true; });
  })();
  const n = deduped.length;
  const ph = deduped.filter(l => l.phone).length, wb = deduped.filter(l => l.website).length;
  const ig = deduped.filter(l => l.instagram).length, em = deduped.filter(l => l.email).length;

  const pct = x => n > 0 ? Math.round((x / n) * 100) : 0;

  $('dashGrid').innerHTML = `
    <div class="dc"><h4 data-i18n="dash_total">${t('dash_total')}</h4><div class="big" style="color:var(--accent2);">${n}</div></div>
    <div class="dc"><h4 data-i18n="dash_phone">${t('dash_phone')}</h4><div class="big" style="color:var(--green);">${ph}</div><div class="bar-wrap"><div class="bar-fill" style="width:${pct(ph)}%;background:var(--green);"></div></div></div>
    <div class="dc"><h4 data-i18n="dash_web">${t('dash_web')}</h4><div class="big" style="color:#74b9ff;">${wb}</div><div class="bar-wrap"><div class="bar-fill" style="width:${pct(wb)}%;background:#74b9ff;"></div></div></div>
    <div class="dc"><h4 data-i18n="dash_ig">${t('dash_ig')}</h4><div class="big" style="color:#e056a0;">${ig}</div><div class="bar-wrap"><div class="bar-fill" style="width:${pct(ig)}%;background:#e056a0;"></div></div></div>
    <div class="dc"><h4 data-i18n="dash_email">${t('dash_email')}</h4><div class="big" style="color:#fdcb6e;">${em}</div><div class="bar-wrap"><div class="bar-fill" style="width:${pct(em)}%;background:#fdcb6e;"></div></div></div>
  `;

  // Categories
  const cats = {};
  deduped.forEach(l => { if (l.category) cats[l.category] = (cats[l.category] || 0) + 1; });
  const sorted = Object.entries(cats).sort((a,b) => b[1] - a[1]).slice(0, 8);
  const maxCat = sorted[0]?.[1] || 1;
  $('dashCategories').innerHTML = sorted.map(([name, count]) => `
    <div class="cat-row">
      <span class="cat-name">${name}</span>
      <div class="cat-bar"><div class="bar-wrap"><div class="bar-fill" style="width:${Math.round((count/maxCat)*100)}%;background:var(--accent);"></div></div></div>
      <span class="cat-count">${count}</span>
    </div>
  `).join('') || '<span style="color:var(--text2);font-size:12px;">Nenhuma categoria</span>';

  // Recent searches
  const recent = searches.slice(-8).reverse();
  $('dashRecent').innerHTML = recent.map(s => `
    <div class="hist-item"><span class="hq">🔍 ${s.label || s.query}</span><span class="hc">${leads.filter(l => l.searchId === s.id).length} leads</span></div>
  `).join('') || '<span style="color:var(--text2);font-size:12px;">Nenhuma busca</span>';

  applyI18n();
}

// ─── NAV DASHBOARD ─────────────────────────
document.querySelector('.ni[data-view="dashboard"]').addEventListener('click', () => {
  document.querySelectorAll('.ni').forEach(i => i.classList.remove('act'));
  document.querySelector('.ni[data-view="dashboard"]').classList.add('act');
  activeSearchId = null;
  // Hide table stuff, show dashboard
  $('tableSection').style.display = 'none';
  $('statsRow').style.display = 'none';
  $('filterBar').style.display = 'none';
  $('tableHdr').style.display = 'none';
  $('dashboardView').classList.add('v');
  $('deleteSearchBtn').style.display = 'none';
  $('renameSearchBtn').style.display = 'none';
  $('exportCsvBtn').style.display = 'none';
  $('exportJsonBtn').style.display = 'none';
  renderDashboard();
});

// When clicking a search, switch back to table view
const origSelectSearch = selectSearch;
selectSearch = function(id) {
  document.querySelector('.ni[data-view="dashboard"]').classList.remove('act');
  $('tableSection').style.display = 'flex';
  $('statsRow').style.display = 'flex';
  $('filterBar').style.display = 'flex';
  $('tableHdr').style.display = 'flex';
  $('dashboardView').classList.remove('v');
  origSelectSearch(id);
};

// ─── INIT ──────────────────────────────────
applyI18n();
renderQueue();
renderSidebar();
updateUI();

// Hide splash — run after a single frame so the browser paints
requestAnimationFrame(() => requestAnimationFrame(() => {
  const splash = $('splash');
  if (splash) { splash.classList.add('hide'); setTimeout(() => splash.remove(), 500); }
}));
