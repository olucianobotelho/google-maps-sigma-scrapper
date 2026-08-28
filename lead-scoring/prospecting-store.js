const fs = require("fs");
const path = require("path");

function websiteValue(lead) {
  return String(lead?.company?.website || lead?.website || "").trim();
}

function instagramValue(lead) {
  const instagram = String(lead?.company?.instagram || lead?.instagram || "").trim();
  const website = websiteValue(lead);
  return instagram || (isInstagramUrl(website) ? website : "");
}

function isInstagramUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    return /(^|\.)instagram\.com$/i.test(url.hostname.replace(/^www\./i, ""));
  } catch {
    return /instagram\.com/i.test(raw);
  }
}

function hasWebsite(lead) {
  const website = websiteValue(lead);
  return !!website && !isInstagramUrl(website);
}

function hasInstagram(lead) {
  return !!instagramValue(lead);
}

class ProspectingStore {
  constructor(userDataPath) {
    this.root = path.join(userDataPath, "lead-scoring");
    this.filePath = path.join(this.root, "prospecting-leads.json");
    this.settingsPath = path.join(this.root, "lead-score-settings.json");
    this.groupsPath = path.join(this.root, "prospecting-groups.json");
    this.leads = this._loadJson(this.filePath, {});
    this.groups = this._loadJson(this.groupsPath, {});
    this.settings = mergeSettings(defaultSettings(), this._loadJson(this.settingsPath, {}));
    let dirty = false;
    if (!this.settings.analysis?.optimizedDefaultsApplied) {
      this.settings.analysis = {
        ...this.settings.analysis,
        maxPages: Math.min(Number(this.settings.analysis?.maxPages || 3), 3),
        timeoutMs: Math.min(Number(this.settings.analysis?.timeoutMs || 12000), 12000),
        saveScreenshots: false,
        blockHeavyAssets: true,
        optimizedDefaultsApplied: true,
      };
      dirty = true;
    }
    // v2: alta prioridade = site COM falhas; IA padrão OpenRouter + OpenCode grátis
    if (!this.settings.analysis?.priorityV2Applied) {
      const preset = defaultRules();
      this.settings.rules = {
        ...(this.settings.rules || {}),
        thresholds: { ...(this.settings.rules?.thresholds || {}), ...preset.thresholds },
        digitalPain: { ...(this.settings.rules?.digitalPain || {}), ...preset.digitalPain },
        conversionPotential: {
          ...(this.settings.rules?.conversionPotential || {}),
          ...preset.conversionPotential,
        },
      };
      const hasKey = !!(this.settings.ai?.apiKey && this.settings.ai.apiKey !== "********");
      if (!hasKey) {
        this.settings.ai = {
          ...(this.settings.ai || {}),
          provider: this.settings.ai?.provider === "opencode" ? "opencode" : "openrouter",
          model:
            this.settings.ai?.provider === "opencode"
              ? this.settings.ai?.model || "deepseek-v4-flash-free"
              : this.settings.ai?.model || "openrouter/free",
          baseUrl:
            this.settings.ai?.provider === "opencode"
              ? this.settings.ai?.baseUrl || "https://opencode.ai/zen/v1"
              : this.settings.ai?.baseUrl || "",
          siteUrl: this.settings.ai?.siteUrl || "https://sigma-gmaps.local",
          fallbackProviders:
            this.settings.ai?.fallbackProviders ||
            defaultSettings().ai.fallbackProviders,
        };
      }
      this.settings.analysis = {
        ...(this.settings.analysis || {}),
        priorityV2Applied: true,
      };
      dirty = true;
    }
    if (dirty) this.saveSettings();
  }

