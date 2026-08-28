const { ProspectingStore } = require("./prospecting-store");
const { normalizeLead } = require("./normalizer");
const { analyzeWebsite } = require("./site-crawler");
const { calculateScore } = require("./scoring-engine");
const { analyzeWithSalesAI, analyzeBatchWithSalesAI } = require("./ai-sales-analyzer");

class LeadScoringService {
  constructor(userDataPath, onProgress = () => {}) {
    this.userDataPath = userDataPath;
    this.store = new ProspectingStore(userDataPath);
    this.onProgress = onProgress;
    this.activeJobs = new Map();
  }

  getSettings() {
    const settings = this.store.getSettings();
    return maskSettings(settings);
  }

  updateSettings(patch) {
    const nextPatch = { ...(patch || {}) };
    if (nextPatch.ai?.apiKey === "********") {
      nextPatch.ai = { ...nextPatch.ai };
      delete nextPatch.ai.apiKey;
    }
    if (nextPatch.ai?.fallbackProviders) {
      nextPatch.ai = { ...nextPatch.ai };
      nextPatch.ai.fallbackProviders = preserveMaskedProviderKeys(
        nextPatch.ai.fallbackProviders,
        this.store.getSettings().ai?.fallbackProviders,
      );
    }
    return maskSettings(this.store.updateSettings(nextPatch));
  }

  getAll(filters) {
    return {
      leads: this.store.getAll(filters || {}),
      stats: this.store.getStats(),
    };
  }

  getLead(id) {
    return this.store.get(id);
  }

