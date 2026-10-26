import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  ListTodo,
  Activity,
  MessageSquare,
  PlusCircle,
  Play,
  Pause,
  Trash2,
  RefreshCw,
  User,
  Users,
  CheckCheck,
  Download,
  FileText,
  Mic,
  Image as ImageIcon,
  Zap,
  Phone,
  Search,
  Pin,
  Archive,
  ExternalLink,
  Film,
  Smile,
  X,
  UserPlus,
  Pencil,
  ChevronLeft,
  Check,
  Clock,
  Bell,
  BarChart3,
  Sparkles,
  Reply,
  Tag,
  MoreVertical,
  Pause as PauseIcon,
  Play as PlayIcon,
  RotateCcw,
} from 'lucide-react';
import TriggersManagerModal from './TriggersManagerModal';
import ChatVoicePlayer from './ChatVoicePlayer';
import { resolveGroupMembers } from '../leadMatch.mjs';

/** Isola crash de um player de áudio para não derrubar o chat inteiro */
class VoicePlayerBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err) {
    console.warn('[SIGMA] VoicePlayerBoundary:', err?.message || err);
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="chat-voice">
          <button
            type="button"
            className="chat-media-retry"
            onClick={() => this.setState({ failed: false })}
          >
            Áudio falhou — tocar de novo
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function recipientKey(r) {
  if (!r) return '';
  if (r.isGroup || String(r.jid || r.phone || '').endsWith('@g.us')) {
    return `g:${r.jid || r.phone}`;
  }
  const phone = String(r.phone || r.jid || '').replace(/\D/g, '');
  return phone ? `p:${phone}` : `j:${r.jid || ''}`;
}

function normalizeAddressForDisplay(value) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/^[\s\p{Cc}\p{Cf}\p{Co}\u{1F4CD}\u{FE0E}\u{FE0F}]+/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Nome padrão: Campanha DD/MM/AAAA HH:mm */
function buildDefaultCampaignName(date = new Date()) {
  const d = date instanceof Date ? date : new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `Campanha ${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

/** Converte timestamp (ms) em valor datetime-local (horário local). */
function toDatetimeLocalValue(ts) {
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Extrai {{variáveis}} do texto do template. */
function extractTemplateVariables(text) {
  const vars = new Set();
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let m;
  while ((m = re.exec(String(text || '')))) vars.add(m[1]);
  if (!vars.size) vars.add('name');
  return [...vars].slice(0, 20);
}

function parseHhmmToMinutes(value, fallback) {
  const m = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  return (parseInt(m[1], 10) % 24) * 60 + (parseInt(m[2], 10) % 60);
}

/**
 * Estima quantos dias de campanha são necessários para zerar a lista.
 * Considera divisão entre números, intervalo entre envios, limite diário
 * por número (filtro anti-ban) e janela de horário de disparo.
 */
function estimateCampaignDuration({
  totalLeads,
  intervalSec,
  connectionCount,
  dailyLimit,
  manualUnlimited,
  workingHoursEnabled,
  workingHoursStart,
  workingHoursEnd,
}) {
  const total = Math.max(0, Math.floor(Number(totalLeads) || 0));
  if (!total) return null;
  const conns = Math.max(1, Math.floor(Number(connectionCount) || 1));
  const interval = Math.max(5, Math.floor(Number(intervalSec) || 60));
  let windowMin;
  let windowLabel;
  if (workingHoursEnabled === false) {
    windowMin = 24 * 60;
    windowLabel = '24h';
  } else {
    const s = parseHhmmToMinutes(workingHoursStart, 7 * 60);
    const e = parseHhmmToMinutes(workingHoursEnd, 18 * 60);
    windowMin = e > s ? e - s : (24 * 60 - s) + e;
    if (!(windowMin > 0)) windowMin = 24 * 60;
    const pad = (n) => String(n).padStart(2, '0');
    windowLabel = `${pad(Math.floor(s / 60))}:${pad(s % 60)}–${pad(Math.floor(e / 60))}:${pad(e % 60)}`;
  }
  // Capacidade da janela: 1º envio no minuto 0 + 1 a cada intervalo.
  const windowCapacity = Math.max(1, Math.floor((windowMin * 60) / interval) + 1);
  const quotaPerDay = manualUnlimited ? null : Math.max(1, Math.floor(Number(dailyLimit) || 10));
  const perDayPerNumber = quotaPerDay == null ? windowCapacity : Math.max(1, Math.min(windowCapacity, quotaPerDay));
  const limitedBy = quotaPerDay != null && quotaPerDay < windowCapacity ? 'daily-limit' : 'working-hours';
  const perNumberLeads = Math.ceil(total / conns);
  const days = Math.max(1, Math.ceil(perNumberLeads / perDayPerNumber));
  return { days, perDayPerNumber, perNumberLeads, conns, total, intervalSec: interval, windowMin, windowLabel, quotaPerDay, limitedBy };
}

/** Regiões disponíveis para o agendamento (padrão = relógio do sistema). */
const CAMPAIGN_TIMEZONES = [
  { id: 'system', label: 'Sistema (padrão)' },
  { id: 'America/Noronha', label: 'Fernando de Noronha (GMT-2)' },
  { id: 'America/Sao_Paulo', label: 'Brasília (GMT-3)' },
  { id: 'America/Manaus', label: 'Manaus (GMT-4)' },
  { id: 'America/Rio_Branco', label: 'Rio Branco (GMT-5)' },
];

function campaignTimeZoneId(settings) {
  const tz = settings?.campaigns?.timeZone;
  return tz && tz !== 'system' ? tz : 'system';
}

function timeZoneShortLabel(tz) {
  const found = CAMPAIGN_TIMEZONES.find((z) => z.id === tz);
  if (found) return found.id === 'system' ? 'sistema' : found.label.split(' (')[0];
  try {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value || tz;
  } catch {
    return 'sistema';
  }
}

/** Offset da zona num instante (ms): parede-da-zona-como-UTC menos o instante. */
function timeZoneOffsetMs(timeZone, dateMs) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(new Date(dateMs)).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, (+parts.hour) % 24, +parts.minute, +parts.second);
  return asUTC - dateMs;
}

/** Interpreta "YYYY-MM-DDTHH:mm" como horário na zona indicada → epoch ms. */
function zonedDateTimeToMs(localStr, timeZone) {
  const m = String(localStr || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return NaN;
  const Y = +m[1]; const Mo = +m[2]; const D = +m[3]; const H = +m[4]; const Mi = +m[5];
  if (!timeZone || timeZone === 'system') return new Date(Y, Mo - 1, D, H, Mi).getTime();
  const guess = Date.UTC(Y, Mo - 1, D, H, Mi);
  return guess - timeZoneOffsetMs(timeZone, guess);
}

/** Epoch ms → "YYYY-MM-DDTHH:mm" na parede da zona indicada. */
function msToZonedDateTimeLocal(ms, timeZone) {
  if (!timeZone || timeZone === 'system') return toDatetimeLocalValue(ms);
  const d = new Date(Number(ms) + timeZoneOffsetMs(timeZone, Number(ms)));
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "DD/MM HH:mm" do instante na zona indicada. */
function formatInZone(ms, timeZone) {
  try {
    if (!timeZone || timeZone === 'system') throw new Error('system');
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone,
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
}

function CampaignDurationHint({ estimate }) {
  if (!estimate) return null;
  const dayLabel = estimate.days === 1 ? '≈ 1 dia de campanha' : `≈ ${estimate.days} dias de campanha`;
  const reason = estimate.limitedBy === 'daily-limit'
    ? `limite diário de ${estimate.quotaPerDay}/dia por número`
    : `janela ${estimate.windowLabel} com intervalo de ${estimate.intervalSec}s`;
  return (
    <div className="camp-review-card" style={{ marginTop: 12 }} role="status" aria-live="polite">
      <strong>⏱ Duração estimada: {dayLabel}</strong>
      <div className="camp-hint" style={{ marginTop: 4, lineHeight: 1.5 }}>
        {estimate.perNumberLeads} lead(s) por número · {estimate.perDayPerNumber} envio(s)/dia por número
        {estimate.conns > 1 ? ` · ${estimate.conns} números em paralelo` : ''}.
        <br />
        Gargalo: {reason} (considera retomada a cada dia).
      </div>
    </div>
  );
}

const CAMPAIGN_KANBAN_STAGES = [
  { id: 'new', label: 'Novos', hint: 'Ainda sem conversa' },
  { id: 'conversation', label: 'Em conversa', hint: 'Responderam ou estão em negociação' },
  { id: 'finished', label: 'Finalizados', hint: 'Ciclo encerrado' },
];

function resolveKanbanStage(lead) {
  if (['new', 'conversation', 'finished'].includes(lead?.kanbanStage)) return lead.kanbanStage;
  if (lead?.status === 'replied') return 'conversation';
  if (lead?.status === 'failed') return 'finished';
  return 'new';
}

function campaignStatusPresentation(campaign) {
  const status = campaign?.status || 'ready';
  if (status === 'paused' && campaign?.pauseReason === 'daily_limit') {
    return { statusClass: 'paused', label: 'Limite de hoje esgotado' };
  }
  if (status === 'paused' && campaign?.pauseReason === 'missed_schedule') {
    return { statusClass: 'paused', label: 'Horário perdido' };
  }
  if (status === 'running' && campaign?.waitReason === 'outside_hours') {
    return { statusClass: 'running', label: 'Fora do horário' };
  }
  if (status === 'running' && campaign?.waitReason === 'no_provider') {
    return { statusClass: 'running', label: 'Aguardando WhatsApp' };
  }
  return {
    statusClass: ['running', 'scheduled', 'paused', 'completed'].includes(status) ? status : 'ready',
    label: {
      ready: 'Rascunho',
      running: 'Em andamento',
      scheduled: 'Agendada',
      paused: 'Pausada',
      completed: 'Concluída',
      cancelled: 'Cancelada',
      failed: 'Com falhas',
    }[status] || 'Rascunho',
  };
}

/**
 * Campo de nome isolado — state local evita digitar “morrer”
 * quando o WhatsAppPanel re-renderiza (presença, chats, etc.).
 */
function CampaignNameInput({
  id,
  initialValue,
  onChange,
  inputRef,
  placeholder,
}) {
  const [value, setValue] = useState(() => initialValue || '');
  const lastInitial = useRef(initialValue);

  useEffect(() => {
    // só sincroniza quando o pai manda um initial novo (abrir/editar)
    if (initialValue !== lastInitial.current) {
      lastInitial.current = initialValue;
      setValue(initialValue || '');
    }
  }, [initialValue]);

  return (
    <input
      ref={inputRef}
      id={id}
      type="text"
      name="campaignName"
      className="camp-name-input"
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      tabIndex={0}
      value={value}
      placeholder={placeholder || 'Ex: Academias Centro — ou deixe vazio p/ nome automático'}
      onChange={(e) => {
        const next = e.target.value;
        setValue(next);
        onChange?.(next);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    />
  );
}

const DEMO_QR_CELLS = (() => {
  let seed = 7;
  return Array.from({ length: 441 }, (_, index) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const x = index % 21;
    const y = Math.floor(index / 21);
    const finder = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
    if (finder) {
      const localX = x > 13 ? x - 14 : x;
      const localY = y > 13 ? y - 14 : y;
      return localX === 0 || localX === 6 || localY === 0 || localY === 6
        || (localX > 1 && localX < 5 && localY > 1 && localY < 5);
    }
    return seed % 100 < 46;
  });
})();

function WhatsAppPanel({ waStatus, setWaStatus, addLog }) {
  const [waTab, setWaTab] = useState('chats');
  const [connections, setConnections] = useState([]);
  const [activeConnectionId, setActiveConnectionId] = useState(null);
  const [qrCodeUrl, setQrCodeUrl] = useState(null);
  // Fluxo local de QR/pairing — NÃO usa o status global (agregado),
  // para poder adicionar um 2º número sem apagar o "conectado" da bolinha.
  const [connectFlowStatus, setConnectFlowStatus] = useState(null); // connecting | qr_ready | null
  const [pendingConnectionId, setPendingConnectionId] = useState(null);
  const pendingConnectionIdRef = useRef(null);
  const [providerType, setProviderType] = useState('baileys');

  // Campaigns state
  const [campaigns, setCampaigns] = useState([]);
  const [kanbanCampaign, setKanbanCampaign] = useState(null);
  const [draggingKanbanCard, setDraggingKanbanCard] = useState(null);
  const [isCreatingCampaign, setIsCreatingCampaign] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState(null);
  // Recuperação pós-boot: campanhas cujo horário passou com o PC desligado.
  const [recoveryMissed, setRecoveryMissed] = useState(null);
  const [recoveryBusyId, setRecoveryBusyId] = useState(null);
  const [newCampaignName, setNewCampaignName] = useState('');
  const [campaignRecipients, setCampaignRecipients] = useState([]);
  const [customNumberInput, setCustomNumberInput] = useState('');
  const [customNameInput, setCustomNameInput] = useState('');
  const [recipientSearch, setRecipientSearch] = useState('');
  const [campaignManualText, setCampaignManualText] = useState('');
  /** Grupos vinculados — campanha soma grupos (adicionar, nunca substituir). */
  const [campaignGroupIds, setCampaignGroupIds] = useState([]);
  const [waContacts, setWaContacts] = useState([]);
  const [waGroups, setWaGroups] = useState([]);
  /** Fonte de destinatários: scrape | groups | scoring | whatsapp | manual */
  const [recipientSourceTab, setRecipientSourceTab] = useState('scrape');
  const [scrapeSearches, setScrapeSearches] = useState([]); // { id, label, count, withPhone }
  const [scrapeLeadPool, setScrapeLeadPool] = useState([]); // leads do scraping em memória
  const [scoringGroups, setScoringGroups] = useState([]);
  // Membros resolvidos contra a base de leads. O grupo guarda chaves de
  // identidade (telefone, nome+endereço), então a resolução precisa acontecer
  // aqui — o serviço sozinho não consegue ligar grupo → telefone para discar.
  const [groupResolvedLeads, setGroupResolvedLeads] = useState(() => new Map());
  const [scoringLeadPool, setScoringLeadPool] = useState([]); // leads analisados
  const [scoringPriorityFilter, setScoringPriorityFilter] = useState('all'); // all | alta | media | baixa
  const [recipientBrowseFilter, setRecipientBrowseFilter] = useState('');
  const [selectedBrowseKeys, setSelectedBrowseKeys] = useState(() => new Set());
  const [recipientSourcesLoading, setRecipientSourcesLoading] = useState(false);
  const [templateText, setTemplateText] = useState('Olá {{name}}, tudo bem? Notamos que o seu site está com lentidão.');
  const [intervalSec, setIntervalSec] = useState(60);
  const [scheduleMode, setScheduleMode] = useState('interval');
  const [scheduleStartAt, setScheduleStartAt] = useState('');

  // Selected Campaign for Monitoring
  const [monitoringCampaignId, setMonitoringCampaignId] = useState(null);
  const [monitoringCampaign, setMonitoringCampaign] = useState(null);

  // Chat panel state
  const [chats, setChats] = useState([]);
  const [archivedChats, setArchivedChats] = useState([]);
  const [activeChatJid, setActiveChatJid] = useState(null);
  const [activeChatName, setActiveChatName] = useState('');
  const [activeChatMeta, setActiveChatMeta] = useState(null); // { isGroup, phone, profilePic }
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [chatPresence, setChatPresence] = useState(null); // { online, lastSeen, statusText }
  const [chatFilter, setChatFilter] = useState('all'); // all | unread | groups | archived
  const [chatSearch, setChatSearch] = useState('');
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [newChatSearch, setNewChatSearch] = useState('');
  const [newChatBusy, setNewChatBusy] = useState(false);
  const [newChatError, setNewChatError] = useState('');
  const [directChatPending, setDirectChatPending] = useState(null);
  const [chatContextMenu, setChatContextMenu] = useState(null);
  const [chatReminderTarget, setChatReminderTarget] = useState(null);
  const [chatReminderDraft, setChatReminderDraft] = useState({ at: '', note: '' });
  const [chatKanbanCard, setChatKanbanCard] = useState(null);
  const [chatKanbanColumns, setChatKanbanColumns] = useState([]);
  const [chatKanbanBusy, setChatKanbanBusy] = useState(false);
  const [chatKanbanValue, setChatKanbanValue] = useState('');
  const [forwardMessage, setForwardMessage] = useState(null);
  const [forwardSearch, setForwardSearch] = useState('');
  const [forwardBusy, setForwardBusy] = useState(false);
  const [forwardError, setForwardError] = useState('');
  const [profilePics, setProfilePics] = useState({}); // jid -> dataUrl
  const [mediaCache, setMediaCache] = useState({}); // messageId -> { status, dataUrl, mimetype, filePath, error }
  const [linkPreviews, setLinkPreviews] = useState({}); // url -> { status, title, description, image, siteName }
  const [lightbox, setLightbox] = useState(null); // { src, alt }
  const [replyTo, setReplyTo] = useState(null); // mensagem completa para quote
  const [msgMenuId, setMsgMenuId] = useState(null); // messageId com menu aberto
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileInfo, setProfileInfo] = useState(null);
  const [labelCatalog, setLabelCatalog] = useState([]);
  const [labelsByJid, setLabelsByJid] = useState({});
  const [newTagName, setNewTagName] = useState('');
  const [tagPickerOpen, setTagPickerOpen] = useState(false); // seletor individual (só este contato)
  const [isAcctMenuOpen, setIsAcctMenuOpen] = useState(false);
  const [isConnMenuOpen, setIsConnMenuOpen] = useState(false);
  const [isConvMenuOpen, setIsConvMenuOpen] = useState(false);
  const [isConnectionsModalOpen, setIsConnectionsModalOpen] = useState(false);
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [qrError, setQrError] = useState('');
  const [isSessionProfileOpen, setIsSessionProfileOpen] = useState(false);
  const [sessionProfile, setSessionProfile] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('sigma_wa_profile') || 'null');
      if (saved && typeof saved === 'object') return saved;
    } catch (_) {}
    return { name: 'Sigma Comercial', about: 'Prospecção B2B no automático', phone: '' };
  });
  const [isFindBarOpen, setIsFindBarOpen] = useState(false);
  const [inChatSearchTerm, setInChatSearchTerm] = useState('');
  const [inChatMatchIdx, setInChatMatchIdx] = useState(0);
  const inChatMatches = useMemo(() => {
    if (!inChatSearchTerm.trim()) return [];
    const term = inChatSearchTerm.toLowerCase();
    const matches = [];
    messages.forEach((m, idx) => {
      const text = String(
        m.message?.conversation ||
        m.message?.extendedTextMessage?.text ||
        m.text ||
        ''
      ).toLowerCase();
      if (text.includes(term)) {
        matches.push({ messageId: m.key?.id, index: idx });
      }
    });
    return matches;
  }, [messages, inChatSearchTerm]);

  const handleFindNext = () => {
    if (!inChatMatches.length) return;
    setInChatMatchIdx((prev) => (prev + 1) % inChatMatches.length);
  };

  const handleFindPrev = () => {
    if (!inChatMatches.length) return;
    setInChatMatchIdx((prev) => (prev - 1 + inChatMatches.length) % inChatMatches.length);
  };
  const chatEndRef = useRef(null);
  const mediaLoadingRef = useRef(new Set());
  const picLoadingRef = useRef(new Set());

  // Funil semiautomático: biblioteca de snippets prontos + estado de envio humanizado
  const [snippets, setSnippets] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('sigma_quick_snippets') || '[]');
      if (Array.isArray(saved) && saved.length) {
        return saved.map((s) => ({
          kind: s.kind || (s.filePath ? 'audio' : 'text'),
          ...s,
        }));
      }
    } catch (e) {}
    // Preset inicial: mensagens prontas comuns para prospecção/comercial
    return [
      { id: 'snip_intro', kind: 'text', label: 'Apresentação inicial', text: 'Olá {{name}}, tudo bem? Aqui é da Sigma — vemos oportunidades de melhorar sua presença digital.' },
      { id: 'snip_followup', kind: 'text', label: 'Follow-up educado', text: 'Oi {{name}}, apenas retornando o contato. Posso te mandar um diagnóstico rápido do seu site?' },
      { id: 'snip_offer', kind: 'text', label: 'Oferta de diagnóstico', text: '{{name}}, fiz uma análise rápida do seu site e encontrei pontos de melhoria. Posso compartilhar?' },
      { id: 'snip_close', kind: 'text', label: 'Fechamento', text: 'Perfeito, {{name}}! Vou preparar a proposta. Alguma preferência de horário para conversarmos?' },
    ];
  });
  const [showTriggers, setShowTriggers] = useState(false);
  const [showTriggersModal, setShowTriggersModal] = useState(false);
  const [campaignConnectionId, setCampaignConnectionId] = useState('');
  /** Multi-select de números conectados na criação (1+). */
  const [campaignConnectionIds, setCampaignConnectionIds] = useState([]);
  /** Passo do wizard de nova campanha (0-based). */
  const [campaignWizardStep, setCampaignWizardStep] = useState(0);
  const [creatingCampaignBusy, setCreatingCampaignBusy] = useState(false);
  const [campaignFormError, setCampaignFormError] = useState('');
  const campaignNameInputRef = useRef(null);
  const triggerSnippets = snippets;
  const [savedMedia, setSavedMedia] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('sigma_saved_media') || '[]');
      if (Array.isArray(saved)) return saved;
    } catch (e) {}
    return [];
  });
  const [sendingHumanized, setSendingHumanized] = useState(false);
  /** Gravação de áudio (mensagem de voz) */
  const [isRecording, setIsRecording] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);
  const [sendingAudio, setSendingAudio] = useState(false);
  /** Overlay local (conversa aberta) digitando/gravando: { mode, label, totalMs, leftMs } */
  const [humanizeProgress, setHumanizeProgress] = useState(null);
  /** Jobs de funil em paralelo (várias conversas, estilo ZapVoice) */
  const [funnelJobs, setFunnelJobs] = useState([]);
  const busyJidsRef = useRef(new Set());
  const mediaRecorderRef = useRef(null);
  const recordChunksRef = useRef([]);
  const recordStreamRef = useRef(null);
  const recordTimerRef = useRef(null);
  const recordingStartedAtRef = useRef(0);
  /** 'send' = envia na conversa | 'trigger' = salva como gatilho de áudio */
  const recordingPurposeRef = useRef('send');
  const triggerAudioLabelRef = useRef('');

  // Persistência leve das bibliotecas de funil
  useEffect(() => {
    try { localStorage.setItem('sigma_quick_snippets', JSON.stringify(snippets)); } catch (e) {}
  }, [snippets]);
  useEffect(() => {
    try { localStorage.setItem('sigma_saved_media', JSON.stringify(savedMedia)); } catch (e) {}
  }, [savedMedia]);

  // Load WhatsApp Settings
  const [settings, setSettings] = useState({
    notifications: { desktop: true, sound: true },
    media: {
      autoDownloadImages: true,
      autoDownloadAudio: true,
      autoDownloadVideos: false,
      autoDownloadDocuments: false,
      autoDownloadStickers: true,
    },
    previews: { links: true, pdf: true },
    campaigns: {
      dailyLimit: 10,
      unlockedLimits: [10],
      manualUnlimited: false,
      workingHoursEnabled: true,
      workingHoursStart: '07:00',
      workingHoursEnd: '18:00',
    },
  });
  const [dailyQuota, setDailyQuota] = useState({ date: null, byConnection: {} });
  const [limitTiers] = useState([10, 30, 60, 100]);
  const [campaignSearch, setCampaignSearch] = useState('');
  const [campaignSort, setCampaignSort] = useState('newest'); // newest | oldest | name
  const [campaignStatusFilter, setCampaignStatusFilter] = useState('all'); // all | draft | active | done

  const loadLabels = async () => {
    if (!window.chatAPI?.getLabels) return;
    try {
      const res = await window.chatAPI.getLabels();
      if (res?.success !== false) {
        setLabelCatalog(Array.isArray(res.catalog) ? res.catalog : []);
        setLabelsByJid(res.byJid && typeof res.byJid === 'object' ? res.byJid : {});
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Load Connections, Campaigns, Chats
  const loadConnections = async () => {
    if (!window.whatsappAPI) return;
    try {
      const res = await window.whatsappAPI.listConnections();
      if (res && res.connections) {
        setConnections(res.connections);
        const active = res.connections.find(c => c.active);
        if (active) {
          setActiveConnectionId(active.id);
          window.activeWaConnectionId = active.id;
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadCampaigns = async () => {
    if (!window.campaignAPI) return;
    try {
      const res = await window.campaignAPI.getAll();
      if (res && res.campaigns) {
        setCampaigns(res.campaigns);
        setKanbanCampaign((current) => current
          ? (res.campaigns.find((campaign) => campaign.id === current.id) || null)
          : null);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const checkMissedSchedules = async () => {
    if (!window.campaignAPI?.recoveryList) return;
    try {
      const res = await window.campaignAPI.recoveryList();
      if (res?.success && Array.isArray(res.missed) && res.missed.length) {
        setRecoveryMissed(res.missed);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleRecoveryResolve = async (id, choice) => {
    if (!window.campaignAPI?.recoveryResolve) return;
    setRecoveryBusyId(id);
    try {
      const connId =
        activeConnectionId ||
        campaignConnectionId ||
        connectedSessions[0]?.id ||
        null;
      const res = await window.campaignAPI.recoveryResolve(id, choice, connId);
      if (res && res.success === false) {
        alert('Não foi possível: ' + (res.error || 'erro desconhecido'));
        return;
      }
      setRecoveryMissed((list) => (list || []).filter((m) => m.id !== id));
      loadCampaigns();
      addLog(choice === 'now'
        ? '[CAMPAIGN] Horário perdido: disparo iniciado agora.'
        : '[CAMPAIGN] Horário perdido: reagendada para amanhã.');
    } catch (e) {
      console.error(e);
      alert('Erro: ' + (e.message || e));
    } finally {
      setRecoveryBusyId(null);
    }
  };

  const loadChats = async () => {
    if (!window.chatAPI) return;
    try {
      const res = await window.chatAPI.getChats(activeConnectionId);
      // main.js retorna { chats: [...] }; desembrulhar para manter array em estado
      const list = Array.isArray(res?.chats) ? res.chats : Array.isArray(res) ? res : [];
      setChats(list);
      setProfilePics((prev) => {
        const next = { ...prev };
        for (const c of list) {
          if (c.jid && c.profilePic && !next[c.jid]) next[c.jid] = c.profilePic;
        }
        return next;
      });
    } catch (e) {
      console.error(e);
    }
  };

  const loadArchivedChats = async () => {
    if (!window.chatAPI?.getArchivedChats) return;
    try {
      const res = await window.chatAPI.getArchivedChats(activeConnectionId);
      const list = Array.isArray(res?.chats) ? res.chats : Array.isArray(res) ? res : [];
      setArchivedChats(list);
      setProfilePics((prev) => {
        const next = { ...prev };
        for (const c of list) {
          if (c.jid && c.profilePic && !next[c.jid]) next[c.jid] = c.profilePic;
        }
        return next;
      });
    } catch (e) {
      console.error(e);
    }
  };

  // Carrega settings persistidas no backend (chatAPI.getSettings)
  const loadSettings = async () => {
    if (!window.chatAPI?.getSettings) return;
    try {
      const res = await window.chatAPI.getSettings();
      // Mescla defaults locais com o que voltar do backend
      setSettings((prev) => ({
        notifications: { ...prev.notifications, ...(res?.settings?.notifications || res?.notifications || {}) },
        media: { ...prev.media, ...(res?.settings?.media || res?.media || {}) },
        previews: { ...prev.previews, ...(res?.settings?.previews || res?.previews || {}) },
        campaigns: {
          ...prev.campaigns,
          ...(res?.settings?.campaigns || res?.campaigns || {}),
        },
      }));
      if (res?.dailyQuota) setDailyQuota(res.dailyQuota);
    } catch (e) {
      console.error(e);
    }
  };

  // Persiste um patch de settings no backend a cada mudança
  const updateSetting = async (patch) => {
    setSettings((prev) => {
      const next = {
        notifications: { ...prev.notifications, ...(patch.notifications || {}) },
        media: { ...prev.media, ...(patch.media || {}) },
        previews: { ...prev.previews, ...(patch.previews || {}) },
        campaigns: { ...prev.campaigns, ...(patch.campaigns || {}) },
      };
      if (window.chatAPI?.updateSettings) {
        window.chatAPI.updateSettings(patch).then((res) => {
          if (res?.settings?.campaigns) {
            setSettings((p) => ({ ...p, campaigns: { ...p.campaigns, ...res.settings.campaigns } }));
          }
          if (res?.dailyQuota) setDailyQuota(res.dailyQuota);
        }).catch(console.error);
      }
      return next;
    });
  };

  const ensureProfilePic = useCallback(async (jid) => {
    if (!jid || !window.chatAPI?.getProfilePic) return;
    if (profilePics[jid] || picLoadingRef.current.has(jid)) return;
    picLoadingRef.current.add(jid);
    try {
      const res = await window.chatAPI.getProfilePic(jid, activeConnectionId);
      if (res?.url) {
        setProfilePics((prev) => (prev[jid] ? prev : { ...prev, [jid]: res.url }));
      }
    } catch (e) {
      // silent — many contacts hide profile photo
    } finally {
      picLoadingRef.current.delete(jid);
    }
  }, [profilePics, activeConnectionId]);

  useEffect(() => {
    loadConnections();
    loadCampaigns();
    loadChats();
    loadSettings();
    loadLabels();
    checkMissedSchedules();
  }, []);

  // Reload chats when active connection changes
  useEffect(() => {
    if (activeConnectionId) {
      loadChats();
      if (chatFilter === 'archived') loadArchivedChats();
    }
  }, [activeConnectionId]);

  useEffect(() => {
    if (chatFilter === 'archived') loadArchivedChats();
  }, [chatFilter]);

  useEffect(() => {
    if (waTab === 'chats') {
      loadChats();
      if (chatFilter === 'archived') loadArchivedChats();
    }
  }, [waTab]);

  // Persiste snippets e biblioteca de mídia localmente
  useEffect(() => {
    try { localStorage.setItem('sigma_quick_snippets', JSON.stringify(snippets)); } catch (e) {}
  }, [snippets]);
  useEffect(() => {
    try { localStorage.setItem('sigma_saved_media', JSON.stringify(savedMedia)); } catch (e) {}
  }, [savedMedia]);

  // Listen to WA Connection QR code and status
  useEffect(() => {
    if (!window.whatsappAPI || typeof window.whatsappAPI.onStatus !== 'function') return;
    const off = window.whatsappAPI.onStatus((payload) => {
      const {
        status,
        data,
        aggregateStatus,
        anyConnected,
        connectionId: topConnId,
      } = payload || {};
      const connId = topConnId || data?.connectionId || null;

      // Status global (bolinha): sempre o agregado multi-sessão
      const nextGlobal =
        aggregateStatus ||
        data?.aggregateStatus ||
        (anyConnected || data?.anyConnected ? 'connected' : null) ||
        status ||
        'disconnected';
      setWaStatus(nextGlobal);

      // Lista de conexões: preferir snapshot do backend
      if (Array.isArray(data?.connections)) {
        setConnections(data.connections);
        const active =
          data.connections.find((c) => c.active) ||
          data.connections.find((c) => c.id === data.activeConnectionId);
        if (active) {
          setActiveConnectionId(active.id);
          window.activeWaConnectionId = active.id;
        }
      } else if (status === 'connected' || status === 'disconnected') {
        loadConnections();
      }

      // Fluxo de QR só reage à sessão que estamos pareando
      const pending = pendingConnectionIdRef.current;
      const isPending =
        !pending || !connId || pending === connId;

      if (status === 'qr_ready' && data?.qrDataURL) {
        if (isPending) {
          setQrCodeUrl(data.qrDataURL);
          setConnectFlowStatus('qr_ready');
          if (connId) {
            pendingConnectionIdRef.current = connId;
            setPendingConnectionId(connId);
          }
        }
      } else if (status === 'connecting') {
        if (isPending) {
          setConnectFlowStatus((prev) => prev || 'connecting');
          if (connId && !pendingConnectionIdRef.current) {
            pendingConnectionIdRef.current = connId;
            setPendingConnectionId(connId);
          }
        }
      } else if (status === 'connected') {
        if (isPending) {
          setQrCodeUrl(null);
          setConnectFlowStatus(null);
          pendingConnectionIdRef.current = null;
          setPendingConnectionId(null);
        }
      } else if (status === 'disconnected' || status === 'error') {
        if (pending && connId && pending === connId) {
          setQrCodeUrl(null);
          setConnectFlowStatus(null);
          pendingConnectionIdRef.current = null;
          setPendingConnectionId(null);
        }
      }
    });
    return () => { if (typeof off === 'function') off(); };
  }, [setWaStatus]);

  // Listen to Campaign progress updates
  useEffect(() => {
    if (!window.campaignAPI || typeof window.campaignAPI.onProgress !== 'function') return;
    const off = window.campaignAPI.onProgress(({ campaignId, event, data }) => {
      loadCampaigns();
      if (event === 'daily-limit') {
        addLog('[CAMPAIGN] Limite diário atingido — progresso salvo. Retome manualmente quando houver nova cota.');
        loadSettings();
      } else if (event === 'waiting' && data?.reason === 'no_provider') {
        addLog('[CAMPAIGN] Aguardando WhatsApp conectado para continuar os disparos…');
      } else if (event === 'waiting' && data?.reason === 'outside_hours') {
        addLog('[CAMPAIGN] Fora do horário de disparo — campanha aguardando a janela configurada.');
      }
      if (monitoringCampaignId === campaignId) {
        // Refresh active monitoring campaign
        window.campaignAPI.get(campaignId).then((res) => {
          if (res && res.campaign) {
            setMonitoringCampaign(res.campaign);
          }
        });
      }
    });
    return () => off?.();
  }, [monitoringCampaignId, addLog]);

  // Listen to new WhatsApp messages
  useEffect(() => {
    if (!window.chatAPI) return;
    const cleanups = [];
    if (typeof window.chatAPI.onMessage === 'function') {
      const off = window.chatAPI.onMessage((data) => {
        loadChats();
        if (activeChatJid && data?.jid === activeChatJid) {
          setMessages((prev) => [...prev, data.message]);
        }
      });
      if (off) cleanups.push(off);
    }

    if (typeof window.chatAPI.onChatUpdate === 'function') {
      const off = window.chatAPI.onChatUpdate(() => {
        loadChats();
      });
      if (off) cleanups.push(off);
    }

    return () => cleanups.forEach((off) => off && off());
  }, [activeChatJid]);

  // Scroll chats to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // WhatsApp Connect Action
  const handleConnect = async () => {
    if (!window.whatsappAPI) {
      setQrError('Integração do WhatsApp indisponível. Reinicie o app e tente novamente.');
      return;
    }
    try {
      setQrError('');
      setQrCodeUrl(null);
      setConnectFlowStatus('connecting');
      pendingConnectionIdRef.current = null;
      setPendingConnectionId(null);
      // Não força bolinha vermelha se já houver outra sessão online
      const hasOnline = (connections || []).some((c) => c.status === 'connected');
      if (!hasOnline) setWaStatus('connecting');
      addLog(`[WHATSAPP] Conectando via ${providerType}...`);
      const res = await window.whatsappAPI.connect(providerType, {});
      if (res?.connections) {
        setConnections(res.connections);
        const any = res.connections.some((c) => c.status === 'connected');
        setWaStatus(any ? 'connected' : 'disconnected');
      }
      if (res?.connectionId) {
        setActiveConnectionId(res.connectionId);
        window.activeWaConnectionId = res.connectionId;
      }
      if (res?.success) {
        setConnectFlowStatus(null);
        setQrCodeUrl(null);
        pendingConnectionIdRef.current = null;
        setPendingConnectionId(null);
        addLog(`[WHATSAPP] Conectado${res.phoneNumber ? ` (${res.phoneNumber})` : ''}.`);
      } else if (res && res.success === false) {
        setConnectFlowStatus(null);
        setQrCodeUrl(null);
        const stillOnline = (res.connections || connections || []).some(
          (c) => c.status === 'connected'
        );
        setWaStatus(stillOnline ? 'connected' : 'disconnected');
        setQrError(res.error || 'Não foi possível preparar o QR Code. Tente novamente.');
        addLog(`[WHATSAPP] Falha ao conectar: ${res.error || 'erro desconhecido'}`);
      }
    } catch (e) {
      setConnectFlowStatus(null);
      setQrCodeUrl(null);
      setQrError(e?.message || 'Não foi possível preparar o QR Code. Tente novamente.');
      addLog(`[WHATSAPP] Erro ao conectar: ${e.message}`);
    }
  };

  const handleDisconnect = async () => {
    if (!window.whatsappAPI) return;
    if (confirm("Desconectar do WhatsApp?")) {
      try {
        const res = await window.whatsappAPI.disconnect(activeConnectionId || undefined);
        setQrCodeUrl(null);
        setConnectFlowStatus(null);
        pendingConnectionIdRef.current = null;
        setPendingConnectionId(null);
        const list = res?.connections || [];
        setConnections(list);
        const any = list.some((c) => c.status === 'connected');
        setWaStatus(any ? 'connected' : 'disconnected');
        if (res?.activeConnectionId) {
          setActiveConnectionId(res.activeConnectionId);
          window.activeWaConnectionId = res.activeConnectionId;
        } else {
          setActiveConnectionId(null);
          window.activeWaConnectionId = null;
        }
        addLog(`[WHATSAPP] Desconectado.`);
      } catch (e) {
        console.error(e);
      }
    }
  };

  const openQrModal = () => {
    setQrError('');
    setIsQrModalOpen(true);
    setIsAcctMenuOpen(false);
    setIsConnMenuOpen(false);
    handleConnect();
  };

  const saveSessionProfile = () => {
    const next = {
      name: String(sessionProfile.name || '').trim() || 'Sigma Comercial',
      about: String(sessionProfile.about || '').trim(),
      phone: String(sessionProfile.phone || '').trim(),
    };
    setSessionProfile(next);
    try { localStorage.setItem('sigma_wa_profile', JSON.stringify(next)); } catch (_) {}
    setIsSessionProfileOpen(false);
    addLog('[WHATSAPP] Perfil da sessão atualizado.');
  };

  const handleRemoveConnection = async (id) => {
    if (!window.whatsappAPI) return;
    if (confirm("Remover conexão permanentemente?")) {
      try {
        const res = await window.whatsappAPI.removeConnection(id);
        if (pendingConnectionIdRef.current === id) {
          setQrCodeUrl(null);
          setConnectFlowStatus(null);
          pendingConnectionIdRef.current = null;
          setPendingConnectionId(null);
        }
        const list = res?.connections || [];
        setConnections(list);
        const any = list.some((c) => c.status === 'connected');
        setWaStatus(any ? 'connected' : 'disconnected');
        if (res?.activeConnectionId) {
          setActiveConnectionId(res.activeConnectionId);
          window.activeWaConnectionId = res.activeConnectionId;
        } else if (activeConnectionId === id) {
          setActiveConnectionId(null);
          window.activeWaConnectionId = null;
        }
        addLog(`[WHATSAPP] Conexão removida.`);
      } catch (e) {
        console.error(e);
      }
    }
  };

  const handleSwitchConnection = async (id) => {
    if (!window.whatsappAPI) return;
    try {
      const res = await window.whatsappAPI.switchConnection(id);
      setActiveConnectionId(id);
      window.activeWaConnectionId = id;
      if (res?.connections) {
        setConnections(res.connections);
        const any = res.connections.some((c) => c.status === 'connected');
        setWaStatus(any ? 'connected' : 'disconnected');
      } else {
        loadConnections();
      }
      addLog(`[WHATSAPP] Alternado para a conexão ${id}.`);
    } catch (e) {
      console.error(e);
    }
  };

  const handleForceResync = async () => {
    if (!window.whatsappAPI) return;
    try {
      const res = await window.whatsappAPI.forceResync(activeConnectionId || undefined);
      if (res?.success) {
        // Reseta só o fluxo de pairing; outras sessões podem continuar online
        setQrCodeUrl(null);
        setConnectFlowStatus(null);
        pendingConnectionIdRef.current = null;
        setPendingConnectionId(null);
        setChats([]);
        await loadConnections();
        try {
          const st = await window.whatsappAPI.getStatus();
          setWaStatus(st?.status || 'disconnected');
          if (st?.activeConnectionId) {
            setActiveConnectionId(st.activeConnectionId);
            window.activeWaConnectionId = st.activeConnectionId;
          }
        } catch (_) {
          /* ignore */
        }
        addLog(`[WHATSAPP] Ressincronização forçada iniciada.`);
      } else {
        addLog(`[WHATSAPP] Falha na ressincronização: ${res?.error || 'erro desconhecido'}`);
      }
    } catch (e) {
      console.error(e);
      addLog(`[WHATSAPP] Erro ao ressincronizar: ${e.message}`);
    }
  };

  /** JID correto para enviar (evita usar dígitos de @lid como se fossem telefone). */
  const getSendJid = () => activeChatMeta?.sendJid || activeChatMeta?.phoneJid || activeChatJid;

  const getChatPhone = (chat) => String(chat?.phone || chat?.phoneNumber || chat?.jid || '').replace(/\D/g, '');
  const findKanbanCardForChat = (chat, board) => {
    const phone = getChatPhone(chat);
    const name = String(chat?.name || '').trim().toLocaleLowerCase('pt-BR');
    return (board?.cards || []).find((card) => {
      const profile = card?.entity?.profile || {};
      const cardPhone = String(profile.phone || profile.whatsapp || '').replace(/\D/g, '');
      const cardName = String(profile.name || '').trim().toLocaleLowerCase('pt-BR');
      return (phone && cardPhone && (cardPhone === phone || cardPhone.endsWith(phone) || phone.endsWith(cardPhone)))
        || (name && cardName && name === cardName);
    }) || null;
  };

  const openChatContextMenu = async (event, chat) => {
    event.preventDefault();
    event.stopPropagation();
    setChatContextMenu({ chat, x: event.clientX, y: event.clientY, loading: true });
    try {
      const result = await window.kanbanAPI?.getBoard?.();
      const board = result?.board || result;
      setChatContextMenu((current) => current?.chat === chat ? { ...current, loading: false } : current);
      setChatKanbanColumns(board?.board?.columns || []);
      setChatKanbanCard(findKanbanCardForChat(chat, board));
    } catch {
      setChatContextMenu((current) => current?.chat === chat ? { ...current, loading: false } : current);
      setChatKanbanColumns([]);
      setChatKanbanCard(null);
    }
  };

  const openChatReminder = () => {
    const target = chatContextMenu?.chat || null;
    let standalone = null;
    try {
      const reminders = JSON.parse(localStorage.getItem('sigma_whatsapp_reminders') || '[]');
      const key = getChatPhone(target) || target?.jid || '';
      standalone = Array.isArray(reminders).find((item) => item.key === key || (item.jid && item.jid === target?.jid)) || null;
    } catch { /* histórico local indisponível não impede abrir o modal */ }
    setChatReminderDraft({
      at: chatKanbanCard?.reminderAt
        ? new Date(Number(chatKanbanCard.reminderAt)).toISOString().slice(0, 16)
        : standalone?.reminderAt ? new Date(Number(standalone.reminderAt)).toISOString().slice(0, 16) : '',
      note: chatKanbanCard?.reminderNote || standalone?.note || '',
    });
    setChatReminderTarget(target);
    setChatContextMenu(null);
  };

  const saveChatReminder = async () => {
    setChatKanbanBusy(true);
    try {
      if (chatKanbanCard && window.kanbanAPI?.recordDeal) {
        const response = await window.kanbanAPI.recordDeal({
          entityKey: chatKanbanCard.entityKey,
          outcome: chatKanbanCard.dealStatus || 'open',
          value: chatKanbanCard.dealValue || 0,
          note: chatKanbanCard.dealNote || '',
          reminderAt: chatReminderDraft.at,
          reminderNote: chatReminderDraft.note,
        });
        if (response?.success === false) throw new Error(response.error || 'Não foi possível salvar o lembrete.');
        window.dispatchEvent(new CustomEvent('sigma:deal-updated', { detail: { board: response.board } }));
      } else {
        const key = getChatPhone(chatReminderTarget) || chatReminderTarget?.jid || '';
        if (!key) throw new Error('Não foi possível identificar este contato.');
        const reminders = (() => { try { const raw = JSON.parse(localStorage.getItem('sigma_whatsapp_reminders') || '[]'); return Array.isArray(raw) ? raw : []; } catch { return []; } })();
        const next = reminders.filter((item) => item.key !== key && item.jid !== chatReminderTarget?.jid);
        if (chatReminderDraft.at) {
          next.push({
            id: `wa-reminder-${key}`,
            key,
            jid: chatReminderTarget?.jid || '',
            phone: getChatPhone(chatReminderTarget),
            name: chatReminderTarget?.name || chatReminderTarget?.phone || key,
            reminderAt: Date.parse(chatReminderDraft.at) || 0,
            note: String(chatReminderDraft.note || '').slice(0, 200),
            createdAt: Date.now(),
          });
        }
        localStorage.setItem('sigma_whatsapp_reminders', JSON.stringify(next));
        window.dispatchEvent(new Event('sigma:reminders-updated'));
      }
      setChatReminderTarget(null);
      addLog?.(chatKanbanCard ? '[KANBAN] Lembrete atualizado pelo WhatsApp.' : '[WHATSAPP] Lembrete salvo para o contato.');
    } catch (error) {
      alert(error?.message || 'Não foi possível salvar o lembrete.');
    } finally {
      setChatKanbanBusy(false);
    }
  };

  const changeChatKanbanStage = async (event) => {
    const toColumnId = event.target.value;
    const target = chatKanbanColumns.find((column) => column.id === toColumnId);
    if (!chatKanbanCard || !target || !window.kanbanAPI) return;
    if (target.dealOutcome === 'won') {
      setChatKanbanValue(chatKanbanCard.dealValue ? String(chatKanbanCard.dealValue) : '');
      setChatContextMenu((current) => current ? { ...current, awaitingValue: true } : current);
      return;
    }
    setChatKanbanBusy(true);
    try {
      const response = target.dealOutcome === 'lost'
        ? await window.kanbanAPI.recordDeal({ entityKey: chatKanbanCard.entityKey, outcome: 'lost', value: chatKanbanCard.dealValue || 0, note: chatKanbanCard.dealNote || '' })
        : await window.kanbanAPI.moveCard({ entityKey: chatKanbanCard.entityKey, toColumnId, expectedRevision: chatKanbanCard.revision, manual: true });
      if (response?.success === false) throw new Error(response.error || 'Não foi possível mudar a etapa.');
      window.dispatchEvent(new CustomEvent('sigma:deal-updated', { detail: { board: response.board } }));
      setChatContextMenu(null);
      addLog?.(`[KANBAN] Conversa movida para ${target.name}.`);
    } catch (error) {
      alert(error?.message || 'Não foi possível mudar a etapa.');
    } finally {
      setChatKanbanBusy(false);
    }
  };

  const saveChatWonStage = async () => {
    if (!chatKanbanCard || !window.kanbanAPI?.recordDeal) return;
    const value = Number(String(chatKanbanValue).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '')) || 0;
    if (value <= 0) return;
    setChatKanbanBusy(true);
    try {
      const response = await window.kanbanAPI.recordDeal({ entityKey: chatKanbanCard.entityKey, outcome: 'won', value, note: chatKanbanCard.dealNote || '' });
      if (response?.success === false) throw new Error(response.error || 'Não foi possível registrar o negócio.');
      window.dispatchEvent(new CustomEvent('sigma:deal-updated', { detail: { board: response.board } }));
      setChatContextMenu(null);
      addLog?.(`[KANBAN] Venda registrada para ${chatContextMenu?.chat?.name || 'a conversa'}.`);
    } catch (error) {
      alert(error?.message || 'Não foi possível registrar o negócio.');
    } finally {
      setChatKanbanBusy(false);
    }
  };

  // Chat Actions
  const handleSelectChat = async (chat) => {
    if (!window.chatAPI) return;
    // Preferir phoneJid (número real) quando o chat vem como @lid — evita erro de envio de áudio/mídia
    const sendJid = chat.phoneJid || chat.phone
      ? (chat.phoneJid || (String(chat.phone).includes('@') ? chat.phone : `${String(chat.phone).replace(/\D/g, '')}@s.whatsapp.net`))
      : chat.jid;
    // Mantém o jid da conversa para carregar mensagens (pode ser @lid)
    const historyJid = chat.jid || sendJid;
    setActiveChatJid(historyJid);
    setActiveChatName(chat.name || chat.phone || String(historyJid).split('@')[0]);
    setActiveChatMeta({
      isGroup: !!chat.isGroup,
      phone: chat.phone || null,
      jid: historyJid,
      phoneJid: chat.phoneJid || null,
      // JID preferido para envio (texto, áudio, mídia)
      sendJid: sendJid || historyJid,
    });
    setChatPresence(null);
    setMessages([]);
    setReplyTo(null);
    setMsgMenuId(null);
    setProfileOpen(false);
    setTagPickerOpen(false);
    ensureProfilePic(historyJid);
    try {
      await window.chatAPI.markRead(historyJid, activeConnectionId);
      loadChats();
      const res = await window.chatAPI.loadMessages(historyJid, 80, activeConnectionId);
      if (res && res.messages) {
        setMessages(res.messages);
      } else {
        setMessages([]);
      }
      // Best-effort contact/business info for status line
      try {
        const info = await window.chatAPI.getContactInfo?.(historyJid, activeConnectionId);
        if (info && typeof info === 'object') {
          if (info.name && info.name !== activeChatName) setActiveChatName(info.name);
          const statusText =
            info.business?.description ||
            info.business?.category ||
            info.verifiedName ||
            (chat.isGroup ? 'Grupo' : info.phone || chat.phone || null);
          setChatPresence({
            online: false,
            lastSeen: null,
            statusText: statusText || null,
            business: info.business || null,
          });
        }
      } catch (e) {}
      if (chat.isGroup) {
        try {
          const meta = await window.chatAPI.getGroupMetadata?.(historyJid, activeConnectionId);
          if (meta?.subject) setActiveChatName(meta.subject);
          if (meta?.participants?.length) {
            setChatPresence((prev) => ({
              ...(prev || {}),
              statusText: `${meta.participants.length} participantes`,
            }));
          }
        } catch (e) {}
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || !activeChatJid || !window.chatAPI) return;
    const msgText = inputText;
    const toJid = getSendJid();
    const quoted = replyTo || null;
    setInputText('');
    setReplyTo(null);
    try {
      await window.chatAPI.chatAction(toJid, "typing", activeConnectionId);
      const payload = quoted
        ? { text: msgText, quoted }
        : { text: msgText };
      const res = await window.chatAPI.sendMessage(toJid, payload, activeConnectionId);
      await window.chatAPI.chatAction(toJid, "paused", activeConnectionId);

      if (res && res.success && res.messageId) {
        loadChats();
        if (window.chatAPI.getMessages) {
          const msgRes = await window.chatAPI.getMessages(activeChatJid, activeConnectionId);
          if (msgRes?.messages) setMessages(msgRes.messages);
          else {
            setMessages((prev) => [...prev, {
              key: { fromMe: true, id: res.messageId, remoteJid: res.jid || activeChatJid },
              message: { conversation: msgText },
              messageTimestamp: Math.round(Date.now() / 1000),
            }]);
          }
        }
      } else {
        addLog(`[WHATSAPP] Falha ao enviar: ${res?.error || 'sem confirmação do WhatsApp'}`);
        alert('Não enviou: ' + (res?.error || 'WhatsApp não confirmou o envio'));
        setInputText(msgText);
        if (quoted) setReplyTo(quoted);
      }
    } catch (e) {
      console.error(e);
      addLog(`[WHATSAPP] Erro ao enviar: ${e.message}`);
      setInputText(msgText);
      if (quoted) setReplyTo(quoted);
    }
  };

  const handleDeleteMessage = async (m, forEveryone) => {
    if (!m?.key?.id || !window.chatAPI?.deleteMessage) return;
    setMsgMenuId(null);
    const label = forEveryone ? 'para todos' : 'só para mim';
    if (!confirm(`Apagar esta mensagem ${label}?`)) return;
    try {
      const res = await window.chatAPI.deleteMessage(
        activeChatJid,
        m.key,
        activeConnectionId,
        forEveryone,
      );
      if (res?.success) {
        setMessages((prev) => prev.filter((x) => x.key?.id !== m.key.id));
        loadChats();
        addLog(`[WHATSAPP] Mensagem apagada (${label}).`);
      } else {
        // se "para todos" falhar, tenta só local
        if (forEveryone) {
          const local = await window.chatAPI.deleteMessage(
            activeChatJid,
            m.key,
            activeConnectionId,
            false,
          );
          if (local?.success) {
            setMessages((prev) => prev.filter((x) => x.key?.id !== m.key.id));
            addLog('[WHATSAPP] Não deu para apagar para todos; removida só no Sigma.');
            return;
          }
        }
        alert(res?.error || 'Não foi possível apagar');
      }
    } catch (e) {
      alert(e.message || 'Erro ao apagar');
    }
  };

  const openContactProfile = async () => {
    if (!activeChatJid) return;
    setProfileOpen(true);
    setProfileInfo(null);
    try {
      const info = await window.chatAPI.getContactInfo?.(activeChatJid, activeConnectionId);
      setProfileInfo(info || { jid: activeChatJid, name: activeChatName });
      ensureProfilePic(activeChatJid);
    } catch {
      setProfileInfo({ jid: activeChatJid, name: activeChatName });
    }
  };

  /** Chaves possíveis de um contato (jid / sendJid / phoneJid) — etiquetas são por pessoa */
  const contactLabelKeys = useCallback((jid) => {
    if (!jid) return [];
    const keys = new Set([String(jid)]);
    const chat = [...chats, ...archivedChats].find(
      (c) => c.jid === jid || c.phoneJid === jid || c.sendJid === jid,
    );
    if (chat?.jid) keys.add(chat.jid);
    if (chat?.phoneJid) keys.add(chat.phoneJid);
    if (chat?.sendJid) keys.add(chat.sendJid);
    if (activeChatJid === jid || activeChatMeta?.sendJid === jid || activeChatMeta?.phoneJid === jid) {
      if (activeChatJid) keys.add(activeChatJid);
      if (activeChatMeta?.sendJid) keys.add(activeChatMeta.sendJid);
      if (activeChatMeta?.phoneJid) keys.add(activeChatMeta.phoneJid);
    }
    return [...keys];
  }, [chats, archivedChats, activeChatJid, activeChatMeta]);

  /** JID canônico para gravar etiqueta (sempre o mesmo por pessoa) */
  const contactLabelStorageKey = useCallback((jid) => {
    const keys = contactLabelKeys(jid);
    const chat = [...chats, ...archivedChats].find(
      (c) => c.jid === jid || c.phoneJid === jid || c.sendJid === jid,
    );
    return chat?.sendJid || chat?.phoneJid || activeChatMeta?.sendJid || activeChatMeta?.phoneJid || keys[0] || jid;
  }, [contactLabelKeys, chats, archivedChats, activeChatMeta]);

  const contactTagIds = useCallback((jid) => {
    if (!jid) return [];
    for (const k of contactLabelKeys(jid)) {
      if (Array.isArray(labelsByJid[k]) && labelsByJid[k].length) return labelsByJid[k];
    }
    // chave vazia ainda conta (contato sem tags)
    for (const k of contactLabelKeys(jid)) {
      if (Array.isArray(labelsByJid[k])) return labelsByJid[k];
    }
    return [];
  }, [contactLabelKeys, labelsByJid]);

  /** Liga/desliga etiqueta SÓ neste contato (nunca em massa) */
  const toggleContactTag = async (tagId, targetJid) => {
    const raw = targetJid || activeChatMeta?.sendJid || activeChatJid;
    if (!raw || !window.chatAPI?.setContactLabels) return;
    const jid = contactLabelStorageKey(raw);
    const current = new Set(contactTagIds(raw));
    if (current.has(tagId)) current.delete(tagId);
    else current.add(tagId);
    const next = [...current];
    const res = await window.chatAPI.setContactLabels(jid, next);
    if (res?.success) {
      setLabelsByJid(res.byJid || { ...labelsByJid, [jid]: next });
      if (res.catalog) setLabelCatalog(res.catalog);
      addLog?.(`[WHATSAPP] Etiqueta ${current.has(tagId) ? 'adicionada' : 'removida'} em ${jid.split('@')[0]}`);
    }
  };

  /** Cria etiqueta e aplica só no contato aberto */
  const addNewTag = async () => {
    const name = newTagName.trim();
    if (!name || !window.chatAPI?.saveLabelCatalog) return;
    const raw = activeChatMeta?.sendJid || activeChatJid;
    if (!raw) {
      alert('Abra um contato para etiquetar individualmente.');
      return;
    }
    const colors = ['#6c5ce7', '#00b894', '#e17055', '#fdcb6e', '#74b9ff', '#a29bfe', '#fd79a8'];
    const existing = labelCatalog.find(
      (t) => String(t.name).toLowerCase() === name.toLowerCase(),
    );
    let tag = existing;
    if (!tag) {
      tag = {
        id: `tag_${Date.now().toString(36)}`,
        name: name.slice(0, 24),
        color: colors[labelCatalog.length % colors.length],
      };
      const catalog = [...labelCatalog, tag].slice(0, 40);
      const res = await window.chatAPI.saveLabelCatalog(catalog);
      if (!res?.success) return;
      setLabelCatalog(res.catalog || catalog);
    }
    setNewTagName('');
    const jid = contactLabelStorageKey(raw);
    const nextIds = [...new Set([...contactTagIds(raw), tag.id])];
    const setRes = await window.chatAPI.setContactLabels?.(jid, nextIds);
    if (setRes?.success) {
      setLabelsByJid(setRes.byJid || { ...labelsByJid, [jid]: nextIds });
    } else {
      setLabelsByJid((prev) => ({ ...prev, [jid]: nextIds }));
    }
    addLog?.(`[WHATSAPP] Etiqueta “${tag.name}” só em ${jid.split('@')[0]}`);
  };

  /** Converte base64 da mídia em blob URL (melhor suporte a áudio no Chromium). */
  const mediaBase64ToUrls = (base64, mimetype) => {
    const rawMime = String(mimetype || 'application/octet-stream');
    // HTMLAudioElement toca ogg/opus melhor como audio/ogg
    const playMime = /ogg|opus/i.test(rawMime)
      ? 'audio/ogg'
      : rawMime.split(';')[0] || rawMime;
    try {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: playMime });
      const blobUrl = URL.createObjectURL(blob);
      return {
        blobUrl,
        dataUrl: `data:${playMime};base64,${base64}`,
        playMime,
      };
    } catch (e) {
      return {
        blobUrl: null,
        dataUrl: `data:${playMime};base64,${base64}`,
        playMime,
      };
    }
  };

  // Download media into the in-memory cache for inline preview.
  // Returns the cache entry or null.
  const loadMessageMedia = useCallback(async (m, { openAfter = false } = {}) => {
    if (!window.chatAPI || !activeChatJid) return null;
    const msgId = m?.key?.id;
    if (!msgId) return null;
    if (mediaLoadingRef.current.has(msgId)) return mediaCache[msgId] || null;

    const existing = mediaCache[msgId];
    if (existing?.status === 'ready' && (existing.blobUrl || existing.dataUrl)) {
      if (openAfter && existing.filePath && window.chatAPI.openMedia) {
        await window.chatAPI.openMedia(existing.filePath);
      }
      return existing;
    }

    mediaLoadingRef.current.add(msgId);
    setMediaCache((prev) => ({
      ...prev,
      [msgId]: { ...(prev[msgId] || {}), status: 'loading', error: null },
    }));
    try {
      const res = await window.chatAPI.downloadMedia(activeChatJid, msgId, activeConnectionId);
      if (!res?.success || !res.data) {
        const err = res?.error || 'erro desconhecido';
        setMediaCache((prev) => ({
          ...prev,
          [msgId]: { status: 'error', error: err },
        }));
        addLog(`[WHATSAPP] Falha ao carregar mídia: ${err}`);
        return null;
      }
      const mime = res.mimetype || 'application/octet-stream';
      const urls = mediaBase64ToUrls(res.data, mime);
      const entry = {
        status: 'ready',
        dataUrl: urls.dataUrl,
        blobUrl: urls.blobUrl,
        mimetype: urls.playMime || mime,
        filePath: res.filePath || null,
        fileName: res.fileName || null,
        kind: res.kind || null,
        error: null,
      };
      setMediaCache((prev) => {
        // Revoga blob antigo se re-baixar
        try {
          if (prev[msgId]?.blobUrl) URL.revokeObjectURL(prev[msgId].blobUrl);
        } catch { /* ignore */ }
        return { ...prev, [msgId]: entry };
      });
      if (openAfter && res.filePath && window.chatAPI.openMedia) {
        await window.chatAPI.openMedia(res.filePath);
      } else if (openAfter && urls.blobUrl) {
        const a = document.createElement('a');
        a.href = urls.blobUrl;
        a.download = res.fileName || `midia_${msgId}.${(mime.split('/')[1] || 'bin').split(';')[0]}`;
        a.click();
      }
      return entry;
    } catch (e) {
      console.error(e);
      setMediaCache((prev) => ({
        ...prev,
        [msgId]: { status: 'error', error: e.message },
      }));
      return null;
    } finally {
      mediaLoadingRef.current.delete(msgId);
    }
  }, [activeChatJid, activeConnectionId, mediaCache, addLog]);

  // Download / open media (image/audio/document) via main process.
  const handleDownloadMedia = async (m) => {
    const entry = await loadMessageMedia(m, { openAfter: true });
    if (!entry) {
      addLog(`[WHATSAPP] Falha ao baixar mídia`);
    }
  };

  const ensureLinkPreview = useCallback(async (url) => {
    if (!url || !window.chatAPI?.getLinkPreview) return;
    if (linkPreviews[url] || linkPreviews[url]?.status === 'loading') return;
    if (settings?.previews?.links === false) return;
    setLinkPreviews((prev) => ({ ...prev, [url]: { status: 'loading' } }));
    try {
      const res = await window.chatAPI.getLinkPreview(url);
      if (res?.success) {
        setLinkPreviews((prev) => ({
          ...prev,
          [url]: {
            status: 'ready',
            title: res.title || url,
            description: res.description || '',
            image: res.image || '',
            siteName: res.siteName || '',
            url: res.url || url,
          },
        }));
      } else {
        setLinkPreviews((prev) => ({ ...prev, [url]: { status: 'error' } }));
      }
    } catch (e) {
      setLinkPreviews((prev) => ({ ...prev, [url]: { status: 'error' } }));
    }
  }, [linkPreviews, settings?.previews?.links]);

  // ─── Funis semiautomáticos ─────────────────────────────────────────────
  // Biblioteca de mensagens prontas (state `snippets`, persistida em
  // localStorage). O envio aplica um indicador de "digitando..." temporizado
  // (proporcional ao tamanho do texto) antes de entregar a mensagem — sem
  // simular áudio ao vivo (essa parte foi excluída por design, conforme
  // alinhado na fase de planejamento).

  // Estimates a natural "typing" duration for a given text (capped).
  // ~50ms por caractere + floor 1.2s, teto ~6s. Sem ruído artificial.
  const naturalTypingMs = (text) => {
    if (!text) return 0;
    return Math.min(6000, Math.max(1200, text.length * 50));
  };

  /** Delay do gatilho: delaySec (config) ou automático (texto/áudio). */
  const resolveTriggerDelayMs = (snippet, text) => {
    if (snippet?.delaySec != null && snippet.delaySec !== '') {
      const sec = Number(snippet.delaySec);
      if (Number.isFinite(sec)) return Math.max(0, Math.min(90, sec)) * 1000;
    }
    if (snippet?.kind === 'audio' || snippet?.filePath) {
      const d = Number(snippet.durationSec) || 3;
      return Math.min(45000, Math.max(1500, d * 1000));
    }
    return naturalTypingMs(text);
  };

  const patchFunnelJob = (jobId, patch) => {
    if (!jobId) return;
    setFunnelJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, ...patch } : j)));
  };

  /**
   * Mostra timer + presença (digitando/gravando) pelo tempo configurado.
   * Renova a presença a cada ~2.5s (WhatsApp some se parar).
   * jobId: atualiza painel multi-conversa; sem jobId atualiza barra da conversa aberta.
   */
  const runHumanizedPresence = async (toJid, mode, totalMs, jobId = null, connectionId = null) => {
    const ms = Math.max(0, totalMs || 0);
    const presence = mode === 'audio' ? 'recording' : 'typing';
    const label = mode === 'audio' ? 'Gravando áudio' : 'Digitando';
    const conn = connectionId || activeConnectionId;
    // Dispara presença imediatamente (e de novo em loop)
    await window.chatAPI?.chatAction?.(toJid, presence, conn).catch(() => {});
    if (ms <= 0) return;

    if (jobId) {
      patchFunnelJob(jobId, { mode, label, totalMs: ms, leftMs: ms, status: 'running' });
    } else {
      setHumanizeProgress({ mode, label, totalMs: ms, leftMs: ms });
    }

    const start = Date.now();
    let lastPresence = Date.now();
    while (Date.now() - start < ms) {
      const elapsed = Date.now() - start;
      const left = Math.max(0, ms - elapsed);
      if (jobId) patchFunnelJob(jobId, { leftMs: left });
      else setHumanizeProgress({ mode, label, totalMs: ms, leftMs: left });
      // Renova presença com frequência maior (WA some em poucos segundos)
      if (Date.now() - lastPresence > 2200) {
        await window.chatAPI?.chatAction?.(toJid, presence, conn).catch(() => {});
        lastPresence = Date.now();
      }
      await new Promise((r) => setTimeout(r, Math.min(180, left || 180)));
    }
    if (!jobId) setHumanizeProgress(null);
  };

  // Resolve {{name}}, {{agency}} etc. against the active chat / context.
  const resolveTemplate = (raw) => {
    if (!raw) return '';
    const name = (activeChatName || '').split(' ')[0] || 'amigo';
    return raw
      .replace(/\{\{name\}\}/gi, name)
      .replace(/\{\{agency\}\}/gi, settings?.commercial?.agencyName || 'nossa agência')
      .replace(/\{\{phone\}\}/gi, activeChatJid?.split('@')[0] || '');
  };

  const normalizeOpenFileResult = (res) => {
    if (!res || res.canceled) return null;
    const filePath = res.path || res.filePath;
    if (!filePath) return null;
    return {
      path: filePath,
      name: res.name || filePath.split(/[\\/]/).pop(),
    };
  };

  /**
   * Envia gatilho na conversa aberta (ou target).
   * Várias conversas em paralelo (estilo ZapVoice) — só bloqueia a MESMA conversa.
   */
  const handleSendTrigger = async (snippet, target = null) => {
    if (!window.chatAPI) return;
    const toJid = target?.jid || getSendJid();
    const chatName = target?.name || activeChatName || String(toJid || '').split('@')[0];
    const historyJid = target?.historyJid || activeChatJid || toJid;
    const conn = target?.connectionId || activeConnectionId;

    if (!toJid) {
      addLog('[WHATSAPP] Abra uma conversa para usar o gatilho.');
      return;
    }
    if (busyJidsRef.current.has(toJid) || busyJidsRef.current.has(historyJid)) {
      addLog(`[WHATSAPP] Já há um funil em andamento em “${chatName}”.`);
      return;
    }

    const isAudio = snippet?.kind === 'audio' || !!snippet?.filePath;
    if (isAudio && !snippet.filePath) {
      addLog('[WHATSAPP] Gatilho de áudio sem arquivo — recrie no gerenciador.');
      return;
    }
    const text = isAudio ? '' : resolveTemplate(snippet?.text);
    if (!isAudio && !text.trim()) {
      addLog('[WHATSAPP] Gatilho sem texto.');
      return;
    }

    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const wait = resolveTriggerDelayMs(snippet, text);
    const mode = isAudio ? 'audio' : 'text';
    const durationSec = Math.max(1, Number(snippet.durationSec) || 3);

    busyJidsRef.current.add(toJid);
    if (historyJid) busyJidsRef.current.add(historyJid);

    setFunnelJobs((prev) => [
      {
        id: jobId,
        jid: toJid,
        historyJid,
        name: chatName,
        snippetLabel: snippet.label || (isAudio ? 'Áudio' : 'Mensagem'),
        mode,
        label: mode === 'audio' ? 'Gravando áudio' : 'Digitando',
        totalMs: wait,
        leftMs: wait,
        status: 'running',
      },
      ...prev,
    ].slice(0, 20));

    // Só trava a UI local se for a conversa aberta
    const isActiveChat = !!(activeChatJid && (toJid === getSendJid() || historyJid === activeChatJid));
    if (isActiveChat) {
      setSendingHumanized(true);
      if (isAudio) setSendingAudio(true);
    }

    try {
      await runHumanizedPresence(toJid, mode, wait, jobId, conn);

      let res = null;
      if (isAudio) {
        if (window.chatAPI.sendTriggerAudio) {
          res = await window.chatAPI.sendTriggerAudio(toJid, snippet.filePath, conn);
        } else {
          res = await window.chatAPI.sendMedia(toJid, snippet.filePath, '', conn);
        }
      } else {
        res = await window.chatAPI.sendMessage(toJid, { text }, conn);
      }
      await window.chatAPI.chatAction(toJid, 'paused', conn).catch(() => {});

      if (res?.success) {
        patchFunnelJob(jobId, { status: 'done', leftMs: 0, label: 'Enviado' });
        // Atualiza mensagens se ainda estiver na mesma conversa
        if (isActiveChat || historyJid === activeChatJid) {
          try {
            const msgRes = await window.chatAPI.getMessages?.(historyJid || toJid, conn);
            if (msgRes?.messages) setMessages(msgRes.messages);
            else if (isAudio) {
              setMessages((prev) => [...prev, {
                key: { fromMe: true, id: res.messageId || `local_trig_aud_${Date.now()}` },
                message: { audioMessage: { mimetype: 'audio/ogg', ptt: true, seconds: durationSec } },
                messageTimestamp: Math.round(Date.now() / 1000),
              }]);
            } else {
              setMessages((prev) => [...prev, {
                key: { fromMe: true, id: res.messageId || `local_${Date.now()}` },
                message: { conversation: text },
                messageTimestamp: Math.round(Date.now() / 1000),
              }]);
            }
          } catch { /* ignore */ }
        }
        loadChats();
        addLog(`[WHATSAPP] Funil “${snippet.label}” → ${chatName} OK`);
      } else {
        patchFunnelJob(jobId, { status: 'error', label: res?.error || 'Falhou' });
        addLog(`[WHATSAPP] Funil falhou em ${chatName}: ${res?.error || 'erro'}`);
        if (isActiveChat) {
          alert(`Não foi possível enviar.\n${res?.error || 'erro'}`);
        }
      }
    } catch (e) {
      console.error(e);
      patchFunnelJob(jobId, { status: 'error', label: e.message || 'Erro' });
      addLog(`[WHATSAPP] Erro no funil: ${e.message}`);
    } finally {
      busyJidsRef.current.delete(toJid);
      busyJidsRef.current.delete(historyJid);
      if (isActiveChat) {
        setSendingHumanized(false);
        setSendingAudio(false);
        setHumanizeProgress(null);
      }
      setTimeout(() => {
        setFunnelJobs((prev) => prev.filter((j) => j.id !== jobId));
      }, 4000);
    }
  };

  const blobToBase64 = async (blob) => {
    const buffer = await blob.arrayBuffer();
    const u8 = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < u8.length; i += chunk) {
      binary += String.fromCharCode(...u8.subarray(i, i + chunk));
    }
    return btoa(binary);
  };

  // Open an OS file dialog and immediately send the chosen file into the active chat.
  const handleAttachMedia = async () => {
    if (!activeChatJid || !window.chatAPI?.openFile) return;
    try {
      const res = await window.chatAPI.openFile({
        filters: [
          { name: 'Mídia e arquivos', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'm4v', 'mov', 'avi', 'mkv', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'zip', 'rar', '7z', 'tar', 'gz', 'mp3', 'ogg', 'opus', 'wav', 'm4a', 'webm'] },
        ],
      });
      const file = normalizeOpenFileResult(res);
      if (!file) return;
      const fileName = file.name;
      const isAudio = /\.(mp3|ogg|opus|wav|m4a|webm)$/i.test(file.path);
      const toJid = getSendJid();
      await window.chatAPI.chatAction(toJid, isAudio ? 'recording' : 'typing', activeConnectionId);
      await new Promise((r) => setTimeout(r, 800));
      const sendRes = await window.chatAPI.sendMedia(toJid, file.path, '', activeConnectionId);
      await window.chatAPI.chatAction(toJid, 'paused', activeConnectionId);
      if (sendRes?.success) {
        setMessages((prev) => [...prev, {
          key: { fromMe: true, id: sendRes.messageId || `local_attach_${Date.now()}` },
          message: isAudio
            ? { audioMessage: { mimetype: 'audio/ogg', ptt: true } }
            : { conversation: `📎 ${fileName}` },
          messageTimestamp: Math.round(Date.now() / 1000),
        }]);
        loadChats();
        addLog(`[WHATSAPP] Arquivo "${fileName}" enviado.`);
      } else {
        addLog(`[WHATSAPP] Falha ao enviar arquivo: ${sendRes?.error || 'erro'}`);
      }
    } catch (e) {
      console.error(e);
      addLog(`[WHATSAPP] Erro ao anexar mídia: ${e.message}`);
    }
  };

  // Send a saved media file (image/audio/pdf) with caption + natural delay.
  const handleSendSavedMedia = async (entry) => {
    if (!activeChatJid || !entry?.filePath || !window.chatAPI) return;
    try {
      setShowTriggers(false);
      const isAudio = entry.kind === 'audio';
      const toJid = getSendJid();
      await window.chatAPI.chatAction(toJid, isAudio ? 'recording' : 'typing', activeConnectionId);
      await new Promise((r) => setTimeout(r, 1000));
      const res = await window.chatAPI.sendMedia(
        toJid,
        entry.filePath,
        entry.caption || '',
        activeConnectionId,
      );
      await window.chatAPI.chatAction(toJid, 'paused', activeConnectionId);
      if (res?.success) {
        setMessages((prev) => [...prev, {
          key: { fromMe: true, id: res.messageId || `local_media_${Date.now()}` },
          message: isAudio
            ? { audioMessage: { mimetype: 'audio/ogg', ptt: true } }
            : { conversation: entry.caption || '📄 Mídia enviada' },
          messageTimestamp: Math.round(Date.now() / 1000),
        }]);
        loadChats();
        addLog(`[WHATSAPP] Mídia "${entry.name}" enviada.`);
      } else {
        addLog(`[WHATSAPP] Falha ao enviar mídia: ${res?.error || 'erro'}`);
      }
    } catch (e) {
      console.error(e);
      addLog(`[WHATSAPP] Erro ao enviar mídia: ${e.message}`);
    }
  };

  // Add a media file to the saved library via OS file dialog.
  const handleAddSavedMedia = async () => {
    if (!window.chatAPI?.openFile) return;
    try {
      const res = await window.chatAPI.openFile({
        filters: [
          { name: 'Mídia e arquivos', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'zip', 'rar', '7z', 'tar', 'gz', 'mp3', 'ogg', 'opus', 'wav', 'm4a', 'webm', 'mp4', 'mov'] },
        ],
      });
      const file = normalizeOpenFileResult(res);
      if (!file) return;
      const entry = {
        id: `media_${Date.now()}`,
        name: file.name,
        filePath: file.path,
        kind: /\.(jpg|jpeg|png|webp|gif)$/i.test(file.path) ? 'image'
          : /\.(mp3|ogg|opus|wav|m4a)$/i.test(file.path) ? 'audio'
            : 'document',
        caption: '',
        createdAt: Date.now(),
      };
      setSavedMedia((prev) => [entry, ...prev].slice(0, 50));
      addLog(`[WHATSAPP] Mídia adicionada à biblioteca: ${entry.name}`);
    } catch (e) {
      console.error(e);
    }
  };

  const stopRecordingCleanup = () => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    try {
      recordStreamRef.current?.getTracks?.().forEach((t) => t.stop());
    } catch { /* ignore */ }
    recordStreamRef.current = null;
    mediaRecorderRef.current = null;
    recordChunksRef.current = [];
    setIsRecording(false);
    setRecordingMs(0);
    recordingPurposeRef.current = 'send';
  };

  /** Grava e envia áudio na conversa ativa (mensagem de voz). */
  const startVoiceRecording = async () => {
    if (!activeChatJid) {
      addLog('[WHATSAPP] Abra uma conversa para gravar áudio.');
      return;
    }
    if (isRecording || sendingAudio) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      addLog('[WHATSAPP] Microfone não disponível neste ambiente.');
      return;
    }
    recordingPurposeRef.current = 'send';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordStreamRef.current = stream;
      recordChunksRef.current = [];
      const preferred = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';
      const recorder = preferred
        ? new MediaRecorder(stream, { mimeType: preferred })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) recordChunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        // Pequena espera para o último ondataavailable chegar
        await new Promise((r) => setTimeout(r, 80));
        const durationSec = Math.max(1, Math.round((Date.now() - (recordingStartedAtRef.current || Date.now())) / 1000));
        try {
          const mime = recorder.mimeType || preferred || 'audio/webm';
          const blob = new Blob(recordChunksRef.current, { type: mime });
          if (!blob.size || blob.size < 200) {
            addLog('[WHATSAPP] Gravação vazia ou muito curta — grave de novo.');
            alert('Áudio vazio ou muito curto. Segure um pouco mais ao gravar.');
            return;
          }
          const b64 = await blobToBase64(blob);
          if (!activeChatJid) return;
          const toJid = getSendJid();
          setSendingAudio(true);
          // Timer visual de “enviando áudio” (~0,8s + presença)
          await runHumanizedPresence(toJid, 'audio', Math.min(2500, Math.max(800, durationSec * 200)));
          const res = await window.chatAPI.sendAudio(
            toJid,
            b64,
            mime,
            activeConnectionId,
          );
          await window.chatAPI.chatAction(toJid, 'paused', activeConnectionId).catch(() => {});
          if (res?.success) {
            setMessages((prev) => [...prev, {
              key: { fromMe: true, id: res.messageId || `local_voice_${Date.now()}` },
              message: { audioMessage: { mimetype: 'audio/ogg', ptt: true, seconds: durationSec } },
              messageTimestamp: Math.round(Date.now() / 1000),
            }]);
            // Recarrega histórico real
            try {
              const msgRes = await window.chatAPI.getMessages?.(activeChatJid, activeConnectionId);
              if (msgRes?.messages) setMessages(msgRes.messages);
            } catch { /* ignore */ }
            loadChats();
            addLog(`[WHATSAPP] Áudio de voz enviado (${durationSec}s, ${Math.round(blob.size / 1024)} KB).`);
          } else {
            addLog(`[WHATSAPP] Falha ao enviar áudio: ${res?.error || 'erro'}`);
            alert(`Falha ao enviar áudio: ${res?.error || 'erro desconhecido'}`);
          }
        } catch (e) {
          console.error(e);
          addLog(`[WHATSAPP] Erro ao processar áudio: ${e.message}`);
        } finally {
          setSendingAudio(false);
          setHumanizeProgress(null);
          stopRecordingCleanup();
        }
      };
      // timeslice pequeno + requestData no stop evita blob zerado
      recorder.start(250);
      setIsRecording(true);
      setRecordingMs(0);
      recordingStartedAtRef.current = Date.now();
      recordTimerRef.current = setInterval(() => {
        setRecordingMs(Date.now() - recordingStartedAtRef.current);
      }, 200);
      await window.chatAPI.chatAction(getSendJid(), 'recording', activeConnectionId).catch(() => {});
      addLog('[WHATSAPP] Gravando áudio… pare para enviar.');
    } catch (e) {
      console.error(e);
      stopRecordingCleanup();
      addLog(`[WHATSAPP] Não foi possível usar o microfone: ${e.message}`);
      alert('Permita o acesso ao microfone para gravar áudios.');
    }
  };

  const stopVoiceRecordingAndSend = () => {
    const rec = mediaRecorderRef.current;
    if (!rec || rec.state === 'inactive') {
      stopRecordingCleanup();
      return;
    }
    try {
      // Garante último chunk no ondataavailable antes do onstop
      if (typeof rec.requestData === 'function') {
        try { rec.requestData(); } catch { /* ignore */ }
      }
      rec.stop();
    } catch (e) {
      stopRecordingCleanup();
    }
  };

  const cancelVoiceRecording = () => {
    try {
      const rec = mediaRecorderRef.current;
      if (rec && rec.state !== 'inactive') {
        rec.ondataavailable = null;
        rec.onstop = () => stopRecordingCleanup();
        rec.stop();
      } else {
        stopRecordingCleanup();
      }
    } catch {
      stopRecordingCleanup();
    }
    window.chatAPI?.chatAction?.(activeChatJid, 'paused', activeConnectionId)?.catch?.(() => {});
    addLog('[WHATSAPP] Gravação cancelada.');
  };

  const loadWaDirectory = async (connectionId) => {
    const conn = connectionId || campaignConnectionId || activeConnectionId;
    if (!window.chatAPI?.getContacts || !conn) {
      setWaContacts([]);
      setWaGroups([]);
      return;
    }
    try {
      const res = await window.chatAPI.getContacts(conn);
      if (res?.success !== false) {
        setWaContacts(Array.isArray(res.contacts) ? res.contacts : []);
        setWaGroups(Array.isArray(res.groups) ? res.groups : []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const mergeRecipients = (list) => {
    setCampaignRecipients((prev) => {
      const map = new Map(prev.map((r) => [recipientKey(r), r]));
      for (const item of list || []) {
        const key = recipientKey(item);
        if (!key || key === 'p:' || key === 'g:') continue;
        if (!map.has(key)) map.set(key, item);
      }
      return [...map.values()];
    });
  };

  const removeRecipient = (key) => {
    setCampaignRecipients((prev) => prev.filter((r) => recipientKey(r) !== key));
  };

  const mapLocalLead = (l) => ({
    leadId: l.id,
    name: l.name || '',
    phone: l.phone,
    phoneRaw: l.phone || '',
    company: l.name || '',
    category: l.category || '',
    website: l.website || '',
    instagram: l.instagram || '',
    email: l.email || '',
    address: normalizeAddressForDisplay(l.address),
    rating: l.rating || '',
    totalReviews: l.totalReviews || '',
    score: l.score || '',
    prioridade: l.prioridade || '',
    source: 'scrape',
    searchId: l.searchId || '',
    isGroup: false,
  });

  const mapScoringLead = (l) => {
    const phone = l.company?.phone || l.company?.whatsapp || l.phone || '';
    const digits = String(phone).replace(/\D/g, '');
    return {
      leadId: l.id,
      name: l.company?.name || l.name || '',
      phone: digits || phone,
      phoneRaw: phone,
      company: l.company?.name || '',
      category: l.company?.category || '',
      website: l.company?.website || '',
      instagram: l.company?.instagram || '',
      email: l.company?.email || '',
      address: normalizeAddressForDisplay(l.company?.address),
      score: l.score?.value ?? '',
      prioridade: l.score?.priority || l.prioridade || '',
      source: 'scoring',
      searchId: l.searchId || '',
      isGroup: false,
    };
  };

  const loadRecipientSources = async () => {
    setRecipientSourcesLoading(true);
    try {
      let localLeads = [];
      let searches = [];
      try { localLeads = JSON.parse(localStorage.getItem('sigma_leads') || '[]'); } catch { localLeads = []; }
      try { searches = JSON.parse(localStorage.getItem('sigma_searches') || '[]'); } catch { searches = []; }
      if (!Array.isArray(localLeads)) localLeads = [];
      if (!Array.isArray(searches)) searches = [];
      setScrapeLeadPool(localLeads);

      const searchCards = (searches.length
        ? searches
        : [...new Set(localLeads.map((l) => l.searchId).filter(Boolean))].map((id) => ({
          id,
          label: id,
        }))
      ).map((s) => {
        const id = s.id;
        const inSearch = localLeads.filter((l) => String(l.searchId) === String(id));
        const withPhone = inSearch.filter((l) => l.phone);
        return {
          id,
          label: s.label || s.query || s.name || id,
          count: inSearch.length,
          withPhone: withPhone.length,
        };
      }).sort((a, b) => b.withPhone - a.withPhone);
      setScrapeSearches(searchCards);

      const localGroups = (() => {
        try {
          const raw = JSON.parse(localStorage.getItem('sigma_groups') || '[]');
          return Array.isArray(raw) ? raw : [];
        } catch { return []; }
      })();

      let serviceGroups = [];
      if (window.leadScoringAPI?.listGroups) {
        try {
          const gRes = await window.leadScoringAPI.listGroups();
          serviceGroups = Array.isArray(gRes?.groups) ? gRes.groups : [];
        } catch { serviceGroups = []; }
      }

      // A lista visível usa os dois lados sem duplicar: o grupo da Base manda.
      const merged = new Map();
      for (const group of [...localGroups, ...serviceGroups]) {
        const key = String(group?.id || '');
        if (!key || merged.has(key)) continue;
        merged.set(key, group);
      }
      const groups = [...merged.values()];
      // Cada grupo é resolvido contra a base atual para virar destinatários.
      const resolved = new Map();
      for (const group of groups) {
        resolved.set(String(group.id), resolveGroupMembers(group, localLeads));
      }
      setScoringGroups(groups);
      setGroupResolvedLeads(resolved);

      if (window.leadScoringAPI?.getAll) {
        const aRes = await window.leadScoringAPI.getAll({});
        setScoringLeadPool(Array.isArray(aRes?.leads) ? aRes.leads : []);
      } else {
        setScoringLeadPool([]);
      }
    } catch (e) {
      console.error(e);
      addLog(`[CAMPAIGN] Erro ao carregar fontes de destinatários: ${e.message}`);
    } finally {
      setRecipientSourcesLoading(false);
    }
  };

  const addLeadsFromScrape = (mode = 'all') => {
    const localLeads = scrapeLeadPool.length
      ? scrapeLeadPool
      : (() => { try { return JSON.parse(localStorage.getItem('sigma_leads') || '[]'); } catch { return []; } })();
    const filtered = localLeads.filter((l) => {
      if (!l.phone) return false;
      if (mode === 'all') return true;
      if (mode === 'qualified') {
        return l.outcome === 'oportunidade' || l.outcome === 'qualificado' || l.prioridade === 'alta';
      }
      return String(l.searchId) === String(mode);
    }).map(mapLocalLead);
    mergeRecipients(filtered);
    addLog(`[CAMPAIGN] +${filtered.length} lead(s) do scraping.`);
  };

  const groupLeads = (groupId) => groupResolvedLeads.get(String(groupId)) || [];
  const groupLeadCount = (group) => groupLeads(group?.id).length || 0;

  const addLeadsFromScoringGroup = async (groupId) => {
    const leads = groupLeads(groupId);
    const g = scoringGroups.find((x) => String(x.id) === String(groupId));
    const mapped = leads.map(mapLocalLead).filter((lead) => lead.phone);
    if (!mapped.length) {
      alert(`O grupo “${g?.name || groupId}” não tem leads com telefone na base atual.`);
      return;
    }
    mergeRecipients(mapped);
    addLog(`[CAMPAIGN] +${mapped.length} lead(s) do grupo “${g?.name || groupId}”.`);
  };

  const scoringLeadsFiltered = useMemo(() => {
    let list = scoringLeadPool || [];
    if (scoringPriorityFilter !== 'all') {
      list = list.filter((l) => String(l.score?.priority || '').toLowerCase() === scoringPriorityFilter);
    }
    const q = recipientBrowseFilter.trim().toLowerCase();
    if (q) {
      list = list.filter((l) => {
        const hay = [
          l.company?.name,
          l.company?.phone,
          l.company?.city,
          l.company?.category,
          l.score?.priority,
        ].join(' ').toLowerCase();
        return hay.includes(q);
      });
    }
    return list;
  }, [scoringLeadPool, scoringPriorityFilter, recipientBrowseFilter]);

  const scrapeBrowseList = useMemo(() => {
    let list = (scrapeLeadPool || []).filter((l) => l.phone);
    const q = recipientBrowseFilter.trim().toLowerCase();
    if (q) {
      list = list.filter((l) =>
        `${l.name || ''} ${l.phone || ''} ${l.category || ''} ${l.address || ''}`.toLowerCase().includes(q),
      );
    }
    return list.slice(0, 200);
  }, [scrapeLeadPool, recipientBrowseFilter]);

  const addFilteredScoringLeads = () => {
    const mapped = scoringLeadsFiltered.map(mapScoringLead).filter((l) => l.phone);
    mergeRecipients(mapped);
    addLog(`[CAMPAIGN] +${mapped.length} lead(s) analisados (filtro atual).`);
    if (!mapped.length) alert('Nenhum lead com telefone neste filtro.');
  };

  const toggleBrowseSelect = (key) => {
    setSelectedBrowseKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const addSelectedBrowseLeads = (source) => {
    if (source === 'scrape') {
      const items = scrapeBrowseList
        .filter((l) => selectedBrowseKeys.has(`scrape:${l.id || l.phone}`))
        .map(mapLocalLead);
      mergeRecipients(items);
      addLog(`[CAMPAIGN] +${items.length} lead(s) selecionados do scraping.`);
    } else if (source === 'scoring') {
      const items = scoringLeadsFiltered
        .filter((l) => selectedBrowseKeys.has(`score:${l.id}`))
        .map(mapScoringLead)
        .filter((l) => l.phone);
      mergeRecipients(items);
      addLog(`[CAMPAIGN] +${items.length} lead(s) selecionados do scoring.`);
    }
    setSelectedBrowseKeys(new Set());
  };

  const addCustomNumber = () => {
    const raw = customNumberInput.trim();
    if (!raw) return;
    const isGroup = raw.includes('@g.us');
    const entry = isGroup
      ? {
          leadId: `grp_${raw}`,
          name: customNameInput.trim() || raw.split('@')[0],
          phone: raw.includes('@') ? raw : `${raw}@g.us`,
          jid: raw.includes('@') ? raw : `${raw}@g.us`,
          isGroup: true,
          source: 'manual',
        }
      : {
          leadId: `manual_${Date.now()}`,
          name: customNameInput.trim() || '',
          phone: raw,
          phoneRaw: raw,
          isGroup: false,
          source: 'manual',
        };
    mergeRecipients([entry]);
    setCustomNumberInput('');
    setCustomNameInput('');
  };

  const connectedSessions = useMemo(
    () => (connections || []).filter((c) => c.status === 'connected'),
    [connections],
  );

  const openCreateCampaign = () => {
    // O botão também existe no cabeçalho de Conversas; o wizard vive no hub
    // de Campanhas, então a aba precisa acompanhar a abertura.
    setWaTab('campaigns');
    setEditingCampaignId(null);
    // Prefill com nome genérico (editável). Se apagar, cria com data/hora na hora do create.
    setNewCampaignName('');
    setCampaignRecipients([]);
    setCampaignManualText('');
    setCampaignGroupIds([]);
    hydratedGroupRef.current = null;
    setCustomNumberInput('');
    setCustomNameInput('');
    setRecipientSearch('');
    setRecipientSourceTab('scrape');
    setRecipientBrowseFilter('');
    setSelectedBrowseKeys(new Set());
    setScoringPriorityFilter('all');
    setCampaignWizardStep(0);
    setCreatingCampaignBusy(false);
    setCampaignFormError('');
    // Reseta mensagem + agendamento para não vazar da campanha anterior.
    setTemplateText('Olá {{name}}, tudo bem? Notamos que o seu site está com lentidão.');
    setIntervalSec(60);
    setScheduleMode('interval');
    setScheduleStartAt('');
    const defaults = connectedSessions.map((c) => c.id);
    const initial =
      campaignConnectionIds.length
        ? campaignConnectionIds.filter((id) => defaults.includes(id))
        : (campaignConnectionId && defaults.includes(campaignConnectionId)
          ? [campaignConnectionId]
          : (activeConnectionId && defaults.includes(activeConnectionId)
            ? [activeConnectionId]
            : defaults.slice(0, 1)));
    setCampaignConnectionIds(initial);
    if (initial[0]) setCampaignConnectionId(initial[0]);
    setIsCreatingCampaign(true);
    loadRecipientSources();
    if (initial[0]) {
      loadWaDirectory(initial[0]).catch(() => {});
    }
  };

  useEffect(() => {
    const onLeadScoringDraft = (event) => {
      const draft = event?.detail || {};
      openCreateCampaign();
      if (draft.name) setNewCampaignName(draft.name);
      if (draft.template?.text) setTemplateText(draft.template.text);
      // Draft com grupo vinculado resolve os membros no effect de hidratação.
      if (draft.groupId) {
        hydratedGroupRef.current = null;
        setCampaignGroupIds([draft.groupId]);
      } else if (Array.isArray(draft.recipients)) {
        setCampaignRecipients(draft.recipients);
      }
      setRecipientSourceTab('scoring');
    };
    window.addEventListener('sigma:open-campaign-draft', onLeadScoringDraft);
    return () => window.removeEventListener('sigma:open-campaign-draft', onLeadScoringDraft);
    // openCreateCampaign intentionally uses current connection state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedSessions, activeConnectionId, campaignConnectionId]);

  // Carrega scrapings + grupos da base ao abrir passo de destinatários
  useEffect(() => {
    if (!isCreatingCampaign) return;
    if (campaignWizardStep === 0 || editingCampaignId) {
      loadRecipientSources();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreatingCampaign, campaignWizardStep, editingCampaignId]);

  // Grupo criado ou alterado na Base de Leads aparece aqui sem reabrir o wizard.
  useEffect(() => {
    if (!isCreatingCampaign) return undefined;
    const refresh = () => loadRecipientSources();
    window.addEventListener('sigma:groups-updated', refresh);
    return () => window.removeEventListener('sigma:groups-updated', refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreatingCampaign]);

  useEffect(() => {
    if (!isCreatingCampaign || editingCampaignId || campaignWizardStep !== 0) return;
    if (campaignGroupIds.length || !scoringGroups.length) return;
    const first = scoringGroups.find((g) => groupLeadCount(g) > 0) || scoringGroups[0];
    if (first) toggleCampaignGroup(first.id, true);
    // toggleCampaignGroup/groupLeadCount resolvidos no momento do disparo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreatingCampaign, editingCampaignId, campaignWizardStep, scoringGroups, campaignGroupIds]);

  // Hidrata os membros quando os grupos chegam por fora (ex.: draft do scoring).
  useEffect(() => {
    if (!isCreatingCampaign || !campaignGroupIds.length || campaignRecipients.length) return;
    if (!scoringGroups.length) return;
    const key = [...campaignGroupIds].map(String).sort().join('|');
    if (hydratedGroupRef.current === key) return;
    hydratedGroupRef.current = key;
    for (const id of campaignGroupIds) toggleCampaignGroup(id, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreatingCampaign, campaignGroupIds, scoringGroups, campaignRecipients.length]);

  // Foco no nome ao abrir wizard (só uma vez por abertura)
  useEffect(() => {
    if (!isCreatingCampaign) return;
    if (editingCampaignId) return;
    if (campaignWizardStep !== 0) return;
    const t = window.setTimeout(() => {
      const el = campaignNameInputRef.current;
      if (!el) return;
      try {
        el.focus({ preventScroll: true });
        el.select?.();
      } catch {
        try { el.focus(); } catch { /* ignore */ }
      }
    }, 120);
    return () => window.clearTimeout(t);
    // intencional: só ao abrir o modal / voltar ao passo 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreatingCampaign]);

  const closeCampaignModal = () => {
    setIsCreatingCampaign(false);
    setEditingCampaignId(null);
    setCampaignWizardStep(0);
    setCreatingCampaignBusy(false);
    setCampaignFormError('');
  };

  const leaveMonitor = () => {
    setMonitoringCampaignId(null);
    setMonitoringCampaign(null);
    setWaTab('campaigns');
  };

  const toggleCampaignConnection = (id) => {
    setCampaignConnectionIds((prev) => {
      const has = prev.includes(id);
      const next = has ? prev.filter((x) => x !== id) : [...prev, id];
      if (!has && next.length === 1) {
        setCampaignConnectionId(id);
        loadWaDirectory(id);
      } else if (has && next[0]) {
        setCampaignConnectionId(next[0]);
      }
      return next;
    });
  };

  const openEditCampaignList = async (campaign) => {
    if (!campaign) return;
    if (['running', 'scheduled'].includes(campaign.status)) {
      alert('Pause a campanha antes de editar. Campanhas em disparo ou agendadas precisam ser pausadas.');
      return;
    }
    // Hidratação nunca pode travar o clique em silêncio: qualquer registro
    // de lead corrompido (null, formato antigo) vira erro visível, não modal morto.
    try {
      setEditingCampaignId(campaign.id);
      setNewCampaignName(campaign.name || '');
      setTemplateText(campaign.template?.text || 'Olá {{name}}, tudo bem? Notamos que o seu site está com lentidão.');
      // Hidrata agendamento atual para permitir reagendar + disparo direto.
      const sch = campaign.schedule || {};
      setScheduleMode(sch.mode || 'interval');
      setIntervalSec(Math.max(5, Math.round((Number(sch.intervalMs) || 60000) / 1000)));
      try {
        setScheduleStartAt(sch.startAt ? msToZonedDateTimeLocal(sch.startAt, sch.timeZone || campaignTimeZoneId(settings)) : '');
      } catch {
        setScheduleStartAt('');
      }
      setCampaignWizardStep(0);
      setCampaignFormError('');
      setCreatingCampaignBusy(false);
      // Grupos vinculados (se houver). Legadas sem grupo mantêm a lista atual.
      const linkedIds = Array.isArray(campaign.groupIds) && campaign.groupIds.length
        ? [...campaign.groupIds]
        : (campaign.groupId ? [campaign.groupId] : []);
      setCampaignGroupIds(linkedIds);
      hydratedGroupRef.current = linkedIds.length ? linkedIds.map(String).sort().join('|') : 'legacy';
      const rawLeads = Array.isArray(campaign.leads) ? campaign.leads : [];
      const hydrated = [];
      for (const item of rawLeads) {
        if (!item || typeof item !== 'object') continue;
        const l = item;
        hydrated.push({
          leadId: l.leadId,
          name: l.name || '',
          phone: l.phone || '',
          phoneRaw: l.phoneRaw || l.phone || '',
          jid: l.jid || '',
          isGroup: !!l.isGroup,
          source: l.source || 'manual',
          company: l.company || '',
          category: l.category || '',
          website: l.website || '',
          instagram: l.instagram || '',
          email: l.email || '',
          address: l.address || '',
          connectionId: l.connectionId || null,
          status: l.status,
          errorMessage: l.errorMessage,
          messageId: l.messageId,
          sentAt: l.sentAt,
          deliveredAt: l.deliveredAt,
          readAt: l.readAt,
          repliedAt: l.repliedAt,
          lastReplyAt: l.lastReplyAt,
          responseTimeMs: l.responseTimeMs,
          openCount: l.openCount,
          openedAt: l.openedAt,
          lastOpenAt: l.lastOpenAt,
          replyCount: l.replyCount,
          replyTimestamps: l.replyTimestamps,
          retryCount: l.retryCount,
          kanbanStage: l.kanbanStage,
          kanbanOrder: l.kanbanOrder,
        });
      }
      setCampaignRecipients(hydrated);
    } catch (err) {
      console.error('[CAMPAIGN] falha ao abrir edição:', err);
      alert('Não foi possível abrir a edição desta campanha: ' + (err?.message || err));
      return;
    }
    setIsCreatingCampaign(true);
    setRecipientSourceTab('scrape');
    loadRecipientSources().catch((err) => console.error('[CAMPAIGN] fontes:', err?.message || err));
    // Preserva divisão multi-número original em vez de colapsar para 1.
    const allConns = [
      ...(Array.isArray(campaign.connectionIds) ? campaign.connectionIds : []),
      campaign.connectionId,
    ].filter(Boolean);
    const uniqueConns = [...new Set(allConns)];
    const conn = uniqueConns[0] || campaignConnectionId || activeConnectionId;
    if (conn) {
      setCampaignConnectionId(conn);
      setCampaignConnectionIds(uniqueConns.length ? uniqueConns : [conn]);
      try {
        await loadWaDirectory(conn);
      } catch (err) {
        console.error('[CAMPAIGN] diretório:', err?.message || err);
      }
    } else if (uniqueConns.length) {
      setCampaignConnectionIds(uniqueConns);
    }
  };

  const mapRecipientsToPayload = (list, connIds = []) =>
    list.map((r, idx) => ({
      ...r,
      leadId: r.leadId || r.phone || r.jid,
      name: r.name || '',
      phone: r.phone || r.jid,
      phoneRaw: r.phoneRaw || r.phone || r.jid,
      jid: r.jid || '',
      isGroup: !!r.isGroup,
      source: r.source || 'manual',
      connectionId:
        r.connectionId ||
        (connIds.length ? connIds[idx % connIds.length] : null),
      company: r.company || r.name || '',
      category: r.category || (r.isGroup ? 'grupo' : ''),
      website: r.website || '',
      instagram: r.instagram || '',
      email: r.email || '',
      address: r.address || '',
      status: r.status,
      errorMessage: r.errorMessage,
      messageId: r.messageId,
      sentAt: r.sentAt,
      deliveredAt: r.deliveredAt,
      readAt: r.readAt,
      repliedAt: r.repliedAt,
      lastReplyAt: r.lastReplyAt,
      responseTimeMs: r.responseTimeMs,
      retryCount: r.retryCount,
      openCount: r.openCount,
      openedAt: r.openedAt,
      lastOpenAt: r.lastOpenAt,
      replyCount: r.replyCount,
      replyTimestamps: r.replyTimestamps,
      kanbanStage: r.kanbanStage,
      kanbanOrder: r.kanbanOrder,
    }));

  // Create / update campaign — uma campanha pode ter vários números
  const handleCreateCampaign = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    if (!window.campaignAPI) {
      setCampaignFormError('Serviço de campanhas indisponível. Reinicie o app e tente novamente.');
      return;
    }
    setCampaignFormError('');

    // Nome: digita ou genérico com data/hora
    const baseName = (newCampaignName || '').trim() || buildDefaultCampaignName();

    if (editingCampaignId) {
      if (campaignRecipients.length === 0) {
        alert('Adicione ao menos um destinatário.');
        return;
      }
      if (!templateText.trim()) {
        alert('Escreva o template da mensagem.');
        return;
      }
      if (scheduleMode === 'scheduled') {
        if (!scheduleStartAt) {
          setCampaignFormError('Escolha data e hora para agendar o disparo.');
          return;
        }
        const ts = zonedDateTimeToMs(scheduleStartAt, campaignTimeZoneId(settings));
        if (!Number.isFinite(ts)) {
          setCampaignFormError('Data/hora de agendamento inválida.');
          return;
        }
        if (ts <= Date.now()) {
          setCampaignFormError('Agende um horário futuro ou use disparo direto (intervalo/imediato).');
          return;
        }
      }
      try {
        setCreatingCampaignBusy(true);
        const editing = campaigns.find((c) => c.id === editingCampaignId);
        const editTz = campaignTimeZoneId(settings);
        const schedule = {
          mode: scheduleMode,
          intervalMs: Math.max(5000, (Number(intervalSec) || 60) * 1000),
          startAt: scheduleMode === 'scheduled' && scheduleStartAt
            ? Math.floor(zonedDateTimeToMs(scheduleStartAt, editTz))
            : null,
          workingHours: editing?.schedule?.workingHours ?? null,
          timeZone: editTz === 'system' ? null : editTz,
        };
        const res = await window.campaignAPI.update(editingCampaignId, {
          name: baseName,
          template: {
            text: templateText,
            variables: extractTemplateVariables(templateText),
            // Preserva mídia existente — a edição não tem editor de mídia.
            ...(editing?.template?.media ? { media: editing.template.media } : {}),
          },
          leads: mapRecipientsToPayload(campaignRecipients, campaignConnectionIds),
          schedule,
          connectionId: campaignConnectionIds[0] || editing?.connectionId || null,
          connectionIds: campaignConnectionIds.length
            ? campaignConnectionIds
            : (editing?.connectionIds || (editing?.connectionId ? [editing.connectionId] : [])),
          // Vincula os grupos marcados (legadas sem grupo mantêm a lista).
          ...(campaignGroupIds.length
            ? {
                groupIds: [...campaignGroupIds],
                groupId: campaignGroupIds[0],
                groupName: selectedCampaignGroups.map((g) => g.name).join(' + ') || editing?.groupName || '',
              }
            : {}),
        });
        if (res?.success) {
          const savedId = editingCampaignId;
          if (res.campaign) {
            setCampaigns((current) => current.map((item) => item.id === savedId ? res.campaign : item));
            setKanbanCampaign((current) => current && current.id === savedId ? res.campaign : current);
            setMonitoringCampaign((current) => current && current.id === savedId ? res.campaign : current);
          }
          closeCampaignModal();
          setCampaignRecipients([]);
          loadCampaigns();
          addLog(`[CAMPAIGN] Campanha atualizada (${campaignRecipients.length} destinatários, ${schedule.mode === 'scheduled' ? 'agendada' : 'disparo direto'}).`);
        } else {
          setCampaignFormError('Erro ao salvar: ' + (res?.error || 'desconhecido'));
        }
      } catch (err) {
        setCampaignFormError('Erro ao salvar: ' + (err?.message || 'falha inesperada'));
      } finally {
        setCreatingCampaignBusy(false);
      }
      return;
    }

    const connIds = (campaignConnectionIds.length
      ? campaignConnectionIds
      : [campaignConnectionId || activeConnectionId].filter(Boolean)
    ).filter((id) => connectedSessions.some((c) => c.id === id));

    const groups = (scoringGroups || []).filter((g) => campaignGroupIds.some((id) => String(id) === String(g?.id)));
    if (!groups.length) {
      setCampaignFormError('Escolha ao menos um grupo de leads (passo 1).');
      setCampaignWizardStep(0);
      return;
    }
    if (campaignRecipients.length === 0) {
      setCampaignFormError(`Os grupos escolhidos não têm leads com telefone na base atual.`);
      setCampaignWizardStep(0);
      return;
    }
    if (!templateText.trim()) {
      alert('Escreva o template da mensagem.');
      return;
    }
    if (scheduleMode === 'scheduled') {
      if (!scheduleStartAt) {
        alert('Escolha data e hora para agendar o disparo.');
        return;
      }
      const ts = zonedDateTimeToMs(scheduleStartAt, campaignTimeZoneId(settings));
      if (!Number.isFinite(ts)) {
        alert('Data/hora de agendamento inválida.');
        return;
      }
      if (ts <= Date.now()) {
        alert('Agende um horário futuro ou use disparo direto (intervalo/imediato).');
        return;
      }
    }

    const campSettings = settings.campaigns || {};
    const createTz = campaignTimeZoneId(settings);
    const schedule = {
      mode: scheduleMode,
      intervalMs: Math.max(5000, intervalSec * 1000),
      startAt: scheduleMode === 'scheduled' && scheduleStartAt
        ? Math.floor(zonedDateTimeToMs(scheduleStartAt, createTz))
        : null,
      // Herda janela global (pode ser desligada nas configs)
      workingHours: campSettings.workingHoursEnabled === false
        ? { enabled: false }
        : {
            enabled: true,
            start: campSettings.workingHoursStart || '07:00',
            end: campSettings.workingHoursEnd || '18:00',
          },
      timeZone: createTz === 'system' ? null : createTz,
    };
    const template = { text: templateText, variables: extractTemplateVariables(templateText), media: null };
    const leads = mapRecipientsToPayload(campaignRecipients, connIds);

    try {
      setCreatingCampaignBusy(true);
      const res = await window.campaignAPI.create({
        name: baseName,
        provider: providerType,
        connectionId: connIds[0],
        connectionIds: connIds,
        groupIds: groups.map((g) => g.id),
        groupId: groups[0].id,
        groupName: groups.map((g) => g.name).join(' + '),
        template,
        leadIds: leads,
        schedule,
      });
      if (res?.success) {
        closeCampaignModal();
        setNewCampaignName('');
        setCampaignRecipients([]);
        loadCampaigns();
        addLog(res.savedAsDraft
          ? `[CAMPAIGN] Campanha "${baseName}" salva como rascunho. Conecte um WhatsApp antes de iniciar os disparos.`
          : connIds.length > 1
            ? `[CAMPAIGN] "${baseName}" criada com ${campaignRecipients.length} leads em ${connIds.length} números (relatório unificado).`
            : `[CAMPAIGN] Campanha "${baseName}" criada com ${campaignRecipients.length} destinatário(s).`,
        );
      } else {
        setCampaignFormError(`Erro ao criar campanha: ${res?.error || 'desconhecido'}`);
      }
    } catch (err) {
      setCampaignFormError('Erro ao criar campanha: ' + (err?.message || 'falha inesperada'));
    } finally {
      setCreatingCampaignBusy(false);
    }
  };

  // Situação para organizar dezenas de campanhas: rascunho · ativas · finalizadas.
  const campaignBucket = (c) => {
    if (c?.status === 'ready') return 'draft';
    if (['completed', 'cancelled'].includes(c?.status)) return 'done';
    return 'active';
  };

  const campaignStatusCounts = useMemo(() => {
    const counts = { all: (campaigns || []).length, draft: 0, active: 0, done: 0 };
    for (const c of campaigns || []) counts[campaignBucket(c)] += 1;
    return counts;
  }, [campaigns]);

  const filteredCampaigns = useMemo(() => {
    const q = campaignSearch.trim().toLowerCase();
    let list = [...(campaigns || [])];
    if (campaignStatusFilter !== 'all') {
      list = list.filter((c) => campaignBucket(c) === campaignStatusFilter);
    }
    if (q) {
      list = list.filter((c) => {
        const phones = [
          c.connectionId,
          ...(c.connectionIds || []),
        ].map((id) => {
          const cn = connections.find((x) => x.id === id);
          return `${id} ${cn?.phoneNumber || ''}`;
        }).join(' ');
        return `${c.name || ''} ${c.status || ''} ${phones}`.toLowerCase().includes(q);
      });
    }
    list.sort((a, b) => {
      if (campaignSort === 'name') {
        return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR');
      }
      const da = Number(a.createdAt || a.updatedAt || 0);
      const db = Number(b.createdAt || b.updatedAt || 0);
      return campaignSort === 'oldest' ? da - db : db - da;
    });
    return list;
  }, [campaigns, campaignSearch, campaignSort, campaignStatusFilter, connections]);

  const formatCampaignDate = (ts) => {
    if (!ts) return '—';
    try {
      return new Date(ts).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '—';
    }
  };

  const campaignPhoneLabels = (c) => {
    const ids = [
      ...(Array.isArray(c.connectionIds) ? c.connectionIds : []),
      c.connectionId,
    ].filter(Boolean);
    const unique = [...new Set(ids)];
    return unique.map((id) => {
      const cn = connections.find((x) => x.id === id);
      return { id, label: cn?.phoneNumber || id.slice(0, 10) };
    });
  };

  const openCampaignKanban = (campaign) => {
    setDraggingKanbanCard(null);
    setKanbanCampaign(campaign);
  };

  const moveKanbanCard = async (campaign, lead, nextStage) => {
    if (!campaign || !lead || !CAMPAIGN_KANBAN_STAGES.some((stage) => stage.id === nextStage)) return;
    if (resolveKanbanStage(lead) === nextStage) return;
    const leadKey = String(lead.leadId || lead.phone || lead.jid || '');
    if (!leadKey || !window.campaignAPI?.update) return;

    const nextOrder = (campaign.leads || [])
      .filter((item) => resolveKanbanStage(item) === nextStage)
      .reduce((max, item) => Math.max(max, Number(item.kanbanOrder) || 0), -1) + 1;

    try {
      const res = await window.campaignAPI.update(campaign.id, {
        leads: (campaign.leads || []).map((item) => {
          const itemKey = String(item.leadId || item.phone || item.jid || '');
          return itemKey === leadKey
            ? { ...item, kanbanStage: nextStage, kanbanOrder: nextOrder }
            : item;
        }),
      });
      if (!res?.success || !res.campaign) {
        throw new Error(res?.error || 'Não foi possível mover o card.');
      }
      setKanbanCampaign(res.campaign);
      setCampaigns((current) => current.map((item) => item.id === res.campaign.id ? res.campaign : item));
      addLog(`[KANBAN] ${lead.name || lead.phone || 'Lead'} movido para ${CAMPAIGN_KANBAN_STAGES.find((stage) => stage.id === nextStage)?.label}.`);
    } catch (err) {
      alert(`Erro ao mover card: ${err?.message || err}`);
    } finally {
      setDraggingKanbanCard(null);
    }
  };

  const renderCampaignKanban = () => {
    const campaign = kanbanCampaign;
    if (!campaign) return null;
    const presentation = campaignStatusPresentation(campaign);
    const leads = [...(campaign.leads || [])]
      .sort((a, b) => (Number(a.kanbanOrder) || 0) - (Number(b.kanbanOrder) || 0));

    return (
      <section className="campaign-kanban-layer" aria-label={`Kanban da campanha ${campaign.name}`}>
        <header className="campaign-kanban-header">
          <button type="button" className="btn btn-secondary btn-compact" onClick={() => setKanbanCampaign(null)}>
            <ChevronLeft size={14} /> Campanhas
          </button>
          <div className="campaign-kanban-title">
            <span className="camp-hub-kicker">Kanban</span>
            <h2>{campaign.name}</h2>
            <p>{leads.length} destinatários · arraste os cards ou use o seletor para mudar de etapa.</p>
          </div>
          <div className="campaign-kanban-head-actions">
            <span className={`camp-status-badge ${presentation.statusClass}`}>{presentation.label}</span>
            <button
              type="button"
              className="btn btn-secondary btn-compact"
              title="Editar campanha (lista, mensagem e agendamento)"
              onClick={() => openEditCampaignList(
                campaigns.find((x) => x.id === campaign?.id) || campaign,
              )}
            >
              <Pencil size={13} /> Editar
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-compact"
              onClick={() => {
                setKanbanCampaign(null);
                handleMonitorCampaign(campaign.id);
              }}
            >
              <Activity size={13} /> Relatório
            </button>
          </div>
        </header>
        <div className="campaign-kanban-columns">
          {CAMPAIGN_KANBAN_STAGES.map((stage) => {
            const cards = leads.filter((lead) => resolveKanbanStage(lead) === stage.id);
            return (
              <section
                key={stage.id}
                className={`campaign-kanban-column stage-${stage.id}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggingKanbanCard?.campaignId === campaign.id) {
                    moveKanbanCard(campaign, draggingKanbanCard.lead, stage.id);
                  }
                }}
              >
                <div className="campaign-kanban-column-head">
                  <div>
                    <h3>{stage.label}</h3>
                    <span>{stage.hint}</span>
                  </div>
                  <b>{cards.length}</b>
                </div>
                <div className="campaign-kanban-cards">
                  {cards.length === 0 ? (
                    <div className="campaign-kanban-empty">Arraste um card para cá</div>
                  ) : cards.map((lead) => {
                    const cardKey = String(lead.leadId || lead.phone || lead.jid);
                    const delivery = {
                      pending: 'Não enviado',
                      sent: 'Enviado',
                      delivered: 'Entregue',
                      read: 'Lido',
                      replied: 'Respondeu',
                      failed: 'Falhou',
                    }[lead.status] || 'Não enviado';
                    return (
                      <article
                        key={cardKey}
                        className="campaign-kanban-card"
                        draggable
                        onDragStart={() => setDraggingKanbanCard({ campaignId: campaign.id, lead })}
                        onDragEnd={() => setDraggingKanbanCard(null)}
                      >
                        <strong>{lead.name || lead.company || lead.phone || 'Lead sem nome'}</strong>
                        <span className="campaign-kanban-card-phone" data-sensitive-phone="true">{lead.phoneRaw || lead.phone || lead.jid || '—'}</span>
                        <div className="campaign-kanban-card-meta">
                          <span>{delivery}</span>
                          {lead.category && <span>{lead.category}</span>}
                        </div>
                        <label className="campaign-kanban-move">
                          <span className="sr-only">Mover {lead.name || 'card'} para</span>
                          <select
                            value={stage.id}
                            onChange={(event) => moveKanbanCard(campaign, lead, event.target.value)}
                          >
                            {CAMPAIGN_KANBAN_STAGES.map((option) => (
                              <option key={option.id} value={option.id}>{option.label}</option>
                            ))}
                          </select>
                        </label>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </section>
    );
  };

  const wizardSteps = [
    { id: 'recipients', title: 'Quem recebe?' },
    { id: 'message', title: 'Qual é a mensagem?' },
    { id: 'schedule', title: 'Quando disparar?' },
    { id: 'review', title: 'Revisar campanha' },
  ];

  const canWizardNext = () => {
    if (editingCampaignId) return true;
    if (campaignWizardStep === 0) return campaignGroupIds.length > 0 && campaignRecipients.length > 0;
    if (campaignWizardStep === 1) return !!templateText.trim();
    if (campaignWizardStep === 2) {
      if (scheduleMode === 'scheduled') {
        if (!scheduleStartAt) return false;
        const ts = zonedDateTimeToMs(scheduleStartAt, campaignTimeZoneId(settings));
        if (!Number.isFinite(ts) || ts <= Date.now()) return false;
      }
      return intervalSec >= 5;
    }
    return true;
  };

  const goWizardNext = () => {
    if (!canWizardNext()) {
      if (campaignWizardStep === 0) alert('Escolha o grupo de leads da campanha.');
      else if (campaignWizardStep === 1) alert('Escreva a mensagem da campanha.');
      else if (campaignWizardStep === 2) alert('Confira o intervalo e o agendamento.');
      return;
    }
    // Se o nome estiver vazio ao sair do passo 0, preenche genérico
    if (campaignWizardStep === 0 && !(newCampaignName || '').trim()) {
      setNewCampaignName(buildDefaultCampaignName());
    }
    setCampaignWizardStep((s) => Math.min(wizardSteps.length - 1, s + 1));
  };

  // Estimativa ao vivo: quantos dias para zerar a lista com as regras atuais.
  const durationEstimate = useMemo(() => estimateCampaignDuration({
    totalLeads: campaignRecipients.length,
    intervalSec,
    connectionCount: campaignConnectionIds.length || 1,
    dailyLimit: settings.campaigns?.dailyLimit || 10,
    manualUnlimited: settings.campaigns?.manualUnlimited === true,
    workingHoursEnabled: settings.campaigns?.workingHoursEnabled !== false,
    workingHoursStart: settings.campaigns?.workingHoursStart || '07:00',
    workingHoursEnd: settings.campaigns?.workingHoursEnd || '18:00',
  }), [
    campaignRecipients.length,
    intervalSec,
    campaignConnectionIds.length,
    settings.campaigns?.dailyLimit,
    settings.campaigns?.manualUnlimited,
    settings.campaigns?.workingHoursEnabled,
    settings.campaigns?.workingHoursStart,
    settings.campaigns?.workingHoursEnd,
  ]);

  // Grupos vinculados (a campanha soma grupos) + campanha em edição.
  const selectedCampaignGroups = useMemo(
    () => (scoringGroups || []).filter((g) => (campaignGroupIds || []).some((id) => String(id) === String(g?.id))),
    [scoringGroups, campaignGroupIds],
  );
  const editingCampaign = editingCampaignId
    ? (campaigns || []).find((c) => c.id === editingCampaignId) || null
    : null;
  // Evita que o hidratador automático reencha a lista após limpeza manual.
  const hydratedGroupRef = useRef(null);

  /** Soma de grupos: marcar adiciona os membros; desmarcar remove só os dele. */
  const toggleCampaignGroup = (groupId, checked) => {
    const g = (scoringGroups || []).find((x) => String(x.id) === String(groupId));
    if (!g) return;
    const id = String(g.id);
    const isChecked = typeof checked === 'boolean'
      ? checked
      : !campaignGroupIds.some((x) => String(x) === id);
    const source = `scoring-group:${g.id}`;
    if (!isChecked) {
      const affected = campaignRecipients.filter((item) => item.source === source).length;
      if (affected > 0 && !confirm(`Remover o grupo “${g.name}” tira ${affected} lead(s) da lista. Continuar?`)) return;
      setCampaignGroupIds((prev) => prev.filter((x) => String(x) !== id));
      setCampaignRecipients((items) => items.filter((item) => item.source !== source));
      return;
    }
    const mapped = groupLeads(g.id).map(mapLocalLead).filter((lead) => lead.phone)
      .map((lead) => ({ ...lead, source }));
    if (!mapped.length) {
      addLog(`[CAMPAIGN] Grupo “${g.name}” não tem leads com telefone na base atual.`);
      return;
    }
    setCampaignGroupIds((prev) => (prev.some((x) => String(x) === id) ? prev : [...prev, id]));
    mergeRecipients(mapped);
    addLog(`[CAMPAIGN] Grupo “${g.name}” somado (${mapped.length} leads).`);
  };

  const updateCampaignManualText = (value) => {
    setCampaignManualText(value);
    const manual = value.split(/\r?\n/).map((line, index) => {
      const [phonePart, ...nameParts] = line.split(/\s+[—-]\s+/);
      const phone = String(phonePart || '').trim();
      if (!phone.replace(/\D/g, '')) return null;
      return {
        leadId: `campaign_manual_${index}_${phone.replace(/\D/g, '')}`,
        name: nameParts.join(' — ').trim(),
        phone,
        phoneRaw: phone,
        isGroup: false,
        source: 'campaign-manual',
      };
    }).filter(Boolean);
    setCampaignRecipients((items) => {
      const keep = items.filter((item) => item.source !== 'campaign-manual');
      const map = new Map(keep.map((item) => [recipientKey(item), item]));
      manual.forEach((item) => map.set(recipientKey(item), item));
      return [...map.values()];
    });
  };

  const sourceTabs = [
    { id: 'scrape', label: 'Scraping', icon: Search },
    { id: 'groups', label: 'Grupos scoring', icon: Users },
    { id: 'scoring', label: 'Analisados', icon: BarChart3 },
    { id: 'whatsapp', label: 'WhatsApp', icon: Phone },
    { id: 'manual', label: 'Manual', icon: UserPlus },
  ];

  const renderRecipientsEditor = () => (
    <div className="camp-recipients-box">
      <div className="camp-rcp-header">
        <strong>Destinatários ({campaignRecipients.length})</strong>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ padding: '4px 10px', fontSize: 11 }}
          onClick={() => loadRecipientSources()}
          disabled={recipientSourcesLoading}
        >
          <RefreshCw size={12} /> {recipientSourcesLoading ? 'Carregando…' : 'Atualizar fontes'}
        </button>
      </div>

      <div className="camp-rcp-tabs">
        {sourceTabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              className={`camp-rcp-tab ${recipientSourceTab === t.id ? 'act' : ''}`}
              onClick={() => {
                setRecipientSourceTab(t.id);
                setSelectedBrowseKeys(new Set());
                if (t.id === 'whatsapp') {
                  loadWaDirectory(campaignConnectionIds[0] || campaignConnectionId || activeConnectionId);
                }
              }}
            >
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* SCRAPING */}
      {recipientSourceTab === 'scrape' && (
        <div className="camp-rcp-pane">
          <div className="camp-rcp-quick">
            <button type="button" className="camp-source-card accent" onClick={() => addLeadsFromScrape('all')}>
              <strong>Todos com telefone</strong>
              <span>{scrapeLeadPool.filter((l) => l.phone).length} leads</span>
            </button>
            <button type="button" className="camp-source-card" onClick={() => addLeadsFromScrape('qualified')}>
              <strong>Oportunidades</strong>
              <span>Prioridade / qualificados</span>
            </button>
          </div>
          <div className="camp-rcp-section-title">Pesquisas do scraping</div>
          {scrapeSearches.length === 0 ? (
            <p className="camp-hint">Nenhuma pesquisa encontrada. Rode um scraping em “Todos os Leads”.</p>
          ) : (
            <div className="camp-source-grid">
              {scrapeSearches.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="camp-source-card"
                  onClick={() => addLeadsFromScrape(s.id)}
                  title={`Adicionar ${s.withPhone} com telefone`}
                >
                  <strong>{s.label}</strong>
                  <span>{s.withPhone} c/ telefone · {s.count} total</span>
                </button>
              ))}
            </div>
          )}
          <div className="camp-rcp-section-title" style={{ marginTop: 10 }}>Seleção manual</div>
          <input
            value={recipientBrowseFilter}
            onChange={(e) => setRecipientBrowseFilter(e.target.value)}
            placeholder="Filtrar por nome, telefone, categoria…"
          />
          <div className="camp-browse-list">
            {scrapeBrowseList.length === 0 ? (
              <span className="camp-hint">Nenhum lead com telefone neste filtro.</span>
            ) : scrapeBrowseList.map((l) => {
              const key = `scrape:${l.id || l.phone}`;
              const on = selectedBrowseKeys.has(key);
              return (
                <label key={key} className={`camp-browse-row ${on ? 'on' : ''}`}>
                  <input type="checkbox" checked={on} onChange={() => toggleBrowseSelect(key)} />
                  <span className="camp-browse-name">{l.name || 'Sem nome'}</span>
                  <span className="camp-browse-meta" data-sensitive-phone="true">{l.phone}</span>
                </label>
              );
            })}
          </div>
          {selectedBrowseKeys.size > 0 && (
            <button type="button" className="btn btn-primary" style={{ marginTop: 8 }} onClick={() => addSelectedBrowseLeads('scrape')}>
              Adicionar {selectedBrowseKeys.size} selecionado(s)
            </button>
          )}
        </div>
      )}

      {/* GRUPOS DA BASE DE LEADS */}
      {recipientSourceTab === 'groups' && (
        <div className="camp-rcp-pane">
          <p className="camp-hint" style={{ marginBottom: 8 }}>
            Grupos criados na Base de Leads. Toque para adicionar os contatos com telefone.
          </p>
          {scoringGroups.length === 0 ? (
            <div className="camp-empty-mini">
              <Users size={20} />
              <p>Nenhum grupo ainda</p>
              <span>Crie um grupo na Base de Leads — ele aparece aqui na hora.</span>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => {
                  window.location.hash = '#base';
                  window.dispatchEvent(new CustomEvent('sigma:open-groups'));
                }}
              >
                Criar grupo agora
              </button>
            </div>
          ) : (
            <div className="camp-source-grid">
              {scoringGroups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className="camp-source-card scoring"
                  style={g.color ? { borderColor: g.color } : undefined}
                  onClick={() => addLeadsFromScoringGroup(g.id)}
                >
                  <strong>{g.name}</strong>
                  <span>{groupLeadCount(g)} lead(s) · toque para adicionar</span>
                  {g.description ? <em>{g.description}</em> : null}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ANALISADOS */}
      {recipientSourceTab === 'scoring' && (
        <div className="camp-rcp-pane">
          <div className="camp-rcp-chips">
            {[
              { id: 'all', label: 'Todos' },
              { id: 'alta', label: 'Prioridade alta' },
              { id: 'media', label: 'Média' },
              { id: 'baixa', label: 'Baixa' },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                className={`camp-rcp-chip ${scoringPriorityFilter === f.id ? 'act' : ''}`}
                onClick={() => setScoringPriorityFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
            <button type="button" className="btn btn-primary" style={{ padding: '4px 10px', fontSize: 11, marginLeft: 'auto' }} onClick={addFilteredScoringLeads}>
              + Todos do filtro ({scoringLeadsFiltered.filter((l) => l.company?.phone || l.company?.whatsapp).length})
            </button>
          </div>
          <input
            value={recipientBrowseFilter}
            onChange={(e) => setRecipientBrowseFilter(e.target.value)}
            placeholder="Buscar nos analisados…"
            style={{ marginTop: 8 }}
          />
          <div className="camp-browse-list">
            {scoringLeadsFiltered.length === 0 ? (
              <span className="camp-hint">Nenhum lead analisado neste filtro.</span>
            ) : scoringLeadsFiltered.slice(0, 150).map((l) => {
              const key = `score:${l.id}`;
              const on = selectedBrowseKeys.has(key);
              const phone = l.company?.phone || l.company?.whatsapp || 'sem telefone';
              return (
                <label key={key} className={`camp-browse-row ${on ? 'on' : ''}`}>
                  <input type="checkbox" checked={on} onChange={() => toggleBrowseSelect(key)} disabled={!l.company?.phone && !l.company?.whatsapp} />
                  <span className="camp-browse-name">{l.company?.name || 'Lead'}</span>
                  <span className="camp-browse-meta" data-sensitive-phone="true">
                    {phone}
                    {l.score?.priority ? ` · ${l.score.priority}` : ''}
                    {l.score?.value != null ? ` · ${l.score.value}pts` : ''}
                  </span>
                </label>
              );
            })}
          </div>
          {selectedBrowseKeys.size > 0 && (
            <button type="button" className="btn btn-primary" style={{ marginTop: 8 }} onClick={() => addSelectedBrowseLeads('scoring')}>
              Adicionar {selectedBrowseKeys.size} selecionado(s)
            </button>
          )}
        </div>
      )}

      {/* WHATSAPP */}
      {recipientSourceTab === 'whatsapp' && (
        <div className="camp-rcp-pane">
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input
              value={recipientSearch}
              onChange={(e) => setRecipientSearch(e.target.value)}
              placeholder="Buscar contatos/grupos do WhatsApp…"
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => loadWaDirectory(campaignConnectionIds[0] || campaignConnectionId || activeConnectionId)}
            >
              <RefreshCw size={12} />
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div className="camp-rcp-section-title">Contatos ({filteredWaContacts.length})</div>
              <div className="camp-browse-list">
                {filteredWaContacts.length === 0 ? (
                  <span className="camp-hint">Conecte o WhatsApp e atualize.</span>
                ) : filteredWaContacts.map((c) => (
                  <button
                    key={recipientKey(c)}
                    type="button"
                    className="camp-browse-btn"
                    onClick={() => mergeRecipients([{
                      leadId: c.phone || c.jid,
                      name: c.name || '',
                      phone: c.phone,
                      jid: c.jid,
                      isGroup: false,
                      source: 'contact',
                    }])}
                  >
                    <User size={12} /> <span data-sensitive-phone={!c.name && c.phone ? 'true' : undefined}>{c.name || c.phone}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="camp-rcp-section-title">Grupos WA ({filteredWaGroups.length})</div>
              <div className="camp-browse-list">
                {filteredWaGroups.length === 0 ? (
                  <span className="camp-hint">Nenhum grupo WA.</span>
                ) : filteredWaGroups.map((g) => (
                  <button
                    key={recipientKey(g)}
                    type="button"
                    className="camp-browse-btn"
                    onClick={() => mergeRecipients([{
                      leadId: `grp_${g.jid}`,
                      name: g.name || 'Grupo',
                      phone: g.jid,
                      jid: g.jid,
                      isGroup: true,
                      source: 'group',
                    }])}
                  >
                    <Users size={12} /> {g.name || g.jid}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MANUAL */}
      {recipientSourceTab === 'manual' && (
        <div className="camp-rcp-pane">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8 }}>
            <input
              value={customNumberInput}
              onChange={(e) => setCustomNumberInput(e.target.value)}
              placeholder="Número ou id@g.us"
            />
            <input
              value={customNameInput}
              onChange={(e) => setCustomNameInput(e.target.value)}
              placeholder="Nome (opcional)"
            />
            <button type="button" className="btn btn-primary" onClick={addCustomNumber}>
              Adicionar
            </button>
          </div>
        </div>
      )}

      {/* LISTA FINAL */}
      <div className="camp-rcp-final">
        <div className="camp-rcp-section-title">
          Lista da campanha ({campaignRecipients.length})
          {campaignRecipients.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '2px 8px', fontSize: 11, marginLeft: 8 }}
              onClick={() => { if (confirm('Limpar toda a lista?')) setCampaignRecipients([]); }}
            >
              Limpar
            </button>
          )}
        </div>
        <div className="camp-browse-list camp-final-list">
          {campaignRecipients.length === 0 ? (
            <span className="camp-hint">Lista vazia — escolha uma fonte acima.</span>
          ) : campaignRecipients.map((r) => (
            <div key={recipientKey(r)} className="camp-recipient-row">
              <div style={{ minWidth: 0 }}>
                <strong style={{ display: 'block' }} data-sensitive-phone={!r.name && !r.isGroup && r.phone ? 'true' : undefined}>
                  {r.isGroup ? '👥 ' : '👤 '}
                  {r.name || r.phone || r.jid}
                </strong>
                <span className="camp-hint" style={{ margin: 0 }} data-sensitive-phone="true">
                  {r.isGroup ? (r.jid || r.phone) : r.phone}
                  {r.source ? ` · ${r.source}` : ''}
                  {r.prioridade ? ` · ${r.prioridade}` : ''}
                </span>
              </div>
              <button type="button" className="btn btn-danger" style={{ padding: '2px 8px' }} onClick={() => removeRecipient(recipientKey(r))}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const filteredWaContacts = useMemo(() => {
    const q = recipientSearch.trim().toLowerCase();
    if (!q) return waContacts.slice(0, 80);
    return waContacts.filter((c) =>
      `${c.name || ''} ${c.phone || ''}`.toLowerCase().includes(q),
    ).slice(0, 80);
  }, [waContacts, recipientSearch]);

  const filteredWaGroups = useMemo(() => {
    const q = recipientSearch.trim().toLowerCase();
    if (!q) return waGroups.slice(0, 80);
    return waGroups.filter((c) =>
      `${c.name || ''} ${c.jid || ''}`.toLowerCase().includes(q),
    ).slice(0, 80);
  }, [waGroups, recipientSearch]);

  // True quando a campanha vai nascer em espera por causa do horário de disparo.
  const isOutsideWorkingHours = (campaign) => {
    const wh = campaign?.schedule?.workingHours;
    const enabled = wh ? wh.enabled !== false : settings.campaigns?.workingHoursEnabled !== false;
    if (!enabled) return false;
    const toMinutes = (value) => {
      const m = String(value || '').match(/^(\d{1,2}):?(\d{2})?$/);
      return m ? parseInt(m[1], 10) * 60 + (parseInt(m[2], 10) || 0) : null;
    };
    const start = toMinutes(wh?.start || settings.campaigns?.workingHoursStart || '07:00');
    const end = toMinutes(wh?.end || settings.campaigns?.workingHoursEnd || '18:00');
    if (start == null || end == null) return false;
    const now = new Date();
    const current = now.getHours() * 60 + now.getMinutes();
    return end <= start
      ? !(current >= start || current < end)
      : !(current >= start && current < end);
  };

  // Avisa (e permite desistir) quando o disparo vai nascer em espera.
  const confirmOutsideWorkingHours = (campaign) => {
    if (!campaign || !isOutsideWorkingHours(campaign)) return true;
    const wh = campaign.schedule?.workingHours;
    const start = wh?.start || settings.campaigns?.workingHoursStart || '07:00';
    const end = wh?.end || settings.campaigns?.workingHoursEnd || '18:00';
    return confirm(
      `Agora está fora da janela de disparo (${start}–${end}).\n\n` +
        `A campanha vai ficar aguardando e só envia a partir de ${start}. ` +
        'Para disparar a qualquer hora, desligue "Só disparar em horário comercial" em Configurações.\n\n' +
        'Continuar?',
    );
  };

  const handleStartCampaign = async (id, { forceNow = false } = {}) => {
    if (!window.campaignAPI) return;
    const campaign = campaigns.find((item) => item.id === id);
    const confirmRecovery = campaign?.status === 'interrupted';
    if (!confirmOutsideWorkingHours(campaign)) return;
    if (confirmRecovery && !confirm('Esta campanha foi interrompida ao fechar/reiniciar o app. Confirmar retomada manual?')) {
      return;
    }
    if (forceNow && campaign?.schedule?.startAt) {
      const when = new Date(campaign.schedule.startAt).toLocaleString('pt-BR');
      if (!confirm(`Disparar agora? O agendamento (${when}) será ignorado.`)) return;
    }
    // O número da campanha tem prioridade: o ativo na tela só é usado quando a
    // campanha ainda não tem um definido (evita disparar pelo número errado).
    const connId =
      campaign?.connectionId ||
      activeConnectionId ||
      campaignConnectionId ||
      connectedSessions[0]?.id ||
      null;
    try {
      const res = await window.campaignAPI.start(id, connId, confirmRecovery, forceNow);
      if (res && res.success === false) {
        alert('Não foi possível iniciar: ' + (res.error || 'erro desconhecido'));
        addLog(`[CAMPAIGN] Falha ao iniciar: ${res.error || 'erro'}`);
        return;
      }
      loadCampaigns();
      window.dispatchEvent(new CustomEvent('sigma:campaign-started', { detail: { campaignId: id } }));
      addLog(
        `[CAMPAIGN] Campanha ${forceNow ? 'disparada agora' : 'iniciada'}` +
          (res?.connectionId ? ` no ${res.connectionId}` : '') +
          `. Acompanhe em Monitorar.`,
      );
    } catch (e) {
      console.error(e);
      alert('Erro ao iniciar campanha: ' + (e.message || e));
      addLog(`[CAMPAIGN] Erro: ${e.message || e}`);
    }
  };

  const handlePauseCampaign = async (id) => {
    if (!window.campaignAPI) return;
    try {
      await window.campaignAPI.pause(id);
      loadCampaigns();
      addLog(`[CAMPAIGN] Campanha pausada.`);
    } catch (e) {
      console.error(e);
    }
  };

  const handleRetryFailed = async (id) => {
    if (!window.campaignAPI?.retryFailed) return;
    const campaign = campaigns.find((item) => item.id === id);
    const connId =
      campaign?.connectionId ||
      activeConnectionId ||
      campaignConnectionId ||
      connectedSessions[0]?.id ||
      null;
    try {
      const res = await window.campaignAPI.retryFailed(id, connId);
      if (res && res.success === false) {
        alert('Não foi possível reenviar: ' + (res.error || 'erro desconhecido'));
        return;
      }
      const count = res?.count || 0;
      loadCampaigns();
      addLog(
        count > 0
          ? `[CAMPAIGN] ${count} falha(s) voltaram para a fila de envio.`
          : '[CAMPAIGN] Nenhuma falha para reenviar.',
      );
    } catch (e) {
      console.error(e);
      alert('Erro ao reenviar falhas: ' + (e.message || e));
    }
  };

  const handleResumeCampaign = async (id) => {
    if (!window.campaignAPI) return;
    const campaign = campaigns.find((item) => item.id === id);
    if (!confirmOutsideWorkingHours(campaign)) return;
    const connId =
      campaign?.connectionId ||
      activeConnectionId ||
      campaignConnectionId ||
      connectedSessions[0]?.id ||
      null;
    try {
      const res = await window.campaignAPI.resume(id, connId);
      if (res && res.success === false) {
        alert('Não foi possível retomar: ' + (res.error || 'erro desconhecido'));
        return;
      }
      loadCampaigns();
      addLog(`[CAMPAIGN] Campanha retomada.`);
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteCampaign = async (id) => {
    if (!window.campaignAPI) return;
    if (confirm("Deseja apagar esta campanha permanentemente?")) {
      try {
        await window.campaignAPI.delete(id);
        loadCampaigns();
        addLog(`[CAMPAIGN] Campanha apagada.`);
      } catch (e) {
        console.error(e);
      }
    }
  };

  const handleMonitorCampaign = async (id) => {
    if (!window.campaignAPI) return;
    try {
      const res = await window.campaignAPI.get(id);
      if (res && res.campaign) {
        setMonitoringCampaign(res.campaign);
        setMonitoringCampaignId(id);
        setWaTab('monitor');
      }
    } catch (e) {
      console.error(e);
    }
  };

  // ─── Media presence + message rendering helpers ───

  const bytesToBase64 = (input) => {
    if (!input) return null;
    if (typeof input === 'string') return input;
    // Node Buffer JSON shape
    if (input.type === 'Buffer' && Array.isArray(input.data)) {
      input = input.data;
    }
    try {
      const arr = input instanceof Uint8Array
        ? input
        : Array.isArray(input)
          ? new Uint8Array(input)
          : null;
      if (!arr || !arr.length) return null;
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < arr.length; i += chunk) {
        binary += String.fromCharCode.apply(null, arr.subarray(i, i + chunk));
      }
      return btoa(binary);
    } catch (e) {
      return null;
    }
  };

  const thumbnailToDataUrl = (thumb, mime = 'image/jpeg') => {
    if (!thumb) return null;
    if (typeof thumb === 'string') {
      if (thumb.startsWith('data:')) return thumb;
      return `data:${mime};base64,${thumb}`;
    }
    const b64 = bytesToBase64(thumb);
    return b64 ? `data:${mime};base64,${b64}` : null;
  };

  const getUnread = (chat) => Number(chat?.unread || chat?.unreadCount || 0);

  const formatChatTime = (ts) => {
    const n = Number(ts || 0);
    if (!n) return '';
    const ms = n > 1e12 ? n : n * 1000;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Ontem';
    return d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
  };

  const formatMessageTime = (ts) => {
    const n = Number(ts || 0);
    if (!n) return '';
    const ms = n > 1e12 ? n : n * 1000;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatBytes = (n) => {
    const v = Number(n || 0);
    if (!v) return '';
    if (v < 1024) return `${v} B`;
    if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`;
    return `${(v / 1024 / 1024).toFixed(1)} MB`;
  };

  const formatAudioSeconds = (s) => {
    const v = Number(s);
    if (!Number.isFinite(v) || v < 0) return '0:00';
    if (!v) return '0:00';
    const m = Math.floor(v / 60);
    const sec = Math.floor(v % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  // Unwrap ephemeral / viewOnce / edited wrappers from Baileys payloads
  const unwrapMessage = (msg) => {
    if (!msg || typeof msg !== 'object') return msg || {};
    const inner =
      msg.ephemeralMessage?.message ||
      msg.viewOnceMessage?.message ||
      msg.viewOnceMessageV2?.message ||
      msg.viewOnceMessageV2Extension?.message ||
      msg.documentWithCaptionMessage?.message ||
      msg.editedMessage?.message ||
      null;
    return inner ? unwrapMessage(inner) : msg;
  };

  // Extrai mídia de uma mensagem do Baileys para o render
  const extractMedia = (raw) => {
    const msg = unwrapMessage(raw);
    if (!msg) return null;
    if (msg.imageMessage) {
      return {
        kind: 'image',
        caption: msg.imageMessage.caption || '',
        mimetype: msg.imageMessage.mimetype || 'image/jpeg',
        thumbnail: thumbnailToDataUrl(msg.imageMessage.jpegThumbnail),
        width: msg.imageMessage.width,
        height: msg.imageMessage.height,
      };
    }
    if (msg.videoMessage) {
      return {
        kind: 'video',
        caption: msg.videoMessage.caption || '',
        mimetype: msg.videoMessage.mimetype || 'video/mp4',
        thumbnail: thumbnailToDataUrl(msg.videoMessage.jpegThumbnail),
        seconds: msg.videoMessage.seconds,
      };
    }
    if (msg.audioMessage) {
      return {
        kind: 'audio',
        mimetype: msg.audioMessage.mimetype || 'audio/ogg',
        ptt: !!msg.audioMessage.ptt,
        seconds: msg.audioMessage.seconds,
      };
    }
    if (msg.documentMessage) {
      return {
        kind: 'document',
        fileName: msg.documentMessage.fileName || 'documento',
        mimetype: msg.documentMessage.mimetype || 'application/octet-stream',
        thumbnail: thumbnailToDataUrl(msg.documentMessage.jpegThumbnail),
        pageCount: msg.documentMessage.pageCount,
        fileSize: msg.documentMessage.fileLength,
        title: msg.documentMessage.title || '',
      };
    }
    if (msg.stickerMessage) {
      return {
        kind: 'sticker',
        mimetype: msg.stickerMessage.mimetype || 'image/webp',
        thumbnail: thumbnailToDataUrl(msg.stickerMessage.jpegThumbnail, 'image/webp'),
        isAnimated: !!msg.stickerMessage.isAnimated,
      };
    }
    return null;
  };

  const extractText = (raw) => {
    const msg = unwrapMessage(raw);
    if (!msg) return '';
    return (
      msg.conversation ||
      msg.extendedTextMessage?.text ||
      msg.imageMessage?.caption ||
      msg.videoMessage?.caption ||
      msg.documentMessage?.caption ||
      ''
    );
  };

  // Built-in WhatsApp link preview fields on extendedTextMessage
  const extractEmbeddedLinkPreview = (raw) => {
    const msg = unwrapMessage(raw);
    const ext = msg?.extendedTextMessage;
    if (!ext) return null;
    const url = ext.canonicalUrl || ext.matchedText || null;
    if (!url && !ext.title && !ext.description) return null;
    if (!url && !ext.title) return null;
    return {
      url: url || '',
      title: ext.title || url || '',
      description: ext.description || '',
      thumbnail: thumbnailToDataUrl(ext.jpegThumbnail),
      siteName: (() => {
        try {
          return url ? new URL(url).hostname.replace(/^www\./, '') : '';
        } catch (e) {
          return '';
        }
      })(),
    };
  };

  const extractQuoted = (raw) => {
    const msg = unwrapMessage(raw);
    const ctx = msg?.extendedTextMessage?.contextInfo
      || msg?.imageMessage?.contextInfo
      || msg?.videoMessage?.contextInfo
      || msg?.documentMessage?.contextInfo
      || msg?.audioMessage?.contextInfo
      || msg?.stickerMessage?.contextInfo
      || null;
    if (!ctx?.quotedMessage) return null;
    const q = unwrapMessage(ctx.quotedMessage);
    const text = extractText(q) || (
      q.stickerMessage ? 'Figurinha'
        : q.imageMessage ? 'Foto'
          : q.videoMessage ? 'Vídeo'
            : q.audioMessage ? 'Áudio'
              : q.documentMessage ? (q.documentMessage.fileName || 'Documento')
                : ''
    );
    return {
      participant: ctx.participant || '',
      text: text.slice(0, 160),
    };
  };

  const extractUrls = (text) => {
    if (!text) return [];
    const re = /https?:\/\/[^\s<>"')\]]+/gi;
    return [...new Set((text.match(re) || []).map((u) => u.replace(/[.,;:!?)]+$/, '')))];
  };

  // WhatsApp-style formatting: *bold* _italic_ ~strike~ ```mono```
  const formatWhatsAppText = (raw) => {
    if (!raw) return null;
    const escapeHtml = (s) =>
      String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    let html = escapeHtml(raw);
    // Code blocks first
    html = html.replace(/```([\s\S]*?)```/g, (_, code) => `<code class="wa-code-block">${code}</code>`);
    html = html.replace(/`([^`\n]+)`/g, (_, code) => `<code class="wa-code">${code}</code>`);
    html = html.replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>');
    html = html.replace(/_([^_\n]+)_/g, '<em>$1</em>');
    html = html.replace(/~([^~\n]+)~/g, '<s>$1</s>');
    // Links
    html = html.replace(
      /(https?:\/\/[^\s<]+)/g,
      (url) => {
        const clean = url.replace(/[.,;:!?)]+$/, '');
        const trail = url.slice(clean.length);
        return `<a class="wa-link" href="${clean}" target="_blank" rel="noreferrer noopener">${clean}</a>${trail}`;
      },
    );
    // Protege números escritos no corpo da conversa durante lives.
    html = html.split(/(<[^>]+>)/g).map((part) => {
      if (part.startsWith('<')) return part;
      return part.replace(/(?:\+?\d[\d\s().-]{8,}\d)/g, (candidate) => (
        candidate.replace(/\D/g, '').length >= 10
          ? `<span data-sensitive-phone="true">${candidate}</span>`
          : candidate
      ));
    }).join('');
    html = html.replace(/\n/g, '<br/>');
    return html;
  };

  const chatCounts = useMemo(() => {
    const unread = chats.filter((c) => getUnread(c) > 0).length;
    const groups = chats.filter((c) => c.isGroup).length;
    const favorites = chats.filter((c) => c.pinned || c.favorite).length;
    return {
      all: chats.length,
      unread,
      groups,
      favorites,
      archived: archivedChats.length,
    };
  }, [chats, archivedChats]);

  const filteredChats = useMemo(() => {
    const source = chatFilter === 'archived' ? archivedChats : chats;
    let list = source;
    if (chatFilter === 'unread') list = source.filter((c) => getUnread(c) > 0);
    if (chatFilter === 'groups') list = source.filter((c) => c.isGroup);
    if (chatFilter === 'favorites') list = source.filter((c) => c.pinned || c.favorite);
    const q = chatSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((c) => {
        const name = (c.name || '').toLowerCase();
        const phone = (c.phone || '').toLowerCase();
        const jid = (c.jid || '').toLowerCase();
        const last = (c.lastMessage || '').toLowerCase();
        return name.includes(q) || phone.includes(q) || jid.includes(q) || last.includes(q);
      });
    }
    return list;
  }, [chats, archivedChats, chatFilter, chatSearch]);

  const newChatCandidates = useMemo(() => {
    let storedLeads = [];
    try {
      const parsed = JSON.parse(localStorage.getItem('sigma_leads') || '[]');
      storedLeads = Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      storedLeads = [];
    }

    const seen = new Set();
    const candidates = [];
    const append = (item) => {
      if (!item || item.isGroup || String(item.jid || '').endsWith('@g.us')) return;
      const rawPhone = String(item.phone || item.phoneNumber || item.number || item.jid || '');
      const phone = rawPhone.includes('@') ? rawPhone.replace(/@.*$/, '') : rawPhone;
      const digits = phone.replace(/\D/g, '');
      const jid = item.jid || (digits ? `${digits}@s.whatsapp.net` : '');
      const key = digits || jid;
      if (!key || seen.has(key)) return;
      seen.add(key);
      candidates.push({
        ...item,
        jid,
        phone: digits || phone,
        phoneJid: item.phoneJid || jid,
        name: item.name || item.company || item.pushName || phone || 'Contato',
      });
    };

    chats.forEach(append);
    waContacts.forEach(append);
    scrapeLeadPool.forEach(append);
    storedLeads.forEach(append);

    const query = newChatSearch.trim().toLowerCase();
    const filtered = candidates
      .filter((item) => !query || `${item.name} ${item.phone} ${item.jid}`.toLowerCase().includes(query))
      .slice(0, 100);

    // Permite iniciar conversa com um número que ainda não existe na agenda,
    // sem exigir importação/sincronização prévia. O backend normaliza o país
    // quando o candidato não traz um JID pronto.
    const manualDigits = newChatSearch.replace(/\D/g, '');
    if (manualDigits.length >= 10 && !candidates.some((item) => item.phone.replace(/\D/g, '') === manualDigits)) {
      filtered.unshift({
        leadId: `manual_${manualDigits}`,
        name: 'Número informado',
        phone: newChatSearch.trim(),
        jid: '',
        phoneJid: '',
        isManual: true,
      });
    }
    return filtered.slice(0, 100);
  }, [chats, waContacts, scrapeLeadPool, newChatSearch]);

  const openNewChat = () => {
    setNewChatSearch('');
    setNewChatError('');
    setIsNewChatOpen(true);
    loadWaDirectory(activeConnectionId).catch(() => {});
  };

  useEffect(() => {
    let pending = null;
    try {
      pending = JSON.parse(localStorage.getItem('sigma_wa_pending') || 'null');
      if (pending) localStorage.removeItem('sigma_wa_pending');
    } catch {}
    if (!pending?.tel) return;
    if (pending.direct) {
      setDirectChatPending(pending);
      return;
    }
    setNewChatSearch(String(pending.tel));
    setNewChatError('');
    setIsNewChatOpen(true);
    loadWaDirectory(activeConnectionId).catch(() => {});
  }, [activeConnectionId]);

  useEffect(() => {
    if (!directChatPending?.tel || !window.chatAPI?.startChat || newChatBusy) return undefined;
    let cancelled = false;
    const open = async () => {
      setNewChatBusy(true);
      setNewChatError('');
      try {
        const result = await window.chatAPI.startChat(directChatPending.tel, directChatPending.name || 'Lead');
        if (!result?.success || !result.jid) throw new Error(result?.error || 'Não foi possível abrir esta conversa.');
        const nextChat = {
          name: result.name || directChatPending.name || directChatPending.tel,
          phone: result.phone || directChatPending.tel,
          jid: result.jid,
          phoneJid: result.jid,
          lastMessage: '',
        };
        setChats((current) => current.some((chat) => chat.jid === nextChat.jid) ? current : [nextChat, ...current]);
        if (!cancelled) await handleSelectChat(nextChat);
      } catch (error) {
        if (!cancelled) {
          setNewChatSearch(String(directChatPending.tel));
          setNewChatError(error?.message || 'Não foi possível abrir esta conversa.');
          setIsNewChatOpen(true);
        }
      } finally {
        if (!cancelled) {
          setDirectChatPending(null);
          setNewChatBusy(false);
        }
      }
    };
    open();
    return () => { cancelled = true; };
  }, [directChatPending]);

  const handleStartNewChat = async (candidate) => {
    if (!window.chatAPI?.startChat || newChatBusy) return;
    setNewChatBusy(true);
    setNewChatError('');
    try {
      const result = await window.chatAPI.startChat(candidate.jid || candidate.phone, candidate.name);
      if (!result?.success || !result.jid) {
        setNewChatError(result?.error || 'Não foi possível abrir esta conversa.');
        return;
      }
      const nextChat = {
        ...candidate,
        jid: result.jid,
        phone: result.phone || candidate.phone,
        phoneJid: result.jid,
        name: result.name || candidate.name,
        lastMessage: candidate.lastMessage || '',
      };
      setChats((current) => current.some((chat) => chat.jid === nextChat.jid) ? current : [nextChat, ...current]);
      setIsNewChatOpen(false);
      await handleSelectChat(nextChat);
    } catch (error) {
      setNewChatError(error?.message || 'Não foi possível abrir esta conversa.');
    } finally {
      setNewChatBusy(false);
    }
  };

  const forwardCandidates = useMemo(() => {
    const query = forwardSearch.trim().toLowerCase();
    return chats.filter((chat) => !query || `${chat.name || ''} ${chat.phone || ''} ${chat.jid || ''}`.toLowerCase().includes(query));
  }, [chats, forwardSearch]);

  const handleForwardMessage = async (candidate) => {
    if (!forwardMessage || !window.chatAPI?.sendMessage || forwardBusy) return;
    const text = extractText(unwrapMessage(forwardMessage.message || {})) || forwardMessage.text || '';
    if (!text) {
      setForwardError('Este tipo de mensagem ainda não pode ser encaminhado.');
      return;
    }
    setForwardBusy(true);
    setForwardError('');
    try {
      const result = await window.chatAPI.sendMessage(candidate.phoneJid || candidate.jid, { text }, activeConnectionId);
      if (result?.success === false) throw new Error(result.error || 'Falha ao encaminhar.');
      setForwardMessage(null);
      addLog(`[WHATSAPP] Mensagem encaminhada para ${candidate.name || candidate.phone}.`);
    } catch (error) {
      setForwardError(error?.message || 'Falha ao encaminhar.');
    } finally {
      setForwardBusy(false);
    }
  };

  // Lazy-load profile pics for visible chat list
  useEffect(() => {
    const slice = filteredChats.slice(0, 40);
    for (const c of slice) {
      if (c.jid && !profilePics[c.jid]) ensureProfilePic(c.jid);
    }
  }, [filteredChats, profilePics, ensureProfilePic]);

  // Auto-download media for open conversation + link previews
  useEffect(() => {
    if (!activeChatJid || !messages.length) return;
    const mediaSettings = settings.media || {};
    for (const m of messages) {
      const msg = m.message || {};
      const media = extractMedia(msg);
      const msgId = m.key?.id;
      if (media && msgId && !mediaCache[msgId] && !mediaLoadingRef.current.has(msgId)) {
        const should =
          (media.kind === 'image' && mediaSettings.autoDownloadImages !== false) ||
          (media.kind === 'sticker' && mediaSettings.autoDownloadStickers !== false) ||
          (media.kind === 'audio' && mediaSettings.autoDownloadAudio !== false) ||
          (media.kind === 'video' && mediaSettings.autoDownloadVideos) ||
          (media.kind === 'document' && (mediaSettings.autoDownloadDocuments || media.mimetype === 'application/pdf'));
        if (should) loadMessageMedia(m);
      }
      // Link previews
      if (settings.previews?.links !== false) {
        const embedded = extractEmbeddedLinkPreview(msg);
        if (embedded?.url && !linkPreviews[embedded.url]) {
          // Prefer embedded WA preview; seed cache without network
          setLinkPreviews((prev) => {
            if (prev[embedded.url]) return prev;
            return {
              ...prev,
              [embedded.url]: {
                status: 'ready',
                title: embedded.title,
                description: embedded.description,
                image: embedded.thumbnail || '',
                siteName: embedded.siteName,
                url: embedded.url,
                embedded: true,
              },
            };
          });
        } else {
          const text = extractText(msg);
          for (const url of extractUrls(text).slice(0, 2)) {
            if (!linkPreviews[url]) ensureLinkPreview(url);
          }
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, activeChatJid, settings.media, settings.previews]);

  const renderAvatar = (jid, name, size = 40, isGroup = false) => {
    const pic = profilePics[jid];
    const initials = (name || '?').trim().slice(0, 1).toUpperCase();
    if (pic) {
      return (
        <img
          src={pic}
          alt={name || ''}
          className="chat-avatar-img"
          style={{ width: size, height: size }}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      );
    }
    return (
      <div className="chat-avatar" style={{ width: size, height: size, fontSize: size * 0.4 }}>
        {isGroup ? <Users size={size * 0.45} /> : initials || <User size={size * 0.45} />}
      </div>
    );
  };

  // Renderiza o conteúdo de uma mensagem (texto + mídia) — sem bolha externa
  const renderMessageBody = (m) => {
    const msg = unwrapMessage(m.message || {});
    const text = extractText(msg);
    const media = extractMedia(msg);
    const msgId = m.key?.id;
    const cached = msgId ? mediaCache[msgId] : null;
    const quoted = extractQuoted(msg);
    const embeddedLink = extractEmbeddedLinkPreview(msg);
    const urls = extractUrls(text);
    const primaryUrl = embeddedLink?.url || urls[0];
    const preview = primaryUrl ? (linkPreviews[primaryUrl] || (embeddedLink ? {
      status: 'ready',
      title: embeddedLink.title,
      description: embeddedLink.description,
      image: embeddedLink.thumbnail,
      siteName: embeddedLink.siteName,
      url: embeddedLink.url,
    } : null)) : null;

    // Pure sticker: transparent bubble feel
    if (media?.kind === 'sticker') {
      const src = cached?.dataUrl || media.thumbnail;
      return (
        <div className="chat-sticker-wrap">
          {src ? (
            <img src={src} alt="Figurinha" className="chat-sticker" />
          ) : (
            <button type="button" className="chat-media-placeholder sticker" onClick={() => loadMessageMedia(m)}>
              <Smile size={28} />
              <span>{cached?.status === 'loading' ? 'Carregando…' : 'Toque para ver figurinha'}</span>
            </button>
          )}
          {cached?.status === 'error' && (
            <button type="button" className="chat-media-retry" onClick={() => loadMessageMedia(m)}>Tentar de novo</button>
          )}
        </div>
      );
    }

    return (
      <>
        {quoted && (
          <div className="chat-quote">
            <div className="chat-quote-bar" />
            <div className="chat-quote-body">
              {quoted.participant && (
                <span className="chat-quote-author">{quoted.participant.split('@')[0]}</span>
              )}
              <span className="chat-quote-text">{quoted.text}</span>
            </div>
          </div>
        )}

        {media?.kind === 'image' && (
          <div className="chat-media">
            {cached?.dataUrl || media.thumbnail ? (
              <img
                src={cached?.dataUrl || media.thumbnail}
                alt={media.caption || 'imagem'}
                onClick={() => {
                  if (cached?.dataUrl) setLightbox({ src: cached.dataUrl, alt: media.caption || 'imagem' });
                  else loadMessageMedia(m);
                }}
              />
            ) : (
              <button type="button" className="chat-media-placeholder" onClick={() => loadMessageMedia(m)}>
                <ImageIcon size={22} />
                <span>{cached?.status === 'loading' ? 'Baixando imagem…' : 'Toque para carregar imagem'}</span>
              </button>
            )}
            {cached?.status === 'error' && (
              <button type="button" className="chat-media-retry" onClick={() => loadMessageMedia(m)}>Tentar de novo</button>
            )}
          </div>
        )}

        {media?.kind === 'video' && (
          <div className="chat-media">
            {cached?.dataUrl ? (
              <video src={cached.dataUrl} controls playsInline className="chat-video" />
            ) : (
              <button type="button" className="chat-media-placeholder video" onClick={() => loadMessageMedia(m)}>
                {media.thumbnail ? (
                  <img src={media.thumbnail} alt="vídeo" className="chat-video-thumb" />
                ) : (
                  <Film size={22} />
                )}
                <span className="chat-video-play">▶</span>
                <span>{cached?.status === 'loading' ? 'Baixando vídeo…' : 'Toque para carregar vídeo'}</span>
              </button>
            )}
          </div>
        )}

        {media?.kind === 'audio' ? (
          <VoicePlayerBoundary key={`vb-${msgId || 'audio'}`}>
            <ChatVoicePlayer
              msgId={msgId || 'audio'}
              src={cached?.blobUrl || cached?.dataUrl || null}
              isPtt={!!media.ptt}
              secondsHint={media.seconds}
              loading={cached?.status === 'loading'}
              error={cached?.status === 'error' ? (cached.error || 'Erro') : null}
              onLoad={() => loadMessageMedia(m)}
              onRetry={() => loadMessageMedia(m)}
            />
          </VoicePlayerBoundary>
        ) : null}

        {media?.kind === 'document' && (
          <div className="chat-doc" onClick={() => handleDownloadMedia(m)} role="button" tabIndex={0}>
            {media.thumbnail ? (
              <img src={media.thumbnail} alt="" className="chat-doc-thumb" />
            ) : (
              <div className="doc-icon">
                <FileText size={18} />
              </div>
            )}
            <div className="doc-meta">
              <span className="doc-name">{media.fileName}</span>
              <span className="doc-size">
                {(media.mimetype || '').includes('pdf') ? 'PDF' : 'Documento'}
                {media.fileSize ? ` · ${formatBytes(media.fileSize)}` : ''}
                {media.pageCount ? ` · ${media.pageCount} pág` : ''}
              </span>
            </div>
            <button
              type="button"
              className="doc-download"
              title="Abrir / baixar"
              onClick={(e) => { e.stopPropagation(); handleDownloadMedia(m); }}
            >
              <Download size={14} />
            </button>
          </div>
        )}

        {preview && preview.status === 'ready' && (
          <a
            className="chat-link-preview"
            href={preview.url || primaryUrl}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(e) => e.stopPropagation()}
          >
            {preview.image ? <img src={preview.image} alt="" className="chat-link-preview-img" /> : null}
            <div className="chat-link-preview-body">
              {preview.siteName && <span className="chat-link-site">{preview.siteName}</span>}
              <strong>{preview.title || preview.url}</strong>
              {preview.description && <p>{preview.description}</p>}
            </div>
            <ExternalLink size={12} className="chat-link-ext" />
          </a>
        )}

        {text && (
          <div
            className="chat-text"
            dangerouslySetInnerHTML={{ __html: formatWhatsAppText(text) }}
          />
        )}

        {!text && !media && !preview && (
          <div className="chat-text muted">Mensagem não suportada</div>
        )}
      </>
    );
  };

  const renderMessageBubble = (m, idx) => {
    const fromMe = !!m.key?.fromMe;
    const media = extractMedia(unwrapMessage(m.message || {}));
    const isSticker = media?.kind === 'sticker';
    const status = m.status; // optional delivery status
    const msgId = m.key?.id || String(idx);
    const menuOpen = msgMenuId === msgId;
    const previewText = extractText(unwrapMessage(m.message || {})) || (media?.kind === 'audio' ? 'Áudio' : media?.kind === 'image' ? 'Imagem' : 'Mensagem');

    return (
      <div
        key={msgId}
        className={`chat-bubble-wrap ${fromMe ? 'out' : 'in'}`}
        onContextMenu={(e) => {
          e.preventDefault();
          setMsgMenuId(menuOpen ? null : msgId);
        }}
      >
        <div
          className={`chat-bubble ${fromMe ? 'out' : 'in'}${isSticker ? ' sticker-bubble' : ''}${media?.kind === 'audio' ? ' voice-bubble' : ''}${menuOpen ? ' menu-open' : ''}`}
          onClick={() => { if (menuOpen) setMsgMenuId(null); }}
        >
          {renderMessageBody(m)}
          <div className="time">
            {formatMessageTime(m.messageTimestamp)}
            {fromMe && (
              <CheckCheck
                size={12}
                className={`chat-ticks${status === 'READ' || status === 4 ? ' read' : ''}`}
              />
            )}
          </div>
        </div>
        <div className="chat-bubble-actions">
          <button
            type="button"
            className="chat-bubble-action-btn"
            title="Responder"
            onClick={() => { setReplyTo(m); setMsgMenuId(null); }}
          >
            <Reply size={13} />
          </button>
          <button
            type="button"
            className="chat-bubble-action-btn"
            title="Mais"
            onClick={() => setMsgMenuId(menuOpen ? null : msgId)}
          >
            <MoreVertical size={13} />
          </button>
          {menuOpen && (
            <div className="chat-msg-menu">
              <button type="button" onClick={() => { setReplyTo(m); setMsgMenuId(null); }}>
                <Reply size={12} /> Responder
              </button>
              {fromMe && (
                <button type="button" onClick={() => handleDeleteMessage(m, true)}>
                  <Trash2 size={12} /> Apagar para todos
                </button>
              )}
              <button type="button" onClick={() => handleDeleteMessage(m, false)}>
                <Trash2 size={12} /> Apagar para mim
              </button>
              <button type="button" onClick={() => { setForwardSearch(''); setForwardError(''); setForwardMessage(m); setMsgMenuId(null); }}>
                ↗ Encaminhar
              </button>
              <div className="chat-msg-menu-preview">{previewText.slice(0, 48)}</div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="wa-open-design" onClick={() => setChatContextMenu(null)}>
      <header className="wa-top wa-open-design-top" data-od-id="wa-header">
        <nav className="wa-tabs wa-open-design-tabs" role="tablist" aria-label="WhatsApp" data-od-id="wa-tabs">
          <button
            type="button"
            role="tab"
            id="waTabConv"
            aria-selected={waTab === 'chats' || waTab === 'campaigns'}
            className={waTab === 'chats' || waTab === 'campaigns' ? 'active' : ''}
            data-od-id="wa-tab-conversas"
            onClick={() => setWaTab('chats')}
          >
            <MessageSquare size={14} /> Conversas
          </button>
        </nav>
        <div className="wa-top-actions wa-open-design-actions">
          <div className="wa-menuwrap" style={{ position: 'relative' }}>
            <button
              type="button"
              className={`wa-acctbtn ${waStatus === 'connected' ? '' : 'off'}`}
              id="waAcctBtn"
              aria-haspopup="true"
              aria-expanded={isAcctMenuOpen}
              data-od-id="wa-account-selector"
              title="Alternar número conectado"
              onClick={() => setIsAcctMenuOpen((v) => !v)}
            >
              <span className="dot" id="waAcctDot" aria-hidden="true" />
              <span id="waConnTxt">
                <span data-sensitive-phone="true">{connections.find((c) => c.id === activeConnectionId)?.phoneNumber || connections[0]?.phoneNumber || '+55 21 90000-0001'}</span>
              </span>
              <span className="caret" aria-hidden="true">▾</span>
            </button>
            {isAcctMenuOpen && (
              <div
                className="wa-menu"
                id="waAcctMenu"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  left: 0,
                  zIndex: 100,
                  background: '#fff',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: 4,
                  minWidth: 200,
                  boxShadow: 'var(--elev-raised)'
                }}
              >
                {connections.map((connection) => (
                  <button
                    key={connection.id}
                    type="button"
                    className="btn btn-sm btn-ghost"
                    style={{ width: '100%', justifyContent: 'flex-start', padding: '8px 12px' }}
                    onClick={() => {
                      handleSwitchConnection(connection.id);
                      setIsAcctMenuOpen(false);
                    }}
                  >
                    <span data-sensitive-phone="true">{connection.phoneNumber || connection.id}</span>
                  </button>
                ))}
                {connections.length > 0 && <div className="wa-menu-sep" />}
                <button type="button" onClick={openQrModal}>+ Adicionar WhatsApp</button>
                <button type="button" onClick={() => { setIsConnectionsModalOpen(true); setIsAcctMenuOpen(false); }}>Gerenciar conexões</button>
              </div>
            )}
          </div>

          <div className="wa-menuwrap" style={{ position: 'relative' }}>
            <button
              type="button"
              className="wa-connbtn"
              id="waConnBtn"
              aria-haspopup="true"
              aria-expanded={isConnMenuOpen}
              data-od-id="wa-session-menu"
              onClick={() => setIsConnMenuOpen((v) => !v)}
            >
              Sessão
            </button>
            {isConnMenuOpen && (
              <div
                className="wa-menu"
                id="waConnMenu"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  left: 0,
                  zIndex: 100,
                  background: '#fff',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: 4,
                  minWidth: 180,
                  boxShadow: 'var(--elev-raised)'
                }}
              >
                <button
                  type="button"
                  id="waReconnect"
                  className="btn btn-sm btn-ghost"
                  style={{ width: '100%', justifyContent: 'flex-start', padding: '8px 12px' }}
                  onClick={() => {
                    openQrModal();
                  }}
                >
                  Trocar número (QR)
                </button>
                <button
                  type="button"
                  id="waDisconnect"
                  className="btn btn-sm btn-ghost danger"
                  style={{ width: '100%', justifyContent: 'flex-start', padding: '8px 12px', color: 'var(--danger)' }}
                  onClick={() => {
                    handleDisconnect();
                    setIsConnMenuOpen(false);
                  }}
                >
                  Desconectar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const activePhone = connections.find((connection) => connection.id === activeConnectionId)?.phoneNumber || '';
                    setSessionProfile((profile) => ({ ...profile, phone: profile.phone || activePhone }));
                    setIsSessionProfileOpen(true);
                    setIsConnMenuOpen(false);
                  }}
                >
                  Meu perfil
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setWaTab('settings');
                    setIsConnMenuOpen(false);
                  }}
                >
                  Configurações
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setWaTab('chats');
                    setShowTriggersModal(true);
                    setIsConnMenuOpen(false);
                  }}
                >
                  Gerenciar gatilhos
                </button>
              </div>
            )}
          </div>
          <span className="wa-sigma-sep wa-sigma-separator" aria-hidden="true" />
          <span className="wa-sigma-tag wa-sigma-label" aria-hidden="true">Sigma</span>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            id="waSigmaCamps"
            data-od-id="wa-sigma-campaigns"
            onClick={() => setWaTab('campaigns')}
          >
            Campanhas {campaigns.length > 0 && <b id="waCampCount" style={{ marginLeft: 4 }}>{campaigns.length}</b>}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            id="waNewCamp"
            data-od-id="wa-new-campaign"
            onClick={openCreateCampaign}
          >
            + Nova campanha
          </button>
        </div>
      </header>

      {isNewChatOpen && (
        <div
          className="overlay on"
          id="chatOv"
          data-od-id="modal-nova-conversa"
          onClick={() => setIsNewChatOpen(false)}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="chatTitle"
            style={{ maxWidth: 440 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div className="eyebrow">Nova conversa</div>
              <h2 id="chatTitle">Escolher contato</h2>
            </div>
            <div className="modal-body" style={{ gridTemplateColumns: '1fr' }}>
              <div className="field">
                <label htmlFor="chatSearch">Buscar lead com telefone</label>
                <input
                  id="chatSearch"
                  placeholder="Nome ou telefone…"
                  autoComplete="off"
                  value={newChatSearch}
                  onChange={(event) => setNewChatSearch(event.target.value)}
                  autoFocus
                />
              </div>
              <div className="wa-newchat" id="chatList" role="listbox" aria-label="Contatos">
                {newChatCandidates.length === 0 ? (
                  <div className="empty">
                    <b>Nenhum contato encontrado</b>
                    <span>Importe leads com telefone ou sincronize o WhatsApp.</span>
                  </div>
                ) : newChatCandidates.map((candidate) => (
                  <button
                    key={candidate.jid || candidate.phone}
                    type="button"
                    role="option"
                    disabled={newChatBusy}
                    onClick={() => handleStartNewChat(candidate)}
                  >
                    {renderAvatar(candidate.jid, candidate.name, 40, false)}
                    <span style={{ minWidth: 0 }}>
                      <b>{candidate.name}</b>
                      <span data-sensitive-phone="true">{candidate.phone || candidate.jid}</span>
                    </span>
                  </button>
                ))}
              </div>
              {newChatError && <div className="field-err" style={{ display: 'block' }}>{newChatError}</div>}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setIsNewChatOpen(false)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {isQrModalOpen && (
        <div className="overlay on" id="qrOv" data-od-id="modal-qr" onClick={() => setIsQrModalOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="qrTitle" style={{ maxWidth: 360 }} onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div className="eyebrow">Parear sessão</div>
              <h2 id="qrTitle">Ler com o celular</h2>
            </div>
            <div className="modal-body" style={{ gridTemplateColumns: '1fr' }}>
              <div className="wa-qr" aria-hidden={!qrCodeUrl}>
                {qrCodeUrl ? (
                  <img src={qrCodeUrl} alt="QR Code do WhatsApp" />
                ) : DEMO_QR_CELLS.map((isOn, index) => (
                  <i key={index} className={isOn ? 'on' : ''} />
                ))}
              </div>
              <p className="wa-hint" style={{ textAlign: 'center' }}>
                Abra o WhatsApp no celular › Aparelhos conectados › Conectar aparelho.
                {connectFlowStatus === 'connecting' ? ' Preparando QR…' : ''}
              </p>
              {qrError && <div className="field-err" role="alert" style={{ display: 'block', textAlign: 'center' }}>{qrError}</div>}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setIsQrModalOpen(false)}>Cancelar</button>
              <span style={{ flex: 1 }} />
              <button type="button" className="btn btn-primary" onClick={handleConnect}>Atualizar QR</button>
            </div>
          </div>
        </div>
      )}

      {isSessionProfileOpen && (
        <div className="overlay on" id="profileOv" data-od-id="modal-perfil" onClick={() => setIsSessionProfileOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="profileTitle" style={{ maxWidth: 440 }} onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div className="eyebrow">Sessão</div>
              <h2 id="profileTitle">Meu perfil</h2>
            </div>
            <div className="modal-body" style={{ gridTemplateColumns: '1fr' }}>
              <div className="field"><label htmlFor="profileName">Nome</label><input id="profileName" value={sessionProfile.name} onChange={(event) => setSessionProfile((profile) => ({ ...profile, name: event.target.value }))} /></div>
              <div className="field"><label htmlFor="profileAbout">Recado</label><input id="profileAbout" value={sessionProfile.about} onChange={(event) => setSessionProfile((profile) => ({ ...profile, about: event.target.value }))} /></div>
              <div className="field"><label htmlFor="profilePhone">Telefone</label><input id="profilePhone" data-sensitive-phone="true" value={sessionProfile.phone} onChange={(event) => setSessionProfile((profile) => ({ ...profile, phone: event.target.value }))} /></div>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setIsSessionProfileOpen(false)}>Cancelar</button>
              <button type="button" className="btn btn-primary" onClick={saveSessionProfile}>Salvar</button>
            </div>
          </div>
        </div>
      )}

      {isConnectionsModalOpen && (
        <div className="overlay on" id="connOv" data-od-id="modal-conexoes" onClick={() => setIsConnectionsModalOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="connTitle" style={{ maxWidth: 440 }} onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div className="eyebrow">Sessões</div>
              <h2 id="connTitle">Conexões WhatsApp</h2>
              <p title="Esta conexão utiliza Baileys para comunicação com o WhatsApp.">Conexão via Baileys</p>
            </div>
            <div className="modal-body" style={{ gridTemplateColumns: '1fr' }}>
              <div className="connection-modal-list">
                {connections.length === 0 ? (
                  <div className="empty"><b>Nenhuma conexão</b><span>Adicione um WhatsApp para começar.</span></div>
                ) : connections.map((connection) => (
                  <div key={connection.id} className={`acct-row ${connection.status === 'connected' ? '' : 'off'}`}>
                    <span className="dot" aria-hidden="true" />
                    <b data-sensitive-phone="true">{connection.phoneNumber || connection.id}{connection.id === activeConnectionId ? ' · ativo' : ''}</b>
                    {connection.id !== activeConnectionId && <button type="button" onClick={() => handleSwitchConnection(connection.id)}>Ativar</button>}
                    <button type="button" onClick={() => handleRemoveConnection(connection.id)}>Remover</button>
                  </div>
                ))}
              </div>
              <button type="button" className="btn btn-sm" onClick={() => { setIsConnectionsModalOpen(false); openQrModal(); }}>+ Adicionar WhatsApp</button>
            </div>
            <div className="modal-foot"><button type="button" className="btn btn-ghost" onClick={() => setIsConnectionsModalOpen(false)}>Fechar</button></div>
          </div>
        </div>
      )}

      {forwardMessage && (
        <div className="overlay on" id="fwdOv" data-od-id="modal-encaminhar" onClick={() => setForwardMessage(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="fwdTitle" style={{ maxWidth: 440 }} onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div className="eyebrow">Encaminhar</div>
              <h2 id="fwdTitle">Escolher destino</h2>
            </div>
            <div className="modal-body" style={{ gridTemplateColumns: '1fr' }}>
              <div className="field"><label htmlFor="fwdSearch">Buscar conversa</label><input id="fwdSearch" placeholder="Nome ou telefone…" value={forwardSearch} onChange={(event) => setForwardSearch(event.target.value)} autoFocus /></div>
              <div className="wa-newchat" role="listbox" aria-label="Conversas">
                {forwardCandidates.length === 0 ? (
                  <div className="empty"><b>Nada por aqui</b><span>Nenhuma conversa encontrada.</span></div>
                ) : forwardCandidates.map((candidate) => (
                  <button key={candidate.jid} type="button" role="option" disabled={forwardBusy} onClick={() => handleForwardMessage(candidate)}>
                    {renderAvatar(candidate.jid, candidate.name || candidate.phone, 40, !!candidate.isGroup)}
                    <span style={{ minWidth: 0 }}><b>{candidate.name || candidate.phone}</b><span data-sensitive-phone="true">{candidate.phone || candidate.jid}</span></span>
                  </button>
                ))}
              </div>
              {forwardError && <div className="field-err" style={{ display: 'block' }}>{forwardError}</div>}
            </div>
            <div className="modal-foot"><button type="button" className="btn btn-ghost" onClick={() => setForwardMessage(null)}>Cancelar</button></div>
          </div>
        </div>
      )}

      {/* Main Panel Content */}
      <div className="wa-open-design-body">
        
        {/* CONNECTION TAB */}
        {waTab === 'connect' && (
          <div style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div className="wa-card" style={{ padding: 'var(--space-4)' }}>
              <h3>Provedor de WhatsApp</h3>
              <p style={{ color: 'var(--muted)', fontSize: '13px', margin: '4px 0 12px 0' }}>
                Escolha como conectar. Baileys usa o WhatsApp Web no computador (sem mensalidade).
              </p>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                <select value={providerType} onChange={(e) => setProviderType(e.target.value)} style={{ padding: '6px' }}>
                  <option value="baileys">Baileys (WhatsApp Web / QR Code)</option>
                  <option value="meta">API oficial da Meta (Cloud)</option>
                </select>
                <button className="btn btn-primary" onClick={handleConnect}>
                  <PlusCircle size={14} /> Adicionar novo número
                </button>
                {activeConnectionId && (
                  <button className="btn btn-secondary" onClick={handleDisconnect}>
                    Desconectar número ativo
                  </button>
                )}
                {waStatus === 'connected' && (
                  <button className="btn btn-secondary" onClick={handleForceResync}>Forçar Sincronização</button>
                )}
              </div>
              <p style={{ color: 'var(--muted)', fontSize: '12px', margin: '10px 0 0 0' }}>
                Clique em <strong>Adicionar novo número</strong> para abrir uma nova sessão e conectar outro WhatsApp sem perder os números já salvos.
              </p>
            </div>

            {/* QR Code Container — usa connectFlowStatus (local), não o agregado global */}
            {(connectFlowStatus === 'connecting' || connectFlowStatus === 'qr_ready') && (
              <div className="wa-card" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '260px' }}>
                {connectFlowStatus === 'connecting' && !qrCodeUrl && (
                  <div className="sp" style={{ marginBottom: '16px' }}></div>
                )}
                {qrCodeUrl ? (
                  <>
                    <p style={{ fontSize: '13px', color: 'var(--fg-2)', marginBottom: '12px' }}>
                      Escaneie o QR Code com o WhatsApp do seu celular
                      {pendingConnectionId ? (
                        <span style={{ color: 'var(--muted)' }}> · sessão {pendingConnectionId}</span>
                      ) : null}
                      :
                    </p>
                    <img src={qrCodeUrl} alt="WhatsApp QR Code" style={{ border: '8px solid white', borderRadius: '8px', width: '220px', height: '220px' }} />
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ marginTop: 12, fontSize: 12 }}
                      onClick={() => {
                        setConnectFlowStatus(null);
                        setQrCodeUrl(null);
                        pendingConnectionIdRef.current = null;
                        setPendingConnectionId(null);
                      }}
                    >
                      Ocultar QR
                    </button>
                  </>
                ) : (
                  <p style={{ fontSize: '13px', color: 'var(--muted)' }}>Iniciando serviço do WhatsApp...</p>
                )}
              </div>
            )}

            {/* Session Connections list */}
            <div className="wa-card" style={{ padding: 'var(--space-4)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3>Números conectados</h3>
                {connections.length > 0 && (
                  <span className="wa-provider-hint">
                    {connections.length} número{connections.length > 1 ? 's' : ''} · campanhas rodam em segundo plano de forma independente
                  </span>
                )}
              </div>
              {connections.length === 0 ? (
                <p style={{ color: 'var(--muted)', fontSize: '13px' }}>Nenhuma sessão de WhatsApp salva ainda.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {connections.map((c) => {
                    const isActive = c.active || c.id === activeConnectionId;
                    const connected = c.status === 'connected';
                    return (
                    <div key={c.id} className={`wa-session-row ${isActive ? 'wa-session-active' : ''}`}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span className={`wa-presence-dot ${connected ? 'on' : 'off'}`} title={connected ? 'Conectado' : 'Desconectado'} />
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <strong style={{ fontSize: '13px' }} data-sensitive-phone="true">{c.phoneNumber || c.id}</strong>
                            {isActive && <span className="wa-active-badge">Ativo</span>}
                            {connected && <span className="wa-connected-badge">Conectado</span>}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                            {c.provider} {c.id !== c.phoneNumber ? `• ${c.id}` : ''}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        {!isActive && (
                          <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '11px' }} onClick={() => handleSwitchConnection(c.id)}>Ativar</button>
                        )}
                        <button className="btn btn-danger" style={{ padding: '4px 10px', fontSize: '11px' }} onClick={() => handleRemoveConnection(c.id)}>Remover</button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* CAMPAIGNS TAB */}
        {waTab === 'campaigns' && (
          <div className={`sigma-campaign-overlay${isCreatingCampaign ? ' wizard-active' : ''}`} role="presentation" onClick={() => setWaTab('chats')}>
          <section className="sigma-campaign-dialog" role="dialog" aria-modal="true" aria-labelledby="sigma-campaign-title" onClick={(event) => event.stopPropagation()}>
          <div className="camp-hub od-camp">
            <div className="camp-hub-hero camp-hub-hero-compact od-camp-head">
              <div className="od-camp-head-titles">
                <h2 id="sigma-campaign-title" style={{ margin: 0 }}>Campanhas</h2>
                <p className="od-camp-sub">Organize envios, acompanhe respostas e abra o relatório de cada campanha.</p>
              </div>
              <div className="sigma-campaign-head-actions">
                <button className="btn btn-primary" onClick={openCreateCampaign}>
                  <PlusCircle size={16} /> Nova campanha
                </button>
                <button type="button" className="wa-icon-button" aria-label="Fechar campanhas" onClick={() => setWaTab('chats')}>
                  <X size={17} />
                </button>
              </div>
            </div>

            {(() => {
              const totalSent = campaigns.reduce((s, c) => s + (c.stats?.sent || 0), 0);
              const totalReplied = campaigns.reduce((s, c) => s + (c.stats?.replied || 0), 0);
              const running = campaigns.filter((c) => c.status === 'running' || c.status === 'scheduled').length;
              return (
                <div className="camp-summary-grid">
                  <div className="camp-summary-card">
                    <span className="label">Campanhas</span>
                    <span className="value">{campaigns.length}</span>
                  </div>
                  <div className="camp-summary-card accent">
                    <span className="label">Em andamento</span>
                    <span className="value">{running}</span>
                  </div>
                  <div className="camp-summary-card success">
                    <span className="label">Mensagens enviadas</span>
                    <span className="value">{totalSent}</span>
                  </div>
                  <div className="camp-summary-card purple">
                    <span className="label">Respostas</span>
                    <span className="value">{totalReplied}</span>
                  </div>
                </div>
              );
            })()}

            {campaigns.length === 0 ? (
              <div className="camp-empty">
                <div className="camp-empty-icon"><ListTodo size={28} /></div>
                <h3 style={{ margin: '0 0 6px' }}>Nenhuma campanha</h3>
                <p style={{ margin: '0 0 16px', color: 'var(--muted)', fontSize: 13 }}>Crie a primeira em poucos passos.</p>
                <button className="btn btn-primary" onClick={openCreateCampaign}>
                  <PlusCircle size={14} /> Criar campanha
                </button>
              </div>
            ) : (
              <>
                <div className="camp-list-toolbar od-camp-toolbar">
                  <div className="camp-search-wrap od-camp-search">
                    <Search size={14} aria-hidden="true" />
                    <input
                      type="search"
                      className="camp-search-input"
                      placeholder="Buscar campanha, status ou número…"
                      aria-label="Buscar campanha"
                      value={campaignSearch}
                      onChange={(e) => setCampaignSearch(e.target.value)}
                    />
                  </div>
                  <label className="od-camp-sort">
                    <span className="od-camp-sort-label">Ordenar</span>
                    <select
                      className="camp-sort-select"
                      value={campaignSort}
                      onChange={(e) => setCampaignSort(e.target.value)}
                      title="Ordenar"
                      aria-label="Ordenar campanhas"
                    >
                      <option value="newest">Mais recentes</option>
                      <option value="oldest">Mais antigas</option>
                      <option value="name">Nome (A–Z)</option>
                    </select>
                  </label>
                </div>
                <div className="camp-rcp-tabs od-camp-filters" role="tablist" aria-label="Filtrar por situação" style={{ marginBottom: 0 }}>
                  {[
                    { id: 'all', label: 'Todas' },
                    { id: 'draft', label: 'Rascunhos' },
                    { id: 'active', label: 'Ativas' },
                    { id: 'done', label: 'Finalizadas' },
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={campaignStatusFilter === t.id}
                      className={`camp-rcp-tab od-pill ${campaignStatusFilter === t.id ? 'act' : ''}`}
                      onClick={() => setCampaignStatusFilter(t.id)}
                    >
                      <span className="od-pill-label">{t.label}</span>
                      <span className="od-pill-count">{campaignStatusCounts[t.id] ?? 0}</span>
                    </button>
                  ))}
                </div>
                {filteredCampaigns.length === 0 ? (
                  <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
                    {campaignSearch
                      ? `Nenhuma campanha encontrada para “${campaignSearch}”.`
                      : 'Nenhuma campanha nesta situação.'}
                  </p>
                ) : (
                  <div className="camp-cards od-camp-cards">
                    {filteredCampaigns.map((c) => {
                      const stats = c.stats || {};
                      const sent = stats.sent || 0;
                      const total = stats.total || 0;
                      const read = stats.read || 0;
                      const replied = stats.replied || 0;
                      const failed = stats.failed || 0;
                      const pct = Math.round((sent / (total || 1)) * 100);
                      const canStart = ['ready', 'paused', 'interrupted'].includes(c.status);
                      const canPause = ['running', 'scheduled'].includes(c.status);
                      const startLabel =
                        c.status === 'interrupted'
                          ? 'Confirmar retomada'
                          : c.status === 'paused' && c.pauseReason === 'daily_limit'
                          ? 'Retomar (nova cota)'
                          : c.status === 'paused'
                            ? 'Retomar'
                            : 'Iniciar';
                      const statusClass =
                        c.status === 'running' ? 'running'
                          : c.status === 'scheduled' ? 'scheduled'
                            : c.status === 'paused' ? 'paused'
                              : c.status === 'completed' ? 'completed'
                                : 'ready';
                      const phones = campaignPhoneLabels(c);
                      const est = estimateCampaignDuration({
                        totalLeads: total,
                        intervalSec: Math.max(5, Math.round(((c.schedule?.intervalMs) || 60000) / 1000)),
                        connectionCount: (c.connectionIds?.length || (c.connectionId ? 1 : 1)),
                        dailyLimit: settings.campaigns?.dailyLimit || 10,
                        manualUnlimited: settings.campaigns?.manualUnlimited === true,
                        workingHoursEnabled: settings.campaigns?.workingHoursEnabled !== false,
                        workingHoursStart: settings.campaigns?.workingHoursStart || '07:00',
                        workingHoursEnd: settings.campaigns?.workingHoursEnd || '18:00',
                      });
                      const retryAtLabel = c.nextResumeAt
                        ? new Date(c.nextResumeAt).toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : null;
                      const statusLabel =
                        c.status === 'paused' && c.pauseReason === 'daily_limit'
                          ? (retryAtLabel
                              ? `Limite de hoje · volta ${retryAtLabel}`
                              : 'Limite de hoje esgotado')
                          : c.status === 'paused' && c.pauseReason === 'missed_schedule'
                            ? 'Horário perdido'
                          : c.status === 'running' && c.waitReason === 'outside_hours'
                            ? 'Fora do horário'
                            : c.status === 'running' && c.waitReason === 'no_provider'
                              ? 'Aguardando WhatsApp'
                              : {
                                  ready: 'Rascunho',
                                  running: 'Em andamento',
                                  scheduled: 'Agendada',
                                  paused: 'Pausada',
                                  interrupted: 'Interrompida',
                                  completed: 'Concluída',
                                  cancelled: 'Cancelada',
                                  failed: 'Com falhas',
                                }[c.status] || (c.status || 'Rascunho');
                      return (
                        <div key={c.id} className={`camp-card status-${statusClass} od-camp-card`}>
                          <div className="camp-card-top od-camp-top">
                            <div className="camp-card-title-row od-camp-title-row">
                              <h4 className="od-camp-name">{c.name}</h4>
                              <span className={`camp-status-badge ${statusClass}`}>{statusLabel}</span>
                            </div>
                            <div className="camp-card-date od-camp-meta" title={`Criada em ${formatCampaignDate(c.createdAt)}${c.groupName ? ` · Grupo ${c.groupName}` : ''}`}>
                              <Clock size={12} aria-hidden="true" /> <span>Criada em {formatCampaignDate(c.createdAt)}</span>
                              {c.groupName ? <span className="od-camp-meta-group"> · Grupo {c.groupName}</span> : null}
                              {phones.length > 1 ? <span> · {phones.length} números</span> : (phones[0] ? <span> · {phones[0].label}</span> : null)}
                            </div>
                            {c.status === 'scheduled' && c.schedule?.startAt && (
                              <div className="camp-card-date od-camp-meta od-camp-scheduled" title="Agendada para">
                                <Clock size={12} aria-hidden="true" /> <span>Dispara {formatInZone(c.schedule.startAt, c.schedule?.timeZone || campaignTimeZoneId(settings))} · {timeZoneShortLabel(c.schedule?.timeZone && c.schedule.timeZone !== 'system' ? c.schedule.timeZone : campaignTimeZoneId(settings))}</span>
                              </div>
                            )}
                          </div>

                          <div className="camp-card-progress od-camp-progress">
                            <div className="camp-card-progress-meta od-camp-progress-meta">
                              <span className="od-progress-main">{sent}/{total} enviados · {pct}%</span>
                              <span className="od-progress-sub">
                                {read} lidos · {replied} respostas
                                {est ? <span className="od-progress-est" title={`${est.perDayPerNumber} envios/dia por número · considera retomada manual a cada dia`}> · cerca de {est.days} {est.days === 1 ? 'dia' : 'dias'}</span> : null}
                              </span>
                            </div>
                            <div className="camp-progress-bar od-progress-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Progresso de envio: ${pct}%`}>
                              <div className="camp-progress-fill" style={{ width: `${pct}%` }} />
                            </div>
                          </div>

                          <div className="camp-card-actions od-camp-actions">
                            {canStart ? (
                              <button type="button" className="btn btn-primary od-action-primary" onClick={() => (c.status === 'paused' ? handleResumeCampaign(c.id) : handleStartCampaign(c.id))}>
                                <Play size={14} aria-hidden="true" /> {startLabel}
                              </button>
                            ) : canPause ? (
                              <>
                                {c.status === 'scheduled' && (
                                  <button
                                    type="button"
                                    className="btn btn-primary od-action-primary"
                                    title={c.schedule?.startAt ? `Agendada para ${formatInZone(c.schedule.startAt, c.schedule?.timeZone || campaignTimeZoneId(settings))} — clique para disparar agora` : 'Disparar agora'}
                                    onClick={() => handleStartCampaign(c.id, { forceNow: true })}
                                  >
                                    <Play size={14} aria-hidden="true" /> Disparar agora
                                  </button>
                                )}
                                <button type="button" className={`btn btn-danger ${c.status === 'scheduled' ? 'btn-compact od-action-secondary' : 'od-action-primary'}`} onClick={() => handlePauseCampaign(c.id)}>
                                  <Pause size={14} aria-hidden="true" /> Pausar
                                </button>
                              </>
                            ) : null}
                            <div className="od-camp-secondary">
                              {failed > 0 && (
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-compact od-action-secondary"
                                  title="Voltar as mensagens que falharam para a fila de envio"
                                  onClick={() => handleRetryFailed(c.id)}
                                >
                                  <RotateCcw size={13} aria-hidden="true" /> Reenviar falhas ({failed})
                                </button>
                              )}
                              <button type="button" className="btn btn-secondary btn-compact od-action-secondary" onClick={() => openCampaignKanban(c)}>
                                <ListTodo size={13} aria-hidden="true" /> Kanban
                              </button>
                              <button type="button" className="btn btn-secondary btn-compact od-action-secondary" onClick={() => handleMonitorCampaign(c.id)}>
                                <Activity size={13} aria-hidden="true" /> Relatório
                              </button>
                              <button type="button" className="btn btn-secondary btn-compact od-action-secondary" title="Editar campanha (lista, mensagem e agendamento)" onClick={() => openEditCampaignList(c)}>
                                <Pencil size={13} aria-hidden="true" /> Editar
                              </button>
                              <button type="button" className="btn btn-danger btn-compact od-action-secondary od-action-icon" onClick={() => handleDeleteCampaign(c.id)} title="Apagar" aria-label={`Apagar campanha ${c.name}`}>
                                <Trash2 size={13} aria-hidden="true" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {renderCampaignKanban()}

            {/* Campaign Creator / Editor Modal — portal + no-drag (Electron) */}
            {isCreatingCampaign && createPortal(
              <div
                className="modal-backdrop camp-wizard-backdrop"
                onClick={(e) => { if (e.target === e.currentTarget) closeCampaignModal(); }}
                onMouseDown={(e) => {
                  // Evita que o clique no backdrop “engula” o foco do input
                  if (e.target === e.currentTarget) e.preventDefault();
                }}
              >
                <div
                  className="wa-card camp-wizard"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="camp-wizard-title"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div className="camp-wizard-header">
                    <h3 id="camp-wizard-title" style={{ margin: 0 }}>
                      {editingCampaignId ? 'Editar campanha' : wizardSteps[campaignWizardStep]?.title}
                    </h3>
                    {editingCampaignId && (
                      <span className="wa-hint">{wizardSteps[campaignWizardStep]?.title}</span>
                    )}
                  </div>

                  {editingCampaignId ? (
                    <div className="camp-wizard-steps steps" role="tablist" aria-label="Seções da edição">
                      {wizardSteps.map((step, idx) => (
                        <button
                          key={step.id}
                          type="button"
                          role="tab"
                          aria-selected={idx === campaignWizardStep}
                          title={step.title}
                          className={`camp-wizard-step ${idx === campaignWizardStep ? 'act' : ''} ${idx < campaignWizardStep ? 'done' : ''}`}
                          onClick={() => setCampaignWizardStep(idx)}
                        >
                          <span className="camp-wizard-step-num">{idx + 1}</span> {step.title}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="camp-wizard-steps steps" aria-hidden="true">
                      {wizardSteps.map((step, idx) => <i key={step.id} className={idx <= campaignWizardStep ? 'on' : ''} />)}
                    </div>
                  )}

                  <div className="camp-wizard-body">
                    {/* EDIT MODE passo 0: nome + resumo + soma de grupos */}
                    {editingCampaignId && campaignWizardStep === 0 && (
                      <div className="camp-wizard-pane od-wizard-step0">
                        <div className="camp-field od-field">
                          <label htmlFor="camp-name-input-edit">Nome da campanha</label>
                          <CampaignNameInput
                            id="camp-name-input-edit"
                            initialValue={newCampaignName}
                            onChange={setNewCampaignName}
                            placeholder="Nome da campanha"
                          />
                        </div>
                        <div className="field od-field">
                          <label id="camp-edit-groups-label">Destinatários <span className="wa-hint">(marcar soma · desmarcar remove só os dele)</span></label>
                          <div className="cmp-recsum od-recsum" role="status" aria-live="polite">
                            <b className="od-recsum-total">
                              {campaignRecipients.length} destinatário{campaignRecipients.length === 1 ? '' : 's'}
                              {selectedCampaignGroups.length ? ` · ${selectedCampaignGroups.length} grupo(s): ${selectedCampaignGroups.map((g) => g.name).join(' + ')}` : ' na lista atual'}
                            </b>
                            {campaignRecipients.length > 0 && (
                              <span className="od-recsum-preview"> · {campaignRecipients.slice(0, 4).map((r) => r.name || r.phone).join(' · ')}{campaignRecipients.length > 4 ? ` +${campaignRecipients.length - 4}` : ''}</span>
                            )}
                          </div>
                          {scoringGroups.length === 0 ? (
                            <p className="wa-hint">Nenhum grupo na Base de Leads.</p>
                          ) : (
                            <div className="cmp-groups od-group-list" role="group" aria-label="Grupos de leads da campanha" aria-labelledby="camp-edit-groups-label">
                              {scoringGroups.map((group) => {
                                const count = groupLeads(group.id).filter((l) => l.phone).length;
                                const checked = campaignGroupIds.some((id) => String(id) === String(group.id));
                                return (
                                  <label key={group.id} className={checked ? 'on od-group-on' : 'od-group'}>
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={(e) => toggleCampaignGroup(group.id, e.target.checked)}
                                    />
                                    <span className="od-group-name">{group.name}</span>
                                    <span className="cnt">{count} leads</span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* STEP 0: recipients */}
                    {!editingCampaignId && campaignWizardStep === 0 && (
                      <div className="camp-wizard-pane od-wizard-step0">
                        <div className="field od-field">
                          <label htmlFor="camp-name-input">Nome da campanha</label>
                          <CampaignNameInput
                            id="camp-name-input"
                            inputRef={campaignNameInputRef}
                            initialValue={newCampaignName}
                            onChange={setNewCampaignName}
                            placeholder="Ex.: Lançamento Setembro"
                          />
                          <p className="wa-hint od-field-hint">Se deixar vazio, usamos a data e a hora na criação.</p>
                        </div>
                        <div className="field od-field">
                          <label id="camp-create-groups-label">Grupos de leads <span className="wa-hint">(pode somar mais de um)</span></label>
                          {scoringGroups.length === 0 ? (
                            <p className="wa-hint">Nenhum grupo ainda — crie grupos na Base de Leads para organizar os disparos.</p>
                          ) : (
                            <div className="cmp-groups od-group-list" role="group" aria-label="Grupos de leads da campanha" aria-labelledby="camp-create-groups-label">
                              {scoringGroups.map((group) => {
                                const count = groupLeads(group.id).filter((l) => l.phone).length;
                                const checked = campaignGroupIds.some((id) => String(id) === String(group.id));
                                return (
                                  <label key={group.id} className={checked ? 'on od-group-on' : 'od-group'}>
                                    <input type="checkbox" checked={checked} onChange={(e) => toggleCampaignGroup(group.id, e.target.checked)} />
                                    <span className="od-group-name">{group.name}</span>
                                    <span className="cnt">{count} leads</span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        {campaignGroupIds.length ? (
                          <div className="cmp-recsum od-recsum" role="status" aria-live="polite">
                            <b className="od-recsum-total">{campaignRecipients.length} destinatário{campaignRecipients.length === 1 ? '' : 's'} · {campaignGroupIds.length} grupo(s): {selectedCampaignGroups.map((g) => g.name).join(' + ')}</b>
                            {campaignRecipients.length > 0 && (
                              <span className="od-recsum-preview"> · {campaignRecipients.slice(0, 4).map((r) => r.name || r.phone).join(' · ')}{campaignRecipients.length > 4 ? ` +${campaignRecipients.length - 4}` : ''}</span>
                            )}
                          </div>
                        ) : (
                          <div className="camp-alert od-alert">Marque ao menos um grupo para montar a lista de disparo.</div>
                        )}
                        {connectedSessions.length === 0 && (
                          <div className="camp-alert od-alert">
                            Nenhum número conectado. A campanha será salva como rascunho até você parear um WhatsApp.
                          </div>
                        )}
                      </div>
                    )}

                    {/* STEP 1: message (criação e edição) */}
                    {campaignWizardStep === 1 && (
                      <div className="camp-wizard-pane">
                        <label className="camp-field">
                          <span>Mensagem da campanha</span>
                          <textarea
                            value={templateText}
                            onChange={(e) => setTemplateText(e.target.value)}
                            rows={7}
                            placeholder="Olá {{name}}, tudo bem? ..."
                            autoFocus
                          />
                        </label>
                        <p className="camp-hint">
                          Variáveis: <code>{'{{name}}'}</code>, <code>{'{{phone}}'}</code>, <code>{'{{website}}'}</code>
                          {' '}· em grupos, name = nome do grupo
                        </p>
                        <div className="camp-msg-preview">
                          <div className="camp-msg-preview-label">Prévia</div>
                          <div className="camp-msg-bubble">
                            {(templateText || '…')
                              .replace(/\{\{name\}\}/gi, 'Maria')
                              .replace(/\{\{phone\}\}/gi, '11999990000')
                              .replace(/\{\{website\}\}/gi, 'site.com.br')}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* STEP 2: schedule (criação e edição) */}
                    {campaignWizardStep === 2 && (
                      <div className="camp-wizard-pane">
                        <div className="camp-field-row">
                          <label className="camp-field">
                            <span>Intervalo entre envios (segundos)</span>
                            <input
                              type="number"
                              min={5}
                              value={intervalSec}
                              onChange={(e) => setIntervalSec(parseInt(e.target.value, 10) || 60)}
                            />
                            <span className="camp-hint">Mínimo 5s. Intervalos maiores reduzem risco de bloqueio.</span>
                          </label>
                          <label className="camp-field">
                            <span>Modo de disparo</span>
                            <select value={scheduleMode} onChange={(e) => setScheduleMode(e.target.value)}>
                              <option value="interval">Começar agora (com intervalo)</option>
                              <option value="immediate">Começar agora (mais rápido)</option>
                              <option value="scheduled">Agendar horário</option>
                            </select>
                          </label>
                        </div>
                        {scheduleMode === 'scheduled' && (
                          <label className="camp-field">
                            <span>Iniciar em · {timeZoneShortLabel(campaignTimeZoneId(settings))}</span>
                            <input
                              type="datetime-local"
                              value={scheduleStartAt}
                              onChange={(e) => setScheduleStartAt(e.target.value)}
                            />
                          </label>
                        )}
                        <div className="camp-hint" style={{ marginTop: 12, lineHeight: 1.5 }}>
                          Regras globais (aba Configurações):
                          <br />
                          · Limite diário por número:{' '}
                          <strong>
                            {settings.campaigns?.manualUnlimited
                              ? 'manual (sem teto)'
                              : `${settings.campaigns?.dailyLimit || 10}/dia`}
                          </strong>
                          <br />
                          · Horário de disparo:{' '}
                          <strong>
                            {settings.campaigns?.workingHoursEnabled === false
                              ? '24h (desligado)'
                              : `${settings.campaigns?.workingHoursStart || '07:00'}–${settings.campaigns?.workingHoursEnd || '18:00'}`}
                          </strong>
                          <br />
                          Ao bater o limite, a campanha permanece pausada até você retomar explicitamente.
                        </div>
                        <CampaignDurationHint estimate={durationEstimate} />
                      </div>
                    )}

                    {/* STEP 3: review (criação e edição) */}
                    {campaignWizardStep === 3 && (
                      <div className="camp-wizard-pane">
                        <div className="camp-review-card">
                          <h4 style={{ marginTop: 0 }}>
                            {(newCampaignName || '').trim() || buildDefaultCampaignName()}
                          </h4>
                          <ul className="camp-review-list">
                            <li>
                              <strong>Números:</strong>{' '}
                              {campaignConnectionIds.map((id) => {
                                const c = connections.find((x) => x.id === id);
                                return c?.phoneNumber || id;
                              }).join(' · ') || 'Rascunho — conecte antes de iniciar'}
                            </li>
                            <li><strong>Destinatários:</strong> {campaignRecipients.length}</li>
                            {(selectedCampaignGroups.map((g) => g.name).join(' + ') || editingCampaign?.groupName) && (
                              <li className="od-review-groups">
                                <strong>Grupos:</strong>{' '}
                                <span>{selectedCampaignGroups.map((g) => g.name).join(' + ') || editingCampaign?.groupName}</span>
                              </li>
                            )}
                            {campaignConnectionIds.length > 1 && (
                              <li>
                                <strong>Divisão:</strong>{' '}
                                {campaignConnectionIds.map((id, i) => {
                                  const c = connections.find((x) => x.id === id);
                                  const n = campaignRecipients.filter((_, idx) => idx % campaignConnectionIds.length === i).length;
                                  return `${c?.phoneNumber || id}: ${n}`;
                                }).join(' · ')}
                              </li>
                            )}
                            <li>
                              <strong>Disparo:</strong>{' '}
                              {scheduleMode === 'scheduled'
                                ? (() => {
                                    const tz = campaignTimeZoneId(settings);
                                    const ms = zonedDateTimeToMs(scheduleStartAt, tz);
                                    return Number.isFinite(ms)
                                      ? `agendado (${formatInZone(ms, tz)} · ${timeZoneShortLabel(tz)})`
                                      : 'agendado (data inválida)';
                                  })()
                                : scheduleMode === 'immediate'
                                  ? 'imediato rápido'
                                  : `intervalo ${intervalSec}s`}
                            </li>
                            <li>
                              <strong>Duração estimada:</strong>{' '}
                              {durationEstimate
                                ? `≈ ${durationEstimate.days} dia(s) (${durationEstimate.perDayPerNumber}/dia por número)`
                                : '—'}
                            </li>
                            <li>
                              <strong>Mensagem:</strong>
                              <div className="camp-msg-bubble" style={{ marginTop: 8 }}>
                                {templateText.slice(0, 280)}{templateText.length > 280 ? '…' : ''}
                              </div>
                            </li>
                          </ul>
                          {campaignConnectionIds.length > 1 && (
                            <p className="camp-hint">
                              Uma única campanha com <strong>{campaignConnectionIds.length} números</strong> —
                              leads divididos e relatório unificado (por número no monitor).
                            </p>
                          )}
                          {campaignConnectionIds.length === 0 && (
                            <p className="camp-hint">
                              Esta campanha será salva como <strong>rascunho</strong>. O Kanban e a lista continuam disponíveis; os disparos só liberam quando um WhatsApp for conectado.
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {campaignFormError && <div className="camp-alert error" role="alert">{campaignFormError}</div>}
                  <div className="camp-wizard-footer">
                    <button type="button" className="btn btn-ghost" onClick={closeCampaignModal}>
                      Cancelar
                    </button>
                    <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                      {editingCampaignId ? (
                        <>
                          {campaignWizardStep > 0 && (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() => setCampaignWizardStep((s) => Math.max(0, s - 1))}
                            >
                              <ChevronLeft size={14} /> Voltar
                            </button>
                          )}
                          {campaignWizardStep < wizardSteps.length - 1 && (
                            <button type="button" className="btn btn-secondary" onClick={goWizardNext}>
                              Continuar
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={creatingCampaignBusy || !campaignRecipients.length || !templateText.trim()}
                            onClick={handleCreateCampaign}
                          >
                            {creatingCampaignBusy ? 'Salvando…' : 'Salvar campanha'}
                          </button>
                        </>
                      ) : (
                        <>
                          {campaignWizardStep > 0 && (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() => setCampaignWizardStep((s) => Math.max(0, s - 1))}
                            >
                              <ChevronLeft size={14} /> Voltar
                            </button>
                          )}
                          {campaignWizardStep < wizardSteps.length - 1 ? (
                            <button type="button" className="btn btn-primary" onClick={goWizardNext}>
                              Continuar
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-primary"
                              disabled={creatingCampaignBusy || !canWizardNext()}
                              onClick={handleCreateCampaign}
                            >
                              {creatingCampaignBusy
                                ? 'Criando…'
                                : campaignConnectionIds.length === 0
                                  ? 'Salvar rascunho'
                                  : campaignConnectionIds.length > 1
                                  ? `Criar campanha com ${campaignConnectionIds.length} números`
                                  : 'Criar campanha'}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>,
              document.body,
            )}
          </div>
          </section>
          </div>
        )}

        {/* MONITOR TAB — sem IIFE, variáveis locais estáveis */}
        {waTab === 'monitor' && monitoringCampaign ? (
          <CampaignMonitorView
            campaign={monitoringCampaign}
            connections={connections}
            onBack={leaveMonitor}
            onEdit={(c) => openEditCampaignList(
              campaigns.find((x) => x.id === (c?.id || monitoringCampaignId)) || c || monitoringCampaign,
            )}
          />
        ) : null}

        {/* CHATS TAB */}
        {(waTab === 'chats' || waTab === 'campaigns') && (
          <div className={`chat-shell ${activeChatJid ? 'has-active-chat' : ''}`} role="tabpanel" aria-label="Conversas">
            {/* Left Chats List */}
            <aside className="chat-list">
              <div className="chat-list-header">
                <div className="chat-search-actions">
                  <div className="chat-search-wrap">
                    <Search size={14} className="chat-search-icon" />
                    <input
                      className="chat-search-input"
                      placeholder="Buscar conversa…"
                      aria-label="Buscar conversa"
                      value={chatSearch}
                      onChange={(e) => setChatSearch(e.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    className="wa-newchat-btn"
                    title="Nova conversa"
                    aria-label="Nova conversa"
                    data-od-id="wa-new-chat"
                    onClick={openNewChat}
                  >
                    ✎ Nova conversa
                  </button>
                </div>
                <div className="chat-filter-tabs">
                  {[
                    { id: 'all', label: 'Todas', count: chatCounts.all },
                    { id: 'unread', label: 'Não lidas', count: chatCounts.unread },
                    { id: 'archived', label: 'Arquivadas', count: chatCounts.archived },
                    { id: 'favorites', label: '★ Favoritas', count: chatCounts.favorites },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      className={`chat-filter-tab ${chatFilter === tab.id ? 'act' : ''}`}
                      onClick={() => setChatFilter(tab.id)}
                    >
                      {tab.label}
                      {tab.count > 0 && <span className="chat-filter-count">{tab.count}</span>}
                    </button>
                  ))}
                </div>
              </div>
              <div className="chat-threads" role="listbox" aria-label="Lista de conversas">
                {filteredChats.length === 0 ? (
                  <div className="chat-empty-list">
                    {chatFilter === 'unread' && 'Nenhuma conversa não lida.'}
                    {chatFilter === 'archived' && 'Nenhuma conversa arquivada.'}
                    {chatFilter === 'favorites' && 'Nenhuma conversa favorita.'}
                    {chatFilter === 'all' && 'Nenhuma conversa sincronizada.'}
                  </div>
                ) : (
                  filteredChats.map((c) => {
                    const unread = getUnread(c);
                    const name = c.name || c.phone || c.jid.split('@')[0];
                    return (
                      <button
                        type="button"
                        role="option"
                        aria-selected={activeChatJid === c.jid}
                        key={c.jid}
                        className={`chat-thread ${activeChatJid === c.jid ? 'active' : ''}${unread > 0 ? ' unread' : ''}`}
                        onClick={() => handleSelectChat(c)}
                        onContextMenu={(event) => openChatContextMenu(event, c)}
                      >
                        <div className="chat-avatar-wrap">
                          {renderAvatar(c.jid, name, 44, !!c.isGroup)}
                          {c.isGroup && <span className="chat-avatar-group-badge" title="Grupo"><Users size={10} /></span>}
                        </div>
                        <div className="chat-thread-details">
                          <div className="top-row">
                            <strong data-sensitive-phone={/^\+?[\d\s().-]{10,}$/.test(String(name)) ? 'true' : undefined}>
                              {c.pinned ? <Pin size={11} className="chat-pin-icon" /> : null}
                              {name}
                            </strong>
                            <span className={unread > 0 ? 'chat-time unread' : 'chat-time'}>
                              {formatChatTime(c.timestamp)}
                            </span>
                          </div>
                          <div className="chat-thread-preview-row">
                          <p data-sensitive-phone={!c.lastMessage && !c.isGroup && c.phone ? 'true' : undefined}>{c.lastMessage || (c.isGroup ? 'Grupo' : c.phone || 'Sem mensagens')}</p>
                            {unread > 0 && <span className="chat-unread-badge">{unread > 99 ? '99+' : unread}</span>}
                            {c.archived && <Archive size={12} className="chat-archived-icon" />}
                          </div>
                          {contactTagIds(c.phoneJid || c.jid).length > 0 && (
                            <div className="chat-header-tags" style={{ marginTop: 2 }}>
                              {contactTagIds(c.phoneJid || c.jid).slice(0, 3).map((tid) => {
                                const tag = labelCatalog.find((t) => t.id === tid);
                                if (!tag) return null;
                                return (
                                  <span key={tid} className="chat-tag-chip" style={{ background: `${tag.color}22`, borderColor: tag.color, color: tag.color }}>
                                    {tag.name}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </aside>

            {/* Right Chat History Window */}
            <section className="chat-room">
              {activeChatJid ? (
                <>
                  <div className="chat-room-header">
                    <button
                      type="button"
                      className="chat-mobile-back"
                      aria-label="Voltar à lista de conversas"
                      onClick={() => setActiveChatJid(null)}
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <button
                      type="button"
                      className="chat-room-header-left chat-room-profile-btn"
                      onClick={openContactProfile}
                      title="Ver perfil"
                    >
                      {renderAvatar(activeChatJid, activeChatName, 40, !!activeChatMeta?.isGroup)}
                      <div style={{ textAlign: 'left' }}>
                        <strong data-sensitive-phone={/^\+?[\d\s().-]{10,}$/.test(String(activeChatName)) ? 'true' : undefined}>{activeChatName}</strong>
                        <div className={`chat-presence ${chatPresence?.online ? '' : 'offline'}`}>
                          {chatPresence?.online && <span className="dot" />}
                          <span data-sensitive-phone={!chatPresence?.online && !activeChatMeta?.isGroup && activeChatMeta?.phone ? 'true' : undefined}>
                            {chatPresence?.online
                              ? 'online'
                              : chatPresence?.statusText
                                || (activeChatMeta?.isGroup ? 'Grupo' : activeChatMeta?.phone || 'toque para ver perfil')}
                          </span>
                        </div>
                        {contactTagIds(activeChatMeta?.sendJid || activeChatJid).length > 0 && (
                          <div className="chat-header-tags">
                            {contactTagIds(activeChatMeta?.sendJid || activeChatJid).map((tid) => {
                              const tag = labelCatalog.find((t) => t.id === tid);
                              if (!tag) return null;
                              return (
                                <span key={tid} className="chat-tag-chip" style={{ background: `${tag.color}33`, borderColor: tag.color, color: tag.color }}>
                                  {tag.name}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </button>
                    <div className="chat-room-header-actions wa-menuwrap" style={{ position: 'relative' }}>
                      <button
                        type="button"
                        className="wa-iconbtn"
                        aria-label="Opções da conversa"
                        aria-haspopup="true"
                        aria-expanded={isConvMenuOpen}
                        onClick={() => setIsConvMenuOpen((open) => !open)}
                      >
                        ⋯
                      </button>
                      {isConvMenuOpen && (
                        <div className="wa-menu" id="waConvMenu">
                          <button type="button" onClick={() => { openContactProfile(); setIsConvMenuOpen(false); }}>Ver contato</button>
                          <button type="button" onClick={() => { addLog(`[WHATSAPP] ${activeChatName} silenciado.`); setIsConvMenuOpen(false); }}>Silenciar</button>
                          <button type="button" onClick={() => {
                            const selected = chats.find((chat) => chat.jid === activeChatJid);
                            if (selected) {
                              setArchivedChats((items) => [{ ...selected, archived: true }, ...items.filter((item) => item.jid !== selected.jid)]);
                              setChats((items) => items.filter((item) => item.jid !== selected.jid));
                              setActiveChatJid(null);
                            }
                            setIsConvMenuOpen(false);
                          }}>Arquivar conversa</button>
                          <button type="button" onClick={() => { setTagPickerOpen(true); setIsConvMenuOpen(false); }}>Etiquetas…</button>
                        </div>
                      )}
                      {tagPickerOpen && (
                        <div className="chat-tag-picker" onClick={(e) => e.stopPropagation()}>
                          <div className="chat-tag-picker-title">
                            Etiquetas deste contato
                            <span>só {activeChatName?.split(' ')[0] || 'ele(a)'}</span>
                          </div>
                          <div className="chat-profile-tags">
                            {labelCatalog.length === 0 && (
                              <span className="camp-hint">Crie uma etiqueta abaixo.</span>
                            )}
                            {labelCatalog.map((tag) => {
                              const on = contactTagIds(activeChatMeta?.sendJid || activeChatJid).includes(tag.id);
                              return (
                                <button
                                  key={tag.id}
                                  type="button"
                                  className={`chat-tag-chip selectable ${on ? 'on' : ''}`}
                                  style={{
                                    background: on ? `${tag.color}33` : 'transparent',
                                    borderColor: tag.color,
                                    color: tag.color,
                                  }}
                                  onClick={() => toggleContactTag(tag.id)}
                                >
                                  {tag.name}{on ? ' ✓' : ''}
                                </button>
                              );
                            })}
                          </div>
                          <div className="chat-profile-new-tag">
                            <input
                              value={newTagName}
                              onChange={(e) => setNewTagName(e.target.value)}
                              placeholder="Nova só neste contato…"
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNewTag(); } }}
                            />
                            <button type="button" className="btn btn-primary" style={{ padding: '6px 10px' }} onClick={addNewTag}>
                              +
                            </button>
                          </div>
                          <button
                            type="button"
                            className="chat-tag-picker-close"
                            onClick={() => setTagPickerOpen(false)}
                          >
                            Fechar
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {isFindBarOpen && (
                    <div className="wa-findbar" id="waFindBar">
                      <input
                        id="waFindInput"
                        placeholder="Buscar nesta conversa…"
                        aria-label="Buscar nesta conversa"
                        value={inChatSearchTerm}
                        onChange={(e) => setInChatSearchTerm(e.target.value)}
                        autoFocus
                      />
                      <span id="waFindCount" aria-live="polite">
                        {inChatMatches.length > 0 ? `${inChatMatchIdx + 1}/${inChatMatches.length}` : (inChatSearchTerm ? '0' : '')}
                      </span>
                      <button type="button" id="waFindPrev" aria-label="Ocorrência anterior" onClick={handleFindPrev}>↑</button>
                      <button type="button" id="waFindNext" aria-label="Próxima ocorrência" onClick={handleFindNext}>↓</button>
                      <button type="button" id="waFindX" aria-label="Fechar busca" onClick={() => setIsFindBarOpen(false)}>×</button>
                    </div>
                  )}

                  {/* Messages Window */}
                  <div className="chat-messages">
                    {messages.length === 0 ? (
                      <div className="chat-empty-messages">Nenhuma mensagem nesta conversa ainda.</div>
                    ) : (
                      messages.map((m, idx) => renderMessageBubble(m, idx))
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  {/* Trigger bar compacta + modal de gestão */}
                  <div className="chat-trigger-bar">
                    <button
                      type="button"
                      className={`chat-trigger-toggle ${showTriggers ? 'act' : ''}`}
                      onClick={() => setShowTriggers((v) => !v)}
                      title="Atalhos de gatilhos"
                    >
                      <Zap size={14} />
                      <span style={{ fontSize: '11px' }}>Gatilhos</span>
                    </button>
                    <div className="chat-trigger-chips">
                      {triggerSnippets.slice(0, 6).map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className={`chat-trigger-chip ${s.kind === 'audio' || s.filePath ? 'audio' : ''}`}
                          disabled={sendingHumanized || sendingAudio || !activeChatJid}
                          onClick={() => handleSendTrigger(s)}
                          title={s.kind === 'audio' || s.filePath ? 'Enviar áudio como voz' : s.text}
                        >
                          {(s.kind === 'audio' || s.filePath) ? <Mic size={12} /> : null}
                          {' '}{s.label}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '4px 10px', fontSize: 11, flexShrink: 0 }}
                      onClick={() => setShowTriggersModal(true)}
                      title="Gerenciar gatilhos"
                    >
                      Gerenciar
                    </button>
                  </div>

                  {showTriggers && (
                    <div className="chat-trigger-panel chat-trigger-panel-compact">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Toque para enviar · Gerenciar para criar/editar</span>
                        <button type="button" className="btn btn-primary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => setShowTriggersModal(true)}>
                          <PlusCircle size={12} /> Novo / editar
                        </button>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {snippets.length === 0 ? (
                          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Nenhum gatilho. Clique em Gerenciar.</span>
                        ) : snippets.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            className={`chat-trigger-chip ${s.kind === 'audio' || s.filePath ? 'audio' : ''}`}
                            disabled={sendingHumanized || sendingAudio || !activeChatJid}
                            onClick={() => handleSendTrigger(s)}
                          >
                            {(s.kind === 'audio' || s.filePath) ? <Mic size={12} /> : null} {s.label}
                          </button>
                        ))}
                      </div>
                      {(sendingHumanized || sendingAudio) && (
                        <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--accent)' }}>Enviando…</p>
                      )}
                    </div>
                  )}

                  {replyTo && (
                    <div className="chat-reply-bar">
                      <div className="chat-reply-bar-inner">
                        <Reply size={14} />
                        <div className="chat-reply-bar-text">
                          <strong>{replyTo.key?.fromMe ? 'Você' : activeChatName}</strong>
                          <span>
                            {extractText(unwrapMessage(replyTo.message || {}))
                              || (extractMedia(unwrapMessage(replyTo.message || {}))?.kind === 'audio' ? 'Áudio' : 'Mensagem')}
                          </span>
                        </div>
                      </div>
                      <button type="button" className="chat-reply-cancel" onClick={() => setReplyTo(null)} title="Cancelar resposta">
                        <X size={14} />
                      </button>
                    </div>
                  )}

                  {/* Message Input Bar */}
                  <form onSubmit={handleSendMessage} className="chat-room-footer">
                    <button type="button" className="btn btn-secondary" style={{ padding: '8px' }} title="Anexar mídia ou áudio" onClick={handleAttachMedia} disabled={isRecording || sendingAudio}>
                      ＋
                    </button>
                    {isRecording ? (
                      <div className="chat-recording-bar">
                        <span className="chat-recording-dot" />
                        <span>Gravando {formatAudioSeconds(Math.round(recordingMs / 1000))}…</span>
                        <button type="button" className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={cancelVoiceRecording}>
                          Cancelar
                        </button>
                        <button type="button" className="btn btn-primary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={stopVoiceRecordingAndSend}>
                          Enviar áudio
                        </button>
                      </div>
                    ) : humanizeProgress ? (
                      <div className={`chat-recording-bar ${humanizeProgress.mode === 'audio' ? 'sending-audio' : 'typing'}`}>
                        <span className="chat-recording-dot" />
                        <div className="chat-humanize-info">
                          <span>
                            {humanizeProgress.label}{' '}
                            <strong>{formatAudioSeconds(Math.ceil((humanizeProgress.leftMs || 0) / 1000))}</strong>
                          </span>
                          <div className="chat-humanize-track">
                            <div
                              className="chat-humanize-fill"
                              style={{
                                width: `${Math.max(2, 100 - ((humanizeProgress.leftMs / (humanizeProgress.totalMs || 1)) * 100))}%`,
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <input
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        placeholder="Digite uma mensagem..."
                        className="chat-composer-input"
                        disabled={sendingAudio || sendingHumanized}
                      />
                    )}
                    {!isRecording && !humanizeProgress && (
                      <button
                        type="button"
                        className={`btn btn-secondary chat-mic-btn ${sendingAudio ? 'busy' : ''}`}
                        style={{ padding: '8px' }}
                        title="Gravar mensagem de voz na conversa"
                        onClick={() => startVoiceRecording()}
                        disabled={sendingAudio || sendingHumanized || !activeChatJid}
                      >
                        <Mic size={16} />
                      </button>
                    )}
                    {!isRecording && !humanizeProgress && (
                      <button type="submit" className="btn btn-primary" style={{ padding: '8px 12px' }} disabled={!inputText.trim() || sendingAudio || sendingHumanized}>
                        ↑
                      </button>
                    )}
                  </form>
                </>
              ) : (
                <>
                  <div className="chat-room-header wa-conv-head">
                    <div className="chat-avatar" aria-hidden="true">?</div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <strong>Selecione uma conversa</strong>
                      <span>—</span>
                    </div>
                    <button type="button" className="wa-iconbtn" disabled aria-label="Opções da conversa">⋯</button>
                  </div>
                  <div className="chat-messages wa-msgs">
                    <div className="empty">
                      <b>Nenhuma conversa aberta</b>
                      <span>Escolha um contato ao lado para ver o histórico.</span>
                    </div>
                  </div>
                  <div className="chat-room-footer wa-composer">
                    <button type="button" className="wa-iconbtn" disabled aria-label="Anexar">＋</button>
                    <button type="button" className="wa-iconbtn" disabled aria-label="Gravar áudio"><Mic size={18} /></button>
                    <input type="text" placeholder="Escrever mensagem…" disabled />
                    <button type="button" className="wa-send" disabled aria-label="Enviar mensagem">↑</button>
                  </div>
                </>
              )}
            </section>

            <TriggersManagerModal
              open={showTriggersModal}
              onClose={() => setShowTriggersModal(false)}
              snippets={snippets}
              setSnippets={setSnippets}
              addLog={addLog}
            />

            {profileOpen && (
              <div className="modal-backdrop chat-profile-backdrop" onClick={() => setProfileOpen(false)}>
                <div className="chat-profile-modal" onClick={(e) => e.stopPropagation()} role="dialog">
                  <button type="button" className="chat-profile-close" onClick={() => setProfileOpen(false)}>
                    <X size={18} />
                  </button>
                  <div className="chat-profile-hero">
                    <button
                      type="button"
                      className="chat-profile-avatar-btn"
                      title="Expandir foto"
                      onClick={() => {
                        const pic = profilePics[activeChatJid];
                        if (pic) setLightbox({ src: pic, alt: activeChatName });
                      }}
                    >
                      {renderAvatar(activeChatJid, activeChatName, 96, !!activeChatMeta?.isGroup)}
                    </button>
                    <h3 data-sensitive-phone={!profileInfo?.name && !activeChatMeta?.isGroup && (profileInfo?.phone || activeChatMeta?.phone || activeChatJid) ? 'true' : undefined}>{profileInfo?.name || activeChatName}</h3>
                    <p className="chat-profile-phone" data-sensitive-phone="true">
                      {profileInfo?.phone || activeChatMeta?.phone || activeChatJid}
                    </p>
                    {(profileInfo?.business?.description || profileInfo?.notify) && (
                      <p className="chat-profile-status">
                        {profileInfo?.business?.description || profileInfo?.notify}
                      </p>
                    )}
                    {profileInfo?.business?.category && (
                      <span className="chat-profile-biz">{profileInfo.business.category}</span>
                    )}
                  </div>

                  <div className="chat-profile-section">
                    <div className="chat-profile-section-title">
                      <Tag size={14} /> Etiquetas deste contato
                    </div>
                    <p className="chat-profile-tag-hint">
                      Toque para marcar/desmarcar <strong>somente em {profileInfo?.name || activeChatName}</strong>.
                      Não aplica em massa nos outros.
                    </p>
                    <div className="chat-profile-tags">
                      {labelCatalog.length === 0 && (
                        <span className="camp-hint">Nenhuma etiqueta ainda — crie uma abaixo.</span>
                      )}
                      {labelCatalog.map((tag) => {
                        const on = contactTagIds(activeChatMeta?.sendJid || activeChatJid).includes(tag.id);
                        return (
                          <button
                            key={tag.id}
                            type="button"
                            className={`chat-tag-chip selectable ${on ? 'on' : ''}`}
                            style={{
                              background: on ? `${tag.color}33` : 'transparent',
                              borderColor: tag.color,
                              color: tag.color,
                            }}
                            onClick={() => toggleContactTag(tag.id)}
                            title={on ? 'Remover só deste contato' : 'Adicionar só neste contato'}
                          >
                            {tag.name}
                            {on ? ' ✓' : ''}
                          </button>
                        );
                      })}
                    </div>
                    <div className="chat-profile-new-tag">
                      <input
                        value={newTagName}
                        onChange={(e) => setNewTagName(e.target.value)}
                        placeholder="Nova etiqueta só neste contato…"
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNewTag(); } }}
                      />
                      <button type="button" className="btn btn-primary" style={{ padding: '6px 10px' }} onClick={addNewTag}>
                        + Neste contato
                      </button>
                    </div>
                  </div>

                  {profileInfo?.business && (
                    <div className="chat-profile-section">
                      <div className="chat-profile-section-title">Negócio</div>
                      {profileInfo.business.email && <p>✉ {profileInfo.business.email}</p>}
                      {profileInfo.business.website && <p>🔗 {String(profileInfo.business.website)}</p>}
                      {profileInfo.business.address && <p>📍 {profileInfo.business.address}</p>}
                    </div>
                  )}
                </div>
              </div>
            )}

            {lightbox && (
              <div className="chat-lightbox" onClick={() => setLightbox(null)} role="dialog">
                <img src={lightbox.src} alt={lightbox.alt || ''} onClick={(e) => e.stopPropagation()} />
                <button type="button" className="chat-lightbox-close" onClick={() => setLightbox(null)}>Fechar</button>
              </div>
            )}

            {/* Painel multi-funil (estilo ZapVoice) — várias conversas em paralelo */}
            {funnelJobs.length > 0 && (
              <div className="funnel-jobs-panel">
                <div className="funnel-jobs-title">Funis em andamento ({funnelJobs.length})</div>
                {funnelJobs.map((job) => {
                  const pct = job.totalMs
                    ? Math.max(2, 100 - ((job.leftMs / job.totalMs) * 100))
                    : (job.status === 'done' ? 100 : 10);
                  return (
                    <div key={job.id} className={`funnel-job-row status-${job.status || 'running'}`}>
                      <div className="funnel-job-head">
                        <strong>{job.name}</strong>
                        <span>{job.snippetLabel}</span>
                      </div>
                      <div className="funnel-job-status">
                        {job.status === 'done' && '✓ Enviado'}
                        {job.status === 'error' && `✕ ${job.label}`}
                        {job.status === 'running' && (
                          <>
                            {job.mode === 'audio' ? '🎤' : '⌨️'} {job.label}{' '}
                            <strong>{formatAudioSeconds(Math.ceil((job.leftMs || 0) / 1000))}</strong>
                          </>
                        )}
                      </div>
                      {job.status === 'running' && (
                        <div className="chat-humanize-track">
                          <div className="chat-humanize-fill" style={{ width: `${pct}%` }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* SETTINGS TAB */}
        {waTab === 'settings' && (
          <div style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <h2>Configurações do WhatsApp</h2>

            {/* Campanhas / anti-ban */}
            <div className="wa-card" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <h3 style={{ margin: '0 0 4px' }}>Campanhas · proteção do número</h3>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>
                  Limite diário por número para aquecer a conta e reduzir risco de ban.
                  Ao atingir o teto, a campanha permanece pausada até uma retomada explícita.
                </p>
              </div>

              <div>
                <strong style={{ fontSize: 13 }}>Limite diário por número</strong>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  {limitTiers.map((tier) => {
                    const unlocked = (settings.campaigns?.unlockedLimits || [10]).includes(tier)
                      || settings.campaigns?.manualUnlimited;
                    const active = !settings.campaigns?.manualUnlimited
                      && Number(settings.campaigns?.dailyLimit) === tier;
                    const maxUnlocked = Math.max(...(settings.campaigns?.unlockedLimits || [10]));
                    const canUnlock = !unlocked && tier === (
                      limitTiers[limitTiers.indexOf(maxUnlocked) + 1] || null
                    );
                    return (
                      <button
                        key={tier}
                        type="button"
                        className={`btn ${active ? 'btn-primary' : 'btn-secondary'}`}
                        style={{
                          opacity: unlocked || canUnlock ? 1 : 0.45,
                          minWidth: 72,
                        }}
                        disabled={!unlocked && !canUnlock}
                        onClick={() => {
                          if (unlocked) {
                            updateSetting({
                              campaigns: {
                                dailyLimit: tier,
                                manualUnlimited: false,
                              },
                            });
                            return;
                          }
                          if (canUnlock) {
                            const ok = confirm(
                              `Desbloquear limite de ${tier} msgs/dia por número?\n\n` +
                              'Aumente aos poucos para aquecer o WhatsApp. Valores altos no começo elevam o risco de ban.',
                            );
                            if (!ok) return;
                            const unlockedLimits = [
                              ...new Set([...(settings.campaigns?.unlockedLimits || [10]), tier]),
                            ].sort((a, b) => a - b);
                            updateSetting({
                              campaigns: {
                                unlockedLimits,
                                dailyLimit: tier,
                                manualUnlimited: false,
                              },
                            });
                          }
                        }}
                        title={
                          unlocked
                            ? `${tier} mensagens/dia`
                            : canUnlock
                              ? `Clique para desbloquear ${tier}/dia`
                              : 'Desbloqueie o nível anterior primeiro'
                        }
                      >
                        {tier}/dia {unlocked ? '' : '🔒'}
                      </button>
                    );
                  })}
                </div>
                <p className="camp-hint" style={{ marginTop: 8 }}>
                  Atual: {settings.campaigns?.manualUnlimited
                    ? 'modo manual (sem limite)'
                    : `${settings.campaigns?.dailyLimit || 10} msgs/dia por número`}
                  {dailyQuota?.date ? ` · uso de hoje (${dailyQuota.date})` : ''}
                </p>
                {dailyQuota?.byConnection && Object.keys(dailyQuota.byConnection).length > 0 && (
                  <div className="camp-quota-usage">
                    {Object.entries(dailyQuota.byConnection).map(([id, used]) => {
                      const cn = connections.find((c) => c.id === id);
                      const lim = settings.campaigns?.manualUnlimited
                        ? '∞'
                        : (settings.campaigns?.dailyLimit || 10);
                      return (
                        <span key={id} className="camp-phone-chip">
                          <span data-sensitive-phone="true">{cn?.phoneNumber || id.slice(0, 8)}</span>: {used}/{lim}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <strong style={{ fontSize: '13px' }}>Modo manual (sem limite)</strong>
                  <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                    Remove o teto diário. Use por conta e risco — aumenta chance de restrição.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={!!settings.campaigns?.manualUnlimited}
                  onChange={(e) => {
                    if (e.target.checked) {
                      const ok = confirm(
                        'Ativar modo manual sem limite diário?\n\n' +
                        'Isso desliga a proteção de aquecimento. Você assume o risco de ban.',
                      );
                      if (!ok) return;
                    }
                    updateSetting({ campaigns: { manualUnlimited: e.target.checked } });
                  }}
                />
              </div>

              <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '4px 0' }} />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <strong style={{ fontSize: '13px' }}>Só disparar em horário comercial</strong>
                  <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                    Fora da janela a campanha espera (estado salvo). Padrão 07:00–18:00.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.campaigns?.workingHoursEnabled !== false}
                  onChange={(e) => {
                    if (!e.target.checked) {
                      const ok = confirm(
                        'Desativar controle de horário?\n\n' +
                        'Disparos poderão ocorrer 24h. Por conta e risco.',
                      );
                      if (!ok) return;
                    }
                    updateSetting({ campaigns: { workingHoursEnabled: e.target.checked } });
                  }}
                />
              </div>

              {settings.campaigns?.workingHoursEnabled !== false && (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <label className="camp-field" style={{ minWidth: 120 }}>
                    <span>Início</span>
                    <input
                      type="time"
                      value={settings.campaigns?.workingHoursStart || '07:00'}
                      onChange={(e) => updateSetting({
                        campaigns: { workingHoursStart: e.target.value },
                      })}
                    />
                  </label>
                  <label className="camp-field" style={{ minWidth: 120 }}>
                    <span>Fim</span>
                    <input
                      type="time"
                      value={settings.campaigns?.workingHoursEnd || '18:00'}
                      onChange={(e) => updateSetting({
                        campaigns: { workingHoursEnd: e.target.value },
                      })}
                    />
                  </label>
                </div>
              )}

              <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '4px 0' }} />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <strong style={{ fontSize: '13px' }}>Região do agendamento</strong>
                  <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                    Horários de disparo e janela seguem esta região. Padrão: relógio do sistema.
                  </div>
                </div>
                <select
                  className="camp-sort-select"
                  value={campaignTimeZoneId(settings)}
                  onChange={(e) => updateSetting({ campaigns: { timeZone: e.target.value } })}
                  title="Região do agendamento"
                >
                  {CAMPAIGN_TIMEZONES.map((z) => (
                    <option key={z.id} value={z.id}>{z.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="wa-card" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <h3 style={{ margin: 0 }}>Geral</h3>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong style={{ fontSize: '13px' }}>Notificações no Desktop</strong>
                  <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Exibir alerta quando novas mensagens chegarem</div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.notifications.desktop}
                  onChange={(e) => updateSetting({ notifications: { desktop: e.target.checked } })}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong style={{ fontSize: '13px' }}>Sons de Notificação</strong>
                  <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Tocar som para novas mensagens</div>
                </div>
                <input 
                  type="checkbox" 
                  checked={settings.notifications.sound}
                  onChange={() => updateSetting({ notifications: { sound: !settings.notifications.sound } })}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong style={{ fontSize: '13px' }}>Baixar imagens automaticamente</strong>
                  <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Baixar imagens automaticamente nas conversas</div>
                </div>
                <input 
                  type="checkbox" 
                  checked={settings.media.autoDownloadImages}
                  onChange={(e) => updateSetting({ media: { autoDownloadImages: e.target.checked } })}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong style={{ fontSize: '13px' }}>Baixar figurinhas automaticamente</strong>
                  <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Mostrar figurinhas recebidas automaticamente</div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.media.autoDownloadStickers !== false}
                  onChange={(e) => updateSetting({ media: { autoDownloadStickers: e.target.checked } })}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong style={{ fontSize: '13px' }}>Prévia de links</strong>
                  <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Buscar título e imagem de sites compartilhados</div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.previews?.links !== false}
                  onChange={(e) => updateSetting({ previews: { links: e.target.checked } })}
                />
              </div>
            </div>
          </div>
        )}

        {chatContextMenu && (
          <div
            className="wa-chat-context-menu"
            role="menu"
            style={{ left: Math.max(8, Math.min(chatContextMenu.x, window.innerWidth - 272)), top: Math.max(8, Math.min(chatContextMenu.y, window.innerHeight - 230)) }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="wa-chat-context-title">{chatContextMenu.chat?.name || chatContextMenu.chat?.phone || 'Conversa'}</div>
            <button type="button" role="menuitem" disabled={chatContextMenu.loading} onClick={openChatReminder}><Bell size={14} /> Ativar lembrete</button>
            <label className="wa-chat-context-field">
              <span>Mudar estado no Kanban</span>
              <select value={chatKanbanCard?.columnId || ''} disabled={chatContextMenu.loading || chatKanbanBusy || !chatKanbanCard} onChange={changeChatKanbanStage}>
                {!chatKanbanCard && <option value="">Lead fora do Kanban</option>}
                {chatKanbanColumns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}
              </select>
            </label>
            {chatContextMenu.awaitingValue && (
              <div className="wa-chat-context-closed">
                <input type="text" inputMode="decimal" value={chatKanbanValue} onChange={(event) => setChatKanbanValue(event.target.value)} placeholder="Valor fechado · R$ 0,00" aria-label="Valor do negócio fechado" autoFocus />
                <button type="button" className="btn btn-primary btn-compact" disabled={chatKanbanBusy || !chatKanbanValue.trim()} onClick={saveChatWonStage}>Salvar venda</button>
              </div>
            )}
          </div>
        )}

        {chatReminderTarget && (
          <div className="overlay on modal-overlay" role="presentation" onClick={() => setChatReminderTarget(null)}>
            <div className="modal modal-content wa-reminder-modal" role="dialog" aria-modal="true" aria-labelledby="waReminderTitle" onClick={(event) => event.stopPropagation()}>
              <div className="modal-head"><div><span className="eyebrow">WhatsApp · Kanban</span><h2 id="waReminderTitle">Agendar lembrete</h2></div><button type="button" className="icon-btn" aria-label="Fechar" onClick={() => setChatReminderTarget(null)}><X size={17} /></button></div>
              <div className="modal-body" style={{ gridTemplateColumns: '1fr' }}>
                <p className="wa-reminder-lead">{chatReminderTarget.name || chatReminderTarget.phone || 'Lead selecionado'}</p>
                <label className="field"><span>Quando</span><input type="datetime-local" value={chatReminderDraft.at} onChange={(event) => setChatReminderDraft((current) => ({ ...current, at: event.target.value }))} /></label>
                <label className="field"><span>Nota (opcional)</span><input maxLength={200} value={chatReminderDraft.note} placeholder="Ex.: retornar sobre a proposta" onChange={(event) => setChatReminderDraft((current) => ({ ...current, note: event.target.value }))} /></label>
              </div>
              <div className="modal-foot"><button type="button" className="btn btn-ghost" onClick={() => setChatReminderTarget(null)}>Cancelar</button><button type="button" className="btn btn-primary" disabled={chatKanbanBusy || !chatReminderDraft.at} onClick={saveChatReminder}>Salvar lembrete</button></div>
            </div>
          </div>
        )}

        {/* RECUPERAÇÃO: horário perdido com o PC desligado — uma decisão por campanha */}
        {recoveryMissed && recoveryMissed.length > 0 && createPortal(
          <div
            className="modal-backdrop camp-wizard-backdrop"
            onClick={(e) => { if (e.target === e.currentTarget) setRecoveryMissed(null); }}
          >
            <div
              className="wa-card camp-wizard"
              role="dialog"
              aria-modal="true"
              aria-labelledby="recovery-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="camp-wizard-header">
                <h3 id="recovery-title" style={{ margin: 0 }}>Horário de disparo perdido</h3>
                <span className="wa-hint">O app estava fechado na hora agendada. Escolha o que fazer com cada campanha.</span>
                {connectedSessions.length === 0 && (
                  <div className="camp-alert" style={{ marginTop: 8 }}>
                    Nenhum WhatsApp conectado — conecte um número para disparar agora, ou deixe para amanhã.
                  </div>
                )}
              </div>
              <div className="camp-wizard-body">
                {recoveryMissed.map((m) => {
                  const tz = m.timeZone || campaignTimeZoneId(settings);
                  const when = formatInZone(m.scheduledAt, tz);
                  const next = formatInZone(m.scheduledAt + 24 * 60 * 60 * 1000, tz);
                  const busy = recoveryBusyId === m.id;
                  return (
                    <div key={m.id} className="camp-review-card">
                      <h4 style={{ marginTop: 0 }}>{m.name}</h4>
                      <p className="camp-hint" style={{ margin: '4px 0 12px' }}>
                        Agendada para {when} ({timeZoneShortLabel(tz)}) · {m.pending} de {m.total} pendentes
                      </p>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => handleRecoveryResolve(m.id, 'now')}>
                          <Play size={12} /> {busy ? 'Disparando…' : 'Disparar agora'}
                        </button>
                        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => handleRecoveryResolve(m.id, 'tomorrow')}>
                          Deixar para amanhã ({next})
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="camp-wizard-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setRecoveryMissed(null)}>
                  Decidir depois
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      </div>
    </div>
  );
}

function formatDurationMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return remSec ? `${min}m ${remSec}s` : `${min}m`;
  const h = Math.floor(min / 60);
  const remMin = min % 60;
  if (h < 48) return remMin ? `${h}h ${remMin}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function formatClock(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function formatHourLabel(hour) {
  if (hour == null || !Number.isFinite(Number(hour))) return '—';
  const h = Math.round(Number(hour)) % 24;
  return `${String(h).padStart(2, '0')}:00`;
}

const LEAD_STATUS_META = {
  pending: { label: 'Pendente', color: 'var(--muted)' },
  sent: { label: 'Enviado', color: 'var(--accent)' },
  delivered: { label: 'Entregue', color: '#3b82f6' },
  read: { label: 'Lido', color: 'var(--success)' },
  replied: { label: 'Respondeu', color: '#a855f7' },
  failed: { label: 'Falhou', color: 'var(--danger)' },
};

/** Tela de monitoramento com tracking completo de campanha. */
function CampaignMonitorView({ campaign, onBack, onEdit, connections = [] }) {
  const [leadFilter, setLeadFilter] = useState('all');
  const stats = (campaign && campaign.stats) || {};
  const sent = Number(stats.sent || 0);
  const total = Number(stats.total || 0);
  const pending = Number(stats.pending || 0);
  const failed = Number(stats.failed || 0);
  const delivered = Number(stats.delivered || 0);
  const read = Number(stats.read || 0);
  const replied = Number(stats.replied || 0);
  const opened = Number(stats.opened || 0);
  const openCount = Number(stats.openCount || 0);
  const replyCount = Number(stats.replyCount || replied || 0);
  const progressPct = Math.round((sent / (total || 1)) * 100);
  const leads = Array.isArray(campaign?.leads) ? campaign.leads : [];
  const histogram = Array.isArray(stats.replyHourHistogram)
    ? stats.replyHourHistogram
    : Array.from({ length: 24 }, () => 0);
  const maxHist = Math.max(1, ...histogram);
  const eventLog = Array.isArray(campaign?.eventLog) ? [...campaign.eventLog].reverse() : [];
  const byConnection = stats.byConnection && typeof stats.byConnection === 'object'
    ? Object.values(stats.byConnection)
    : [];
  const phoneLabel = (id) => {
    if (!id) return '—';
    const cn = (connections || []).find((c) => c.id === id);
    return cn?.phoneNumber || String(id).slice(0, 12);
  };
  const statusLabel =
    campaign?.status === 'paused' && campaign?.pauseReason === 'daily_limit'
      ? 'Limite diário (salva — aguarda retomada)'
      : campaign?.status === 'paused' && campaign?.pauseReason === 'missed_schedule'
        ? 'Horário perdido (aguarda remarcar ou disparo)'
      : {
          ready: 'Pronta',
          running: 'Em andamento',
          scheduled: 'Agendada',
          paused: 'Pausada',
          interrupted: 'Interrompida',
          completed: 'Concluída',
          cancelled: 'Cancelada',
        }[campaign?.status] || campaign?.status || '—';

  const filteredLeads = useMemo(() => {
    if (leadFilter === 'all') return leads;
    if (leadFilter === 'opened') return leads.filter((l) => (l.openCount || 0) > 0 || l.readAt || l.openedAt);
    if (leadFilter === 'read') return leads.filter((l) => l.readAt || l.status === 'read' || l.status === 'replied');
    if (leadFilter === 'replied') return leads.filter((l) => l.repliedAt || l.replyCount > 0);
    if (leadFilter === 'failed') return leads.filter((l) => l.status === 'failed');
    if (leadFilter === 'no-reply') {
      return leads.filter((l) => (l.sentAt || l.messageId) && !l.repliedAt && l.status !== 'failed');
    }
    return leads;
  }, [leads, leadFilter]);

  const funnel = [
    { key: 'sent', label: 'Enviados', value: sent, color: 'var(--accent)' },
    { key: 'delivered', label: 'Entregues', value: delivered, color: '#3b82f6' },
    { key: 'read', label: 'Lidos', value: read, color: 'var(--success)' },
    { key: 'opened', label: 'Abriram', value: opened, color: '#14b8a6' },
    { key: 'replied', label: 'Respostas', value: replied, color: '#a855f7' },
  ];

  const tips = [];
  if (sent > 0 && Number(stats.deliveryRate || 0) < 80) {
    tips.push('Taxa de entrega baixa: confira se os números têm WhatsApp e se o DDI está correto.');
  }
  if (sent > 0 && Number(stats.readRate || 0) < 40 && delivered > 0) {
    tips.push('Poucas leituras: teste horários de envio diferentes ou uma abertura de mensagem mais curta.');
  }
  if (sent > 0 && Number(stats.replyRate || 0) < 5 && read > 3) {
    tips.push('Leram mas não respondem: refine o CTA e personalize com nome/empresa do lead.');
  }
  if (stats.avgReplyHour != null) {
    tips.push(`Pico de respostas perto de ${formatHourLabel(stats.avgReplyHour)} — priorize disparos 1–2h antes.`);
  }
  if (!tips.length && sent > 0) {
    tips.push('Continue acompanhando: use o funil e o horário médio para ajustar a próxima leva.');
  }

  const eventLabel = (ev) => {
    const map = {
      delivered: 'Entregue',
      read: 'Leu a mensagem',
      reopened: 'Reabriu a conversa',
      open: 'Abriu a conversa',
      reply: 'Respondeu',
      'reply-again': 'Nova resposta',
      daily_limit: 'Limite diário atingido',
    };
    return map[ev.type] || ev.type || 'evento';
  };

  return (
    <div className="campaign-monitor" style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>{campaign?.name || 'Campanha'}</h2>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            {statusLabel}
            {' · '}{progressPct}% enviados
            {campaign?.createdAt
              ? ` · criada ${new Date(campaign.createdAt).toLocaleDateString('pt-BR')}`
              : ''}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {typeof onEdit === 'function' && (
            <button
              type="button"
              className="btn btn-secondary"
              title="Editar campanha (lista, mensagem e agendamento)"
              onClick={() => onEdit(campaign)}
            >
              <Pencil size={14} /> Editar
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              if (typeof onBack === 'function') onBack();
            }}
          >
            <ChevronLeft size={14} /> Voltar
          </button>
        </div>
      </div>

      {/* Por número — campanha multi-conexão */}
      {byConnection.length > 0 && (
        <div className="wa-card" style={{ padding: 'var(--space-4)' }}>
          <h4 style={{ marginTop: 0, marginBottom: 12 }}>Por número WhatsApp</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {byConnection.map((row) => (
              <div
                key={row.connectionId || 'none'}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: '10px 12px',
                  background: 'var(--subtle-bg)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <Phone size={12} />
                  <strong style={{ fontSize: 13 }}>{phoneLabel(row.connectionId)}</strong>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
                  <div>Enviados: <strong style={{ color: 'var(--fg)' }}>{row.sent || 0}</strong>/{row.total || 0}</div>
                  <div>Pendentes: {row.pending || 0}</div>
                  <div>Lidos: {row.read || 0} · Resp.: {row.replied || 0}</div>
                  {(row.failed || 0) > 0 && (
                    <div style={{ color: 'var(--danger)' }}>Falhas: {row.failed}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KPI cards — compacto */}
      <div className="stats-grid camp-monitor-kpis">
        <div className="stat-card accent">
          <span className="label">Enviados</span>
          <span className="value">{sent}<span style={{ fontSize: 14, color: 'var(--muted)' }}>/{total}</span></span>
        </div>
        <div className="stat-card success">
          <span className="label">Lidos</span>
          <span className="value" style={{ color: 'var(--success)' }}>{read}</span>
          <span className="desc">{stats.readRate ?? 0}%</span>
        </div>
        <div className="stat-card" style={{ borderTop: '2px solid #a855f7' }}>
          <span className="label">Respostas</span>
          <span className="value" style={{ color: '#a855f7' }}>{replyCount}</span>
          <span className="desc">{stats.replyRate ?? 0}%</span>
        </div>
        <div className="stat-card warn">
          <span className="label">Tempo resp.</span>
          <span className="value" style={{ fontSize: 20 }}>{formatDurationMs(stats.avgResponseTimeMs)}</span>
        </div>
        {failed > 0 ? (
          <div className="stat-card danger">
            <span className="label">Falhas</span>
            <span className="value" style={{ color: 'var(--danger)' }}>{failed}</span>
          </div>
        ) : null}
      </div>

      {/* Funnel */}
      <div className="wa-card" style={{ padding: 'var(--space-4)' }}>
        <h4 style={{ marginTop: 0, marginBottom: 12 }}>Funil da campanha</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {funnel.map((step) => {
            const width = Math.max(4, Math.round((step.value / (sent || total || 1)) * 100));
            const rate = sent ? Math.round((step.value / sent) * 1000) / 10 : 0;
            return (
              <div key={step.key} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 70px', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{step.label}</span>
                <div style={{ background: 'var(--track-bg)', height: 18, borderRadius: 999, overflow: 'hidden', border: '1px solid var(--border)' }}>
                  <div style={{ width: `${width}%`, height: '100%', background: step.color, transition: 'width .3s ease' }} />
                </div>
                <strong style={{ fontSize: 13, textAlign: 'right' }}>{step.value} <span style={{ color: 'var(--muted)', fontWeight: 500 }}>({rate}%)</span></strong>
              </div>
            );
          })}
        </div>
        <div style={{ background: 'var(--track-bg)', height: 10, borderRadius: 999, overflow: 'hidden', marginTop: 14, border: '1px solid var(--border)' }}>
          <div style={{ background: 'var(--accent)', height: '100%', width: `${progressPct}%` }} />
        </div>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>Progresso de envio: {progressPct}%</span>
      </div>

      {/* Hour histogram compact */}
      {histogram.some((c) => c > 0) && (
        <div className="wa-card" style={{ padding: 'var(--space-4)' }}>
          <h4 style={{ marginTop: 0, marginBottom: 10 }}>Horários de resposta</h4>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 88 }}>
            {histogram.map((count, hour) => {
              const h = Math.max(4, Math.round((count / maxHist) * 100));
              const isPeak = count > 0 && count === maxHist;
              return (
                <div key={hour} title={`${String(hour).padStart(2, '0')}:00 — ${count}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <div style={{
                    width: '100%', maxWidth: 14, height: count ? `${h}%` : 3,
                    background: count ? (isPeak ? '#a855f7' : 'var(--accent)') : 'var(--track-bg)',
                    borderRadius: 3, minHeight: 3,
                  }} />
                  {hour % 4 === 0 ? <span style={{ fontSize: 9, color: 'var(--muted)' }}>{hour}</span> : null}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Lead table */}
      <div className="wa-card" style={{ padding: 'var(--space-4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <h4 style={{ margin: 0 }}>Destinatários ({filteredLeads.length})</h4>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              { id: 'all', label: 'Todos' },
              { id: 'opened', label: 'Abriram' },
              { id: 'read', label: 'Leram' },
              { id: 'replied', label: 'Responderam' },
              { id: 'no-reply', label: 'Sem resposta' },
              { id: 'failed', label: 'Falhas' },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                className={`btn ${leadFilter === f.id ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '4px 10px', fontSize: 11 }}
                onClick={() => setLeadFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filteredLeads.length === 0 ? (
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Nenhum destinatário neste filtro.</span>
          ) : filteredLeads.map((lead, idx) => {
            const st = lead.status || 'pending';
            const meta = LEAD_STATUS_META[st] || LEAD_STATUS_META.pending;
            const opens = Number(lead.openCount) || 0;
            const replies = Number(lead.replyCount) || (lead.repliedAt ? 1 : 0);
            return (
              <div
                key={lead.leadId || lead.phone || lead.jid || idx}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: 10,
                  padding: '10px 12px',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <strong style={{ display: 'block' }}>{lead.name || lead.company || 'Destinatário'}</strong>
                  <span style={{ color: 'var(--muted)' }} data-sensitive-phone="true">{lead.phone || lead.jid || 'sem destino'}</span>
                  {lead.connectionId ? (
                    <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 2 }}>
                      via {phoneLabel(lead.connectionId)}
                    </div>
                  ) : null}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px', marginTop: 6, color: 'var(--meta)', fontSize: 11 }}>
                    <span>Envio: {formatClock(lead.sentAt)}</span>
                    <span>Entrega: {formatClock(lead.deliveredAt)}</span>
                    <span>Leitura: {formatClock(lead.readAt)}</span>
                    <span>1ª resposta: {formatClock(lead.repliedAt)}</span>
                    {lead.responseTimeMs != null ? <span>Tempo: {formatDurationMs(lead.responseTimeMs)}</span> : null}
                  </div>
                  {lead.errorMessage ? (
                    <div style={{ color: 'var(--danger)', marginTop: 4 }}>{String(lead.errorMessage)}</div>
                  ) : null}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ color: meta.color, fontWeight: 700, textTransform: 'uppercase', fontSize: 11 }}>{meta.label}</div>
                  <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)', lineHeight: 1.45 }}>
                    <div>{opens} abertura{opens === 1 ? '' : 's'}</div>
                    <div>{replies} resposta{replies === 1 ? '' : 's'}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Event log */}
      <div className="wa-card" style={{ padding: 'var(--space-4)' }}>
        <h4 style={{ marginTop: 0 }}>Linha do tempo</h4>
        {eventLog.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
            Aguardando eventos (entregas, leituras, aberturas e respostas)…
          </p>
        ) : (
          <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {eventLog.slice(0, 80).map((ev, i) => (
              <div
                key={`${ev.at}-${i}`}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '6px 8px',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 12,
                }}
              >
                <span>
                  <strong>{eventLabel(ev)}</strong>
                  {' · '}
                  {ev.name || ev.leadId || 'lead'}
                  {ev.replyCount ? ` (${ev.replyCount}×)` : ''}
                  {ev.openCount ? ` · ${ev.openCount} abert.` : ''}
                  {ev.responseTimeMs != null ? ` · ${formatDurationMs(ev.responseTimeMs)}` : ''}
                </span>
                <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{formatClock(ev.at)}</span>
              </div>
            ))}
          </div>
        )}
        {campaign?.logs ? (
          <pre style={{ marginTop: 12, padding: 10, background: 'var(--overlay-soft)', borderRadius: 8, fontSize: 11, whiteSpace: 'pre-wrap', maxHeight: 100, overflow: 'auto' }}>
            {campaign.logs}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

export default WhatsAppPanel;
