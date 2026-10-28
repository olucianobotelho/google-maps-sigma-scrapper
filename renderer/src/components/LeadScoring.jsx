import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Target,
  Settings,
  Download,
  Play,
  Pause,
  RotateCcw,
  CheckCircle,
  AlertTriangle,
  Sparkles,
  ExternalLink,
  Globe,
  ChevronDown,
  ChevronRight,
  Search,
  Users,
  Plus,
  X,
  Eye,
  EyeOff
} from 'lucide-react';
import { dedupeLeads, normalizeLeadCollection, readLocalArray } from '../leadData';
import { isRealWebsite } from '../leadLinks.mjs';
import {
  DEFAULT_SCORE_THRESHOLDS,
  buildScoringIndex,
  findScoringLead,
  leadKey,
  normalizeThresholds,
  resolveGroupMembers,
  resolveServiceGroupMembers,
  scoreBand,
} from '../leadMatch.mjs';

const AUDITS = {
  sites: { name: 'Venda de Sites', hint: 'Qualidade e ausência de site, mobile, performance, SEO, hero, CTA e conversão.' },
  seo: { name: 'SEO', hint: 'Estrutura, títulos, conteúdo e sinais técnicos para buscadores.' },
  mkt: { name: 'Marketing Digital', hint: 'Presença, conteúdo e canais como ativo de aquisição.' },
  pres: { name: 'Presença Digital', hint: 'Visão geral da pegada digital da empresa.' },
  custom: { name: 'Customizado', hint: 'Direcionado pelo objetivo definido abaixo.' }
};

const PROVIDERS = {
  openrouter: {
    name: 'OpenRouter',
    base: 'https://openrouter.ai/api/v1',
    defaultModel: 'openrouter/free',
    models: [
      'openrouter/free',
      'openai/gpt-4o-mini',
      'anthropic/claude-3.5-sonnet',
      'google/gemini-2.0-flash-001',
    ]
  },
  nvidia: {
    name: 'NVIDIA Build',
    base: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'deepseek-ai/deepseek-v4-flash',
    models: [
      'deepseek-ai/deepseek-v4-flash',
      'meta/llama-3.3-70b-instruct',
      'nvidia/llama-3.1-nemotron-ultra-253b-v1',
    ]
  },
  opencode: {
    name: 'OpenCode',
    base: 'https://opencode.ai/zen/v1',
    defaultModel: 'glm-5.3-flash',
    models: ['glm-5.3-flash', 'deepseek-v4-flash', 'minimax-m3', 'muse-spark-1.3']
  },
  custom: { name: 'Custom API', base: '', defaultModel: 'gpt-4.1-mini', models: [] }
};

function defaultAiConfig() {
  return {
    provider: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    key: '',
    hasApiKey: false,
    model: 'openrouter/free',
    preset: 'sites',
    objective: ''
  };
}

function readAiConfig() {
  try {
    const a = JSON.parse(localStorage.getItem('sigma_ai') || 'null');
    if (a && a.provider) {
      const fallback = defaultAiConfig();
      const isLegacyDemo = a.provider === 'openrouter' && a.key === 'sk-demo-0000-ficticia';
      return {
        ...fallback,
        ...a,
        provider: isLegacyDemo ? fallback.provider : a.provider,
        baseUrl: isLegacyDemo ? fallback.baseUrl : (a.baseUrl || PROVIDERS[a.provider]?.base || fallback.baseUrl),
        key: isLegacyDemo ? '' : (a.key || ''),
      };
    }
  } catch {}
  return defaultAiConfig();
}

function saveAiConfig(cfg) {
  try {
    const { key, ...safeConfig } = cfg || {};
    localStorage.setItem('sigma_ai', JSON.stringify(safeConfig));
  } catch {}
}

function toUiAiConfig(settings, current = defaultAiConfig()) {
  const ai = settings?.ai || {};
  const provider = ai.provider || current.provider || 'openrouter';
  return {
    ...current,
    provider,
    baseUrl: ai.baseUrl || PROVIDERS[provider]?.base || current.baseUrl,
    key: '',
    hasApiKey: Boolean(ai.hasApiKey || (ai.apiKey && ai.apiKey !== '')),
    model: ai.model || current.model || PROVIDERS[provider]?.defaultModel || 'openrouter/free',
  };
}

// Campos que o usuário realmente muda no dia a dia: faixas de prioridade e os
// pesos que mais mexem no ranking. O resto fica no preset do motor.
const RULE_FIELDS = [
  { key: 'highFrom', group: 'thresholds', label: 'Prioridade alta a partir de', hint: 'score que vira “Ligar primeiro”', min: 50, max: 100 },
  { key: 'goodFrom', group: 'thresholds', label: 'Vale a pena a partir de', hint: 'score que entra na fila boa', min: 20, max: 95 },
  { key: 'ignoreBelow', group: 'thresholds', label: 'Ignorar abaixo de', hint: 'score que vira “Pular por agora”', min: 0, max: 80 },
  { key: 'noWebsitePoints', group: 'digitalPain', label: 'Empresa sem site', hint: 'pontos de dor digital', min: 0, max: 40 },
  { key: 'missingPixelPoints', group: 'digitalPain', label: 'Site sem pixel', hint: 'argumento de venda forte', min: 0, max: 30 },
  { key: 'notResponsivePoints', group: 'digitalPain', label: 'Site ruim no celular', hint: 'falha cara de vender', min: 0, max: 30 },
  { key: 'missingHttpsPoints', group: 'digitalPain', label: 'Site sem HTTPS', hint: 'falha de confiança', min: 0, max: 30 },
  { key: 'missingWhatsappPoints', group: 'digitalPain', label: 'Site sem WhatsApp', hint: 'contato escondido', min: 0, max: 30 },
];

function rulesDraftFrom(rules) {
  const source = rules && typeof rules === 'object' ? rules : {};
  const draft = {};
  for (const field of RULE_FIELDS) {
    const raw = source[field.group]?.[field.key];
    const value = Number(raw);
    draft[field.key] = Number.isFinite(value) ? value : DEFAULT_RULE_VALUES[field.key];
  }
  return draft;
}

