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
    // Backoff por tentativa (30s, 2min, 10min) com jitter.
    this._retryBackoffMs = [30 * 1000, 2 * 60 * 1000, 10 * 60 * 1000];
    // Timeout de um envio individual e watchdog do tick inteiro. Sem isso,
    // uma promise pendurada congela o loop e nenhuma campanha volta a rodar.
    this._sendTimeoutMs = 120 * 1000;
    this._tickWatchdogMs = 5 * 60 * 1000;
    this._tickTimer = null;
    this._tickInFlight = 0;
    // Campanhas pausadas por cota: id -> timestamp em que podem ser retomadas.
    this._quotaWaiting = new Map();
  }

  addCampaign(id) { this.activeCampaigns.add(id); }
  removeCampaign(id) {
    this.activeCampaigns.delete(id);
    this._lastSentAt.delete(id);
    this._quotaWaiting.delete(id);
  }

  start() {
    if (this.running) {
      // Timer morto (tick pendurado ou handle perdido) não pode impedir a
      // retomada: sem isso, só reiniciar o app destravava o disparo.
      if (!this._tickTimer && !this._tickInFlight) this._scheduleNextTick(500);
      return;
    }
    this.running = true;
    this._scheduleNextTick(500);
  }

  _withTimeout(promise, ms, label) {
    if (!ms || !Number.isFinite(ms)) return promise;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error(`${label} excedeu ${Math.round(ms / 1000)}s`);
        error.code = 'SCHEDULER_TIMEOUT';
        reject(error);
      }, ms);
      promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); },
      );
    });
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
    if (this._tickTimer) return; // nunca empilha ticks
    this._tickTimer = setTimeout(async () => {
      this._tickTimer = null;
      this._tickInFlight = Date.now();
      try {
        // Watchdog: mesmo que algo dentro do tick pendure, o loop volta a
        // rodar e as outras campanhas continuam.
        await this._withTimeout(this.tick(), this._tickWatchdogMs, 'TICK');
      } catch (e) {
        console.error('[SCHEDULER] tick error:', e.message);
      } finally {
        this._tickInFlight = 0;
        this._scheduleNextTick(1000);
      }
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
  _pickNextSend(campaign, now = Date.now()) {
    const leads = campaign.leads || [];
    const pendingIdxs = [];
    for (let i = 0; i < leads.length; i++) {
      if (leads[i].status === 'pending') pendingIdxs.push(i);
    }
    if (!pendingIdxs.length) return { done: true };

    // Lead em backoff espera a própria janela antes de nova tentativa.
    const readyIdxs = pendingIdxs.filter((idx) => {
      const nextAt = Number(leads[idx].nextAttemptAt) || 0;
      return !nextAt || nextAt <= now;
    });
    if (!readyIdxs.length) {
      const nextAt = Math.min(
        ...pendingIdxs.map((idx) => Number(leads[idx].nextAttemptAt) || now),
      );
      return { waiting: true, nextAt };
    }

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
    for (const idx of readyIdxs) {
      const lead = leads[idx];
      const preferred = lead.connectionId || campaign.connectionId;
      const hit = tryConn(preferred, idx);
      if (hit) return hit;
    }

    // 2) reatribui para outro número da campanha com cota
    for (const idx of readyIdxs) {
      for (const cid of campIds) {
        const hit = tryConn(cid, idx);
        if (hit) return hit;
      }
    }

    // 3) Fallback legado SÓ para campanha sem número definido. Uma campanha
    // com número próprio nunca dispara por outra sessão (evita sair pelo
    // WhatsApp pessoal quando o número escolhido cai).
    if (map && campIds.length === 0) {
      for (const idx of readyIdxs) {
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
    const now = Date.now();

    // Retoma campanhas pausadas por cota quando o dia virou (ou quando o
    // WhatsApp volta) — sem exigir clique do usuário e sem reiniciar o app.
    await this._resumeQuotaPaused(now);

    if (this.activeCampaigns.size === 0 && this._quotaWaiting.size === 0) {
      this.stop();
      return;
    }

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

      const pick = this._pickNextSend(campaign, now);

      if (pick.waiting) {
        // Todos os pendentes estão em backoff; nada a fazer neste tick.
        continue;
      }

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
          const resumeAt = this._nextQuotaResetAt(now);
          this.store.update(campaignId, {
            status: 'paused',
            pauseReason: 'daily_limit',
            waitReason: 'daily_limit',
            nextResumeAt: resumeAt,
            updatedAt: now,
          });
          this.activeCampaigns.delete(campaignId);
          this._lastSentAt.delete(campaignId);
          this._quotaWaiting.set(campaignId, resumeAt);
          this.store.pushEvent(campaign, {
            type: 'daily_limit',
            msg: 'Limite diário de mensagens atingido — campanha retoma automaticamente quando a cota renovar',
          });
          this.store.update(campaignId, { eventLog: campaign.eventLog }, true);
          if (this.onProgress) {
            this.onProgress(campaignId, 'daily-limit', {
              stats: campaign.stats,
              limit: pick.limitCfg?.dailyLimit,
              nextResumeAt: resumeAt,
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
          result = await this._withTimeout(
            provider.sendMedia(destination, mediaContent),
            this._sendTimeoutMs,
            'SEND media',
          );
        } else {
          result = await this._withTimeout(
            provider.sendMessage(destination, content),
            this._sendTimeoutMs,
            'SEND text',
          );
        }

        if (result && result.success && result.messageId) {
          lead.status = 'sent';
          lead.sentAt = now;
          lead.messageId = result.messageId;
          lead.jid = result.jid || null;
          lead.connectionId = connectionId;
          lead.sentWith = connectionId;
          lead.errorMessage = null;
          lead.retryCount = 0;
          lead.nextAttemptAt = null;
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
            const baseDelay = this._retryBackoffMs[
              Math.min(attempts - 1, this._retryBackoffMs.length - 1)
            ];
            const delay = Math.round(baseDelay * (1 + Math.random() * 0.25));
            lead.nextAttemptAt = now + delay;
            console.warn(
              `[SCHEDULER] retry ${attempts} em ${Math.round(delay / 1000)}s: ${errMsg}`,
            );
          } else {
            lead.status = 'failed';
            lead.errorMessage = errMsg;
            lead.sentAt = now;
            lead.nextAttemptAt = null;
            console.error(`[SCHEDULER] FAIL: ${errMsg}`);
          }
        }
      } catch (e) {
        const timedOut =
          e?.code === 'SCHEDULER_TIMEOUT' || e?.code === 'SEND_TIMEOUT';
        lead.status = 'failed';
        lead.errorMessage = timedOut
          ? 'Tempo esgotado no envio — confirme no WhatsApp antes de reenviar'
          : e.message;
        lead.sentAt = now;
        lead.nextAttemptAt = null;
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

  /** Retoma campanhas pausadas por cota quando o dia virou. */
  async _resumeQuotaPaused(now) {
    if (!this._quotaWaiting.size) return;
    const settings = this._getSettingsCampaigns();
    if (settings.autoResumeDailyLimit === false) return;

    for (const [campaignId, resumeAt] of [...this._quotaWaiting.entries()]) {
      if (Number(resumeAt) > now) continue;
      this._quotaWaiting.delete(campaignId);
      const campaign = this.store.get(campaignId);
      if (!campaign) continue;
      if (campaign.status !== 'paused' || campaign.pauseReason !== 'daily_limit') continue;

      try {
        if (typeof this.campaignManager?.resume === 'function') {
          this.campaignManager.resume(campaignId, { confirmRecovery: true });
        } else {
          this.activeCampaigns.add(campaignId);
          this.start();
        }
        this.store.pushEvent(campaign, {
          type: 'daily_limit_reset',
          msg: 'Cota diária renovada — campanha retomada automaticamente',
        });
        this.store.update(campaignId, { eventLog: campaign.eventLog, nextResumeAt: null }, true);
        console.log(`[SCHEDULER] Campanha ${campaignId} retomada após renovar a cota`);
        if (this.onProgress) {
          this.onProgress(campaignId, 'resumed', { reason: 'daily_limit_reset' });
        }
      } catch (e) {
        // WhatsApp offline — tenta de novo em 5 min sem perder a campanha.
        this._quotaWaiting.set(campaignId, now + 5 * 60 * 1000);
        console.log(
          `[SCHEDULER] Cota renovada, mas ${campaignId} segue pausada: ${e.message}`,
        );
      }
    }
  }

  /** Próxima meia-noite local: momento em que a cota diária zera. */
  _nextQuotaResetAt(now = Date.now()) {
    const d = new Date(now);
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  }

  /**
   * Próximo instante em que a janela de horário permite enviar.
   * null = já está dentro da janela (ou não há janela ativa).
   */
  nextWindowStartAt(campaign, now = Date.now()) {
    const settings = this._getSettingsCampaigns();
    const schedule = campaign?.schedule || {};
    if (this._withinWorkingHours(schedule, settings, now)) return null;

    const start = schedule.workingHours?.start
      || settings.workingHoursStart
      || '07:00';
    const startM = this._hhmmToMinutes(start);
    if (startM == null) return null;

    const d = new Date(now);
    d.setHours(Math.floor(startM / 60), startM % 60, 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d.getTime();
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

    const minutes = this._zonedMinutes(now, sc.timeZone || schedule?.timeZone || null);
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

  // Minutos (0–1439) do instante na região configurada ('system' = relógio local).
  _zonedMinutes(nowMs, timeZone) {
    if (timeZone && timeZone !== 'system') {
      try {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).formatToParts(new Date(nowMs));
        const h = Number(parts.find((p) => p.type === 'hour')?.value);
        const m = Number(parts.find((p) => p.type === 'minute')?.value);
        if (Number.isFinite(h) && Number.isFinite(m)) return (h % 24) * 60 + (m % 60);
      } catch {
        /* zona inválida: cai para o relógio local */
      }
    }
    const d = new Date(nowMs);
    return d.getHours() * 60 + d.getMinutes();
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
        lead.nextAttemptAt = null;
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
        waitReason: null,
        nextResumeAt: null,
        updatedAt: Date.now(),
      });
      this._quotaWaiting.delete(campaignId);
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
