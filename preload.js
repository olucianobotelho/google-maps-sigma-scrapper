const { contextBridge, ipcRenderer, webFrame } = require("electron");

webFrame.setZoomFactor(0.7);

contextBridge.exposeInMainWorld("electronAPI", {
  startScrape: (query, maxResults, queryId) =>
    ipcRenderer.invoke("start-scrape", { query, maxResults, queryId }),
  cancelScrape: (queryId) =>
    ipcRenderer.invoke("cancel-scrape", { queryId }),
  exportLeads: (leads, format) =>
    ipcRenderer.invoke("export-leads", { leads, format }),
  deleteTempFiles: () => ipcRenderer.invoke("delete-temp-files"),
  onProgress: (callback) => {
    const listener = (_, msg) => callback(msg);
    ipcRenderer.on("progress", listener);
    return () => ipcRenderer.removeListener("progress", listener);
  },
  winMinimize: () => ipcRenderer.invoke("win-minimize"),
  winMaximize: () => ipcRenderer.invoke("win-maximize"),
  winClose: () => ipcRenderer.invoke("win-close"),
  winIsMaximized: () => ipcRenderer.invoke("win-is-maximized"),
  reloadUI: () => ipcRenderer.invoke("reload-ui"),
  getTheme: () => ipcRenderer.invoke("theme-get"),
  setTheme: (theme) => ipcRenderer.invoke("theme-set", { theme }),
  onWinState: (callback) =>
    ipcRenderer.on("win-state", (_, state) => callback(state)),
  openExternal: (url) => ipcRenderer.invoke("open-external", { url }),
  checkUpdate: () => ipcRenderer.invoke("update-check"),
  downloadUpdate: () => ipcRenderer.invoke("update-download"),
  installUpdate: () => ipcRenderer.invoke("update-install"),
  getUpdateStatus: () => ipcRenderer.invoke("update-status"),
  onUpdateStatus: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on("update-status", listener);
    return () => ipcRenderer.removeListener("update-status", listener);
  },
  getMetrics: () => ipcRenderer.invoke("metrics-get"),
  trackMetric: (event, data) => ipcRenderer.invoke("metrics-track", { event, data }),
  getMetricsSettings: () => ipcRenderer.invoke("metrics-settings-get"),
  setMetricsSettings: (patch) => ipcRenderer.invoke("metrics-settings-set", patch),
});

contextBridge.exposeInMainWorld("whatsappAPI", {
  connect: (provider, config) =>
    ipcRenderer.invoke("whatsapp-connect", { provider, config }),
  disconnect: (connectionId) =>
    ipcRenderer.invoke("whatsapp-disconnect", { connectionId }),
  removeConnection: (connectionId) => ipcRenderer.invoke("whatsapp-remove-connection", { connectionId }),
  getStatus: () => ipcRenderer.invoke("whatsapp-status"),
  listConnections: () => ipcRenderer.invoke("whatsapp-list-connections"),
  switchConnection: (connectionId) =>
    ipcRenderer.invoke("whatsapp-switch-connection", { connectionId }),
  forceResync: (connectionId) =>
    ipcRenderer.invoke("whatsapp-force-resync", { connectionId }),
  onStatus: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on("whatsapp-status-changed", listener);
    return () => ipcRenderer.removeListener("whatsapp-status-changed", listener);
  },
});

contextBridge.exposeInMainWorld("campaignAPI", {
  create: (data) => ipcRenderer.invoke("campaign-create", data),
  update: (id, updates) =>
    ipcRenderer.invoke("campaign-update", { id, updates }),
  delete: (id) => ipcRenderer.invoke("campaign-delete", { id }),
  start: (id, connectionId) =>
    ipcRenderer.invoke("campaign-start", { id, connectionId }),
  pause: (id) => ipcRenderer.invoke("campaign-pause", { id }),
  resume: (id, connectionId) =>
    ipcRenderer.invoke("campaign-resume", { id, connectionId }),
  retryFailed: (id, connectionId) =>
    ipcRenderer.invoke("campaign-retry-failed", { id, connectionId }),
  getAll: () => ipcRenderer.invoke("campaign-get-all"),
  get: (id) => ipcRenderer.invoke("campaign-get", { id }),
  export: (id, format) => ipcRenderer.invoke("campaign-export", { id, format }),
  preview: (template, leadId) =>
    ipcRenderer.invoke("template-preview", { template, leadId }),
  normalize: (phone, cc) =>
    ipcRenderer.invoke("phone-normalize", { phone, countryCode: cc }),
  onProgress: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on("campaign-progress", listener);
    return () => ipcRenderer.removeListener("campaign-progress", listener);
  },
});