  _loadJson(filePath, fallback) {
    try {
      if (!fs.existsSync(filePath)) return fallback;
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch (e) {
      try {
        fs.renameSync(filePath, `${filePath}.corrupt-${Date.now()}`);
      } catch {}
      return fallback;
    }
  }

  _writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp`;
    const bakPath = `${filePath}.bak`;
    fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), { mode: 0o600 });
    if (fs.existsSync(filePath)) {
      try {
        fs.copyFileSync(filePath, bakPath);
      } catch {}
    }
    fs.renameSync(tmpPath, filePath);
  }

  save() {
    this._writeJson(this.filePath, this.leads);
  }

  saveGroups() {
    this._writeJson(this.groupsPath, this.groups);
  }

  saveSettings() {
    this._writeJson(this.settingsPath, this.settings);
  }

  getSettings() {
    return this.settings;
  }

  updateSettings(patch) {
    this.settings = mergeSettings(this.settings, patch || {});
    this.saveSettings();
    return this.settings;
  }

  upsert(analysis) {
    const id = analysis.id || createLeadId(analysis.company || analysis);
    const previous = this.leads[id] || {};
    this.leads[id] = {
      ...previous,
      ...analysis,
      id,
      createdAt: previous.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    this.save();
    return this.leads[id];
  }

  get(id) {
    return this.leads[id] || null;
  }

  getAll(filters = {}) {
    let list = Object.values(this.leads);
    if (filters.text) {
      const needle = String(filters.text).toLowerCase();
      list = list.filter((lead) =>
        [
          lead.company?.name,
          lead.company?.category,
          lead.company?.city,
          lead.company?.state,
          lead.company?.website,
          lead.company?.instagram,
          lead.aiAnalysis?.resumo,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle),
      );
    }
    if (filters.city) list = list.filter((l) => same(l.company?.city, filters.city));
    if (filters.category) list = list.filter((l) => same(l.company?.category, filters.category));
    if (filters.priority) list = list.filter((l) => same(l.score?.priority, filters.priority));
    if (Number.isFinite(Number(filters.minScore))) {
      list = list.filter((l) => Number(l.score?.value || 0) >= Number(filters.minScore));
    }
    if (filters.technology) {
      list = list.filter((l) =>
        (l.siteAnalysis?.technologies || []).some((t) => same(t.name || t, filters.technology)),
      );
    }
    if (filters.hasPixel === true) list = list.filter((l) => hasAnyPixel(l));
    if (filters.hasAnalytics === true) list = list.filter((l) => !!l.siteAnalysis?.tracking?.googleAnalytics);
    if (filters.hasWhatsapp === true) list = list.filter((l) => !!l.siteAnalysis?.conversion?.hasWhatsappButton || !!l.company?.whatsapp);
    if (filters.hasForm === true) list = list.filter((l) => !!l.siteAnalysis?.conversion?.hasForm);
    if (filters.hasDomain === true) list = list.filter((l) => !!l.siteAnalysis?.hasOwnDomain);
    if (filters.status) list = list.filter((l) => same(l.prospecting?.status, filters.status));
    if (filters.outcome) list = list.filter((l) => same(l.prospecting?.status, filters.outcome));
    if (filters.hasWebsite === "with") list = list.filter(hasWebsite);
    if (filters.hasWebsite === "without") list = list.filter((l) => !hasWebsite(l));
    if (filters.hasWebsite === "instagram_only") {
      list = list.filter((l) => hasInstagram(l) && !hasWebsite(l));
    }
    if (filters.hasWebsite === "with_instagram") list = list.filter(hasInstagram);
    if (filters.hasInstagram === true || filters.hasInstagram === "true") list = list.filter(hasInstagram);
    if (filters.hasInstagram === false || filters.hasInstagram === "false") {
      list = list.filter((l) => !hasInstagram(l));
    }
    if (filters.groupId) {
      const group = this.groups[filters.groupId];
      const ids = new Set((group?.leadIds || []).map(String));
      list = list.filter((l) => ids.has(String(l.id)) || (Array.isArray(l.groupIds) && l.groupIds.map(String).includes(String(filters.groupId))));
    }
    if (filters.searchId) {
      list = list.filter((l) => same(l.searchId, filters.searchId));
    }
    if (filters.pixelMissing === true || filters.pixelMissing === "true") {
      list = list.filter((l) => !hasAnyPixel(l));
    }
    if (filters.pixelMissing === false || filters.pixelMissing === "false") {
      list = list.filter((l) => hasAnyPixel(l));
    }
    if (filters.speedSlow === true || filters.speedSlow === "true") {
      list = list.filter((l) => Number(l.siteAnalysis?.performance?.loadTimeMs || 0) > 3500);
    }
    if (filters.speedSlow === false || filters.speedSlow === "false") {
      list = list.filter((l) => {
        const ms = Number(l.siteAnalysis?.performance?.loadTimeMs || 0);
        return ms > 0 && ms <= 3500;
      });
    }
    return list.sort((a, b) => Number(b.score?.value || 0) - Number(a.score?.value || 0));
  }

  updateOutcome(id, outcome) {
    const lead = this.get(id);
    if (!lead) throw new Error("Lead scoring not found");
    lead.prospecting = {
      ...(lead.prospecting || {}),
      ...(outcome || {}),
      updatedAt: Date.now(),
    };
    lead.updatedAt = Date.now();
    this.save();
    return lead;
  }

  clearAnalyses({ ids, all } = {}) {
    let removed = 0;
    if (all) {
      removed = Object.keys(this.leads).length;
      this.leads = {};
      // limpa referências nos grupos
      for (const group of Object.values(this.groups)) {
        group.leadIds = [];
        group.updatedAt = Date.now();
      }
      this.save();
      this.saveGroups();
      return { removed, remaining: 0 };
    }
    const target = new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean));
    if (!target.size) return { removed: 0, remaining: Object.keys(this.leads).length };
    for (const id of target) {
      if (this.leads[id]) {
        delete this.leads[id];
        removed++;
      }
    }
    for (const group of Object.values(this.groups)) {
      const before = group.leadIds?.length || 0;
      group.leadIds = (group.leadIds || []).filter((id) => !target.has(String(id)));
      if (group.leadIds.length !== before) group.updatedAt = Date.now();
    }
    this.save();
    this.saveGroups();
    return { removed, remaining: Object.keys(this.leads).length };
  }

  listGroups() {
    return Object.values(this.groups)
      .map((g) => ({
        ...g,
        count: Array.isArray(g.leadIds) ? g.leadIds.length : 0,
      }))
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  }

  getGroup(id) {
    return this.groups[id] || null;
  }

  createGroup({ name, description, color, leadIds, segment } = {}) {
    const cleanName = String(name || "").trim();
    if (!cleanName) throw new Error("Informe um nome para o grupo");
    const id = `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const ids = uniqueIds(leadIds);
    const group = {
      id,
      name: cleanName.slice(0, 80),
      description: String(description || "").slice(0, 240),
      color: String(color || pickGroupColor()).slice(0, 20),
      leadIds: ids,
      segment: segment && typeof segment === "object" ? segment : null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.groups[id] = group;
    this._syncLeadGroupIds(id, ids, []);
    this.saveGroups();
    this.save();
    return { ...group, count: ids.length };
  }

  updateGroup(id, patch = {}) {
    const group = this.groups[id];
    if (!group) throw new Error("Grupo não encontrado");
    if (patch.name != null) group.name = String(patch.name).trim().slice(0, 80) || group.name;
    if (patch.description != null) group.description = String(patch.description).slice(0, 240);
    if (patch.color != null) group.color = String(patch.color).slice(0, 20);
    if (patch.segment != null) group.segment = patch.segment;
    if (Array.isArray(patch.leadIds)) {
      const next = uniqueIds(patch.leadIds);
      const prev = [...(group.leadIds || [])];
      group.leadIds = next;
      this._syncLeadGroupIds(id, next, prev);
    }
    group.updatedAt = Date.now();
    this.groups[id] = group;
    this.saveGroups();
    this.save();
    return { ...group, count: group.leadIds.length };
  }

  deleteGroup(id, { removeLeads } = {}) {
    const group = this.groups[id];
    if (!group) throw new Error("Grupo não encontrado");
    const ids = [...(group.leadIds || [])];
    if (removeLeads) {
      for (const leadId of ids) delete this.leads[leadId];
      this.save();
    } else {
      this._syncLeadGroupIds(id, [], ids);
      this.save();
    }
    delete this.groups[id];
    this.saveGroups();
    return { success: true, deletedId: id, removedLeads: removeLeads ? ids.length : 0 };
  }

  addLeadsToGroup(groupId, leadIds = []) {
    const group = this.groups[groupId];
    if (!group) throw new Error("Grupo não encontrado");
    const prev = [...(group.leadIds || [])];
    const next = uniqueIds([...(group.leadIds || []), ...leadIds]);
    group.leadIds = next;
    group.updatedAt = Date.now();
    this._syncLeadGroupIds(groupId, next, prev);
    this.saveGroups();
    this.save();
    return { ...group, count: next.length };
  }

  removeLeadsFromGroup(groupId, leadIds = []) {
    const group = this.groups[groupId];
    if (!group) throw new Error("Grupo não encontrado");
    const drop = new Set(uniqueIds(leadIds));
    const prev = [...(group.leadIds || [])];
    const next = prev.filter((id) => !drop.has(String(id)));
    group.leadIds = next;
    group.updatedAt = Date.now();
    this._syncLeadGroupIds(groupId, next, prev);
    this.saveGroups();
    this.save();
    return { ...group, count: next.length };
  }

  createGroupFromFilters(name, filters = {}, options = {}) {
    const leads = this.getAll(filters || {});
    const leadIds = leads.map((l) => l.id);
    return this.createGroup({
      name,
      description: options.description || `Criado a partir de filtros (${leadIds.length} leads)`,
      color: options.color,
      leadIds,
      segment: { ...(filters || {}), savedAt: Date.now() },
    });
  }

  _syncLeadGroupIds(groupId, nextIds, prevIds) {
    const next = new Set((nextIds || []).map(String));
    const prev = new Set((prevIds || []).map(String));
    for (const id of next) {
      const lead = this.leads[id];
      if (!lead) continue;
      const set = new Set([...(lead.groupIds || []).map(String), String(groupId)]);
      lead.groupIds = [...set];
      lead.updatedAt = Date.now();
    }
    for (const id of prev) {
      if (next.has(id)) continue;
      const lead = this.leads[id];
      if (!lead) continue;
      lead.groupIds = (lead.groupIds || []).map(String).filter((g) => g !== String(groupId));
      lead.updatedAt = Date.now();
    }
  }

  getStats() {
    const list = Object.values(this.leads);
    const count = (fn) => list.filter(fn).length;
    const closedValue = list.reduce((sum, lead) => sum + Number(lead.prospecting?.closedValue || 0), 0);
    return {
      total: list.length,
      highPriority: count((l) => l.score?.priority === "alta"),
      goodOpportunity: count((l) => l.score?.priority === "boa"),
      lowPriority: count((l) => l.score?.priority === "baixa"),
      ignored: count((l) => l.score?.priority === "ignorar"),
      withSite: count(hasWebsite),
      noSite: count((l) => !hasWebsite(l)),
      withInstagram: count(hasInstagram),
      instagramOnly: count((l) => hasInstagram(l) && !hasWebsite(l)),
      withWhatsapp: count((l) => l.company?.whatsapp || l.siteAnalysis?.conversion?.hasWhatsappButton),
      withPixel: count(hasAnyPixel),
      contacted: count((l) => l.prospecting?.status && l.prospecting.status !== "not_contacted"),
      responded: count((l) => l.prospecting?.responded),
      meetings: count((l) => l.prospecting?.meetingBooked),
      proposals: count((l) => l.prospecting?.proposalSent),
      closed: count((l) => l.prospecting?.closed),
      closedValue,
      groups: Object.keys(this.groups).length,
    };
  }
}

function uniqueIds(ids) {
  return [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean))];
}

