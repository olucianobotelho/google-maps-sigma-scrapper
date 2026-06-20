const { CampaignStore } = require('./campaign-store');
const { CampaignScheduler } = require('./campaign-scheduler');

class CampaignManager {
  constructor(userDataPath) {
    this.store = new CampaignStore(userDataPath);
    this.scheduler = null;
    this.provider = null;
    this.onProgress = null;
    // Reverse index: messageId -> { campaignId, leadIndex }
    this._messageIndex = new Map();
    // Reverse index: phoneDigits -> [{ campaignId, leadIndex }] for O(1) reply matching
    this._phoneIndex = new Map();
    this._rebuildMessageIndex();
    this._rebuildPhoneIndex();
  }

  _rebuildMessageIndex() {
    this._messageIndex.clear();
    for (const campaign of this.store.getAll()) {
      (campaign.leads || []).forEach((lead, idx) => {
        if (lead.messageId) {
          this._messageIndex.set(lead.messageId, { campaignId: campaign.id, leadIndex: idx });
        }
      });
    }
  }

  _digits(phone) {
    return String(phone || '').replace(/\D/g, '');
  }

  _phoneKeys(phone) {
    const digits = this._digits(phone);
    if (!digits) return [];
    const keys = new Set([digits]);
    if (digits.startsWith('55') && digits.length > 12) {
      keys.add(digits.slice(2));
    } else if (digits.length >= 10 && digits.length <= 11) {
      keys.add(`55${digits}`);
    }
    return [...keys];
  }

  _rebuildPhoneIndex() {
    this._phoneIndex.clear();
    for (const campaign of this.store.getAll()) {
      (campaign.leads || []).forEach((lead, idx) => {
        for (const d of this._phoneKeys(lead.phone)) {
          if (!this._phoneIndex.has(d)) this._phoneIndex.set(d, []);
          this._phoneIndex.get(d).push({ campaignId: campaign.id, leadIndex: idx });
        }
      });
    }
  }

  registerMessageId(campaignId, leadIndex, messageId) {
    if (messageId) {
      this._messageIndex.set(messageId, { campaignId, leadIndex });
    }
  }

  setProvider(provider) {
    this.provider = provider;
    if (this.scheduler) this.scheduler.provider = provider;
  }

  setProgressCallback(cb) {
    this.onProgress = cb;
  }

  create(campaignData) {
    const campaign = this.store.create(campaignData);
    this._rebuildPhoneIndex();
    return campaign;
  }

  update(id, updates) {
    const campaign = this.store.update(id, updates);
    this._rebuildMessageIndex();
    this._rebuildPhoneIndex();
    return campaign;
  }

  delete(id) {
    // Remove entries from message index
    const campaign = this.store.get(id);
    if (campaign) {
      for (const lead of campaign.leads || []) {
        if (lead.messageId) this._messageIndex.delete(lead.messageId);
      }
    }
    const result = this.store.delete(id);
    this._rebuildPhoneIndex();
    return result;
  }

  autoResume() {
    if (!this.provider || this.provider.getStatus() !== 'connected') return;
    const campaigns = this.store.getAll();
    let resumedCount = 0;
    for (const c of campaigns) {
      if (c.status === 'running' || c.status === 'scheduled') {
        try {
          this.start(c.id);
          resumedCount++;
        } catch (e) {
          console.error(`Failed to auto-resume campaign ${c.id}:`, e.message);
        }
      }
    }
    if (resumedCount > 0) {
      console.log(`[CAMPAIGN] Auto-resumed ${resumedCount} campaign(s).`);
    }
  }

  getAll() {
    return this.store.getAll();
  }

  get(id) {
    return this.store.get(id);
  }

