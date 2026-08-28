import React, { useState, useEffect, useMemo } from 'react';
import CollapsibleText, { HelpTip } from './CollapsibleText';
import {
  Target,
  Settings,
  Download,
  Play,
  CheckCircle,
  AlertTriangle,
  Image,
  X,
  Sparkles,
  Zap,
  SlidersHorizontal,
  Copy,
  MessageCircle,
  Phone,
  ExternalLink,
  Lightbulb,
  TrendingUp,
  ShieldCheck,
  Clock,
  Smartphone,
  MousePointerClick,
  HelpCircle,
  ChevronRight,
  Ban,
  Gift,
  KeyRound,
  ArrowRight,
  ArrowLeft,
  Rocket,
  Trash2,
  FolderPlus,
  Folder,
  Layers,
  CheckSquare,
  Square,
  Search
} from 'lucide-react';

/* ─── Labels em linguagem simples ─── */
const STATUS_LABELS = {
  not_contacted: 'Ainda não contatei',
  sem_contato: 'Ainda não contatei',
  contacted: 'Já contatei',
  responded: 'Respondeu',
  meeting: 'Reunião marcada',
  agendado: 'Reunião marcada',
  proposal: 'Proposta enviada',
  closed: 'Fechou negócio',
  fechado: 'Fechou negócio',
  lost: 'Perdido',
  perdido: 'Perdido',
  qualified: 'Boa oportunidade',
  qualificado: 'Boa oportunidade',
  oportunidade: 'Boa oportunidade'
};

const STATUS_ALIASES = {
  sem_contato: 'not_contacted',
  oportunidade: 'qualified',
  qualificado: 'qualified',
  agendado: 'meeting',
  fechado: 'closed',
  perdido: 'lost'
};

const PRIORITY_META = {
  alta: {
    label: 'Ligar primeiro',
    short: 'Alta',
    tone: 'high',
    tip: 'Tem site com falhas (sem pixel, inseguro, ruim no celular, sem WhatsApp…). Aborde agora.'
  },
  boa: {
    label: 'Vale a pena',
    short: 'Boa',
    tone: 'good',
    tip: 'Boa chance de negócio. Inclua na fila de contatos.'
  },
  baixa: {
    label: 'Depois',
    short: 'Baixa',
    tone: 'low',
    tip: 'Pode esperar. Foque nos de prioridade maior.'
  },
  ignorar: {
    label: 'Pular por agora',
    short: 'Ignorar',
    tone: 'skip',
    tip: 'Pouca chance no momento. Deixe de lado.'
  }
};

const AI_ONBOARD_SKIP_KEY = 'sigma_ls_ai_onboard_skipped';

function leadWebsiteValue(lead) {
  return String(lead?.company?.website || lead?.website || '').trim();
}

function isInstagramUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    return /(^|\.)instagram\.com$/i.test(url.hostname.replace(/^www\./i, ''));
  } catch {
    return /instagram\.com/i.test(raw);
  }
}

function leadInstagramValue(lead) {
  const instagram = String(lead?.company?.instagram || lead?.instagram || '').trim();
  const website = leadWebsiteValue(lead);
  return instagram || (isInstagramUrl(website) ? website : '');
}

function leadHasWebsite(lead) {
  const website = leadWebsiteValue(lead);
  return !!website && !isInstagramUrl(website);
}

function leadHasInstagram(lead) {
  return !!leadInstagramValue(lead);
}

function leadHasInstagramOnly(lead) {
  return leadHasInstagram(lead) && !leadHasWebsite(lead);
}

const FREE_PROVIDERS = {
  openrouter: {
    value: 'openrouter',
    label: 'OpenRouter',
    badge: 'Grátis',
    model: 'openrouter/free',
    baseUrl: '',
    siteUrl: 'https://sigma-gmaps.local',
    keyUrl: 'https://openrouter.ai/keys',
    signupUrl: 'https://openrouter.ai/',
    steps: [
      'Crie uma conta em openrouter.ai (pode usar Google).',
      'No menu, abra Keys (Chaves) e clique em Create Key (Criar chave).',
      'Copie a chave e cole aqui no app.',
      'Pronto — o modelo gratuito openrouter/free já vem selecionado.'
    ],
    hint: 'Vários modelos num lugar só. Comece pelo plano/modelo gratuito.'
  },
  opencode: {
    value: 'opencode',
    label: 'OpenCode Zen',
    badge: 'Grátis',
    model: 'deepseek-v4-flash-free',
    baseUrl: 'https://opencode.ai/zen/v1',
    siteUrl: '',
    keyUrl: 'https://opencode.ai/auth',
    signupUrl: 'https://opencode.ai/auth',
    steps: [
      'Entre em opencode.ai/auth e faça login.',
      'Copie sua chave de API do OpenCode Zen.',
      'Cole a chave aqui no app.',
      'O modelo gratuito deepseek-v4-flash-free já vem selecionado.'
    ],
    hint: 'Gateway da OpenCode com modelos gratuitos (Zen).'
  }
};

const LEVEL_LABELS = {
  alta: 'Alta',
  alto: 'Alto',
  media: 'Média',
  medio: 'Médio',
  baixa: 'Baixa',
  baixo: 'Baixo'
};

function levelLabel(value) {
  if (!value) return '—';
  return LEVEL_LABELS[String(value).toLowerCase()] || String(value);
}

function priorityMeta(priority) {
  const key = String(priority || '').toLowerCase();
  return PRIORITY_META[key] || PRIORITY_META.baixa;
}

function getStatusLabel(status) {
  return STATUS_LABELS[status] || 'Ainda não contatei';
}

function normalizeStatusValue(status) {
  return STATUS_ALIASES[status] || status || 'not_contacted';
}

function isQualifiedStatus(status) {
  return ['qualified', 'qualificado', 'oportunidade'].includes(status);
}

function formatScore(value) {
  return Number.isFinite(Number(value)) ? `${Number(value)}/100` : 'Aguardando';
}

function formatLoadTime(ms) {
  if (!Number.isFinite(Number(ms)) || Number(ms) <= 0) return null;
  return `${(Number(ms) / 1000).toFixed(1)}s`;
}

function hasAnyPixel(tracking = {}) {
  return !!(tracking.metaPixel || tracking.googleAdsConversion || tracking.tiktokPixel || tracking.linkedinInsight);
}

function buildSiteChecks(lead) {
  const site = lead?.siteAnalysis || {};
  const tracking = site.tracking || {};
  const loadMs = Number(site.performance?.loadTimeMs || 0);
  const loadLabel = formatLoadTime(loadMs);
  const slow = loadMs > 3500;
  const pixelOk = hasAnyPixel(tracking);
  const httpsOk = !!site.hasHttps;
  const mobileOk = site.mobile?.isResponsive !== false;
  const whatsappOk = !!site.conversion?.hasWhatsappButton;
  const formOk = !!site.conversion?.hasForm;

  return [
    {
      ok: pixelOk,
      title: 'Rastreamento de anúncios',
      good: 'Encontramos ferramentas de anúncio (Meta/Google).',
      bad: 'Sem pixel de anúncio — difícil medir se a propaganda funciona.',
      icon: MousePointerClick
    },
    {
      ok: httpsOk,
      title: 'Site seguro (cadeado)',
      good: 'O site tem conexão segura (HTTPS).',
      bad: 'Sem HTTPS — o navegador pode mostrar “não seguro”.',
      icon: ShieldCheck
    },
    {
      ok: !slow,
      title: 'Velocidade do site',
      good: loadLabel ? `Carrega em cerca de ${loadLabel} — ok.` : 'Velocidade parece boa.',
      bad: loadLabel ? `Carrega em ${loadLabel} — lento (muita gente desiste).` : 'Pode estar lento.',
      icon: Clock
    },
    {
      ok: mobileOk,
      title: 'Funciona no celular',
      good: 'Parece se adaptar bem ao celular.',
      bad: 'Pode quebrar ou ficar ruim no celular.',
      icon: Smartphone
    },
    {
      ok: whatsappOk,
      title: 'WhatsApp fácil de achar',
      good: 'Há caminho claro para o WhatsApp.',
      bad: 'WhatsApp não aparece de forma óbvia no site.',
      icon: MessageCircle
    },
    {
      ok: formOk,
      title: 'Pedido de orçamento',
      good: 'Há formulário ou forma de pedir orçamento.',
      bad: 'Sem formulário visível para captar orçamento.',
      icon: Target
    }
  ];
}

function scoreTip(value) {
  const n = Number(value || 0);
  if (n >= 80) return 'Prioridade alta: combine potencial de venda com problemas fáceis de resolver.';
  if (n >= 60) return 'Boa oportunidade: vale incluir na sua fila de contatos.';
  if (n >= 40) return 'Prioridade média/baixa: aborde depois dos melhores.';
  return 'Por enquanto, pouco retorno esperado — foque em outros leads.';
}

/** Garante string segura para o React (evita "Objects are not valid as a React child") */
function safeText(value, fallback = '') {
  if (value == null) return fallback;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((v) => safeText(v, '')).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') {
    // campos comuns de IA/API
    if (value.text != null) return safeText(value.text, fallback);
    if (value.message != null) return safeText(value.message, fallback);
    if (value.label != null) return safeText(value.label, fallback);
    if (value.title != null) return safeText(value.title, fallback);
    try {
      return JSON.stringify(value);
    } catch {
      return fallback || '[dado]';
    }
  }
  return String(value);
}

function cleanList(list) {
  return (Array.isArray(list) ? list : [])
    .map((item) => safeText(item, '').trim())
    .filter(Boolean);
}

