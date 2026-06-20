const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFile } = require("child_process");
const QRCode = require("qrcode");
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

let mainWindow;
const whatsappProviders = new Map();
let activeWhatsAppId = null;
let campaignManager = null;
const resultStore = new Map();
const allowedMediaPaths = new Set();
const activeScrapes = new Map();
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
      };
      return cachedWhatsAppSettings;
    }
  } catch (e) {}
  cachedWhatsAppSettings = JSON.parse(JSON.stringify(defaultWhatsAppSettings));
  return cachedWhatsAppSettings;
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

function resolveSelectedMediaPath(filePath, maxBytes, label) {
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

function sanitizeCampaignData(data) {
  const input = data && typeof data === "object" ? data : {};
  const leads = Array.isArray(input.leadIds) ? input.leadIds.slice(0, 5000) : [];
  const normalizedLeads = leads
    .map((lead) => {
      const rawPhone = typeof lead === "object" ? lead.phone : lead;
      const normalized = normalizePhone(rawPhone);
      if (!normalized.valid) return null;
      if (typeof lead !== "object") {
        return { leadId: normalized.number, phone: normalized.number, phoneRaw: rawPhone };
      }
      return {
        ...lead,
        phone: normalized.number,
        phoneRaw: rawPhone,
      };
    })
    .filter(Boolean);
  if (!normalizedLeads.length) {
    throw new Error("No valid phone numbers in campaign");
  }
  const intervalMs = clampInteger(input.schedule?.intervalMs, 5000, 60 * 60 * 1000, 30000);
  return {
    ...input,
    id: input.id ? limitString(input.id, 80) : undefined,
    name: limitString(input.name, 160, "Campanha"),
    provider: input.provider === "meta" ? "meta" : "baileys",
    connectionId: input.connectionId ? assertConnectionId(input.connectionId) : null,
    template: sanitizeTemplate(input.template),
    leadIds: normalizedLeads,
    schedule: {
      mode: ["immediate", "interval", "scheduled"].includes(input.schedule?.mode)
        ? input.schedule.mode
        : "interval",
      intervalMs,
      startAt: Number.isFinite(Number(input.schedule?.startAt))
        ? Number(input.schedule.startAt)
        : null,
      workingHours: input.schedule?.workingHours || null,
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    show: true,
    icon: path.join(__dirname, "assets", "icon.ico"),
    backgroundColor: "#0a0a0a",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer/index.html"));

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
        ["media", "notifications"].includes(permission);
      callback(allowed);
    },
  );

  mainWindow.on("maximize", () =>
    mainWindow?.webContents.send("win-state", true),
  );
  mainWindow.on("unmaximize", () =>
    mainWindow?.webContents.send("win-state", false),
  );
}

app.whenReady().then(() => {
  createWindow();
  loadAllowedMediaPaths();
  loadWhatsAppSettings();
  cleanOldTempFiles();
  campaignManager = new CampaignManager(app.getPath("userData"));
  campaignManager.setProgressCallback((campaignId, event, data) => {
    if (mainWindow)
      mainWindow.webContents.send("campaign-progress", {
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
      activeWhatsAppId = dirName;

      await provider.connect();

      if (campaignManager) {
        campaignManager.setProvider(provider);
        campaignManager.autoResume();
      }

      console.log("[AUTO-RECONNECT] Success:", dirName, provider.getPhoneNumber());
    } catch (e) {
      console.log("[AUTO-RECONNECT] Failed:", dirName, e.message);
      // Clean up failed provider
      whatsappProviders.delete(dirName);
      if (activeWhatsAppId === dirName) {
        activeWhatsAppId = whatsappProviders.keys().next().value || null;
      }
      // If logged out, the creds were cleared by baileys-provider
      // so next start won't try to reconnect this session
    }
  }
}

app.on("before-quit", async () => {
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
  if (mainWindow) mainWindow.webContents.send("progress", msg);
}

// ─── START SCRAPE ──────────────────────────
ipcMain.handle("start-scrape", async (_, { query, maxResults, queryId }) => {
  const cleanQuery = limitString(query, MAX_QUERY_LENGTH).trim();
  const cleanMaxResults = clampInteger(maxResults, 1, MAX_SCRAPE_RESULTS, 30);
  const key = limitString(queryId, 80, "") || `scrape_${Date.now()}`;
  const cancelToken = { cancelled: false };
  activeScrapes.set(key, cancelToken);
  try {
    if (!cleanQuery) throw new Error("Query is required");
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

    return {
      success: true,
      preview: data.slice(0, 3),
      count: data.length,
      data,
      statistics: result.statistics,
    };
  } catch (err) {
    sendProgress(`Error: ${err.message}`);
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

// ─── WINDOW CONTROLS ───────────────────────
ipcMain.handle("win-minimize", () => mainWindow?.minimize());
ipcMain.handle("win-maximize", () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.handle("win-close", () => mainWindow?.close());
ipcMain.handle("win-is-maximized", () => mainWindow?.isMaximized());

// ─── WHATSAPP CONNECTION ───────────────────
function getActiveWhatsAppProvider() {
  return activeWhatsAppId ? whatsappProviders.get(activeWhatsAppId) : null;
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

async function sendWaStatus(status, data) {
  if (!mainWindow) return;
  const payloadData = { ...(data || {}) };
  if (status === "qr_ready" && data?.qrData) {
    try {
      const qrDataURL = await QRCode.toDataURL(data.qrData, {
        width: 200,
        margin: 1,
      });
      mainWindow.webContents.send("whatsapp-status-changed", {
        status,
        data: { ...payloadData, qrDataURL },
      });
      return;
    } catch (e) {
      mainWindow.webContents.send("whatsapp-status-changed", { status, data });
      return;
    }
  }
  mainWindow.webContents.send("whatsapp-status-changed", { status, data: payloadData });
}

function onChatEvent(event) {
  if (!mainWindow) return;
  if (event.type === "chat-update") {
    mainWindow.webContents.send("whatsapp-chat-update", {
      connectionId: event.connectionId,
    });
  } else if (event.type === "message-received") {
    if (campaignManager) {
      campaignManager.trackIncomingMessage(event.phoneJid || event.jid, event.message);
    }
    mainWindow.webContents.send("whatsapp-message-received", {
      jid: event.jid,
      message: event.message,
      connectionId: event.connectionId,
    });
  } else if (
    event.type === "sync-start" ||
    event.type === "sync-progress" ||
    event.type === "sync-done"
  ) {
    mainWindow.webContents.send("whatsapp-sync", {
      type: event.type,
      stats: event.stats,
      connectionId: event.connectionId,
    });
  } else if (event.type === "message-status") {
    if (campaignManager) {
      campaignManager.trackMessageStatus(event.messageId, event.status);
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
      campaignManager.setProvider(provider);
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
      campaignManager.setProvider(activeProvider || null);
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
      campaignManager.setProvider(activeProvider || null);
    }

    return { success: true, activeConnectionId: activeWhatsAppId, connections: listWhatsAppConnections() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("whatsapp-status", async () => {
  const provider = getActiveWhatsAppProvider();
  if (!provider) {
    return {
      connected: false,
      status: "disconnected",
      provider: null,
      phoneNumber: null,
      activeConnectionId: null,
      connections: listWhatsAppConnections(),
    };
  }
  return {
    connected: provider.getStatus() === "connected",
    status: provider.getStatus(),
    provider:
      provider.constructor.name === "BaileysProvider"
        ? "baileys"
        : "meta",
    phoneNumber: provider.getPhoneNumber(),
    activeConnectionId: activeWhatsAppId,
    connections: listWhatsAppConnections(),
  };
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
    if (campaignManager) campaignManager.setProvider(getActiveWhatsAppProvider());
    return { success: true, activeConnectionId: activeWhatsAppId, connections: listWhatsAppConnections() };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ─── FORCE RESYNC ─────────────────────────
ipcMain.handle("whatsapp-force-resync", async () => {
  try {
    const id = activeWhatsAppId;
    const provider = getActiveWhatsAppProvider();
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
ipcMain.handle("whatsapp-get-chats", async () => {
  const provider = getActiveWhatsAppProvider();
  if (!provider) return { chats: [] };
  return { chats: provider.getChats() };
});

ipcMain.handle("whatsapp-get-messages", async (_, { jid }) => {
  const provider = getActiveWhatsAppProvider();
  if (!provider) return { messages: [] };
  return { messages: provider.getMessages(jid) };
});

ipcMain.handle("whatsapp-load-messages", async (_, { jid, limit }) => {
  const provider = getActiveWhatsAppProvider();
  if (!provider) return { messages: [] };
  const messages = await provider.loadMessages(jid, limit || 50);
  return { messages };
});

ipcMain.handle("whatsapp-mark-read", async (_, { jid }) => {
  const provider = getActiveWhatsAppProvider();
  if (!provider) return;
  await provider.markRead(jid);
});

ipcMain.handle("whatsapp-get-profile-pic", async (_, { jid }) => {
  const provider = getActiveWhatsAppProvider();
  if (!provider || !provider.getProfilePicture)
    return { url: null };
  const url = await provider.getProfilePicture(jid);
  return { url };
});

ipcMain.handle("whatsapp-get-group-metadata", async (_, { jid }) => {
  const provider = getActiveWhatsAppProvider();
  if (!provider || !provider.getGroupMetadata) return null;
  return await provider.getGroupMetadata(jid);
});

ipcMain.handle("whatsapp-get-contact-info", async (_, { jid }) => {
  const provider = getActiveWhatsAppProvider();
  if (!provider || !provider.getContactInfo)
    return { jid, phone: jid, name: null, business: null };
  return await provider.getContactInfo(jid);
});

ipcMain.handle("whatsapp-send-message", async (_, { to, content }) => {
  const provider = getActiveWhatsAppProvider();
  if (!provider) return { success: false, error: "Not connected" };
  return await provider.sendMessage(to, content);
});

ipcMain.handle("whatsapp-chat-action", async (_, { jid, action }) => {
  const provider = getActiveWhatsAppProvider();
  if (!provider || !provider.chatAction)
    return { success: false, error: "Not connected" };
  return await provider.chatAction(jid, action);
});

ipcMain.handle("whatsapp-delete-message", async (_, { jid, key }) => {
  const provider = getActiveWhatsAppProvider();
  if (!provider || !provider.deleteMessage)
    return { success: false, error: "Not connected" };
  return await provider.deleteMessage(jid, key);
});

ipcMain.handle("whatsapp-send-media", async (_, { to, filePath, caption }) => {
  const provider = getActiveWhatsAppProvider();
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
      content.ptt = /audio\/(ogg|opus)/i.test(mimetype);
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
  if (type.includes("ogg") || type.includes("opus")) {
    return Promise.resolve({ buffer, mimetype: mimetype || "audio/ogg" });
  }
  return new Promise((resolve) => {
    const ext = type.includes("mp4") ? ".mp4" : ".webm";
    const base = path.join(
      os.tmpdir(),
      `sigma_audio_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    );
    const input = `${base}${ext}`;
    const output = `${base}.ogg`;
    try {
      fs.writeFileSync(input, buffer);
      execFile(
        ffmpegPath,
        ["-y", "-i", input, "-vn", "-c:a", "libopus", "-b:a", "32k", output],
        { windowsHide: true, timeout: 30000 },
        (err) => {
          try {
            fs.unlinkSync(input);
          } catch (e) {}
          if (err) {
            try {
              fs.unlinkSync(output);
            } catch (e) {}
            resolve({ buffer, mimetype: mimetype || "audio/webm" });
            return;
          }
          try {
            const converted = fs.readFileSync(output);
            fs.unlinkSync(output);
            resolve({ buffer: converted, mimetype: "audio/ogg; codecs=opus" });
          } catch (e) {
            resolve({ buffer, mimetype: mimetype || "audio/webm" });
          }
        },
      );
    } catch (e) {
      resolve({ buffer, mimetype: mimetype || "audio/webm" });
    }
  });
}

ipcMain.handle(
  "whatsapp-send-audio",
  async (_, { to, audioData, mimetype }) => {
    const provider = getActiveWhatsAppProvider();
    if (!provider) return { success: false, error: "Not connected" };
    try {
      if (!audioData || audioData.length > MAX_AUDIO_BYTES) {
        throw new Error("Audio exceeds maximum size");
      }
      const rawBuffer = Buffer.from(audioData);
      const audio = await convertAudioToOggOpus(rawBuffer, mimetype);
      return await provider.sendAudio(to, audio.buffer, audio.mimetype);
    } catch (e) {
      return { success: false, error: e.message };
    }
  },
);

ipcMain.handle("whatsapp-send-sticker", async (_, { to, filePath }) => {
  const provider = getActiveWhatsAppProvider();
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

ipcMain.handle("whatsapp-react-message", async (_, { jid, key, emoji }) => {
  const provider = getActiveWhatsAppProvider();
  if (!provider || !provider.reactMessage)
    return { success: false, error: "Not connected" };
  return await provider.reactMessage(jid, key, emoji);
});

ipcMain.handle(
  "whatsapp-forward-message",
  async (_, { fromJid, messageId, toJid }) => {
    const provider = getActiveWhatsAppProvider();
    if (!provider || !provider.forwardMessage)
      return { success: false, error: "Not connected" };
    return await provider.forwardMessage(fromJid, messageId, toJid);
  },
);

ipcMain.handle("whatsapp-download-media", async (_, { jid, messageId }) => {
  const provider = getActiveWhatsAppProvider();
  if (!provider || !provider.downloadMedia)
    return { success: false, error: "Not connected" };
  return await provider.downloadMedia(jid, messageId);
});

ipcMain.handle("whatsapp-get-archived-chats", async () => {
  const provider = getActiveWhatsAppProvider();
  if (!provider || !provider.getArchivedChats)
    return { chats: [] };
  return { chats: provider.getArchivedChats() };
});

ipcMain.handle("whatsapp-get-settings", async () => {
  return { settings: loadWhatsAppSettings() };
});

ipcMain.handle("whatsapp-update-settings", async (_, { patch }) => {
  const current = loadWhatsAppSettings();
  const next = mergeWhatsAppSettingsPatch(current, patch);
  return { success: true, settings: saveWhatsAppSettings(next) };
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

ipcMain.handle("whatsapp-save-sticker", async (_, { jid, messageId, name }) => {
  const provider = getActiveWhatsAppProvider();
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

ipcMain.handle("whatsapp-send-saved-sticker", async (_, { to, stickerId }) => {
  const provider = getActiveWhatsAppProvider();
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

ipcMain.handle("dialog-open-file", async (_, { filters }) => {
  if (!mainWindow) return { canceled: true };
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
    filters: options.filters || [{ name: "All Files", extensions: ["*"] }],
    title: options.title,
  });
  if (!canceled && filePaths[0]) rememberAllowedMediaPath(filePaths[0]);
  return { canceled, filePath: filePaths[0] };
});

// ─── CAMPAIGN MANAGEMENT ───────────────────
ipcMain.handle("campaign-create", async (_, data) => {
  try {
    const campaign = campaignManager.create(sanitizeCampaignData(data));
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

ipcMain.handle("campaign-start", async (_, { id }) => {
  try {
    const campaign = campaignManager.get(id);
    if (campaign?.connectionId && whatsappProviders.has(campaign.connectionId)) {
      activeWhatsAppId = campaign.connectionId;
      campaignManager.setProvider(getActiveWhatsAppProvider());
    }
    campaignManager.start(id);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
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

ipcMain.handle("campaign-resume", async (_, { id }) => {
  try {
    campaignManager.resume(id);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("campaign-retry-failed", async (_, { id }) => {
  try {
    const count = campaignManager.retryFailed(id);
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
