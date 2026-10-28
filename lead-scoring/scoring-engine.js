// Preset recomendado. Todo peso aqui pode ser ajustado em
// Configurar análise → Regras do score; o motor lê exatamente estes números.
const { isRealWebsite } = require("../utils/lead-links");

const DEFAULT_RULES = {
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
    missingHttpsPoints: 2,
    notResponsivePoints: 2,
    strongReviewsPoints: 3,
    healthySitePenalty: 8,
    maxPoints: 25,
  },
};

const PRIORITY_CATEGORY = /(cl[ií]nica|odont|est[eé]tica|advoc|imobili|arquitet|construt|academia|restaurante|hotel|pousada|escola|curso|oficina|auto|turismo|delivery|m[eé]dico)/i;

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Mescla o preset com o que o usuário salvou, grupo por grupo. */
function resolveRules(settings) {
  const saved = (settings && settings.rules) || {};
  const merge = (group) => {
    const base = DEFAULT_RULES[group];
    const patch = saved[group] && typeof saved[group] === 'object' ? saved[group] : {};
    const merged = { ...base };
    for (const key of Object.keys(base)) {
      if (patch[key] != null && Number.isFinite(Number(patch[key]))) merged[key] = Number(patch[key]);
    }
    return merged;
  };
  return {
    thresholds: merge('thresholds'),
    commercialFit: merge('commercialFit'),
    digitalPain: merge('digitalPain'),
    contactability: merge('contactability'),
    conversionPotential: merge('conversionPotential'),
  };
}

function hasMediaPixel(site = {}) {
  const tracking = site.tracking || {};
  return !!(tracking.metaPixel || tracking.googleAdsConversion || tracking.tiktokPixel || tracking.linkedinInsight);
}