async function copyText(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const el = document.createElement('textarea');
    el.value = value;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.left = '-9999px';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

function LeadScoring({ onUpdateScoringCount, addLog }) {
  const [leads, setLeads] = useState([]);
  const [stats, setStats] = useState({
    total: 0,
    highPriority: 0,
    goodOpportunity: 0,
    responded: 0,
    closed: 0,
    closedValue: 0
  });

  const [filters, setFilters] = useState({
    text: '',
    priority: '',
    outcome: '',
    hasWebsite: '',
    hasPhone: '',
    pixelMissing: '',
    speedSlow: '',
    groupId: '',
    searchId: ''
  });

  const [selectedLead, setSelectedLead] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [groups, setGroups] = useState([]);
  const [mapSearches, setMapSearches] = useState([]);
  const [sourceLeads, setSourceLeads] = useState([]);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState('ai');
  const [settings, setSettings] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanMessage, setScanMessage] = useState('');
  const [reportLead, setReportLead] = useState(null);
  const [copyFlash, setCopyFlash] = useState('');
  const [closedValueDraft, setClosedValueDraft] = useState('');
  const [showAiOnboarding, setShowAiOnboarding] = useState(false);
  const [onboardStep, setOnboardStep] = useState(0);
  const [onboardProvider, setOnboardProvider] = useState('openrouter');
  const [onboardApiKey, setOnboardApiKey] = useState('');
  const [onboardSaving, setOnboardSaving] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [showAnalyzeModal, setShowAnalyzeModal] = useState(false);
  const [analyzeSearchId, setAnalyzeSearchId] = useState('');
  const [analyzeOnlyPending, setAnalyzeOnlyPending] = useState(true);
  const [analyzeLimit, setAnalyzeLimit] = useState(1000);
  const [saveAsGroupAfter, setSaveAsGroupAfter] = useState(true);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupModalMode, setGroupModalMode] = useState('create'); // create | from_filters | add
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [targetGroupId, setTargetGroupId] = useState('');

  const getRule = (section, key, fallback = 0) => settings?.rules?.[section]?.[key] ?? fallback;
  const setRule = (section, key, value) => {
    const nextValue = Number.isFinite(Number(value)) ? Number(value) : 0;
    setSettings((prev) => ({
      ...(prev || {}),
      rules: {
        ...((prev && prev.rules) || {}),
        [section]: {
          ...(((prev && prev.rules && prev.rules[section]) || {})),
          [key]: nextValue
        }
      }
    }));
  };

  const aiProviders = [
    { value: 'openrouter', label: 'OpenRouter (grátis)', hint: FREE_PROVIDERS.openrouter.hint },
    { value: 'opencode', label: 'OpenCode Zen (grátis)', hint: FREE_PROVIDERS.opencode.hint },
    { value: 'openai', label: 'OpenAI (ChatGPT)', hint: 'Se você já paga OpenAI' },
    { value: 'custom', label: 'Outro servidor de IA', hint: 'Endpoint compatível com OpenAI no seu PC/servidor' }
  ];
  const getAi = (key, fallback = '') => settings?.ai?.[key] ?? fallback;
  const setAi = (key, value) => {
    setSettings((prev) => ({
      ...(prev || {}),
      ai: {
        ...((prev && prev.ai) || {}),
        [key]: value
      }
    }));
  };
  const aiProviderHints = Object.fromEntries(aiProviders.map((p) => [p.value, p.hint]));
  const aiProviderModels = {
    openrouter: 'openrouter/free',
    opencode: 'deepseek-v4-flash-free',
    openai: 'gpt-4.1-mini',
    custom: 'gpt-4.1-mini'
  };

  const hasAiKey = !!(settings?.ai?.hasApiKey || (settings?.ai?.apiKey && settings.ai.apiKey !== '********'));

  const fetchScoringLeads = async () => {
    if (!window.leadScoringAPI) return;
    try {
      const res = await window.leadScoringAPI.getAll({ ...filters, status: filters.outcome });
      if (res && res.success) {
        setLeads(res.leads || []);
        setStats(res.stats || {
          total: 0,
          highPriority: 0,
          goodOpportunity: 0,
          responded: 0,
          closed: 0,
          closedValue: 0
        });
        onUpdateScoringCount(res.stats?.highPriority || 0);
        setSelectedIds((prev) => prev.filter((id) => (res.leads || []).some((l) => l.id === id)));
      }
    } catch (err) {
      console.error('Erro ao obter leads scoring:', err);
    }
  };

  const fetchGroups = async () => {
    if (!window.leadScoringAPI?.listGroups) return;
    try {
      const res = await window.leadScoringAPI.listGroups();
      if (res && res.success) setGroups(res.groups || []);
    } catch (err) {
      console.error('Erro ao listar grupos:', err);
    }
  };

  const readLocalSources = () => {
    let leadsLocal = [];
    let searchesLocal = [];
    try {
      leadsLocal = JSON.parse(localStorage.getItem('sigma_leads') || '[]');
      if (!Array.isArray(leadsLocal)) leadsLocal = [];
    } catch {
      leadsLocal = [];
    }
    try {
      searchesLocal = JSON.parse(localStorage.getItem('sigma_searches') || '[]');
      if (!Array.isArray(searchesLocal)) searchesLocal = [];
    } catch {
      searchesLocal = [];
    }
    return { leadsLocal, searchesLocal };
  };

  const refreshLocalSources = () => {
    const { leadsLocal, searchesLocal } = readLocalSources();
    setSourceLeads(leadsLocal);
    setMapSearches(searchesLocal);
    return { leadsLocal, searchesLocal };
  };

  const mergeScoringLead = (lead, nextStats) => {
    if (!lead?.id) return;
    setLeads((prev) => {
      const without = prev.filter((item) => item.id !== lead.id);
      const next = (matchesScoringFilters(lead, filters) ? [...without, lead] : without)
        .sort((a, b) => Number(b.score?.value || 0) - Number(a.score?.value || 0));
      return next;
    });
    setSelectedLead((prev) => (prev?.id === lead.id ? lead : prev));
    setReportLead((prev) => (prev?.id === lead.id ? lead : prev));
    if (nextStats) {
      setStats(nextStats);
      onUpdateScoringCount(nextStats.highPriority || 0);
    }
  };

  useEffect(() => {
    fetchScoringLeads();
  }, [filters]);

  useEffect(() => {
    fetchGroups();
    refreshLocalSources();
  }, []);

  useEffect(() => {
    if (!window.leadScoringAPI) {
      setSettingsReady(true);
      return;
    }
    window.leadScoringAPI.getSettings().then((res) => {
      if (res && res.success) {
        const nextSettings = { ...(res.settings || {}) };
        const provider = String(nextSettings.ai?.provider || 'openrouter').toLowerCase();
        // Migra defaults antigos (openai sem chave) para o par gratuito
        if (!nextSettings.ai?.hasApiKey && (!nextSettings.ai?.apiKey || nextSettings.ai.apiKey === '********')) {
          if (!provider || provider === 'openai') {
            nextSettings.ai = {
              ...(nextSettings.ai || {}),
              provider: 'openrouter',
              model: nextSettings.ai?.model || 'openrouter/free',
              siteUrl: nextSettings.ai?.siteUrl || 'https://sigma-gmaps.local',
            };
          }
        }
        if (provider === 'opencode' && !nextSettings.ai?.baseUrl) {
          nextSettings.ai = {
            ...(nextSettings.ai || {}),
            baseUrl: 'https://opencode.ai/zen/v1',
            model: nextSettings.ai?.model || 'deepseek-v4-flash-free',
          };
        }
        setSettings(nextSettings);
        const keyOk = !!(nextSettings.ai?.hasApiKey || (nextSettings.ai?.apiKey && nextSettings.ai.apiKey !== '********'));
        const skipped = localStorage.getItem(AI_ONBOARD_SKIP_KEY) === '1';
        if (!keyOk && !skipped) {
          setShowAiOnboarding(true);
          setOnboardStep(0);
          setOnboardProvider(String(nextSettings.ai?.provider || 'openrouter').toLowerCase() === 'opencode' ? 'opencode' : 'openrouter');
        }
      }
    }).catch((e) => console.error(e)).finally(() => setSettingsReady(true));
  }, []);

  useEffect(() => {
    if (window.leadScoringAPI && typeof window.leadScoringAPI.onProgress === 'function') {
      const cleanup = window.leadScoringAPI.onProgress((payload) => {
        if (payload && Number.isFinite(Number(payload.progress))) {
          setScanProgress(Math.round(payload.progress * 100));
        }
        if (payload?.event === 'saved' && payload.lead) {
          mergeScoringLead(payload.lead, payload.stats);
        }
        const message = payload?.msg || payload?.message;
        if (message) {
          setScanMessage(message);
          addLog(`[SCORING] ${message}`);
        }
      });
      return typeof cleanup === 'function' ? cleanup : undefined;
    }
  }, [addLog, onUpdateScoringCount]);

  useEffect(() => {
    if (selectedLead) {
      setClosedValueDraft(String(selectedLead.prospecting?.dealValue || selectedLead.prospecting?.value || ''));
    }
  }, [selectedLead?.id]);

  const flashCopy = (label) => {
    setCopyFlash(label);
    setTimeout(() => setCopyFlash(''), 1800);
  };

  const handleCopy = async (text, label = 'Copiado!') => {
    const ok = await copyText(text);
    if (ok) {
      flashCopy(label);
      addLog(`[SCORING] ${label}`);
    } else {
      alert('Não foi possível copiar. Selecione o texto e copie manualmente (Ctrl+C).');
    }
  };

  const findSearchMeta = (searchId) => {
    const s = mapSearches.find((x) => String(x.id) === String(searchId));
    return {
      searchId: searchId || '',
      searchLabel: s?.label || s?.query || (searchId === 'importados' ? 'Planilhas importadas' : searchId || 'Sem pesquisa'),
      query: s?.query || s?.label || '',
    };
  };

  const getSearchStats = (searchId) => {
    const fromSearch = sourceLeads.filter((l) => String(l.searchId || '') === String(searchId));
    const withSite = fromSearch.filter(leadHasWebsite);
    const analyzedSites = new Set(
      leads
        .filter((l) => String(l.searchId || '') === String(searchId))
        .map((l) => String(l.company?.website || l.website || '').toLowerCase())
        .filter(Boolean)
    );
    const analyzedIds = new Set(
      leads.filter((l) => String(l.searchId || '') === String(searchId)).map((l) => String(l.id))
    );
    const pending = withSite.filter((l) => {
      const id = String(l.id || '');
      const site = String(l.website || '').toLowerCase();
      return !analyzedIds.has(id) && !analyzedSites.has(site);
    });
    return {
      total: fromSearch.length,
      withSite: withSite.length,
      analyzed: leads.filter((l) => String(l.searchId || '') === String(searchId)).length,
      pending: pending.length,
    };
  };

  const buildAnalyzeInput = (searchId = analyzeSearchId, opts = {}) => {
    // Nunca chamar setState aqui — esta função também roda no render (prévia do modal).
    const { leadsLocal } = opts.leadsLocal
      ? { leadsLocal: opts.leadsLocal }
      : readLocalSources();
    const localLeads = Array.isArray(leadsLocal) ? leadsLocal : sourceLeads;

    const meta = findSearchMeta(searchId);
    let pool = localLeads.filter(leadHasWebsite);

    if (searchId) {
      pool = pool.filter((l) => String(l.searchId || '') === String(searchId));
    }

    if (analyzeOnlyPending) {
      const analyzedSites = new Set(
        leads.map((l) => String(l.company?.website || l.website || '').toLowerCase()).filter(Boolean)
      );
      const analyzedIds = new Set(leads.map((l) => String(l.id)));
      pool = pool.filter((lead) => {
        const id = String(lead.id || '');
        const site = String(lead.website || lead.company?.website || '').toLowerCase();
        return !analyzedIds.has(id) && !analyzedSites.has(site);
      });
    }

    const limit = Math.max(1, Math.min(1000, Number(analyzeLimit) || 1000));
    return pool.slice(0, limit).map((lead) => ({
      ...lead,
      searchId: lead.searchId || meta.searchId,
      searchLabel: meta.searchLabel,
      query: meta.query,
    }));
  };

  const handleAnalyzeVisible = () => {
    const { leadsLocal, searchesLocal } = refreshLocalSources();
    // pré-seleciona pesquisa com mais pendências
    let best = analyzeSearchId || filters.searchId || '';
    if (!best) {
      let bestPending = -1;
      for (const s of searchesLocal) {
        const st = getSearchStats(s.id);
        if (st.pending > bestPending) {
          bestPending = st.pending;
          best = s.id;
        }
      }
      if (!best && leadsLocal.some((l) => l.searchId === 'importados')) {
        best = 'importados';
      }
    }
    setAnalyzeSearchId(best || '');
    setShowAnalyzeModal(true);
  };

  const runSegmentedAnalysis = async () => {
    if (!window.leadScoringAPI) return;
    if (!analyzeSearchId) {
      alert('Escolha uma pesquisa do scraping para analisar.\n\nAs análises ficam organizadas por pesquisa.');
      return;
    }

    const { leadsLocal } = refreshLocalSources();
    const scanInput = buildAnalyzeInput(analyzeSearchId, { leadsLocal });
    if (scanInput.length === 0) {
      alert(
        analyzeOnlyPending
          ? 'Nenhum lead pendente com site nesta pesquisa.\nDesmarque “só pendentes” para reanalisar, ou escolha outra pesquisa.'
          : 'Nenhum lead com site nesta pesquisa.\nRode a busca em “Todos os Leads” e garanta websites.'
      );
      return;
    }

    const meta = findSearchMeta(analyzeSearchId);
    setShowAnalyzeModal(false);
    setIsScanning(true);
    setScanProgress(0);
    setScanMessage(`Analisando ${scanInput.length} sites de “${meta.searchLabel}” (sem janela)...`);
    addLog(`[SCORING] Análise por pesquisa “${meta.searchLabel}”: ${scanInput.length} leads (fetch, sem browser).`);

    try {
      const res = await window.leadScoringAPI.analyzeBatch(scanInput, {
        searchId: meta.searchId,
        searchLabel: meta.searchLabel,
        query: meta.query,
      });
      if (res && res.success) {
        const ok = res.analyzedCount || 0;
        const fail = res.failures || 0;
        addLog(`[SCORING] Análise concluída: ${ok} ok, ${fail} falhas.`);
        setScanMessage(`Pronto! ${ok} analisados de “${meta.searchLabel}”${fail ? `, ${fail} com problema` : ''}.`);

        // filtra a fila pela pesquisa analisada
        setFilters((prev) => ({ ...prev, searchId: meta.searchId }));
        await fetchScoringLeads();
        await fetchGroups();
        refreshLocalSources();

        if (saveAsGroupAfter && ok > 0) {
          // Reusa grupo da mesma pesquisa se já existir; senão cria
          const existing = (await window.leadScoringAPI.listGroups())?.groups?.find(
            (g) => g.segment?.searchId && String(g.segment.searchId) === String(meta.searchId)
          );
          let groupRes;
          if (existing?.id && window.leadScoringAPI.addToGroup) {
            // pega ids analisados desta pesquisa
            const after = await window.leadScoringAPI.getAll({ searchId: meta.searchId });
            const ids = (after?.leads || []).map((l) => l.id);
            groupRes = await window.leadScoringAPI.addToGroup(existing.id, ids);
            if (groupRes?.success) {
              groupRes.group = groupRes.group || existing;
            }
          } else if (window.leadScoringAPI.createGroupFromFilters) {
            groupRes = await window.leadScoringAPI.createGroupFromFilters(
              meta.searchLabel || 'Pesquisa analisada',
              { searchId: meta.searchId },
              { description: `Análises da pesquisa ${meta.searchLabel}` }
            );
          }
          if (groupRes?.success) {
            addLog(`[SCORING] Grupo atualizado: ${groupRes.group?.name} (${groupRes.group?.count || 0} leads).`);
            flashCopy(`Salvo no grupo “${groupRes.group?.name}”`);
            fetchGroups();
            if (groupRes.group?.id) {
              setFilters((prev) => ({ ...prev, groupId: groupRes.group.id, searchId: meta.searchId }));
            }
          }
        }
      } else {
        const message = res?.error || res?.message || 'Erro desconhecido';
        addLog(`[SCORING] Falha na análise: ${message}`);
        alert(`Não consegui concluir a análise:\n${message}`);
      }
    } catch (e) {
      addLog(`[SCORING] Erro na análise batch: ${e.message}`);
      alert(`Erro na análise: ${e.message}`);
    } finally {
      setIsScanning(false);
    }
  };

  const handleClearAnalyses = async (mode = 'all') => {
    if (!window.leadScoringAPI?.clearAnalyses) return;
    if (mode === 'selected') {
      if (!selectedIds.length) {
        alert('Selecione ao menos um lead na lista para remover a análise.');
        return;
      }
      if (!window.confirm(`Remover a análise de ${selectedIds.length} lead(s)?`)) return;
      const res = await window.leadScoringAPI.clearAnalyses({ ids: selectedIds });
      if (res?.success) {
        addLog(`[SCORING] ${res.removed} análise(s) removida(s).`);
        setSelectedIds([]);
        setSelectedLead(null);
        fetchScoringLeads();
        fetchGroups();
        flashCopy('Análises removidas');
      } else {
        alert(res?.error || 'Não foi possível limpar.');
      }
      return;
    }
    if (!window.confirm('Zerar TODAS as análises de scoring?\nIsso não apaga os leads do Google Maps — só o scoring.')) return;
    const res = await window.leadScoringAPI.clearAnalyses({ all: true });
    if (res?.success) {
      addLog(`[SCORING] Base de scoring zerada (${res.removed} removidos).`);
      setLeads([]);
      setSelectedIds([]);
      setSelectedLead(null);
      fetchScoringLeads();
      fetchGroups();
      flashCopy('Scoring zerado');
    } else {
      alert(res?.error || 'Não foi possível zerar.');
    }
  };

  const openCreateGroup = (mode = 'create') => {
    setGroupModalMode(mode);
    setGroupName(mode === 'from_filters' ? 'Fila atual' : 'Meu grupo');
    setGroupDescription('');
    setTargetGroupId(groups[0]?.id || '');
    setShowGroupModal(true);
  };

  const handleSaveGroupModal = async () => {
    if (!window.leadScoringAPI) return;
    try {
      if (groupModalMode === 'add') {
        if (!targetGroupId) {
          alert('Escolha um grupo.');
          return;
        }
        const ids = selectedIds.length ? selectedIds : (selectedLead ? [selectedLead.id] : []);
        if (!ids.length) {
          alert('Selecione leads na lista ou abra um lead.');
          return;
        }
        const res = await window.leadScoringAPI.addToGroup(targetGroupId, ids);
        if (res?.success) {
          flashCopy('Leads salvos no grupo');
          addLog(`[SCORING] ${ids.length} lead(s) adicionados ao grupo.`);
          setShowGroupModal(false);
          fetchGroups();
          fetchScoringLeads();
        } else {
          alert(res?.error || 'Erro ao adicionar ao grupo');
        }
        return;
      }

      if (groupModalMode === 'from_filters') {
        const res = await window.leadScoringAPI.createGroupFromFilters(
          groupName || 'Grupo de análises',
          { ...filters, status: filters.outcome },
          { description: groupDescription }
        );
        if (res?.success) {
          flashCopy(`Grupo “${res.group?.name}” criado`);
          addLog(`[SCORING] Grupo criado com ${res.group?.count || 0} leads (filtros atuais).`);
          setShowGroupModal(false);
          fetchGroups();
          setFilters((prev) => ({ ...prev, groupId: res.group?.id || '' }));
        } else {
          alert(res?.error || 'Erro ao criar grupo');
        }
        return;
      }

      // create from selection (or empty)
      const ids = selectedIds.length ? selectedIds : (selectedLead ? [selectedLead.id] : []);
      const res = await window.leadScoringAPI.createGroup({
        name: groupName || 'Novo grupo',
        description: groupDescription,
        leadIds: ids
      });
      if (res?.success) {
        flashCopy(`Grupo “${res.group?.name}” criado`);
        addLog(`[SCORING] Grupo criado com ${res.group?.count || 0} leads.`);
        setShowGroupModal(false);
        fetchGroups();
        if (res.group?.id) setFilters((prev) => ({ ...prev, groupId: res.group.id }));
      } else {
        alert(res?.error || 'Erro ao criar grupo');
      }
    } catch (e) {
      alert(e.message);
    }
  };

  const handleDeleteGroup = async (groupId) => {
    if (!window.leadScoringAPI?.deleteGroup) return;
    if (!window.confirm('Apagar este grupo?\nAs análises dos leads continuam salvas — só o grupo some.')) return;
    const res = await window.leadScoringAPI.deleteGroup(groupId, { removeLeads: false });
    if (res?.success) {
      if (filters.groupId === groupId) setFilters((prev) => ({ ...prev, groupId: '' }));
      fetchGroups();
      fetchScoringLeads();
      flashCopy('Grupo apagado');
    } else {
      alert(res?.error || 'Erro ao apagar grupo');
    }
  };

  const toggleSelectLead = (id, e) => {
    e?.stopPropagation?.();
    setSelectedIds((prev) => (
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    ));
  };

  const toggleSelectAllVisible = () => {
    if (selectedIds.length && selectedIds.length === leads.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(leads.map((l) => l.id));
    }
  };

  const buildOutcomePatch = (outcome = {}) => {
    const status = normalizeStatusValue(outcome.status);
    const patch = { ...outcome };
    if (status) {
      patch.status = status;
      patch.responded = ['responded', 'meeting', 'proposal', 'closed', 'qualified'].includes(status);
      patch.meetingBooked = status === 'meeting';
      patch.proposalSent = status === 'proposal' || status === 'closed';
      patch.closed = status === 'closed';
    }
    if (outcome.closedValue != null) {
      const n = Number(outcome.closedValue);
      patch.closedValue = Number.isFinite(n) ? n : 0;
    }
    return patch;
  };

  const handleUpdateOutcome = async (leadId, outcome) => {
    if (!window.leadScoringAPI) return;
    try {
      const patch = buildOutcomePatch(outcome);
      const res = await window.leadScoringAPI.updateOutcome(leadId, patch);
      if (res && res.success) {
        fetchScoringLeads();
        if (selectedLead && selectedLead.id === leadId) {
          setSelectedLead((prev) => ({
            ...prev,
            prospecting: { ...(prev.prospecting || {}), ...patch, ...(res.lead?.prospecting || {}) }
          }));
        }
        if (patch.status) {
          addLog(`[SCORING] Status atualizado: ${getStatusLabel(patch.status)}`);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveClosedValue = async () => {
    if (!selectedLead) return;
    const raw = String(closedValueDraft || '').replace(/\./g, '').replace(',', '.');
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      alert('Informe um valor válido em reais (ex: 2500).');
      return;
    }
    await handleUpdateOutcome(selectedLead.id, {
      status: 'closed',
      closedValue: value
    });
    flashCopy('Valor do negócio salvo');
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    if (!window.leadScoringAPI || !settings) return;
    try {
      const res = await window.leadScoringAPI.updateSettings(settings);
      if (res && res.success) {
        setSettings(res.settings || settings);
        setIsSettingsOpen(false);
        if (res.settings?.ai?.hasApiKey) {
          setShowAiOnboarding(false);
          localStorage.removeItem(AI_ONBOARD_SKIP_KEY);
        }
        fetchScoringLeads();
        alert('Configurações salvas!');
      }
    } catch (err) {
      alert('Erro ao salvar: ' + err.message);
    }
  };

  const applyProviderPreset = (providerKey) => {
    const preset = FREE_PROVIDERS[providerKey] || FREE_PROVIDERS.openrouter;
    setOnboardProvider(preset.value);
    setSettings((prev) => ({
      ...(prev || {}),
      ai: {
        ...((prev && prev.ai) || {}),
        provider: preset.value,
        model: preset.model,
        baseUrl: preset.baseUrl || '',
        siteUrl: preset.siteUrl || ((prev && prev.ai && prev.ai.siteUrl) || 'https://sigma-gmaps.local'),
        enabled: true,
      }
    }));
  };

  const handleSkipOnboarding = () => {
    localStorage.setItem(AI_ONBOARD_SKIP_KEY, '1');
    setShowAiOnboarding(false);
    addLog('[SCORING] Onboarding de IA adiado. Você pode configurar depois em Ajustes.');
  };

  const handleFinishOnboarding = async () => {
    if (!window.leadScoringAPI || !settings) return;
    const key = String(onboardApiKey || '').trim();
    if (!key) {
      alert('Cole a chave de API para continuar.\n\nSem chave a análise de site ainda funciona, mas as mensagens e o diagnóstico da IA ficam limitados.');
      return;
    }
    const preset = FREE_PROVIDERS[onboardProvider] || FREE_PROVIDERS.openrouter;
    const fallbackOther = onboardProvider === 'openrouter'
      ? {
          provider: 'opencode',
          enabled: true,
          apiKey: '',
          model: FREE_PROVIDERS.opencode.model,
          baseUrl: FREE_PROVIDERS.opencode.baseUrl,
        }
      : {
          provider: 'openrouter',
          enabled: true,
          apiKey: '',
          model: FREE_PROVIDERS.openrouter.model,
          siteUrl: FREE_PROVIDERS.openrouter.siteUrl,
        };

    setOnboardSaving(true);
    try {
      const patch = {
        ai: {
          ...(settings.ai || {}),
          enabled: true,
          provider: preset.value,
          apiKey: key,
          model: preset.model,
          baseUrl: preset.baseUrl || '',
          siteUrl: preset.siteUrl || settings.ai?.siteUrl || 'https://sigma-gmaps.local',
          fallbackProviders: JSON.stringify([fallbackOther], null, 2),
        }
      };
      const res = await window.leadScoringAPI.updateSettings(patch);
      if (res && res.success) {
        setSettings(res.settings || { ...settings, ...patch });
        setShowAiOnboarding(false);
        localStorage.removeItem(AI_ONBOARD_SKIP_KEY);
        setOnboardApiKey('');
        flashCopy('IA configurada! Pode analisar os sites.');
        addLog(`[SCORING] IA ativada com ${preset.label}.`);
      } else {
        alert(res?.error || res?.message || 'Não foi possível salvar a chave.');
      }
    } catch (err) {
      alert('Erro ao salvar: ' + err.message);
    } finally {
      setOnboardSaving(false);
    }
  };

  const openExternal = (url) => {
    if (!url) return;
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(url);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleExport = async (format) => {
    if (!window.leadScoringAPI) return;
    try {
      const res = await window.leadScoringAPI.export(filters, format);
      if (res && res.success) {
        alert('Arquivo salvo com sucesso!');
      } else {
        alert('Erro ao exportar: ' + (res?.message || 'Erro desconhecido'));
      }
    } catch (e) {
      alert('Erro: ' + e.message);
    }
  };

  const handleCreateCampaign = async () => {
    const qualifiedLeads = leads.filter((l) => isQualifiedStatus(l.prospecting?.status) || l.score?.priority === 'alta' || l.score?.priority === 'boa');
    if (qualifiedLeads.length === 0) {
      alert('Marque leads como “Boa oportunidade” ou analise sites para ter contatos prioritários.');
      return;
    }
    window.dispatchEvent(new CustomEvent('sigma:open-campaign-draft', {
      detail: {
        source: 'lead_scoring',
        name: 'Lead Scoring - Prioritários',
        recipients: qualifiedLeads.map((lead) => ({
          leadId: lead.id, name: lead.company?.name || '', phone: lead.company?.whatsapp || lead.company?.phone || '',
          company: lead.company?.name || '', website: lead.company?.website || '', source: 'lead_scoring',
          score: lead.score?.value || '', prioridade: lead.score?.priority || '',
          mensagem_whatsapp_ia: lead.aiAnalysis?.mensagem_whatsapp || '',
        })),
        template: { text: qualifiedLeads[0]?.aiAnalysis?.mensagem_whatsapp || 'Olá {{name}}, tudo bem?' },
      },
    }));
    addLog(`[CAMPAIGN] Revisão aberta com ${qualifiedLeads.length} leads.`);
  };

  const handleOpenScreenshot = (path) => {
    if (window.leadScoringAPI && path) {
      window.leadScoringAPI.openScreenshot(path);
    }
  };

  const clearFilters = () => {
    setFilters({
      text: '',
      priority: '',
      outcome: '',
      hasWebsite: '',
      hasPhone: '',
      pixelMissing: '',
      speedSlow: '',
      groupId: '',
      searchId: ''
    });
  };

  const searchOptions = useMemo(() => {
    // Sempre clonar — nunca mutar o state mapSearches no render
    const fromMaps = Array.isArray(mapSearches) ? [...mapSearches] : [];
    const ids = new Set(fromMaps.map((s) => String(s.id)));
    for (const l of sourceLeads) {
      const sid = String(l.searchId || '');
      if (sid && !ids.has(sid)) {
        ids.add(sid);
        fromMaps.push({
          id: sid,
          label: sid === 'importados' ? 'Planilhas importadas' : `Pesquisa ${sid}`,
          query: '',
        });
      }
    }
    return fromMaps.reverse();
  }, [mapSearches, sourceLeads]);

  const analyzePreviewCount = useMemo(() => {
    if (!analyzeSearchId || !showAnalyzeModal) return 0;
    try {
      return buildAnalyzeInput(analyzeSearchId).length;
    } catch {
      return 0;
    }
  }, [analyzeSearchId, showAnalyzeModal, analyzeOnlyPending, analyzeLimit, leads, sourceLeads, mapSearches]);

  const selectedPriority = priorityMeta(selectedLead?.score?.priority);
  const selectedScore = Number(
    typeof selectedLead?.score === 'object'
      ? selectedLead?.score?.value
      : selectedLead?.score
  ) || 0;
  const siteChecks = selectedLead ? buildSiteChecks(selectedLead) : [];
  const ai = selectedLead?.aiAnalysis || {};
  const pains = cleanList(ai.principais_dores || ai.problemas_encontrados);
  const opportunities = cleanList(ai.principais_oportunidades);
  const reasons = cleanList(selectedLead?.score?.reasons);
  const objections = Array.isArray(ai.objecoes_provaveis) ? ai.objecoes_provaveis.filter((o) => o?.objecao) : [];

  return (
    <div className="view-column">
      <div className="page-header ls-page-header">
        <div className="info">
          <h1>Quem ligar primeiro</h1>
          <p>
            Analise por <strong>pesquisa do Maps</strong>, salve em grupos e consulte depois.
            Prioridade alta = site com falhas (pixel, HTTPS, celular, WhatsApp…).
          </p>
        </div>
        <div className="toolbar-actions ls-toolbar-actions">
          {settingsReady && !hasAiKey && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => { setShowAiOnboarding(true); setOnboardStep(0); }}
              title="Configurar IA gratuita"
            >
              <Sparkles size={14} /> Configurar IA
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={() => setIsSettingsOpen(true)} title="Ajustes da análise e da IA">
            <Settings size={14} /> Ajustes
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => handleExport('csv')} title="Baixar planilha">
            <Download size={14} /> Planilha
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => openCreateGroup(selectedIds.length ? 'create' : 'from_filters')}
            title="Organizar em grupos"
          >
            <FolderPlus size={14} /> Grupos
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => handleClearAnalyses(selectedIds.length ? 'selected' : 'all')}
            title={selectedIds.length ? 'Remover análises selecionadas' : 'Zerar todas as análises'}
          >
            <Trash2 size={14} /> {selectedIds.length ? 'Limpar sel.' : 'Zerar'}
          </button>
          {!isScanning ? (
            <button type="button" className="btn btn-primary" onClick={handleAnalyzeVisible} title="Analisar sites (headless, sem janela)">
              <Play size={14} /> Analisar sites
            </button>
          ) : (
            <button type="button" className="btn btn-danger" disabled>
              Analisando… {scanProgress}%
            </button>
          )}
        </div>
      </div>

      {isScanning && (
        <div className="ls-progress-banner">
          <div className="ls-progress-bar">
            <div className="ls-progress-fill" style={{ width: `${Math.max(4, scanProgress)}%` }} />
          </div>
          <span>{scanMessage || `Analisando sites… ${scanProgress}%`}</span>
        </div>
      )}

      {copyFlash && (
        <div className="ls-toast" role="status">{copyFlash}</div>
      )}

      {/* Cards resumidos */}
      <div className="ls-stats-wrap">
        <div className="ls-stats-grid">
          {[
            { label: 'Já analisados', value: stats.total || 0, tone: 'accent', hint: 'Sites que o app já olhou' },
            { label: 'Ligar primeiro', value: stats.highPriority || 0, tone: 'success', hint: 'Nota alta — prioridade' },
            { label: 'Vale a pena', value: stats.goodOpportunity || 0, tone: 'info', hint: 'Boas chances de negócio' },
            { label: 'Responderam', value: stats.responded || 0, tone: 'warn', hint: 'Já engajaram com você' },
            { label: 'Fecharam', value: stats.closed || 0, tone: 'success', hint: 'Negócios fechados' },
            { label: 'Faturamento', value: `R$ ${(stats.closedValue || 0).toLocaleString('pt-BR')}`, tone: 'revenue', hint: 'Valor dos fechados' }
          ].map((card) => (
            <div key={card.label} className={`ls-stat ${card.tone}`}>
              <span className="ls-stat-label">{card.label}</span>
              <b className="ls-stat-value">{card.value}</b>
              <span className="ls-stat-hint">{card.hint}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="ls-main-grid">
        {/* Filtros */}
        <aside className="ls-filter-panel">
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <h3 style={{ margin:0 }}>Encontrar leads</h3>
            <HelpTip text="Filtros inteligentes: use para achar quem merece atenção agora. Só 2 visíveis por padrão."><span /></HelpTip>
          </div>

          <label className="ls-field-label">Buscar</label>
          <input
            placeholder="Nome da empresa, cidade…"
            value={filters.text}
            onChange={(e) => setFilters((prev) => ({ ...prev, text: e.target.value }))}
          />

          <label className="ls-field-label">Prioridade</label>
          <select
            value={filters.priority}
            onChange={(e) => setFilters((prev) => ({ ...prev, priority: e.target.value }))}
          >
            <option value="">Todas</option>
            <option value="alta">Ligar primeiro (alta)</option>
            <option value="boa">Vale a pena</option>
            <option value="baixa">Depois (baixa)</option>
            <option value="ignorar">Pular por agora</option>
          </select>

          <button type="button" onClick={() => setShowAdvancedFilters(v=>!v)} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', width:'100%', padding:'7px 10px', borderRadius:6, border:'1px solid var(--border)', background: showAdvancedFilters ? 'var(--surface-2)' : 'var(--surface)', fontSize:12, fontWeight:500, cursor:'pointer', color:'var(--fg)' }}>
            <span style={{ display:'flex', alignItems:'center', gap:6 }}><SlidersHorizontal size={12}/> Filtros avançados</span>
            <span style={{ fontSize:11, color:'var(--muted)', display:'flex', alignItems:'center', gap:6 }}>{showAdvancedFilters ? 'Ocultar' : `${Object.values(filters).filter(Boolean).length ? Object.values(filters).filter(Boolean).length+' ativos' : '6 ocultos'}`} <span style={{ transform: showAdvancedFilters ? 'rotate(180deg)' : 'none', display:'inline-block', transition:'transform 120ms' }}>▾</span></span>
          </button>
          <div style={{ display: showAdvancedFilters ? 'flex' : 'none', flexDirection:'column', gap:10, animation:'viewIn 120ms ease-out' }}>
          <label className="ls-field-label">Como está o contato</label>
          <select
            value={filters.outcome}
            onChange={(e) => setFilters((prev) => ({ ...prev, outcome: e.target.value }))}
          >
            <option value="">Todos</option>
            <option value="not_contacted">Ainda não contatei</option>
            <option value="contacted">Já contatei</option>
            <option value="qualified">Boa oportunidade</option>
            <option value="meeting">Reunião marcada</option>
            <option value="proposal">Proposta enviada</option>
            <option value="closed">Fechou negócio</option>
            <option value="lost">Perdido</option>
          </select>

          <div style={{ display:'flex', alignItems:'center', gap:6 }}><label className="ls-field-label" style={{ margin:0 }}>Presença digital</label><HelpTip text="“Sem site” inclui quem deixou Instagram no campo do site. Use “Instagram no lugar do site” para separar campanha."/></div>
          <select
            value={filters.hasWebsite}
            onChange={(e) => setFilters((prev) => ({ ...prev, hasWebsite: e.target.value }))}
          >
            <option value="">Todos</option>
            <option value="with">Com site próprio</option>
            <option value="without">Sem site</option>
            <option value="instagram_only">Instagram no lugar do site</option>
            <option value="with_instagram">Com Instagram (com ou sem site)</option>
          </select>

          <label className="ls-field-label">Anúncios no site</label>
          <select
            value={filters.pixelMissing}
            onChange={(e) => setFilters((prev) => ({ ...prev, pixelMissing: e.target.value }))}
          >
            <option value="">Tanto faz</option>
            <option value="true">Sem rastreamento de anúncio</option>
            <option value="false">Já tem rastreamento</option>
          </select>

          <label className="ls-field-label">Velocidade do site</label>
          <select
            value={filters.speedSlow}
            onChange={(e) => setFilters((prev) => ({ ...prev, speedSlow: e.target.value }))}
          >
            <option value="">Tanto faz</option>
            <option value="true">Site lento</option>
            <option value="false">Site rápido</option>
          </select>

          <label className="ls-field-label">Pesquisa do Maps</label>
          <select
            value={filters.searchId}
            onChange={(e) => setFilters((prev) => ({ ...prev, searchId: e.target.value }))}
          >
            <option value="">Todas as pesquisas</option>
            {searchOptions.map((s) => {
              const st = getSearchStats(s.id);
              return (
                <option key={s.id} value={s.id}>
                  {(s.label || s.query || s.id).slice(0, 48)} · {st.analyzed}/{st.withSite} sites
                </option>
              );
            })}
          </select>

          <label className="ls-field-label">Grupo salvo</label>
          <select
            value={filters.groupId}
            onChange={(e) => setFilters((prev) => ({ ...prev, groupId: e.target.value }))}
          >
            <option value="">Todos os grupos</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name} ({g.count || 0})</option>
            ))}
          </select>
          </div>

          <button type="button" className="btn btn-secondary" onClick={clearFilters} style={{ marginTop: showAdvancedFilters ? 4 : 0 }}>
            Limpar filtros
          </button>

          <div className="ls-groups-box">
            <div className="ls-groups-head">
              <h4><Search size={14} /> Pesquisas</h4>
              <button type="button" className="btn btn-secondary btn-compact" onClick={() => { refreshLocalSources(); handleAnalyzeVisible(); }}>
                Analisar
              </button>
            </div>
            {searchOptions.length === 0 ? (
              <p className="ls-muted-text">Nenhuma pesquisa ainda. Rode buscas em “Todos os Leads”.</p>
            ) : (
              <ul className="ls-groups-list">
                {searchOptions.slice(0, 12).map((s) => {
                  const st = getSearchStats(s.id);
                  const label = s.label || s.query || s.id;
                  return (
                    <li key={s.id} className={filters.searchId === s.id ? 'active' : ''}>
                      <button
                        type="button"
                        className="ls-group-item"
                        onClick={() => setFilters((prev) => ({ ...prev, searchId: s.id, groupId: '' }))}
                        title={label}
                      >
                        <span className="ls-group-dot" style={{ background: st.pending ? 'var(--warn)' : 'var(--success)' }} />
                        <span className="ls-group-name">{label}</span>
                        <span className="ls-group-count">{st.analyzed}/{st.withSite}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="ls-groups-box">
            <div className="ls-groups-head">
              <h4><Folder size={14} /> Meus grupos</h4>
              <button type="button" className="btn btn-secondary btn-compact" onClick={() => openCreateGroup('create')}>
                + Novo
              </button>
            </div>
            {groups.length === 0 ? (
              <p className="ls-muted-text">Salve análises de uma pesquisa em grupo para consultar depois.</p>
            ) : (
              <ul className="ls-groups-list">
                {groups.map((g) => (
                  <li key={g.id} className={filters.groupId === g.id ? 'active' : ''}>
                    <button
                      type="button"
                      className="ls-group-item"
                      onClick={() => setFilters((prev) => ({ ...prev, groupId: g.id, searchId: '' }))}
                    >
                      <span className="ls-group-dot" style={{ background: g.color || 'var(--accent)' }} />
                      <span className="ls-group-name">{g.name}</span>
                      <span className="ls-group-count">{g.count || 0}</span>
                    </button>
                    <button
                      type="button"
                      className="ls-group-del"
                      title="Apagar grupo"
                      onClick={() => handleDeleteGroup(g.id)}
                    >
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className="btn btn-secondary btn-compact"
              style={{ width: '100%', marginTop: 8 }}
              onClick={() => openCreateGroup('from_filters')}
              disabled={!leads.length}
            >
              <Layers size={12} /> Salvar fila atual em grupo
            </button>
          </div>

          <div className="ls-howto">
            <h4><HelpCircle size={14} /> Como usar</h4>
            <ol>
              <li>Faça buscas em <strong>Todos os Leads</strong>.</li>
              <li>Aqui: escolha a <strong>pesquisa</strong> e analise (sem janela).</li>
              <li>Salve em <strong>grupo</strong> e consulte quando quiser.</li>
              <li>Comece por <strong>Ligar primeiro</strong>.</li>
            </ol>
          </div>
        </aside>

        {/* Lista */}
        <section className="ls-list-panel">
          <div className="ls-panel-header">
            <h4>
              <button type="button" className="ls-select-all" onClick={toggleSelectAllVisible} title="Selecionar todos visíveis">
                {selectedIds.length > 0 && selectedIds.length === leads.length
                  ? <CheckSquare size={14} />
                  : <Square size={14} />}
              </button>
              Fila ({leads.length}){selectedIds.length ? ` · ${selectedIds.length} sel.` : ''}
            </h4>
            <div className="ls-list-actions">
              {selectedIds.length > 0 && (
                <button type="button" className="btn btn-secondary btn-compact" onClick={() => openCreateGroup('add')}>
                  <FolderPlus size={12} /> No grupo
                </button>
              )}
              <button type="button" className="btn btn-secondary btn-compact" onClick={handleCreateCampaign}>
                WhatsApp
              </button>
            </div>
          </div>
          <div className="ls-list-scroll">
            {leads.length === 0 ? (
              <div className="ls-empty-state ls-empty-rich">
                <Target size={36} />
                <strong>Nenhum lead analisado ainda</strong>
                <p>
                  Clique em <em>Analisar sites</em> — roda em segundo plano (sem janela branca),
                  dá nota e te diz quem contatar primeiro.
                </p>
                {!isScanning && (
                  <button type="button" className="btn btn-primary" onClick={handleAnalyzeVisible}>
                    <Play size={14} /> Analisar sites agora
                  </button>
                )}
              </div>
            ) : (
              leads.map((l) => {
                const p = priorityMeta(l.score?.priority);
                const scoreVal = Number(typeof l.score === 'object' ? l.score?.value : l.score) || 0;
                const city = [l.company?.city, l.company?.state].filter(Boolean).join('/');
                const isChecked = selectedIds.includes(l.id);
                return (
                  <div
                    key={l.id}
                    className={`opp-item-row ${selectedLead?.id === l.id ? 'active' : ''} ${isChecked ? 'checked' : ''}`}
                    onClick={() => setSelectedLead(l)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') setSelectedLead(l);
                    }}
                  >
                    <div className="lead-row-top">
                      <button
                        type="button"
                        className="ls-check-btn"
                        onClick={(e) => toggleSelectLead(l.id, e)}
                        aria-label={isChecked ? 'Desmarcar' : 'Selecionar'}
                      >
                        {isChecked ? <CheckSquare size={14} /> : <Square size={14} />}
                      </button>
                      <strong>{safeText(l.company?.name || l.name, 'Sem nome')}</strong>
                      <span className={`score-priority tone-${p.tone}`}>{p.short}</span>
                    </div>
                    <div className="lead-row-mid">
                      <span className="ls-score-chip">{scoreVal} pts</span>
                      {city ? <span className="ls-muted-chip">{safeText(city)}</span> : null}
                      {(l.groupIds || []).length > 0 && (
                        <span className="ls-muted-chip">{(l.groupIds || []).length} grupo(s)</span>
                      )}
                    </div>
                    <div className="lead-row-bottom">
                      <span>{getStatusLabel(l.prospecting?.status)}</span>
                      {l.aiAnalysis?.resumo ? (
                        <span className="ls-list-snippet">{safeText(l.aiAnalysis.resumo).slice(0, 72)}…</span>
                      ) : (
                        <span className="ls-list-snippet">{p.tip}</span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Detalhe */}
        <section className="ls-detail-panel">
          {selectedLead ? (
            <div className="ls-detail-active">
              {/* Cabeçalho do lead */}
              <div className="ls-detail-hero">
                <div>
                  <h3 className="ls-detail-name">{safeText(selectedLead.company?.name || selectedLead.name, 'Sem nome')}</h3>
                  <div className="ls-detail-meta">
                    {selectedLead.company?.category ? <span>{safeText(selectedLead.company.category)}</span> : null}
                    {(selectedLead.company?.city || selectedLead.company?.state) && (
                      <span>
                        {[selectedLead.company?.city, selectedLead.company?.state].filter(Boolean).map((x) => safeText(x)).join(' · ')}
                      </span>
                    )}
                  </div>
                  {(selectedLead.company?.website || selectedLead.website) && (
                    <a
                      href={safeText(selectedLead.company?.website || selectedLead.website)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ls-site-link"
                    >
                      <ExternalLink size={12} />
                      {safeText(selectedLead.company?.website || selectedLead.website)}
                    </a>
                  )}
                </div>
                <div className={`ls-score-badge tone-${selectedPriority.tone}`}>
                  <span className="ls-score-badge-num">{selectedScore}</span>
                  <span className="ls-score-badge-label">{selectedPriority.label}</span>
                </div>
              </div>

              <p className="ls-score-tip">
                <Lightbulb size={14} />
                {safeText(ai.resumo, scoreTip(selectedScore))}
              </p>

              {/* Status comercial */}
              <div className="ls-card-block">
                <h4>Andamento do contato</h4>
                <div className="ls-status-row">
                  <select
                    value={normalizeStatusValue(selectedLead.prospecting?.status)}
                    onChange={(e) => handleUpdateOutcome(selectedLead.id, { status: e.target.value })}
                  >
                    <option value="not_contacted">Ainda não contatei</option>
                    <option value="contacted">Já contatei</option>
                    <option value="qualified">Boa oportunidade</option>
                    <option value="meeting">Reunião marcada</option>
                    <option value="proposal">Proposta enviada</option>
                    <option value="closed">Fechou negócio</option>
                    <option value="lost">Perdido</option>
                  </select>
                  {selectedLead.company?.phone && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-compact"
                      onClick={() => handleCopy(selectedLead.company.phone, 'Telefone copiado')}
                      title="Copiar telefone"
                    >
                      <Phone size={12} /> {selectedLead.company.phone}
                    </button>
                  )}
                </div>
                {normalizeStatusValue(selectedLead.prospecting?.status) === 'closed' && (
                  <div className="ls-closed-value">
                    <label>Valor fechado (R$)</label>
                    <div className="ls-closed-value-row">
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="Ex: 2500"
                        value={closedValueDraft}
                        onChange={(e) => setClosedValueDraft(e.target.value)}
                      />
                      <button type="button" className="btn btn-primary btn-compact" onClick={handleSaveClosedValue}>
                        Salvar
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Por que esta nota */}
              {(reasons.length > 0 || ai.argumento_principal_venda) && (
                <div className="ls-card-block">
                  <h4>Por que esta nota?</h4>
                  {ai.argumento_principal_venda ? (
                    <p className="ls-main-argument">
                      <TrendingUp size={14} />
                      {safeText(ai.argumento_principal_venda)}
                    </p>
                  ) : null}
                  <ul className="ls-bullet-list">
                    {(reasons.length ? reasons : opportunities.slice(0, 3)).map((item, idx) => (
                      <li key={`${idx}-${safeText(item).slice(0, 24)}`}>{safeText(item)}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Saúde do site */}
              <div className="ls-card-block">
                <h4>Saúde do site (em português claro)</h4>
                {siteChecks.length === 0 ? (
                  <p className="ls-muted-text">Ainda não há análise deste site. Clique em “Analisar sites”.</p>
                ) : (
                  <div className="ls-check-list">
                    {siteChecks.map((check) => {
                      const Icon = check.icon || CheckCircle;
                      return (
                        <div key={check.title} className={`ls-check-row ${check.ok ? 'ok' : 'bad'}`}>
                          <span className="ls-check-icon">
                            {check.ok
                              ? <CheckCircle size={15} />
                              : <AlertTriangle size={15} />}
                          </span>
                          <div>
                            <strong>
                              <Icon size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
                              {check.title}
                            </strong>
                            <p>{check.ok ? check.good : check.bad}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Sinais de venda */}
              <div className="ls-card-block">
                <h4>Sinais de venda</h4>
                <div className="ls-signal-grid">
                  <div className="ls-signal">
                    <span>Chance de responder</span>
                    <b>{levelLabel(ai.chance_resposta)}</b>
                  </div>
                  <div className="ls-signal">
                    <span>Chance de reunião</span>
                    <b>{levelLabel(ai.chance_reuniao)}</b>
                  </div>
                  <div className="ls-signal">
                    <span>Ticket estimado</span>
                    <b>{levelLabel(ai.ticket_estimado)}</b>
                  </div>
                  <div className="ls-signal">
                    <span>Urgência</span>
                    <b>{levelLabel(ai.grau_de_urgencia)}</b>
                  </div>
                </div>
                {(ai.conversionScore != null || ai.copyScore != null) && (
                  <div className="ls-mini-scores">
                    <span>Conversão: {formatScore(ai.conversionScore)}</span>
                    <span>Clareza do texto: {formatScore(ai.copyScore)}</span>
                    <span>Prova/confiança: {formatScore(ai.trustScore)}</span>
                  </div>
                )}
                {ai.principal_vazamento_conversao ? (
                  <p className="ls-leak">
                    <Ban size={13} />
                    Principal vazamento: {safeText(ai.principal_vazamento_conversao)}
                  </p>
                ) : null}
              </div>

              {/* Dores e oportunidades */}
              {(pains.length > 0 || opportunities.length > 0) && (
                <div className="ls-card-block ls-two-col">
                  {pains.length > 0 && (
                    <div>
                      <h4>O que está fraco</h4>
                      <ul className="ls-bullet-list bad">
                        {pains.map((item, idx) => <li key={`p-${idx}`}>{safeText(item)}</li>)}
                      </ul>
                    </div>
                  )}
                  {opportunities.length > 0 && (
                    <div>
                      <h4>O que oferecer</h4>
                      <ul className="ls-bullet-list good">
                        {opportunities.map((item, idx) => <li key={`o-${idx}`}>{safeText(item)}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Mensagens prontas */}
              {(ai.mensagem_whatsapp || ai.primeiro_email) && (
                <div className="ls-card-block">
                  <h4>Mensagens prontas para usar</h4>
                  {ai.mensagem_whatsapp ? (
                    <div className="ls-msg-box">
                      <div className="ls-msg-head">
                        <span><MessageCircle size={13} /> WhatsApp</span>
                        <button
                          type="button"
                          className="btn btn-secondary btn-compact"
                          onClick={() => handleCopy(safeText(ai.mensagem_whatsapp), 'Mensagem de WhatsApp copiada')}
                        >
                          <Copy size={12} /> Copiar
                        </button>
                      </div>
                      <div style={{ fontSize:11.5, lineHeight:1.5, whiteSpace:'pre-wrap' }}><CollapsibleText lines={3} as="div">{safeText(ai.mensagem_whatsapp)}</CollapsibleText></div>
                    </div>
                  ) : null}
                  {ai.primeiro_email ? (
                    <div className="ls-msg-box">
                      <div className="ls-msg-head">
                        <span>E-mail</span>
                        <button
                          type="button"
                          className="btn btn-secondary btn-compact"
                          onClick={() => handleCopy(
                            `${ai.assunto_email ? `Assunto: ${safeText(ai.assunto_email)}\n\n` : ''}${safeText(ai.primeiro_email)}`,
                            'E-mail copiado'
                          )}
                        >
                          <Copy size={12} /> Copiar
                        </button>
                      </div>
                      {ai.assunto_email ? <p className="ls-msg-subject" style={{ fontSize:11.5 }}><CollapsibleText lines={1}>{safeText(ai.assunto_email)}</CollapsibleText></p> : null}
                      <div className="ls-msg-body" style={{ fontSize:11.5, lineHeight:1.5, whiteSpace:'pre-wrap' }}><CollapsibleText lines={4} as="div">{safeText(ai.primeiro_email)}</CollapsibleText></div>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Objeções */}
              {objections.length > 0 && (
                <div className="ls-card-block">
                  <h4>Se o cliente falar…</h4>
                  <div className="ls-objection-list">
                    {objections.map((item, idx) => (
                      <div key={`obj-${idx}`} className="ls-objection">
                        <strong>“{safeText(item?.objecao)}”</strong>
                        <p>{safeText(item?.resposta)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Ações extras */}
              <div className="ls-detail-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setReportLead(selectedLead)}
                >
                  <ChevronRight size={14} /> Ver relatório completo
                </button>
                {selectedLead.screenshots?.desktop && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => handleOpenScreenshot(selectedLead.screenshots.desktop)}
                  >
                    <Image size={14} /> Abrir print do site
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="ls-empty-detail">
              <Target size={48} />
              <strong>Escolha um lead na lista</strong>
              <p>Você verá a nota, o que está fraco no site e mensagens prontas para abordar.</p>
            </div>
          )}
        </section>
      </div>

      {/* Modal: analisar por pesquisa do scraping */}
      {showAnalyzeModal && (
        <div className="modal-backdrop" onClick={() => setShowAnalyzeModal(false)}>
          <div className="wa-card ls-onboard-card" onClick={(e) => e.stopPropagation()}>
            <div className="settings-modal-header">
              <h3><Search size={16} /> Analisar pesquisa (sem janela)</h3>
              <button type="button" className="settings-modal-close" onClick={() => setShowAnalyzeModal(false)} aria-label="Fechar">
                <X size={18} />
              </button>
            </div>
            <p className="ls-muted-text">
              Sem browser: o app só baixa o HTML dos sites (fetch). Não abre tela branca.
              Escolha a pesquisa que você rodou no scraping.
            </p>

            <label className="ls-field-label">Pesquisa do Maps</label>
            <select
              value={analyzeSearchId}
              onChange={(e) => setAnalyzeSearchId(e.target.value)}
            >
              <option value="">Selecione uma pesquisa…</option>
              {searchOptions.map((s) => {
                const st = getSearchStats(s.id);
                const label = s.label || s.query || s.id;
                return (
                  <option key={s.id} value={s.id}>
                    {label.slice(0, 60)} — {st.pending} pendentes / {st.withSite} com site
                  </option>
                );
              })}
            </select>

            {analyzeSearchId && (
              <div className="ls-search-preview">
                {(() => {
                  const st = getSearchStats(analyzeSearchId);
                  return (
                    <>
                      <span><b>{st.total}</b> leads na pesquisa</span>
                      <span><b>{st.withSite}</b> com site</span>
                      <span><b>{st.analyzed}</b> já analisados</span>
                      <span><b>{st.pending}</b> pendentes</span>
                    </>
                  );
                })()}
              </div>
            )}

            <label className="settings-toggle-row" style={{ marginTop: 12 }}>
              <span className="settings-toggle-label">Só leads ainda não analisados</span>
              <input
                type="checkbox"
                checked={analyzeOnlyPending}
                onChange={(e) => setAnalyzeOnlyPending(e.target.checked)}
              />
            </label>

            <label className="settings-toggle-row">
              <span className="settings-toggle-label">Salvar resultado em grupo (para consultar depois)</span>
              <input
                type="checkbox"
                checked={saveAsGroupAfter}
                onChange={(e) => setSaveAsGroupAfter(e.target.checked)}
              />
            </label>

            <label className="ls-field-label" htmlFor="ls-analyze-limit">Limite desta rodada</label>
            <input
              id="ls-analyze-limit"
              type="number"
              min={1}
              max={1000}
              value={analyzeLimit}
              onChange={(e) => setAnalyzeLimit(Number(e.target.value) || 1000)}
            />
            <p className="ls-muted-text" style={{ marginTop: 6 }}>
              Prévia: <strong>{analyzePreviewCount}</strong> site(s) nesta rodada. Limite: 1.000 sites.
            </p>
            <div className="ls-onboard-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setShowAnalyzeModal(false)}>Cancelar</button>
              <button type="button" className="btn btn-primary" onClick={runSegmentedAnalysis} disabled={!analyzeSearchId}>
                <Play size={14} /> Iniciar análise
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal grupos */}
      {showGroupModal && (
        <div className="modal-backdrop" onClick={() => setShowGroupModal(false)}>
          <div className="wa-card ls-onboard-card" onClick={(e) => e.stopPropagation()}>
            <div className="settings-modal-header">
              <h3>
                <FolderPlus size={16} />
                {groupModalMode === 'add' && 'Salvar no grupo'}
                {groupModalMode === 'from_filters' && 'Salvar fila atual em grupo'}
                {groupModalMode === 'create' && 'Criar grupo'}
              </h3>
              <button type="button" className="settings-modal-close" onClick={() => setShowGroupModal(false)} aria-label="Fechar">
                <X size={18} />
              </button>
            </div>

            {groupModalMode === 'add' ? (
              <>
                <p className="ls-muted-text">
                  {selectedIds.length || (selectedLead ? 1 : 0)} lead(s) serão adicionados ao grupo escolhido.
                </p>
                <label className="ls-field-label">Grupo</label>
                <select value={targetGroupId} onChange={(e) => setTargetGroupId(e.target.value)}>
                  <option value="">Selecione…</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name} ({g.count || 0})</option>
                  ))}
                </select>
                {!groups.length && (
                  <p className="ls-muted-text" style={{ marginTop: 8 }}>Você ainda não tem grupos. Crie um primeiro.</p>
                )}
              </>
            ) : (
              <>
                <label className="ls-field-label">Nome do grupo</label>
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Ex: Clínicas SP - Alta prioridade"
                />
                <label className="ls-field-label" style={{ marginTop: 8 }}>Descrição (opcional)</label>
                <input
                  type="text"
                  value={groupDescription}
                  onChange={(e) => setGroupDescription(e.target.value)}
                  placeholder="Para que serve este grupo?"
                />
                <p className="ls-muted-text" style={{ marginTop: 8 }}>
                  {groupModalMode === 'from_filters'
                    ? `Vai salvar os ${leads.length} lead(s) da fila/filtros atuais.`
                    : selectedIds.length
                      ? `Vai incluir ${selectedIds.length} lead(s) selecionado(s).`
                      : selectedLead
                        ? 'Vai incluir o lead aberto.'
                        : 'Grupo vazio — você adiciona leads depois.'}
                </p>
              </>
            )}

            <div className="ls-onboard-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setShowGroupModal(false)}>Cancelar</button>
              {groupModalMode === 'add' && !groups.length ? (
                <button type="button" className="btn btn-primary" onClick={() => setGroupModalMode('create')}>
                  Criar grupo novo
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={handleSaveGroupModal}>
                  Salvar
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Onboarding IA gratuita */}
      {showAiOnboarding && settingsReady && (
        <div className="modal-backdrop ls-onboard-backdrop">
          <div className="wa-card ls-onboard-card" role="dialog" aria-labelledby="ls-onboard-title">
            <div className="ls-onboard-steps">
              {[0, 1, 2].map((s) => (
                <span key={s} className={`ls-onboard-dot ${onboardStep === s ? 'active' : ''} ${onboardStep > s ? 'done' : ''}`} />
              ))}
            </div>

            {onboardStep === 0 && (
              <div className="ls-onboard-panel">
                <div className="ls-onboard-hero">
                  <Gift size={36} />
                  <h2 id="ls-onboard-title">Ative a IA grátis (1 minuto)</h2>
                  <p>
                    A IA lê o site e escreve dores, oportunidades e mensagens prontas de WhatsApp.
                    Você só precisa de uma chave gratuita — fica salva só no seu computador.
                  </p>
                </div>
                <div className="ls-onboard-benefits">
                  <div><CheckCircle size={14} /> Mensagens de abordagem prontas</div>
                  <div><CheckCircle size={14} /> Explica o que está fraco no site</div>
                  <div><CheckCircle size={14} /> OpenRouter e OpenCode com modelos grátis</div>
                </div>
                <div className="ls-onboard-footer">
                  <button type="button" className="btn btn-secondary" onClick={handleSkipOnboarding}>
                    Agora não
                  </button>
                  <button type="button" className="btn btn-primary" onClick={() => setOnboardStep(1)}>
                    Começar <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            )}

            {onboardStep === 1 && (
              <div className="ls-onboard-panel">
                <h2 id="ls-onboard-title">Escolha a IA gratuita</h2>
                <p className="ls-muted-text">As duas opções funcionam bem. Recomendamos OpenRouter para a maioria das pessoas.</p>
                <div className="ls-onboard-provider-grid">
                  {Object.values(FREE_PROVIDERS).map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      className={`ls-onboard-provider ${onboardProvider === p.value ? 'selected' : ''}`}
                      onClick={() => applyProviderPreset(p.value)}
                    >
                      <div className="ls-onboard-provider-top">
                        <strong>{p.label}</strong>
                        <span className="ls-free-badge">{p.badge}</span>
                      </div>
                      <p>{p.hint}</p>
                      <span className="ls-onboard-model">Modelo: {p.model}</span>
                      {p.value === 'openrouter' && <em className="ls-onboard-rec">Recomendado</em>}
                    </button>
                  ))}
                </div>
                <div className="ls-onboard-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setOnboardStep(0)}>
                    <ArrowLeft size={14} /> Voltar
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      applyProviderPreset(onboardProvider);
                      setOnboardStep(2);
                    }}
                  >
                    Continuar <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            )}

            {onboardStep === 2 && (
              <div className="ls-onboard-panel">
                <h2 id="ls-onboard-title">Cole a chave de {(FREE_PROVIDERS[onboardProvider] || FREE_PROVIDERS.openrouter).label}</h2>
                <ol className="ls-onboard-checklist">
                  {(FREE_PROVIDERS[onboardProvider] || FREE_PROVIDERS.openrouter).steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <div className="ls-onboard-links">
                  <button
                    type="button"
                    className="btn btn-secondary btn-compact"
                    onClick={() => openExternal((FREE_PROVIDERS[onboardProvider] || FREE_PROVIDERS.openrouter).signupUrl)}
                  >
                    <ExternalLink size={12} /> Criar conta / login
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-compact"
                    onClick={() => openExternal((FREE_PROVIDERS[onboardProvider] || FREE_PROVIDERS.openrouter).keyUrl)}
                  >
                    <KeyRound size={12} /> Abrir página da chave
                  </button>
                </div>
                <label className="ls-field-label" htmlFor="ls-onboard-key">Sua chave de API</label>
                <input
                  id="ls-onboard-key"
                  type="password"
                  autoComplete="off"
                  placeholder="Cole aqui a chave copiada…"
                  value={onboardApiKey}
                  onChange={(e) => setOnboardApiKey(e.target.value)}
                />
                <p className="ls-muted-text" style={{ marginTop: 8 }}>
                  A chave não sai do seu PC. Sem chave, a análise técnica do site ainda roda — só a parte “inteligente” fica básica.
                </p>
                <div className="ls-onboard-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setOnboardStep(1)} disabled={onboardSaving}>
                    <ArrowLeft size={14} /> Voltar
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={handleSkipOnboarding} disabled={onboardSaving}>
                    Pular
                  </button>
                  <button type="button" className="btn btn-primary" onClick={handleFinishOnboarding} disabled={onboardSaving}>
                    <Rocket size={14} /> {onboardSaving ? 'Salvando…' : 'Ativar IA'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Relatório legível */}
      {reportLead && (
        <div className="modal-backdrop" onClick={() => setReportLead(null)}>
          <div className="wa-card report-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="settings-modal-header">
              <h3>Relatório — {reportLead.company?.name || reportLead.name || 'Lead'}</h3>
              <button type="button" onClick={() => setReportLead(null)} className="settings-modal-close" aria-label="Fechar">
                <X size={18} />
              </button>
            </div>
            <div className="ls-report-readable">
              <ReadableReport lead={reportLead} />
            </div>
          </div>
        </div>
      )}

      {/* Configurações */}
      {isSettingsOpen && settings && (
        <div className="modal-backdrop" onClick={() => setIsSettingsOpen(false)}>
          <div className="wa-card settings-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="settings-modal-header">
              <h3>Ajustes da análise</h3>
              <button type="button" onClick={() => setIsSettingsOpen(false)} className="settings-modal-close" aria-label="Fechar">
                <X size={18} />
              </button>
            </div>

            <div className="settings-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={settingsTab === 'ai'}
                className={`settings-tab ${settingsTab === 'ai' ? 'active' : ''}`}
                onClick={() => setSettingsTab('ai')}
              >
                <Sparkles size={14} /> Inteligência artificial
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={settingsTab === 'rules'}
                className={`settings-tab ${settingsTab === 'rules' ? 'active' : ''}`}
                onClick={() => setSettingsTab('rules')}
              >
                <SlidersHorizontal size={14} /> Como a nota é calculada
              </button>
            </div>

            <form onSubmit={handleSaveSettings} className="scoring-settings-form">
              {settingsTab === 'ai' && (
                <div className="settings-tab-panel">
                  <div className="settings-note">
                    A IA lê o site e sugere dores, oportunidades e mensagens de abordagem.
                    Sua chave fica só no seu computador.
                  </div>

                  <label className="settings-toggle-row">
                    <span className="settings-toggle-label">
                      <Zap size={14} /> Usar IA nas análises
                    </span>
                    <input
                      type="checkbox"
                      checked={getAi('enabled') === true}
                      onChange={(e) => setAi('enabled', e.target.checked)}
                    />
                  </label>

                  <div className="settings-field">
                    <label>Qual IA você usa?</label>
                    <select
                      value={getAi('provider', 'openrouter')}
                      onChange={(e) => {
                        const value = e.target.value;
                        setAi('provider', value);
                        const preset = FREE_PROVIDERS[value];
                        if (preset) {
                          setAi('model', preset.model);
                          setAi('baseUrl', preset.baseUrl || '');
                          if (preset.siteUrl) setAi('siteUrl', preset.siteUrl);
                        }
                      }}
                    >
                      {aiProviders.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                    <span className="settings-field-hint">
                      {aiProviderHints[getAi('provider', 'openrouter')] || ''}
                    </span>
                  </div>

                  <div className="settings-field">
                    <label>Modelo (opcional)</label>
                    <input
                      type="text"
                      placeholder={aiProviderModels[getAi('provider', 'openrouter')] || 'openrouter/free'}
                      value={getAi('model', '')}
                      onChange={(e) => setAi('model', e.target.value)}
                    />
                    <span className="settings-field-hint">
                      Padrão grátis: openrouter/free ou deepseek-v4-flash-free (OpenCode).
                    </span>
                  </div>

                  <div className="settings-field">
                    <label>
                      Chave de API {settings.ai?.hasApiKey ? <span className="settings-key-badge">já salva</span> : null}
                    </label>
                    <input
                      type="password"
                      placeholder={settings.ai?.hasApiKey ? '•••••••• (deixe vazio para manter)' : 'Cole sua chave aqui'}
                      value={getAi('apiKey', '')}
                      onChange={(e) => setAi('apiKey', e.target.value)}
                      autoComplete="off"
                    />
                    <span className="settings-field-hint">
                      Sem chave, o app ainda analisa o site — só sem textos gerados por IA.
                    </span>
                  </div>

                  {(getAi('provider', 'openrouter') === 'openrouter' || getAi('provider', 'openrouter') === 'custom' || getAi('provider') === 'opencode') && (
                    <div className="settings-field">
                      <label>
                        {getAi('provider') === 'custom' || getAi('provider') === 'opencode'
                          ? 'Endereço do servidor (URL)'
                          : 'Seu site (referência OpenRouter)'}
                      </label>
                      <input
                        type="text"
                        placeholder={
                          getAi('provider') === 'opencode'
                            ? 'https://opencode.ai/zen/v1'
                            : getAi('provider') === 'custom'
                              ? 'http://127.0.0.1:11434/v1'
                              : 'https://seusite.com.br'
                        }
                        value={getAi(
                          getAi('provider') === 'custom' || getAi('provider') === 'opencode' ? 'baseUrl' : 'siteUrl',
                          getAi('provider') === 'opencode' ? 'https://opencode.ai/zen/v1' : ''
                        )}
                        onChange={(e) => setAi(
                          getAi('provider') === 'custom' || getAi('provider') === 'opencode' ? 'baseUrl' : 'siteUrl',
                          e.target.value
                        )}
                      />
                    </div>
                  )}

                  <div className="settings-field">
                    <label>Limite diário de análises com IA</label>
                    <input
                      type="number"
                      min="1"
                      value={getAi('dailyLimit', 100)}
                      onChange={(e) => setAi('dailyLimit', Number(e.target.value))}
                    />
                    <span className="settings-field-hint">Evita gastar créditos demais por dia.</span>
                  </div>
                </div>
              )}

              {settingsTab === 'rules' && (
                <div className="settings-tab-panel">
                  <div className="settings-note">
                    Já vem calibrado para a maioria dos casos. Só mude se quiser
                    notas mais “duras” ou mais “fáceis”.
                  </div>

                  <div className="settings-row">
                    <span>Pontos a mais se faltar pixel de anúncio</span>
                    <input type="number" value={getRule('digitalPain', 'missingPixelPoints', 3)} onChange={(e) => setRule('digitalPain', 'missingPixelPoints', e.target.value)} />
                  </div>
                  <div className="settings-row">
                    <span>Pontos a mais se faltar site seguro (HTTPS)</span>
                    <input type="number" value={getRule('digitalPain', 'missingHttpsPoints', 5)} onChange={(e) => setRule('digitalPain', 'missingHttpsPoints', e.target.value)} />
                  </div>
                  <div className="settings-row">
                    <span>Pontos a mais se o site for lento</span>
                    <input type="number" value={getRule('digitalPain', 'slowLoadPoints', 4)} onChange={(e) => setRule('digitalPain', 'slowLoadPoints', e.target.value)} />
                  </div>
                  <div className="settings-row">
                    <span>Considerar lento acima de (milissegundos)</span>
                    <input type="number" value={getRule('digitalPain', 'slowLoadMs', 5000)} onChange={(e) => setRule('digitalPain', 'slowLoadMs', e.target.value)} />
                  </div>
                  <div className="settings-note">
                    “Ligar primeiro” = empresa <strong>com site</strong> e falhas (pixel, HTTPS, celular, WhatsApp…).
                    Sem site continua valendo a pena, mas não passa na frente dos sites com problema.
                  </div>
                  <div className="settings-row">
                    <span>“Vale a pena” a partir da nota</span>
                    <input type="number" value={getRule('thresholds', 'goodFrom', 60)} onChange={(e) => setRule('thresholds', 'goodFrom', e.target.value)} />
                  </div>
                  <div className="settings-row">
                    <span>“Ligar primeiro” a partir da nota</span>
                    <input type="number" value={getRule('thresholds', 'highFrom', 75)} onChange={(e) => setRule('thresholds', 'highFrom', e.target.value)} />
                  </div>
                </div>
              )}

              <div className="settings-modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setIsSettingsOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary">
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function ReadableReport({ lead }) {
  const score = Number(typeof lead.score === 'object' ? lead.score?.value : lead.score) || 0;
  const p = priorityMeta(lead.score?.priority);
  const ai = lead.aiAnalysis || {};
  const checks = buildSiteChecks(lead);
  const components = lead.score?.components || {};
  const reasons = cleanList(lead.score?.reasons);
  const pains = cleanList(ai.principais_dores || ai.problemas_encontrados);
  const opportunities = cleanList(ai.principais_oportunidades);

  return (
    <>
      <section className="ls-report-section">
        <h4>Resumo</h4>
        <p>
          <strong>{safeText(lead.company?.name || lead.name, 'Empresa')}</strong>
          {lead.company?.category ? ` · ${safeText(lead.company.category)}` : ''}
          {lead.company?.city ? ` · ${safeText(lead.company.city)}` : ''}
        </p>
        <p>
          Nota: <strong>{score}/100</strong> — {p.label}. {p.tip}
        </p>
        {ai.resumo ? <p>{safeText(ai.resumo)}</p> : null}
        {ai.resumo_empresa ? <p className="ls-muted-text">{safeText(ai.resumo_empresa)}</p> : null}
      </section>

      <section className="ls-report-section">
        <h4>O que pesou na nota</h4>
        <div className="ls-signal-grid">
          <div className="ls-signal"><span>Encaixe comercial</span><b>{components.commercialFit ?? '—'}</b></div>
          <div className="ls-signal"><span>Problemas no digital</span><b>{components.digitalPain ?? '—'}</b></div>
          <div className="ls-signal"><span>Facilidade de contato</span><b>{components.contactability ?? '—'}</b></div>
          <div className="ls-signal"><span>Potencial de conversão</span><b>{components.conversionPotential ?? '—'}</b></div>
        </div>
        {reasons.length > 0 && (
          <ul className="ls-bullet-list">
            {reasons.map((r, idx) => <li key={`r-${idx}`}>{safeText(r)}</li>)}
          </ul>
        )}
      </section>

      <section className="ls-report-section">
        <h4>Checklist do site</h4>
        <div className="ls-check-list">
          {checks.map((check) => (
            <div key={check.title} className={`ls-check-row ${check.ok ? 'ok' : 'bad'}`}>
              <span className="ls-check-icon">
                {check.ok ? <CheckCircle size={15} /> : <AlertTriangle size={15} />}
              </span>
              <div>
                <strong>{check.title}</strong>
                <p>{check.ok ? check.good : check.bad}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {(pains.length > 0 || opportunities.length > 0) && (
        <section className="ls-report-section ls-two-col">
          {pains.length > 0 && (
            <div>
              <h4>Problemas</h4>
              <ul className="ls-bullet-list bad">
                {pains.map((item, idx) => <li key={`rp-${idx}`}>{safeText(item)}</li>)}
              </ul>
            </div>
          )}
          {opportunities.length > 0 && (
            <div>
              <h4>Oportunidades</h4>
              <ul className="ls-bullet-list good">
                {opportunities.map((item, idx) => <li key={`ro-${idx}`}>{safeText(item)}</li>)}
              </ul>
            </div>
          )}
        </section>
      )}

      {ai.mensagem_whatsapp ? (
        <section className="ls-report-section">
          <h4>Mensagem de WhatsApp sugerida</h4>
          <p className="ls-msg-body">{safeText(ai.mensagem_whatsapp)}</p>
        </section>
      ) : null}

      {ai.primeiro_email ? (
        <section className="ls-report-section">
          <h4>E-mail sugerido</h4>
          {ai.assunto_email ? <p className="ls-msg-subject">Assunto: {safeText(ai.assunto_email)}</p> : null}
          <p className="ls-msg-body" style={{ whiteSpace: 'pre-wrap' }}>{safeText(ai.primeiro_email)}</p>
        </section>
      ) : null}

      {Array.isArray(ai.objecoes_provaveis) && ai.objecoes_provaveis.some((o) => o?.objecao) && (
        <section className="ls-report-section">
          <h4>Objeções comuns</h4>
          {ai.objecoes_provaveis.filter((o) => o?.objecao).map((item, idx) => (
            <div key={`robj-${idx}`} className="ls-objection">
              <strong>“{safeText(item.objecao)}”</strong>
              <p>{safeText(item.resposta)}</p>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function matchesScoringFilters(lead, filters) {
  if (!lead) return false;
  const text = String(filters.text || '').toLowerCase().trim();
  if (text) {
    const haystack = [
      lead.company?.name,
      lead.company?.category,
      lead.company?.city,
      lead.company?.state,
      lead.company?.website,
      lead.company?.instagram,
      lead.aiAnalysis?.resumo
    ].filter(Boolean).join(' ').toLowerCase();
    if (!haystack.includes(text)) return false;
  }
  if (filters.priority && String(lead.score?.priority || '').toLowerCase() !== String(filters.priority).toLowerCase()) {
    return false;
  }
  if (filters.outcome && String(lead.prospecting?.status || '').toLowerCase() !== String(filters.outcome).toLowerCase()) {
    return false;
  }
  if (filters.hasWebsite === 'with' && !leadHasWebsite(lead)) return false;
  if (filters.hasWebsite === 'without' && leadHasWebsite(lead)) return false;
  if (filters.hasWebsite === 'instagram_only' && !leadHasInstagramOnly(lead)) return false;
  if (filters.hasWebsite === 'with_instagram' && !leadHasInstagram(lead)) return false;
  if (filters.hasInstagram === 'true' && !leadHasInstagram(lead)) return false;
  if (filters.hasInstagram === 'false' && leadHasInstagram(lead)) return false;
  if (filters.groupId) {
    const inGroup = Array.isArray(lead.groupIds) && lead.groupIds.map(String).includes(String(filters.groupId));
    if (!inGroup) return false;
  }
  if (filters.searchId && String(lead.searchId || '') !== String(filters.searchId)) {
    return false;
  }
  if (filters.pixelMissing) {
    const tracking = lead.siteAnalysis?.tracking || {};
    const hasPixel = hasAnyPixel(tracking);
    if (String(!hasPixel) !== String(filters.pixelMissing)) return false;
  }
  if (filters.speedSlow) {
    const slow = Number(lead.siteAnalysis?.performance?.loadTimeMs || 0) > 3500;
    if (String(slow) !== String(filters.speedSlow)) return false;
  }
  return true;
}

export default LeadScoring;
