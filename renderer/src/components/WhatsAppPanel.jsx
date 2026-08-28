import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Plug,
  ListTodo,
  Activity,
  MessageSquare,
  Settings,
  PlusCircle,
  Play,
  Pause,
  Trash2,
  RefreshCw,
  Send,
  User,
  Users,
  Paperclip,
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
  ChevronRight,
  Check,
  Clock,
  BarChart3,
  Sparkles,
  Reply,
  Tag,
  MoreVertical,
  Pause as PauseIcon,
  Play as PlayIcon,
} from 'lucide-react';
import TriggersManagerModal from './TriggersManagerModal';
import ChatVoicePlayer from './ChatVoicePlayer';

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

function WhatsAppPanel({ waStatus, setWaStatus, addLog }) {
  const [waTab, setWaTab] = useState('connect');
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
  const [isCreatingCampaign, setIsCreatingCampaign] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState(null);
  const [newCampaignName, setNewCampaignName] = useState('');
  const [campaignRecipients, setCampaignRecipients] = useState([]);
  const [customNumberInput, setCustomNumberInput] = useState('');
  const [customNameInput, setCustomNameInput] = useState('');
  const [recipientSearch, setRecipientSearch] = useState('');
  const [waContacts, setWaContacts] = useState([]);
  const [waGroups, setWaGroups] = useState([]);
  /** Fonte de destinatários: scrape | groups | scoring | whatsapp | manual */
  const [recipientSourceTab, setRecipientSourceTab] = useState('scrape');
  const [scrapeSearches, setScrapeSearches] = useState([]); // { id, label, count, withPhone }
  const [scrapeLeadPool, setScrapeLeadPool] = useState([]); // leads do scraping em memória
  const [scoringGroups, setScoringGroups] = useState([]);
  const [scoringLeadPool, setScoringLeadPool] = useState([]); // leads analisados
  const [scoringPriorityFilter, setScoringPriorityFilter] = useState('all'); // all | alta | media | baixa
  const [recipientBrowseFilter, setRecipientBrowseFilter] = useState('');
  const [selectedBrowseKeys, setSelectedBrowseKeys] = useState(() => new Set());
  const [recipientSourcesLoading, setRecipientSourcesLoading] = useState(false);
  const [templateText, setTemplateText] = useState('Olá {{name}}, tudo bem? Notamos que o seu site está com lentidão.');
  const [intervalSec, setIntervalSec] = useState(30);
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
      }
    } catch (e) {
      console.error(e);
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
        addLog('[CAMPAIGN] Limite diário atingido — progresso salvo. Retoma amanhã ou ao reiniciar com cota livre.');
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
    if (!window.whatsappAPI) return;
    try {
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
        addLog(`[WHATSAPP] Falha ao conectar: ${res.error || 'erro desconhecido'}`);
      }
    } catch (e) {
      setConnectFlowStatus(null);
      setQrCodeUrl(null);
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
          { name: 'Mídia', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf', 'mp3', 'ogg', 'opus', 'wav', 'm4a', 'mp4'] },
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
          { name: 'Mídia', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf', 'mp3', 'ogg', 'opus', 'wav', 'm4a'] },
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
    address: l.address || '',
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
      address: l.company?.address || '',
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

      if (window.leadScoringAPI?.listGroups) {
        const gRes = await window.leadScoringAPI.listGroups();
        setScoringGroups(Array.isArray(gRes?.groups) ? gRes.groups : []);
      } else {
        setScoringGroups([]);
      }

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

  const addLeadsFromScoringGroup = async (groupId) => {
    if (!groupId || !window.leadScoringAPI?.getAll) {
      alert('Não foi possível carregar o grupo. Abra o Lead Scoring e tente de novo.');
      return;
    }
    try {
      const res = await window.leadScoringAPI.getAll({ groupId });
      const mapped = (res?.leads || [])
        .map(mapScoringLead)
        .filter((l) => l.phone);
      mergeRecipients(mapped);
      const g = scoringGroups.find((x) => x.id === groupId);
      addLog(`[CAMPAIGN] +${mapped.length} lead(s) do grupo “${g?.name || groupId}”.`);
      if (!mapped.length) {
        alert('Nenhum lead com telefone neste grupo.');
      }
    } catch (e) {
      alert('Erro ao carregar grupo: ' + e.message);
    }
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
    setEditingCampaignId(null);
    // Prefill com nome genérico (editável). Se apagar, cria com data/hora na hora do create.
    setNewCampaignName(buildDefaultCampaignName());
    setCampaignRecipients([]);
    setCustomNumberInput('');
    setCustomNameInput('');
    setRecipientSearch('');
    setRecipientSourceTab('scrape');
    setRecipientBrowseFilter('');
    setSelectedBrowseKeys(new Set());
    setScoringPriorityFilter('all');
    setCampaignWizardStep(0);
    setCreatingCampaignBusy(false);
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
      if (Array.isArray(draft.recipients)) setCampaignRecipients(draft.recipients);
      if (draft.template?.text) setTemplateText(draft.template.text);
      setRecipientSourceTab('scoring');
    };
    window.addEventListener('sigma:open-campaign-draft', onLeadScoringDraft);
    return () => window.removeEventListener('sigma:open-campaign-draft', onLeadScoringDraft);
    // openCreateCampaign intentionally uses current connection state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedSessions, activeConnectionId, campaignConnectionId]);

  // Carrega scrapings + grupos do scoring ao abrir passo de destinatários
  useEffect(() => {
    if (!isCreatingCampaign) return;
    if (campaignWizardStep === 1 || editingCampaignId) {
      loadRecipientSources();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreatingCampaign, campaignWizardStep, editingCampaignId]);

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
      alert('Pause a campanha antes de editar a lista de destinatários.');
      return;
    }
    setEditingCampaignId(campaign.id);
    setNewCampaignName(campaign.name || '');
    setTemplateText(campaign.template?.text || templateText);
    setCampaignWizardStep(0);
    setCampaignRecipients(
      (campaign.leads || []).map((l) => ({
        leadId: l.leadId,
        name: l.name || '',
        phone: l.phone || '',
        phoneRaw: l.phoneRaw || l.phone || '',
        jid: l.jid || '',
        isGroup: !!l.isGroup,
        source: l.source || 'manual',
        company: l.company || '',
        status: l.status,
        errorMessage: l.errorMessage,
        messageId: l.messageId,
      })),
    );
    setIsCreatingCampaign(true);
    setRecipientSourceTab('scrape');
    loadRecipientSources();
    const conn = campaign.connectionId || campaignConnectionId || activeConnectionId;
    if (conn) {
      setCampaignConnectionId(conn);
      setCampaignConnectionIds([conn]);
      await loadWaDirectory(conn);
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
    }));

  // Create / update campaign — uma campanha pode ter vários números
  const handleCreateCampaign = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    if (!window.campaignAPI) return;

    // Nome: digita ou genérico com data/hora
    const baseName = (newCampaignName || '').trim() || buildDefaultCampaignName();

    if (editingCampaignId) {
      if (campaignRecipients.length === 0) {
        alert('Adicione ao menos um destinatário.');
        return;
      }
      try {
        setCreatingCampaignBusy(true);
        const res = await window.campaignAPI.update(editingCampaignId, {
          name: baseName,
          template: { text: templateText, variables: ['name'], media: null },
          leads: mapRecipientsToPayload(campaignRecipients, campaignConnectionIds),
        });
        if (res?.success) {
          closeCampaignModal();
          setCampaignRecipients([]);
          loadCampaigns();
          addLog(`[CAMPAIGN] Lista da campanha atualizada (${campaignRecipients.length} destinatários).`);
        } else {
          alert('Erro ao salvar: ' + (res?.error || 'desconhecido'));
        }
      } catch (err) {
        alert('Erro: ' + err.message);
      } finally {
        setCreatingCampaignBusy(false);
      }
      return;
    }

    const connIds = (campaignConnectionIds.length
      ? campaignConnectionIds
      : [campaignConnectionId || activeConnectionId].filter(Boolean)
    ).filter((id) => connectedSessions.some((c) => c.id === id));

    if (!connIds.length) {
      alert('Selecione ao menos um número WhatsApp conectado.');
      return;
    }
    if (campaignRecipients.length === 0) {
      alert('Adicione ao menos um destinatário (lead, contato, grupo ou número manual).');
      return;
    }
    if (!templateText.trim()) {
      alert('Escreva o template da mensagem.');
      return;
    }

    const campSettings = settings.campaigns || {};
    const schedule = {
      mode: scheduleMode,
      intervalMs: Math.max(5000, intervalSec * 1000),
      startAt: scheduleMode === 'scheduled' && scheduleStartAt
        ? Math.floor(new Date(scheduleStartAt).getTime())
        : null,
      // Herda janela global (pode ser desligada nas configs)
      workingHours: campSettings.workingHoursEnabled === false
        ? { enabled: false }
        : {
            enabled: true,
            start: campSettings.workingHoursStart || '07:00',
            end: campSettings.workingHoursEnd || '18:00',
          },
    };
    const template = { text: templateText, variables: ['name'], media: null };
    const leads = mapRecipientsToPayload(campaignRecipients, connIds);

    try {
      setCreatingCampaignBusy(true);
      const res = await window.campaignAPI.create({
        name: baseName,
        provider: providerType,
        connectionId: connIds[0],
        connectionIds: connIds,
        template,
        leadIds: leads,
        schedule,
      });
      if (res?.success) {
        closeCampaignModal();
        setNewCampaignName('');
        setCampaignRecipients([]);
        loadCampaigns();
        addLog(
          connIds.length > 1
            ? `[CAMPAIGN] "${baseName}" criada com ${campaignRecipients.length} leads em ${connIds.length} números (relatório unificado).`
            : `[CAMPAIGN] Campanha "${baseName}" criada com ${campaignRecipients.length} destinatário(s).`,
        );
      } else {
        alert(`Erro ao criar campanha: ${res?.error || 'desconhecido'}`);
      }
    } catch (err) {
      alert('Erro: ' + err.message);
    } finally {
      setCreatingCampaignBusy(false);
    }
  };

  const filteredCampaigns = useMemo(() => {
    const q = campaignSearch.trim().toLowerCase();
    let list = [...(campaigns || [])];
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
  }, [campaigns, campaignSearch, campaignSort, connections]);

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

  const wizardSteps = [
    { id: 'basics', label: 'Números', desc: 'Nome e conexões' },
    { id: 'recipients', label: 'Destinatários', desc: 'Quem vai receber' },
    { id: 'message', label: 'Mensagem', desc: 'Texto da mensagem' },
    { id: 'schedule', label: 'Disparo', desc: 'Intervalo e agenda' },
    { id: 'review', label: 'Revisar', desc: 'Confirmar e criar' },
  ];

  const canWizardNext = () => {
    if (editingCampaignId) return true;
    if (campaignWizardStep === 0) {
      // Nome opcional (vazio → nome automático na criação)
      return campaignConnectionIds.length > 0;
    }
    if (campaignWizardStep === 1) return campaignRecipients.length > 0;
    if (campaignWizardStep === 2) return !!templateText.trim();
    if (campaignWizardStep === 3) {
      if (scheduleMode === 'scheduled' && !scheduleStartAt) return false;
      return intervalSec >= 5;
    }
    return true;
  };

  const goWizardNext = () => {
    if (!canWizardNext()) {
      if (campaignWizardStep === 0) alert('Selecione ao menos um número WhatsApp conectado.');
      else if (campaignWizardStep === 1) alert('Adicione ao menos um destinatário.');
      else if (campaignWizardStep === 2) alert('Escreva a mensagem da campanha.');
      else if (campaignWizardStep === 3) alert('Confira o intervalo e o agendamento.');
      return;
    }
    // Se o nome estiver vazio ao sair do passo 0, preenche genérico
    if (campaignWizardStep === 0 && !(newCampaignName || '').trim()) {
      setNewCampaignName(buildDefaultCampaignName());
    }
    setCampaignWizardStep((s) => Math.min(wizardSteps.length - 1, s + 1));
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
                  <span className="camp-browse-meta">{l.phone}</span>
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

      {/* GRUPOS LEAD SCORING */}
      {recipientSourceTab === 'groups' && (
        <div className="camp-rcp-pane">
          <p className="camp-hint" style={{ marginBottom: 8 }}>
            Grupos salvos em “Quem ligar primeiro” (Lead Scoring).
          </p>
          {scoringGroups.length === 0 ? (
            <div className="camp-empty-mini">
              <Users size={20} />
              <p>Nenhum grupo ainda</p>
              <span>Analise leads no Lead Scoring e salve em um grupo.</span>
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
                  <span>{g.count || (g.leadIds || []).length} leads · toque para adicionar</span>
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
                  <span className="camp-browse-meta">
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
                    <User size={12} /> {c.name || c.phone}
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
                <strong style={{ display: 'block' }}>
                  {r.isGroup ? '👥 ' : '👤 '}
                  {r.name || r.phone || r.jid}
                </strong>
                <span className="camp-hint" style={{ margin: 0 }}>
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

  const handleStartCampaign = async (id) => {
    if (!window.campaignAPI) return;
    // Preferência: número ativo na UI (o que o user está vendo como conectado)
    const connId =
      activeConnectionId ||
      campaignConnectionId ||
      connectedSessions[0]?.id ||
      null;
    try {
      const res = await window.campaignAPI.start(id, connId);
      if (res && res.success === false) {
        alert('Não foi possível iniciar: ' + (res.error || 'erro desconhecido'));
        addLog(`[CAMPAIGN] Falha ao iniciar: ${res.error || 'erro'}`);
        return;
      }
      loadCampaigns();
      window.dispatchEvent(new CustomEvent('sigma:campaign-started', { detail: { campaignId: id } }));
      addLog(
        `[CAMPAIGN] Campanha iniciada` +
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

  const handleResumeCampaign = async (id) => {
    if (!window.campaignAPI) return;
    const connId =
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
    html = html.replace(/\n/g, '<br/>');
    return html;
  };

  const chatCounts = useMemo(() => {
    const unread = chats.filter((c) => getUnread(c) > 0).length;
    const groups = chats.filter((c) => c.isGroup).length;
    return {
      all: chats.length,
      unread,
      groups,
      archived: archivedChats.length,
    };
  }, [chats, archivedChats]);

  const filteredChats = useMemo(() => {
    const source = chatFilter === 'archived' ? archivedChats : chats;
    let list = source;
    if (chatFilter === 'unread') list = source.filter((c) => getUnread(c) > 0);
    if (chatFilter === 'groups') list = source.filter((c) => c.isGroup);
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
          className={`chat-bubble ${fromMe ? 'out' : 'in'}${isSticker ? ' sticker-bubble' : ''}${menuOpen ? ' menu-open' : ''}`}
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
              <div className="chat-msg-menu-preview">{previewText.slice(0, 48)}</div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', height: '100%' }}>
      {/* Subtab Nav — reusa .wa-tabs/.wa-tab do styles.css */}
      <div className="wa-tabs" style={{ flexShrink: 0 }}>
        <button className={`wa-tab ${waTab === 'connect' ? 'act' : ''}`} onClick={() => setWaTab('connect')}>
          <Plug size={14} /> Conexão
        </button>
        <button
          className={`wa-tab ${waTab === 'campaigns' ? 'act' : ''}`}
          onClick={() => {
            setWaTab('campaigns');
          }}
        >
          <ListTodo size={14} /> Campanhas
        </button>
        {monitoringCampaignId && (
          <button className={`wa-tab ${waTab === 'monitor' ? 'act' : ''}`} onClick={() => setWaTab('monitor')}>
            <Activity size={14} /> Monitoramento ({monitoringCampaign?.name})
          </button>
        )}
        <button className={`wa-tab ${waTab === 'chats' ? 'act' : ''}`} onClick={() => setWaTab('chats')}>
          <MessageSquare size={14} /> Conversas
        </button>
        <button className={`wa-tab ${waTab === 'settings' ? 'act' : ''}`} onClick={() => setWaTab('settings')}>
          <Settings size={14} /> Configurações
        </button>
      </div>

      {/* Main Panel Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        
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
                            <strong style={{ fontSize: '13px' }}>{c.phoneNumber || c.id}</strong>
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
          <div className="camp-hub" style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div className="camp-hub-hero camp-hub-hero-compact">
              <div>
                <h2 style={{ margin: 0 }}>Campanhas</h2>
              </div>
              <button className="btn btn-primary" onClick={openCreateCampaign} style={{ gap: 8 }}>
                <PlusCircle size={16} /> Nova
              </button>
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
                <div className="camp-list-toolbar">
                  <div className="camp-search-wrap">
                    <Search size={14} />
                    <input
                      type="search"
                      className="camp-search-input"
                      placeholder="Buscar campanha, status ou número…"
                      value={campaignSearch}
                      onChange={(e) => setCampaignSearch(e.target.value)}
                    />
                  </div>
                  <select
                    className="camp-sort-select"
                    value={campaignSort}
                    onChange={(e) => setCampaignSort(e.target.value)}
                    title="Ordenar"
                  >
                    <option value="newest">Mais recentes</option>
                    <option value="oldest">Mais antigas</option>
                    <option value="name">Nome (A–Z)</option>
                  </select>
                </div>
                {filteredCampaigns.length === 0 ? (
                  <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
                    Nenhuma campanha encontrada para “{campaignSearch}”.
                  </p>
                ) : (
                  <div className="camp-cards">
                    {filteredCampaigns.map((c) => {
                      const stats = c.stats || {};
                      const sent = stats.sent || 0;
                      const total = stats.total || 0;
                      const read = stats.read || 0;
                      const replied = stats.replied || 0;
                      const pct = Math.round((sent / (total || 1)) * 100);
                      const canStart = ['ready', 'paused', 'cancelled'].includes(c.status);
                      const canPause = ['running', 'scheduled'].includes(c.status);
                      const startLabel =
                        c.status === 'paused' && c.pauseReason === 'daily_limit'
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
                      const statusLabel =
                        c.status === 'paused' && c.pauseReason === 'daily_limit'
                          ? 'Limite diário'
                          : c.status === 'running' && c.waitReason === 'outside_hours'
                            ? 'Fora do horário'
                            : c.status === 'running' && c.waitReason === 'no_provider'
                              ? 'Aguardando WhatsApp'
                              : {
                                  ready: 'Pronta',
                                  running: 'Em andamento',
                                  scheduled: 'Agendada',
                                  paused: 'Pausada',
                                  completed: 'Concluída',
                                  cancelled: 'Cancelada',
                                  failed: 'Com falhas',
                                }[c.status] || (c.status || 'Pronta');
                      return (
                        <div key={c.id} className={`camp-card status-${statusClass}`}>
                          <div className="camp-card-top">
                            <div className="camp-card-title-row">
                              <h4>{c.name}</h4>
                              <span className={`camp-status-badge ${statusClass}`}>{statusLabel}</span>
                            </div>
                            <div className="camp-card-date" title="Criada em">
                              <Clock size={11} /> {formatCampaignDate(c.createdAt)}
                            </div>
                            <div className="camp-phone-chips">
                              {phones.map((p) => (
                                <span key={p.id} className="camp-phone-chip" title={p.id}>
                                  <Phone size={11} /> {p.label}
                                </span>
                              ))}
                            </div>
                          </div>

                          <div className="camp-card-progress">
                            <div className="camp-card-progress-meta">
                              <span>{sent}/{total} enviados · {pct}%</span>
                              <span>{read} lidos · {replied} resp.</span>
                            </div>
                            <div className="camp-progress-bar">
                              <div className="camp-progress-fill" style={{ width: `${pct}%` }} />
                            </div>
                          </div>

                          {stats.byConnection && Object.keys(stats.byConnection).length > 1 && (
                            <div className="camp-card-by-conn">
                              {Object.values(stats.byConnection).map((row) => {
                                const label = phones.find((p) => p.id === row.connectionId)?.label
                                  || row.connectionId?.slice(0, 8)
                                  || '—';
                                return (
                                  <span key={row.connectionId || 'none'}>
                                    {label}: {row.sent || 0}/{row.total || 0}
                                  </span>
                                );
                              })}
                            </div>
                          )}

                          <div className="camp-card-metrics">
                            <div>📖 {stats.readRate ?? 0}%</div>
                            <div>💬 {stats.replyRate ?? 0}%</div>
                          </div>

                          <div className="camp-card-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => handleMonitorCampaign(c.id)}>
                              <Activity size={12} /> Relatório
                            </button>
                            <button type="button" className="btn btn-secondary" title="Editar destinatários" onClick={() => openEditCampaignList(c)}>
                              <Pencil size={12} /> Lista
                            </button>
                            {canStart ? (
                              <button type="button" className="btn btn-primary" onClick={() => (c.status === 'paused' ? handleResumeCampaign(c.id) : handleStartCampaign(c.id))}>
                                <Play size={12} /> {startLabel}
                              </button>
                            ) : canPause ? (
                              <button type="button" className="btn btn-danger" onClick={() => handlePauseCampaign(c.id)}>
                                <Pause size={12} /> Pausar
                              </button>
                            ) : null}
                            <button type="button" className="btn btn-danger" onClick={() => handleDeleteCampaign(c.id)} title="Apagar">
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

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
                    <div>
                      <h3 id="camp-wizard-title" style={{ margin: 0 }}>
                        {editingCampaignId ? 'Editar lista da campanha' : 'Nova campanha'}
                      </h3>
                      <p className="camp-wizard-sub">
                        {editingCampaignId
                          ? 'Atualize os destinatários desta campanha.'
                          : `Passo ${campaignWizardStep + 1} de ${wizardSteps.length} — ${wizardSteps[campaignWizardStep]?.desc}`}
                      </p>
                    </div>
                    <button type="button" className="camp-wizard-close" onClick={closeCampaignModal} aria-label="Fechar">
                      <X size={18} />
                    </button>
                  </div>

                  {!editingCampaignId && (
                    <div className="camp-wizard-steps">
                      {wizardSteps.map((step, idx) => {
                        const done = idx < campaignWizardStep;
                        const act = idx === campaignWizardStep;
                        return (
                          <button
                            key={step.id}
                            type="button"
                            tabIndex={-1}
                            className={`camp-wizard-step ${act ? 'act' : ''} ${done ? 'done' : ''}`}
                            onClick={() => {
                              if (idx <= campaignWizardStep) setCampaignWizardStep(idx);
                            }}
                          >
                            <span className="camp-wizard-step-num">
                              {done ? <Check size={12} /> : idx + 1}
                            </span>
                            <span className="camp-wizard-step-label">{step.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="camp-wizard-body">
                    {/* EDIT MODE: recipients only */}
                    {editingCampaignId && (
                      <div className="camp-wizard-pane">
                        <div className="camp-field">
                          <label htmlFor="camp-name-input-edit">Nome</label>
                          <CampaignNameInput
                            id="camp-name-input-edit"
                            initialValue={newCampaignName}
                            onChange={setNewCampaignName}
                            placeholder="Nome da campanha"
                          />
                        </div>
                        {renderRecipientsEditor()}
                      </div>
                    )}

                    {/* STEP 0: name + numbers */}
                    {!editingCampaignId && campaignWizardStep === 0 && (
                      <div className="camp-wizard-pane">
                        <div className="camp-field">
                          <label htmlFor="camp-name-input">Nome da campanha</label>
                          <CampaignNameInput
                            id="camp-name-input"
                            inputRef={campaignNameInputRef}
                            initialValue={newCampaignName}
                            onChange={setNewCampaignName}
                          />
                          <p className="camp-hint">
                            Pode editar à vontade. Se ficar vazio, usa algo como
                            {' '}<code>{buildDefaultCampaignName()}</code>.
                          </p>
                        </div>

                        <div className="camp-field">
                          <span>Números que vão disparar</span>
                          <p className="camp-hint">
                            Selecione um ou mais WhatsApps conectados. Com vários números, os leads são divididos entre eles (round-robin).
                          </p>
                          {connectedSessions.length === 0 ? (
                            <div className="camp-alert">
                              Nenhum número conectado. Vá em <strong>Conexão</strong> e escaneie o QR primeiro.
                            </div>
                          ) : (
                            <div className="camp-conn-grid">
                              {connectedSessions.map((c) => {
                                const selected = campaignConnectionIds.includes(c.id);
                                return (
                                  <button
                                    key={c.id}
                                    type="button"
                                    className={`camp-conn-card ${selected ? 'selected' : ''}`}
                                    onClick={() => toggleCampaignConnection(c.id)}
                                  >
                                    <span className="camp-conn-check">{selected ? <Check size={14} /> : <Phone size={14} />}</span>
                                    <div>
                                      <strong>{c.phoneNumber || c.id}</strong>
                                      <div className="camp-hint" style={{ margin: 0 }}>
                                        {c.active ? 'Ativo agora' : 'Conectado'} · {c.id.slice(0, 10)}…
                                      </div>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          {campaignConnectionIds.length > 1 && campaignRecipients.length > 0 && (
                            <div className="camp-split-preview">
                              ~{Math.ceil(campaignRecipients.length / campaignConnectionIds.length)} leads por número
                              (ajuste a lista no próximo passo)
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* STEP 1: recipients */}
                    {!editingCampaignId && campaignWizardStep === 1 && (
                      <div className="camp-wizard-pane">
                        {campaignConnectionIds.length > 1 && (
                          <div className="camp-split-preview">
                            {campaignConnectionIds.length} números · lista será dividida automaticamente na criação
                          </div>
                        )}
                        {renderRecipientsEditor()}
                      </div>
                    )}

                    {/* STEP 2: message */}
                    {!editingCampaignId && campaignWizardStep === 2 && (
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

                    {/* STEP 3: schedule */}
                    {!editingCampaignId && campaignWizardStep === 3 && (
                      <div className="camp-wizard-pane">
                        <div className="camp-field-row">
                          <label className="camp-field">
                            <span>Intervalo entre envios (segundos)</span>
                            <input
                              type="number"
                              min={5}
                              value={intervalSec}
                              onChange={(e) => setIntervalSec(parseInt(e.target.value, 10) || 30)}
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
                            <span>Iniciar em</span>
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
                          Ao bater o limite, a campanha pausa e retoma no próximo dia ou ao reiniciar o app.
                        </div>
                      </div>
                    )}

                    {/* STEP 4: review */}
                    {!editingCampaignId && campaignWizardStep === 4 && (
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
                              }).join(' · ') || '—'}
                            </li>
                            <li><strong>Destinatários:</strong> {campaignRecipients.length}</li>
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
                                ? `agendado (${scheduleStartAt || '—'})`
                                : scheduleMode === 'immediate'
                                  ? 'imediato rápido'
                                  : `intervalo ${intervalSec}s`}
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
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="camp-wizard-footer">
                    <button type="button" className="btn btn-secondary" onClick={closeCampaignModal}>
                      Cancelar
                    </button>
                    <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                      {editingCampaignId ? (
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={creatingCampaignBusy || !campaignRecipients.length}
                          onClick={handleCreateCampaign}
                        >
                          {creatingCampaignBusy ? 'Salvando…' : 'Salvar lista'}
                        </button>
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
                              Próximo <ChevronRight size={14} />
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
                                : campaignConnectionIds.length > 1
                                  ? `Criar ${campaignConnectionIds.length} campanhas`
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
        )}

        {/* MONITOR TAB — sem IIFE, variáveis locais estáveis */}
        {waTab === 'monitor' && monitoringCampaign ? (
          <CampaignMonitorView
            campaign={monitoringCampaign}
            connections={connections}
            onBack={leaveMonitor}
          />
        ) : null}

        {/* CHATS TAB */}
        {waTab === 'chats' && (
          <div className="chat-shell">
            {/* Left Chats List */}
            <aside className="chat-list">
              <div className="chat-list-header">
                <div className="chat-search-wrap">
                  <Search size={14} className="chat-search-icon" />
                  <input
                    className="chat-search-input"
                    placeholder="Buscar nome, telefone ou mensagem..."
                    value={chatSearch}
                    onChange={(e) => setChatSearch(e.target.value)}
                  />
                </div>
                <div className="chat-filter-tabs">
                  {[
                    { id: 'all', label: 'Tudo', count: chatCounts.all },
                    { id: 'unread', label: 'Não lidas', count: chatCounts.unread },
                    { id: 'groups', label: 'Grupos', count: chatCounts.groups },
                    { id: 'archived', label: 'Arquivadas', count: chatCounts.archived },
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
              <div className="chat-threads">
                {filteredChats.length === 0 ? (
                  <div className="chat-empty-list">
                    {chatFilter === 'unread' && 'Nenhuma conversa não lida.'}
                    {chatFilter === 'groups' && 'Nenhum grupo sincronizado.'}
                    {chatFilter === 'archived' && 'Nenhuma conversa arquivada.'}
                    {chatFilter === 'all' && 'Nenhuma conversa sincronizada.'}
                  </div>
                ) : (
                  filteredChats.map((c) => {
                    const unread = getUnread(c);
                    const name = c.name || c.phone || c.jid.split('@')[0];
                    return (
                      <div
                        key={c.jid}
                        className={`chat-thread ${activeChatJid === c.jid ? 'active' : ''}${unread > 0 ? ' unread' : ''}`}
                        onClick={() => handleSelectChat(c)}
                      >
                        <div className="chat-avatar-wrap">
                          {renderAvatar(c.jid, name, 44, !!c.isGroup)}
                          {c.isGroup && <span className="chat-avatar-group-badge" title="Grupo"><Users size={10} /></span>}
                        </div>
                        <div className="chat-thread-details">
                          <div className="top-row">
                            <strong>
                              {c.pinned ? <Pin size={11} className="chat-pin-icon" /> : null}
                              {name}
                            </strong>
                            <span className={unread > 0 ? 'chat-time unread' : 'chat-time'}>
                              {formatChatTime(c.timestamp)}
                            </span>
                          </div>
                          <div className="chat-thread-preview-row">
                            <p>{c.lastMessage || (c.isGroup ? 'Grupo' : c.phone || 'Sem mensagens')}</p>
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
                      </div>
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
                      className="chat-room-header-left chat-room-profile-btn"
                      onClick={openContactProfile}
                      title="Ver perfil"
                    >
                      {renderAvatar(activeChatJid, activeChatName, 40, !!activeChatMeta?.isGroup)}
                      <div style={{ textAlign: 'left' }}>
                        <strong>{activeChatName}</strong>
                        <div className={`chat-presence ${chatPresence?.online ? '' : 'offline'}`}>
                          {chatPresence?.online && <span className="dot" />}
                          <span>
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
                    <div className="chat-room-header-actions" style={{ position: 'relative' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '6px 10px', fontSize: '11px' }}
                        title="Etiquetar este contato"
                        onClick={() => setTagPickerOpen((v) => !v)}
                      >
                        <Tag size={12} />
                      </button>
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
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '6px 10px', fontSize: '11px' }}
                        title="Atualizar conversa"
                        onClick={() => {
                          const chat = [...chats, ...archivedChats].find((x) => x.jid === activeChatJid);
                          if (chat) handleSelectChat(chat);
                        }}
                      >
                        <RefreshCw size={12} />
                      </button>
                    </div>
                  </div>

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
                      <Paperclip size={16} />
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
                        <Send size={14} />
                      </button>
                    )}
                  </form>
                </>
              ) : (
                <div className="chat-empty-room">
                  <MessageSquare size={48} />
                  <p>Selecione uma conversa ao lado para enviar mensagens.</p>
                  <span>Filtre por não lidas, grupos ou arquivadas — como no WhatsApp.</span>
                </div>
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
                    <h3>{profileInfo?.name || activeChatName}</h3>
                    <p className="chat-profile-phone">
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
                  Ao atingir o teto, a campanha pausa e continua no próximo dia (ou ao reiniciar o app com cota livre).
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
                          {cn?.phoneNumber || id.slice(0, 8)}: {used}/{lim}
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
function CampaignMonitorView({ campaign, onBack, connections = [] }) {
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
      ? 'Limite diário (salva — retoma depois)'
      : {
          ready: 'Pronta',
          running: 'Em andamento',
          scheduled: 'Agendada',
          paused: 'Pausada',
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
                  <span style={{ color: 'var(--muted)' }}>{lead.phone || lead.jid || 'sem destino'}</span>
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
