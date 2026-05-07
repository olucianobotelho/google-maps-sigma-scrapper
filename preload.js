const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startScrape: (query, maxResults) => ipcRenderer.invoke('start-scrape', { query, maxResults }),
  exportLeads: (leads, format) => ipcRenderer.invoke('export-leads', { leads, format }),
  deleteTempFiles: () => ipcRenderer.invoke('delete-temp-files'),
  onProgress: (callback) => ipcRenderer.on('progress', (_, msg) => callback(msg)),
  winMinimize: () => ipcRenderer.invoke('win-minimize'),
  winMaximize: () => ipcRenderer.invoke('win-maximize'),
  winClose: () => ipcRenderer.invoke('win-close'),
  winIsMaximized: () => ipcRenderer.invoke('win-is-maximized'),
  onWinState: (callback) => ipcRenderer.on('win-state', (_, state) => callback(state))
});
