import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  Phone,
  Globe,
  Instagram,
  Mail,
  MessageCircle,
  Search,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Layers,
  Download,
  Filter,
  Columns,
  X,
  Check,
  Tag,
  Upload,
  FileSpreadsheet
} from 'lucide-react';
import { dedupeLeads, normalizeLeadCategory, normalizeLeadCollection, readLocalArray } from '../leadData';
import { DEFAULT_SCORE_THRESHOLDS, buildScoringIndex, findScoringLead, resolveGroupMembers, scoreBand } from '../leadMatch.mjs';
import { normalizeLeadLinks, isRealWebsite } from '../leadLinks.mjs';
import {
  CHANNELS,
  CHANNEL_STATES,
  FILTER_PRESETS,
  applyPreset,
  createGroup,
  emptyFilters,
  filterLeads,
  hasActiveFilters,
  leadChannels,
  matchesLeadFilters,
  membersFromLeads,
  membershipKeys,
  notifyGroupsChanged,
  presetActive,
  syncGroupsToService,
} from '../leadGroups.mjs';
import { useNotifications } from './NotificationCenter';

const DEFAULT_COLS = [
  { id: 'nome', label: 'Empresa' },
  { id: 'cat', label: 'Nicho' },
  { id: 'tel', label: 'Telefone' },
  { id: 'wa', label: 'WhatsApp' },
  { id: 'ig', label: 'Instagram' },
  { id: 'site', label: 'Site' },
  { id: 'mail', label: 'E-mail' },
  { id: 'av', label: 'Avaliação' },
  { id: 'uf', label: 'Estado' },
  { id: 'city', label: 'Cidade' },
  { id: 'hood', label: 'Bairro' },
  { id: 'orig', label: 'Origem' },
  { id: 'status', label: 'Status' },
  { id: 'grupos', label: 'Grupos' }
];