  async analyzeLead(rawLead, options = {}) {
    const settings = this.store.getSettings();
    const normalized = normalizeLead(rawLead, options);
    const jobId = options.jobId || `ls_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const cancelToken = { cancelled: false };
    this.activeJobs.set(jobId, cancelToken);
    try {
      this.onProgress({ event: "started", jobId, leadId: normalized.id, name: normalized.company.name });
      const { siteAnalysis, baseScore } = await this._analyzeLeadBase(normalized, settings, jobId, cancelToken);
      const aiAnalysis = await analyzeWithSalesAI(normalized, siteAnalysis, baseScore, settings);
      const saved = this._saveAnalyzedLead(normalized, siteAnalysis, baseScore, aiAnalysis, settings);
      this.onProgress({ event: "completed", jobId, leadId: normalized.id, score: saved.score?.value });
      return saved;
    } finally {
      this.activeJobs.delete(jobId);
    }
  }

  async analyzeBatch(rawLeads, options = {}) {
    const leads = Array.isArray(rawLeads) ? rawLeads : [];
    const settings = this.store.getSettings();
    const jobId = options.jobId || `batch_${Date.now()}`;
    this.activeJobs.set(jobId, { cancelled: false });
    const results = [];
    const prepared = [];
    try {
      for (let index = 0; index < leads.length; index++) {
        const token = this.activeJobs.get(jobId);
        if (token?.cancelled) break;
        const lead = leads[index];
        this.onProgress({
          event: "batch-progress",
          jobId,
          index: index + 1,
          total: leads.length,
          progress: leads.length ? (index / leads.length) : 0,
          name: lead.name || lead.company?.name,
          message: `Analisando ${index + 1}/${leads.length}: ${lead.name || lead.company?.name || "lead"}`,
        });
        try {
          const normalized = normalizeLead(lead, options);
          const { siteAnalysis, baseScore } = await this._analyzeLeadBase(normalized, settings, jobId, token);
          const baseSaved = this._saveAnalyzedLead(normalized, siteAnalysis, baseScore, null, settings);
          this.onProgress({
            event: "saved",
            jobId,
            leadId: normalized.id,
            lead: baseSaved,
            stats: this.store.getStats(),
            progress: leads.length ? ((index + 1) / leads.length) : 1,
            message: `Score base salvo: ${normalized.company.name || "lead"} (${baseSaved.score?.value || 0} pts)`,
          });
          prepared.push({ lead: normalized, siteAnalysis, score: baseScore });
        } catch (e) {
          if (e.code === "LEAD_SCORE_CANCELLED") break;
          results.push({ success: false, error: e.message, lead });
          this.onProgress({
            event: "failed",
            jobId,
            index: index + 1,
            total: leads.length,
            progress: leads.length ? ((index + 1) / leads.length) : 1,
            name: lead.name || lead.company?.name,
            message: `Falha em ${lead.name || lead.company?.name || "lead"}: ${e.message}`,
          });
        }
        this.onProgress({
          event: "batch-progress",
          jobId,
          index: index + 1,
          total: leads.length,
          progress: leads.length ? ((index + 1) / leads.length) : 1,
          name: lead.name || lead.company?.name,
          message: `Progresso ${index + 1}/${leads.length}`,
        });
      }
      const chunks = chunk(prepared, Number(settings?.ai?.batchSize || 8));
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const token = this.activeJobs.get(jobId);
        if (token?.cancelled) break;
        const group = chunks[chunkIndex];
        this.onProgress({
          event: "ai-batch",
          jobId,
          progress: prepared.length ? (chunkIndex / chunks.length) : 1,
          message: `IA avaliando lote ${chunkIndex + 1}/${chunks.length} (${group.length} leads)`,
        });
        const analyses = await analyzeBatchWithSalesAI(group, settings);
        group.forEach((item, itemIndex) => {
          const saved = this._saveAnalyzedLead(item.lead, item.siteAnalysis, item.score, analyses[itemIndex], settings);
          results.push({ success: true, lead: saved });
          this.onProgress({
            event: "saved",
            jobId,
            leadId: saved.id,
            lead: saved,
            stats: this.store.getStats(),
            progress: chunks.length ? ((chunkIndex + 1) / chunks.length) : 1,
            message: `IA refinou: ${saved.company?.name || "lead"} (${saved.score?.value || 0} pts)`,
          });
        });
      }
    } finally {
      this.activeJobs.delete(jobId);
    }
    return {
      jobId,
      results,
      count: results.length,
      analyzedCount: results.filter((r) => r.success).length,
      failures: results.filter((r) => !r.success).length,
    };
  }

  cancel(jobId) {
    if (jobId && this.activeJobs.has(jobId)) {
      this.activeJobs.get(jobId).cancelled = true;
      return 1;
    }
    let count = 0;
    for (const token of this.activeJobs.values()) {
      token.cancelled = true;
      count++;
    }
    return count;
  }

  updateOutcome(id, outcome) {
    return this.store.updateOutcome(id, outcome);
  }

  clearAnalyses(options = {}) {
    return this.store.clearAnalyses(options);
  }

  listGroups() {
    return this.store.listGroups();
  }

  getGroup(id) {
    return this.store.getGroup(id);
  }

  createGroup(data) {
    return this.store.createGroup(data || {});
  }

  updateGroup(id, patch) {
    return this.store.updateGroup(id, patch || {});
  }

  deleteGroup(id, options = {}) {
    return this.store.deleteGroup(id, options);
  }

  addLeadsToGroup(groupId, leadIds) {
    return this.store.addLeadsToGroup(groupId, leadIds);
  }

  removeLeadsFromGroup(groupId, leadIds) {
    return this.store.removeLeadsFromGroup(groupId, leadIds);
  }

  createGroupFromFilters(name, filters, options = {}) {
    return this.store.createGroupFromFilters(name, filters, options);
  }

  async _analyzeLeadBase(normalized, settings, jobId, cancelToken) {
    const siteAnalysis = await analyzeWebsite(normalized, settings, this.userDataPath, (message) => {
      this.onProgress({ event: "progress", jobId, leadId: normalized.id, message });
    }, cancelToken);
    const baseScore = calculateScore(normalized, siteAnalysis, {}, settings);
    return { siteAnalysis, baseScore };
  }

  _saveAnalyzedLead(normalized, siteAnalysis, baseScore, aiAnalysis, settings) {
    const finalScore = calculateScore(normalized, siteAnalysis, {
      scoreContribution: aiContribution(aiAnalysis, baseScore),
    }, settings);
    if (Number.isFinite(Number(aiAnalysis?.score))) {
      finalScore.value = Math.round((finalScore.value * 0.7) + (Number(aiAnalysis.score) * 0.3));
      finalScore.priority = require("./scoring-engine").classify(finalScore.value, settings?.rules?.thresholds);
      finalScore.classification = {
        ignorar: "Pular por agora",
        baixa: "Depois",
        boa: "Vale a pena",
        alta: "Ligar primeiro",
      }[finalScore.priority];
      finalScore.worthProspecting = finalScore.value >= Number(settings?.rules?.thresholds?.goodFrom || 60);
    }
    const previous = this.store.get(normalized.id) || {};
    return this.store.upsert({
      ...normalized,
      searchId: normalized.searchId || previous.searchId || "",
      searchLabel: normalized.searchLabel || previous.searchLabel || "",
      query: normalized.query || previous.query || "",
      siteAnalysis,
      screenshots: siteAnalysis.screenshots || {},
      score: finalScore,
      aiAnalysis: aiAnalysis || previous.aiAnalysis || null,
      prospecting: {
        status: "not_contacted",
        ...(previous.prospecting || {}),
      },
    });
  }
}

function aiContribution(aiAnalysis, baseScore) {
  if (!aiAnalysis) return 0;
  const aiScore = Number(aiAnalysis.score);
  if (!Number.isFinite(aiScore)) return 0;
  return Math.max(-8, Math.min(15, Math.round((aiScore - baseScore.value) * 0.2)));
}

function maskSettings(settings) {
  return {
    ...settings,
    ai: {
      ...settings.ai,
      apiKey: settings.ai?.apiKey ? "********" : "",
      hasApiKey: !!settings.ai?.apiKey,
      fallbackProviders: maskProviderKeys(settings.ai?.fallbackProviders),
    },
  };
}

function maskProviderKeys(value) {
  if (!value) return "";
  try {
    const providers = JSON.parse(value);
    if (!Array.isArray(providers)) return value;
    return JSON.stringify(providers.map((provider) => ({
      ...provider,
      apiKey: provider.apiKey ? "********" : "",
      hasApiKey: !!provider.apiKey,
    })), null, 2);
  } catch {
    return value;
  }
}

function preserveMaskedProviderKeys(nextValue, previousValue) {
  try {
    const next = JSON.parse(nextValue);
    const previous = previousValue ? JSON.parse(previousValue) : [];
    if (!Array.isArray(next)) return nextValue;
    const restored = next.map((provider, index) => {
      if (provider.apiKey !== "********") return provider;
      const prev = previous[index] || {};
      return { ...provider, apiKey: prev.apiKey || "" };
    });
    return JSON.stringify(restored, null, 2);
  } catch {
    return nextValue;
  }
}

function chunk(items, size) {
  const n = Math.max(1, Math.min(25, Number(size || 8)));
  const out = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

module.exports = { LeadScoringService };
