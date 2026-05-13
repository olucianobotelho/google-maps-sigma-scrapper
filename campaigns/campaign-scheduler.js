const { interpolate } = require('./template-engine');

class CampaignScheduler {
  constructor(provider, store, onProgress, campaignManager) {
    this.provider = provider;
    this.store = store;
    this.onProgress = onProgress;
    this.campaignManager = campaignManager;
    this.activeCampaigns = new Set();
    this.intervalId = null;
    this.running = false;
  }

  addCampaign(id) {
    this.activeCampaigns.add(id);
  }

  removeCampaign(id) {
    this.activeCampaigns.delete(id);
  }

  start() {
    if (this.intervalId) return;
    this.running = true;
    this.intervalId = setInterval(() => this.tick(), 1000);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.running = false;
  }

  async tick() {
    if (this.activeCampaigns.size === 0) {
      this.stop();
      return;
    }

    const now = Date.now();

    for (const campaignId of this.activeCampaigns) {
      const campaign = this.store.get(campaignId);
      if (!campaign || !['running', 'scheduled'].includes(campaign.status)) {
        this.activeCampaigns.delete(campaignId);
        continue;
      }

      if (campaign.schedule.startAt && now < campaign.schedule.startAt) {
        if (campaign.status !== 'scheduled') {
          campaign.status = 'scheduled';
          this.store.update(campaignId, { status: 'scheduled' });
          if (this.onProgress) this.onProgress(campaignId, 'scheduled', { startsAt: campaign.schedule.startAt });
        }
        continue;
      }
      if (campaign.status === 'scheduled') {
        campaign.status = 'running';
        this.store.update(campaignId, { status: 'running' });
        if (this.onProgress) this.onProgress(campaignId, 'started', { stats: campaign.stats });
      }

      const leadIndex = campaign.leads.findIndex(l => l.status === 'pending');
      if (leadIndex === -1) {
        campaign.status = 'completed';
        this.store.update(campaignId, { status: 'completed' });
        this.activeCampaigns.delete(campaignId);
        if (this.onProgress) {
          this.onProgress(campaignId, 'completed', { stats: campaign.stats });
        }
        continue;
      }

      const lead = campaign.leads[leadIndex];
      const lastSent = campaign.leads
        .filter(l => l.sentAt)
        .reduce((max, l) => Math.max(max, l.sentAt), 0);
      const minInterval = campaign.schedule.intervalMs || 5000;
      if (lastSent && (now - lastSent) < minInterval) continue;

      const content = interpolate(campaign.template, lead);
      const result = typeof content === 'string'
        ? await this.provider.sendMessage(lead.phone, content)
        : await this.provider.sendMessage(lead.phone, content);

      if (result.success) {
        lead.status = 'sent';
        lead.sentAt = now;
        lead.messageId = result.messageId || null;
        // Register in reverse index for O(1) tracking
        if (this.campaignManager && result.messageId) {
          this.campaignManager.registerMessageId(campaignId, leadIndex, result.messageId);
        }
      } else {
        lead.status = 'failed';
        lead.errorMessage = result.error;
        lead.sentAt = now;
      }

      campaign.stats = this._computeStats(campaign);
      campaign.updatedAt = now;
      this.store.update(campaignId, {
        leads: campaign.leads,
        stats: campaign.stats,
        updatedAt: now,
      }, true);

      if (this.onProgress) {
        this.onProgress(campaignId, 'lead-sent', {
          leadId: lead.leadId,
          status: lead.status,
          error: lead.errorMessage,
          stats: campaign.stats,
        });
      }
    }
  }

  _computeStats(campaign) {
    const leads = campaign.leads;
    return {
      total: leads.length,
      pending: leads.filter(l => l.status === 'pending').length,
      sent: leads.filter(l => ['sent', 'delivered', 'read', 'replied'].includes(l.status)).length,
      delivered: leads.filter(l => ['delivered', 'read', 'replied'].includes(l.status)).length,
      read: leads.filter(l => ['read', 'replied'].includes(l.status)).length,
      replied: leads.filter(l => l.repliedAt).length,
      failed: leads.filter(l => l.status === 'failed').length,
      avgResponseTimeMs: (() => {
        const values = leads.map(l => l.responseTimeMs).filter(v => Number.isFinite(v) && v >= 0);
        return values.length ? Math.round(values.reduce((sum, v) => sum + v, 0) / values.length) : 0;
      })(),
    };
  }
}

module.exports = { CampaignScheduler };
