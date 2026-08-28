/**
 * Controle de cota diária de mensagens por número WhatsApp.
 * Persistido em userData para sobreviver a reinícios do app.
 */
const path = require('path');
const fs = require('fs');

const LIMIT_TIERS = [10, 30, 60, 100];

function todayKey(now = Date.now()) {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

class DailyQuota {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'whatsapp-daily-quota.json');
    this.data = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        if (raw && typeof raw === 'object') return raw;
      }
    } catch (e) {
      console.log('[DAILY-QUOTA] load error:', e.message);
    }
    return { date: todayKey(), byConnection: {} };
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.filePath);
    } catch (e) {
      console.log('[DAILY-QUOTA] save error:', e.message);
    }
  }

  /** Garante que o contador é do dia atual (reseta à meia-noite local). */
  _roll(now = Date.now()) {
    const key = todayKey(now);
    if (this.data.date !== key) {
      this.data = { date: key, byConnection: {} };
      this._save();
    }
  }

  getUsage(connectionId, now = Date.now()) {
    this._roll(now);
    if (!connectionId) return 0;
    return Number(this.data.byConnection[connectionId] || 0);
  }

  getAllUsage(now = Date.now()) {
    this._roll(now);
    return {
      date: this.data.date,
      byConnection: { ...(this.data.byConnection || {}) },
    };
  }

  /**
   * @returns {{ unlimited: boolean, limit: number|null, used: number, remaining: number|null, allowed: boolean }}
   */
  check(connectionId, campaignSettings, now = Date.now()) {
    const cfg = campaignSettings || {};
    const unlimited = !!cfg.manualUnlimited;
    const limit = unlimited
      ? null
      : Number(cfg.dailyLimit) > 0
        ? Number(cfg.dailyLimit)
        : 10;
    const used = this.getUsage(connectionId, now);
    if (unlimited) {
      return { unlimited: true, limit: null, used, remaining: null, allowed: true };
    }
    const remaining = Math.max(0, limit - used);
    return {
      unlimited: false,
      limit,
      used,
      remaining,
      allowed: remaining > 0,
    };
  }

  /** Incrementa após envio confirmado. */
  recordSend(connectionId, count = 1, now = Date.now()) {
    if (!connectionId) return this.getUsage(connectionId, now);
    this._roll(now);
    const prev = Number(this.data.byConnection[connectionId] || 0);
    this.data.byConnection[connectionId] = prev + Math.max(1, count);
    this._save();
    return this.data.byConnection[connectionId];
  }

  /**
   * Resolve o limite efetivo a partir das settings do app.
   * Tiers progressivos: 10 → 30 → 60 → 100; manualUnlimited ignora teto.
   */
  static resolveLimitConfig(settingsCampaigns) {
    const c = settingsCampaigns || {};
    if (c.manualUnlimited) {
      return { manualUnlimited: true, dailyLimit: null };
    }
    let limit = Number(c.dailyLimit);
    if (!LIMIT_TIERS.includes(limit)) limit = 10;
    const unlocked = Array.isArray(c.unlockedLimits)
      ? c.unlockedLimits.map(Number).filter((n) => LIMIT_TIERS.includes(n))
      : [10];
    if (!unlocked.includes(10)) unlocked.unshift(10);
    // Se o limite escolhido não está desbloqueado, usa o maior desbloqueado
    if (!unlocked.includes(limit)) {
      limit = Math.max(...unlocked);
    }
    return { manualUnlimited: false, dailyLimit: limit, unlockedLimits: unlocked };
  }
}

module.exports = { DailyQuota, LIMIT_TIERS, todayKey };
