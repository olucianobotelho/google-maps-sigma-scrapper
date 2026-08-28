const { CampaignStore } = require('./campaign-store');
const { CampaignScheduler } = require('./campaign-scheduler');
const { DailyQuota } = require('./daily-quota');

class CampaignManager {
  constructor(userDataPath) {
    this.store = new CampaignStore(userDataPath);
    this.dailyQuota = new DailyQuota(userDataPath);
    this.scheduler = null;
    this.providersMap = null;
    this.onProgress = null;
    /** @type {() => object} settings.campaigns provider (injected from main) */
    this._getCampaignSettings = null;
    // Reverse index: messageId -> { campaignId, leadIndex }
    this._messageIndex = new Map();
    // Reverse index: phoneDigits -> [{ campaignId, leadIndex }] for O(1) reply matching
    this._phoneIndex = new Map();
    this._rebuildMessageIndex();
    this._rebuildPhoneIndex();
  }

  setCampaignSettingsProvider(fn) {
    this._getCampaignSettings = typeof fn === 'function' ? fn : null;
  }

  getCampaignSettings() {
    if (this._getCampaignSettings) {
      try {
        return this._getCampaignSettings() || {};
      } catch {
        return {};
      }
    }
    return {};
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
    // Auto-resume is connection-aware: a campaign only resumes if its own
    // provider (connectionId) is currently connected. No global guard.
    // Também retoma campanhas pausadas por limite diário (novo dia / cota livre).
    const campaigns = this.store.getAll();
    let resumedCount = 0;
    for (const c of campaigns) {
      const shouldResume =
        c.status === 'running' ||
        c.status === 'scheduled' ||
        (c.status === 'paused' && c.pauseReason === 'daily_limit');
      if (!shouldResume) continue;
      try {
        this.start(c.id);
        resumedCount++;
      } catch (e) {
        console.error(`Failed to auto-resume campaign ${c.id}:`, e.message);
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

  setProvidersMap(map) {
    this.providersMap = map;
    if (this.scheduler) {
      this.scheduler.providersMap = map;
    }
  }

  _providerReady(provider) {
    if (!provider) return false;
    if (typeof provider.isReady === 'function') return !!provider.isReady();
    return provider.getStatus?.() === 'connected';
  }

  /**
   * Resolve o provider da campanha.
   * 1) connectionId salvo (se online)
   * 2) qualquer WhatsApp conectado (e reatribui o connectionId na campanha)
   */
  resolveProviderForCampaign(campaign, preferredActiveId = null) {
    const map = this.providersMap;
    if (!map || typeof map.get !== 'function' || map.size === 0) {
      return {
        ok: false,
        error: 'Nenhum WhatsApp carregado no app. Conecte um número em Conexão e tente de novo.',
        statuses: [],
      };
    }

    const statuses = [...map.entries()].map(([id, p]) => ({
      id,
      status: p?.getStatus?.() || 'unknown',
      phone: p?.getPhoneNumber?.() || null,
      ready: this._providerReady(p),
    }));

    const tryOrder = [];
    if (Array.isArray(campaign?.connectionIds)) {
      for (const id of campaign.connectionIds) {
        if (id && !tryOrder.includes(id)) tryOrder.push(id);
      }
    }
    if (campaign?.connectionId && !tryOrder.includes(campaign.connectionId)) {
      tryOrder.push(campaign.connectionId);
    }
    if (preferredActiveId && !tryOrder.includes(preferredActiveId)) {
      tryOrder.push(preferredActiveId);
    }
    for (const [id] of map.entries()) {
      if (!tryOrder.includes(id)) tryOrder.push(id);
    }

    for (const id of tryOrder) {
      const provider = map.get(id);
      if (this._providerReady(provider)) {
        const rebound = !!(campaign?.connectionId && campaign.connectionId !== id);
        return {
          ok: true,
          provider,
          connectionId: id,
          rebound,
          statuses,
        };
      }
    }

    const listed = statuses
      .map((s) => `${s.phone || s.id.slice(0, 12)}=${s.status}`)
      .join(', ');
    return {
      ok: false,
      error:
        `WhatsApp não está conectado para esta campanha` +
        (campaign?.connectionId ? ` (id: ${campaign.connectionId})` : '') +
        (listed ? `. Sessões: ${listed}` : '. Abra Conexão e escaneie o QR.'),
      statuses,
    };
  }

  start(campaignId, opts = {}) {
    const campaign = this.store.get(campaignId);
    if (!campaign) throw new Error('Campaign not found');

    // Ainda há leads pendentes?
    const hasPending = (campaign.leads || []).some((l) => l.status === 'pending');
    if (!hasPending && campaign.status !== 'scheduled') {
      this.store.update(campaignId, { status: 'completed', pauseReason: null });
      return { connectionId: campaign.connectionId, status: 'completed' };
    }

    const resolved = this.resolveProviderForCampaign(campaign, opts.activeConnectionId || null);
    if (!resolved.ok) {
      throw new Error(resolved.error || 'WhatsApp not connected for this campaign');
    }

    // Reatribui se o número salvo sumiu / ficou offline e há outro conectado
    if (resolved.rebound || campaign.connectionId !== resolved.connectionId) {
      console.log(
        `[CAMPAIGN] Rebind connectionId ${campaign.connectionId || '(vazio)'} → ${resolved.connectionId}`,
      );
      this.store.update(campaignId, { connectionId: resolved.connectionId });
      campaign.connectionId = resolved.connectionId;
    }

    const nextStatus = campaign.schedule?.startAt && Date.now() < campaign.schedule.startAt
      ? 'scheduled'
      : 'running';
    campaign.status = nextStatus;
    campaign.pauseReason = null;
    campaign.waitReason = null;
    this.store.update(campaignId, {
      status: nextStatus,
      pauseReason: null,
      waitReason: null,
    });

    if (!this.scheduler) {
      this.scheduler = new CampaignScheduler(this.providersMap, this.store, this.onProgress, this);
    } else {
      this.scheduler.providersMap = this.providersMap;
    }
    this.scheduler.addCampaign(campaignId);
    this.scheduler.start();
    console.log(
      `[CAMPAIGN] start ${campaignId} status=${nextStatus} conn=${resolved.connectionId} pending=${(campaign.leads || []).filter((l) => l.status === 'pending').length}`,
    );
    return { connectionId: resolved.connectionId, status: nextStatus };
  }

  pause(campaignId, reason = null) {
    this.store.update(campaignId, {
      status: 'paused',
      pauseReason: reason || null,
    });
    if (this.scheduler) {
      this.scheduler.removeCampaign(campaignId);
    }
  }

  resume(campaignId, opts = {}) {
    return this.start(campaignId, opts);
  }

  /** Reset failed leads back to pending and (re)start the scheduler. */
  retryFailed(campaignId, opts = {}) {
    const campaign = this.store.get(campaignId);
    if (!campaign) throw new Error('Campaign not found');
    const resolved = this.resolveProviderForCampaign(campaign, opts.activeConnectionId || null);
    if (!resolved.ok) {
      throw new Error(resolved.error || 'WhatsApp not connected for this campaign');
    }
    if (resolved.rebound || campaign.connectionId !== resolved.connectionId) {
      this.store.update(campaignId, { connectionId: resolved.connectionId });
      campaign.connectionId = resolved.connectionId;
    }
    if (!this.scheduler) {
      this.scheduler = new CampaignScheduler(this.providersMap, this.store, this.onProgress, this);
    } else {
      this.scheduler.providersMap = this.providersMap;
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

    const rank = { sent: 1, delivered: 2, read: 3, replied: 4 };
    const currentRank = rank[lead.status] || 0;
    const nextRank = rank[status] || 0;
    // Allow read re-fires to count as extra "opens" after first read
    const isReadAgain = status === 'read' && !!lead.readAt;
    if (nextRank < currentRank && !isReadAgain) return null;

    const now = Date.now();
    let openedNow = false;

    if (status === 'delivered' && !lead.deliveredAt) {
      lead.deliveredAt = now;
    }

    if (status === 'read') {
      if (!lead.readAt) lead.readAt = now;
      // First read = first conversation open (reliable WhatsApp signal)
      if (!lead.openedAt) {
        lead.openedAt = now;
        lead.openCount = Math.max(1, Number(lead.openCount) || 0);
        lead.lastOpenAt = now;
        openedNow = true;
      } else if (isReadAgain) {
        // Debounced reopen: only count if last open was > 5 min ago
        const last = lead.lastOpenAt || lead.openedAt || 0;
        if (now - last > 5 * 60 * 1000) {
          lead.openCount = (Number(lead.openCount) || 0) + 1;
          lead.lastOpenAt = now;
          openedNow = true;
        }
      }
    }

    // Never downgrade past replied
    if (lead.repliedAt) {
      lead.status = 'replied';
    } else if (!isReadAgain || nextRank >= currentRank) {
      lead.status = status;
    }

    campaign.stats = this.store.recomputeStats(campaign);
    if (status === 'delivered' && lead.deliveredAt === now) {
      this.store.pushEvent(campaign, {
        type: 'delivered',
        leadId: lead.leadId,
        name: lead.name || lead.phone,
      });
    }
    if (status === 'read' && (lead.readAt === now || openedNow)) {
      this.store.pushEvent(campaign, {
        type: openedNow && lead.openCount > 1 ? 'reopened' : 'read',
        leadId: lead.leadId,
        name: lead.name || lead.phone,
        openCount: lead.openCount,
      });
    }

    this.store.update(
      campaign.id,
      {
        leads: campaign.leads,
        stats: campaign.stats,
        eventLog: campaign.eventLog,
        updatedAt: now,
      },
      true
    );

    const changed = {
      campaignId: campaign.id,
      leadId: lead.leadId,
      status: lead.status,
      stats: campaign.stats,
      openCount: lead.openCount,
    };
    if (this.onProgress) this.onProgress(campaign.id, 'metric-update', changed);
    return changed;
  }

  /**
   * Presence-based conversation open (person came online / opened chat).
   * Debounced per lead (5 min). Only counts after the campaign message was sent.
   */
  _uniquePhoneEntries(digits) {
    const seen = new Set();
    const out = [];
    for (const key of this._phoneKeys(digits)) {
      for (const entry of this._phoneIndex.get(key) || []) {
        const id = `${entry.campaignId}:${entry.leadIndex}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(entry);
      }
    }
    return out;
  }

  trackConversationOpen(jid, connectionId) {
    if (!jid) return null;
    const digits = String(jid).replace(/@.*$/, '').replace(/\D/g, '');
    if (!digits) return null;

    const now = Date.now();
    const entries = this._uniquePhoneEntries(digits);
    let changed = null;

    for (const entry of entries) {
      const campaign = this.store.get(entry.campaignId);
      if (!campaign) continue;
      if (connectionId && campaign.connectionId && campaign.connectionId !== connectionId) continue;
      const lead = campaign.leads && campaign.leads[entry.leadIndex];
      if (!lead || !lead.sentAt) continue;

      const last = lead.lastOpenAt || lead.openedAt || 0;
      if (last && now - last < 5 * 60 * 1000) continue; // debounce

      if (!lead.openedAt) lead.openedAt = now;
      lead.openCount = (Number(lead.openCount) || 0) + 1;
      lead.lastOpenAt = now;

      // Presence open without read still means they engaged with the chat
      if (!lead.readAt && lead.status !== 'replied') {
        // Keep delivered/sent; don't fake a full "read" without ACK
      }

      campaign.stats = this.store.recomputeStats(campaign);
      this.store.pushEvent(campaign, {
        type: 'open',
        leadId: lead.leadId,
        name: lead.name || lead.phone,
        openCount: lead.openCount,
      });
      this.store.update(
        campaign.id,
        {
          leads: campaign.leads,
          stats: campaign.stats,
          eventLog: campaign.eventLog,
          updatedAt: now,
        },
        true
      );
      changed = {
        campaignId: campaign.id,
        leadId: lead.leadId,
        openCount: lead.openCount,
        stats: campaign.stats,
      };
      if (this.onProgress) this.onProgress(campaign.id, 'conversation-open', changed);
    }
    return changed;
  }

  trackIncomingMessage(jid, message, connectionId) {
    if (!jid || message?.key?.fromMe) return null;
    const digits = String(jid).replace(/@.*$/, '').replace(/\D/g, '');
    if (!digits) return null;

    const now = Date.now();
    const entries = this._uniquePhoneEntries(digits);
    let changed = null;

    for (const entry of entries) {
      const campaign = this.store.get(entry.campaignId);
      if (!campaign) continue;
      // Scope by connectionId: a reply on number A must not flip a lead in a
      // campaign running on number B, even if the phone digits match.
      if (connectionId && campaign.connectionId && campaign.connectionId !== connectionId) continue;
      const lead = campaign.leads && campaign.leads[entry.leadIndex];
      if (!lead) continue;
      if (!lead.sentAt) continue;

      // Window: only attribute replies within 14 days of send (avoid false matches forever)
      const WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
      if (now - lead.sentAt > WINDOW_MS) continue;

      const isFirstReply = !lead.repliedAt;
      if (isFirstReply) {
        lead.repliedAt = now;
        lead.responseTimeMs = Math.max(0, now - lead.sentAt);
      }
      lead.lastReplyAt = now;
      lead.replyCount = (Number(lead.replyCount) || 0) + 1;
      if (!Array.isArray(lead.replyTimestamps)) lead.replyTimestamps = [];
      lead.replyTimestamps.push(now);
      if (lead.replyTimestamps.length > 50) {
        lead.replyTimestamps = lead.replyTimestamps.slice(-50);
      }
      lead.status = 'replied';

      // A reply implies they opened the conversation
      if (!lead.openedAt) {
        lead.openedAt = now;
        lead.openCount = Math.max(1, Number(lead.openCount) || 0);
      }
      lead.lastOpenAt = now;

      campaign.stats = this.store.recomputeStats(campaign);
      this.store.pushEvent(campaign, {
        type: isFirstReply ? 'reply' : 'reply-again',
        leadId: lead.leadId,
        name: lead.name || lead.phone,
        replyCount: lead.replyCount,
        responseTimeMs: lead.responseTimeMs,
      });
      this.store.update(
        campaign.id,
        {
          leads: campaign.leads,
          stats: campaign.stats,
          eventLog: campaign.eventLog,
          updatedAt: now,
        },
        true
      );
      changed = {
        campaignId: campaign.id,
        leadId: lead.leadId,
        status: lead.status,
        replyCount: lead.replyCount,
        stats: campaign.stats,
      };
      if (this.onProgress) {
        this.onProgress(campaign.id, isFirstReply ? 'reply-received' : 'reply-again', changed);
      }
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