function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function fmtDur(ms) {
  if (ms == null) return '—';
  const m = Math.round(ms / 6e4);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}min`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function fmtDate(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} · ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const IMPORT_FIELDS = {
  name: ['nome', 'empresa', 'razao social', 'razao', 'business', 'company', 'name'],
  category: ['nicho', 'categoria', 'segmento', 'category', 'ramo'],
  phone: ['telefone', 'telefone principal', 'phone', 'celular', 'tel', 'whatsapp'],
  email: ['email', 'e-mail', 'mail'],
  website: ['site', 'website', 'url', 'pagina'],
  instagram: ['instagram', 'insta', 'ig'],
  address: ['endereco', 'endereço', 'logradouro', 'address'],
  neighborhood: ['bairro', 'neighborhood', 'distrito'],
  city: ['cidade', 'city', 'municipio', 'município'],
  state: ['estado', 'uf', 'state'],
  rating: ['avaliacao', 'avaliação', 'rating', 'nota'],
  reviews: ['avaliacoes', 'avaliações', 'reviews', 'qtd avaliacoes', 'qtd avaliações'],
};

function importHeader(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readImportValue(row, aliases) {
  const source = row && typeof row === 'object' ? row : {};
  const entries = Object.entries(source);
  for (const alias of aliases) {
    const hit = entries.find(([key]) => importHeader(key) === importHeader(alias));
    if (hit && hit[1] != null && String(hit[1]).trim()) return String(hit[1]).trim();
  }
  return '';
}

function makeImportedLead(row, index, batchId, fileName) {
  const name = readImportValue(row, IMPORT_FIELDS.name);
  if (!name) return null;
  const safeRaw = Object.fromEntries(Object.entries(row || {}).slice(0, 80));
  const links = normalizeLeadLinks({
    website: readImportValue(row, IMPORT_FIELDS.website),
    instagram: readImportValue(row, IMPORT_FIELDS.instagram),
  });
  return {
    id: `import_${batchId}_${index}`,
    name,
    category: readImportValue(row, IMPORT_FIELDS.category) || 'Sem categoria',
    phone: readImportValue(row, IMPORT_FIELDS.phone),
    email: readImportValue(row, IMPORT_FIELDS.email),
    website: links.website,
    instagram: links.instagram,
    address: readImportValue(row, IMPORT_FIELDS.address),
    neighborhood: readImportValue(row, IMPORT_FIELDS.neighborhood),
    city: readImportValue(row, IMPORT_FIELDS.city),
    state: readImportValue(row, IMPORT_FIELDS.state),
    rating: readImportValue(row, IMPORT_FIELDS.rating),
    reviews: readImportValue(row, IMPORT_FIELDS.reviews),
    searchId: batchId,
    source: 'import',
    importedAt: Date.now(),
    raw: { importFile: fileName, row: safeRaw },
  };
}

function describeFilters(filters) {
  const parts = [];
  for (const [key, state] of Object.entries(filters?.channels || {})) {
    if (state !== 'with' && state !== 'without') continue;
    const channel = CHANNELS.find((item) => item.key === key);
    if (channel) parts.push(`${state === 'with' ? 'com' : 'sem'} ${channel.label}`);
  }
  if (Number(filters?.minRating || 0) > 0) parts.push(`nota ≥ ${filters.minRating}`);
  if (filters?.category) parts.push(filters.category);
  if (filters?.city) parts.push(filters.city);
  if (filters?.state) parts.push(filters.state);
  return parts.join(' · ').slice(0, 240);
}

export default function LeadsManager({ onUpdateLeadsCount, addLog }) {
  const { addNotification } = useNotifications();
  const importInputRef = useRef(null);
  // A base é sempre o que existe em localStorage; nada é semeado.
  const [leads, setLeads] = useState(() => normalizeLeadCollection(readLocalArray('sigma_leads')));

  const [groups, setGroups] = useState(() => readLocalArray('sigma_groups'));

  const [hist, setHist] = useState(() => {
    try {
      const h = JSON.parse(localStorage.getItem('sigma_history') || 'null');
      if (h && typeof h === 'object') return h;
    } catch {}
    return {};
  });

  // Score real vem do serviço de Lead Scoring, casado por identidade do lead.
  const [scoringLeads, setScoringLeads] = useState([]);

  useEffect(() => {
    let disposed = false;
    const loadScores = async () => {
      if (!window.leadScoringAPI?.getAll) return;
      try {
        const response = await window.leadScoringAPI.getAll({});
        if (!disposed && response?.success) setScoringLeads(response.leads || []);
      } catch {
        // sem serviço, a aba Scoring mostra o estado vazio real
      }
    };
    loadScores();
    const unsubscribe = window.leadScoringAPI?.onProgress?.((payload) => {
      if (payload?.event === 'saved' || payload?.event === 'auto-completed' || payload?.event === 'completed') loadScores();
    });
    return () => {
      disposed = true;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  const scoringIndex = useMemo(() => buildScoringIndex(scoringLeads), [scoringLeads]);
  const [scoringBusyId, setScoringBusyId] = useState('');

  const painLabel = (pain) => ({
    https: 'Site sem HTTPS (cadeado)',
    mobile: 'Site não adaptado ao celular',
    whatsapp: 'Sem WhatsApp visível no site',
    pixel: 'Sem pixel de anúncio',
    slow: 'Site carrega devagar',
    form: 'Sem formulário de contato',
    errors: 'Erros de carregamento no site',
    analytics: 'Sem medição de visitas',
  }[pain] || pain);

  // Score real do Lead Scoring para um lead da base (casado por identidade).
  const baseScoreFor = (lead) => {
    if (!lead) return null;
    const saved = findScoringLead(scoringIndex, lead, leads.indexOf(lead));
    if (!saved?.score || !Number.isFinite(Number(saved.score.value))) return null;
    const score = Number(saved.score.value);
    const band = scoreBand(score, DEFAULT_SCORE_THRESHOLDS);
    const site = saved.siteAnalysis || {};
    const ai = saved.aiAnalysis || {};
    const company = saved.company || {};
    const positive = [
      company.whatsapp || site.conversion?.hasWhatsappButton ? 'WhatsApp confirmado' : '',
      company.phone ? 'Telefone confirmado' : '',
      company.email ? 'E-mail confirmado' : '',
      site.hasHttps ? 'Site com HTTPS' : '',
      site.mobile?.isResponsive ? 'Layout responsivo' : '',
      Number(company.reviewCount || 0) >= 50 ? 'Bom volume de avaliações no Google' : '',
    ].filter(Boolean);
    const negative = [
      ...(Array.isArray(saved.score.sitePains) ? saved.score.sitePains : []).map(painLabel),
      ...(Array.isArray(ai.principais_dores) ? ai.principais_dores : []),
    ];
    const opportunities = Array.isArray(ai.principais_oportunidades) ? ai.principais_oportunidades : [];
    return {
      score,
      band: band.key,
      bandLabel: band.label,
      pos: positive,
      neg: negative.length ? negative : (Array.isArray(saved.score.reasons) ? saved.score.reasons : []),
      opp: opportunities.length ? opportunities : (Array.isArray(saved.score.reasons) ? saved.score.reasons.slice(0, 3) : []),
      ts: saved.updatedAt || saved.createdAt,
      provider: ai.rawProvider || (saved.score.priority ? `prioridade: ${saved.score.priority}` : ''),
      preset: 'Lead Scoring',
    };
  };

  const handleAnalyzeLead = async (lead) => {
    if (!lead || !window.leadScoringAPI?.analyzeLead) {
      addNotification({ type: 'error', category: 'system', title: 'Scoring indisponível', message: 'Atualize o aplicativo para analisar leads daqui.' });
      return;
    }
    setScoringBusyId(lead.id);
    try {
      const response = await window.leadScoringAPI.analyzeLead(lead);
      if (!response?.success) throw new Error(response?.error || 'A análise falhou.');
      const list = await window.leadScoringAPI.getAll({});
      if (list?.success) setScoringLeads(list.leads || []);
      addNotification({ type: 'success', category: 'system', title: 'Lead analisado', message: `${getLeadName(lead)} recebeu score ${response.lead?.score?.value ?? '—'}.` });
    } catch (error) {
      addNotification({ type: 'error', category: 'system', title: 'Falha na análise', message: error.message || 'Não foi possível analisar este lead.' });
    } finally {
      setScoringBusyId('');
    }
  };

  // State for visible columns
  const [visCols, setVisCols] = useState(['nome', 'tel', 'ig', 'av', 'status', 'city', 'hood']);
  const [showColPop, setShowColPop] = useState(false);

  // Filters
  const [bq, setBq] = useState('');
  const [bCat, setBCat] = useState('');
  const [bUf, setBUf] = useState('');
  const [bCity, setBCity] = useState('');
  const [bHood, setBHood] = useState('');
  const [bGrupo, setBGrupo] = useState('');
  const [bRate, setBRate] = useState(0);
  const [bChans, setBChans] = useState([]);
  const [showFilters, setShowFilters] = useState(false);

  // Period
  const [bPeriod, setBPeriod] = useState('all');
  const [bD0, setBD0] = useState('');
  const [bD1, setBD1] = useState('');

  // Chart
  const [bDim, setBDim] = useState('cat');
  const [bMet, setBMet] = useState('leads');
  const [bMode, setBMode] = useState('bars');
  const [isBaseAnalysisExpanded, setIsBaseAnalysisExpanded] = useState(false);

  // Table pagination and sorting
  const [bSort, setBSort] = useState({ key: 'nome', dir: 1 });
  const [bPage, setBPage] = useState(1);
  const PAGE_SIZE = 8;

  // Selected leads
  const [sel, setSel] = useState(new Set());

  // Filtros rápidos da lista: só com / sem cada canal, nota mínima e texto.
  const [bSmart, setBSmart] = useState(() => emptyFilters());

  // Modais
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [expFmt, setExpFmt] = useState('xlsx');
  const [expScope, setExpScope] = useState('filtered');
  const [expColsScope, setExpColsScope] = useState('vis');
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importPreview, setImportPreview] = useState(null);

  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [isGroupsOpen, setIsGroupsOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [groupMode, setGroupMode] = useState('selection');
  const [groupFilters, setGroupFilters] = useState(() => emptyFilters());

  const [isAddGroupOpen, setIsAddGroupOpen] = useState(false);
  const [groupSearch, setGroupSearch] = useState('');

  const [activeLead, setActiveLead] = useState(null);
  const [leadModalTab, setLeadModalTab] = useState('dados');
  const [phonePromptLead, setPhonePromptLead] = useState(null);
  const [kanbanSnapshot, setKanbanSnapshot] = useState({ cards: [], board: { columns: [] } });

  // Persist state
  useEffect(() => {
    localStorage.setItem('sigma_leads', JSON.stringify(leads));
    localStorage.setItem('sigma_leads_initialized', 'true');
    onUpdateLeadsCount?.(dedupeLeads(leads).length);
  }, [leads, onUpdateLeadsCount]);

  useEffect(() => {
    const syncStoredLeads = () => setLeads(normalizeLeadCollection(readLocalArray('sigma_leads')));
    window.addEventListener('sigma:leads-updated', syncStoredLeads);
    window.addEventListener('storage', syncStoredLeads);
    return () => {
      window.removeEventListener('sigma:leads-updated', syncStoredLeads);
      window.removeEventListener('storage', syncStoredLeads);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('sigma_groups', JSON.stringify(groups));
    // Espelha no processo principal para os grupos aparecerem no Lead Scoring e
    // nas campanhas, e avisa as telas abertas.
    syncGroupsToService(groups);
    notifyGroupsChanged();
  }, [groups]);

  // Quem manda "criar grupo" de outra tela cai direto no modal certo.
  useEffect(() => {
    const openGroups = () => setIsGroupsOpen(true);
    window.addEventListener('sigma:open-groups', openGroups);
    return () => window.removeEventListener('sigma:open-groups', openGroups);
  }, []);

  useEffect(() => {
    localStorage.setItem('sigma_history', JSON.stringify(hist));
  }, [hist]);

  useEffect(() => {
    let mounted = true;
    const loadKanban = async () => {
      if (!window.kanbanAPI?.getBoard) return;
      try {
        const synced = await window.kanbanAPI.syncMapsLeads?.(normalizeLeadCollection(leads));
        const response = await window.kanbanAPI.getBoard();
        if (mounted) setKanbanSnapshot(response?.board || synced?.board || { cards: [], board: { columns: [] } });
      } catch {}
    };
    loadKanban();
    window.addEventListener('sigma:deal-updated', loadKanban);
    return () => { mounted = false; window.removeEventListener('sigma:deal-updated', loadKanban); };
  }, [leads]);

  // Normalized accessors
  const getLeadId = (l, idx) => l.id || `lead-${idx}`;
  const getLeadName = (l) => l.name || l.n || 'Sem nome';
  const getLeadCat = (l) => normalizeLeadCategory(l.category || l.cat || 'Geral');
  const getLeadTel = (l) => l.phone || l.tel || '';
  const getLeadSite = (l) => l.website || l.site || '';
  const getLeadIg = (l) => l.instagram || l.ig || '';
  const getLeadMail = (l) => l.email || l.mail || '';
  const getLeadCity = (l) => l.city || '';
  const getLeadUf = (l) => l.state || l.uf || '';
  const getLeadHood = (l) => l.neighborhood || l.hood || '';
  const getLeadRating = (l) => l.rating || l.rn || '—';
  const getLeadReviews = (l) => l.reviews ?? l.totalReviews ?? l.reviewCount ?? l.numberOfReviews ?? 0;
  const getLeadOrig = (l) => l.searchQuery || l.orig || '—';

  const kanbanIndex = useMemo(() => {
    const index = new Map();
    (kanbanSnapshot.cards || []).forEach((card) => {
      const profile = card.entity?.profile || {};
      const phone = String(profile.phone || '').replace(/\D/g, '');
      if (phone) index.set(`phone:${phone}`, card);
      const name = norm(profile.name || '');
      if (name) index.set(`name:${name}`, card);
    });
    return index;
  }, [kanbanSnapshot.cards]);

  const kanbanCardFor = (lead) => {
    const phone = String(getLeadTel(lead) || '').replace(/\D/g, '');
    return (phone && kanbanIndex.get(`phone:${phone}`)) || kanbanIndex.get(`name:${norm(getLeadName(lead))}`) || null;
  };

  const statusPresentation = (lead, id) => {
    const card = kanbanCardFor(lead);
    const column = card && kanbanSnapshot.board?.columns?.find((item) => item.id === card.columnId);
    if (column) return { label: column.name, color: column.color || '#94a3b8', symbol: column.dealOutcome === 'won' ? '✓' : column.dealOutcome === 'lost' ? '×' : column.id === 'contacted' ? '↩' : column.id === 'sent' ? '→' : '○' };
    const fallback = leadStatus(id);
    return { label: fallback === 'resp' ? 'Respondeu' : fallback === 'env' ? 'Mensagem enviada' : 'Novo lead', color: fallback === 'resp' ? '#2563eb' : fallback === 'env' ? '#10a37f' : '#94a3b8', symbol: fallback === 'resp' ? '↩' : fallback === 'env' ? '→' : '○' };
  };

  const askToMessage = (lead) => setPhonePromptLead(lead);
  const startWhatsAppFromBase = () => {
    if (!phonePromptLead) return;
    const name = getLeadName(phonePromptLead);
    const tel = getLeadTel(phonePromptLead);
    try { localStorage.setItem('sigma_wa_pending', JSON.stringify({ name, tel })); } catch {}
    setPhonePromptLead(null);
    window.location.hash = '#whatsapp';
  };

  const leadHasChan = (l, ch) => {
    if (ch === 'tel' || ch === 'wa') return Boolean(getLeadTel(l));
    if (ch === 'ig') return Boolean(getLeadIg(l));
    if (ch === 'site') return isRealWebsite(getLeadSite(l));
    if (ch === 'mail') return Boolean(getLeadMail(l));
    return false;
  };

  const leadStatus = (leadId) => {
    const h = hist[leadId] || [];
    if (h.some((e) => e.k === 'reply')) return 'resp';
    if (h.some((e) => e.k === 'sent')) return 'env';
    return 'novo';
  };

  // Period filtering
  const periodRange = useMemo(() => {
    if (bPeriod === 'all') return null;
    if (bPeriod === 'custom') {
      if (!bD0 || !bD1) return null;
      return [new Date(`${bD0}T00:00`).getTime(), new Date(`${bD1}T23:59`).getTime()];
    }
    return [Date.now() - Number(bPeriod) * 864e5, Date.now()];
  }, [bPeriod, bD0, bD1]);

  const evInPeriod = (e) => {
    if (!periodRange) return true;
    return e.ts >= periodRange[0] && e.ts <= periodRange[1];
  };

  // Resolve os grupos antes de qualquer filtro que possa usá-los. Manter este
  // memo acima de `filteredLeads` evita acessar a constante durante o primeiro
  // render, quando o JavaScript ainda está na zona temporal de inicialização.
  const groupLeadSets = useMemo(() => {
    const map = new Map();
    for (const group of groups) map.set(String(group.id), new Set(resolveGroupMembers(group, leads)));
    return map;
  }, [groups, leads]);

  // Filtered rows
  const filteredLeads = useMemo(() => {
    const q = norm(bq).trim();
    return leads.filter((l, idx) => {
      const id = getLeadId(l, idx);
      const name = getLeadName(l);
      const cat = getLeadCat(l);
      const city = getLeadCity(l);
      const uf = getLeadUf(l);
      const hood = getLeadHood(l);
      const tel = getLeadTel(l);
      const ig = getLeadIg(l);
      const rn = parseFloat(String(getLeadRating(l)).replace(',', '.')) || 0;

      if (bCat && cat !== bCat) return false;
      if (bUf && uf !== bUf) return false;
      if (bCity && city !== bCity) return false;
      if (bHood && hood !== bHood) return false;
      if (bRate > 0 && rn < bRate) return false;
      if (bGrupo) {
        const members = groupLeadSets.get(String(bGrupo));
        if (!members || !members.has(l)) return false;
      }
      for (const ch of bChans) {
        if (!leadHasChan(l, ch)) return false;
      }
      if (!matchesLeadFilters(l, bSmart)) return false;
      if (q) {
        const fullText = norm(`${name} ${cat} ${city} ${uf} ${hood} ${tel} ${ig}`);
        if (!fullText.includes(q)) return false;
      }
      return true;
    });
  }, [leads, bq, bCat, bUf, bCity, bHood, bRate, bGrupo, bChans, bSmart, groups]);

  // Stats calculation
  const stats = useMemo(() => {
    let sent = 0;
    let replies = 0;
    const responseTimes = [];

    filteredLeads.forEach((l, idx) => {
      const id = getLeadId(l, idx);
      const h = (hist[id] || []).filter(evInPeriod);
      h.forEach((e) => {
        if (e.k === 'sent') sent += 1;
        if (e.k === 'reply') replies += 1;
      });
      const s = h.find((e) => e.k === 'sent');
      const r = h.find((e) => e.k === 'reply' && s && e.ts > s.ts);
      if (s && r) responseTimes.push(r.ts - s.ts);
    });

    const avgTime = responseTimes.length > 0 ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : null;
    const taxa = sent > 0 ? replies / sent : null;

    return {
      sent,
      replies,
      taxa,
      avgTime,
      withTel: filteredLeads.filter((l) => leadHasChan(l, 'tel')).length,
      withWa: filteredLeads.filter((l) => leadHasChan(l, 'wa')).length,
      withIg: filteredLeads.filter((l) => leadHasChan(l, 'ig')).length,
      withSite: filteredLeads.filter((l) => leadHasChan(l, 'site')).length,
      withMail: filteredLeads.filter((l) => leadHasChan(l, 'mail')).length,
      categoriesCount: new Set(filteredLeads.map(getLeadCat)).size,
      groupsCount: groups.length
    };
  }, [filteredLeads, hist, groups, periodRange]);

  // Base Analysis Chart Data
  const chartGroups = useMemo(() => {
    if (bDim === 'chan') {
      const channels = [
        { label: 'Telefone', key: 'tel' },
        { label: 'WhatsApp', key: 'wa' },
        { label: 'Instagram', key: 'ig' },
        { label: 'Site', key: 'site' },
        { label: 'E-mail', key: 'mail' },
      ];
      return channels.map(({ label, key }) => {
        const items = filteredLeads.filter((l) => leadHasChan(l, key));
        return { label, items };
      });
    }

    if (bDim === 'grupo') {
      return groups.map((g) => {
        const items = filteredLeads.filter((l, idx) => g.members.includes(getLeadId(l, idx)));
        return { label: g.name, items };
      });
    }

    const map = new Map();
    filteredLeads.forEach((l) => {
      let val = '—';
      if (bDim === 'cat') val = getLeadCat(l);
      else if (bDim === 'city') val = getLeadCity(l) || '—';
      else if (bDim === 'hood') val = getLeadHood(l) || '—';
      else if (bDim === 'uf') val = getLeadUf(l) || '—';

      if (!map.has(val)) map.set(val, []);
      map.get(val).push(l);
    });

    return [...map.entries()].map(([label, items]) => ({ label, items }));
  }, [filteredLeads, bDim, groups]);

  const getMetricValue = (items, met) => {
    if (met === 'leads') return items.length;
    let s = 0;
    let r = 0;
    items.forEach((l, idx) => {
      const id = getLeadId(l, idx);
      const h = (hist[id] || []).filter(evInPeriod);
      h.forEach((e) => {
        if (e.k === 'sent') s += 1;
        if (e.k === 'reply') r += 1;
      });
    });
    if (met === 'sent') return s;
    if (met === 'replies') return r;
    return s > 0 ? r / s : 0;
  };

  const formatMetricValue = (met, v) => {
    if (met === 'taxa') return v == null || Number.isNaN(v) ? '—' : `${Math.round(v * 100)}%`;
    return v;
  };

  // Unique options for filter selects
  const uniqueCategories = useMemo(() => [...new Set(leads.map(getLeadCat))].sort(), [leads]);
  const uniqueUfs = useMemo(() => [...new Set(leads.map(getLeadUf).filter(Boolean))].sort(), [leads]);
  const uniqueCities = useMemo(() => [...new Set(leads.map(getLeadCity).filter(Boolean))].sort(), [leads]);
  const uniqueHoods = useMemo(() => [...new Set(leads.map(getLeadHood).filter(Boolean))].sort(), [leads]);

  // Active filters count
  const activeFiltersCount = useMemo(() => {
    let n = 0;
    if (bq) n += 1;
    if (bCat) n += 1;
    if (bUf) n += 1;
    if (bCity) n += 1;
    if (bHood) n += 1;
    if (bGrupo) n += 1;
    if (bRate > 0) n += 1;
    n += bChans.length;
    n += Object.values(bSmart.channels || {}).filter((value) => value === 'with' || value === 'without').length;
    if (Number(bSmart.minRating || 0) > 0) n += 1;
    if (bSmart.city) n += 1;
    if (bSmart.category) n += 1;
    return n;
  }, [bq, bCat, bUf, bCity, bHood, bGrupo, bRate, bChans, bSmart]);

  // Sorted rows
  const sortedRows = useMemo(() => {
    const list = [...filteredLeads];
    list.sort((a, b) => {
      let x = '';
      let y = '';
      if (bSort.key === 'nome') {
        x = getLeadName(a);
        y = getLeadName(b);
      } else if (bSort.key === 'cat') {
        x = getLeadCat(a);
        y = getLeadCat(b);
      } else if (bSort.key === 'city') {
        x = getLeadCity(a);
        y = getLeadCity(b);
      } else if (bSort.key === 'av') {
        x = parseFloat(String(getLeadRating(a)).replace(',', '.')) || 0;
        y = parseFloat(String(getLeadRating(b)).replace(',', '.')) || 0;
      } else if (bSort.key === 'status') {
        const sx = leadStatus(getLeadId(a, 0));
        const sy = leadStatus(getLeadId(b, 0));
        x = sx === 'resp' ? 2 : sx === 'env' ? 1 : 0;
        y = sy === 'resp' ? 2 : sy === 'env' ? 1 : 0;
      }
      if (typeof x === 'number' && typeof y === 'number') {
        return (x - y) * bSort.dir;
      }
      return String(x).localeCompare(String(y), 'pt-BR') * bSort.dir;
    });
    return list;
  }, [filteredLeads, bSort]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const paginatedRows = useMemo(() => {
    const start = (bPage - 1) * PAGE_SIZE;
    return sortedRows.slice(start, start + PAGE_SIZE);
  }, [sortedRows, bPage]);

  const handleSort = (key) => {
    if (bSort.key === key) {
      setBSort({ key, dir: bSort.dir * -1 });
    } else {
      setBSort({ key, dir: 1 });
    }
  };

  const toggleSelectAll = (checked) => {
    if (checked) {
      const next = new Set();
      filteredLeads.forEach((l, idx) => next.add(getLeadId(l, idx)));
      setSel(next);
    } else {
      setSel(new Set());
    }
  };

  const toggleSelectLead = (id, checked) => {
    const next = new Set(sel);
    if (checked) next.add(id);
    else next.delete(id);
    setSel(next);
  };

  const handleChannelToggle = (ch) => {
    if (bChans.includes(ch)) {
      setBChans(bChans.filter((c) => c !== ch));
    } else {
      setBChans([...bChans, ch]);
    }
  };

  const handleClearFilters = () => {
    setBq('');
    setBCat('');
    setBUf('');
    setBCity('');
    setBHood('');
    setBGrupo('');
    setBRate(0);
    setBChans([]);
    setBSmart(emptyFilters());
  };

  // Group membership helpers
  const leadGroups = (lead) => groups.filter((g) => groupLeadSets.get(String(g.id))?.has(lead));

  const removeLeadFromGroup = (lead, groupId) => {
    const keys = new Set(membershipKeys(lead, leads.indexOf(lead)));
    setGroups((prev) => prev.map((g) => (g.id === groupId
      ? { ...g, members: (g.members || []).filter((m) => !keys.has(m)), updated: Date.now() }
      : g)));
  };

  const addLeadToGroup = (lead, groupId) => {
    const keys = membershipKeys(lead, leads.indexOf(lead));
    setGroups((prev) => prev.map((g) => {
      if (g.id !== groupId) return g;
      return { ...g, members: [...new Set([...(g.members || []), ...keys])], updated: Date.now() };
    }));
  };

  // Abrir a criação de grupo já no modo útil: com leads marcados usa a seleção,
  // sem seleção abre direto em "Filtrar a base" para não parecer que não há nada.
  const openCreateGroup = (mode) => {
    setNewGroupName('');
    setGroupFilters(emptyFilters());
    setGroupMode(mode || (sel.size > 0 ? 'selection' : 'filter'));
    setIsCreateGroupOpen(true);
  };

  // Membros que o modal de criação vai usar, conforme o modo escolhido.
  const groupCandidates = useMemo(() => {
    if (groupMode !== 'filter') return [];
    return filterLeads(leads, groupFilters);
  }, [groupMode, leads, groupFilters]);

  const groupSelectionCount = useMemo(() => {
    if (groupMode !== 'filter') return sel.size;
    return groupCandidates.length;
  }, [groupMode, sel, groupCandidates]);

  // Create group from selection or from the filter result
  const handleCreateGroup = () => {
    const sourceLeads = groupMode === 'filter'
      ? groupCandidates
      : leads.filter((l, idx) => sel.has(getLeadId(l, idx)));
    if (!sourceLeads.length) {
      addNotification({
        type: 'warning',
        category: 'system',
        title: 'Nenhum lead no grupo',
        message: groupMode === 'filter'
          ? 'Ajuste os filtros: nenhum lead da base atende a esta combinação.'
          : 'Selecione ao menos um lead na tabela para criar o grupo.',
      });
      return;
    }
    const newGroup = createGroup({
      name: newGroupName,
      members: membersFromLeads(sourceLeads, leads),
      description: groupMode === 'filter' ? describeFilters(groupFilters) : '',
    });
    setGroups((prev) => [...prev, newGroup]);
    setIsCreateGroupOpen(false);
    setIsGroupsOpen(false);
    setNewGroupName('');
    setGroupFilters(emptyFilters());
    setGroupMode('selection');
    addLog?.(`[GRUPO] “${newGroup.name}” criado com ${sourceLeads.length} lead(s).`);
    addNotification({
      type: 'success',
      category: 'system',
      title: 'Grupo criado',
      message: `“${newGroup.name}” tem ${sourceLeads.length} lead(s) e já aparece no Lead Scoring e nas campanhas.`,
    });
  };

  // Add selection to existing group
  const handleAddToGroup = (groupId) => {
    const selectedLeads = leads.filter((l, idx) => sel.has(getLeadId(l, idx)));
    const keys = membersFromLeads(selectedLeads, leads);
    setGroups((prev) => prev.map((g) => {
      if (g.id !== groupId) return g;
      return { ...g, members: [...new Set([...(g.members || []), ...keys])], updated: Date.now() };
    }));
    setIsAddGroupOpen(false);
    addNotification({
      type: 'success',
      category: 'system',
      title: 'Leads adicionados',
      message: `${selectedLeads.length} lead(s) entraram no grupo.`,
    });
  };

  // Export Leads
  const handleExport = () => {
    let rowsToExport = [];
    if (expScope === 'all') rowsToExport = leads;
    else if (expScope === 'selected') rowsToExport = leads.filter((l, idx) => sel.has(getLeadId(l, idx)));
    else rowsToExport = filteredLeads;

    const colsToExport = expColsScope === 'all' ? DEFAULT_COLS : DEFAULT_COLS.filter((c) => visCols.includes(c.id));

    const data = rowsToExport.map((l, idx) => {
      const id = getLeadId(l, idx);
      const row = {};
      colsToExport.forEach((c) => {
        if (c.id === 'nome') row[c.label] = getLeadName(l);
        else if (c.id === 'cat') row[c.label] = getLeadCat(l);
        else if (c.id === 'tel') row[c.label] = getLeadTel(l) || '—';
        else if (c.id === 'wa') row[c.label] = getLeadTel(l) || '—';
        else if (c.id === 'ig') row[c.label] = getLeadIg(l) || '—';
        else if (c.id === 'site') row[c.label] = getLeadSite(l) || '—';
        else if (c.id === 'mail') row[c.label] = getLeadMail(l) || '—';
        else if (c.id === 'av') row[c.label] = `${getLeadRating(l)} (${getLeadReviews(l)})`;
        else if (c.id === 'uf') row[c.label] = getLeadUf(l) || '—';
        else if (c.id === 'city') row[c.label] = getLeadCity(l) || '—';
        else if (c.id === 'hood') row[c.label] = getLeadHood(l) || '—';
        else if (c.id === 'orig') row[c.label] = getLeadOrig(l);
        else if (c.id === 'status') {
          const st = leadStatus(id);
          row[c.label] = st === 'resp' ? 'Respondeu' : st === 'env' ? 'Mensagem enviada' : 'Ainda não contatado';
        } else if (c.id === 'grupos') {
          row[c.label] = leadGroups(l).map((g) => g.name).join('; ') || '—';
        }
      });
      return row;
    });

    const stamp = () => {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
    };

    if (expFmt === 'json') {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sigma-leads-${stamp()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else if (expFmt === 'csv') {
      const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
      const csv = [colsToExport.map((c) => q(c.label)).join(';')].concat(data.map((o) => colsToExport.map((c) => q(o[c.label])).join(';'))).join('\r\n');
      const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sigma-leads-${stamp()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Leads');
      XLSX.writeFile(wb, `sigma-leads-${stamp()}.xlsx`);
    }

    setIsExportOpen(false);
  };

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!/\.(csv|xlsx)$/i.test(file.name)) {
      addNotification({ type: 'warning', category: 'system', title: 'Formato não suportado', message: 'Escolha um arquivo .csv ou .xlsx.' });
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      addNotification({ type: 'warning', category: 'system', title: 'Arquivo muito grande', message: 'A importação aceita arquivos de até 25 MB.' });
      return;
    }

    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: false });
      const firstSheetName = workbook.SheetNames[0];
      const sheet = firstSheetName ? workbook.Sheets[firstSheetName] : null;
      if (!sheet) throw new Error('A planilha não contém uma aba utilizável.');
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
      if (!rows.length) throw new Error('Não há linhas de dados na primeira aba.');
      if (rows.length > 10000) throw new Error('O limite por importação é de 10.000 linhas.');

      const batchId = `import_${Date.now()}`;
      const valid = normalizeLeadCollection(rows
        .map((row, index) => makeImportedLead(row, index + 1, batchId, file.name))
        .filter(Boolean));
      if (!valid.length) {
        throw new Error('Não encontrei uma coluna de empresa/nome preenchida. Use “Empresa”, “Nome” ou “Company”.');
      }

      const current = dedupeLeads(normalizeLeadCollection(leads));
      const merged = dedupeLeads([...current, ...valid]);
      const added = Math.max(0, merged.length - current.length);
      setImportPreview({
        batchId,
        fileName: file.name,
        sheetName: firstSheetName,
        totalRows: rows.length,
        invalidRows: rows.length - valid.length,
        duplicateRows: Math.max(0, valid.length - added),
        added,
        valid,
      });
      setIsImportOpen(true);
    } catch (error) {
      addNotification({
        type: 'error',
        category: 'system',
        title: 'Não foi possível ler o arquivo',
        message: error?.message || 'Revise o CSV/XLSX e tente novamente.',
      });
    }
  };

  const handleConfirmImport = () => {
    if (!importPreview) return;
    const current = dedupeLeads(normalizeLeadCollection(leads));
    const combined = dedupeLeads([...current, ...importPreview.valid]);
    const added = Math.max(0, combined.length - current.length);
    const searches = readLocalArray('sigma_searches');
    const nextSearches = [
      ...searches.filter((item) => String(item?.id) !== importPreview.batchId),
      {
        id: importPreview.batchId,
        label: `Importação · ${importPreview.fileName}`,
        source: 'spreadsheet',
        timestamp: Date.now(),
      },
    ];

    localStorage.setItem('sigma_leads', JSON.stringify(combined));
    localStorage.setItem('sigma_leads_initialized', 'true');
    localStorage.setItem('sigma_searches', JSON.stringify(nextSearches));
    setLeads(combined);
    window.dispatchEvent(new CustomEvent('sigma:leads-updated', {
      detail: { leads: combined, searches: nextSearches },
    }));
    addLog?.(`Importação concluída: ${added} leads adicionados de ${importPreview.fileName}.`);
    addNotification({
      type: 'success',
      category: 'system',
      title: 'Importação concluída',
      message: added
        ? `${added} lead${added === 1 ? '' : 's'} tratado${added === 1 ? '' : 's'} e adicionado${added === 1 ? '' : 's'} à base.`
        : 'Não houve novos leads: os registros já estavam na base.',
      duration: 5000,
    });
    setIsImportOpen(false);
    setImportPreview(null);
  };

  const displayChartGroups = useMemo(() => {
    const limit = 12;
    if (chartGroups.length <= limit) return chartGroups;
    const ranked = [...chartGroups].sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label, 'pt-BR'));
    const visible = ranked.slice(0, limit - 1);
    const hidden = ranked.slice(limit - 1);
    return [...visible, { label: `Outros (${hidden.length})`, items: hidden.flatMap(({ items }) => items) }];
  }, [chartGroups]);

  const maxMetricVal = useMemo(() => {
    let max = 1;
    displayChartGroups.forEach(({ items }) => {
      const v = getMetricValue(items, bMet);
      if (v > max) max = v;
    });
    return max;
  }, [displayChartGroups, bMet]);

  const activeKanbanCard = activeLead ? kanbanCardFor(activeLead) : null;

  return (
    <div className="base-leads-view" style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%' }}>
      {/* HERO SECTION — LABORATÓRIO COMERCIAL */}
      <section className="hero-op commerce" data-od-id="base-hero">
        <div className="hero-main">
          <div className="lb">Leads na base</div>
          <div className="big" id="bTotal">{filteredLeads.length}</div>
          <div className="bhero-sub" id="bCtx">
            {filteredLeads.length < leads.length ? `de ${leads.length} na base` : 'leads na base'}
          </div>
        </div>

        <div className="kpis" data-od-id="base-kpis">
          <div className="kpi">
            <div className="lb">Disparadas</div>
            <div className="v" id="bSent">{stats.sent}</div>
          </div>
          <div className="kpi">
            <div className="lb">Taxa resposta</div>
            <div className="v" id="bTaxa">{stats.taxa == null ? '—' : `${Math.round(stats.taxa * 100)}%`}</div>
          </div>
          <div className="kpi">
            <div className="lb">Tempo médio</div>
            <div className="v" id="bTempo">{fmtDur(stats.avgTime)}</div>
          </div>
        </div>

        <div className="hero-contacts" data-od-id="base-channels">
          <span className="hc" title="Com telefone">
            <Phone size={17} /><b>{stats.withTel}</b>
          </span>
          <span className="hc" title="Com WhatsApp">
            <MessageCircle size={17} /><b>{stats.withWa}</b>
          </span>
          <span className="hc" title="Com Instagram">
            <Instagram size={17} /><b>{stats.withIg}</b>
          </span>
          <span className="hc" title="Com site">
            <Globe size={17} /><b>{stats.withSite}</b>
          </span>
          <span className="hc" title="Com e-mail">
            <Mail size={17} /><b>{stats.withMail}</b>
          </span>
          <span className="hc" title="Categorias na base">
            <Tag size={17} /><b>{stats.categoriesCount}</b>
          </span>
          <span className="hc" title="Grupos de leads">
            <Layers size={17} /><b>{stats.groupsCount}</b>
          </span>
          <span className="bperiod" style={{ marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center' }}>
            <select
              value={bPeriod}
              onChange={(e) => setBPeriod(e.target.value)}
              aria-label="Período"
              style={{ background: '#161c19', color: '#e8ece9', border: '1px solid #2a332e', borderRadius: '10px', minHeight: '40px', padding: '0 10px', fontSize: '12.5px' }}
            >
              <option value="all">Todo o período</option>
              <option value="7">Últimos 7 dias</option>
              <option value="15">Últimos 15 dias</option>
              <option value="30">Últimos 30 dias</option>
              <option value="custom">Personalizado</option>
            </select>
            {bPeriod === 'custom' && (
              <span style={{ display: 'inline-flex', gap: '6px' }}>
                <input
                  type="date"
                  value={bD0}
                  onChange={(e) => setBD0(e.target.value)}
                  style={{ background: '#161c19', color: '#e8ece9', border: '1px solid #2a332e', borderRadius: '10px', minHeight: '40px', padding: '0 8px', fontSize: '12px', colorScheme: 'dark' }}
                />
                <input
                  type="date"
                  value={bD1}
                  onChange={(e) => setBD1(e.target.value)}
                  style={{ background: '#161c19', color: '#e8ece9', border: '1px solid #2a332e', borderRadius: '10px', minHeight: '40px', padding: '0 8px', fontSize: '12px', colorScheme: 'dark' }}
                />
              </span>
            )}
          </span>
        </div>
      </section>

      {/* ANÁLISE DA BASE PANEL */}
      <div className={`panel base-analysis-panel ${isBaseAnalysisExpanded ? 'is-expanded' : 'is-collapsed'}`} data-od-id="base-chart">
        <div className="panel-head base-analysis-head">
          <button type="button" className="base-analysis-toggle" onClick={() => setIsBaseAnalysisExpanded((expanded) => !expanded)} aria-expanded={isBaseAnalysisExpanded} aria-controls="base-analysis-content">
            <span><h3>Análise da base</h3>{!isBaseAnalysisExpanded && <small>{filteredLeads.length} leads no recorte</small>}</span>
            {isBaseAnalysisExpanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
          </button>
          {isBaseAnalysisExpanded && <div className="seg" role="group" aria-label="Modo de visualização" style={{ marginLeft: 'auto' }}>
            <button
              type="button"
              aria-pressed={bMode === 'bars'}
              onClick={() => setBMode('bars')}
              title="Barras"
            >
              ☰
            </button>
            <button
              type="button"
              aria-pressed={bMode === 'cols'}
              onClick={() => setBMode('cols')}
              title="Colunas"
            >
              ▮▮
            </button>
            <button
              type="button"
              aria-pressed={bMode === 'list'}
              onClick={() => setBMode('list')}
              title="Lista"
            >
              ⋮
            </button>
          </div>}
        </div>

        {isBaseAnalysisExpanded && <div id="base-analysis-content">
        <div className="mxrow" role="group" aria-label="Dimensão" style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '6px 0 12px' }}>
          <div className="field" style={{ minWidth: '160px' }}>
            <select
              value={bDim}
              onChange={(e) => setBDim(e.target.value)}
              aria-label="Dimensão da análise"
              style={{ minHeight: '38px', borderRadius: '8px' }}
            >
              <option value="cat">Por categoria</option>
              <option value="city">Por cidade</option>
              <option value="hood">Por bairro</option>
              <option value="uf">Por estado</option>
              <option value="chan">Canais de contato</option>
              <option value="grupo">Por grupo</option>
            </select>
          </div>

          <div className="field" style={{ minWidth: '160px' }}>
            <select
              value={bMet}
              onChange={(e) => setBMet(e.target.value)}
              aria-label="Métrica do gráfico"
              style={{ minHeight: '38px', borderRadius: '8px' }}
            >
              <option value="leads">Leads</option>
              <option value="sent">Enviadas</option>
              <option value="replies">Respostas</option>
              <option value="taxa">Taxa resposta</option>
            </select>
          </div>

          <span className="cat-legend on" style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--muted)' }}>
            <span>{filteredLeads.length} leads no recorte</span>
          </span>
        </div>

        <div className="scrollbox" style={{ maxHeight: '264px', overflowY: 'auto' }}>
          {displayChartGroups.length === 0 ? (
            <div className="empty">
              <b>Nada por aqui</b>
              <span>Ajuste os filtros para explorar a base.</span>
            </div>
          ) : bMode === 'cols' ? (
            <div className="cols base-chart-columns" style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', height: '196px', padding: '12px 4px 0' }}>
              {displayChartGroups.map(({ label, items }) => {
                const val = getMetricValue(items, bMet);
                const height = Math.max(6, Math.round((val / maxMetricVal) * 120));
                return (
                  <div key={label} className="col" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                    <span className="cv" style={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }}>{formatMetricValue(bMet, val)}</span>
                    <span className="cb" style={{ height: `${height}px`, width: '100%', maxWidth: '56px', borderRadius: '8px 8px 4px 4px', background: 'var(--accent)' }} />
                    <span className="cn" style={{ fontSize: '11px', color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }} title={label}>
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : bMode === 'list' ? (
            <div className="lrows">
              {displayChartGroups.map(({ label, items }) => {
                const val = getMetricValue(items, bMet);
                return (
                  <div key={label} className="lr" style={{ display: 'flex', alignItems: 'center', padding: '9px 2px', borderBottom: '1px solid var(--border)', fontSize: '13px' }}>
                    <span>{label}</span>
                    <b style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{formatMetricValue(bMet, val)}</b>
                  </div>
                );
              })}
            </div>
          ) : (
            <div>
              {displayChartGroups.map(({ label, items }) => {
                const val = getMetricValue(items, bMet);
                const pct = Math.round((val / maxMetricVal) * 100);
                return (
                  <div key={label} className="bar-row">
                    <span title={label}>{label}</span>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
                    </div>
                    <b>{formatMetricValue(bMet, val)}</b>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        </div>}
      </div>

      {/* TOOLBAR */}
      <div className="bbar" data-od-id="base-toolbar">
        <div className="bsearch">
          <Search size={15} style={{ color: 'var(--meta)' }} />
          <input
            id="baseSearch"
            placeholder="Buscar empresa, telefone, Instagram, cidade…"
            value={bq}
            onChange={(e) => setBq(e.target.value)}
            autoComplete="off"
          />
        </div>

        <button
          type="button"
          className="btn"
          onClick={() => setShowFilters(!showFilters)}
          aria-expanded={showFilters}
        >
          <Filter size={14} /> Filtros {activeFiltersCount > 0 && <span>· {activeFiltersCount}</span>}
        </button>

        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="btn"
            onClick={() => setShowColPop(!showColPop)}
            aria-expanded={showColPop}
          >
            <Columns size={14} /> Colunas
          </button>
          {showColPop && (
            <div className="col-pop" style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 60, background: '#fff', border: '1px solid var(--border)', borderRadius: '12px', padding: '8px', minWidth: '200px', boxShadow: 'var(--elev-raised)' }}>
              {DEFAULT_COLS.map((c) => (
                <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', padding: '6px 8px', cursor: 'pointer', borderRadius: '6px' }}>
                  <input
                    type="checkbox"
                    className="rowcheck"
                    checked={visCols.includes(c.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setVisCols([...visCols, c.id]);
                      } else {
                        if (visCols.length <= 1) return;
                        setVisCols(visCols.filter((x) => x !== c.id));
                      }
                    }}
                  />
                  <span>{c.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <input
          ref={importInputRef}
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={handleImportFile}
          style={{ display: 'none' }}
          aria-hidden="true"
          tabIndex={-1}
        />
        <button
          type="button"
          className="btn"
          data-od-id="base-groups"
          onClick={() => setIsGroupsOpen(true)}
        >
          <Tag size={14} /> Grupos {groups.length > 0 ? <b className="bbar-count">{groups.length}</b> : null}
        </button>

        <button
          type="button"
          className="btn"
          data-od-id="base-import"
          onClick={() => importInputRef.current?.click()}
        >
          <Upload size={14} /> Importar CSV/XLSX
        </button>

        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setIsExportOpen(true)}
        >
          <Download size={14} /> Exportar
        </button>
      </div>

      {/* COLLAPSIBLE FILTERS PANEL */}
      {showFilters && (
        <div className="bfilters">
          <div className="field">
            <label>Categoria</label>
            <select value={bCat} onChange={(e) => setBCat(e.target.value)}>
              <option value="">Todas</option>
              {uniqueCategories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Estado</label>
            <select value={bUf} onChange={(e) => setBUf(e.target.value)}>
              <option value="">Todos</option>
              {uniqueUfs.map((uf) => (
                <option key={uf} value={uf}>{uf}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Cidade</label>
            <select value={bCity} onChange={(e) => setBCity(e.target.value)}>
              <option value="">Todas</option>
              {uniqueCities.map((city) => (
                <option key={city} value={city}>{city}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Bairro</label>
            <select value={bHood} onChange={(e) => setBHood(e.target.value)}>
              <option value="">Todos</option>
              {uniqueHoods.map((hood) => (
                <option key={hood} value={hood}>{hood}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Grupo</label>
            <select value={bGrupo} onChange={(e) => setBGrupo(e.target.value)}>
              <option value="">Todos</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name} ({groupLeadSets.get(String(g.id))?.size || 0})</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Avaliação mínima</label>
            <select value={bRate} onChange={(e) => setBRate(Number(e.target.value))}>
              <option value={0}>Qualquer</option>
              <option value={4}>4,0+</option>
              <option value={4.5}>4,5+</option>
              <option value={4.8}>4,8+</option>
            </select>
          </div>

          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Canais de contato</label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {[
                { ch: 'tel', label: 'Tel' },
                { ch: 'wa', label: 'WA' },
                { ch: 'ig', label: 'IG' },
                { ch: 'site', label: 'Site' },
                { ch: 'mail', label: 'E-mail' },
              ].map(({ ch, label }) => (
                <button
                  key={ch}
                  type="button"
                  className={`tgl ${bChans.includes(ch) ? 'on' : ''}`}
                  onClick={() => handleChannelToggle(ch)}
                  aria-pressed={bChans.includes(ch)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Filtros rápidos <span className="wa-hint">clique para incluir ou excluir</span></label>
            <div className="grp-presets" data-od-id="base-presets">
              {FILTER_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`grp-chip ${presetActive(bSmart, preset) ? 'on' : ''}`}
                  onClick={() => setBSmart((current) => applyPreset(current, preset))}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="grp-channels">
              {CHANNELS.map((channel) => {
                const state = bSmart.channels?.[channel.key] || 'any';
                return (
                  <div className="grp-channel" key={channel.key}>
                    <span className="grp-channel-name">{channel.label}</span>
                    <div className="grp-seg" role="group" aria-label={`Filtro de ${channel.label}`}>
                      {CHANNEL_STATES.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={state === option.value ? 'on' : ''}
                          onClick={() => setBSmart((current) => {
                            const channels = { ...(current.channels || {}) };
                            if (option.value === 'any') delete channels[channel.key];
                            else channels[channel.key] = option.value;
                            return { ...current, channels };
                          })}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="field" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end', gridColumn: '1 / -1' }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={handleClearFilters}>
              Limpar tudo
            </button>
          </div>
        </div>
      )}

      {/* SELECTION BAR */}
      {sel.size > 0 && (
        <div className="selbar" id="selBar">
          <b id="selCount">{sel.size}</b>
          <span>selecionados</span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSel(new Set())} style={{ color: '#fff', borderColor: '#3a4441' }}>
            Limpar
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-sm" onClick={() => openCreateGroup('selection')}>
            Criar grupo
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setIsAddGroupOpen(true)}>
            Adicionar a grupo
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setIsExportOpen(true)}>
            Exportar
          </button>
        </div>
      )}

      {/* TABLE */}
      <div className="table-wrap" data-od-id="base-table">
        <table>
          <thead>
            <tr>
              <th style={{ width: '36px' }}>
                <input
                  type="checkbox"
                  className="rowcheck"
                  id="chkAll"
                  checked={filteredLeads.length > 0 && filteredLeads.every((l, idx) => sel.has(getLeadId(l, idx)))}
                  onChange={(e) => toggleSelectAll(e.target.checked)}
                  aria-label="Selecionar todos"
                />
              </th>
              {visCols.map((colId) => {
                const col = DEFAULT_COLS.find((c) => c.id === colId);
                const isSorted = bSort.key === colId;
                return (
                  <th
                    key={colId}
                    onClick={() => handleSort(colId)}
                    style={{ cursor: 'pointer' }}
                    className={colId === 'av' ? 'num' : ''}
                  >
                    {col?.label}
                    {isSorted && (bSort.dir === 1 ? ' ▲' : ' ▼')}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {paginatedRows.length === 0 ? (
              <tr>
                <td colSpan={visCols.length + 1}>
                  <div className="empty">
                    <b>Nenhum lead encontrado</b>
                    <span>Tente alterar os termos de busca ou filtros.</span>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedRows.map((l, idx) => {
                const id = getLeadId(l, idx);
                const isSelected = sel.has(id);
                const st = statusPresentation(l, id);

                return (
                  <tr key={id} className={isSelected ? 'selrow' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        className="rowcheck"
                        checked={isSelected}
                        onChange={(e) => toggleSelectLead(id, e.target.checked)}
                        aria-label={`Selecionar ${getLeadName(l)}`}
                      />
                    </td>
                    {visCols.map((colId) => {
                      if (colId === 'nome') {
                        return (
                          <td key={colId}>
                            <b
                              style={{ cursor: 'pointer', color: 'var(--teal-deep)' }}
                              onClick={() => {
                                setActiveLead(l);
                                setLeadModalTab('dados');
                              }}
                            >
                              {getLeadName(l)}
                            </b>
                          </td>
                        );
                      }
                      if (colId === 'status') {
                        return (
                          <td key={colId}>
                            <span
                              className="st-ic"
                              style={{ background: `${st.color}18`, borderColor: st.color, color: st.color }}
                              title={`Kanban: ${st.label}`}
                            >
                              {st.symbol}
                            </span>
                          </td>
                        );
                      }
                      if (colId === 'grupos') {
                        const myGrps = leadGroups(l);
                        return (
                          <td key={colId}>
                            {myGrps.length === 0 ? (
                              <span style={{ fontSize: '12.5px', color: 'var(--muted)' }}>—</span>
                            ) : (
                              myGrps.map((g) => (
                                <span key={g.id} className="gchip">
                                  <span>{g.name}</span>
                                  <button
                                    type="button"
                                    onClick={() => removeLeadFromGroup(l, g.id)}
                                    title="Remover deste grupo"
                                  >
                                    ×
                                  </button>
                                </span>
                              ))
                            )}
                          </td>
                        );
                      }
                      if (colId === 'cat') return <td key={colId}>{getLeadCat(l)}</td>;
                      if (colId === 'tel' || colId === 'wa') {
                        const tel = getLeadTel(l);
                        return <td key={colId} data-sensitive-phone="true">{tel ? <button type="button" className="phone-link-btn" onClick={(event) => { event.stopPropagation(); askToMessage(l); }} title="Enviar mensagem via WhatsApp"><Phone size={14} /><span>{tel}</span></button> : '—'}</td>;
                      }
                      if (colId === 'ig') return <td key={colId}>{getLeadIg(l) || '—'}</td>;
                      if (colId === 'site') {
                        const site = getLeadSite(l);
                        return <td key={colId}>{site ? <button type="button" className="site-icon-btn" title={site} aria-label={`Abrir site ${site}`} onClick={(event) => { event.stopPropagation(); window.electronAPI?.openSite?.(site); }}><Globe size={15} /></button> : '—'}</td>;
                      }
                      if (colId === 'mail') return <td key={colId}>{getLeadMail(l) || '—'}</td>;
                      if (colId === 'av') return <td key={colId} className="num">{getLeadRating(l)} ({getLeadReviews(l)})</td>;
                      if (colId === 'uf') return <td key={colId}>{getLeadUf(l) || '—'}</td>;
                      if (colId === 'city') return <td key={colId}>{getLeadCity(l) || '—'}</td>;
                      if (colId === 'hood') return <td key={colId}>{getLeadHood(l) || '—'}</td>;
                      if (colId === 'orig') return <td key={colId}>{getLeadOrig(l)}</td>;
                      return <td key={colId}>—</td>;
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        <div className="pager" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '12px' }}>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setBPage(Math.max(1, bPage - 1))}
            disabled={bPage <= 1}
            aria-label="Página anterior"
          >
            ←
          </button>
          <span style={{ fontSize: '12.5px', color: 'var(--muted)' }}>
            Página {bPage} de {totalPages} · {filteredLeads.length} leads
          </span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setBPage(Math.min(totalPages, bPage + 1))}
            disabled={bPage >= totalPages}
            aria-label="Próxima página"
          >
            →
          </button>
        </div>
      </div>

      {/* MODAL IMPORTAR */}
      {isImportOpen && importPreview && (
        <div className="overlay on modal-overlay" onClick={() => { setIsImportOpen(false); setImportPreview(null); }}>
          <div className="modal modal-content" onClick={(e) => e.stopPropagation()} style={{ width: 'min(560px, 94vw)' }}>
            <div className="modal-head">
              <div>
                <div className="eyebrow">Prévia da importação</div>
                <h2 style={{ marginTop: 4 }}>Revisar leads</h2>
              </div>
              <button type="button" className="icon-btn" aria-label="Fechar importação" onClick={() => { setIsImportOpen(false); setImportPreview(null); }}><X size={16} /></button>
            </div>
            <div className="modal-body" style={{ gridTemplateColumns: '1fr', gap: 14 }}>
              <div className="import-file-summary">
                <FileSpreadsheet size={18} aria-hidden="true" />
                <span><b>{importPreview.fileName}</b><small>Aba: {importPreview.sheetName}</small></span>
              </div>
              <div className="import-preview-grid" aria-label="Resumo da importação">
                <span><b>{importPreview.totalRows}</b><small>linhas lidas</small></span>
                <span><b>{importPreview.added}</b><small>novos leads</small></span>
                <span><b>{importPreview.duplicateRows}</b><small>duplicados</small></span>
                <span><b>{importPreview.invalidRows}</b><small>sem empresa</small></span>
              </div>
              <p className="import-helper">Os campos conhecidos são tratados, o texto é normalizado e duplicados por empresa/endereço não são inseridos. Os valores originais permanecem no registro para auditoria.</p>
              <div className="import-preview-list" aria-label="Primeiros leads válidos">
                {importPreview.valid.slice(0, 5).map((lead) => (
                  <div key={lead.id}><b>{lead.name}</b><span>{[lead.category, lead.city, lead.state].filter(Boolean).join(' · ') || 'Sem localização'}</span></div>
                ))}
                {importPreview.valid.length > 5 && <small>+ {importPreview.valid.length - 5} registros na prévia</small>}
              </div>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => { setIsImportOpen(false); setImportPreview(null); }}>Cancelar</button>
              <button type="button" className="btn btn-primary" onClick={handleConfirmImport}><Check size={15} /> Inserir {importPreview.added} lead{importPreview.added === 1 ? '' : 's'}</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL EXPORTAR */}
      {isExportOpen && (
        <div className="overlay on" onClick={() => setIsExportOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(560px, 94vw)' }}>
            <div className="modal-head">
              <h2>Exportar leads</h2>
            </div>
            <div className="modal-body" style={{ gridTemplateColumns: '1fr', gap: '12px' }}>
              <div className="exp-sec">Formato</div>
              <div>
                {[
                  { f: 'xlsx', name: 'Excel', desc: '.xlsx · planilha' },
                  { f: 'csv', name: 'CSV', desc: '.csv · texto' },
                  { f: 'json', name: 'JSON', desc: '.json · dados' }
                ].map((item) => (
                  <div
                    key={item.f}
                    className={`exp-row ${expFmt === item.f ? 'sel' : ''}`}
                    onClick={() => setExpFmt(item.f)}
                  >
                    <b>{item.name}</b>
                    <span>{item.desc}</span>
                  </div>
                ))}
              </div>

              <div className="exp-sec">Dados</div>
              <div>
                {[
                  { s: 'filtered', name: 'Resultado filtrado', count: `${filteredLeads.length} leads` },
                  { s: 'selected', name: 'Selecionados', count: `${sel.size} leads` },
                  { s: 'all', name: 'Base inteira', count: `${leads.length} leads` }
                ].map((item) => (
                  <div
                    key={item.s}
                    className={`exp-row ${expScope === item.s ? 'sel' : ''}`}
                    onClick={() => setExpScope(item.s)}
                  >
                    <b>{item.name}</b>
                    <span>{item.count}</span>
                  </div>
                ))}
              </div>

              <div className="exp-sec">Colunas</div>
              <div>
                {[
                  { c: 'vis', name: 'Apenas visíveis', count: `${visCols.length} colunas` },
                  { c: 'all', name: 'Todas as colunas', count: `${DEFAULT_COLS.length} colunas` }
                ].map((item) => (
                  <div
                    key={item.c}
                    className={`exp-row ${expColsScope === item.c ? 'sel' : ''}`}
                    onClick={() => setExpColsScope(item.c)}
                  >
                    <b>{item.name}</b>
                    <span>{item.count}</span>
                  </div>
                ))}
              </div>

              <div className="estimate full">
                <b>
                  {expScope === 'all' ? leads.length : expScope === 'selected' ? sel.size : filteredLeads.length} leads serão exportados
                </b>
                <span> em {expFmt.toUpperCase()} · {expColsScope === 'vis' ? 'colunas visíveis' : 'todas as colunas'}</span>
              </div>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setIsExportOpen(false)}>
                Cancelar
              </button>
              <button type="button" className="btn btn-primary" onClick={handleExport}>
                Exportar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL GRUPOS */}
      {isGroupsOpen && (
        <div className="overlay on" onClick={() => setIsGroupsOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(560px, 94vw)' }}>
            <div className="modal-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <h2 style={{ flex: 1 }}>Grupos de leads</h2>
                <span className="result-count">{groups.length} grupo{groups.length === 1 ? '' : 's'}</span>
              </div>
            </div>
            <div className="modal-body" style={{ gridTemplateColumns: '1fr', gap: '12px' }}>
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)' }}>
                Os grupos aparecem no Lead Scoring e no assistente de campanha automaticamente.
              </p>
              <button type="button" className="btn btn-primary" data-od-id="groups-create" onClick={() => openCreateGroup()}>
                <Tag size={14} /> Criar grupo com filtros
              </button>

              {groups.length === 0 ? (
                <div className="empty">
                  <b>Nenhum grupo ainda</b>
                  <span>Crie um grupo filtrando a base — por exemplo, só leads com WhatsApp e sem site.</span>
                </div>
              ) : (
                <div className="grp-manage-list">
                  {groups.map((g) => {
                    const count = groupLeadSets.get(String(g.id))?.size || 0;
                    return (
                      <div className="grp-manage-row" key={g.id}>
                        <div>
                          <b>{g.name}</b>
                          <span>
                            {count} lead{count === 1 ? '' : 's'}
                            {g.description ? ` · ${g.description}` : ''}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => {
                            setBGrupo(g.id);
                            setIsGroupsOpen(false);
                          }}
                        >
                          Ver na base
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Excluir grupo ${g.name}`}
                          title="Excluir grupo"
                          onClick={() => {
                            setGroups((prev) => prev.filter((item) => item.id !== g.id));
                            if (bGrupo === g.id) setBGrupo('');
                            addLog?.(`[GRUPO] “${g.name}” excluído.`);
                          }}
                        >
                          <X size={15} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setIsGroupsOpen(false)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CRIAR GRUPO */}
      {isCreateGroupOpen && (
        <div className="overlay on" onClick={() => setIsCreateGroupOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(620px, 94vw)' }}>
            <div className="modal-head">
              <h2>Criar grupo</h2>
            </div>
            <div className="modal-body" style={{ gridTemplateColumns: '1fr', gap: '12px' }}>
              <div className="field">
                <label htmlFor="grpName">Nome do grupo</label>
                <input
                  id="grpName"
                  placeholder="Ex.: Advogados sem site — Rio de Janeiro"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="grp-modes" role="tablist" aria-label="Como escolher os leads">
                <button
                  type="button"
                  role="tab"
                  aria-selected={groupMode === 'selection'}
                  className={groupMode === 'selection' ? 'on' : ''}
                  onClick={() => setGroupMode('selection')}
                >
                  Selecionados <b>{sel.size}</b>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={groupMode === 'filter'}
                  className={groupMode === 'filter' ? 'on' : ''}
                  onClick={() => setGroupMode('filter')}
                >
                  Filtrar a base <b>{groupCandidates.length}</b>
                </button>
              </div>

              {groupMode === 'selection' ? (
                <div className="estimate full">
                  <b>{sel.size} lead(s) selecionado(s) na tabela entram neste grupo.</b>
                </div>
              ) : (
                <>
                  <div>
                    <div className="grp-filters-title">Atalhos</div>
                    <div className="grp-presets" data-od-id="group-presets">
                      {FILTER_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          className={`grp-chip ${presetActive(groupFilters, preset) ? 'on' : ''}`}
                          onClick={() => setGroupFilters((current) => applyPreset(current, preset))}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="grp-filters-title">Refinar por canal</div>
                    <div className="grp-channels" id="grpChannels">
                      {CHANNELS.map((channel) => {
                        const state = groupFilters.channels?.[channel.key] || 'any';
                        return (
                          <div className="grp-channel" key={channel.key}>
                            <span className="grp-channel-name">{channel.label}</span>
                            <div className="grp-seg" role="group" aria-label={`Filtro de ${channel.label}`}>
                              {CHANNEL_STATES.map((option) => (
                                <button
                                  key={option.value}
                                  type="button"
                                  className={state === option.value ? 'on' : ''}
                                  onClick={() => setGroupFilters((current) => {
                                    const channels = { ...(current.channels || {}) };
                                    if (option.value === 'any') delete channels[channel.key];
                                    else channels[channel.key] = option.value;
                                    return { ...current, channels };
                                  })}
                                >
                                  {option.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grp-extra">
                    <label className="field">
                      <span>Nota mínima</span>
                      <input
                        type="number"
                        min="0"
                        max="5"
                        step="0.5"
                        value={groupFilters.minRating || ''}
                        placeholder="0"
                        onChange={(e) => setGroupFilters((current) => ({ ...current, minRating: Number(e.target.value) || 0 }))}
                      />
                    </label>
                    <label className="field">
                      <span>Cidade</span>
                      <input
                        value={groupFilters.city || ''}
                        placeholder="Qualquer"
                        onChange={(e) => setGroupFilters((current) => ({ ...current, city: e.target.value }))}
                      />
                    </label>
                    <label className="field">
                      <span>Categoria</span>
                      <input
                        value={groupFilters.category || ''}
                        placeholder="Qualquer"
                        onChange={(e) => setGroupFilters((current) => ({ ...current, category: e.target.value }))}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn-ghost btn-compact"
                      disabled={!hasActiveFilters(groupFilters)}
                      onClick={() => setGroupFilters(emptyFilters())}
                    >
                      Limpar filtros
                    </button>
                  </div>

                  <div className="grp-preview" data-od-id="group-preview">
                    <b>{groupCandidates.length} lead(s) entram neste grupo.</b>
                    {groupCandidates.length > 0 ? (
                      <span>{groupCandidates.slice(0, 6).map((l) => getLeadName(l)).join(' · ')}{groupCandidates.length > 6 ? ` +${groupCandidates.length - 6}` : ''}</span>
                    ) : (
                      <span>Nenhum lead da base atende esta combinação — ajuste os filtros.</span>
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setIsCreateGroupOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={groupSelectionCount === 0}
                onClick={handleCreateGroup}
              >
                Criar grupo com {groupSelectionCount} lead{groupSelectionCount === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL ADICIONAR A GRUPO */}
      {isAddGroupOpen && (
        <div className="overlay on" onClick={() => setIsAddGroupOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(440px, 94vw)' }}>
            <div className="modal-head">
              <h2>Adicionar a grupo</h2>
            </div>
            <div className="modal-body" style={{ gridTemplateColumns: '1fr', gap: '12px' }}>
              <div className="field">
                <label>Buscar grupo</label>
                <input
                  placeholder="Digite para buscar…"
                  value={groupSearch}
                  onChange={(e) => setGroupSearch(e.target.value)}
                  autoFocus
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '240px', overflowY: 'auto' }}>
                {groups
                  .filter((g) => !groupSearch || norm(g.name).includes(norm(groupSearch)))
                  .map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      className="grp-row"
                      onClick={() => handleAddToGroup(g.id)}
                    >
                      <b>{g.name}</b>
                      <span>{groupLeadSets.get(String(g.id))?.size || 0} leads</span>
                    </button>
                  ))}
              </div>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setIsAddGroupOpen(false)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DETALHES DO LEAD */}
      {phonePromptLead && (
        <div className="overlay on modal-overlay" role="presentation" onClick={() => setPhonePromptLead(null)}>
          <div className="modal modal-content phone-message-modal" role="dialog" aria-modal="true" aria-labelledby="phoneMessageTitle" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head"><div className="eyebrow">WhatsApp</div><h2 id="phoneMessageTitle">Enviar mensagem?</h2></div>
            <div className="modal-body" style={{ gridTemplateColumns: '1fr' }}>
              <p>Deseja abrir uma nova conversa com <b>{getLeadName(phonePromptLead)}</b>?</p>
              <p className="phone-message-number" data-sensitive-phone="true">{getLeadTel(phonePromptLead)}</p>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setPhonePromptLead(null)}>Não agora</button>
              <button type="button" className="btn btn-primary" onClick={startWhatsAppFromBase}>Sim, abrir WhatsApp</button>
            </div>
          </div>
        </div>
      )}

      {activeLead && (
        <div className="overlay on" onClick={() => setActiveLead(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(560px, 94vw)' }}>
            <div className="modal-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <h2 style={{ flex: 1 }}>{getLeadName(activeLead)}</h2>
                <span className="st-ic" style={{ background: `${statusPresentation(activeLead, getLeadId(activeLead, 0)).color}18`, borderColor: statusPresentation(activeLead, getLeadId(activeLead, 0)).color, color: statusPresentation(activeLead, getLeadId(activeLead, 0)).color }} title={`Kanban: ${statusPresentation(activeLead, getLeadId(activeLead, 0)).label}`}>
                  {statusPresentation(activeLead, getLeadId(activeLead, 0)).symbol}
                </span>
              </div>
            </div>

            <div className="modal-body" style={{ gridTemplateColumns: '1fr', gap: '12px' }}>
              <div className="ltabs">
                <button
                  type="button"
                  className={leadModalTab === 'dados' ? 'on' : ''}
                  onClick={() => setLeadModalTab('dados')}
                >
                  Dados
                </button>
                <button
                  type="button"
                  className={leadModalTab === 'scoring' ? 'on' : ''}
                  onClick={() => setLeadModalTab('scoring')}
                >
                  Scoring
                </button>
              </div>

              {leadModalTab === 'dados' ? (
                <div>
                  <div className="det-grid">
                    <div>
                      <div className="lb">Categoria</div>
                      <div className="v">{getLeadCat(activeLead)}</div>
                    </div>
                    <div>
                      <div className="lb">Localização</div>
                      <div className="v">{getLeadHood(activeLead)} — {getLeadCity(activeLead)}/{getLeadUf(activeLead)}</div>
                    </div>
                    <div>
                      <div className="lb">Telefone</div>
                      <div className="v" data-sensitive-phone="true">{getLeadTel(activeLead) || '—'}</div>
                    </div>
                    <div>
                      <div className="lb">Instagram</div>
                      <div className="v">{getLeadIg(activeLead) || '—'}</div>
                    </div>
                    <div>
                      <div className="lb">Site</div>
                      <div className="v">{getLeadSite(activeLead) || '—'}</div>
                    </div>
                    <div>
                      <div className="lb">E-mail</div>
                      <div className="v">{getLeadMail(activeLead) || '—'}</div>
                    </div>
                    <div>
                      <div className="lb">Avaliação</div>
                      <div className="v">{getLeadRating(activeLead)} · ${getLeadReviews(activeLead)} avaliações</div>
                    </div>
                  </div>

                  {activeKanbanCard && (
                    <section className="lead-crm-summary" aria-labelledby="lead-crm-title">
                      <div className="exp-sec" id="lead-crm-title">Atividade comercial</div>
                      <div className="lead-crm-grid">
                        <div><span>Mensagem recebida</span><b>{activeKanbanCard.messageSentAt ? fmtDate(activeKanbanCard.messageSentAt) : '—'}</b></div>
                        <div><span>Resposta</span><b>{activeKanbanCard.repliedAt ? fmtDate(activeKanbanCard.repliedAt) : '—'}</b></div>
                        <div><span>Valor do negócio</span><b>{Number(activeKanbanCard.dealValue) > 0 ? `R$ ${Number(activeKanbanCard.dealValue).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}</b></div>
                        <div><span>Lembrete</span><b>{activeKanbanCard.reminderAt ? fmtDate(activeKanbanCard.reminderAt) : '—'}</b></div>
                      </div>
                    </section>
                  )}

                  <div className="exp-sec" style={{ marginTop: '16px' }}>Grupos</div>
                  <div>
                    {leadGroups(activeLead).length === 0 ? (
                      <span style={{ fontSize: '13px', color: 'var(--muted)' }}>Nenhum grupo atribuído.</span>
                    ) : (
                      leadGroups(activeLead).map((g) => (
                        <span key={g.id} className="gchip">
                          <span>{g.name}</span>
                          <button
                            type="button"
                            onClick={() => removeLeadFromGroup(activeLead, g.id)}
                          >
                            ×
                          </button>
                        </span>
                      ))
                    )}
                  </div>

                  <div className="field" style={{ marginTop: '8px' }}>
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) {
                          addLeadToGroup(activeLead, e.target.value);
                        }
                      }}
                    >
                      <option value="">Adicionar a grupo…</option>
                      {groups
                        .filter((g) => !groupLeadSets.get(String(g.id))?.has(activeLead))
                        .map((g) => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                    </select>
                  </div>

                  <div className="exp-sec" style={{ marginTop: '16px' }}>Histórico</div>
                  <div className="tl">
                    {(hist[getLeadId(activeLead, 0)] || []).length === 0 && leadGroups(getLeadId(activeLead, 0)).length === 0 ? (
                      <div className="empty">
                        <b>Sem histórico ainda</b>
                        <span>Nenhum contato registrado com este lead.</span>
                      </div>
                    ) : (
                      <>
                        {(hist[getLeadId(activeLead, 0)] || []).map((e, ix) => (
                          <div key={ix} className="tl-ev">
                            <span className={`tl-dot ${e.k === 'reply' ? 'reply' : 'sent'}`}>
                              {e.k === 'reply' ? '↩' : '→'}
                            </span>
                            <div className="tl-body">
                              <b>{e.k === 'reply' ? 'Resposta recebida' : 'Mensagem enviada'}</b>
                              <div className="tl-meta">{fmtDate(e.ts)} {e.wa ? `· ${e.wa}` : ''} {e.camp ? `· ${e.camp}` : ''}</div>
                              <div className="tl-text">“{e.text}”</div>
                            </div>
                          </div>
                        ))}
                        {leadGroups(getLeadId(activeLead, 0)).map((g) => (
                          <div key={g.id} className="tl-ev">
                            <span className="tl-dot sys">◈</span>
                            <div className="tl-body">
                              <b>Entrou no grupo</b>
                              <div className="tl-meta">{g.name} · {fmtDate(g.created)}</div>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="exp-sec">Por que esse score?</div>
                  {baseScoreFor(activeLead) ? (
                    (() => {
                      const a = baseScoreFor(activeLead);
                      const band = a.band;
                      return (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '6px' }}>
                            <span style={{ fontFamily: 'var(--font-display)', fontSize: '40px', lineHeight: 1 }}>{a.score}</span>
                            <span className={`ftag ${band}`}>{a.bandLabel}</span>
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '10px' }}>
                            {a.preset || 'Auditoria'} · {fmtDate(a.ts)} {a.provider ? `· ${a.provider}` : ''}
                          </div>

                          {a.pos?.length > 0 && (
                            <div className="acc open" style={{ marginBottom: '8px' }}>
                              <div className="acc-head" style={{ padding: '8px 12px', background: 'var(--surface-warm)', fontWeight: 600, fontSize: '13px' }}>
                                Pontos positivos ({a.pos.length})
                              </div>
                              <div className="acc-body" style={{ display: 'block' }}>
                                <ul>
                                  {a.pos.map((p, i) => <li key={i}>{p}</li>)}
                                </ul>
                              </div>
                            </div>
                          )}

                          {a.neg?.length > 0 && (
                            <div className="acc open" style={{ marginBottom: '8px' }}>
                              <div className="acc-head" style={{ padding: '8px 12px', background: 'var(--surface-warm)', fontWeight: 600, fontSize: '13px' }}>
                                Problemas encontrados ({a.neg.length})
                              </div>
                              <div className="acc-body" style={{ display: 'block' }}>
                                <ul>
                                  {a.neg.map((n, i) => <li key={i}>{n}</li>)}
                                </ul>
                              </div>
                            </div>
                          )}

                          {a.opp?.length > 0 && (
                            <div className="acc open" style={{ marginBottom: '8px' }}>
                              <div className="acc-head" style={{ padding: '8px 12px', background: 'var(--surface-warm)', fontWeight: 600, fontSize: '13px' }}>
                                Oportunidades ({a.opp.length})
                              </div>
                              <div className="acc-body" style={{ display: 'block' }}>
                                <ul>
                                  {a.opp.map((o, i) => <li key={i}>{o}</li>)}
                                </ul>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()
                  ) : (
                    <div className="empty">
                      <b>Não analisado</b>
                      <span>Sem score salvo para este lead. A análise investiga site, contato e reputação no Google.</span>
                      <button
                        type="button"
                        className="btn btn-primary btn-compact"
                        disabled={scoringBusyId === activeLead.id}
                        onClick={() => handleAnalyzeLead(activeLead)}
                      >
                        {scoringBusyId === activeLead.id ? 'Analisando…' : 'Analisar agora'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setActiveLead(null)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
