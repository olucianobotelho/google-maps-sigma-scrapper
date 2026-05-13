const { app, BrowserWindow, ipcMain, dialog } = require("electron");
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
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer/index.html"));

  mainWindow.on("maximize", () =>
    mainWindow?.webContents.send("win-state", true),
  );
  mainWindow.on("unmaximize", () =>
    mainWindow?.webContents.send("win-state", false),
  );
}

app.whenReady().then(() => {
  createWindow();
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
  const sessionsDir = path.join(app.getPath("userData"), "whatsapp-sessions");
  if (!fs.existsSync(sessionsDir)) return;

  let dirs;
  try {
    dirs = fs.readdirSync(sessionsDir).filter((d) => {
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
        file.startsWith("gmaps_") &&
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
  try {
    sendProgress(`Starting scrape for: ${query}`);
    const result = await scrapeGoogleMaps(query, maxResults, sendProgress);
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
    const safeQuery = query.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "");
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

    const key = queryId || "_last";
    resultStore.set(key, {
      query,
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
  }
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
  const userDataPath = app.getPath("userData");

  if (type === "json") {
    const tmpPath = path.join(userDataPath, `gmaps_all_${timestamp}.json`);
    fs.writeFileSync(tmpPath, JSON.stringify(allData, null, 2));

    const { filePath, canceled } = await dialog.showSaveDialog({
      title: "Save All JSON",
      defaultPath: `gmaps_all_${timestamp}.json`,
    });
    if (canceled || !filePath)
      return { success: false, message: "Save cancelled." };
    fs.copyFileSync(tmpPath, filePath);
    fs.unlinkSync(tmpPath);
    return { success: true, savedTo: filePath };
  }

  if (type === "csv") {
    const tmpPath = path.join(userDataPath, `gmaps_all_${timestamp}.csv`);
    saveToCSV(allData, tmpPath, true);

    const { filePath, canceled } = await dialog.showSaveDialog({
      title: "Save All CSV",
      defaultPath: `gmaps_all_${timestamp}.csv`,
    });
    if (canceled || !filePath)
      return { success: false, message: "Save cancelled." };
    fs.copyFileSync(tmpPath, filePath);
    fs.unlinkSync(tmpPath);
    return { success: true, savedTo: filePath };
  }

  return { success: false, message: "Invalid type." };
});

// ─── EXPORT LEADS (cumulative from renderer) ─
ipcMain.handle("export-leads", async (_, { leads, format }) => {
  if (!leads || !leads.length)
    return { success: false, message: "No leads to export." };

  const timestamp = Date.now();
  const userDataPath = app.getPath("userData");
  const base = path.join(userDataPath, `sigma_leads_${timestamp}`);

  if (format === "json") {
    fs.writeFileSync(`${base}.json`, JSON.stringify(leads, null, 2));
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: "Export Leads JSON",
      defaultPath: `sigma_leads_${timestamp}.json`,
    });
    if (canceled || !filePath)
      return { success: false, message: "Save cancelled." };
    fs.copyFileSync(`${base}.json`, filePath);
    fs.unlinkSync(`${base}.json`);
    return { success: true, savedTo: filePath };
  }

  if (format === "csv") {
    saveToCSV(leads, `${base}.csv`);
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: "Export Leads CSV",
      defaultPath: `sigma_leads_${timestamp}.csv`,
    });
    if (canceled || !filePath)
      return { success: false, message: "Save cancelled." };
    fs.copyFileSync(`${base}.csv`, filePath);
    fs.unlinkSync(`${base}.csv`);
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
        file.startsWith("gmaps_") &&
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
  try {
    const connectionId =
      config?.connectionId ||
      `wa_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const connectionPath = path.join(app.getPath("userData"), "whatsapp-sessions", connectionId);
    fs.mkdirSync(connectionPath, { recursive: true });

    const existing = whatsappProviders.get(connectionId);
    if (existing) await existing.disconnect().catch(() => {});

    const provider = WhatsAppProviderFactory(
      type,
      config,
      (status, data) => sendWaStatus(status, { ...(data || {}), connectionId }),
      (event) => onChatEvent({ ...event, connectionId }),
      connectionPath,
    );
    whatsappProviders.set(connectionId, provider);
    activeWhatsAppId = connectionId;
    await provider.connect();

    if (campaignManager) {
      campaignManager.setProvider(provider);
      campaignManager.autoResume();
    }

    const phoneNumber = provider.getPhoneNumber();
    return { success: true, phoneNumber, connectionId, connections: listWhatsAppConnections() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("whatsapp-disconnect", async (_, { connectionId } = {}) => {
  try {
    const id = connectionId || activeWhatsAppId;
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
    
    // 1. Disconnect and remove from active map
    const provider = whatsappProviders.get(connectionId);
    if (provider) {
      try { await provider.disconnect(); } catch (e) {}
      whatsappProviders.delete(connectionId);
    }
    if (activeWhatsAppId === connectionId) {
      activeWhatsAppId = whatsappProviders.keys().next().value || null;
    }

    // 2. Delete the session folder
    const connectionPath = path.join(app.getPath("userData"), "whatsapp-sessions", connectionId);
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
  if (!whatsappProviders.has(connectionId)) {
    return { success: false, error: "Conexão não encontrada" };
  }
  activeWhatsAppId = connectionId;
  if (campaignManager) campaignManager.setProvider(getActiveWhatsAppProvider());
  return { success: true, activeConnectionId: activeWhatsAppId, connections: listWhatsAppConnections() };
});

// ─── FORCE RESYNC ─────────────────────────
ipcMain.handle("whatsapp-force-resync", async () => {
  try {
    const id = activeWhatsAppId;
    const provider = getActiveWhatsAppProvider();
    if (provider) await provider.disconnect().catch(() => {});
    const { AuthStore } = require("./whatsapp/auth-store");
    const sessionPath = id
      ? path.join(app.getPath("userData"), "whatsapp-sessions", id)
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
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
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

    const content = { text: caption };
    if (isImage) content.image = buffer;
    else if (isVideo) content.video = buffer;
    else if (isAudio) {
      content.audio = buffer;
      content.mimetype = mimetype;
      content.ptt = /audio\/(ogg|opus)/i.test(mimetype);
    }
    else {
      content.document = buffer;
      content.fileName = path.basename(filePath);
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
    const buffer = fs.readFileSync(filePath);
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

ipcMain.handle("dialog-open-file", async (_, { filters }) => {
  if (!mainWindow) return { canceled: true };
  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: filters || [{ name: "All Files", extensions: ["*"] }],
  });
  return { canceled, filePath: filePaths[0] };
});

// ─── CAMPAIGN MANAGEMENT ───────────────────
ipcMain.handle("campaign-create", async (_, data) => {
  try {
    const campaign = campaignManager.create(data);
    return { success: true, campaign };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("campaign-update", async (_, { id, updates }) => {
  try {
    const campaign = campaignManager.update(id, updates);
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

    const userDataPath = app.getPath("userData");
    const timestamp = Date.now();
    const safeName = campaign.name
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_]/g, "");
    const base = path.join(userDataPath, `campaign_${safeName}_${timestamp}`);

    if (format === "json") {
      fs.writeFileSync(`${base}.json`, JSON.stringify(campaign, null, 2));
      const { filePath, canceled } = await dialog.showSaveDialog({
        title: "Export Campaign JSON",
        defaultPath: `campaign_${safeName}_${timestamp}.json`,
      });
      if (canceled || !filePath)
        return { success: false, message: "Save cancelled." };
      fs.copyFileSync(`${base}.json`, filePath);
      fs.unlinkSync(`${base}.json`);
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
      saveToCSV(rows, `${base}.csv`);
      const { filePath, canceled } = await dialog.showSaveDialog({
        title: "Export Campaign CSV",
        defaultPath: `campaign_${safeName}_${timestamp}.csv`,
      });
      if (canceled || !filePath)
        return { success: false, message: "Save cancelled." };
      fs.copyFileSync(`${base}.csv`, filePath);
      fs.unlinkSync(`${base}.csv`);
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
