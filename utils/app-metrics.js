const fs = require("fs");
const path = require("path");
const { getInstallId } = require("./install-id");

let overrideDir = null;
let metricsEndpoint = null;

function getUserDataDir() {
  if (overrideDir) return overrideDir;
  try {
    const { app } = require("electron");
    return app.getPath("userData");
  } catch {
    return path.join(__dirname, "..");
  }
}

function setDir(p) {
  overrideDir = p;
}

function setEndpoint(url) {
  metricsEndpoint = url || null;
}

function getSettingsPath() {
  return path.join(getUserDataDir(), "analytics-settings.json");
}

function loadSettings() {
  try {
    if (fs.existsSync(getSettingsPath())) {
      const raw = JSON.parse(fs.readFileSync(getSettingsPath(), "utf-8"));
      if (raw && typeof raw === "object") return raw;
    }
  } catch {}
  return { enabled: true, askedConsent: false };
}

function saveSettings(s) {
  try {
    const dir = getUserDataDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getSettingsPath(), JSON.stringify(s, null, 2), { mode: 0o600 });
  } catch {}
  return s;
}

function getEventsPath() {
  return path.join(getUserDataDir(), "usage-events.jsonl");
}

function getDailyPath() {
  return path.join(getUserDataDir(), "usage-daily.json");
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function loadDaily() {
  try {
    if (fs.existsSync(getDailyPath())) {
      return JSON.parse(fs.readFileSync(getDailyPath(), "utf-8"));
    }
  } catch {}
  return {};
}

function saveDaily(d) {
  try {
    fs.writeFileSync(getDailyPath(), JSON.stringify(d, null, 2), { mode: 0o600 });
  } catch {}
}

function getAppVersion() {
  try {
    const { app } = require("electron");
    return app.getVersion();
  } catch {
    try {
      return require("../package.json").version || "0.0.0";
    } catch {
      return "0.0.0";
    }
  }
}

function track(event, data) {
  try {
    const install = getInstallId();
    const settings = loadSettings();
    if (settings.enabled === false) return;

    const payload = {
      installId: install.id,
      event,
      ts: Date.now(),
      iso: new Date().toISOString(),
      version: getAppVersion(),
      ...((data && typeof data === "object") ? data : {}),
    };

    const dir = getUserDataDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(getEventsPath(), JSON.stringify(payload) + "\n");

    const daily = loadDaily();
    const key = todayKey();
    if (!daily[key]) daily[key] = {};
    daily[key][event] = (daily[key][event] || 0) + 1;
    daily[key]._total = (daily[key]._total || 0) + 1;
    saveDaily(daily);

    const endpoint = metricsEndpoint || process.env.SIGMA_METRICS_URL || null;
    if (endpoint && settings.enabled) {
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {});
    }
  } catch {}
}

function getStats() {
  const daily = loadDaily();
  let totalEvents = 0;
  let totalDays = 0;
  let todayCount = 0;
  const byEvent = {};

  for (const [day, counts] of Object.entries(daily)) {
    totalDays += 1;
    for (const [k, v] of Object.entries(counts)) {
      if (k === "_total") totalEvents += v;
      else byEvent[k] = (byEvent[k] || 0) + v;
    }
    if (day === todayKey()) todayCount = counts._total || 0;
  }

  let tail = [];
  try {
    if (fs.existsSync(getEventsPath())) {
      const lines = fs.readFileSync(getEventsPath(), "utf-8").trim().split("\n").filter(Boolean);
      tail = lines.slice(-20).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    }
  } catch {}

  return {
    install: getInstallId(),
    version: getAppVersion(),
    totalEvents,
    totalDays,
    todayCount,
    byEvent,
    daily,
    tail,
    settings: loadSettings(),
  };
}

function getInstall() {
  return getInstallId();
}

module.exports = {
  track,
  getStats,
  getInstall,
  loadSettings,
  saveSettings,
  setDir,
  setEndpoint,
  getEventsPath,
  getDailyPath,
  todayKey,
};
