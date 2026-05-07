const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { scrapeGoogleMaps } = require('./scraper');
const { saveToCSV } = require('./utils/csv');
const { saveReport } = require('./utils/report');

let mainWindow;
const resultStore = new Map();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    show: true,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));
  
  mainWindow.on('maximize', () => mainWindow?.webContents.send('win-state', true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('win-state', false));
}

app.whenReady().then(() => {
  createWindow();
  cleanOldTempFiles();
});

// Clean temp files older than 24h
async function cleanOldTempFiles() {
  try {
    const userDataPath = app.getPath('userData');
    const files = fs.readdirSync(userDataPath);
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (file.startsWith('gmaps_') && (file.endsWith('.json') || file.endsWith('.csv') || file.endsWith('.txt'))) {
        const filePath = path.join(userDataPath, file);
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > oneDay) {
          fs.unlinkSync(filePath);
        }
      }
    }
  } catch (e) { /* ignore cleanup errors */ }
}

function sendProgress(msg) {
  if (mainWindow) mainWindow.webContents.send('progress', msg);
}

// ─── START SCRAPE ──────────────────────────
ipcMain.handle('start-scrape', async (_, { query, maxResults, queryId }) => {
  try {
    sendProgress(`Starting scrape for: ${query}`);
    const result = await scrapeGoogleMaps(query, maxResults, sendProgress);
    let data = result.data || [];

    // Deduplicate by name+address
    const seen = new Set();
    data = data.filter(item => {
      const key = `${item.name}||${item.address}`.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    sendProgress(`After dedup: ${data.length} unique results.`);

    const timestamp = Date.now();
    const safeQuery = query.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
    const base = `gmaps_${safeQuery}_${timestamp}`;

    const userDataPath = app.getPath('userData');
    if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true });

    const jsonPath = path.join(userDataPath, `${base}.json`);
    const csvPath = path.join(userDataPath, `${base}.csv`);
    const reportPath = path.join(userDataPath, `${base}_report.txt`);

    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
    saveToCSV(data, csvPath);
    saveReport(query, data, reportPath);

    const key = queryId || '_last';
    resultStore.set(key, { query, data, jsonPath, csvPath, reportPath, timestamp });

    sendProgress(`Scrape complete (${data.length} results).`);

    return { success: true, preview: data.slice(0, 3), count: data.length, data, statistics: result.statistics };
  } catch (err) {
    sendProgress(`Error: ${err.message}`);
    return { success: false, error: err.message };
  }
});

// ─── SAVE FILE ─────────────────────────────
ipcMain.handle('save-file', async (_, { type, queryId }) => {
  const key = queryId || '_last';
  const entry = resultStore.get(key);
  if (!entry) return { success: false, message: 'No results to save.' };

  const map = {
    json: { name: `gmaps_${entry.query}_${entry.timestamp}.json`, path: entry.jsonPath },
    csv: { name: `gmaps_${entry.query}_${entry.timestamp}.csv`, path: entry.csvPath },
    report: { name: `gmaps_${entry.query}_${entry.timestamp}_report.txt`, path: entry.reportPath }
  };

  if (!map[type]) return { success: false, message: 'Invalid type.' };

  const { filePath, canceled } = await dialog.showSaveDialog({
    title: `Save ${type.toUpperCase()}`,
    defaultPath: map[type].name
  });

  if (canceled || !filePath) return { success: false, message: 'Save cancelled.' };

  fs.copyFileSync(map[type].path, filePath);
  return { success: true, savedTo: filePath };
});

// ─── SAVE ALL (MERGED) ─────────────────────
ipcMain.handle('save-all-files', async (_, { type }) => {
  if (resultStore.size === 0) return { success: false, message: 'No results to save.' };

  // Merge all results
  const allData = [];
  for (const entry of resultStore.values()) {
    for (const item of entry.data) {
      allData.push({ query: entry.query, ...item });
    }
  }

  const timestamp = Date.now();
  const userDataPath = app.getPath('userData');

  if (type === 'json') {
    const tmpPath = path.join(userDataPath, `gmaps_all_${timestamp}.json`);
    fs.writeFileSync(tmpPath, JSON.stringify(allData, null, 2));

    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Save All JSON',
      defaultPath: `gmaps_all_${timestamp}.json`
    });
    if (canceled || !filePath) return { success: false, message: 'Save cancelled.' };
    fs.copyFileSync(tmpPath, filePath);
    fs.unlinkSync(tmpPath);
    return { success: true, savedTo: filePath };
  }

  if (type === 'csv') {
    const tmpPath = path.join(userDataPath, `gmaps_all_${timestamp}.csv`);
    saveToCSV(allData, tmpPath, true);

    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Save All CSV',
      defaultPath: `gmaps_all_${timestamp}.csv`
    });
    if (canceled || !filePath) return { success: false, message: 'Save cancelled.' };
    fs.copyFileSync(tmpPath, filePath);
    fs.unlinkSync(tmpPath);
    return { success: true, savedTo: filePath };
  }

  return { success: false, message: 'Invalid type.' };
});

// ─── EXPORT LEADS (cumulative from renderer) ─
ipcMain.handle('export-leads', async (_, { leads, format }) => {
  if (!leads || !leads.length) return { success: false, message: 'No leads to export.' };

  const timestamp = Date.now();
  const userDataPath = app.getPath('userData');
  const base = path.join(userDataPath, `sigma_leads_${timestamp}`);

  if (format === 'json') {
    fs.writeFileSync(`${base}.json`, JSON.stringify(leads, null, 2));
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Export Leads JSON',
      defaultPath: `sigma_leads_${timestamp}.json`
    });
    if (canceled || !filePath) return { success: false, message: 'Save cancelled.' };
    fs.copyFileSync(`${base}.json`, filePath);
    fs.unlinkSync(`${base}.json`);
    return { success: true, savedTo: filePath };
  }

  if (format === 'csv') {
    saveToCSV(leads, `${base}.csv`);
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Export Leads CSV',
      defaultPath: `sigma_leads_${timestamp}.csv`
    });
    if (canceled || !filePath) return { success: false, message: 'Save cancelled.' };
    fs.copyFileSync(`${base}.csv`, filePath);
    fs.unlinkSync(`${base}.csv`);
    return { success: true, savedTo: filePath };
  }

  return { success: false, message: 'Invalid format.' };
});

// ─── GET RESULT LIST ───────────────────────
ipcMain.handle('get-result-list', async () => {
  const list = [];
  for (const [key, entry] of resultStore) {
    list.push({ queryId: key, query: entry.query, count: entry.data.length, timestamp: entry.timestamp });
  }
  return list;
});

// ─── DELETE TEMP FILES ─────────────────────
ipcMain.handle('delete-temp-files', async () => {
  try {
    const userDataPath = app.getPath('userData');
    const files = fs.readdirSync(userDataPath);
    const deleted = [];

    for (const file of files) {
      if (file.startsWith('gmaps_') && (file.endsWith('.json') || file.endsWith('.csv') || file.endsWith('.txt'))) {
        const filePath = path.join(userDataPath, file);
        fs.unlinkSync(filePath);
        deleted.push(file);
      }
    }

    resultStore.clear();

    if (deleted.length === 0) {
      return { success: false, message: 'No files to delete.' };
    }

    return { success: true, message: `${deleted.length} files deleted.` };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ─── WINDOW CONTROLS ───────────────────────
ipcMain.handle('win-minimize', () => mainWindow?.minimize());
ipcMain.handle('win-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.handle('win-close', () => mainWindow?.close());
ipcMain.handle('win-is-maximized', () => mainWindow?.isMaximized());