  start(campaignId) {
    const campaign = this.store.get(campaignId);
    if (!campaign) throw new Error('Campaign not found');
    if (!this.provider || this.provider.getStatus() !== 'connected') {
      throw new Error('WhatsApp not connected');
    }

    campaign.status = 'running';
    const nextStatus = campaign.schedule?.startAt && Date.now() < campaign.schedule.startAt
      ? 'scheduled'
      : 'running';
    campaign.status = nextStatus;
    this.store.update(campaignId, { status: nextStatus });

    if (!this.scheduler) {
      this.scheduler = new CampaignScheduler(this.provider, this.store, this.onProgress, this);
    }
    this.scheduler.addCampaign(campaignId);
    this.scheduler.start();
  }

  pause(campaignId) {
    this.store.update(campaignId, { status: 'paused' });
    if (this.scheduler) {
      this.scheduler.removeCampaign(campaignId);
    }
  }

  resume(campaignId) {
    this.start(campaignId);
  }

  /** Reset failed leads back to pending and (re)start the scheduler. */
  retryFailed(campaignId) {
    if (!this.scheduler) {
      if (!this.provider || this.provider.getStatus() !== 'connected') {
        throw new Error('WhatsApp not connected');
      }
      const { CampaignScheduler } = require('./campaign-scheduler');
      this.scheduler = new CampaignScheduler(this.provider, this.store, this.onProgress, this);
    }
    const count = this.scheduler.retryFailed(campaignId);
    if (count > 0 && this.onProgress) {
      this.onProgress(campaignId, 'retry-queued', { count });
    }
    return count;
  }

  trackMessageStatus(messageId, status) {
    if (!messageId || !status) return null;
    
    // O(1) lookup via reverse index
    const entry = this._messageIndex.get(messageId);
    if (!entry) return null;
    
    const campaign = this.store.get(entry.campaignId);
    if (!campaign) return null;
    
    const lead = campaign.leads[entry.leadIndex];
    if (!lead) return null;
    
    const rank = { sent: 1, delivered: 2, read: 3 };
    const currentRank = rank[lead.status] || 0;
    const nextRank = rank[status] || 0;
    if (nextRank < currentRank) return null;
    
    const now = Date.now();
    lead.status = lead.repliedAt ? 'replied' : status;
    if (status === 'delivered' && !lead.deliveredAt) lead.deliveredAt = now;
    if (status === 'read' && !lead.readAt) lead.readAt = now;
    campaign.stats = this.store.recomputeStats(campaign);
    this.store.update(campaign.id, { leads: campaign.leads, stats: campaign.stats, updatedAt: now }, true);
    
    const changed = { campaignId: campaign.id, leadId: lead.leadId, status: lead.status, stats: campaign.stats };
    if (this.onProgress) this.onProgress(campaign.id, 'metric-update', changed);
    return changed;
  }

  trackIncomingMessage(jid, message) {
    if (!jid || message?.key?.fromMe) return null;
    const digits = String(jid).replace(/@.*$/, '').replace(/\D/g, '');
    if (!digits) return null;

    const now = Date.now();
    const entries = this._phoneKeys(digits).flatMap((key) => this._phoneIndex.get(key) || []);
    let changed = null;
    for (const entry of entries) {
      const campaign = this.store.get(entry.campaignId);
      if (!campaign) continue;
      const lead = campaign.leads && campaign.leads[entry.leadIndex];
      if (!lead) continue;
      if (!lead.sentAt || lead.repliedAt) continue;

      lead.repliedAt = now;
      lead.responseTimeMs = Math.max(0, now - lead.sentAt);
      lead.status = 'replied';
      campaign.stats = this.store.recomputeStats(campaign);
      this.store.update(campaign.id, { leads: campaign.leads, stats: campaign.stats, updatedAt: now }, true);
      changed = { campaignId: campaign.id, leadId: lead.leadId, status: lead.status, stats: campaign.stats };
      if (this.onProgress) this.onProgress(campaign.id, 'reply-received', changed);
    }
    return changed;
  }

  shutdown() {
    if (this.scheduler) {
      this.scheduler.stop();
    }
    if (this.store && this.store.flush) {
      this.store.flush();
    }
  }
}

module.exports = { CampaignManager };