function listSitePains(company, site = {}, digitalPainRules = DEFAULT_RULES.digitalPain) {
  if (!isRealWebsite(company.website)) return [];
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
  const hasWebsite = isRealWebsite(company.website);
  const rules = resolveRules(settings);
  const commercialFit = scoreCommercialFit(company, rules.commercialFit);
  const digitalPain = scoreDigitalPain(company, siteAnalysis, rules.digitalPain);
  const contactability = scoreContactability(company, siteAnalysis, rules.contactability);
  const conversionPotential = scoreConversionPotential(company, siteAnalysis, rules.conversionPotential);
  const ai = Number(aiSignal.scoreContribution || 0);
  let value = clamp(commercialFit + digitalPain + contactability + conversionPotential + ai, 0, 100);

  // Prioridade alta = tem site com várias falhas fáceis de vender (pixel, HTTPS, mobile, WhatsApp…).
  const pains = listSitePains(company, siteAnalysis, rules.digitalPain);
  const strongPains = pains.filter((pain) => ["https", "mobile", "whatsapp", "pixel", "slow"].includes(pain));
  if (hasWebsite && strongPains.length >= 2 && commercialFit >= 8) {
    value = Math.max(value, rules.thresholds.highFrom);
  }
  // Sem site continua oportunidade, mas não “pula a fila” dos sites quebrados.
  if (!hasWebsite && commercialFit >= 10) {
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

function scoreCommercialFit(company, rules = DEFAULT_RULES.commercialFit) {
  let score = 0;
  const reviews = Number(company.reviewCount || company.totalReviews || 0);
  const rating = Number(company.rating || 0);
  const category = String(company.category || "").toLowerCase();
  if (reviews >= rules.reviewsHigh) score += rules.reviewsHighPoints;
  else if (reviews >= rules.reviewsMid) score += rules.reviewsMidPoints;
  else if (reviews >= rules.reviewsLow) score += rules.reviewsLowPoints;
  if (rating >= rules.ratingHigh) score += rules.ratingHighPoints;
  else if (rating >= rules.ratingMid) score += rules.ratingMidPoints;
  if (PRIORITY_CATEGORY.test(category)) score += rules.priorityCategoryPoints;
  else if (category) score += rules.otherCategoryPoints;
  return clamp(score, 0, rules.maxPoints);
}

function scoreDigitalPain(company, site, rules) {
  if (!isRealWebsite(company.website)) return clamp(rules.noWebsitePoints, 0, rules.maxPoints);
  if (site.digitalPresence && site.digitalPresence.reachable !== true) return 0;

  let score = 0;
  if (!site.hasHttps) score += rules.missingHttpsPoints;
  if (!site.hasOwnDomain) score += rules.missingOwnDomainPoints;
  if ((site.performance?.loadTimeMs || 0) > rules.slowLoadMs) score += rules.slowLoadPoints;
  if (!site.content?.title || site.content.title.length < 18) score += rules.shortTitlePoints;
  if (!site.content?.description) score += rules.missingDescriptionPoints;
  if (!site.content?.h1) score += rules.missingH1Points;
  if (site.mobile?.isResponsive === false) score += rules.notResponsivePoints;
  if (!site.conversion?.hasWhatsappButton) score += rules.missingWhatsappPoints;
  if (!site.conversion?.hasForm) score += rules.missingFormPoints;
  if (!hasMediaPixel(site)) score += rules.missingPixelPoints;
  if (!site.tracking?.googleAnalytics && !site.tracking?.googleTagManager) score += rules.missingTrackingPoints;
  if ((site.crawl?.httpErrors || []).length > 0) score += rules.httpErrorsPoints;

  const painCount = listSitePains(company, site, rules).length;
  if (painCount >= rules.multiPainBoostFrom) {
    score += rules.multiPainBoostPoints;
  }
  return clamp(score, 0, rules.maxPoints);
}

function scoreContactability(company, site, rules = DEFAULT_RULES.contactability) {
  let score = 0;
  if (company.phone) score += rules.hasPhonePoints;
  if (company.whatsapp || site.conversion?.hasWhatsappButton) score += rules.hasWhatsappPoints;
  if (company.email) score += rules.hasEmailPoints;
  if (company.instagram) score += rules.hasInstagramPoints;
  return clamp(score, 0, rules.maxPoints);
}

/**
 * Potencial de conversão = chance de você VENDER melhoria (não se o site já converte bem).
 * Site com falhas de conversão sobe; site “redondo” desce.
 */
function scoreConversionPotential(company, site, rules = DEFAULT_RULES.conversionPotential) {
  let score = 0;
  if (!isRealWebsite(company.website)) {
    return Number(company.reviewCount || 0) >= 50 ? rules.noWebsiteHighBonus : rules.noWebsiteLowBonus;
  }
  if (site.digitalPresence && site.digitalPresence.reachable !== true) return 0;

  // Tem site = dá para oferecer reforma/landing/sistema.
  score += rules.hasWebsitePoints;

  if (!hasMediaPixel(site)) score += rules.missingPixelPoints;
  if (!site.conversion?.hasWhatsappButton) score += rules.missingWhatsappPoints;
  if (!site.conversion?.hasForm) score += rules.missingFormPoints;
  if (site.conversion?.ctaStrength === "baixa") score += rules.ctaLowPoints;
  else if (site.conversion?.ctaStrength === "media") score += rules.ctaMediaPoints;
  if (!site.hasHttps) score += rules.missingHttpsPoints;
  if (site.mobile?.isResponsive === false) score += rules.notResponsivePoints;

  // Bom volume no Google = lead que já atrai visita e pode converter melhor.
  if (Number(company.reviewCount || 0) >= 50 && Number(company.rating || 0) >= 4) score += rules.strongReviewsPoints;

  // Site já “saudável” tem menos potencial de venda imediata.
  if (hasMediaPixel(site) && site.conversion?.hasWhatsappButton && site.hasHttps && site.mobile?.isResponsive !== false) {
    score = Math.max(0, score - rules.healthySitePenalty);
  }

  return clamp(score, 0, rules.maxPoints);
}

function buildReasons(company, site, score, pains = []) {
  const reasons = [];
  const hasWebsite = isRealWebsite(company.website);
  const siteReachable = !hasWebsite || !site.digitalPresence || site.digitalPresence.reachable === true;
  if (!hasWebsite) {
    reasons.push("Empresa sem site: boa chance de oferecer um site ou página simples (mas sites com falhas vêm antes na fila).");
  }
  if (hasWebsite && !siteReachable) {
    reasons.push("O site não respondeu à análise; a prioridade considera apenas os dados comerciais e de contato confirmados.");
  }
  if (hasWebsite && siteReachable && pains.length >= 2) {
    reasons.push("Tem site com várias falhas — prioridade alta para oferecer correção ou redesign.");
  }
  if (company.reviewCount >= 50) reasons.push("Tem bastante avaliação no Google — já tem credibilidade para vender.");
  if (!site.conversion?.hasWhatsappButton && hasWebsite && siteReachable) reasons.push("No site não aparece WhatsApp de forma clara para o cliente chamar.");
  if (!site.conversion?.hasForm && hasWebsite && siteReachable) reasons.push("Não tem formulário visível para pedir orçamento.");
  if (!hasMediaPixel(site) && hasWebsite && siteReachable) reasons.push("Sem pixel de anúncio — difícil medir campanhas; ótimo argumento de venda.");
  if (!site.tracking?.googleAnalytics && !site.tracking?.googleTagManager && hasWebsite && siteReachable) {
    reasons.push("Parece que o site não mede visitas nem resultados.");
  }
  if (site.mobile?.isResponsive === false && hasWebsite && siteReachable) reasons.push("O site pode não funcionar bem no celular.");
  if ((site.performance?.loadTimeMs || 0) > 3500 && hasWebsite && siteReachable) {
    reasons.push("O site carrega devagar — muita gente desiste antes de ver o conteúdo.");
  }
  if (!site.hasHttps && hasWebsite && siteReachable) reasons.push("O site não está seguro (sem cadeado HTTPS) — isso gera desconfiança.");
  if (score >= 75 && hasWebsite && siteReachable) {
    reasons.push("Prioridade alta: site com problemas claros e potencial comercial juntos.");
  }
  if (score < 40) reasons.push("Por enquanto vale menos a pena investir tempo neste lead.");
  return reasons;
}

function classify(score, thresholds) {
  const t = thresholds || DEFAULT_RULES.thresholds;
  const highFrom = number(t.highFrom, DEFAULT_RULES.thresholds.highFrom);
  const goodFrom = number(t.goodFrom, DEFAULT_RULES.thresholds.goodFrom);
  const ignoreBelow = number(t.ignoreBelow, DEFAULT_RULES.thresholds.ignoreBelow);
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

module.exports = {
  calculateScore,
  classify,
  DEFAULT_RULES,
  resolveRules,
  listSitePains,
  hasMediaPixel,
  buildReasons,
  scoreCommercialFit,
  scoreContactability,
  scoreConversionPotential,
  scoreDigitalPain,
};