const DEFAULT_RULE_VALUES = Object.freeze({
  highFrom: DEFAULT_SCORE_THRESHOLDS.highFrom,
  goodFrom: DEFAULT_SCORE_THRESHOLDS.goodFrom,
  ignoreBelow: DEFAULT_SCORE_THRESHOLDS.ignoreBelow,
  noWebsitePoints: 16,
  missingPixelPoints: 9,
  notResponsivePoints: 9,
  missingHttpsPoints: 9,
  missingWhatsappPoints: 8,
});

function defaultRulesDraft() {
  return { ...DEFAULT_RULE_VALUES };
}

function buildRulesPatch(draft) {
  const thresholds = {};
  const digitalPain = {};
  for (const field of RULE_FIELDS) {
    const value = Number(draft?.[field.key]);
    if (!Number.isFinite(value)) continue;
    const clamped = Math.max(field.min, Math.min(field.max, Math.round(value)));
    if (field.group === 'thresholds') thresholds[field.key] = clamped;
    else digitalPain[field.key] = clamped;
  }
  return { thresholds, digitalPain };
}

function sanitizeRulesDraft(draft) {
  const thresholds = buildRulesPatch(draft).thresholds;
  const low = Math.min(thresholds.goodFrom ?? 60, thresholds.highFrom ?? 75);
  const high = Math.max(thresholds.goodFrom ?? 60, thresholds.highFrom ?? 75);
  return { ...draft, goodFrom: low, highFrom: high, ignoreBelow: Math.min(thresholds.ignoreBelow ?? 40, low) };
}