contextBridge.exposeInMainWorld("leadScoringAPI", {
  analyzeLead: (lead, options) =>
    ipcRenderer.invoke("lead-scoring-analyze-lead", { lead, options }),
  analyzeBatch: (leads, options) =>
    ipcRenderer.invoke("lead-scoring-analyze-batch", { leads, options }),
  cancel: (jobId) => ipcRenderer.invoke("lead-scoring-cancel", { jobId }),
  clearAnalyses: (opts) => ipcRenderer.invoke("lead-scoring-clear", opts || {}),
  getAll: (filters) => ipcRenderer.invoke("lead-scoring-get-all", { filters }),
  getLead: (id) => ipcRenderer.invoke("lead-scoring-get-lead", { id }),
  updateOutcome: (id, outcome) =>
    ipcRenderer.invoke("lead-scoring-update-outcome", { id, outcome }),
  export: (filters, format) =>
    ipcRenderer.invoke("lead-scoring-export", { filters, format }),
  getSettings: () => ipcRenderer.invoke("lead-scoring-get-settings"),
  updateSettings: (patch) =>
    ipcRenderer.invoke("lead-scoring-update-settings", { patch }),
  openScreenshot: (filePath) =>
    ipcRenderer.invoke("lead-scoring-open-screenshot", { filePath }),
  createCampaign: (ids, name, connectionId) =>
    ipcRenderer.invoke("lead-scoring-create-campaign", { ids, name, connectionId }),
  listGroups: () => ipcRenderer.invoke("lead-scoring-list-groups"),
  createGroup: (data) => ipcRenderer.invoke("lead-scoring-create-group", data || {}),
  updateGroup: (id, patch) => ipcRenderer.invoke("lead-scoring-update-group", { id, patch }),
  deleteGroup: (id, opts) => ipcRenderer.invoke("lead-scoring-delete-group", { id, ...(opts || {}) }),
  addToGroup: (groupId, leadIds) =>
    ipcRenderer.invoke("lead-scoring-add-to-group", { groupId, leadIds }),
  removeFromGroup: (groupId, leadIds) =>
    ipcRenderer.invoke("lead-scoring-remove-from-group", { groupId, leadIds }),
  createGroupFromFilters: (name, filters, opts) =>
    ipcRenderer.invoke("lead-scoring-create-group-from-filters", {
      name,
      filters,
      ...(opts || {}),
    }),
  onProgress: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on("lead-scoring-progress", listener);
    return () => ipcRenderer.removeListener("lead-scoring-progress", listener);
  },
});