const GROUP_COLORS = ["#6c5ce7", "#00b894", "#0984e3", "#fdcb6e", "#e17055", "#a29bfe", "#74b9ff", "#55efc4"];
function pickGroupColor() {
  return GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)];
}

function defaultSettings() {
  return {
    analysis: {
      maxPages: 3,
      timeoutMs: 12000,
      saveScreenshots: false,
      screenshotRetentionDays: 60,
      blockHeavyAssets: true,
      autoAnalyzeAfterScrape: false,
      language: "pt-BR",
      offerType: "site_landing_sistema",
    },
    ai: {
      enabled: false,
      provider: "openrouter",
      apiKey: "",
      model: "openrouter/free",
      baseUrl: "",
      siteUrl: "https://sigma-gmaps.local",
      appName: "Sigma GMaps Scraper",
      extraHeaders: "",
      // Fallback gratuito (OpenCode Zen) se o principal falhar
      fallbackProviders: JSON.stringify([
        {
          provider: "opencode",
          enabled: true,
          apiKey: "",
          model: "deepseek-v4-flash-free",
          baseUrl: "https://opencode.ai/zen/v1",
        },
      ], null, 2),
      batchSize: 8,
      useScreenshots: false,
      dailyLimit: 100,
      mode: "economico",
    },
    commercial: {
      sellerName: "",
      agencyName: "",
      tone: "consultivo",
      services: ["Sites", "Landing Pages", "Sistemas"],
      proof: "",
    },
    rules: defaultRules(),
  };
}