function fmtShort(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function scoreWhyTitle(an, score, band, thresholds) {
  if (!an || score == null || !band) return 'Não analisado';
  const t = normalizeThresholds(thresholds);
  const range =
    band.key === 'high' ? `≥ ${t.highFrom}` :
    band.key === 'mid' ? `${t.goodFrom} a ${t.highFrom - 1}` :
    `< ${t.goodFrom}`;
  const lines = [`Score ${score} — faixa ${band.label} (${range})`];
  const pos = (an.pos || []).filter(Boolean);
  const neg = (an.neg || []).filter(Boolean);
  if (pos.length) lines.push('', 'Pontos fortes:', ...pos.map((r) => `• ${r}`));
  if (neg.length) lines.push('', 'Motivos:', ...neg.map((r) => `• ${r}`));
  if (!pos.length && !neg.length) lines.push('', 'Sem detalhes de análise — clique em Reanalisar.');
  return lines.join('\n');
}

function analysisFromService(savedLead, preset = 'sites') {
  const company = savedLead?.company || savedLead || {};
  const site = savedLead?.siteAnalysis || {};
  const ai = savedLead?.aiAnalysis || {};
  const score = Number(savedLead?.score?.value ?? savedLead?.score ?? 0);
  const positive = [
    site.hasHttps ? 'HTTPS ativo' : '',
    site.mobile?.isResponsive ? 'Layout responsivo identificado' : '',
    site.conversion?.hasWhatsappButton ? 'Canal de WhatsApp identificado' : '',
    site.conversion?.hasForm ? 'Formulário de contato identificado' : '',
  ].filter(Boolean);
  const negative = [
    ...(Array.isArray(ai.principais_dores) ? ai.principais_dores : []),
    ...(Array.isArray(savedLead?.score?.sitePains) ? savedLead.score.sitePains : []),
  ].filter(Boolean);
  const opportunities = [
    ...(Array.isArray(ai.principais_oportunidades) ? ai.principais_oportunidades : []),
    ...(Array.isArray(site.siteSummary?.conversion?.likelyLeaks) ? site.siteSummary.conversion.likelyLeaks : []),
  ].filter(Boolean);
  const noSite = !site.finalUrl && !isRealWebsite(company.website);
  const sections = [
    {
      t: 'Diagnóstico técnico',
      items: [
        noSite ? 'Nenhum site próprio foi localizado na análise.' : `Site analisado: ${site.finalUrl || company.website}`,
        site.performance?.loadTimeMs ? `Carregamento medido: ${Math.round(site.performance.loadTimeMs)} ms` : '',
      ].filter(Boolean),
    },
    ai.resumo ? { t: 'Resumo comercial', items: [ai.resumo] } : null,
  ].filter(Boolean);
  return {
    score,
    pos: positive,
    neg: negative.length ? negative : (Array.isArray(savedLead?.score?.reasons) ? savedLead.score.reasons : []),
    opp: opportunities,
    sections,
    noSite,
    provider: ai.rawProvider || (ai.providerModel ? 'IA' : 'regras locais'),
    model: ai.providerModel || '',
    preset,
    ts: savedLead?.updatedAt || savedLead?.createdAt || Date.now(),
  };
}

export default function LeadScoring({ onUpdateScoringCount, addLog }) {
  const [leads, setLeads] = useState(() => normalizeLeadCollection(readLocalArray('sigma_leads')));
  const [localGroups, setLocalGroups] = useState(() => readLocalArray('sigma_groups'));
  const [serviceGroups, setServiceGroups] = useState([]);
  const [canonicalLeads, setCanonicalLeads] = useState([]);

  // Grupo ativo
  const [selectedGroupId, setSelectedGroupId] = useState(() => {
    try {
      const saved = localStorage.getItem('sigma_scgroup');
      if (saved !== null) return saved;
    } catch {}
    return '';
  });

  // Configuração de IA + regras do score
  const [aiConfig, setAiConfig] = useState(() => readAiConfig());
  const [thresholds, setThresholds] = useState(DEFAULT_SCORE_THRESHOLDS);
  const [rulesDraft, setRulesDraft] = useState(() => defaultRulesDraft());
  const [autoAnalyze, setAutoAnalyze] = useState(false);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [aiDraft, setAiDraft] = useState(() => readAiConfig());
  const [showKey, setShowKey] = useState(false);
  const [testStatusMsg, setTestStatusMsg] = useState('');
  const [testStatusOk, setTestStatusOk] = useState(false);
  const [aiWarning, setAiWarning] = useState('');

  const [analysisMap, setAnalysisMap] = useState({});

  // Estado de execução do scoring
  const [isRunning, setIsRunning] = useState(false);
  const [runStates, setRunStates] = useState({}); // { [leadId]: 'wait' | 'run' | 'done' | 'fail' | 'nosite' | 'skipped' }
  const [progressCount, setProgressCount] = useState({ current: 0, total: 0 });
  const [progressText, setProgressText] = useState('');

  // Seleção na tabela
  const [selectedRowIds, setSelectedRowIds] = useState(new Set());

  // Modal de Detalhes do Lead
  const [detailLead, setDetailLead] = useState(null);
  const [openAccSections, setOpenAccSections] = useState({});

  const activeJobRef = useRef(null);

  const loadCanonicalScoring = useCallback(async () => {
    if (!window.leadScoringAPI?.getAll) return;
    try {
      const response = await window.leadScoringAPI.getAll({});
      if (response?.success) setCanonicalLeads(response.leads || []);
    } catch {
      // O estado vazio continua honesto enquanto o serviço não responde.
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    window.leadScoringAPI?.getSettings?.().then((response) => {
      if (disposed || !response?.success) return;
      setAiConfig((current) => {
        const next = toUiAiConfig(response.settings, current);
        saveAiConfig(next);
        return next;
      });
      setAiDraft((current) => toUiAiConfig(response.settings, current));
      setThresholds(normalizeThresholds(response.settings?.rules?.thresholds));
      setRulesDraft(rulesDraftFrom(response.settings?.rules));
      setAutoAnalyze(response.settings?.analysis?.autoAnalyzeAfterScrape === true);
    }).catch(() => {});
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    let disposed = false;
    const loadGroups = async () => {
      try {
        const groupsResponse = await window.leadScoringAPI?.listGroups?.();
        if (disposed) return;
        if (groupsResponse?.success && Array.isArray(groupsResponse.groups)) setServiceGroups(groupsResponse.groups);
      } catch {
        // grupos da Base continuam valendo mesmo se o serviço não responder
      }
    };
    loadCanonicalScoring();
    loadGroups();
    return () => { disposed = true; };
  }, [loadCanonicalScoring]);

  // Mapeia cada resultado persistido para o lead correspondente da base.
  useEffect(() => {
    const index = buildScoringIndex(canonicalLeads);
    const next = {};
    leads.forEach((lead, position) => {
      const saved = findScoringLead(index, lead, position);
      if (saved) next[leadKey(lead, position)] = analysisFromService(saved, aiConfig.preset);
    });
    setAnalysisMap(next);
  }, [leads, canonicalLeads, aiConfig.preset]);

  // Sincronizar dados do localStorage
  useEffect(() => {
    const refreshData = () => {
      setLeads(normalizeLeadCollection(readLocalArray('sigma_leads')));
      setLocalGroups(readLocalArray('sigma_groups'));
    };
    window.addEventListener('storage', refreshData);
    window.addEventListener('sigma:leads-updated', refreshData);
    window.addEventListener('sigma:groups-updated', refreshData);
    return () => {
      window.removeEventListener('storage', refreshData);
      window.removeEventListener('sigma:leads-updated', refreshData);
      window.removeEventListener('sigma:groups-updated', refreshData);
    };
  }, []);

  // Notificar contagem de leads analisados
  useEffect(() => {
    const scoredCount = Object.keys(analysisMap).length;
    onUpdateScoringCount?.(scoredCount);
  }, [analysisMap, onUpdateScoringCount]);

  // Grupos da Base de Leads + grupos criados pelo próprio scoring, já resolvidos
  // para leads reais. Nada aparece com contagem inventada.
  const groups = useMemo(() => {
    const positionByLead = new Map(leads.map((lead, position) => [lead, position]));
    const scoringIndex = buildScoringIndex(canonicalLeads);
    const resolved = new Map();
    for (const group of localGroups) {
      const members = resolveGroupMembers(group, leads);
      resolved.set(String(group.id), {
        ...group,
        source: 'base',
        resolved: members,
        members: members.map((lead) => leadKey(lead, positionByLead.get(lead) ?? 0)),
      });
    }
    for (const group of serviceGroups) {
      if (resolved.has(String(group.id))) continue;
      resolved.set(String(group.id), {
        ...group,
        source: 'scoring',
        resolved: resolveServiceGroupMembers(group, leads, scoringIndex),
      });
    }
    return [...resolved.values()];
  }, [localGroups, serviceGroups, leads, canonicalLeads]);

  // Objeto do grupo ativo
  const currentGroup = useMemo(() => {
    return groups.find((g) => String(g.id) === String(selectedGroupId)) || null;
  }, [groups, selectedGroupId]);

  // Lista de leads do grupo ativo
  const groupLeads = useMemo(() => currentGroup?.resolved || [], [currentGroup]);
  const groupLeadsRef = useRef([]);
  useEffect(() => { groupLeadsRef.current = groupLeads; }, [groupLeads]);
  const basePositions = useMemo(() => new Map(leads.map((lead, position) => [lead, position])), [leads]);

  // Salvar grupo selecionado
  const handleSelectGroup = (id) => {
    setSelectedGroupId(id);
    try {
      if (id) localStorage.setItem('sigma_scgroup', id);
      else localStorage.setItem('sigma_scgroup', '');
    } catch {}
  };

  // Abrir modal de IA
  const handleOpenAiModal = () => {
    setAiDraft({ ...aiConfig });
    setTestStatusMsg('');
    setShowKey(false);
    setIsAiModalOpen(true);
  };

  // Salvar modal de IA + regras do score
  const handleSaveAiModal = async () => {
    const ai = {
      enabled: Boolean(aiDraft.key || aiDraft.hasApiKey),
      provider: aiDraft.provider,
      apiKey: aiDraft.key || (aiDraft.hasApiKey ? '********' : ''),
      model: aiDraft.model,
      baseUrl: aiDraft.baseUrl,
    };
    const sanitizedRules = sanitizeRulesDraft(rulesDraft);
    const rules = buildRulesPatch(sanitizedRules);
    setRulesDraft(sanitizedRules);
    setThresholds(normalizeThresholds(rules.thresholds));
    if (window.leadScoringAPI?.updateSettings) {
      const response = await window.leadScoringAPI.updateSettings({
        ai,
        rules,
        analysis: { autoAnalyzeAfterScrape: autoAnalyze },
      });
      if (!response?.success) {
        setTestStatusMsg(response?.error || 'Não foi possível salvar a configuração.');
        return;
      }
      const next = toUiAiConfig(response.settings, aiDraft);
      setAiConfig(next);
      setAiDraft(next);
      saveAiConfig(next);
      setThresholds(normalizeThresholds(response.settings?.rules?.thresholds));
      setRulesDraft(rulesDraftFrom(response.settings?.rules));
      setAutoAnalyze(response.settings?.analysis?.autoAnalyzeAfterScrape === true);
      setIsAiModalOpen(false);
      addLog?.('[SCORING] Configuração de análise atualizada.');
      return;
    }
    const next = { ...aiDraft, key: '' };
    setAiConfig(next);
    saveAiConfig(next);
    setIsAiModalOpen(false);
  };

  // Testa a rota do provedor de verdade; não aceita validação apenas visual.
  const handleTestAi = async () => {
    setTestStatusMsg('Testando conexão…');
    setTestStatusOk(false);
    if (!window.leadScoringAPI?.testConnection) {
      setTestStatusMsg('Teste real indisponível nesta versão do aplicativo.');
      return;
    }
    try {
      const response = await window.leadScoringAPI.testConnection({
        provider: aiDraft.provider,
        apiKey: aiDraft.key || (aiDraft.hasApiKey ? '********' : ''),
        model: aiDraft.model,
        baseUrl: aiDraft.baseUrl,
      });
      if (!response?.success) throw new Error(response?.error || 'A conexão foi recusada.');
      setTestStatusOk(true);
      setTestStatusMsg(`Conexão confirmada: ${response.provider} · ${response.model}.`);
    } catch (error) {
      setTestStatusMsg(error?.message || 'Não foi possível testar a conexão.');
    }
  };

  const saveServiceAnalysis = (uiLeadId, savedLead) => {
    if (!uiLeadId || !savedLead) return;
    const analysis = analysisFromService(savedLead, aiConfig.preset);
    setAnalysisMap((previous) => ({ ...previous, [uiLeadId]: analysis }));
    return analysis;
  };

  // O processamento é delegado ao serviço persistido; não há timer ou resultado local simulado.
  const handleRunScoring = async () => {
    if (isRunning) {
      if (activeJobRef.current) await window.leadScoringAPI?.cancel?.(activeJobRef.current);
      activeJobRef.current = null;
      setIsRunning(false);
      setProgressText('Cancelamento solicitado. Resultados já salvos foram preservados.');
      return;
    }
    if (!groupLeads.length) {
      setProgressText('Este grupo não tem leads na base atual. Confira os membros em Base de Leads.');
      return;
    }
    if (!window.leadScoringAPI?.analyzeBatch) {
      setProgressText('Serviço de scoring indisponível. Nenhuma análise foi simulada.');
      return;
    }

    const jobId = `ui_batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    activeJobRef.current = jobId;
    const total = groupLeads.length;
    const initialStates = Object.fromEntries(groupLeads.map((lead) => [lead.id, 'wait']));
    setRunStates(initialStates);
    setProgressCount({ current: 0, total });
    setProgressText(`Enviando ${total} lead${total === 1 ? '' : 's'} para análise…`);
    setIsRunning(true);

    try {
      const response = await window.leadScoringAPI.analyzeBatch(groupLeads, { jobId });
      if (!response?.success) throw new Error(response?.error || 'A análise em lote falhou.');

      const savedLeads = (response.results || []).filter((row) => row?.success && row.lead).map((row) => row.lead);
      const skippedRows = (response.results || []).filter((row) => row?.skipped);
      const skippedIds = new Set(skippedRows.map((row) => String(row?.lead?.id || '')).filter(Boolean));
      const skippedPhones = new Set(skippedRows
        .map((row) => String(row?.lead?.phone || row?.lead?.company?.phone || '').replace(/\D/g, ''))
        .filter(Boolean));
      const isSkipped = (lead) => {
        if (skippedIds.has(String(lead?.id || ''))) return true;
        const phone = String(lead?.phone || lead?.company?.phone || '').replace(/\D/g, '');
        return !!phone && skippedPhones.has(phone);
      };
      const savedIndex = buildScoringIndex(savedLeads);
      const nextStates = { ...initialStates };
      const nextAnalyses = {};
      groupLeads.forEach((lead, position) => {
        if (isSkipped(lead)) {
          nextStates[lead.id] = 'skipped';
          return;
        };
        const saved = findScoringLead(savedIndex, lead, basePositions.get(lead) ?? position);
        if (!saved) {
          nextStates[lead.id] = 'fail';
          return;
        }
        const analysis = analysisFromService(saved, aiConfig.preset);
        nextAnalyses[lead.id] = analysis;
        nextStates[lead.id] = analysis.noSite ? 'nosite' : 'done';
      });
      setAnalysisMap((previous) => ({ ...previous, ...nextAnalyses }));
      setRunStates(nextStates);
      const skippedCount = Object.values(nextStates).filter((state) => state === 'skipped').length;
      const completed = Object.values(nextStates).filter((state) => state === 'done' || state === 'nosite' || state === 'skipped').length;
      setProgressCount({ current: completed, total });
      setProgressText(skippedCount
        ? `Concluída: ${completed - skippedCount} analisados, ${skippedCount} ignorados (sem site).`
        : (response.failures ? `Concluída com ${response.failures} falha(s).` : 'Análise concluída.'));
      // A IA pode falhar e o lote continuar com as regras locais. Isso precisa
      // aparecer: antes o usuário via "concluído" sem saber que a IA caiu.
      setAiWarning(response.aiWarning || '');
      addLog?.(`[SCORING] ${completed}/${total} análises persistidas no serviço.`);
      await loadCanonicalScoring();
    } catch (error) {
      setRunStates((previous) => Object.fromEntries(groupLeads.map((lead) => [lead.id, previous[lead.id] === 'done' ? 'done' : 'fail'])));
      setProgressText(error?.message || 'Não foi possível concluir a análise.');
      addLog?.(`[SCORING] Falha: ${error?.message || 'erro desconhecido'}`);
    } finally {
      if (activeJobRef.current === jobId) activeJobRef.current = null;
      setIsRunning(false);
    }
  };

  const handleRetrySingle = async (lead) => {
    if (!window.leadScoringAPI?.analyzeLead) return;
    const jobId = `ui_single_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setRunStates((previous) => ({ ...previous, [lead.id]: 'run' }));
    try {
      const response = await window.leadScoringAPI.analyzeLead(lead, { jobId });
      if (response?.skipped) {
        setRunStates((previous) => ({ ...previous, [lead.id]: 'skipped' }));
        setProgressText('Ignorado: lead sem site próprio.');
        return;
      }
      if (!response?.success || !response.lead) throw new Error(response?.error || 'A reanálise falhou.');
      const analysis = saveServiceAnalysis(lead.id, response.lead);
      setRunStates((previous) => ({ ...previous, [lead.id]: analysis?.noSite ? 'nosite' : 'done' }));
    } catch (error) {
      setRunStates((previous) => ({ ...previous, [lead.id]: 'fail' }));
      setProgressText(error?.message || 'A reanálise falhou.');
    }
  };

  useEffect(() => {
    if (!window.leadScoringAPI?.onProgress) return undefined;
    return window.leadScoringAPI.onProgress((payload) => {
      if (!payload) return;
      const external = ['auto-started', 'auto-completed', 'auto-failed'].includes(payload.event);
      if (!external && activeJobRef.current && payload.jobId !== activeJobRef.current) return;
      if (payload.event === 'auto-started') {
        setProgressText(payload.message || 'Analisando leads extraídos automaticamente…');
        setProgressCount({ current: 0, total: Number(payload.total) || 0 });
        return;
      }
      if (payload.event === 'auto-completed') {
        setProgressText(payload.message || 'Scoring automático concluído.');
        loadCanonicalScoring();
        return;
      }
      if (payload.event === 'auto-failed') {
        setProgressText(payload.message || 'Scoring automático falhou.');
        return;
      }
      // O id do serviço não é o id da base: reencontra o lead pela identidade.
      const savedIndex = payload.lead ? buildScoringIndex([payload.lead]) : null;
      const matched = savedIndex
        ? groupLeadsRef.current.find((lead, position) => findScoringLead(savedIndex, lead, position))
        : null;
      const uiLeadId = matched?.id || (savedIndex ? '' : payload.leadId || payload.lead?.id);
      if (payload.event === 'started' && uiLeadId) {
        setRunStates((previous) => ({ ...previous, [uiLeadId]: 'run' }));
      } else if (payload.event === 'saved' && payload.lead && uiLeadId) {
        const analysis = analysisFromService(payload.lead, aiConfig.preset);
        setAnalysisMap((previous) => ({ ...previous, [uiLeadId]: analysis }));
        setRunStates((previous) => ({ ...previous, [uiLeadId]: analysis.noSite ? 'nosite' : 'done' }));
      } else if (payload.event === 'skipped' && uiLeadId) {
        setRunStates((previous) => ({ ...previous, [uiLeadId]: 'skipped' }));
      } else if (payload.event === 'failed' && uiLeadId) {
        setRunStates((previous) => ({ ...previous, [uiLeadId]: 'fail' }));
      }
      if (Number.isFinite(payload.index) && Number.isFinite(payload.total)) {
        setProgressCount({ current: payload.index, total: payload.total });
      }
      if (payload.message) setProgressText(payload.message);
    });
  }, [aiConfig.preset, loadCanonicalScoring]);

  // Alternar seleção de linha
  const toggleRowSelect = (id) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Selecionar todos
  const toggleSelectAll = () => {
    if (selectedRowIds.size === groupLeads.length) {
      setSelectedRowIds(new Set());
    } else {
      setSelectedRowIds(new Set(groupLeads.map((l) => l.id)));
    }
  };

  // Exportar selecionados
  const handleExportSelected = () => {
    const itemsToExport = groupLeads.filter((l) => selectedRowIds.has(l.id));
    window.electronAPI?.exportLeads?.(itemsToExport, 'csv');
  };

  // Toggle accordion section in detail modal
  const toggleAcc = (secTitle) => {
    setOpenAccSections((prev) => ({ ...prev, [secTitle]: !prev[secTitle] }));
  };

  const progressPct = progressCount.total > 0
    ? Math.round((progressCount.current / progressCount.total) * 100)
    : 0;

  const currentPresetName = AUDITS[aiConfig.preset]?.name || aiConfig.preset;

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Se nenhum grupo selecionado: Estado Vazio (#scEmpty) */}
      {!currentGroup ? (
        <div id="scEmpty">
          <div className="empty" style={{ padding: '56px 20px' }}>
            <div className="e-icon">◎</div>
            <b style={{ color: 'var(--fg)', fontSize: 15 }}>Selecione um grupo para analisar</b>
            <span style={{ maxWidth: '46ch', textAlign: 'center', lineHeight: 1.5 }}>
              O scoring investiga a presença digital das empresas de um grupo, uma por uma.
            </span>

            <div className="field" style={{ minWidth: 'min(320px, 80vw)', marginTop: 8 }}>
              <select
                id="scGroupPick"
                aria-label="Selecionar grupo"
                value={selectedGroupId}
                onChange={(e) => handleSelectGroup(e.target.value)}
              >
                <option value="">Escolher grupo…</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({(g.resolved || []).length})
                  </option>
                ))}
              </select>
            </div>

            {groups.length === 0 && (
              <div id="scNoGroups" style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', marginTop: 12 }}>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>Você ainda não possui grupos de leads.</span>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    window.location.hash = '#base';
                    window.dispatchEvent(new CustomEvent('sigma:open-groups'));
                  }}
                >
                  Criar grupo na Base de Leads
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Quando grupo está selecionado: Área de Trabalho (#scWork) */
        <div id="scWork" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
           {/* Top 3 Steps */}
           <div className="sc-steps" data-od-id="scoring-steps">
             {/* Step 1: Grupo */}
             <div className="sc-step sc-group-step">
               <div className="lb">1 · Grupo</div>
               <div className="sc-group-picker">
                 <select
                   className="sc-pick sc-group-select"
                   id="scGroupBtn"
                   aria-label="Escolher grupo para analisar"
                   value={selectedGroupId}
                   onChange={(event) => handleSelectGroup(event.target.value)}
                 >
                   {groups.map((group) => (
                     <option key={group.id} value={group.id}>
                       {group.name}
                     </option>
                   ))}
                 </select>
                 <button
                   type="button"
                   className="icon-btn sc-group-add"
                   title="Criar ou gerenciar grupos"
                   aria-label="Criar ou gerenciar grupos"
                   onClick={() => {
                     window.location.hash = '#base';
                     window.dispatchEvent(new CustomEvent('sigma:open-groups'));
                   }}
                 >
                   <Plus size={16} />
                 </button>
               </div>
               <span className="result-count" id="scGroupN">
                 {groupLeads.length} leads
               </span>
             </div>

             {/* Step 2: IA e Análise */}
             <div className="sc-step">
               <div className="lb">2 · IA</div>
               <div className="sc-cfg" id="scCfgLine">
                 <span className="sc-cfg-line"><b>IA</b> · {aiConfig.model || 'modelo padrão'}</span>
                 <span className="sc-cfg-line"><b>Foco</b> · {currentPresetName}</span>
               </div>
               <button
                 type="button"
                 className="btn btn-sm btn-primary sc-configure-btn"
                 id="scCfgBtn"
                 onClick={handleOpenAiModal}
               >
                 <Settings size={14} /> Configurar
               </button>
             </div>

             {/* Step 3: Ação */}
             <div className="sc-step sc-action-step">
               <button
                 type="button"
                 className="btn btn-primary"
                 id="scRunBtn"
                 onClick={handleRunScoring}
               >
                 {isRunning ? 'Pausar análise' : 'Analisar grupo'}
               </button>
             </div>
           </div>

          {aiWarning ? (
            <div className="kanban-feedback error" role="alert" id="scAiWarning">
              <AlertTriangle size={15} />
              <span>
                A IA não respondeu ({aiWarning}). Os scores e mensagens saíram das regras locais — confira o provedor em Configurar.
              </span>
              <button type="button" aria-label="Fechar aviso" onClick={() => setAiWarning('')}><X size={14} /></button>
            </div>
          ) : null}

          {/* Painel de Progresso (#scProgPanel) */}
          {(isRunning || progressCount.current > 0) && (
            <div className="panel" id="scProgPanel" data-od-id="scoring-progress" style={{ padding: 14, background: '#fff', border: '1px solid var(--border)', borderRadius: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <b style={{ fontSize: 13.5 }} id="scProgTxt">{progressText}</b>
                <span style={{ flex: 1 }} />
                <span className="result-count" id="scProgN">
                  {progressCount.current} / {progressCount.total}
                </span>
              </div>

              <div className="progress-track" style={{ marginTop: 8 }}>
                <div
                  className="progress-fill"
                  id="scProgFill"
                  style={{ width: `${progressPct}%` }}
                />
              </div>

              {/* Fila ao vivo */}
              <div
                id="scRunList"
                style={{
                  marginTop: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  maxHeight: 200,
                  overflowY: 'auto'
                }}
              >
                {groupLeads.map((l) => {
                  const st = runStates[l.id] || (analysisMap[l.id] ? (analysisMap[l.id].noSite ? 'nosite' : 'done') : 'wait');
                  const pillConfig = {
                    wait: { label: 'Aguardando', cls: 'st-wait' },
                    run: { label: 'Analisando', cls: 'st-run' },
                    done: { label: 'Concluído', cls: 'st-ok' },
                    fail: { label: 'Falhou', cls: 'st-fail' },
                    nosite: { label: 'Sem site', cls: 'st-nosite' },
                    skipped: { label: 'Ignorado · sem site', cls: 'st-nosite' }
                  }[st] || { label: 'Aguardando', cls: 'st-wait' };

                  return (
                    <div key={l.id} className="run-row" id={`run-${l.id}`}>
                      <span className="nm">{l.name || 'Empresa'}</span>
                      <span className={`st-pill ${pillConfig.cls}`}>
                        {pillConfig.label}
                      </span>
                      {st === 'fail' && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => handleRetrySingle(l)}
                        >
                          Tentar de novo
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tabela de Resultados (#scResults) */}
          <div id="scResults" data-od-id="scoring-results">
            {/* Barra de Seleção */}
            {selectedRowIds.size > 0 && (
              <div className="selbar" id="scSelBar" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--surface-warm)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 8 }}>
                <b id="scSelCount">{selectedRowIds.size}</b>
                <span>selecionados</span>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  id="scSelExp"
                  onClick={handleExportSelected}
                >
                  Exportar CSV
                </button>
              </div>
            )}

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>
                      <input
                        type="checkbox"
                        className="rowcheck"
                        id="scChkAll"
                        aria-label="Selecionar todos"
                        checked={selectedRowIds.size > 0 && selectedRowIds.size === groupLeads.length}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <th>Empresa</th>
                    <th>Score</th>
                    <th>Site</th>
                    <th>Situação</th>
                    <th>Oportunidades</th>
                    <th>Atualizado</th>
                    <th style={{ width: 90 }}></th>
                  </tr>
                </thead>
                <tbody id="scResBody">
                  {groupLeads.length === 0 ? (
                    <tr>
                      <td colSpan={8}>
                        <div className="empty">
                          <div className="e-icon">○</div>
                          <b style={{ color: 'var(--fg)' }}>Nenhum lead deste grupo está na base atual</b>
                          <span>
                            {currentGroup.source === 'scoring'
                              ? 'Este grupo foi criado pelo scoring e os leads não existem mais na base.'
                              : 'Os membros do grupo não batem com os leads da Base de Leads. Recrie o grupo na Base para voltar a analisar.'}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  {groupLeads.map((lead) => {
                    const an = analysisMap[lead.id];
                    const isRowChecked = selectedRowIds.has(lead.id);

                    const score = an ? an.score : null;
                    const band = score != null ? scoreBand(score, thresholds) : null;

                    const sit = an ? (an.noSite ? ['Sem site', 'st-nosite'] : ['Concluído', 'st-ok']) : ['Não analisado', 'st-wait'];

                    return (
                      <tr key={lead.id} className={isRowChecked ? 'selrow' : ''}>
                        <td>
                          <input
                            type="checkbox"
                            className="rowcheck"
                            checked={isRowChecked}
                            aria-label={`Selecionar ${lead.name}`}
                            onChange={() => toggleRowSelect(lead.id)}
                          />
                        </td>
                        <td>
                          <b
                            style={{ cursor: 'pointer', color: 'var(--teal-deep)' }}
                            onClick={() => setDetailLead(lead)}
                          >
                            {lead.name || 'Empresa'}
                          </b>
                        </td>
                        <td title={scoreWhyTitle(an, score, band, thresholds)}>
                          {an ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                              <b style={{ fontVariantNumeric: 'tabular-nums' }}>{score}</b>
                              <span className={`ftag ${band.key}`} style={{ marginLeft: 6 }}>
                                {band.label}
                              </span>
                            </span>
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--meta)' }}>Não analisado</span>
                          )}
                        </td>
                        <td style={{ fontSize: 12.5 }}>
                          {isRealWebsite(lead.website) ? (
                            <button type="button" className="site-icon-btn" title={lead.website} aria-label={`Abrir site ${lead.website}`} onClick={() => window.electronAPI?.openSite?.(lead.website)}>
                              <Globe size={15} />
                            </button>
                          ) : (
                            'Sem site'
                          )}
                        </td>
                        <td>
                          <span className={`st-pill ${sit[1]}`}>{sit[0]}</span>
                        </td>
                        <td style={{ fontSize: 12.5, maxWidth: 220 }} title={an ? an.opp.join('; ') : ''}>
                          {an && an.opp.length > 0 ? an.opp.slice(0, 2).join(' · ') : '—'}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                          {an ? fmtShort(an.ts) : '—'}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => handleRetrySingle(lead)}
                          >
                            Reanalisar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Configuração de IA (#aiCfgOv) */}
      {isAiModalOpen && (
        <div className="overlay on" id="aiCfgOv" data-od-id="modal-config-ia">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="aiCfgTitle"
            style={{ width: 'min(520px, 94vw)' }}
          >
            <div className="modal-head">
              <h2 id="aiCfgTitle">Configurar análise</h2>
            </div>

            <div className="modal-body" style={{ gridTemplateColumns: '1fr', gap: 14 }}>
              <div className="exp-sec">Provedor de IA — quem executa</div>
              <div id="aiProv" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {Object.keys(PROVIDERS).map((k) => {
                  const p = PROVIDERS[k];
                  const isSel = aiDraft.provider === k;
                  return (
                    <div
                      key={k}
                      className={`exp-row ${isSel ? 'sel' : ''}`}
                      role="radio"
                      aria-checked={isSel}
                      tabIndex={0}
                      onClick={() => {
                        setAiDraft((prev) => ({
                          ...prev,
                          provider: k,
                          baseUrl: k !== 'custom' && p.base ? p.base : prev.baseUrl,
                          model: p.defaultModel || prev.model,
                          // Nunca envia uma chave de outro provedor por acidente.
                          key: '',
                          hasApiKey: false,
                        }));
                      }}
                    >
                      <b>{p.name}</b>
                      <span>{isSel ? 'em uso' : 'usar'}</span>
                    </div>
                  );
                })}
              </div>

              <div className="field">
                <label htmlFor="aiBase">Base URL</label>
                <input
                  id="aiBase"
                  autoComplete="off"
                  spellCheck="false"
                  readOnly={aiDraft.provider !== 'custom'}
                  placeholder={aiDraft.provider === 'custom' ? 'https://sua-api.com/v1' : ''}
                  value={aiDraft.baseUrl || ''}
                  onChange={(e) => setAiDraft({ ...aiDraft, baseUrl: e.target.value })}
                />
              </div>

              <div className="field">
                <label htmlFor="aiKey">API Key</label>
                <div className="hood-add" style={{ display: 'flex', gap: 8 }}>
                  <input
                    id="aiKey"
                    type={showKey ? 'text' : 'password'}
                    autoComplete="new-password"
                    spellCheck="false"
                    style={{ flex: 1 }}
                    placeholder={aiDraft.hasApiKey ? 'Chave salva — informe outra para substituir' : 'Informe a API key do provedor'}
                    value={aiDraft.key || ''}
                    onChange={(e) => setAiDraft({ ...aiDraft, key: e.target.value, hasApiKey: Boolean(e.target.value) || aiDraft.hasApiKey })}
                  />
                  <button
                    type="button"
                    className="btn btn-sm"
                    id="aiShow"
                    onClick={() => setShowKey((v) => !v)}
                  >
                    {showKey ? 'Ocultar' : 'Mostrar'}
                  </button>
                </div>
              </div>

              <div className="field">
                <label htmlFor="aiModel">Modelo</label>
                <input
                  id="aiModel"
                  list="aiModelsList"
                  autoComplete="off"
                  spellCheck="false"
                  value={aiDraft.model || ''}
                  onChange={(e) => setAiDraft({ ...aiDraft, model: e.target.value })}
                />
                <datalist id="aiModelsList">
                  {(PROVIDERS[aiDraft.provider]?.models || []).map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                {aiDraft.provider === 'opencode' ? (
                  <small className={`sc-provider-route ${/-free$/i.test(aiDraft.model || '') ? 'warn' : ''}`}>
                    {/-free$/i.test(aiDraft.model || '')
                      ? 'Modelos “-free” do Zen são recusados fora do próprio OpenCode. Escolha um modelo com créditos ou use OpenRouter.'
                      : `Usa créditos do Zen. A rota correta é escolhida automaticamente (${/^muse-|^gpt-|^grok-/i.test(aiDraft.model || '') ? '/responses' : '/chat/completions'}).`}
                  </small>
                ) : null}
                {aiDraft.provider === 'nvidia' ? <small className="sc-provider-route">NVIDIA Build usa a API compatível com OpenAI em integrate.api.nvidia.com.</small> : null}
                {aiDraft.provider === 'openrouter' ? <small className="sc-provider-route">OpenRouter/free escolhe automaticamente um modelo gratuito disponível.</small> : null}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button type="button" className="btn btn-sm" id="aiTest" onClick={handleTestAi}>
                  Testar conexão
                </button>
              </div>
              {testStatusMsg ? (
                <p className={`sc-test-status ${testStatusOk ? 'ok' : 'warn'}`} role="status" id="aiTestMsg">
                  {testStatusOk ? <CheckCircle size={13} /> : <AlertTriangle size={13} />}
                  <span>{testStatusMsg}</span>
                </p>
              ) : null}

              <div className="exp-sec">Foco da auditoria — o que procurar</div>
              <div id="auditPresets" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {Object.keys(AUDITS).map((k) => {
                  const audit = AUDITS[k];
                  const isSel = aiDraft.preset === k;
                  return (
                    <div
                      key={k}
                      className={`exp-row ${isSel ? 'sel' : ''}`}
                      role="radio"
                      aria-checked={isSel}
                      tabIndex={0}
                      onClick={() => setAiDraft({ ...aiDraft, preset: k })}
                    >
                      <b>{audit.name}</b>
                      <span>{audit.hint}</span>
                    </div>
                  );
                })}
              </div>

              {aiDraft.preset === 'custom' && (
                <div className="field" id="auditObjWrap">
                  <label htmlFor="auditObj">Objetivo da análise</label>
                  <input
                    id="auditObj"
                    placeholder="Ex.: empresas com presença fraca e boa reputação local"
                    autoComplete="off"
                    value={aiDraft.objective || ''}
                    onChange={(e) => setAiDraft({ ...aiDraft, objective: e.target.value })}
                  />
                </div>
              )}

              <div className="exp-sec">Regras do score — como o lead é priorizado</div>
              <div className="sc-rules-grid" id="scRules">
                {RULE_FIELDS.map((field) => (
                  <label key={field.key} className="sc-rule-field">
                    <span>{field.label}</span>
                    <input
                      type="number"
                      min={field.min}
                      max={field.max}
                      value={rulesDraft[field.key] ?? ''}
                      onChange={(e) => setRulesDraft((previous) => ({ ...previous, [field.key]: e.target.value === '' ? '' : Number(e.target.value) }))}
                    />
                    <small>{field.hint}</small>
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setRulesDraft(defaultRulesDraft())}
                >
                  Restaurar padrão
                </button>
                <span className="result-count">Vale para a próxima análise e para o Kanban.</span>
              </div>

              <label className="sc-toggle">
                <input
                  type="checkbox"
                  checked={autoAnalyze}
                  onChange={(e) => setAutoAnalyze(e.target.checked)}
                />
                <span>
                  <b>Analisar automaticamente após cada extração</b>
                  <small>Cada busca no Maps já sai com score calculado, sem clique extra.</small>
                </span>
              </label>
            </div>

            <div className="modal-foot">
              <button
                type="button"
                className="btn btn-ghost"
                id="aiCancel"
                onClick={() => setIsAiModalOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                id="aiSave"
                onClick={handleSaveAiModal}
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Detalhe do Lead (com Score e Auditoria) */}
      {detailLead && (
        <div className="overlay on" onClick={() => setDetailLead(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            style={{ width: 'min(640px, 94vw)', maxHeight: '88vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h2>{detailLead.name || 'Empresa'}</h2>
            </div>

            <div className="modal-body" style={{ gridTemplateColumns: '1fr', gap: 12 }}>
              {analysisMap[detailLead.id] ? (
                (() => {
                  const detail = analysisMap[detailLead.id];
                  const detailBand = scoreBand(detail.score, thresholds);
                  return (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
                        <span style={{ fontFamily: 'var(--font-display)', fontSize: 42, fontWeight: 700, lineHeight: 1 }}>
                          {detail.score}
                        </span>
                        <span className={`ftag ${detailBand.key}`}>{detailBand.label}</span>
                      </div>

                      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
                        {AUDITS[detail.preset]?.name || detail.preset} · {fmtShort(detail.ts)} · {detail.provider}
                      </div>

                      {[
                        { t: `Pontos positivos (${detail.pos.length})`, items: detail.pos },
                        { t: `Problemas encontrados (${detail.neg.length})`, items: detail.neg },
                        { t: `Oportunidades (${detail.opp.length})`, items: detail.opp },
                        ...(detail.sections || [])
                      ].map((sec, idx) => {
                        const isOpen = Boolean(openAccSections[sec.t]);
                        return (
                          <div key={idx} className={`acc ${isOpen ? 'open' : ''}`}>
                            <button
                              type="button"
                              className="acc-head"
                              onClick={() => toggleAcc(sec.t)}
                            >
                              <span>{sec.t}</span>
                              <span className="chev">›</span>
                            </button>
                            <div className="acc-body">
                              <ul>
                                {sec.items.map((it, i) => (
                                  <li key={i}>{it}</li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()
              ) : (
                <div className="empty">
                  <div className="e-icon">○</div>
                  <b style={{ color: 'var(--fg)' }}>Não analisado</b>
                  <span>Execute a análise do grupo para visualizar o raio-x deste lead.</span>
                </div>
              )}
            </div>

            <div className="modal-foot">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setDetailLead(null)}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
