const path = require('path');
const fs = require('fs');

class CampaignStore {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'campaigns.json');
    this.campaigns = this._load();
    this._saveTimer = null;
  }

  _load() {
    if (fs.existsSync(this.filePath)) {
      try { return JSON.parse(fs.readFileSync(this.filePath, 'utf-8')); }
      catch (e) {
        const corruptPath = `${this.filePath}.corrupt-${Date.now()}`;
        try { fs.renameSync(this.filePath, corruptPath); }
        catch {}
        console.log('[CAMPAIGN-STORE] Corrupt store preserved:', corruptPath);
        return {};
      }
    }
    return {};
  }

  _writeAtomic() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    const bakPath = `${this.filePath}.bak`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.campaigns, null, 2), { mode: 0o600 });
    if (fs.existsSync(this.filePath)) {
      try { fs.copyFileSync(this.filePath, bakPath); }
      catch {}
    }
    fs.renameSync(tmpPath, this.filePath);
  }

  _save() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = null;
    this._writeAtomic();
  }

  // Debounced save for frequent tracking updates (delivered/read status)
  _saveDebounced() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      try {
        this._writeAtomic();
      } catch (e) {
        console.log('[CAMPAIGN-STORE] Save error:', e.message);
      }
    }, 2000);
  }

  create(data) {
    const id = data.id || `camp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    this.campaigns[id] = {
      id,
      name: data.name,
      provider: data.provider,
      connectionId: data.connectionId || null,
      template: data.template,
      media: (data.template && data.template.media) || null,
      leads: (data.leadIds || []).map(lid => ({
        leadId: lid.leadId || lid,
        name: lid.name || '',
        phone: lid.phone || '',
        phoneRaw: lid.phoneRaw || lid.phone || '',
        company: lid.company || '',
        category: lid.category || '',
        website: lid.website || '',
        site: lid.website || lid.site || '',
        instagram: lid.instagram || '',
        email: lid.email || '',
        address: lid.address || '',
        rating: lid.rating || '',
        totalReviews: lid.totalReviews || '',
        status: 'pending',
        errorMessage: null,
        sentAt: null,
        deliveredAt: null,
        readAt: null,
        repliedAt: null,
        responseTimeMs: null,
        messageId: null,
      })),
      schedule: {
        mode: data.schedule?.mode || 'immediate',
        intervalMs: Math.max(data.schedule?.intervalMs || 5000, 5000),
        startAt: data.schedule?.startAt || null,
      },
      status: 'ready',
      stats: {
        total: (data.leadIds || []).length,
        pending: (data.leadIds || []).length,
        sent: 0,
        delivered: 0,
        read: 0,
        replied: 0,
        failed: 0,
        avgResponseTimeMs: 0,
      },
      createdAt: now,
      updatedAt: now,
    };
    this._save();
    return this.campaigns[id];
  }

  update(id, partial, debounced = false) {
    if (!this.campaigns[id]) throw new Error(`Campaign ${id} not found`);
    Object.assign(this.campaigns[id], partial, { updatedAt: Date.now() });
    if (debounced) {
      this._saveDebounced();
    } else {
      this._save();
    }
    return this.campaigns[id];
  }

  delete(id) {
    delete this.campaigns[id];
    this._save();
  }

  get(id) {
    return this.campaigns[id] || null;
  }

  getAll() {
    return Object.values(this.campaigns);
  }

  recomputeStats(campaign) {
    const leads = campaign.leads || [];
    const responseTimes = leads
      .map(l => l.responseTimeMs)
      .filter(v => Number.isFinite(v) && v >= 0);
    return {
      total: leads.length,
      pending: leads.filter(l => l.status === 'pending').length,
      sent: leads.filter(l => ['sent', 'delivered', 'read', 'replied'].includes(l.status)).length,
      delivered: leads.filter(l => ['delivered', 'read', 'replied'].includes(l.status)).length,
      read: leads.filter(l => ['read', 'replied'].includes(l.status)).length,
      replied: leads.filter(l => l.repliedAt).length,
      failed: leads.filter(l => l.status === 'failed').length,
      avgResponseTimeMs: responseTimes.length
        ? Math.round(responseTimes.reduce((sum, v) => sum + v, 0) / responseTimes.length)
        : 0,
    };
  }

  flush() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
      this._writeAtomic();
    }
  }
}

module.exports = { CampaignStore };
