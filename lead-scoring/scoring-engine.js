const DEFAULT_RULES = {
  thresholds: {
    ignoreBelow: 40,
    goodFrom: 60,
    highFrom: 75,
  },
  digitalPain: {
    // Sem site ainda vale a pena, mas NÃO passa na frente de site com vários problemas.
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
  },
};

function resolveRules(settings) {
  const rules = (settings && settings.rules) || {};
  const digitalPain = { ...DEFAULT_RULES.digitalPain, ...(rules.digitalPain || {}) };
  const thresholds = { ...DEFAULT_RULES.thresholds, ...(rules.thresholds || {}) };
  return { digitalPain, thresholds };
}

function hasMediaPixel(site = {}) {
  const tracking = site.tracking || {};
  return !!(tracking.metaPixel || tracking.googleAdsConversion || tracking.tiktokPixel || tracking.linkedinInsight);
}

function listSitePains(company, site = {}, digitalPainRules = DEFAULT_RULES.digitalPain) {
  if (!company.website) return [];
  if (site.digitalPresence && site.digitalPresence.reachable !== true) return [];
  const pains = [];
  if (!site.hasHttps) pains.push("https");
  if (site.mobile?.isResponsive === false) pains.push("mobile");
  if (!site.conversion?.hasWhatsappButton) pains.push("whatsapp");
  if (!hasMediaPixel(site)) pains.push("pixel");
  if ((site.performance?.loadTimeMs || 0) > (digitalPainRules.slowLoadMs || 3500)) pains.push("slow");
  if (!site.conversion?.hasForm) pains.push("form");
  if ((site.crawl?.httpErrors || []).length > 0) pains.push("errors");
  if (!site.tracking?.googleAnalytics && !site.tracking?.googleTagManager) pains.push("analytics");
  return pains;
}

function calculateScore(lead, siteAnalysis = {}, aiSignal = {}, settings = {}) {
  const company = lead.company || {};
  const rules = resolveRules(settings);
  const commercialFit = scoreCommercialFit(company);
  const digitalPain = scoreDigitalPain(company, siteAnalysis, rules.digitalPain);
  const contactability = scoreContactability(company, siteAnalysis);
  const conversionPotential = scoreConversionPotential(company, siteAnalysis);
  const ai = Number(aiSignal.scoreContribution || 0);
  let value = clamp(commercialFit + digitalPain + contactability + conversionPotential + ai, 0, 100);

  // Prioridade alta = tem site com várias falhas fáceis de vender (pixel, HTTPS, mobile, WhatsApp…).
  const pains = listSitePains(company, siteAnalysis, rules.digitalPain);
  const strongPains = pains.filter((p) => ["https", "mobile", "whatsapp", "pixel", "slow"].includes(p));
  if (company.website && strongPains.length >= 2 && commercialFit >= 8) {
    value = Math.max(value, rules.thresholds.highFrom);
  }
  // Sem site continua oportunidade, mas não “pula a fila” dos sites quebrados.
  if (!company.website && commercialFit >= 10) {
    value = Math.max(value, rules.thresholds.goodFrom);
    value = Math.min(value, rules.thresholds.highFrom - 1);
  }

  const priority = classify(value, rules.thresholds);
  return {
    value,
    priority,
    classification: label(priority),
    worthProspecting: value >= rules.thresholds.goodFrom,
    components: {
      commercialFit,
      digitalPain,
      contactability,
      conversionPotential,
      aiSignal: ai,
    },
    sitePains: pains,
    reasons: buildReasons(company, siteAnalysis, value, pains).slice(0, 6),
  };
}

function scoreCommercialFit(company) {
  let score = 0;
  const reviews = Number(company.reviewCount || company.totalReviews || 0);
  const rating = Number(company.rating || 0);
  const category = String(company.category || "").toLowerCase();
  if (reviews >= 200) score += 7;
  else if (reviews >= 50) score += 5;
  else if (reviews >= 10) score += 3;
  if (rating >= 4.5) score += 5;
  else if (rating >= 4) score += 3;
  if (/(cl[ií]nica|odont|est[eé]tica|advoc|imobili|arquitet|construt|academia|restaurante|hotel|pousada|escola|curso|oficina|auto|turismo|delivery|m[eé]dico)/i.test(category)) {
    score += 8;
  } else if (category) {
    score += 4;
  }
  return clamp(score, 0, 20);
}

