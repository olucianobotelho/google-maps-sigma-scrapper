const { interpolate } = require('./template-engine');
const fs = require('fs');
const path = require('path');
const { assertAllowedMediaPath, assertMaxBytes } = require('../utils/security');
const { DailyQuota } = require('./daily-quota');

const MAX_CAMPAIGN_MEDIA_BYTES = 50 * 1024 * 1024;

class CampaignScheduler {
  constructor(providersMap, store, onProgress, campaignManager) {
    this.providersMap = providersMap;
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

  _getSettingsCampaigns() {
    if (typeof this.campaignManager?.getCampaignSettings === 'function') {
      return this.campaignManager.getCampaignSettings() || {};
    }
    return {};
  }

  _getDailyQuota() {
    return this.campaignManager?.dailyQuota || null;
  }

  _ready(provider) {
    return provider && (
      typeof provider.isReady === 'function'
        ? provider.isReady()
        : provider.getStatus?.() === 'connected'
    );
  }

  /** Lista de connectionIds da campanha (multi + legado). */
  _campaignConnectionIds(campaign) {
    const ids = [];
    if (Array.isArray(campaign.connectionIds)) {
      for (const id of campaign.connectionIds) {
        if (id && !ids.includes(id)) ids.push(id);
      }
    }
    if (campaign.connectionId && !ids.includes(campaign.connectionId)) {
      ids.push(campaign.connectionId);
    }
    return ids;
  }

  /**
   * Escolhe lead pendente + provider com cota disponível.
   * Preferência: connectionId do lead → outros números da campanha com cota.
   */
  _pickNextSend(campaign) {
    const leads = campaign.leads || [];
    const pendingIdxs = [];
    for (let i = 0; i < leads.length; i++) {
      if (leads[i].status === 'pending') pendingIdxs.push(i);
    }
    if (!pendingIdxs.length) return { done: true };

    const campIds = this._campaignConnectionIds(campaign);
    const quota = this._getDailyQuota();
    const limitCfg = DailyQuota.resolveLimitConfig(this._getSettingsCampaigns());
    const map = this.providersMap;

    const tryConn = (connectionId, leadIndex) => {
      if (!connectionId || !map) return null;
      const provider = map.get(connectionId);
      if (!this._ready(provider)) return null;
      if (quota) {
        const check = quota.check(connectionId, limitCfg);
        if (!check.allowed) return null;
      }
      return { leadIndex, connectionId, provider, limitCfg };
    };

    // 1) lead com connectionId próprio e cota
    for (const idx of pendingIdxs) {
      const lead = leads[idx];
      const preferred = lead.connectionId || campaign.connectionId;
      const hit = tryConn(preferred, idx);
      if (hit) return hit;
    }

    // 2) reatribui para outro número da campanha com cota
    for (const idx of pendingIdxs) {
      for (const cid of campIds) {
        const hit = tryConn(cid, idx);
        if (hit) return hit;
      }
    }

    // 3) qualquer sessão online com cota (fallback legado)
    if (map) {
      for (const idx of pendingIdxs) {
        for (const [cid, provider] of map.entries()) {
          if (!this._ready(provider)) continue;
          if (quota) {
            const check = quota.check(cid, limitCfg);
            if (!check.allowed) continue;
          }
          return { leadIndex: idx, connectionId: cid, provider, limitCfg };
        }
      }
    }

    // Há pendentes mas ninguém com cota/online — classificar o motivo real
    const readyIds = map
      ? [...map.entries()].filter(([, p]) => this._ready(p)).map(([id]) => id)
      : [];
    if (!readyIds.length) {
      return { blocked: true, reason: 'no_provider', limitCfg };
    }
    // Alguém online: cota esgotada em TODOS os números utilizáveis?
    const candidateIds = campIds.length
      ? campIds.filter((id) => readyIds.includes(id))
      : readyIds;
    const pool = candidateIds.length ? candidateIds : readyIds;
    const allQuotaBlocked =
      !!quota &&
      !limitCfg.manualUnlimited &&
      pool.every((id) => !quota.check(id, limitCfg).allowed);
    return {
      blocked: true,
      reason: allQuotaBlocked ? 'daily_limit' : 'no_provider',
      limitCfg,
    };
  }

  async tick() {
    if (this.activeCampaigns.size === 0) {
      this.stop();
      return;
    }

    const now = Date.now();
    const campaignIds = [...this.activeCampaigns];
    const settingsCamp = this._getSettingsCampaigns();

    for (const campaignId of campaignIds) {
      const campaign = this.store.get(campaignId);
      if (!campaign || !['running', 'scheduled'].includes(campaign.status)) {
        this.activeCampaigns.delete(campaignId);
        this._lastSentAt.delete(campaignId);
        continue;
      }

      // Scheduled start time not reached yet
      if (campaign.schedule?.startAt && now < campaign.schedule.startAt) {
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
        this.store.update(campaignId, { status: 'running', pauseReason: null });
        if (this.onProgress) this.onProgress(campaignId, 'started', { stats: campaign.stats });
      }

      // Working hours: campanha > settings globais (padrão 07–18)
      if (!this._withinWorkingHours(campaign.schedule, settingsCamp, now)) {
        if (campaign.waitReason !== 'outside_hours') {
          campaign.waitReason = 'outside_hours';
          this.store.update(campaignId, { waitReason: 'outside_hours' }, true);
          if (this.onProgress) {
            this.onProgress(campaignId, 'waiting', {
              reason: 'outside_hours',
              stats: campaign.stats,
            });
          }
        }
        continue;
      }

      // Per-campaign interval gate with jitter
      const lastSent = this._lastSentAt.get(campaignId) || 0;
      const baseInterval = campaign.schedule?.intervalMs || 5000;
      if (lastSent && (now - lastSent) < this._intervalWithJitter(baseInterval)) continue;

      const pick = this._pickNextSend(campaign);

      if (pick.done) {
        campaign.status = 'completed';
        campaign.pauseReason = null;
        this.store.update(campaignId, { status: 'completed', pauseReason: null });
        this.activeCampaigns.delete(campaignId);
        this._lastSentAt.delete(campaignId);
        if (this.onProgress) this.onProgress(campaignId, 'completed', { stats: campaign.stats });
        continue;
      }

      if (pick.blocked) {
        if (pick.reason === 'daily_limit') {
          // Salva estado e pausa até amanhã / próxima cota
          campaign.status = 'paused';
          campaign.pauseReason = 'daily_limit';
          campaign.waitReason = 'daily_limit';
          this.store.update(campaignId, {
            status: 'paused',
            pauseReason: 'daily_limit',
            waitReason: 'daily_limit',
            updatedAt: now,
          });
          this.activeCampaigns.delete(campaignId);
          this._lastSentAt.delete(campaignId);
          this.store.pushEvent(campaign, {
            type: 'daily_limit',
            msg: 'Limite diário de mensagens atingido — campanha salva e retoma depois',
          });
          this.store.update(campaignId, { eventLog: campaign.eventLog }, true);
          if (this.onProgress) {
            this.onProgress(campaignId, 'daily-limit', {
              stats: campaign.stats,
              limit: pick.limitCfg?.dailyLimit,
            });
          }
          console.log(`[SCHEDULER] Campanha ${campaignId} pausada: limite diário`);
        } else {
          // WhatsApp offline / não pronto — mantém running e avisa a UI
          if (campaign.waitReason !== 'no_provider') {
            campaign.waitReason = 'no_provider';
            this.store.update(campaignId, { waitReason: 'no_provider' }, true);
            if (this.onProgress) {
              this.onProgress(campaignId, 'waiting', {
                reason: 'no_provider',
                stats: campaign.stats,
              });
            }
            console.log(`[SCHEDULER] Campanha ${campaignId} aguardando WhatsApp conectado`);
          }
        }
        continue;
      }

      // Conseguiu enviar de novo — limpa motivo de espera
      if (campaign.waitReason) {
        campaign.waitReason = null;
        this.store.update(campaignId, { waitReason: null }, true);
      }

      const lead = campaign.leads[pick.leadIndex];
      const provider = pick.provider;
      const connectionId = pick.connectionId;

      // Reatribui connectionId do lead / campanha se mudou
      if (lead.connectionId !== connectionId) {
        lead.connectionId = connectionId;
      }
      if (campaign.connectionId !== connectionId && !campaign.connectionIds?.length) {
        campaign.connectionId = connectionId;
        this.store.update(campaignId, { connectionId });
      }

      const content = interpolate(campaign.template, lead);
      const media = (campaign.media) || (content && content.media) || null;
      const textPreview = typeof content === 'string'
        ? content
        : (content?.text || content?.header || content?.caption || '');

      try {
        const destination = lead.isGroup
          ? (lead.jid || lead.phone)
          : (lead.jid || lead.phone);
        if (!destination) {
          throw new Error('Destinatário sem telefone/grupo');
        }

        let mediaContent = null;
        if (media && media.filePath) {
          mediaContent = await this._prepareMediaContent(media, typeof content === 'object' ? content : { text: content });
        }

        if (!mediaContent && !String(textPreview || '').trim()) {
          throw new Error('Mensagem vazia após aplicar o template (verifique {{variáveis}})');
        }

        console.log(
          `[SCHEDULER] Enviando campanha=${campaignId} conn=${connectionId} lead=${lead.name || lead.leadId} dest=${destination}`,
        );

        let result = null;
        if (mediaContent) {
          result = await provider.sendMedia(destination, mediaContent);
        } else {
          result = await provider.sendMessage(destination, content);
        }

        if (result && result.success && result.messageId) {
          lead.status = 'sent';
          lead.sentAt = now;
          lead.messageId = result.messageId;
          lead.jid = result.jid || null;
          lead.connectionId = connectionId;
          lead.errorMessage = null;
          lead.retryCount = 0;
          if (this.campaignManager) {
            this.campaignManager.registerMessageId(campaignId, pick.leadIndex, result.messageId);
          }
          // Cota diária por número
          const quota = this._getDailyQuota();
          if (quota) {
            const used = quota.recordSend(connectionId, 1, now);
            console.log(`[SCHEDULER] Cota ${connectionId}: ${used}${pick.limitCfg?.dailyLimit ? `/${pick.limitCfg.dailyLimit}` : ''}`);
          }
          try {
            const jid = result.jid || lead.jid;
            if (jid && provider?.sock?.presenceSubscribe) {
              provider.sock.presenceSubscribe(jid).catch(() => {});
            }
          } catch (_) { /* optional */ }
          console.log(`[SCHEDULER] OK messageId=${result.messageId} jid=${result.jid || '?'}`);
        } else {
          const errMsg = (result && result.error) || 'Envio sem confirmação do WhatsApp (sem messageId)';
          const attempts = (lead.retryCount || 0) + 1;
          lead.retryCount = attempts;
          if (attempts <= this._maxRetries) {
            lead.status = 'pending';
            lead.errorMessage = `tentativa ${attempts}: ${errMsg}`;
            console.warn(`[SCHEDULER] retry ${attempts}: ${errMsg}`);
          } else {
            lead.status = 'failed';
            lead.errorMessage = errMsg;
            lead.sentAt = now;
            console.error(`[SCHEDULER] FAIL: ${errMsg}`);
          }
        }
      } catch (e) {
        lead.status = 'failed';
        lead.errorMessage = e.message;
        lead.sentAt = now;
        console.error(`[SCHEDULER] exception:`, e.message);
      }

      this._lastSentAt.set(campaignId, now);

      campaign.stats = this._computeStats(campaign);
      campaign.updatedAt = now;
      this.store.update(campaignId, {
        leads: campaign.leads,
        stats: campaign.stats,
        connectionId: campaign.connectionId,
        connectionIds: campaign.connectionIds,
        updatedAt: now,
      }, true);

      if (this.onProgress) {
        this.onProgress(campaignId, 'lead-sent', {
          leadId: lead.leadId,
          status: lead.status,
          error: lead.errorMessage,
          connectionId,
          stats: campaign.stats,
        });
      }
    }
  }

  /**
   * Janela de horário:
   * 1) schedule.workingHours da campanha (se definido)
   * 2) settings.campaigns (workingHoursEnabled + start/end)
   * 3) se desabilitado → sempre true
   */
  _withinWorkingHours(schedule, settingsCamp, now) {
    const sc = settingsCamp || {};
    let start;
    let end;
    let enabled = true;

    const campWh = schedule && schedule.workingHours;
    if (campWh && (campWh.start || campWh.end)) {
      if (campWh.enabled === false) return true;
      start = campWh.start;
      end = campWh.end;
    } else {
      if (sc.workingHoursEnabled === false) return true;
      start = sc.workingHoursStart || '07:00';
      end = sc.workingHoursEnd || '18:00';
      enabled = sc.workingHoursEnabled !== false;
    }

    if (!enabled) return true;
    if (!start && !end) return true;

    const d = new Date(now);
    const minutes = d.getHours() * 60 + d.getMinutes();
    const startM = this._hhmmToMinutes(start);
    const endM = this._hhmmToMinutes(end);
    if (startM == null || endM == null) return true;
    // Janela que cruza meia-noite (ex.: 22:00–06:00)
    if (endM <= startM) {
      return minutes >= startM || minutes < endM;
    }
    return minutes >= startM && minutes < endM;
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
        pauseReason: null,
        updatedAt: Date.now(),
      });
      this.activeCampaigns.add(campaignId);
      this.start();
    }
    return count;
  }

  async _prepareMediaContent(media, content) {
    try {
      let mediaPath;
      try {
        mediaPath = assertAllowedMediaPath(media.filePath);
      } catch (e) {
        throw e;
      }
      if (!fs.existsSync(mediaPath)) {
        throw new Error(`Media file not found: ${mediaPath}`);
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

      return mediaContent;
    } catch (e) {
      throw e;
    }
  }

  _computeStats(campaign) {
    return this.store.recomputeStats(campaign);
  }
}

module.exports = { CampaignScheduler };
