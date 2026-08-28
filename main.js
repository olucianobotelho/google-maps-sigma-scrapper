const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFile } = require("child_process");
const QRCode = require("qrcode");

// Suppress GPU and Cache errors in console
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
app.commandLine.appendSwitch("disable-software-rasterizer");
// Reduz cache de disco do Chromium (evita JS antigo tipo index-BC5opcok.js)
app.commandLine.appendSwitch("disable-http-cache");
app.commandLine.appendSwitch("disk-cache-size", "1");

let ffmpegPath = "ffmpeg";
try {
  ffmpegPath = require("ffmpeg-static") || "ffmpeg";
} catch (e) {}
const { scrapeGoogleMaps } = require("./scraper");
const { saveToCSV } = require("./utils/csv");
const { saveReport } = require("./utils/report");
const {
  assertAllowedMediaPath,
  assertConnectionId,
  assertMaxBytes,
  clampInteger,
  createConnectionId,
  isHttpUrl,
  limitString,
  resolveInside,
} = require("./utils/security");
const { WhatsAppProviderFactory } = require("./whatsapp/provider");
const { normalizePhone } = require("./whatsapp/phone-normalizer");
const { CampaignManager } = require("./campaigns/campaign-manager");
const {
  interpolate: interpolateTemplate,
} = require("./campaigns/template-engine");
const { LeadScoringService } = require("./lead-scoring");
const { saveProspectingCSV } = require("./lead-scoring/export-service");

const autoUpdaterMod = require("./utils/auto-updater");
const { ensureInstallId } = require("./utils/install-id");
const appMetrics = require("./utils/app-metrics");

let mainWindow;
const whatsappProviders = new Map();
let activeWhatsAppId = null;
let campaignManager = null;
let leadScoringService = null;
const resultStore = new Map();
const allowedMediaPaths = new Set();
const activeScrapes = new Map();
const { LIMIT_TIERS } = require("./campaigns/daily-quota");

const defaultWhatsAppSettings = {
  notifications: {
    desktop: true,
    sound: true,
    showPreview: true,
    notifyGroups: true,
    quietHours: null,
  },
  media: {
    autoDownloadImages: true,
    autoDownloadAudio: true,
    autoDownloadVideos: false,
    autoDownloadDocuments: false,
    autoDownloadStickers: true,
    maxAutoDownloadBytes: 5 * 1024 * 1024,
    cacheLimitBytes: 1024 * 1024 * 1024,
  },
  previews: {
    links: true,
    pdf: true,
    videoPreloadBytes: 5 * 1024 * 1024,
  },
  groups: {
    allowFunnels: false,
    confirmFunnels: true,
    allowCampaigns: false,
    downloadPictures: true,
  },
  /** Regras de disparo de campanhas (anti-ban / aquecimento) */
  campaigns: {
    // Limite diário por número: 10 | 30 | 60 | 100
    dailyLimit: 10,
    // Tiers já liberados pelo usuário (progressivo)
    unlockedLimits: [10],
    // true = sem limite (por conta e risco)
    manualUnlimited: false,
    // Janela de envio (horário local)
    workingHoursEnabled: true,
    workingHoursStart: "07:00",
    workingHoursEnd: "18:00",
  },
};
let cachedWhatsAppSettings = null;

const MAX_SCRAPE_RESULTS = 1000;
const MAX_QUERY_LENGTH = 200;
const MAX_EXPORT_LEADS = 20000;
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
const MAX_STICKER_BYTES = 5 * 1024 * 1024;

function getSessionsRoot() {
  return path.join(app.getPath("userData"), "whatsapp-sessions");
}

function resolveSessionPath(connectionId) {
  return resolveInside(getSessionsRoot(), assertConnectionId(connectionId));
}

function rememberAllowedMediaPath(filePath) {
  if (!filePath) return;
  allowedMediaPaths.add(path.resolve(filePath));
  saveAllowedMediaPaths();
}

function getAllowedMediaStorePath() {
  return path.join(app.getPath("userData"), "allowed-media-paths.json");
}

function getWhatsAppSettingsPath() {
  return path.join(app.getPath("userData"), "whatsapp-settings.json");
}

function loadWhatsAppSettings() {
  if (cachedWhatsAppSettings) return cachedWhatsAppSettings;
  try {
    const filePath = getWhatsAppSettingsPath();
    if (fs.existsSync(filePath)) {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      cachedWhatsAppSettings = {
        ...defaultWhatsAppSettings,
        ...raw,
        notifications: { ...defaultWhatsAppSettings.notifications, ...(raw.notifications || {}) },
        media: { ...defaultWhatsAppSettings.media, ...(raw.media || {}) },
        previews: { ...defaultWhatsAppSettings.previews, ...(raw.previews || {}) },
        groups: { ...defaultWhatsAppSettings.groups, ...(raw.groups || {}) },
        campaigns: normalizeCampaignSettings({
          ...defaultWhatsAppSettings.campaigns,
          ...(raw.campaigns || {}),
        }),
      };
      return cachedWhatsAppSettings;
    }
  } catch (e) {}
  cachedWhatsAppSettings = JSON.parse(JSON.stringify(defaultWhatsAppSettings));
  return cachedWhatsAppSettings;
}

function normalizeCampaignSettings(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  let dailyLimit = Number(input.dailyLimit);
  if (!LIMIT_TIERS.includes(dailyLimit)) dailyLimit = 10;
  let unlocked = Array.isArray(input.unlockedLimits)
    ? input.unlockedLimits.map(Number).filter((n) => LIMIT_TIERS.includes(n))
    : [10];
  if (!unlocked.includes(10)) unlocked = [10, ...unlocked];
  unlocked = [...new Set(unlocked)].sort((a, b) => a - b);
  // Garante que o limite atual está desbloqueado
  if (!unlocked.includes(dailyLimit) && !input.manualUnlimited) {
    dailyLimit = Math.max(...unlocked);
  }
  const hhmm = (v, fallback) => {
    const s = String(v || "").trim();
    return /^\d{1,2}:\d{2}$/.test(s) ? s.padStart(5, "0") : fallback;
  };
  return {
    dailyLimit,
    unlockedLimits: unlocked,
    manualUnlimited: !!input.manualUnlimited,
    workingHoursEnabled: input.workingHoursEnabled !== false,
    workingHoursStart: hhmm(input.workingHoursStart, "07:00"),
    workingHoursEnd: hhmm(input.workingHoursEnd, "18:00"),
  };
}

function saveWhatsAppSettings(nextSettings) {
  cachedWhatsAppSettings = {
    ...defaultWhatsAppSettings,
    ...(nextSettings || {}),
    notifications: {
      ...defaultWhatsAppSettings.notifications,
      ...((nextSettings || {}).notifications || {}),
    },
    media: {
      ...defaultWhatsAppSettings.media,
      ...((nextSettings || {}).media || {}),
    },
    previews: {
      ...defaultWhatsAppSettings.previews,
      ...((nextSettings || {}).previews || {}),
    },
    groups: {
      ...defaultWhatsAppSettings.groups,
      ...((nextSettings || {}).groups || {}),
    },
    campaigns: normalizeCampaignSettings({
      ...defaultWhatsAppSettings.campaigns,
      ...((nextSettings || {}).campaigns || {}),
    }),
  };
  try {
    fs.writeFileSync(
      getWhatsAppSettingsPath(),
      JSON.stringify(cachedWhatsAppSettings, null, 2),
      { mode: 0o600 },
    );
  } catch (e) {}
  return cachedWhatsAppSettings;
}

function loadAllowedMediaPaths() {
  try {
    const storePath = getAllowedMediaStorePath();
    if (!fs.existsSync(storePath)) return;
    const paths = JSON.parse(fs.readFileSync(storePath, "utf-8"));
    if (Array.isArray(paths)) {
      paths.filter((p) => typeof p === "string").forEach((p) => allowedMediaPaths.add(path.resolve(p)));
    }
  } catch (e) {
    /* ignore */
  }
}

function saveAllowedMediaPaths() {
  if (!app.isReady()) return;
  try {
    const paths = [...allowedMediaPaths].slice(-1000);
    fs.writeFileSync(getAllowedMediaStorePath(), JSON.stringify(paths, null, 2), { mode: 0o600 });
  } catch (e) {
    /* ignore */
  }
}

function isInsideTriggerAudioDir(filePath) {
  try {
    const root = path.resolve(getTriggerAudioDir());
    const resolved = path.resolve(filePath);
    return resolved === root || resolved.startsWith(root + path.sep);
  } catch {
    return false;
  }
}

function resolveSelectedMediaPath(filePath, maxBytes, label) {
  // Cliques de gatilho em userData/trigger-audio são sempre permitidos
  if (typeof filePath === "string" && isInsideTriggerAudioDir(filePath)) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) throw new Error("Arquivo de áudio do gatilho não encontrado");
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error("Selected path is not a file");
    assertMaxBytes(stat.size, maxBytes, label);
    rememberAllowedMediaPath(resolved);
    return resolved;
  }
  const resolved = assertAllowedMediaPath(filePath, allowedMediaPaths);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error("Selected path is not a file");
  assertMaxBytes(stat.size, maxBytes, label);
  return resolved;
}

function sanitizeTemplate(template) {
  if (typeof template === "string") {
    return limitString(template, 4096);
  }
  const input = template && typeof template === "object" ? template : {};
  const output = {
    text: limitString(input.text, 4096),
    variables: Array.isArray(input.variables)
      ? input.variables.map((v) => limitString(v, 40)).slice(0, 50)
      : [],
  };
  if (input.header) output.header = limitString(input.header, 512);
  if (input.footer) output.footer = limitString(input.footer, 512);
  if (Array.isArray(input.buttons)) {
    output.buttons = input.buttons.slice(0, 3).map((button, index) => ({
      id: limitString(button.id || button.buttonId || `btn_${index + 1}`, 64),
      text: limitString(button.text || button.buttonText, 80),
    }));
  }
  if (input.media && input.media.filePath) {
    const mediaPath = resolveSelectedMediaPath(input.media.filePath, MAX_MEDIA_BYTES, "Media file");
    output.media = {
      filePath: mediaPath,
      fileName: path.basename(mediaPath),
      mimetype: limitString(input.media.mimetype, 120),
      ptt: !!input.media.ptt,
    };
  }
  return output;
}

/**
 * Aceita:
 * - telefone: "21999999999" / "+55..."
 * - grupo: "120363...@g.us"
 * - objeto: { phone, jid, name, isGroup, source }
 */
