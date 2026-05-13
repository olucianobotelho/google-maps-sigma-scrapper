const path = require("path");
const fs = require("fs");

class AuthStore {
  constructor(userDataPath) {
    this.authDir = path.join(userDataPath, "whatsapp-auth");
    if (!fs.existsSync(this.authDir)) {
      fs.mkdirSync(this.authDir, { recursive: true, mode: 0o700 });
    }
    this.metaConfigPath = path.join(this.authDir, "meta-config.json");
  }

  async loadBaileysState() {
    const { useMultiFileAuthState } = require("@whiskeysockets/baileys");
    return await useMultiFileAuthState(this.authDir);
  }

  async clearBaileysAuth() {
    const files = fs.readdirSync(this.authDir);
    for (const f of files) {
      if (f !== "meta-config.json") {
        fs.rmSync(path.join(this.authDir, f), { recursive: true, force: true });
      }
    }
  }

  async clearAppState() {
    // Only delete app state files, keep credentials
    const files = fs.readdirSync(this.authDir);
    for (const f of files) {
      if (
        f.startsWith("app-state") ||
        f.endsWith("-app-state") ||
        f.includes("pre-key")
      ) {
        fs.rmSync(path.join(this.authDir, f), { recursive: true, force: true });
      }
    }
  }

  saveMetaConfig(config) {
    fs.writeFileSync(this.metaConfigPath, JSON.stringify(config, null, 2), {
      mode: 0o600,
    });
  }

  loadMetaConfig() {
    if (fs.existsSync(this.metaConfigPath)) {
      return JSON.parse(fs.readFileSync(this.metaConfigPath, "utf-8"));
    }
    return null;
  }
}

module.exports = { AuthStore };
