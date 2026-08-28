const { app } = require("electron");

let autoUpdater = null;
let sendToRenderer = null;
let checkTimer = null;
let isInit = false;

function init(sendFn) {
  if (isInit) return;
  sendToRenderer = sendFn;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (e) {
    console.warn("[UPDATER] electron-updater não disponível:", e.message);
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on("checking-for-update", () => {
    emit("checking");
  });

  autoUpdater.on("update-available", (info) => {
    emit("available", { version: info.version, releaseNotes: info.releaseNotes });
  });

  autoUpdater.on("update-not-available", () => {
    emit("not-available");
  });

  autoUpdater.on("download-progress", (p) => {
    emit("progress", { percent: Math.round(p.percent || 0), bytesPerSecond: p.bytesPerSecond || 0 });
  });

  autoUpdater.on("update-downloaded", (info) => {
    emit("downloaded", { version: info.version });
  });

  autoUpdater.on("error", (err) => {
    emit("error", { message: err?.message || String(err) });
  });

  isInit = true;

  if (!app.isPackaged) {
    console.log("[UPDATER] skip check — app não está empacotado (dev)");
    return;
  }

  setTimeout(() => checkForUpdates(), 5000);
  checkTimer = setInterval(() => checkForUpdates(), 6 * 60 * 60 * 1000);
}

function emit(status, data) {
  const payload = { status, ...(data || {}), ts: Date.now() };
  try {
    if (sendToRenderer) sendToRenderer("update-status", payload);
  } catch {}
  console.log("[UPDATER]", status, data || "");
}

async function checkForUpdates() {
  if (!autoUpdater) return { success: false, error: "Updater não inicializado" };
  if (!app.isPackaged) return { success: false, error: "Disponível apenas no app instalado" };
  try {
    const result = await autoUpdater.checkForUpdates();
    return { success: true, updateInfo: result?.updateInfo || null };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function downloadUpdate() {
  if (!autoUpdater) return { success: false, error: "Updater não inicializado" };
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function quitAndInstall() {
  if (!autoUpdater) return;
  try {
    autoUpdater.quitAndInstall();
  } catch (e) {
    console.error("[UPDATER] quitAndInstall:", e.message);
  }
}

function getStatus() {
  return {
    isPackaged: app.isPackaged,
    version: app.getVersion(),
    hasUpdater: !!autoUpdater,
  };
}

function shutdown() {
  if (checkTimer) clearInterval(checkTimer);
  checkTimer = null;
}

module.exports = { init, checkForUpdates, downloadUpdate, quitAndInstall, getStatus, shutdown };
