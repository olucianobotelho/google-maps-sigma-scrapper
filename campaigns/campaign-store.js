const path = require('path');
const fs = require('fs');
const {
  recomputeStats: computeAnalytics,
  emptyStats,
  defaultLeadTrackingFields,
} = require('./campaign-analytics');

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
    const connectionIds = Array.isArray(data.connectionIds)
      ? [...new Set(data.connectionIds.filter(Boolean))]
      : (data.connectionId ? [data.connectionId] : []);
    const primaryConnectionId = data.connectionId || connectionIds[0] || null;

    this.campaigns[id] = {
      id,
      name: data.name,
      provider: data.provider,
      connectionId: primaryConnectionId,
      connectionIds,
      template: data.template,
      media: (data.template && data.template.media) || null,
      leads: (data.leadIds || []).map((lid, idx) => {
        const assigned =
          lid.connectionId ||
          (connectionIds.length
            ? connectionIds[idx % connectionIds.length]
            : primaryConnectionId);
        return {
          leadId: lid.leadId || lid.id || lid.phone || lid.jid || String(lid),
          name: lid.name || '',
          phone: lid.phone || '',
          phoneRaw: lid.phoneRaw || lid.phone || '',
          jid: lid.jid || '',
          isGroup: !!lid.isGroup,
          source: lid.source || 'manual',
          connectionId: assigned || null,
          company: lid.company || '',
          category: lid.category || '',
          website: lid.website || '',
          site: lid.website || lid.site || '',
          instagram: lid.instagram || '',
          email: lid.email || '',
          address: lid.address || '',
          rating: lid.rating || '',
          totalReviews: lid.totalReviews || '',
          score: lid.score || '',
          prioridade: lid.prioridade || '',
          dor_principal: lid.dor_principal || '',
          oportunidade_principal: lid.oportunidade_principal || '',
          argumento_principal: lid.argumento_principal || '',
          mensagem_whatsapp_ia: lid.mensagem_whatsapp_ia || '',
          ticket_estimado: lid.ticket_estimado || '',
          chance_resposta: lid.chance_resposta || '',
          ...defaultLeadTrackingFields(),
        };
      }),
      schedule: {
        mode: data.schedule?.mode || 'immediate',
        intervalMs: Math.max(data.schedule?.intervalMs || 5000, 5000),
        startAt: data.schedule?.startAt || null,
        workingHours: data.schedule?.workingHours || null,
      },
      status: 'ready',
      pauseReason: null,
      stats: emptyStats((data.leadIds || []).length),
      eventLog: [],
      createdAt: now,
      updatedAt: now,
    };
    this._save();
    return this.campaigns[id];
  }

  update(id, partial, debounced = false) {
    if (!this.campaigns[id]) throw new Error(`Campaign ${id} not found`);
    const campaign = this.campaigns[id];
    const next = { ...partial };
    if (Array.isArray(next.leads)) {
      const previous = new Map((campaign.leads || []).map((lead) => [String(lead.leadId || lead.phone || lead.jid), lead]));
      next.leads = next.leads.map((lead) => ({ ...(previous.get(String(lead.leadId || lead.phone || lead.jid)) || {}), ...lead }));
    }
    Object.assign(campaign, next, { updatedAt: Date.now() });
    if (debounced) {
      this._saveDebounced();
    } else {
      this._save();
    }
    return this.campaigns[id];
  }

  patchRecipient(id, leadId, patch, debounced = false) {
    const campaign = this.campaigns[id];
    if (!campaign) throw new Error(`Campaign ${id} not found`);
    const key = String(leadId || '');
    const index = (campaign.leads || []).findIndex((lead) => String(lead.leadId || lead.phone || lead.jid) === key);
    if (index < 0) throw new Error(`Recipient ${leadId} not found`);
    campaign.leads[index] = { ...campaign.leads[index], ...patch };
    campaign.updatedAt = Date.now();
    debounced ? this._saveDebounced() : this._save();
    return campaign;
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
    return computeAnalytics(campaign);
  }

  /** Append a short event to the campaign log (kept last 200 entries). */
  pushEvent(campaign, entry) {
    if (!campaign) return;
    if (!Array.isArray(campaign.eventLog)) campaign.eventLog = [];
    campaign.eventLog.push({
      at: Date.now(),
      ...entry,
    });
    if (campaign.eventLog.length > 200) {
      campaign.eventLog = campaign.eventLog.slice(-200);
    }
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
