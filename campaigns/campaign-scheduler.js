const { interpolate } = require('./template-engine');
const fs = require('fs');
const path = require('path');
const { assertAllowedMediaPath, assertMaxBytes } = require('../utils/security');

const MAX_CAMPAIGN_MEDIA_BYTES = 50 * 1024 * 1024;

class CampaignScheduler {
  constructor(provider, store, onProgress, campaignManager) {
    this.provider = provider;
    this.store = store;
    this.onProgress = onProgress;
    this.campaignManager = campaignManager;
    this.activeCampaigns = new Set();
    this.intervalId = null;
    this.running = false;
    // Per-campaign last-sent timestamp + max concurrent retries
    this._lastSentAt = new Map();
    this._maxRetries = 2;
  }

  addCampaign(id) { this.activeCampaigns.add(id); }
  removeCampaign(id) {
    this.activeCampaigns.delete(id);
    this._lastSentAt.delete(id);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._scheduleNextTick(500);
  }

  stop() {
    this.running = false;
    if (this._tickTimer) {
      clearTimeout(this._tickTimer);
      this._tickTimer = null;
    }
  }

  // Adaptive tick: short cadence (1s) so per-campaign interval gates work,
  // but driven by setTimeout so we never drift or stack ticks.
  _scheduleNextTick(delay) {
    if (!this.running) return;
    this._tickTimer = setTimeout(async () => {
      try { await this.tick(); }
      catch (e) { console.log('[SCHEDULER] tick error:', e.message); }
      this._scheduleNextTick(1000);
    }, delay);
  }