function sanitizeCampaignRecipient(raw) {
  if (raw == null) return null;

  // string pura
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return null;
    if (s.endsWith("@g.us") || s.includes("@g.us")) {
      const jid = s.includes("@") ? s : `${s}@g.us`;
      return {
        leadId: `grp_${jid}`,
        name: jid.split("@")[0],
        phone: jid,
        phoneRaw: s,
        jid,
        isGroup: true,
        source: "group",
      };
    }
    const normalized = normalizePhone(s);
    if (!normalized.valid) return null;
    return {
      leadId: normalized.number,
      name: "",
      phone: normalized.number,
      phoneRaw: s,
      jid: `${normalized.number}@s.whatsapp.net`,
      isGroup: false,
      source: "manual",
    };
  }

  if (typeof raw !== "object") return null;

  const name = limitString(raw.name || raw.company || raw.notify || "", 120, "");
  const source = limitString(raw.source || "manual", 40, "manual");
  const jidRaw = String(raw.jid || raw.phone || "").trim();

  // Grupo WhatsApp
  if (
    raw.isGroup === true ||
    jidRaw.endsWith("@g.us") ||
    String(raw.phone || "").includes("@g.us")
  ) {
    let jid = jidRaw || String(raw.phone || "").trim();
    if (!jid) return null;
    if (!jid.includes("@")) jid = `${jid}@g.us`;
    if (!jid.endsWith("@g.us")) return null;
    let connectionId = null;
    if (raw.connectionId) {
      try {
        connectionId = assertConnectionId(raw.connectionId);
      } catch {
        connectionId = null;
      }
    }
    return {
      leadId: limitString(raw.leadId || `grp_${jid}`, 120, `grp_${jid}`),
      name: name || jid.split("@")[0],
      phone: jid,
      phoneRaw: raw.phoneRaw || jid,
      jid,
      isGroup: true,
      source: source === "manual" ? "group" : source,
      connectionId,
      company: limitString(raw.company || name, 120, ""),
      category: limitString(raw.category, 80, "grupo"),
    };
  }

  // Contato / lead com telefone
  const rawPhone = raw.phone || raw.phoneRaw || (jidRaw.includes("@") ? jidRaw.replace(/@.*$/, "") : jidRaw);
  const normalized = normalizePhone(String(rawPhone || ""));
  if (!normalized.valid) return null;
  const jid =
    jidRaw.endsWith("@s.whatsapp.net") || jidRaw.endsWith("@lid")
      ? jidRaw
      : `${normalized.number}@s.whatsapp.net`;
  let connectionId = null;
  if (raw.connectionId) {
    try {
      connectionId = assertConnectionId(raw.connectionId);
    } catch {
      connectionId = null;
    }
  }
  return {
    leadId: limitString(raw.leadId || raw.id || normalized.number, 120, normalized.number),
    name,
    phone: normalized.number,
    phoneRaw: String(rawPhone || normalized.number),
    jid,
    isGroup: false,
    source,
    connectionId,
    company: limitString(raw.company || name, 120, ""),
    category: limitString(raw.category, 80, ""),
    website: limitString(raw.website || raw.site, 240, ""),
    site: limitString(raw.website || raw.site, 240, ""),
    instagram: limitString(raw.instagram, 120, ""),
    email: limitString(raw.email, 160, ""),
    address: limitString(raw.address, 240, ""),
    rating: raw.rating || "",
    totalReviews: raw.totalReviews || "",
    score: raw.score || "",
    prioridade: limitString(raw.prioridade, 40, ""),
  };
}

