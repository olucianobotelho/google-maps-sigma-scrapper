const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  startScrape: (query, maxResults, queryId) =>
    ipcRenderer.invoke("start-scrape", { query, maxResults, queryId }),
  cancelScrape: (queryId) =>
    ipcRenderer.invoke("cancel-scrape", { queryId }),
  exportLeads: (leads, format) =>
    ipcRenderer.invoke("export-leads", { leads, format }),
  deleteTempFiles: () => ipcRenderer.invoke("delete-temp-files"),
  onProgress: (callback) =>
    ipcRenderer.on("progress", (_, msg) => callback(msg)),
  winMinimize: () => ipcRenderer.invoke("win-minimize"),
  winMaximize: () => ipcRenderer.invoke("win-maximize"),
  winClose: () => ipcRenderer.invoke("win-close"),
  winIsMaximized: () => ipcRenderer.invoke("win-is-maximized"),
  onWinState: (callback) =>
    ipcRenderer.on("win-state", (_, state) => callback(state)),
});

contextBridge.exposeInMainWorld("whatsappAPI", {
  connect: (provider, config) =>
    ipcRenderer.invoke("whatsapp-connect", { provider, config }),
  disconnect: () => ipcRenderer.invoke("whatsapp-disconnect"),
  removeConnection: (connectionId) => ipcRenderer.invoke("whatsapp-remove-connection", { connectionId }),
  getStatus: () => ipcRenderer.invoke("whatsapp-status"),
  listConnections: () => ipcRenderer.invoke("whatsapp-list-connections"),
  switchConnection: (connectionId) =>
    ipcRenderer.invoke("whatsapp-switch-connection", { connectionId }),
  forceResync: () => ipcRenderer.invoke("whatsapp-force-resync"),
  onStatus: (callback) =>
    ipcRenderer.on("whatsapp-status-changed", (_, data) => callback(data)),
});

contextBridge.exposeInMainWorld("campaignAPI", {
  create: (data) => ipcRenderer.invoke("campaign-create", data),
  update: (id, updates) =>
    ipcRenderer.invoke("campaign-update", { id, updates }),
  delete: (id) => ipcRenderer.invoke("campaign-delete", { id }),
  start: (id) => ipcRenderer.invoke("campaign-start", { id }),
  pause: (id) => ipcRenderer.invoke("campaign-pause", { id }),
  resume: (id) => ipcRenderer.invoke("campaign-resume", { id }),
  retryFailed: (id) => ipcRenderer.invoke("campaign-retry-failed", { id }),
  getAll: () => ipcRenderer.invoke("campaign-get-all"),
  get: (id) => ipcRenderer.invoke("campaign-get", { id }),
  export: (id, format) => ipcRenderer.invoke("campaign-export", { id, format }),
  preview: (template, leadId) =>
    ipcRenderer.invoke("template-preview", { template, leadId }),
  normalize: (phone, cc) =>
    ipcRenderer.invoke("phone-normalize", { phone, countryCode: cc }),
  onProgress: (callback) =>
    ipcRenderer.on("campaign-progress", (_, data) => callback(data)),
});

contextBridge.exposeInMainWorld("chatAPI", {
  getChats: () => ipcRenderer.invoke("whatsapp-get-chats"),
  getArchivedChats: () => ipcRenderer.invoke("whatsapp-get-archived-chats"),
  getSettings: () => ipcRenderer.invoke("whatsapp-get-settings"),
  updateSettings: (patch) =>
    ipcRenderer.invoke("whatsapp-update-settings", { patch }),
  startChat: (phone, name) =>
    ipcRenderer.invoke("whatsapp-start-chat", { phone, name }),
  getMessages: (jid) => ipcRenderer.invoke("whatsapp-get-messages", { jid }),
  getProfilePic: (jid) =>
    ipcRenderer.invoke("whatsapp-get-profile-pic", { jid }),
  getGroupMetadata: (jid) =>
    ipcRenderer.invoke("whatsapp-get-group-metadata", { jid }),
  getContactInfo: (jid) =>
    ipcRenderer.invoke("whatsapp-get-contact-info", { jid }),
  loadMessages: (jid, limit) =>
    ipcRenderer.invoke("whatsapp-load-messages", { jid, limit }),
  markRead: (jid) => ipcRenderer.invoke("whatsapp-mark-read", { jid }),
  chatAction: (jid, action) =>
    ipcRenderer.invoke("whatsapp-chat-action", { jid, action }),
  sendMessage: (to, content) =>
    ipcRenderer.invoke("whatsapp-send-message", { to, content }),
  deleteMessage: (jid, key) =>
    ipcRenderer.invoke("whatsapp-delete-message", { jid, key }),
  sendMedia: (to, filePath, caption) =>
    ipcRenderer.invoke("whatsapp-send-media", { to, filePath, caption }),
  sendAudio: (to, audioData, mimetype) =>
    ipcRenderer.invoke("whatsapp-send-audio", { to, audioData, mimetype }),
  sendSticker: (to, filePath) =>
    ipcRenderer.invoke("whatsapp-send-sticker", { to, filePath }),
  reactMessage: (jid, key, emoji) =>
    ipcRenderer.invoke("whatsapp-react-message", { jid, key, emoji }),
  forwardMessage: (fromJid, messageId, toJid) =>
    ipcRenderer.invoke("whatsapp-forward-message", { fromJid, messageId, toJid }),
  downloadMedia: (jid, messageId) =>
    ipcRenderer.invoke("whatsapp-download-media", { jid, messageId }),
  getLinkPreview: (url) =>
    ipcRenderer.invoke("whatsapp-get-link-preview", { url }),
  saveSticker: (jid, messageId, name) =>
    ipcRenderer.invoke("whatsapp-save-sticker", { jid, messageId, name }),
  listStickers: () => ipcRenderer.invoke("whatsapp-list-stickers"),
  sendSavedSticker: (to, stickerId) =>
    ipcRenderer.invoke("whatsapp-send-saved-sticker", { to, stickerId }),
  openFile: (filters) => ipcRenderer.invoke("dialog-open-file", { filters }),
  onMessage: (callback) =>
    ipcRenderer.on("whatsapp-message-received", (_, data) => callback(data)),
  onChatUpdate: (callback) =>
    ipcRenderer.on("whatsapp-chat-update", () => callback()),
  onSync: (callback) =>
    ipcRenderer.on("whatsapp-sync", (_, data) => callback(data)),
});