// Preset recomendado de regras de scoring. O usuário pode ajustar livremente,
// mas o sistema já vem pronto para rodar com bom ajuste sem configuração prévia.
function defaultRules() {
  return {
    thresholds: {
      ignoreBelow: 40,
      goodFrom: 60,
      highFrom: 75,
    },
    commercialFit: {
      reviewsHigh: 200,
      reviewsMid: 50,
      reviewsLow: 10,
      reviewsHighPoints: 7,
      reviewsMidPoints: 5,
      reviewsLowPoints: 3,
      ratingHigh: 4.5,
      ratingMid: 4,
      ratingHighPoints: 5,
      ratingMidPoints: 3,
      priorityCategoryPoints: 8,
      otherCategoryPoints: 4,
      maxPoints: 20,
    },
    digitalPain: {
      // Alta prioridade = TEM site com falhas (pixel, HTTPS, mobile, WhatsApp…)
      noWebsitePoints: 16,
      missingHttpsPoints: 9,
      missingOwnDomainPoints: 4,
      slowLoadMs: 3500,
      slowLoadPoints: 7,
      shortTitlePoints: 3,
      missingDescriptionPoints: 3,
      missingH1Points: 3,
      notResponsivePoints: 9,
      missingWhatsappPoints: 8,
      missingFormPoints: 5,
      missingTrackingPoints: 4,
      missingPixelPoints: 9,
      httpErrorsPoints: 5,
      multiPainBoostFrom: 3,
      multiPainBoostPoints: 10,
      maxPoints: 45,
    },
    contactability: {
      hasPhonePoints: 5,
      hasWhatsappPoints: 5,
      hasEmailPoints: 3,
      hasInstagramPoints: 2,
      maxPoints: 15,
    },
    conversionPotential: {
      noWebsiteHighBonus: 12,
      noWebsiteLowBonus: 8,
      hasWebsitePoints: 6,
      missingPixelPoints: 5,
      missingWhatsappPoints: 4,
      missingFormPoints: 3,
      ctaLowPoints: 4,
      ctaMediaPoints: 2,
      strongReviewsPoints: 3,
      maxPoints: 25,
    },
  };
}