function scoreDigitalPain(company, site, digitalPainRules) {
  const r = digitalPainRules;
  if (!company.website) return clamp(r.noWebsitePoints, 0, 40);
  if (site.digitalPresence && site.digitalPresence.reachable !== true) return 0;

  let score = 0;
  if (!site.hasHttps) score += r.missingHttpsPoints;
  if (!site.hasOwnDomain) score += r.missingOwnDomainPoints;
  if ((site.performance?.loadTimeMs || 0) > r.slowLoadMs) score += r.slowLoadPoints;
  if (!site.content?.title || site.content.title.length < 18) score += r.shortTitlePoints;
  if (!site.content?.description) score += r.missingDescriptionPoints;
  if (!site.content?.h1) score += r.missingH1Points;
  if (site.mobile?.isResponsive === false) score += r.notResponsivePoints;
  if (!site.conversion?.hasWhatsappButton) score += r.missingWhatsappPoints;
  if (!site.conversion?.hasForm) score += r.missingFormPoints;
  if (!hasMediaPixel(site)) score += r.missingPixelPoints;
  if (!site.tracking?.googleAnalytics && !site.tracking?.googleTagManager) score += r.missingTrackingPoints;
  if ((site.crawl?.httpErrors || []).length > 0) score += r.httpErrorsPoints;

  const painCount = listSitePains(company, site, r).length;
  if (painCount >= (r.multiPainBoostFrom || 3)) {
    score += r.multiPainBoostPoints || 10;
  }
  return clamp(score, 0, 45);
}

function scoreContactability(company, site) {
  let score = 0;
  if (company.phone) score += 5;
  if (company.whatsapp || site.conversion?.hasWhatsappButton) score += 5;
  if (company.email) score += 3;
  if (company.instagram) score += 2;
  return clamp(score, 0, 15);
}

/**
 * Potencial de conversão = chance de você VENDER melhoria (não se o site já converte bem).
 * Site com falhas de conversão sobe; site “redondo” desce.
 */
function scoreConversionPotential(company, site) {
  let score = 0;
  if (!company.website) {
    return Number(company.reviewCount || 0) >= 50 ? 12 : 8;
  }

  // Tem site = dá para oferecer reforma/landing/sistema.
  score += 6;

  if (!hasMediaPixel(site)) score += 5;
  if (!site.conversion?.hasWhatsappButton) score += 4;
  if (!site.conversion?.hasForm) score += 3;
  if (site.conversion?.ctaStrength === "baixa") score += 4;
  else if (site.conversion?.ctaStrength === "media") score += 2;
  if (!site.hasHttps) score += 2;
  if (site.mobile?.isResponsive === false) score += 2;

  // Bom volume no Google = lead que já atrai visita e pode converter melhor.
  if (Number(company.reviewCount || 0) >= 50 && Number(company.rating || 0) >= 4) score += 3;

  // Site já “saudável” tem menos potencial de venda imediata.
  if (hasMediaPixel(site) && site.conversion?.hasWhatsappButton && site.hasHttps && site.mobile?.isResponsive !== false) {
    score = Math.max(0, score - 8);
  }

  return clamp(score, 0, 25);
}

function buildReasons(company, site, score, pains = []) {
  const reasons = [];
  if (!company.website) {
    reasons.push("Empresa sem site: boa chance de oferecer um site ou página simples (mas sites com falhas vêm antes na fila).");
  }
  if (company.website && pains.length >= 2) {
    reasons.push("Tem site com várias falhas — prioridade alta para oferecer correção ou redesign.");
  }
  if (company.reviewCount >= 50) reasons.push("Tem bastante avaliação no Google — já tem credibilidade para vender.");
  if (!site.conversion?.hasWhatsappButton && company.website) reasons.push("No site não aparece WhatsApp de forma clara para o cliente chamar.");
  if (!site.conversion?.hasForm && company.website) reasons.push("Não tem formulário visível para pedir orçamento.");
  if (!hasMediaPixel(site) && company.website) reasons.push("Sem pixel de anúncio — difícil medir campanhas; ótimo argumento de venda.");
  if (!site.tracking?.googleAnalytics && !site.tracking?.googleTagManager && company.website) {
    reasons.push("Parece que o site não mede visitas nem resultados.");
  }
  if (site.mobile?.isResponsive === false && company.website) reasons.push("O site pode não funcionar bem no celular.");
  if ((site.performance?.loadTimeMs || 0) > 3500 && company.website) {
    reasons.push("O site carrega devagar — muita gente desiste antes de ver o conteúdo.");
  }
  if (!site.hasHttps && company.website) reasons.push("O site não está seguro (sem cadeado HTTPS) — isso gera desconfiança.");
  if (score >= 75 && company.website) {
    reasons.push("Prioridade alta: site com problemas claros e potencial comercial juntos.");
  }
  if (score < 40) reasons.push("Por enquanto vale menos a pena investir tempo neste lead.");
  return reasons;
}

function classify(score, thresholds) {
  const t = thresholds || DEFAULT_RULES.thresholds;
  const highFrom = Number.isFinite(Number(t.highFrom)) ? Number(t.highFrom) : 75;
  const goodFrom = Number.isFinite(Number(t.goodFrom)) ? Number(t.goodFrom) : 60;
  const ignoreBelow = Number.isFinite(Number(t.ignoreBelow)) ? Number(t.ignoreBelow) : 40;
  if (score < ignoreBelow) return "ignorar";
  if (score < goodFrom) return "baixa";
  if (score < highFrom) return "boa";
  return "alta";
}

function label(priority) {
  return {
    ignorar: "Pular por agora",
    baixa: "Depois",
    boa: "Vale a pena",
    alta: "Ligar primeiro",
  }[priority] || "Depois";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(Number(value || 0))));
}

module.exports = { calculateScore, classify, DEFAULT_RULES, listSitePains, hasMediaPixel };