  async tick() {
    if (this.activeCampaigns.size === 0) {
      this.stop();
      return;
    }

    const now = Date.now();
    // Snapshot to safely iterate (we mutate the Set during the loop)
    const campaignIds = [...this.activeCampaigns];

    for (const campaignId of campaignIds) {
      const campaign = this.store.get(campaignId);
      if (!campaign || !['running', 'scheduled'].includes(campaign.status)) {
        this.activeCampaigns.delete(campaignId);
        this._lastSentAt.delete(campaignId);
        continue;
      }

      // Scheduled start time not reached yet
      if (campaign.schedule.startAt && now < campaign.schedule.startAt) {
        if (campaign.status !== 'scheduled') {
          campaign.status = 'scheduled';
          this.store.update(campaignId, { status: 'scheduled' });
          if (this.onProgress) this.onProgress(campaignId, 'scheduled', { startsAt: campaign.schedule.startAt });
        }
        continue;
      }

      // Promote scheduled -> running once start time arrives
      if (campaign.status === 'scheduled') {
        campaign.status = 'running';
        this.store.update(campaignId, { status: 'running' });
        if (this.onProgress) this.onProgress(campaignId, 'started', { stats: campaign.stats });
      }

      // Working hours window (skip silently if outside)
      if (!this._withinWorkingHours(campaign.schedule, now)) continue;

      const leadIndex = campaign.leads.findIndex(l => l.status === 'pending');
      if (leadIndex === -1) {
        campaign.status = 'completed';
        this.store.update(campaignId, { status: 'completed' });
        this.activeCampaigns.delete(campaignId);
        this._lastSentAt.delete(campaignId);
        if (this.onProgress) this.onProgress(campaignId, 'completed', { stats: campaign.stats });
        continue;
      }

      // Per-campaign interval gate with jitter (anti-ban: breaks the
      // fixed-period pattern that WhatsApp's spam detection watches for).
      const lastSent = this._lastSentAt.get(campaignId) || 0;
      const baseInterval = campaign.schedule.intervalMs || 5000;
      if (lastSent && (now - lastSent) < this._intervalWithJitter(baseInterval)) continue;

      const lead = campaign.leads[leadIndex];
      const content = interpolate(campaign.template, lead);
      // Media attached at campaign level (template.media) wins over interpolated content.
      const media = (campaign.media) || (content.media) || null;

      let result;
      if (media && media.filePath) {
        result = await this._sendWithMedia(lead.phone, content, media);
      } else {
        result = await this.provider.sendMessage(lead.phone, content);
      }

      if (result.success) {
        lead.status = 'sent';
        lead.sentAt = now;
        lead.messageId = result.messageId || null;
        lead.retryCount = 0;
        if (this.campaignManager && result.messageId) {
          this.campaignManager.registerMessageId(campaignId, leadIndex, result.messageId);
        }
      } else {
        // Retry transient failures a limited number of times before giving up
        const attempts = (lead.retryCount || 0) + 1;
        lead.retryCount = attempts;
        if (attempts <= this._maxRetries) {
          lead.status = 'pending'; // will be retried on a future tick
          lead.errorMessage = `tentativa ${attempts}: ${result.error}`;
        } else {
          lead.status = 'failed';
          lead.errorMessage = result.error;
          lead.sentAt = now;
        }
      }

      // Record sent time only when we actually attempted an send (success or final fail),
      // so the per-campaign interval applies between real attempts.
      this._lastSentAt.set(campaignId, now);

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

  _withinWorkingHours(schedule, now) {
    const wh = schedule && schedule.workingHours;
    if (!wh || (!wh.start && !wh.end)) return true;
    const d = new Date(now);
    const minutes = d.getHours() * 60 + d.getMinutes();
    const start = this._hhmmToMinutes(wh.start);
    const end = this._hhmmToMinutes(wh.end);
    if (start == null || end == null) return true;
    return minutes >= start && minutes < end;
  }

  // Jitter up to +40% of the base interval so successive sends never land
  // on a perfectly periodic cadence (anti-ban).
  _intervalWithJitter(baseInterval) {
    return Math.round(baseInterval * (1 + Math.random() * 0.4));
  }

  _hhmmToMinutes(value) {
    if (value == null) return null;
    const m = String(value).match(/^(\d{1,2}):?(\d{2})?$/);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + (parseInt(m[2], 10) || 0);
  }

  /** Reset failed leads back to pending so they get retried (manual "reenviar falhas"). */
  retryFailed(campaignId) {
    const campaign = this.store.get(campaignId);
    if (!campaign) return 0;
    let count = 0;
    for (const lead of campaign.leads || []) {
      if (lead.status === 'failed') {
        lead.status = 'pending';
        lead.retryCount = 0;
        lead.errorMessage = null;
        count++;
      }
    }
    if (count > 0) {
      campaign.stats = this._computeStats(campaign);
      this.store.update(campaignId, {
        leads: campaign.leads,
        stats: campaign.stats,
        status: campaign.status === 'completed' ? 'running' : campaign.status,
        updatedAt: Date.now(),
      });
      this.activeCampaigns.add(campaignId);
      this.start();
    }
    return count;
  }

  async _sendWithMedia(phone, content, media) {
    try {
      let mediaPath;
      try {
        mediaPath = assertAllowedMediaPath(media.filePath);
      } catch (e) {
        return { success: false, error: e.message };
      }
      if (!fs.existsSync(mediaPath)) {
        return { success: false, error: `Media file not found: ${mediaPath}` };
      }
      const stat = fs.statSync(mediaPath);
      assertMaxBytes(stat.size, MAX_CAMPAIGN_MEDIA_BYTES, 'Campaign media file');
      const buffer = fs.readFileSync(mediaPath);
      const ext = path.extname(mediaPath).toLowerCase();
      const mimeMap = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.gif': 'image/gif', '.webp': 'image/webp',
        '.mp4': 'video/mp4', '.3gp': 'video/3gpp',
        '.ogg': 'audio/ogg', '.opus': 'audio/opus',
        '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
        '.pdf': 'application/pdf',
        '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      };
      const mimetype = media.mimetype || mimeMap[ext] || 'application/octet-stream';

      const mediaContent = {};
      if (content.caption || content.text) {
        mediaContent.caption = content.caption || content.text;
      }

      if (mimetype.startsWith('image/')) {
        mediaContent.image = buffer;
        mediaContent.mimetype = mimetype;
      } else if (mimetype.startsWith('video/')) {
        mediaContent.video = buffer;
        mediaContent.mimetype = mimetype;
      } else if (mimetype.startsWith('audio/')) {
        mediaContent.audio = buffer;
        mediaContent.mimetype = mimetype;
        mediaContent.ptt = media.ptt || false;
      } else {
        mediaContent.document = buffer;
        mediaContent.fileName = media.fileName || path.basename(mediaPath);
        mediaContent.mimetype = mimetype;
      }

      return await this.provider.sendMedia(phone, mediaContent);
    } catch (e) {
      return { success: false, error: e.message };
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
