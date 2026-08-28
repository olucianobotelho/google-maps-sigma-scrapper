const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

let overridePath = null;

function getFilePath() {
  if (overridePath) return overridePath;
  try {
    const { app } = require("electron");
    return path.join(app.getPath("userData"), "install-id.json");
  } catch {
    return path.join(__dirname, "..", ".install-id.json");
  }
}

function setPath(p) {
  overridePath = p;
}

function ensureInstallId() {
  const fp = getFilePath();
  try {
    if (fs.existsSync(fp)) {
      const raw = JSON.parse(fs.readFileSync(fp, "utf-8"));
      if (raw && raw.id && typeof raw.id === "string" && raw.id.length >= 8) {
        return raw;
      }
    }
  } catch {}

  const data = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    platform: os.platform(),
    arch: os.arch(),
  };

  try {
    const dir = path.dirname(fp);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(data, null, 2), { mode: 0o600 });
  } catch {}

  return data;
}

function getInstallId() {
  try {
    const raw = JSON.parse(fs.readFileSync(getFilePath(), "utf-8"));
    if (raw && raw.id) return raw;
  } catch {}
  return ensureInstallId();
}

module.exports = { ensureInstallId, getInstallId, setPath, getFilePath };