function mergeSettings(base, patch) {
  const rules = mergeRules(defaultRules(), patch.rules);
  const out = {
    ...base,
    ...patch,
    analysis: { ...base.analysis, ...(patch.analysis || {}) },
    ai: { ...base.ai, ...(patch.ai || {}) },
    commercial: { ...base.commercial, ...(patch.commercial || {}) },
    rules,
  };
  if (String(out.ai?.provider || "").toLowerCase() === "opencode") {
    out.ai = {
      ...out.ai,
      provider: "custom",
      baseUrl: "",
      model: out.ai.model || "gpt-4.1-mini",
    };
  }
  return out;
}

function mergeRules(base, patch) {
  if (!patch || typeof patch !== "object") return base;
  const out = {};
  for (const key of Object.keys(base)) {
    out[key] = { ...base[key], ...(patch[key] || {}) };
  }
  return out;
}

function createLeadId(lead) {
  const base = [
    lead?.name,
    lead?.company?.name,
    lead?.address,
    lead?.company?.address,
    lead?.website,
    lead?.company?.website,
    lead?.phone,
    lead?.company?.phone,
  ]
    .filter(Boolean)
    .join("|")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90);
  return `lead_${base || Date.now()}`;
}

function same(a, b) {
  return String(a || "").toLowerCase() === String(b || "").toLowerCase();
}

function hasAnyPixel(lead) {
  const tracking = lead.siteAnalysis?.tracking || {};
  return !!(
    tracking.metaPixel ||
    tracking.googleAdsConversion ||
    tracking.tiktokPixel ||
    tracking.linkedinInsight
  );
}

module.exports = { ProspectingStore, createLeadId, defaultSettings };
