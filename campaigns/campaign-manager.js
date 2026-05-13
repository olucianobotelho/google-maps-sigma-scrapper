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
    this._rebuildMessageIndex();
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
    return this.store.create(campaignData);
  }

  update(id, updates) {
    return this.store.update(id, updates);
  }

  delete(id) {
    // Remove entries from message index
    const campaign = this.store.get(id);
    if (campaign) {
      for (const lead of campaign.leads || []) {
        if (lead.messageId) this._messageIndex.delete(lead.messageId);
      }
    }
    return this.store.delete(id);
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
    let changed = null;
    const now = Date.now();
    for (const campaign of this.store.getAll()) {
      const lead = (campaign.leads || []).find(l => {
        const leadDigits = String(l.phone || '').replace(/\D/g, '');
        return leadDigits && leadDigits === digits && l.sentAt && !l.repliedAt;
      });
      if (!lead) continue;
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
  }
}

module.exports = { CampaignManager };
