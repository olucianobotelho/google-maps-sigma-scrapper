const TRUST_WORDS = [
  "avaliacao",
  "depoimento",
  "cliente",
  "case",
  "portfolio",
  "certificado",
  "garantia",
  "anos",
  "especialista",
  "seguro",
  "qualidade",
  "resultado",
];

const OBJECTION_WORDS = [
  "preco",
  "valor",
  "orcamento",
  "garantia",
  "prazo",
  "entrega",
  "parcel",
  "pagamento",
  "duvida",
  "faq",
  "como funciona",
  "processo",
  "atendimento",
];

const CTA_WORDS = [
  "whatsapp",
  "orcamento",
  "agendar",
  "contato",
  "comprar",
  "reserve",
  "ligar",
  "solicitar",
  "fale",
  "diagnostico",
];

function buildSiteSummary(lead, siteAnalysis) {
  const pages = siteAnalysis?.crawl?.pages || [];
  const main = pages[0] || {};
  const visibleText = limitText(
    pages.map((page) => page.visibleText || "").filter(Boolean).join("\n"),
    9000,
  );
  const headings = unique(pages.flatMap((page) => page.headings || [])).slice(0, 24);
  const buttons = unique(pages.flatMap((page) => page.buttons || [])).slice(0, 24);
  const links = unique(pages.flatMap((page) => page.ctaLinks || [])).slice(0, 24);
  const hero = {
    title: main.h1 || main.title || "",
    subtitle: firstUseful(main.paragraphs),
    ctas: unique([...(main.buttons || []), ...(main.ctaLinks || [])]).slice(0, 8),
    text: limitText(main.aboveTheFoldText || main.visibleText || "", 1800),
  };
  const trustSignals = findSignals(visibleText, TRUST_WORDS);
  const objectionSignals = findSignals(visibleText, OBJECTION_WORDS);
  const ctaSignals = findSignals(`${buttons.join(" ")} ${links.join(" ")} ${visibleText}`, CTA_WORDS);
  const localCopy = scoreCopy({ hero, headings, buttons, trustSignals, objectionSignals, ctaSignals, visibleText, siteAnalysis });

  return {
    company: {
      name: lead.company?.name || lead.name || "",
      category: lead.company?.category || lead.category || "",
      city: lead.company?.city || lead.city || "",
      rating: lead.company?.rating || lead.rating || 0,
      reviewCount: lead.company?.reviewCount || lead.reviewCount || 0,
    },
    url: siteAnalysis.finalUrl || lead.company?.website || lead.website || "",
    technical: {
      https: !!siteAnalysis.hasHttps,
      ownDomain: !!siteAnalysis.hasOwnDomain,
      loadTimeMs: siteAnalysis.performance?.loadTimeMs || 0,
      responsive: !!siteAnalysis.mobile?.isResponsive,
      tracking: siteAnalysis.tracking || {},
      cms: siteAnalysis.cms || "",
    },
    content: {
      title: siteAnalysis.content?.title || "",
      description: siteAnalysis.content?.description || "",
      hero,
      headings,
      buttons,
      ctaLinks: links,
      visibleText,
    },
    conversion: {
      hasWhatsappButton: !!siteAnalysis.conversion?.hasWhatsappButton,
      hasClickablePhone: !!siteAnalysis.conversion?.hasClickablePhone,
      hasForm: !!siteAnalysis.conversion?.hasForm,
      ctaStrength: siteAnalysis.conversion?.ctaStrength || "baixa",
      localCopyScore: localCopy,
      trustSignals,
      objectionSignals,
      ctaSignals,
      likelyLeaks: buildLeaks({ localCopy, siteAnalysis, trustSignals, objectionSignals, ctaSignals }),
    },
  };
}

function scoreCopy(input) {
  const heroText = `${input.hero.title} ${input.hero.subtitle} ${input.hero.text}`.trim();
  const hasSpecificOffer = /\b(site|landing|sistema|cardapio|delivery|consulta|orcamento|tratamento|servico|produto|restaurante|clinica|curso)\b/i.test(heroText);
  const hasBenefit = /\b(mais|melhor|rapido|facil|econom|segur|resultado|aument|reduz|especialista|qualidade)\b/i.test(heroText);
  const heroClarity = clamp((input.hero.title ? 25 : 0) + (input.hero.subtitle ? 15 : 0) + (hasSpecificOffer ? 20 : 0) + (hasBenefit ? 15 : 0), 0, 100);
  const ctaScore = clamp((input.buttons.length ? 35 : 0) + (input.ctaSignals.length * 12) + (input.siteAnalysis.conversion?.hasWhatsappButton ? 20 : 0), 0, 100);
  const trustScore = clamp((input.trustSignals.length * 18) + (input.siteAnalysis.content?.hasSchema ? 10 : 0), 0, 100);
  const objectionScore = clamp(input.objectionSignals.length * 18, 0, 100);
  const overall = Math.round((heroClarity * 0.32) + (ctaScore * 0.28) + (trustScore * 0.22) + (objectionScore * 0.18));
  return {
    heroClarity,
    ctaScore,
    trustScore,
    objectionScore,
    overall,
  };
}

function buildLeaks({ localCopy, siteAnalysis, trustSignals, objectionSignals, ctaSignals }) {
  const leaks = [];
  if (localCopy.heroClarity < 55) leaks.push("Hero/proposta de valor pouco clara nos primeiros segundos.");
  if (localCopy.ctaScore < 55) leaks.push("CTA fraco ou pouco evidente para contato/orcamento.");
  if (!siteAnalysis.conversion?.hasWhatsappButton && !siteAnalysis.conversion?.hasForm) leaks.push("Sem caminho forte de conversao no site.");
  if (trustSignals.length < 2) leaks.push("Pouca prova de confianca visivel.");
  if (objectionSignals.length < 2) leaks.push("Pouca quebra de objecoes como preco, prazo, garantia ou processo.");
  if (ctaSignals.length < 2) leaks.push("Linguagem de acao fraca.");
  return leaks.slice(0, 6);
}

function findSignals(text, words) {
  const lower = normalize(text);
  return words.filter((word) => lower.includes(normalize(word))).slice(0, 12);
}

function firstUseful(items) {
  return (items || []).find((item) => String(item || "").trim().length >= 30) || "";
}

function unique(items) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const clean = String(item || "").replace(/\s+/g, " ").trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

function limitText(value, max) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(Number(value || 0))));
}

module.exports = { buildSiteSummary };