function sanitizeCampaignData(data) {
  const input = data && typeof data === "object" ? data : {};
  const leads = Array.isArray(input.leadIds) ? input.leadIds.slice(0, 5000) : [];
  const seen = new Set();
  const normalizedLeads = [];
  for (const lead of leads) {
    const item = sanitizeCampaignRecipient(lead);
    if (!item) continue;
    const key = item.isGroup ? `g:${item.jid}` : `p:${item.phone}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalizedLeads.push(item);
  }
  if (!normalizedLeads.length) {
    throw new Error("Nenhum destinatário válido (telefone ou grupo)");
  }
  const intervalMs = clampInteger(input.schedule?.intervalMs, 5000, 60 * 60 * 1000, 30000);
  let connectionIds = [];
  if (Array.isArray(input.connectionIds)) {
    for (const rawId of input.connectionIds) {
      try {
        const id = assertConnectionId(rawId);
        if (!connectionIds.includes(id)) connectionIds.push(id);
      } catch {
        /* skip invalid */
      }
    }
  }
  let connectionId = null;
  if (input.connectionId) {
    try {
      connectionId = assertConnectionId(input.connectionId);
    } catch {
      connectionId = null;
    }
  }
  if (!connectionId && connectionIds[0]) connectionId = connectionIds[0];
  if (connectionId && !connectionIds.includes(connectionId)) {
    connectionIds = [connectionId, ...connectionIds];
  }

  // Propaga connectionId por lead (round-robin se multi e lead sem id)
  const leadsWithConn = normalizedLeads.map((lead, idx) => {
    let leadConn = lead.connectionId || null;
    if (leadConn) {
      try {
        leadConn = assertConnectionId(leadConn);
      } catch {
        leadConn = null;
      }
    }
    if (!leadConn && connectionIds.length) {
      leadConn = connectionIds[idx % connectionIds.length];
    }
    return { ...lead, connectionId: leadConn };
  });

  let workingHours = null;
  if (input.schedule?.workingHours && typeof input.schedule.workingHours === "object") {
    const wh = input.schedule.workingHours;
    workingHours = {
      enabled: wh.enabled !== false,
      start: limitString(wh.start || "07:00", 8, "07:00"),
      end: limitString(wh.end || "18:00", 8, "18:00"),
    };
  }

  return {
    ...input,
    id: input.id ? limitString(input.id, 80) : undefined,
    name: limitString(input.name, 160, "Campanha"),
    provider: input.provider === "meta" ? "meta" : "baileys",
    connectionId,
    connectionIds,
    template: sanitizeTemplate(input.template),
    leadIds: leadsWithConn,
    schedule: {
      mode: ["immediate", "interval", "scheduled"].includes(input.schedule?.mode)
        ? input.schedule.mode
        : "interval",
      intervalMs,
      startAt: Number.isFinite(Number(input.schedule?.startAt))
        ? Number(input.schedule.startAt)
        : null,
      workingHours,
    },
  };
}

function sanitizeCampaignUpdates(updates) {
  const input = updates && typeof updates === "object" ? { ...updates } : {};
  if (input.connectionId) input.connectionId = assertConnectionId(input.connectionId);
  if (input.template) input.template = sanitizeTemplate(input.template);
  if (input.media && input.media.filePath) {
    const mediaPath = resolveSelectedMediaPath(input.media.filePath, MAX_MEDIA_BYTES, "Media file");
    input.media = { ...input.media, filePath: mediaPath, fileName: path.basename(mediaPath) };
  }
  if (input.name) input.name = limitString(input.name, 160);
  if (input.status && !["ready", "scheduled", "running", "paused", "completed", "cancelled"].includes(input.status)) {
    throw new Error("Invalid campaign status");
  }
  // Permite editar a lista de destinatários (leadIds ou leads)
  if (Array.isArray(input.leadIds) || Array.isArray(input.leads)) {
    const rawList = Array.isArray(input.leadIds) ? input.leadIds : input.leads;
    const seen = new Set();
    const leads = [];
    for (const item of rawList.slice(0, 5000)) {
      const row = sanitizeCampaignRecipient(item);
      if (!row) continue;
      const key = row.isGroup ? `g:${row.jid}` : `p:${row.phone}`;
      if (seen.has(key)) continue;
      seen.add(key);
      leads.push({
        ...row,
        status: item?.status && ["pending", "sent", "failed", "delivered", "read", "replied"].includes(item.status)
          ? item.status
          : "pending",
        errorMessage: item?.errorMessage || null,
        sentAt: item?.sentAt || null,
        deliveredAt: item?.deliveredAt || null,
        readAt: item?.readAt || null,
        repliedAt: item?.repliedAt || null,
        lastReplyAt: item?.lastReplyAt || null,
        responseTimeMs: item?.responseTimeMs ?? null,
        messageId: item?.messageId || null,
        retryCount: item?.retryCount || 0,
        openCount: Number(item?.openCount) || 0,
        openedAt: item?.openedAt || null,
        lastOpenAt: item?.lastOpenAt || null,
        replyCount: Number(item?.replyCount) || 0,
        replyTimestamps: Array.isArray(item?.replyTimestamps) ? item.replyTimestamps : [],
      });
    }
    if (!leads.length) throw new Error("Lista de destinatários ficou vazia");
    input.leads = leads;
    delete input.leadIds;
    try {
      const { recomputeStats } = require("./campaigns/campaign-analytics");
      input.stats = recomputeStats({ leads });
    } catch {
      input.stats = {
        total: leads.length,
        pending: leads.filter((l) => l.status === "pending").length,
        sent: leads.filter((l) => ["sent", "delivered", "read", "replied"].includes(l.status)).length,
        delivered: leads.filter((l) => ["delivered", "read", "replied"].includes(l.status)).length,
        read: leads.filter((l) => ["read", "replied"].includes(l.status)).length,
        replied: leads.filter((l) => l.repliedAt).length,
        failed: leads.filter((l) => l.status === "failed").length,
        avgResponseTimeMs: 0,
      };
    }
  }
  return input;
}

function mergeWhatsAppSettingsPatch(base, patch) {
  const input = patch && typeof patch === "object" ? patch : {};
  return {
    ...base,
    ...input,
    notifications: {
      ...base.notifications,
      ...(input.notifications || {}),
    },
    media: {
      ...base.media,
      ...(input.media || {}),
    },
    previews: {
      ...base.previews,
      ...(input.previews || {}),
    },
    groups: {
      ...base.groups,
      ...(input.groups || {}),
    },
    campaigns: normalizeCampaignSettings({
      ...(base.campaigns || defaultWhatsAppSettings.campaigns),
      ...(input.campaigns || {}),
    }),
  };
}

function getStickerStorePath() {
  return path.join(app.getPath("userData"), "whatsapp-stickers.json");
}

function loadStickerStore() {
  try {
    const filePath = getStickerStorePath();
    if (!fs.existsSync(filePath)) return [];
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Array.isArray(raw)
      ? raw.filter((item) => item?.filePath && fs.existsSync(item.filePath))
      : [];
  } catch (e) {
    return [];
  }
}

function saveStickerStore(stickers) {
  try {
    fs.writeFileSync(
      getStickerStorePath(),
      JSON.stringify(Array.isArray(stickers) ? stickers : [], null, 2),
      { mode: 0o600 },
    );
  } catch (e) {}
}

async function fetchLinkPreview(url) {
  if (!isHttpUrl(url)) throw new Error("Invalid URL");
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  const html = await res.text();
  const attr = (tag, name) => {
    const match = tag.match(new RegExp(`${name}=["']([^"']+)["']`, "i"));
    return match ? match[1].trim() : "";
  };
  const pickMeta = (key, value) => {
    const tags = html.match(/<meta\b[^>]*>/gi) || [];
    for (const tag of tags) {
      if (attr(tag, key).toLowerCase() === value.toLowerCase()) {
        return attr(tag, "content");
      }
    }
    return "";
  };
  const pickTitle = () => {
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return match ? match[1].trim() : "";
  };
  const title =
    pickMeta("property", "og:title") ||
    pickMeta("name", "twitter:title") ||
    pickTitle();
  const description =
    pickMeta("property", "og:description") ||
    pickMeta("name", "twitter:description") ||
    pickMeta("name", "description");
  const image = pickMeta("property", "og:image") || pickMeta("name", "twitter:image");
  const siteName = pickMeta("property", "og:site_name");
  return {
    success: true,
    url,
    title: limitString(title, 180),
    description: limitString(description, 240),
    image: limitString(image, 1024),
    siteName: limitString(siteName, 120),
    host: new URL(url).host,
  };
}

function safeSend(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    try {
      mainWindow.webContents.send(channel, ...args);
    } catch (e) {
      console.error(`Failed to send on channel ${channel}:`, e);
    }
  }
}

function sendAppMetrics(channel, payload) {
  safeSend(channel, payload);
}

/**
 * Carrega UI direto de renderer/dist (sem TEMP sticky).
 * Obs: NÃO bloqueia a string "monStats" no JS — ela só aparece no detector
 * de sessão antiga do ErrorBoundary, não no bug do monitor (já removido).
 */
function getUiIndexPath() {
  const indexSrc = path.join(__dirname, "renderer", "dist", "index.html");
  if (!fs.existsSync(indexSrc)) {
    throw new Error(`UI não encontrada: ${indexSrc}. Rode: npm run build:renderer`);
  }
  return indexSrc;
}

function purgeOldUiTemps() {
  try {
    const tempRoot = app.getPath("temp");
    for (const name of fs.readdirSync(tempRoot)) {
      if (!name.startsWith("sigma-ui-")) continue;
      try {
        fs.rmSync(path.join(tempRoot, name), { recursive: true, force: true });
      } catch { /* ignore lock */ }
    }
  } catch (e) {
    console.warn("[WINDOW] limpeza temp:", e.message);
  }
}

/** Assets atualmente no dist — qualquer outro index-*.js é lixo de cache */
function getAllowedUiAssetNames() {
  try {
    const assetsDir = path.join(__dirname, "renderer", "dist", "assets");
    if (!fs.existsSync(assetsDir)) return new Set();
    return new Set(fs.readdirSync(assetsDir));
  } catch {
    return new Set();
  }
}

function getCurrentUiStamp() {
  try {
    const html = fs.readFileSync(getUiIndexPath(), "utf8");
    const m = html.match(/sigma-ui-build"\s+content="([^"]+)"/i)
      || html.match(/\?v=(ui-[a-z0-9]+)/i)
      || html.match(/Sigma Control Center · (ui-[a-z0-9]+)/i);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

async function loadAppUi(win) {
  if (!win || win.isDestroyed()) return;
  purgeOldUiTemps();
  const ses = win.webContents.session;
  try {
    await ses.clearCache();
  } catch { /* ignore */ }
  try {
    await ses.clearStorageData({
      storages: ["cachestorage", "serviceworkers", "shadercache"],
    });
  } catch { /* ignore */ }
  try {
    const userData = app.getPath("userData");
    for (const dir of ["Cache", "Code Cache", "GPUCache", "Service Worker", "Shared Dictionary"]) {
      const full = path.join(userData, dir);
      if (fs.existsSync(full)) fs.rmSync(full, { recursive: true, force: true });
    }
  } catch (e) {
    console.warn("[WINDOW] cache disk:", e.message);
  }

  const indexHtml = getUiIndexPath();
  const stamp = getCurrentUiStamp();
  const assets = [...getAllowedUiAssetNames()];
  console.log("[WINDOW] carregando UI de:", indexHtml);
  console.log("[WINDOW] stamp:", stamp || "(?)");
  console.log("[WINDOW] assets permitidos:", assets.join(", ") || "(nenhum)");
  await win.loadFile(indexHtml);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    show: true,
    icon: path.join(__dirname, "assets", "icon.ico"),
    backgroundColor: resolveWindowBgColor(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  const ses = mainWindow.webContents.session;
  // Bloqueia bundles mortos + qualquer index-*.js que não exista no dist atual
  ses.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url || "";
    // hashes / sessões antigas conhecidas (inclui o stack do user: 7F4QwPd2 / ui-mrfg9u99)
    if (
      /BC5opcok|rad4ZrnG|7F4QwPd2|CaedZwU-|Dj5wJ2qb|DcxOVIQk|index-[A-Za-z0-9_-]+\.js|ui-mrfg9u99|ui-mrfgdzq8|ui-mrfggm2t|ui-mrfglw3f|sigma-ui-1783703330457/i.test(
        url,
      )
    ) {
      console.error("[WINDOW] BLOQUEADO asset antigo:", url);
      callback({ cancel: true });
      return;
    }
    const assetMatch = url.match(/\/assets\/(index-[^/?#]+\.(?:js|css))(?:\?|$)/i);
    if (assetMatch) {
      const allowed = getAllowedUiAssetNames();
      if (allowed.size > 0 && !allowed.has(assetMatch[1])) {
        console.error("[WINDOW] BLOQUEADO asset fora do dist:", assetMatch[1], "url=", url);
        callback({ cancel: true });
        return;
      }
    }
    callback({});
  });

  loadAppUi(mainWindow).catch((err) => {
    console.error("[WINDOW] falha ao carregar UI:", err.message);
    dialog.showErrorBox("UI não carregou", err.message);
  });

  mainWindow.webContents.on("did-finish-load", () => {
    const expectedStamp = getCurrentUiStamp();
    const allowed = [...getAllowedUiAssetNames()];
    mainWindow.webContents
      .executeJavaScript(`(function(){
        try {
          localStorage.removeItem('sigma_last_react_error');
          localStorage.removeItem('sigma_last_react_error_at');
        } catch (e) {}
        var scripts = [...document.scripts].map(function(s){ return s.src || ''; });
        var meta = (document.querySelector('meta[name="sigma-ui-build"]') || {}).content || '';
        var hasOld = scripts.some(function(s){
          return /BC5opcok|rad4ZrnG|7F4QwPd2|CaedZwU-|Dj5wJ2qb|ui-mrfg9u99|sigma-ui-/i.test(s);
        });
        var expected = ${JSON.stringify(expectedStamp)};
        var allowed = ${JSON.stringify(allowed)};
        var badScript = scripts.some(function(s){
          var m = s.match(/\\/assets\\/(index-[^/?#]+\\.js)/i);
          return m && allowed.length && allowed.indexOf(m[1]) < 0;
        });
        var stampMismatch = expected && meta && expected !== meta;
        return {
          title: document.title,
          scripts: scripts,
          href: location.href,
          meta: meta,
          expected: expected,
          hasOld: hasOld || badScript || stampMismatch,
          reason: hasOld ? 'old-hash' : badScript ? 'not-in-dist' : stampMismatch ? 'stamp-mismatch' : ''
        };
      })()`)
      .then((info) => {
        console.log("[WINDOW] UI carregada:", JSON.stringify(info));
        if (info?.hasOld) {
          console.warn("[WINDOW] UI antiga detectada (", info.reason, ") — forçando reload do dist");
          loadAppUi(mainWindow).catch(() => {});
        }
      })
      .catch(() => {});
  });

  mainWindow.webContents.on("console-message", (event, level, message, line, sourceId) => {
    console.log(`[RENDERER CONSOLE] ${message} (line ${line}) ${sourceId || ""}`);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const currentUrl = mainWindow.webContents.getURL();
    if (url !== currentUrl) {
      event.preventDefault();
      if (isHttpUrl(url)) shell.openExternal(url).catch(() => {});
    }
  });
  mainWindow.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      const allowed =
        webContents === mainWindow.webContents &&
        ["media", "microphone", "audioCapture", "notifications"].includes(permission);
      callback(allowed);
    },
  );
  // Electron 28+: checagem síncrona também precisa liberar microfone
  mainWindow.webContents.session.setPermissionCheckHandler(
    (webContents, permission) => {
      if (webContents !== mainWindow.webContents) return false;
      return ["media", "microphone", "audioCapture", "notifications", "clipboard-read"].includes(
        permission,
      );
    },
  );

  mainWindow.on("maximize", () =>
    safeSend("win-state", true),
  );
  mainWindow.on("unmaximize", () =>
    safeSend("win-state", false),
  );

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

app.whenReady().then(() => {
  createWindow();
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
  loadAllowedMediaPaths();
  loadWhatsAppSettings();
  cleanOldTempFiles();
  try { ensureInstallId(); } catch {}
  try { appMetrics.track("app_open"); } catch {}
  try { autoUpdaterMod.init((ch, payload) => safeSend(ch, payload)); } catch (e) { console.warn("[UPDATER] init:", e.message); }
  campaignManager = new CampaignManager(app.getPath("userData"));
  campaignManager.setProvidersMap(whatsappProviders);
  campaignManager.setCampaignSettingsProvider(() => {
    const s = loadWhatsAppSettings();
    return s?.campaigns || defaultWhatsAppSettings.campaigns;
  });
  leadScoringService = new LeadScoringService(app.getPath("userData"), (payload) => {
    safeSend("lead-scoring-progress", payload);
  });
  campaignManager.setProgressCallback((campaignId, event, data) => {
    safeSend("campaign-progress", {
      campaignId,
      event,
      data,
    });
  });

  // Auto-reconnect saved WhatsApp sessions after renderer loads
  mainWindow.webContents.on("did-finish-load", () => {
    setTimeout(() => autoReconnectSessions(), 2000);
  });
});

async function autoReconnectSessions() {
  const sessionsDir = getSessionsRoot();
  if (!fs.existsSync(sessionsDir)) return;

  let dirs;
  try {
    dirs = fs.readdirSync(sessionsDir).filter((d) => {
      try {
        assertConnectionId(d);
      } catch (e) {
        return false;
      }
      const fullPath = path.join(sessionsDir, d);
      return (
        fs.statSync(fullPath).isDirectory() &&
        fs.existsSync(path.join(fullPath, "whatsapp-auth", "creds.json"))
      );
    });
  } catch (e) {
    return;
  }

  if (dirs.length === 0) return;
  console.log("[AUTO-RECONNECT] Found", dirs.length, "saved session(s)");

  for (const dirName of dirs) {
    const sessionPath = path.join(sessionsDir, dirName);
    try {
      // Skip if already connected
      if (whatsappProviders.has(dirName)) continue;

      console.log("[AUTO-RECONNECT] Reconnecting:", dirName);
      sendWaStatus("connecting", {
        connectionId: dirName,
        msg: "Reconectando sessão salva...",
      });

      const provider = WhatsAppProviderFactory(
        "baileys",
        {},
        (status, data) => sendWaStatus(status, { ...(data || {}), connectionId: dirName }),
        (event) => onChatEvent({ ...event, connectionId: dirName }),
        sessionPath,
      );
      whatsappProviders.set(dirName, provider);
      // Só assume como ativa se ainda não houver ativa online
      const currentActive = activeWhatsAppId
        ? whatsappProviders.get(activeWhatsAppId)
        : null;
      if (
        !currentActive ||
        currentActive.getStatus?.() !== "connected"
      ) {
        activeWhatsAppId = dirName;
      }

      await provider.connect();

      // Prefere como ativa a sessão que acabou de ficar online
      if (provider.getStatus?.() === "connected") {
        activeWhatsAppId = dirName;
      }

      if (campaignManager) {
        campaignManager.autoResume();
      }

      console.log("[AUTO-RECONNECT] Success:", dirName, provider.getPhoneNumber());
    } catch (e) {
      console.log("[AUTO-RECONNECT] Failed:", dirName, e.message);
      // Clean up failed provider
      whatsappProviders.delete(dirName);
      if (activeWhatsAppId === dirName) {
        // Prefere outra sessão já online
        const online = [...whatsappProviders.entries()].find(
          ([, p]) => p?.getStatus?.() === "connected"
        );
        activeWhatsAppId =
          online?.[0] || whatsappProviders.keys().next().value || null;
      }
      // If logged out, the creds were cleared by baileys-provider
      // so next start won't try to reconnect this session
    }
  }

  // Snapshot final para a UI (bolinha / lista) após reconectar N sessões
  try {
    const agg = getAggregateWhatsAppStatus();
    // Se a ativa não está online, aponta para qualquer online
    if (agg.connections?.length) {
      const activeOk = agg.connections.find(
        (c) => c.id === activeWhatsAppId && c.connected
      );
      if (!activeOk) {
        const firstOnline = agg.connections.find((c) => c.connected);
        if (firstOnline) activeWhatsAppId = firstOnline.id;
      }
    }
    const finalAgg = getAggregateWhatsAppStatus();
    safeSend("whatsapp-status-changed", {
      status: finalAgg.status,
      aggregateStatus: finalAgg.status,
      anyConnected: finalAgg.connected,
      connectionId: finalAgg.activeConnectionId,
      data: {
        connections: finalAgg.connections,
        aggregateStatus: finalAgg.status,
        anyConnected: finalAgg.connected,
        activeConnectionId: finalAgg.activeConnectionId,
        phoneNumber: finalAgg.phoneNumber,
        msg: "Auto-reconnect finished",
      },
    });
  } catch (e) {
    /* ignore */
  }
}

app.on("before-quit", async () => {
  try { autoUpdaterMod.shutdown(); } catch {}
  if (campaignManager) campaignManager.shutdown();
  for (const provider of whatsappProviders.values()) {
    try {
      await provider.disconnect();
    } catch (e) {
      /* ignore */
    }
  }
  whatsappProviders.clear();
  activeWhatsAppId = null;
});

// Clean temp files older than 24h
async function cleanOldTempFiles() {
  try {
    const userDataPath = app.getPath("userData");
    const files = fs.readdirSync(userDataPath);
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (
        (file.startsWith("gmaps_") ||
          file.startsWith("sigma_leads_") ||
          file.startsWith("campaign_")) &&
        (file.endsWith(".json") ||
          file.endsWith(".csv") ||
          file.endsWith(".txt"))
      ) {
        const filePath = path.join(userDataPath, file);
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > oneDay) {
          fs.unlinkSync(filePath);
        }
      }
    }
  } catch (e) {
    /* ignore cleanup errors */
  }
}

function sendProgress(msg) {
  safeSend("progress", msg);
}

// ─── UPDATE IPC ────────────────────────────
ipcMain.handle("update-check", async () => autoUpdaterMod.checkForUpdates());
ipcMain.handle("update-download", async () => autoUpdaterMod.downloadUpdate());
ipcMain.handle("update-install", async () => { autoUpdaterMod.quitAndInstall(); return { success: true }; });
ipcMain.handle("update-status", async () => autoUpdaterMod.getStatus());

// ─── METRICS / ANALYTICS IPC ─────────────
ipcMain.handle("metrics-get", async () => {
  try { return { success: true, ...appMetrics.getStats() }; } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle("metrics-track", async (_, { event, data } = {}) => {
  try {
    const ev = String(event || "").trim().slice(0, 80);
    if (!ev) return { success: false, error: "event required" };
    appMetrics.track(ev, data || {});
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle("metrics-settings-get", async () => {
  try { return { success: true, settings: appMetrics.loadSettings() }; } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle("metrics-settings-set", async (_, patch = {}) => {
  try {
    const cur = appMetrics.loadSettings();
    const next = { ...cur, ...patch, enabled: patch.enabled !== false };
    if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
    if (typeof patch.askedConsent === "boolean") next.askedConsent = patch.askedConsent;
    appMetrics.saveSettings(next);
    return { success: true, settings: next };
  } catch (e) { return { success: false, error: e.message }; }
});

// ─── START SCRAPE ──────────────────────────
ipcMain.handle("start-scrape", async (_, { query, maxResults, queryId }) => {
  const cleanQuery = limitString(query, MAX_QUERY_LENGTH).trim();
  const cleanMaxResults = clampInteger(maxResults, 1, MAX_SCRAPE_RESULTS, 30);
  const key = limitString(queryId, 80, "") || `scrape_${Date.now()}`;
  const cancelToken = { cancelled: false };
  activeScrapes.set(key, cancelToken);
  try {
    if (!cleanQuery) throw new Error("Query is required");
    try { appMetrics.track("scrape_started", { maxResults: cleanMaxResults, queryLen: cleanQuery.length }); } catch {}
    sendProgress(`Starting scrape for: ${cleanQuery}`);
    const result = await scrapeGoogleMaps(
      cleanQuery,
      cleanMaxResults,
      sendProgress,
      cancelToken,
    );
    let data = result.data || [];

    // Deduplicate by name+address
    const seen = new Set();
    data = data.filter((item) => {
      const key = `${item.name}||${item.address}`.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    sendProgress(`After dedup: ${data.length} unique results.`);

    const timestamp = Date.now();
    const safeQuery = cleanQuery.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "") || "query";
    const base = `gmaps_${safeQuery}_${timestamp}`;

    const userDataPath = app.getPath("userData");
    if (!fs.existsSync(userDataPath))
      fs.mkdirSync(userDataPath, { recursive: true });

    const jsonPath = path.join(userDataPath, `${base}.json`);
    const csvPath = path.join(userDataPath, `${base}.csv`);
    const reportPath = path.join(userDataPath, `${base}_report.txt`);

    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
    saveToCSV(data, csvPath);
    saveReport(query, data, reportPath);

    const resultKey = limitString(queryId, 80, "") || "_last";
    resultStore.set(resultKey, {
      query: cleanQuery,
      data,
      jsonPath,
      csvPath,
      reportPath,
      timestamp,
    });

    sendProgress(`Scrape complete (${data.length} results).`);
    try { appMetrics.track("scrape_completed", { count: data.length, queryLen: cleanQuery.length }); } catch {}

    return {
      success: true,
      preview: data.slice(0, 3),
      count: data.length,
      data,
      statistics: result.statistics,
    };
  } catch (err) {
    sendProgress(`Error: ${err.message}`);
    try { appMetrics.track("scrape_failed", { error: String(err.message).slice(0, 120) }); } catch {}
    return { success: false, error: err.message };
  } finally {
    activeScrapes.delete(key);
  }
});

ipcMain.handle("cancel-scrape", async (_, { queryId } = {}) => {
  const key = limitString(queryId, 80, "");
  if (key && activeScrapes.has(key)) {
    activeScrapes.get(key).cancelled = true;
    return { success: true, cancelled: 1 };
  }
  let cancelled = 0;
  for (const token of activeScrapes.values()) {
    token.cancelled = true;
    cancelled++;
  }
  return { success: true, cancelled };
});

// ─── SAVE FILE ─────────────────────────────
ipcMain.handle("save-file", async (_, { type, queryId }) => {
  const key = queryId || "_last";
  const entry = resultStore.get(key);
  if (!entry) return { success: false, message: "No results to save." };

  const map = {
    json: {
      name: `gmaps_${entry.query}_${entry.timestamp}.json`,
      path: entry.jsonPath,
    },
    csv: {
      name: `gmaps_${entry.query}_${entry.timestamp}.csv`,
      path: entry.csvPath,
    },
    report: {
      name: `gmaps_${entry.query}_${entry.timestamp}_report.txt`,
      path: entry.reportPath,
    },
  };

  if (!map[type]) return { success: false, message: "Invalid type." };

  const { filePath, canceled } = await dialog.showSaveDialog({
    title: `Save ${type.toUpperCase()}`,
    defaultPath: map[type].name,
  });

  if (canceled || !filePath)
    return { success: false, message: "Save cancelled." };

  fs.copyFileSync(map[type].path, filePath);
  return { success: true, savedTo: filePath };
});

// ─── SAVE ALL (MERGED) ─────────────────────
ipcMain.handle("save-all-files", async (_, { type }) => {
  if (resultStore.size === 0)
    return { success: false, message: "No results to save." };

  // Merge all results
  const allData = [];
  for (const entry of resultStore.values()) {
    for (const item of entry.data) {
      allData.push({ query: entry.query, ...item });
    }
  }

  const timestamp = Date.now();

  if (type === "json") {
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: "Save All JSON",
      defaultPath: `gmaps_all_${timestamp}.json`,
    });
    if (canceled || !filePath)
      return { success: false, message: "Save cancelled." };
    fs.writeFileSync(filePath, JSON.stringify(allData, null, 2));
    return { success: true, savedTo: filePath };
  }

  if (type === "csv") {
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: "Save All CSV",
      defaultPath: `gmaps_all_${timestamp}.csv`,
    });
    if (canceled || !filePath)
      return { success: false, message: "Save cancelled." };
    saveToCSV(allData, filePath, true);
    return { success: true, savedTo: filePath };
  }

  return { success: false, message: "Invalid type." };
});

// ─── EXPORT LEADS (cumulative from renderer) ─
ipcMain.handle("export-leads", async (_, { leads, format }) => {
  if (!leads || !leads.length)
    return { success: false, message: "No leads to export." };
  if (!Array.isArray(leads) || leads.length > MAX_EXPORT_LEADS) {
    return { success: false, message: "Too many leads to export at once." };
  }

  const timestamp = Date.now();

  if (format === "json") {
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: "Export Leads JSON",
      defaultPath: `sigma_leads_${timestamp}.json`,
    });
    if (canceled || !filePath)
      return { success: false, message: "Save cancelled." };
    fs.writeFileSync(filePath, JSON.stringify(leads, null, 2));
    return { success: true, savedTo: filePath };
  }

  if (format === "csv") {
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: "Export Leads CSV",
      defaultPath: `sigma_leads_${timestamp}.csv`,
    });
    if (canceled || !filePath)
      return { success: false, message: "Save cancelled." };
    saveToCSV(leads, filePath);
    return { success: true, savedTo: filePath };
  }

  return { success: false, message: "Invalid format." };
});

// ─── GET RESULT LIST ───────────────────────
ipcMain.handle("get-result-list", async () => {
  const list = [];
  for (const [key, entry] of resultStore) {
    list.push({
      queryId: key,
      query: entry.query,
      count: entry.data.length,
      timestamp: entry.timestamp,
    });
  }
  return list;
});

// ─── DELETE TEMP FILES ─────────────────────
ipcMain.handle("delete-temp-files", async () => {
  try {
    const userDataPath = app.getPath("userData");
    const files = fs.readdirSync(userDataPath);
    const deleted = [];

    for (const file of files) {
      if (
        (file.startsWith("gmaps_") ||
          file.startsWith("sigma_leads_") ||
          file.startsWith("campaign_")) &&
        (file.endsWith(".json") ||
          file.endsWith(".csv") ||
          file.endsWith(".txt"))
      ) {
        const filePath = path.join(userDataPath, file);
        fs.unlinkSync(filePath);
        deleted.push(file);
      }
    }

    resultStore.clear();

    if (deleted.length === 0) {
      return { success: false, message: "No files to delete." };
    }

    return { success: true, message: `${deleted.length} files deleted.` };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ─── UI THEME ──────────────────────────────
function getUiThemeFilePath() {
  return path.join(app.getPath("userData"), "ui-theme.json");
}

function readSavedTheme() {
  try {
    const filePath = getUiThemeFilePath();
    if (fs.existsSync(filePath)) {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (raw?.theme === "light" || raw?.theme === "dark" || raw?.theme === "auto") {
        return raw.theme;
      }
    }
  } catch (e) {
    /* ignore */
  }
  return "light";
}

function resolveWindowBgColor() {
  const saved = readSavedTheme();
  if (saved === "dark") return "#0B0F1A";
  if (saved === "auto") {
    return nativeTheme?.shouldUseDarkColors ? "#0B0F1A" : "#F8FAFC";
  }
  return "#F8FAFC";
}

ipcMain.handle("theme-get", () => readSavedTheme());
ipcMain.handle("theme-set", async (_, { theme } = {}) => {
  const next = theme === "light" || theme === "auto" ? theme : "dark";
  try {
    fs.writeFileSync(
      getUiThemeFilePath(),
      JSON.stringify({ theme: next }, null, 2),
      { mode: 0o600 },
    );
  } catch (e) {
    /* ignore */
  }
  return next;
});

// ─── WINDOW CONTROLS ───────────────────────
ipcMain.handle("win-minimize", () => mainWindow?.minimize());
ipcMain.handle("win-maximize", () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.handle("win-close", () => mainWindow?.close());
ipcMain.handle("win-is-maximized", () => mainWindow?.isMaximized());
// Recarrega UI do renderer/dist (não faz location.reload na pasta TEMP velha)
ipcMain.handle("reload-ui", async () => {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      return { success: true, recreated: true };
    }
    await loadAppUi(mainWindow);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
ipcMain.handle("open-external", async (_, { url } = {}) => {
  try {
    if (!isHttpUrl(url)) return { success: false, error: "URL inválida" };
    await shell.openExternal(String(url));
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── WHATSAPP CONNECTION ───────────────────
function getActiveWhatsAppProvider() {
  return activeWhatsAppId ? whatsappProviders.get(activeWhatsAppId) : null;
}

// Resolve a specific connection by id, falling back to the active provider.
// Lets the chat/messaging handlers accept an optional `connectionId` so the UI
// can talk to any connected number while keeping backward compatibility.
function resolveChatProvider(connectionId) {
  if (connectionId && typeof connectionId === "string") {
    const provider = whatsappProviders.get(connectionId);
    if (provider) return provider;
  }
  return getActiveWhatsAppProvider();
}

function listWhatsAppConnections() {
  return [...whatsappProviders.entries()].map(([id, provider]) => ({
    id,
    connected: provider.getStatus() === "connected",
    status: provider.getStatus(),
    provider:
      provider.constructor.name === "BaileysProvider" ? "baileys" : "meta",
    phoneNumber: provider.getPhoneNumber(),
    active: id === activeWhatsAppId,
  }));
}

/**
 * Status agregado para a UI (bolinha / overview).
 * Com múltiplas conexões, o indicador global fica "connected" se
 * QUALQUER sessão estiver online — evita bolinha vermelha quando
 * só a última sessão emitiu connecting/disconnected.
 */
function getAggregateWhatsAppStatus() {
  const connections = listWhatsAppConnections();
  const anyConnected = connections.some((c) => c.status === "connected");
  const active = activeWhatsAppId
    ? whatsappProviders.get(activeWhatsAppId)
    : null;
  const activeStatus = active?.getStatus?.() || "disconnected";

  let status = "disconnected";
  if (anyConnected) {
    status = "connected";
  } else if (connections.some((c) => c.status === "qr_ready")) {
    status = "qr_ready";
  } else if (connections.some((c) => c.status === "connecting")) {
    status = "connecting";
  } else if (connections.some((c) => c.status === "error")) {
    status = "error";
  }

  const connectedEntry =
    connections.find((c) => c.active && c.connected) ||
    connections.find((c) => c.connected) ||
    null;

  return {
    connected: anyConnected,
    status,
    activeStatus,
    activeConnectionId: activeWhatsAppId,
    phoneNumber:
      active?.getPhoneNumber?.() || connectedEntry?.phoneNumber || null,
    provider: active
      ? active.constructor.name === "BaileysProvider"
        ? "baileys"
        : "meta"
      : null,
    connections,
  };
}

async function sendWaStatus(status, data) {
  // Sempre que um número ficar online, retoma campanhas running/pausadas por cota
  if (status === "connected" && campaignManager) {
    try {
      campaignManager.setProvidersMap(whatsappProviders);
      campaignManager.autoResume();
    } catch (e) {
      console.log("[CAMPAIGN] autoResume on connect:", e.message);
    }
  }

  const payloadData = { ...(data || {}) };
  // Snapshot de todas as conexões em todo evento — a UI multi-session
  // precisa disso para não sobrescrever o estado global com o status
  // de uma única sessão.
  const aggregate = getAggregateWhatsAppStatus();
  // Se ainda não há ninguém online, propaga o estado transitório do
  // evento atual (connecting / qr_ready) para a bolinha global.
  let aggregateStatus = aggregate.status;
  if (aggregate.connected) {
    aggregateStatus = "connected";
  } else if (status === "qr_ready" || status === "connecting" || status === "error") {
    aggregateStatus = status;
  }
  payloadData.connections = aggregate.connections;
  payloadData.aggregateStatus = aggregateStatus;
  payloadData.anyConnected = aggregate.connected;
  payloadData.activeConnectionId = aggregate.activeConnectionId;

  const envelope = {
    status,
    aggregateStatus,
    anyConnected: aggregate.connected,
    connectionId: payloadData.connectionId || null,
    data: payloadData,
  };

  if (status === "qr_ready" && data?.qrData) {
    try {
      const qrDataURL = await QRCode.toDataURL(data.qrData, {
        width: 200,
        margin: 1,
      });
      safeSend("whatsapp-status-changed", {
        ...envelope,
        data: { ...payloadData, qrDataURL },
      });
      return;
    } catch (e) {
      safeSend("whatsapp-status-changed", envelope);
      return;
    }
  }
  safeSend("whatsapp-status-changed", envelope);
}

function onChatEvent(event) {
  if (event.type === "chat-update") {
    safeSend("whatsapp-chat-update", {
      connectionId: event.connectionId,
    });
  } else if (event.type === "message-received") {
    if (campaignManager) {
      campaignManager.trackIncomingMessage(
        event.phoneJid || event.jid,
        event.message,
        event.connectionId
      );
    }
    safeSend("whatsapp-message-received", {
      jid: event.jid,
      message: event.message,
      connectionId: event.connectionId,
    });
  } else if (
    event.type === "sync-start" ||
    event.type === "sync-progress" ||
    event.type === "sync-done"
  ) {
    safeSend("whatsapp-sync", {
      type: event.type,
      stats: event.stats,
      connectionId: event.connectionId,
    });
  } else if (event.type === "message-status") {
    if (campaignManager) {
      campaignManager.trackMessageStatus(event.messageId, event.status);
    }
  } else if (event.type === "conversation-open") {
    if (campaignManager) {
      campaignManager.trackConversationOpen(
        event.phoneJid || event.jid,
        event.connectionId
      );
    }
  }
}

ipcMain.handle("whatsapp-connect", async (_, { provider: type, config }) => {
  let connectionId = null;
  let provider = null;
  try {
    connectionId =
      config?.connectionId ? assertConnectionId(config.connectionId) : createConnectionId();
    const connectionPath = resolveSessionPath(connectionId);
    fs.mkdirSync(connectionPath, { recursive: true });

    const existing = whatsappProviders.get(connectionId);
    if (existing) await existing.disconnect().catch(() => {});

    provider = WhatsAppProviderFactory(
      type,
      config,
      (status, data) => sendWaStatus(status, { ...(data || {}), connectionId }),
      (event) => onChatEvent({ ...event, connectionId }),
      connectionPath,
    );
    whatsappProviders.set(connectionId, provider);
    activeWhatsAppId = connectionId;
    await provider.connect();
    if (provider.getStatus && provider.getStatus() === "error") {
      throw new Error("Provider failed to connect");
    }

    if (campaignManager) {
      campaignManager.autoResume();
    }

    const phoneNumber = provider.getPhoneNumber();
    return { success: true, phoneNumber, connectionId, connections: listWhatsAppConnections() };
  } catch (err) {
    if (provider) await provider.disconnect?.().catch(() => {});
    if (connectionId) {
      whatsappProviders.delete(connectionId);
      if (activeWhatsAppId === connectionId) {
        activeWhatsAppId = whatsappProviders.keys().next().value || null;
      }
    }
    return { success: false, error: err.message };
  }
});

ipcMain.handle("whatsapp-disconnect", async (_, { connectionId } = {}) => {
  try {
    const id = connectionId ? assertConnectionId(connectionId) : activeWhatsAppId;
    const provider = id ? whatsappProviders.get(id) : null;
    if (provider) {
      await provider.disconnect();
      whatsappProviders.delete(id);
    }
    if (activeWhatsAppId === id) {
      activeWhatsAppId = whatsappProviders.keys().next().value || null;
    }
    const activeProvider = getActiveWhatsAppProvider();
    if (campaignManager) {
      // no-op, providersMap is already kept by reference
    }
    return { success: true, activeConnectionId: activeWhatsAppId, connections: listWhatsAppConnections() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("whatsapp-remove-connection", async (_, { connectionId }) => {
  try {
    if (!connectionId) throw new Error("Connection ID is required");
    const safeConnectionId = assertConnectionId(connectionId);
    
    // 1. Disconnect and remove from active map
    const provider = whatsappProviders.get(safeConnectionId);
    if (provider) {
      try { await provider.disconnect(); } catch (e) {}
      whatsappProviders.delete(safeConnectionId);
    }
    if (activeWhatsAppId === safeConnectionId) {
      activeWhatsAppId = whatsappProviders.keys().next().value || null;
    }

    // 2. Delete the session folder
    const connectionPath = resolveSessionPath(safeConnectionId);
    if (fs.existsSync(connectionPath)) {
      fs.rmSync(connectionPath, { recursive: true, force: true });
    }

    // 3. Update campaign manager if active changed
    const activeProvider = getActiveWhatsAppProvider();
    if (campaignManager) {
      // no-op
    }

    return { success: true, activeConnectionId: activeWhatsAppId, connections: listWhatsAppConnections() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("whatsapp-status", async () => {
  return getAggregateWhatsAppStatus();
});

ipcMain.handle("whatsapp-list-connections", async () => ({
  activeConnectionId: activeWhatsAppId,
  connections: listWhatsAppConnections(),
}));

ipcMain.handle("whatsapp-switch-connection", async (_, { connectionId }) => {
  try {
    const safeConnectionId = assertConnectionId(connectionId);
    if (!whatsappProviders.has(safeConnectionId)) {
      return { success: false, error: "Conexão não encontrada" };
    }
    activeWhatsAppId = safeConnectionId;
    if (campaignManager) {
      // no-op
    }
    return { success: true, activeConnectionId: activeWhatsAppId, connections: listWhatsAppConnections() };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ─── FORCE RESYNC ─────────────────────────
ipcMain.handle("whatsapp-force-resync", async (_, { connectionId } = {}) => {
  try {
    const id = connectionId ? assertConnectionId(connectionId) : activeWhatsAppId;
    const provider = id ? whatsappProviders.get(id) : getActiveWhatsAppProvider();
    if (provider) await provider.disconnect().catch(() => {});
    const { AuthStore } = require("./whatsapp/auth-store");
    const sessionPath = id
      ? resolveSessionPath(id)
      : app.getPath("userData");
    const store = new AuthStore(sessionPath);
    await store.clearBaileysAuth();
    try {
      fs.unlinkSync(path.join(sessionPath, "sigma-chats.json"));
    } catch (e) {}
    if (id) whatsappProviders.delete(id);
    activeWhatsAppId = whatsappProviders.keys().next().value || null;
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ─── CHAT MANAGEMENT ───────────────────────
ipcMain.handle("whatsapp-get-chats", async (_, { connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider) return { chats: [] };
  return { chats: provider.getChats() };
});

ipcMain.handle("whatsapp-get-contacts", async (_, { connectionId } = {}) => {
  try {
    const provider = resolveChatProvider(connectionId);
    if (!provider) return { success: true, contacts: [], groups: [] };
    const contacts = typeof provider.getContacts === "function" ? provider.getContacts() : [];
    const groups = typeof provider.getGroups === "function"
      ? provider.getGroups()
      : contacts.filter((c) => c.isGroup);
    return {
      success: true,
      contacts: contacts.filter((c) => !c.isGroup),
      groups,
      all: contacts,
    };
  } catch (err) {
    return { success: false, error: err.message, contacts: [], groups: [], all: [] };
  }
});

ipcMain.handle("whatsapp-get-messages", async (_, { jid, connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider) return { messages: [] };
  return { messages: provider.getMessages(jid) };
});

ipcMain.handle("whatsapp-load-messages", async (_, { jid, limit, connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider) return { messages: [] };
  const messages = await provider.loadMessages(jid, limit || 50);
  return { messages };
});

ipcMain.handle("whatsapp-mark-read", async (_, { jid, connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider) return;
  await provider.markRead(jid);
});

ipcMain.handle("whatsapp-get-profile-pic", async (_, { jid, connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider || !provider.getProfilePicture)
    return { url: null };
  const url = await provider.getProfilePicture(jid);
  return { url };
});

ipcMain.handle("whatsapp-get-group-metadata", async (_, { jid, connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider || !provider.getGroupMetadata) return null;
  return await provider.getGroupMetadata(jid);
});

ipcMain.handle("whatsapp-get-contact-info", async (_, { jid, connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider || !provider.getContactInfo)
    return { jid, phone: jid, name: null, business: null };
  return await provider.getContactInfo(jid);
});

ipcMain.handle("whatsapp-send-message", async (_, { to, content, connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider) return { success: false, error: "Not connected" };
  return await provider.sendMessage(to, content);
});

ipcMain.handle("whatsapp-chat-action", async (_, { jid, action, connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider || !provider.chatAction)
    return { success: false, error: "Not connected" };
  return await provider.chatAction(jid, action);
});

ipcMain.handle("whatsapp-delete-message", async (_, { jid, key, forEveryone, connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider || !provider.deleteMessage)
    return { success: false, error: "Not connected" };
  return await provider.deleteMessage(jid, key, {
    forEveryone: forEveryone !== false,
  });
});

// ─── Etiquetas de contatos (persistidas em userData) ───
function getContactLabelsPath() {
  return path.join(app.getPath("userData"), "contact-labels.json");
}

function loadContactLabelsStore() {
  try {
    const p = getContactLabelsPath();
    if (!fs.existsSync(p)) {
      return {
        catalog: [
          { id: "tag_cliente", name: "Cliente", color: "#00b894" },
          { id: "tag_lead", name: "Lead", color: "#6c5ce7" },
          { id: "tag_quente", name: "Quente", color: "#e17055" },
          { id: "tag_follow", name: "Follow-up", color: "#fdcb6e" },
        ],
        byJid: {},
      };
    }
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    return {
      catalog: Array.isArray(raw.catalog) ? raw.catalog : [],
      byJid: raw.byJid && typeof raw.byJid === "object" ? raw.byJid : {},
    };
  } catch {
    return { catalog: [], byJid: {} };
  }
}

function saveContactLabelsStore(store) {
  fs.writeFileSync(getContactLabelsPath(), JSON.stringify(store, null, 2), { mode: 0o600 });
}

ipcMain.handle("whatsapp-labels-get", async () => {
  return { success: true, ...loadContactLabelsStore() };
});

ipcMain.handle("whatsapp-labels-save-catalog", async (_, { catalog } = {}) => {
  try {
    const store = loadContactLabelsStore();
    store.catalog = (Array.isArray(catalog) ? catalog : store.catalog)
      .slice(0, 40)
      .map((t, i) => ({
        id: limitString(t.id || `tag_${Date.now()}_${i}`, 40),
        name: limitString(t.name || "Etiqueta", 32),
        color: limitString(t.color || "#6c5ce7", 20),
      }));
    saveContactLabelsStore(store);
    return { success: true, ...store };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("whatsapp-labels-set-contact", async (_, { jid, tagIds } = {}) => {
  try {
    if (!jid) throw new Error("Contato inválido");
    const store = loadContactLabelsStore();
    const ids = (Array.isArray(tagIds) ? tagIds : [])
      .map((id) => String(id))
      .filter((id) => store.catalog.some((t) => t.id === id))
      .slice(0, 12);
    // Sempre individual: grava só neste jid (sem aplicar em massa)
    const key = String(jid);
    if (!ids.length) delete store.byJid[key];
    else store.byJid[key] = ids;
    saveContactLabelsStore(store);
    return { success: true, jid: key, tagIds: ids, catalog: store.catalog, byJid: store.byJid };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("whatsapp-send-media", async (_, { to, filePath, caption, connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider) return { success: false, error: "Not connected" };
  try {
    const mediaPath = resolveSelectedMediaPath(filePath, MAX_MEDIA_BYTES, "Media file");
    const buffer = fs.readFileSync(mediaPath);
    const ext = path.extname(mediaPath).toLowerCase();
    const mimeMap = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".mp4": "video/mp4",
      ".mov": "video/quicktime",
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav",
      ".ogg": "audio/ogg",
      ".opus": "audio/ogg",
      ".webm": "audio/webm",
      ".pdf": "application/pdf",
      ".doc": "application/msword",
      ".docx":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
    const mimetype = mimeMap[ext] || "application/octet-stream";
    const isImage = mimetype.startsWith("image/");
    const isVideo = mimetype.startsWith("video/");
    const isAudio = mimetype.startsWith("audio/");

    const content = {};
    if (caption) content.caption = caption;
    if (isImage) { content.image = buffer; content.mimetype = mimetype; }
    else if (isVideo) { content.video = buffer; content.mimetype = mimetype; }
    else if (isAudio) {
      content.audio = buffer;
      content.mimetype = mimetype;
      // .ogg/.opus e clips de gatilho em userData/trigger-audio → mensagem de voz (PTT)
      const isTriggerClip = /[\\/]trigger-audio[\\/]/i.test(mediaPath);
      content.ptt = isTriggerClip || /audio\/(ogg|opus)/i.test(mimetype) || ext === ".ogg" || ext === ".opus";
    }
    else {
      content.document = buffer;
      content.fileName = path.basename(mediaPath);
      content.mimetype = mimetype;
    }

    return await provider.sendMedia(to, content);
  } catch (e) {
    return { success: false, error: e.message };
  }
});

function convertAudioToOggOpus(buffer, mimetype) {
  const type = String(mimetype || "").toLowerCase();
  // CUIDADO: "audio/webm;codecs=opus" contém "opus" mas NÃO é OGG — precisa converter!
  // Só pular conversão se já for container ogg (ou pure audio/opus).
  const alreadyOgg =
    (type.includes("ogg") && !type.includes("webm")) ||
    type === "audio/opus" ||
    type.startsWith("audio/ogg");
  if (alreadyOgg && Buffer.isBuffer(buffer) && buffer.length > 64) {
    return Promise.resolve({ buffer, mimetype: "audio/ogg; codecs=opus" });
  }
  if (!Buffer.isBuffer(buffer) || buffer.length < 64) {
    return Promise.resolve({ buffer: buffer || Buffer.alloc(0), mimetype: type || "audio/webm", error: "buffer_vazio" });
  }
  return new Promise((resolve) => {
    let ext = ".webm";
    if (type.includes("mp4") || type.includes("m4a") || type.includes("aac")) ext = ".m4a";
    else if (type.includes("mpeg") || type.includes("mp3")) ext = ".mp3";
    else if (type.includes("wav")) ext = ".wav";
    else if (type.includes("ogg")) ext = ".ogg";
    else ext = ".webm";

    const base = path.join(
      os.tmpdir(),
      `sigma_audio_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    );
    const input = `${base}${ext}`;
    const output = `${base}.ogg`;
    try {
      fs.writeFileSync(input, buffer);
      // Força mono 48k opus em container ogg (formato PTT do WhatsApp)
      execFile(
        ffmpegPath,
        [
          "-y",
          "-i", input,
          "-vn",
          "-ac", "1",
          "-ar", "48000",
          "-c:a", "libopus",
          "-b:a", "24k",
          "-application", "voip",
          output,
        ],
        { windowsHide: true, timeout: 45000 },
        (err, _stdout, stderr) => {
          try {
            fs.unlinkSync(input);
          } catch (e) {}
          if (err) {
            console.error("[AUDIO] ffmpeg falhou:", err.message, String(stderr || "").slice(0, 200));
            try {
              fs.unlinkSync(output);
            } catch (e) {}
            // Fallback: tenta enviar original (melhor que silêncio)
            resolve({ buffer, mimetype: mimetype || "audio/webm", converted: false, error: err.message });
            return;
          }
          try {
            const converted = fs.readFileSync(output);
            try { fs.unlinkSync(output); } catch (e) {}
            if (!converted || converted.length < 64) {
              console.error("[AUDIO] ffmpeg gerou arquivo vazio");
              resolve({ buffer, mimetype: mimetype || "audio/webm", converted: false, error: "output_vazio" });
              return;
            }
            resolve({
              buffer: converted,
              mimetype: "audio/ogg; codecs=opus",
              converted: true,
              bytes: converted.length,
            });
          } catch (e) {
            resolve({ buffer, mimetype: mimetype || "audio/webm", converted: false, error: e.message });
          }
        },
      );
    } catch (e) {
      resolve({ buffer, mimetype: mimetype || "audio/webm", converted: false, error: e.message });
    }
  });
}

function parseAudioPayload(audioData) {
  if (audioData == null) throw new Error("Áudio vazio");
  if (Buffer.isBuffer(audioData)) return audioData;
  if (typeof audioData === "string") return Buffer.from(audioData, "base64");
  if (Array.isArray(audioData) || ArrayBuffer.isView(audioData)) return Buffer.from(audioData);
  if (audioData?.type === "Buffer" && Array.isArray(audioData.data)) {
    return Buffer.from(audioData.data);
  }
  throw new Error("Formato de áudio inválido");
}

function getTriggerAudioDir() {
  const dir = path.join(app.getPath("userData"), "trigger-audio");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

ipcMain.handle(
  "whatsapp-send-audio",
  async (_, { to, audioData, mimetype, connectionId } = {}) => {
    const provider = resolveChatProvider(connectionId);
    if (!provider) return { success: false, error: "Not connected" };
    try {
      const rawBuffer = parseAudioPayload(audioData);
      if (!rawBuffer.length) throw new Error("Áudio vazio");
      if (rawBuffer.length > MAX_AUDIO_BYTES) {
        throw new Error("Áudio excede o tamanho máximo (15 MB)");
      }
      const audio = await convertAudioToOggOpus(rawBuffer, mimetype);
      if (!audio.buffer || audio.buffer.length < 64) {
        return { success: false, error: "Áudio inválido ou vazio após conversão. Grave de novo." };
      }
      if (audio.error && !audio.converted) {
        console.warn("[AUDIO] conversão incompleta:", audio.error, "mime=", audio.mimetype);
      }
      // Estima segundos pelo bitrate ~24kbps se não informado
      const approxSec = Math.max(1, Math.round((audio.buffer.length * 8) / 24000));
      return await provider.sendAudio(to, audio.buffer, audio.mimetype, approxSec);
    } catch (e) {
      return { success: false, error: e.message };
    }
  },
);

/** Salva gravação/anexo como clipe reutilizável de gatilho (ogg/opus, estilo PTT). */
ipcMain.handle(
  "whatsapp-save-trigger-audio",
  async (_, { audioData, mimetype, label, durationSec, sourcePath } = {}) => {
    try {
      let rawBuffer;
      let srcMime = mimetype;
      if (sourcePath && typeof sourcePath === "string") {
        // Anexar arquivo do disco
        const resolved = resolveSelectedMediaPath(sourcePath, MAX_AUDIO_BYTES, "Áudio");
        rawBuffer = fs.readFileSync(resolved);
        const ext = path.extname(resolved).toLowerCase();
        const mimeMap = {
          ".mp3": "audio/mpeg",
          ".wav": "audio/wav",
          ".ogg": "audio/ogg",
          ".opus": "audio/ogg",
          ".webm": "audio/webm",
          ".m4a": "audio/mp4",
        };
        srcMime = srcMime || mimeMap[ext] || "audio/webm";
      } else {
        rawBuffer = parseAudioPayload(audioData);
      }
      if (!rawBuffer.length) throw new Error("Áudio vazio");
      if (rawBuffer.length > MAX_AUDIO_BYTES) {
        throw new Error("Áudio excede o tamanho máximo (15 MB)");
      }
      const audio = await convertAudioToOggOpus(rawBuffer, srcMime);
      const id = `aud_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const filePath = path.join(getTriggerAudioDir(), `${id}.ogg`);
      fs.writeFileSync(filePath, audio.buffer);
      rememberAllowedMediaPath(filePath);
      return {
        success: true,
        id,
        filePath,
        mimetype: "audio/ogg; codecs=opus",
        label: limitString(String(label || "Áudio"), 80) || "Áudio",
        durationSec: Math.max(1, Math.round(Number(durationSec) || 1)),
        bytes: audio.buffer.length,
      };
    } catch (e) {
      console.error("[WHATSAPP] save-trigger-audio:", e.message);
      return { success: false, error: e.message };
    }
  },
);

ipcMain.handle("whatsapp-delete-trigger-audio", async (_, { filePath } = {}) => {
  try {
    if (!filePath || typeof filePath !== "string") {
      return { success: false, error: "Caminho inválido" };
    }
    const root = path.resolve(getTriggerAudioDir());
    const resolved = path.resolve(filePath);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      return { success: false, error: "Caminho fora da área permitida" };
    }
    if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

/** Lê clipe de gatilho em base64 para prévia no player. */
ipcMain.handle("whatsapp-read-trigger-audio", async (_, { filePath } = {}) => {
  try {
    if (!filePath || typeof filePath !== "string") {
      return { success: false, error: "Caminho inválido" };
    }
    const root = path.resolve(getTriggerAudioDir());
    const resolved = path.resolve(filePath);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      return { success: false, error: "Caminho fora da área permitida" };
    }
    if (!fs.existsSync(resolved)) {
      return { success: false, error: "Arquivo não encontrado" };
    }
    const buf = fs.readFileSync(resolved);
    return {
      success: true,
      data: buf.toString("base64"),
      mimetype: "audio/ogg",
      filePath: resolved,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

/**
 * Envia áudio de gatilho como mensagem de voz (PTT).
 * Não depende da lista de paths do diálogo — só arquivos em trigger-audio.
 */
ipcMain.handle(
  "whatsapp-send-trigger-audio",
  async (_, { to, filePath, connectionId } = {}) => {
    const provider = resolveChatProvider(connectionId);
    if (!provider) return { success: false, error: "WhatsApp não conectado" };
    try {
      if (!to) throw new Error("Destinatário inválido");
      if (!filePath || typeof filePath !== "string") throw new Error("Áudio inválido");
      const root = path.resolve(getTriggerAudioDir());
      const resolved = path.resolve(filePath);
      if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        // Também aceita se estiver na lista de permitidos (anexo importado copiado)
        try {
          resolveSelectedMediaPath(resolved, MAX_AUDIO_BYTES, "Áudio do gatilho");
        } catch {
          throw new Error("Arquivo de áudio do gatilho não autorizado");
        }
      }
      if (!fs.existsSync(resolved)) {
        throw new Error("Arquivo de áudio não encontrado — recrie o gatilho");
      }
      const raw = fs.readFileSync(resolved);
      if (!raw.length) throw new Error("Áudio vazio");
      const audio = await convertAudioToOggOpus(raw, "audio/ogg");
      if (!audio.buffer || audio.buffer.length < 64) {
        return { success: false, error: "Arquivo de áudio do gatilho está vazio ou corrompido" };
      }
      rememberAllowedMediaPath(resolved);
      const approxSec = Math.max(1, Math.round((audio.buffer.length * 8) / 24000));
      const result = await provider.sendAudio(
        to,
        audio.buffer,
        "audio/ogg; codecs=opus",
        approxSec,
      );
      if (!result?.success) {
        console.error("[WHATSAPP] send-trigger-audio failed:", result?.error);
      }
      return result;
    } catch (e) {
      console.error("[WHATSAPP] send-trigger-audio:", e.message);
      return { success: false, error: e.message };
    }
  },
);

ipcMain.handle("whatsapp-send-sticker", async (_, { to, filePath, connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider || !provider.sendSticker)
    return { success: false, error: "Not connected" };
  try {
    const stickerPath = resolveSelectedMediaPath(filePath, MAX_STICKER_BYTES, "Sticker file");
    const buffer = fs.readFileSync(stickerPath);
    return await provider.sendSticker(to, buffer);
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("whatsapp-react-message", async (_, { jid, key, emoji, connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider || !provider.reactMessage)
    return { success: false, error: "Not connected" };
  return await provider.reactMessage(jid, key, emoji);
});

ipcMain.handle(
  "whatsapp-forward-message",
  async (_, { fromJid, messageId, toJid, connectionId } = {}) => {
    const provider = resolveChatProvider(connectionId);
    if (!provider || !provider.forwardMessage)
      return { success: false, error: "Not connected" };
    return await provider.forwardMessage(fromJid, messageId, toJid);
  },
);

ipcMain.handle("whatsapp-download-media", async (_, { jid, messageId, connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider || !provider.downloadMedia)
    return { success: false, error: "Not connected" };
  return await provider.downloadMedia(jid, messageId);
});

// Open a previously downloaded media file in the OS default viewer.
// Path must resolve inside the provider's media cache root to prevent traversal.
ipcMain.handle("whatsapp-open-media", async (_, { filePath, connectionId } = {}) => {
  try {
    if (!filePath || typeof filePath !== "string") {
      return { success: false, error: "Caminho inválido" };
    }
    const id = connectionId || activeWhatsAppId;
    if (!id) return { success: false, error: "Sem conexão ativa" };
    const provider = whatsappProviders.get(id);
    if (!provider) return { success: false, error: "Conexão não encontrada" };
    const roots = [
      provider.getMediaCacheRoot ? provider.getMediaCacheRoot() : null,
      provider.getStickerCacheRoot ? provider.getStickerCacheRoot() : null,
    ].filter(Boolean).map((root) => path.resolve(root));
    const resolved = path.resolve(filePath);
    const allowed = roots.some(
      (root) => resolved === root || resolved.startsWith(root + path.sep),
    );
    if (!roots.length || !allowed) {
      return { success: false, error: "Caminho fora da área permitida" };
    }
    if (!fs.existsSync(resolved)) {
      return { success: false, error: "Arquivo não encontrado" };
    }
    await shell.openPath(resolved);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("whatsapp-get-archived-chats", async (_, { connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider || !provider.getArchivedChats)
    return { chats: [] };
  return { chats: provider.getArchivedChats() };
});

ipcMain.handle("whatsapp-get-settings", async () => {
  const settings = loadWhatsAppSettings();
  const usage = campaignManager?.dailyQuota?.getAllUsage?.() || {
    date: null,
    byConnection: {},
  };
  return {
    settings,
    dailyQuota: usage,
    limitTiers: LIMIT_TIERS,
  };
});

ipcMain.handle("whatsapp-update-settings", async (_, { patch }) => {
  const current = loadWhatsAppSettings();
  const next = mergeWhatsAppSettingsPatch(current, patch);
  const settings = saveWhatsAppSettings(next);
  const usage = campaignManager?.dailyQuota?.getAllUsage?.() || {
    date: null,
    byConnection: {},
  };
  return { success: true, settings, dailyQuota: usage, limitTiers: LIMIT_TIERS };
});

ipcMain.handle("whatsapp-start-chat", async (_, { phone, name }) => {
  try {
    if (typeof phone === "string" && phone.includes("@")) {
      const jid = phone.trim();
      return {
        success: true,
        jid,
        phone: jid.replace(/@.*$/, ""),
        name: limitString(name || "", 80),
      };
    }
    const normalized = normalizePhone(phone);
    if (!normalized.valid) {
      return { success: false, error: "Número inválido" };
    }
    return {
      success: true,
      jid: `${normalized.number}@s.whatsapp.net`,
      phone: normalized.number,
      name: limitString(name || "", 80),
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("whatsapp-get-link-preview", async (_, { url }) => {
  try {
    return await fetchLinkPreview(url);
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("whatsapp-save-sticker", async (_, { jid, messageId, name, connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider || !provider.saveStickerMedia)
    return { success: false, error: "Not connected" };
  const result = await provider.saveStickerMedia(jid, messageId, name);
  if (result?.success && result.sticker) {
    const stickers = loadStickerStore();
    const next = [
      {
        ...result.sticker,
        name: limitString(name || result.sticker.name || "Figurinha", 80),
        lastUsedAt: Date.now(),
        favorite: false,
      },
      ...stickers.filter((item) => item.id !== result.sticker.id),
    ].slice(0, 500);
    saveStickerStore(next);
  }
  return result;
});

ipcMain.handle("whatsapp-list-stickers", async () => {
  return { stickers: loadStickerStore() };
});

ipcMain.handle("whatsapp-send-saved-sticker", async (_, { to, stickerId, connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider || !provider.sendSticker)
    return { success: false, error: "Not connected" };
  try {
    const stickers = loadStickerStore();
    const sticker = stickers.find((item) => item.id === stickerId);
    if (!sticker || !sticker.filePath || !fs.existsSync(sticker.filePath)) {
      return { success: false, error: "Figurinha não encontrada" };
    }
    const buffer = fs.readFileSync(sticker.filePath);
    const result = await provider.sendSticker(to, buffer);
    if (result?.success) {
      sticker.lastUsedAt = Date.now();
      saveStickerStore(stickers);
    }
    return result;
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("dialog-open-file", async (_, { filters } = {}) => {
  if (!mainWindow) return { success: false, canceled: true };
  const options =
    Array.isArray(filters)
      ? { filters }
      : filters && typeof filters === "object"
        ? {
            title: filters.title,
            filters: Array.isArray(filters.filters) ? filters.filters : undefined,
          }
        : {};
  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: options.filters || [{ name: "Todos os arquivos", extensions: ["*"] }],
    title: options.title || "Selecionar arquivo",
  });
  if (canceled || !filePaths[0]) {
    return { success: false, canceled: true };
  }
  const chosen = filePaths[0];
  rememberAllowedMediaPath(chosen);
  return {
    success: true,
    canceled: false,
    path: chosen,
    filePath: chosen,
    name: path.basename(chosen),
  };
});

// ─── LEAD SCORING ──────────────────────────
ipcMain.handle("lead-scoring-get-settings", async () => {
  return { success: true, settings: leadScoringService.getSettings() };
});

ipcMain.handle("lead-scoring-update-settings", async (_, { patch }) => {
  try {
    return { success: true, settings: leadScoringService.updateSettings(patch || {}) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("lead-scoring-get-all", async (_, { filters } = {}) => {
  try {
    return { success: true, ...leadScoringService.getAll(filters || {}) };
  } catch (err) {
    return { success: false, error: err.message, leads: [], stats: {} };
  }
});

ipcMain.handle("lead-scoring-get-lead", async (_, { id }) => {
  return { success: true, lead: leadScoringService.getLead(limitString(id, 140, "")) };
});

ipcMain.handle("lead-scoring-analyze-lead", async (_, { lead, options } = {}) => {
  try {
    if (!lead || typeof lead !== "object") throw new Error("Lead invalido");
    const result = await leadScoringService.analyzeLead(lead, options || {});
    return { success: true, lead: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("lead-scoring-analyze-batch", async (_, { leads, options } = {}) => {
  try {
    const input = Array.isArray(leads) ? leads.slice(0, 1000) : [];
    if (!input.length) throw new Error("Nenhum lead para analisar");
    const result = await leadScoringService.analyzeBatch(input, options || {});
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("lead-scoring-cancel", async (_, { jobId } = {}) => {
  return { success: true, cancelled: leadScoringService.cancel(limitString(jobId, 120, "")) };
});

ipcMain.handle("lead-scoring-clear", async (_, { ids, all } = {}) => {
  try {
    const safeIds = Array.isArray(ids)
      ? ids.map((id) => limitString(id, 140, "")).filter(Boolean).slice(0, 2000)
      : [];
    const result = leadScoringService.clearAnalyses({ ids: safeIds, all: !!all });
    return { success: true, ...result, stats: leadScoringService.getAll({}).stats };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("lead-scoring-list-groups", async () => {
  try {
    return { success: true, groups: leadScoringService.listGroups() };
  } catch (err) {
    return { success: false, error: err.message, groups: [] };
  }
});

ipcMain.handle("lead-scoring-create-group", async (_, { name, description, color, leadIds, segment } = {}) => {
  try {
    const group = leadScoringService.createGroup({
      name: limitString(name, 80, ""),
      description: limitString(description, 240, ""),
      color: limitString(color, 20, ""),
      leadIds: Array.isArray(leadIds) ? leadIds.map((id) => limitString(id, 140, "")).filter(Boolean).slice(0, 5000) : [],
      segment: segment && typeof segment === "object" ? segment : null,
    });
    return { success: true, group };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("lead-scoring-update-group", async (_, { id, patch } = {}) => {
  try {
    const safePatch = patch && typeof patch === "object" ? { ...patch } : {};
    if (safePatch.name != null) safePatch.name = limitString(safePatch.name, 80, "");
    if (safePatch.description != null) safePatch.description = limitString(safePatch.description, 240, "");
    if (safePatch.color != null) safePatch.color = limitString(safePatch.color, 20, "");
    if (Array.isArray(safePatch.leadIds)) {
      safePatch.leadIds = safePatch.leadIds.map((x) => limitString(x, 140, "")).filter(Boolean).slice(0, 5000);
    }
    const group = leadScoringService.updateGroup(limitString(id, 80, ""), safePatch);
    return { success: true, group };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("lead-scoring-delete-group", async (_, { id, removeLeads } = {}) => {
  try {
    const result = leadScoringService.deleteGroup(limitString(id, 80, ""), { removeLeads: !!removeLeads });
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("lead-scoring-add-to-group", async (_, { groupId, leadIds } = {}) => {
  try {
    const group = leadScoringService.addLeadsToGroup(
      limitString(groupId, 80, ""),
      Array.isArray(leadIds) ? leadIds.map((id) => limitString(id, 140, "")).filter(Boolean).slice(0, 5000) : [],
    );
    return { success: true, group };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("lead-scoring-remove-from-group", async (_, { groupId, leadIds } = {}) => {
  try {
    const group = leadScoringService.removeLeadsFromGroup(
      limitString(groupId, 80, ""),
      Array.isArray(leadIds) ? leadIds.map((id) => limitString(id, 140, "")).filter(Boolean).slice(0, 5000) : [],
    );
    return { success: true, group };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("lead-scoring-create-group-from-filters", async (_, { name, filters, description, color } = {}) => {
  try {
    const group = leadScoringService.createGroupFromFilters(
      limitString(name, 80, "Grupo de análises"),
      filters && typeof filters === "object" ? filters : {},
      {
        description: limitString(description, 240, ""),
        color: limitString(color, 20, ""),
      },
    );
    return { success: true, group };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("lead-scoring-update-outcome", async (_, { id, outcome } = {}) => {
  try {
    const lead = leadScoringService.updateOutcome(limitString(id, 140, ""), sanitizeOutcome(outcome));
    return { success: true, lead };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("lead-scoring-export", async (_, { filters, format } = {}) => {
  try {
    const { leads } = leadScoringService.getAll(filters || {});
    if (!leads.length) return { success: false, message: "Nenhum lead para exportar" };
    const timestamp = Date.now();
    const fmt = format === "json" ? "json" : "csv";
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: "Exportar Lead Scoring",
      defaultPath: `sigma_lead_scoring_${timestamp}.${fmt}`,
    });
    if (canceled || !filePath) return { success: false, message: "Exportacao cancelada" };
    if (fmt === "json") fs.writeFileSync(filePath, JSON.stringify(leads, null, 2), "utf-8");
    else saveProspectingCSV(leads, filePath);
    return { success: true, savedTo: filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("lead-scoring-open-screenshot", async (_, { filePath } = {}) => {
  try {
    const resolved = path.resolve(String(filePath || ""));
    const root = path.join(app.getPath("userData"), "lead-scoring", "screenshots");
    if (!resolved.startsWith(path.resolve(root)) || !fs.existsSync(resolved)) {
      throw new Error("Screenshot nao encontrado");
    }
    await shell.openPath(resolved);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("lead-scoring-create-campaign", async (_, { ids, name, connectionId } = {}) => {
  try {
    const selected = (Array.isArray(ids) ? ids : [])
      .map((id) => leadScoringService.getLead(String(id)))
      .filter(Boolean)
      .filter((lead) => lead.company?.phone || lead.company?.whatsapp);
    if (!selected.length) throw new Error("Nenhum lead com telefone para campanha");
    const leadIds = selected.map((lead) => ({
      leadId: lead.id,
      name: lead.company.name,
      phone: lead.company.whatsapp || lead.company.phone,
      company: lead.company.name,
      category: lead.company.category || "",
      website: lead.company.website || "",
      instagram: lead.company.instagram || "",
      email: lead.company.email || "",
      address: lead.company.address || "",
      rating: lead.company.rating || "",
      totalReviews: lead.company.totalReviews || "",
      score: lead.score?.value || "",
      prioridade: lead.score?.classification || "",
      dor_principal: lead.aiAnalysis?.principais_dores?.[0] || "",
      oportunidade_principal: lead.aiAnalysis?.principais_oportunidades?.[0] || "",
      argumento_principal: lead.aiAnalysis?.argumento_principal_venda || "",
      mensagem_whatsapp_ia: lead.aiAnalysis?.mensagem_whatsapp || "",
      ticket_estimado: lead.aiAnalysis?.ticket_estimado || "",
      chance_resposta: lead.aiAnalysis?.chance_resposta || "",
    }));
    const template = {
      text: "{{mensagem_whatsapp_ia}}",
      variables: [
        "empresa",
        "score",
        "prioridade",
        "dor_principal",
        "oportunidade_principal",
        "mensagem_whatsapp_ia",
      ],
    };
    const campaign = campaignManager.create(sanitizeCampaignData({
      name: limitString(name, 160, "Lead Scoring - Alta prioridade"),
      provider: "baileys",
      connectionId: connectionId ? assertConnectionId(connectionId) : activeWhatsAppId,
      template,
      leadIds,
      schedule: { mode: "interval", intervalMs: 30000 },
    }));
    return { success: true, campaign };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

function sanitizeOutcome(outcome) {
  const input = outcome && typeof outcome === "object" ? outcome : {};
  const status = limitString(input.status, 40, "not_contacted");
  const closedValueRaw = input.closedValue ?? input.dealValue ?? input.value ?? 0;
  const closedValue = Number(closedValueRaw);
  return {
    status,
    channel: limitString(input.channel, 40, ""),
    responded: input.responded != null
      ? !!input.responded
      : ["responded", "meeting", "proposal", "closed", "qualified"].includes(status),
    meetingBooked: input.meetingBooked != null ? !!input.meetingBooked : status === "meeting",
    proposalSent: input.proposalSent != null
      ? !!input.proposalSent
      : status === "proposal" || status === "closed",
    closed: input.closed != null ? !!input.closed : status === "closed",
    closedValue: Number.isFinite(closedValue) ? closedValue : 0,
    serviceSold: limitString(input.serviceSold, 120, ""),
    lostReason: limitString(input.lostReason, 240, ""),
    notes: limitString(input.notes, 2000, ""),
    lastContactAt: Number(input.lastContactAt || 0) || null,
    nextFollowUpAt: Number(input.nextFollowUpAt || 0) || null,
  };
}

// ─── CAMPAIGN MANAGEMENT ───────────────────
ipcMain.handle("campaign-create", async (_, data) => {
  try {
    const sanitized = sanitizeCampaignData(data);
    // Se a UI não mandou connectionId, usa o ativo / primeiro conectado
    if (!sanitized.connectionId) {
      const connectedId =
        (activeWhatsAppId && whatsappProviders.has(activeWhatsAppId) && activeWhatsAppId) ||
        [...whatsappProviders.entries()].find(
          ([, p]) => p?.getStatus?.() === "connected" || p?.isReady?.(),
        )?.[0] ||
        null;
      if (connectedId) {
        sanitized.connectionId = connectedId;
        if (!sanitized.connectionIds?.length) {
          sanitized.connectionIds = [connectedId];
        }
      }
    }
    if (!sanitized.connectionId) {
      throw new Error(
        "Nenhum WhatsApp conectado para vincular à campanha. Conecte um número e tente de novo.",
      );
    }
    // Se o id pedido não está no mapa, tenta o ativo
    if (!whatsappProviders.has(sanitized.connectionId) && activeWhatsAppId) {
      console.warn(
        `[CAMPAIGN] connectionId ${sanitized.connectionId} não está no mapa; usando ${activeWhatsAppId}`,
      );
      sanitized.connectionId = activeWhatsAppId;
      if (!sanitized.connectionIds?.includes(activeWhatsAppId)) {
        sanitized.connectionIds = [activeWhatsAppId, ...(sanitized.connectionIds || [])];
      }
    }
    if (!Array.isArray(sanitized.connectionIds) || !sanitized.connectionIds.length) {
      sanitized.connectionIds = [sanitized.connectionId];
    }
    const campaign = campaignManager.create(sanitized);
    return { success: true, campaign };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("campaign-update", async (_, { id, updates }) => {
  try {
    const campaign = campaignManager.update(id, sanitizeCampaignUpdates(updates));
    return { success: true, campaign };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("campaign-delete", async (_, { id }) => {
  try {
    campaignManager.delete(id);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("campaign-start", async (_, { id, connectionId } = {}) => {
  try {
    if (!campaignManager) throw new Error("Campaign manager não inicializado");
    // Garante mapa de providers atualizado
    campaignManager.setProvidersMap(whatsappProviders);

    const campaign = campaignManager.get(id);
    if (!campaign) throw new Error("Campanha não encontrada");

    // Preferência: connectionId do pedido (UI) > da campanha > ativo
    const preferred =
      (connectionId && whatsappProviders.has(connectionId) && connectionId) ||
      (campaign.connectionId && whatsappProviders.has(campaign.connectionId) && campaign.connectionId) ||
      activeWhatsAppId ||
      null;

    // Se a campanha não tem connectionId ou o salvo não está no mapa, grava um válido antes do start
    if (
      !campaign.connectionId ||
      !whatsappProviders.has(campaign.connectionId)
    ) {
      const fallbackId =
        preferred ||
        [...whatsappProviders.entries()].find(
          ([, p]) => p?.getStatus?.() === "connected" || p?.isReady?.(),
        )?.[0] ||
        null;
      if (fallbackId) {
        campaignManager.update(id, { connectionId: fallbackId });
        console.log(`[CAMPAIGN] connectionId preenchido no start: ${fallbackId}`);
      }
    }

    const result = campaignManager.start(id, { activeConnectionId: preferred });
    if (result?.connectionId) {
      activeWhatsAppId = result.connectionId;
    }
    return { success: true, connectionId: result?.connectionId || campaign.connectionId };
  } catch (err) {
    console.error("[CAMPAIGN] start falhou:", err.message);
    const online = listWhatsAppConnections()
      .map((c) => `${c.phoneNumber || c.id}:${c.status}`)
      .join(", ");
    return {
      success: false,
      error: err.message + (online ? ` | online agora: ${online || "nenhum"}` : ""),
    };
  }
});

ipcMain.handle("campaign-pause", async (_, { id }) => {
  try {
    campaignManager.pause(id);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("campaign-resume", async (_, { id, connectionId } = {}) => {
  try {
    if (!campaignManager) throw new Error("Campaign manager não inicializado");
    campaignManager.setProvidersMap(whatsappProviders);
    const preferred =
      (connectionId && whatsappProviders.has(connectionId) && connectionId) ||
      activeWhatsAppId ||
      null;
    const result = campaignManager.resume(id, { activeConnectionId: preferred });
    if (result?.connectionId) activeWhatsAppId = result.connectionId;
    return { success: true, connectionId: result?.connectionId || null };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("campaign-retry-failed", async (_, { id, connectionId } = {}) => {
  try {
    if (!campaignManager) throw new Error("Campaign manager não inicializado");
    campaignManager.setProvidersMap(whatsappProviders);
    const preferred =
      (connectionId && whatsappProviders.has(connectionId) && connectionId) ||
      activeWhatsAppId ||
      null;
    const count = campaignManager.retryFailed(id, { activeConnectionId: preferred });
    return { success: true, count };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("campaign-get-all", async () => {
  return { campaigns: campaignManager.getAll() };
});

ipcMain.handle("campaign-get", async (_, { id }) => {
  const campaign = campaignManager.get(id);
  return { campaign: campaign || null };
});

ipcMain.handle("campaign-export", async (_, { id, format }) => {
  try {
    const campaign = campaignManager.get(id);
    if (!campaign) return { success: false, message: "Campaign not found" };

    const timestamp = Date.now();
    const safeName = campaign.name
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_]/g, "");

    if (format === "json") {
      const { filePath, canceled } = await dialog.showSaveDialog({
        title: "Export Campaign JSON",
        defaultPath: `campaign_${safeName}_${timestamp}.json`,
      });
      if (canceled || !filePath)
        return { success: false, message: "Save cancelled." };
      fs.writeFileSync(filePath, JSON.stringify(campaign, null, 2));
      return { success: true, savedTo: filePath };
    }

    if (format === "csv") {
      const rows = campaign.leads.map((l) => ({
        name: l.name,
        phone: l.phone,
        company: l.company,
        category: l.category,
        status: l.status,
        errorMessage: l.errorMessage || "",
      }));
      const { filePath, canceled } = await dialog.showSaveDialog({
        title: "Export Campaign CSV",
        defaultPath: `campaign_${safeName}_${timestamp}.csv`,
      });
      if (canceled || !filePath)
        return { success: false, message: "Save cancelled." };
      saveToCSV(rows, filePath);
      return { success: true, savedTo: filePath };
    }

    return { success: false, message: "Invalid format." };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── TEMPLATE PREVIEW ──────────────────────
ipcMain.handle("template-preview", async (_, { template, leadId }) => {
  try {
    const lead = campaignManager
      ?.getAll()
      ?.flatMap((c) => c.leads)
      ?.find((l) => l.leadId === leadId);
    const preview = lead ? interpolateTemplate(template, lead) : template;
    return { preview };
  } catch (err) {
    return { preview: template };
  }
});

// ─── PHONE NORMALIZE ───────────────────────
ipcMain.handle("phone-normalize", async (_, { phone, countryCode }) => {
  return normalizePhone(phone, countryCode);
});
