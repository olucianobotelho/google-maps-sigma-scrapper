const path = require("path");
const CONFIG = require("../config");
const { detectTechnologies } = require("./tech-detector");
const { buildSiteSummary } = require("./site-summary-builder");
const { classifyUrl } = require("./url-classifier");

/**
 * Análise de site SEM browser (sem janela branca).
 * Usa HTTP fetch + parse de HTML — ideal dentro do Electron.
 */
async function analyzeWebsite(lead, settings, userDataPath, onProgress = () => {}, cancelToken = null) {
  const website = lead.company?.website || lead.website;
  if (!website) return emptySiteAnalysis("Lead sem site");
  const url = normalizeUrl(website);
  if (!url) return emptySiteAnalysis("URL invalida");
  const digitalPresence = classifyUrl(url);
  if (['none', 'invalid', 'suspicious', 'social', 'link_aggregator', 'marketplace'].includes(digitalPresence.kind)) {
    return { ...emptySiteAnalysis(digitalPresence.reasons?.[0] || 'Presença não analisável'), digitalPresence: { ...digitalPresence, reachable: null }, finalUrl: url, analyzedAt: Date.now(), method: 'classifier' };
  }

  const timeoutMs = Number(settings?.analysis?.timeoutMs || 12000);
  const maxPages = Math.max(1, Math.min(5, Number(settings?.analysis?.maxPages || 3)));
  const start = Date.now();
  const pages = [];

  try {
    checkCancelled(cancelToken);
    if (typeof onProgress === "function") onProgress(`Analisando site: ${url}`);

    const main = await fetchHtmlPage(url, timeoutMs);
    pages.push(main);
    checkCancelled(cancelToken);

    const finalUrl = main.finalUrl || url;
    const domain = safeHostname(finalUrl);
    const internal = pickInternalUrls(main.links, finalUrl, maxPages);

    for (const nextUrl of internal.slice(0, Math.max(0, maxPages - 1))) {
      checkCancelled(cancelToken);
      try {
        const page = await fetchHtmlPage(nextUrl, Math.min(timeoutMs, 10000));
        pages.push(page);
      } catch (e) {
        pages.push({
          url: nextUrl,
          finalUrl: nextUrl,
          status: 0,
          error: e.message,
          html: "",
          links: [],
          scripts: [],
          styles: [],
        });
      }
    }

    const mergedHtml = pages.map((p) => p.html || "").join("\n");
    const headers = main.headers || {};
    const scripts = pages.flatMap((p) => p.scripts || []);
    const styles = pages.flatMap((p) => p.styles || []);
    const links = pages.flatMap((p) => p.links || []);
    const tech = detectTechnologies({ html: mergedHtml, headers, scripts, styles, links });
    const probes = await probeCommonFiles(finalUrl, timeoutMs);
    const httpErrors = pages.filter((p) => Number(p.status || 0) >= 400 || Number(p.status || 0) === 0);
    const hasViewport = /name=["']viewport["']/i.test(mergedHtml) || /viewport/i.test(mergedHtml);

    const analysis = {
      finalUrl,
      domain,
      hasHttps: String(finalUrl).startsWith("https://"),
      hasOwnDomain: hasOwnDomain(finalUrl),
      digitalPresence: { ...digitalPresence, finalUrl, reachable: true, ownDomain: digitalPresence.kind === 'own_domain' },
      cms: detectCms(tech.technologies),
      technologies: tech.technologies,
      frameworks: tech.frameworks,
      tracking: tech.tracking,
      infrastructure: tech.infrastructure,
      performance: {
        loadTimeMs: Date.now() - start,
        pageSizeBytes: main.htmlSize || (main.html || "").length,
      },
      content: {
        title: main.title || "",
        description: main.description || "",
        h1: main.h1 || "",
        h2Count: main.h2Count || 0,
        hasOpenGraph: pages.some((p) => p.hasOpenGraph),
        hasSchema: pages.some((p) => p.hasSchema),
        hasFavicon: !!main.hasFavicon,
      },
      conversion: {
        hasWhatsappButton: pages.some((p) => (p.whatsappLinks || []).length),
        hasClickablePhone: pages.some((p) => (p.phoneLinks || []).length),
        hasForm: pages.some((p) => Number(p.forms || 0) > 0),
        hasOnlineChat: /intercom|tawk\.to|crisp\.chat|jivo|zendesk|hubspot|tidio|whatsapp/i.test(mergedHtml),
        ctaStrength: estimateCtaStrength(pages),
      },
      seoBasics: {
        hasSitemap: probes.sitemap,
        hasRobotsTxt: probes.robots,
      },
      crawl: {
        pagesFound: pages.length,
        pages: pages.map(compactPageData),
        brokenLinks: [],
        httpErrors,
      },
      mobile: {
        isResponsive: hasViewport,
        issues: hasViewport ? [] : ["Sem meta viewport — pode quebrar no celular"],
      },
      screenshots: {},
      method: "fetch",
      analyzedAt: Date.now(),
    };
    analysis.siteSummary = buildSiteSummary(lead, analysis);
    return analysis;
  } catch (e) {
    if (e.code === "LEAD_SCORE_CANCELLED") throw e;
    return { ...emptySiteAnalysis(e.message), finalUrl: url, analyzedAt: Date.now(), method: "fetch" };
  }
}

async function fetchHtmlPage(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(3000, timeoutMs || 12000));
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": CONFIG.USER_AGENT || "Mozilla/5.0 SigmaGMapsScraper",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
      },
    });
    const contentType = String(res.headers.get("content-type") || "");
    // Só parseia HTML — evita baixar PDF/imagem como se fosse página
    let html = "";
    if (!contentType || /text\/html|application\/xhtml|text\/plain/i.test(contentType) || contentType.includes("xml")) {
      html = await res.text();
      // corta HTML enorme
      if (html.length > 800000) html = html.slice(0, 800000);
    }
    const headers = {};
    res.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const parsed = parseHtmlDocument(html, res.url || url);
    return {
      ...parsed,
      url,
      finalUrl: res.url || url,
      status: res.status,
      headers,
      loadTimeMs: Date.now() - started,
      htmlSize: html.length,
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseHtmlDocument(html, baseUrl) {
  const raw = String(html || "");
  const title = extractTagText(raw, "title") || metaContent(raw, "og:title");
  const description = metaContent(raw, "description") || metaContent(raw, "og:description");
  const h1 = extractTagText(raw, "h1");
  const h2Count = (raw.match(/<h2\b/gi) || []).length;
  const forms = (raw.match(/<form\b/gi) || []).length;
  const links = extractHrefs(raw, baseUrl);
  const scripts = extractAttr(raw, "script", "src", baseUrl);
  const styles = extractStylesheets(raw, baseUrl);
  const whatsappLinks = links.filter((l) => /wa\.me|api\.whatsapp\.com|web\.whatsapp\.com/i.test(l));
  const phoneLinks = links.filter((l) => /^tel:/i.test(l));
  const emails = links
    .filter((l) => /^mailto:/i.test(l))
    .map((l) => l.replace(/^mailto:/i, "").split("?")[0]);
  const visibleText = stripTags(raw).replace(/\s+/g, " ").trim().slice(0, 12000);
  const headings = extractAllTagTexts(raw, ["h1", "h2", "h3"]).slice(0, 40);
  const buttons = extractButtons(raw).slice(0, 40);
  const ctaLinks = links
    .filter((l) => /whatsapp|wa\.me|contato|contact|orcamento|orçamento|agendar|comprar|tel:|mailto:/i.test(l))
    .slice(0, 30);
  const paragraphs = visibleText
    .split(/(?<=[.!?])\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 25 && t.length <= 300)
    .slice(0, 40);

  return {
    title,
    description,
    h1,
    h2Count,
    forms,
    links,
    scripts,
    styles,
    whatsappLinks,
    phoneLinks,
    emails,
    visibleText,
    aboveTheFoldText: visibleText.slice(0, 3000),
    headings,
    buttons,
    ctaLinks,
    paragraphs,
    hasOpenGraph: /property=["']og:/i.test(raw),
    hasSchema: /application\/ld\+json|itemtype=["'][^"']*schema\.org/i.test(raw),
    hasFavicon: /rel=["'][^"']*icon/i.test(raw),
    html: raw.slice(0, 50000),
    imageCount: (raw.match(/<img\b/gi) || []).length,
    scriptCount: (raw.match(/<script\b/gi) || []).length,
    cssCount: (raw.match(/rel=["']stylesheet["']/gi) || []).length + (raw.match(/<style\b/gi) || []).length,
  };
}

function extractTagText(html, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = String(html || "").match(re);
  return m ? stripTags(m[1]).trim() : "";
}

function extractAllTagTexts(html, tags) {
  const out = [];
  for (const tag of tags) {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
    let m;
    while ((m = re.exec(html))) {
      const text = stripTags(m[1]).replace(/\s+/g, " ").trim();
      if (text) out.push(text);
    }
  }
  return out;
}

function metaContent(html, name) {
  const lower = String(name || "").toLowerCase();
  const re = /<meta\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const n = (tag.match(/(?:name|property)=["']([^"']+)["']/i) || [])[1] || "";
    if (String(n).toLowerCase() === lower) {
      return (tag.match(/content=["']([^"']*)["']/i) || [])[1] || "";
    }
  }
  return "";
}

function extractHrefs(html, baseUrl) {
  const out = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const abs = absolutize(m[1], baseUrl);
    if (abs) out.push(abs);
  }
  return out;
}

function extractAttr(html, tag, attr, baseUrl) {
  const out = [];
  const re = new RegExp(`<${tag}\\b[^>]*${attr}=["']([^"']+)["'][^>]*>`, "gi");
  let m;
  while ((m = re.exec(html))) {
    const abs = absolutize(m[1], baseUrl);
    if (abs) out.push(abs);
  }
  return out;
}

function extractStylesheets(html, baseUrl) {
  const out = [];
  const re = /<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = (m[0].match(/href=["']([^"']+)["']/i) || [])[1];
    const abs = absolutize(href, baseUrl);
    if (abs) out.push(abs);
  }
  return out;
}

function extractButtons(html) {
  const out = [];
  const re = /<(?:button|a|input)\b[^>]*(?:value|aria-label)=["']([^"']{2,90})["'][^>]*>|<(?:button|a)\b[^>]*>([\s\S]{2,90}?)<\/(?:button|a)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const text = stripTags(m[1] || m[2] || "").replace(/\s+/g, " ").trim();
    if (text.length >= 2 && text.length <= 90) out.push(text);
  }
  return out;
}

function stripTags(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"');
}

function absolutize(href, baseUrl) {
  const raw = String(href || "").trim();
  if (!raw || raw.startsWith("#") || raw.startsWith("javascript:") || raw.startsWith("data:")) return "";
  try {
    return new URL(raw, baseUrl).href;
  } catch {
    return "";
  }
}

function pickInternalUrls(links, finalUrl, maxPages) {
  let origin = "";
  try {
    origin = new URL(finalUrl).origin;
  } catch {
    return [];
  }
  const priority = /(contato|contact|sobre|about|servi|orcamento|orçamento|agendamento|portfolio|cases|produtos)/i;
  const clean = [...new Set((links || [])
    .filter((url) => {
      try {
        const parsed = new URL(url);
        return parsed.origin === origin && !/\.(pdf|jpg|jpeg|png|webp|gif|zip|rar|mp4|mp3)$/i.test(parsed.pathname);
      } catch {
        return false;
      }
    })
    .map((url) => {
      const parsed = new URL(url);
      parsed.hash = "";
      parsed.search = "";
      return parsed.href;
    }))
    .filter((u) => u !== finalUrl)];
  return clean.sort((a, b) => Number(priority.test(b)) - Number(priority.test(a))).slice(0, maxPages);
}

async function probeCommonFiles(finalUrl, timeoutMs) {
  let origin = "";
  try {
    origin = new URL(finalUrl).origin;
  } catch {
    return { sitemap: false, robots: false };
  }
  const probe = async (name) => {
    try {
      const res = await fetch(`${origin}/${name}`, {
        method: "GET",
        signal: AbortSignal.timeout(Math.min(timeoutMs || 8000, 8000)),
        headers: { "user-agent": CONFIG.USER_AGENT || "Mozilla/5.0" },
      });
      return res.status >= 200 && res.status < 400;
    } catch {
      return false;
    }
  };
  return {
    sitemap: await probe("sitemap.xml"),
    robots: await probe("robots.txt"),
  };
}

function compactPageData(page) {
  return {
    url: page.url || page.finalUrl || "",
    finalUrl: page.finalUrl || page.url || "",
    status: page.status || 0,
    title: page.title || "",
    description: page.description || "",
    h1: page.h1 || "",
    forms: page.forms || 0,
    whatsappLinks: (page.whatsappLinks || []).slice(0, 10),
    phoneLinks: (page.phoneLinks || []).slice(0, 10),
    links: (page.links || []).slice(0, 80),
    scripts: (page.scripts || []).slice(0, 60),
    styles: (page.styles || []).slice(0, 40),
    headings: (page.headings || []).slice(0, 30),
    buttons: (page.buttons || []).slice(0, 30),
    paragraphs: (page.paragraphs || []).slice(0, 20),
    visibleText: page.visibleText ? page.visibleText.slice(0, 2500) : "",
    aboveTheFoldText: page.aboveTheFoldText ? page.aboveTheFoldText.slice(0, 1200) : "",
    html: page.html ? page.html.slice(0, 5000) : "",
    error: page.error || "",
  };
}

function normalizeUrl(value) {
  const input = String(value || "").trim();
  if (!input) return "";
  try {
    return new URL(input).href;
  } catch {
    try {
      return new URL(`https://${input}`).href;
    } catch {
      return "";
    }
  }
}

function safeHostname(finalUrl) {
  try {
    return new URL(finalUrl).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function hasOwnDomain(finalUrl) {
  return classifyUrl(finalUrl).ownDomain === true;
}

function detectCms(technologies) {
  const cms = (technologies || []).find((t) => t.category === "cms");
  return cms?.name || "";
}

function estimateCtaStrength(pages) {
  const text = pages.map((p) => `${p.html || ""} ${p.visibleText || ""}`).join(" ").toLowerCase();
  const hits = ["orçamento", "orcamento", "agendar", "whatsapp", "fale conosco", "comprar", "contato"].filter((w) => text.includes(w)).length;
  if (hits >= 4) return "alta";
  if (hits >= 2) return "media";
  return "baixa";
}

function emptySiteAnalysis(error) {
  return {
    finalUrl: "",
    domain: "",
    hasHttps: false,
    hasOwnDomain: false,
    cms: "",
    technologies: [],
    frameworks: [],
    tracking: {},
    infrastructure: {},
    performance: { loadTimeMs: 0, pageSizeBytes: 0 },
    content: { title: "", description: "", h1: "", h2Count: 0, hasOpenGraph: false, hasSchema: false, hasFavicon: false },
    conversion: { hasWhatsappButton: false, hasClickablePhone: false, hasForm: false, hasOnlineChat: false, ctaStrength: "baixa" },
    seoBasics: { hasSitemap: false, hasRobotsTxt: false },
    crawl: { pagesFound: 0, pages: [], brokenLinks: [], httpErrors: error ? [{ error }] : [] },
    mobile: { isResponsive: false, issues: error ? [error] : [] },
    screenshots: {},
    method: "fetch",
    error,
  };
}

function checkCancelled(cancelToken) {
  if (cancelToken?.cancelled) {
    const err = new Error("Lead scoring cancelled");
    err.code = "LEAD_SCORE_CANCELLED";
    throw err;
  }
}

module.exports = { analyzeWebsite, normalizeUrl, parseHtmlDocument, fetchHtmlPage };