contextBridge.exposeInMainWorld("chatAPI", {
  getChats: (connectionId) =>
    ipcRenderer.invoke("whatsapp-get-chats", { connectionId }),
  getContacts: (connectionId) =>
    ipcRenderer.invoke("whatsapp-get-contacts", { connectionId }),
  getArchivedChats: (connectionId) =>
    ipcRenderer.invoke("whatsapp-get-archived-chats", { connectionId }),
  getSettings: () => ipcRenderer.invoke("whatsapp-get-settings"),
  updateSettings: (patch) =>
    ipcRenderer.invoke("whatsapp-update-settings", { patch }),
  startChat: (phone, name) =>
    ipcRenderer.invoke("whatsapp-start-chat", { phone, name }),
  getMessages: (jid, connectionId) =>
    ipcRenderer.invoke("whatsapp-get-messages", { jid, connectionId }),
  getProfilePic: (jid, connectionId) =>
    ipcRenderer.invoke("whatsapp-get-profile-pic", { jid, connectionId }),
  getGroupMetadata: (jid, connectionId) =>
    ipcRenderer.invoke("whatsapp-get-group-metadata", { jid, connectionId }),
  getContactInfo: (jid, connectionId) =>
    ipcRenderer.invoke("whatsapp-get-contact-info", { jid, connectionId }),
  loadMessages: (jid, limit, connectionId) =>
    ipcRenderer.invoke("whatsapp-load-messages", { jid, limit, connectionId }),
  markRead: (jid, connectionId) =>
    ipcRenderer.invoke("whatsapp-mark-read", { jid, connectionId }),
  chatAction: (jid, action, connectionId) =>
    ipcRenderer.invoke("whatsapp-chat-action", { jid, action, connectionId }),
  sendMessage: (to, content, connectionId) =>
    ipcRenderer.invoke("whatsapp-send-message", { to, content, connectionId }),
  deleteMessage: (jid, key, connectionId, forEveryone = true) =>
    ipcRenderer.invoke("whatsapp-delete-message", {
      jid,
      key,
      connectionId,
      forEveryone,
    }),
  getLabels: () => ipcRenderer.invoke("whatsapp-labels-get"),
  saveLabelCatalog: (catalog) =>
    ipcRenderer.invoke("whatsapp-labels-save-catalog", { catalog }),
  setContactLabels: (jid, tagIds) =>
    ipcRenderer.invoke("whatsapp-labels-set-contact", { jid, tagIds }),
  sendMedia: (to, filePath, caption, connectionId) =>
    ipcRenderer.invoke("whatsapp-send-media", { to, filePath, caption, connectionId }),
  sendAudio: (to, audioData, mimetype, connectionId) =>
    ipcRenderer.invoke("whatsapp-send-audio", { to, audioData, mimetype, connectionId }),
  saveTriggerAudio: (payload) =>
    ipcRenderer.invoke("whatsapp-save-trigger-audio", payload || {}),
  deleteTriggerAudio: (filePath) =>
    ipcRenderer.invoke("whatsapp-delete-trigger-audio", { filePath }),
  readTriggerAudio: (filePath) =>
    ipcRenderer.invoke("whatsapp-read-trigger-audio", { filePath }),
  sendTriggerAudio: (to, filePath, connectionId) =>
    ipcRenderer.invoke("whatsapp-send-trigger-audio", { to, filePath, connectionId }),
  sendSticker: (to, filePath, connectionId) =>
    ipcRenderer.invoke("whatsapp-send-sticker", { to, filePath, connectionId }),
  reactMessage: (jid, key, emoji, connectionId) =>
    ipcRenderer.invoke("whatsapp-react-message", { jid, key, emoji, connectionId }),
  forwardMessage: (fromJid, messageId, toJid, connectionId) =>
    ipcRenderer.invoke("whatsapp-forward-message", { fromJid, messageId, toJid, connectionId }),
  downloadMedia: (jid, messageId, connectionId) =>
    ipcRenderer.invoke("whatsapp-download-media", { jid, messageId, connectionId }),
  openMedia: (filePath) =>
    ipcRenderer.invoke("whatsapp-open-media", { filePath }),
  getLinkPreview: (url) =>
    ipcRenderer.invoke("whatsapp-get-link-preview", { url }),
  saveSticker: (jid, messageId, name) =>
    ipcRenderer.invoke("whatsapp-save-sticker", { jid, messageId, name }),
  listStickers: () => ipcRenderer.invoke("whatsapp-list-stickers"),
  sendSavedSticker: (to, stickerId) =>
    ipcRenderer.invoke("whatsapp-send-saved-sticker", { to, stickerId }),
  openFile: (filters) => ipcRenderer.invoke("dialog-open-file", { filters }),
  onMessage: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on("whatsapp-message-received", listener);
    return () => ipcRenderer.removeListener("whatsapp-message-received", listener);
  },
  onChatUpdate: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("whatsapp-chat-update", listener);
    return () => ipcRenderer.removeListener("whatsapp-chat-update", listener);
  },
  onSync: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on("whatsapp-sync", listener);
    return () => ipcRenderer.removeListener("whatsapp-sync", listener);
  },
});
