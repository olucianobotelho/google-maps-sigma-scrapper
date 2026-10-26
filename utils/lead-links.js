const { parse } = require('tldts');

// Parâmetros de campanha que só sujam a URL salva na base.
const TRACKING_PARAMS = new Set([
  'gclid',
  'fbclid',
  'igsh',
  'igshid',
  'mstparam',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'yclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
]);

// Hosts do Google nunca são o site da empresa (Maps, shortlinks, CDN de fotos).
const GOOGLE_HOST_SUFFIXES = [
  'google.com',
  'google.com.br',
  'google.co',
  'goo.gl',
  'g.co',
  'googleusercontent.com',
  'gstatic.com',
  'withgoogle.com',
  'googlesyndication.com',
];

const SOCIAL_HOSTS = [
  'instagram.com',
  'instagr.am',
  'facebook.com',
  'fb.com',
  'fb.me',
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'wa.me',
  'whatsapp.com',
];

const AGGREGATOR_HOSTS = [
  'linktr.ee',
  'linktree.com',
  'beacons.ai',
  'bio.site',
  'bio.link',
  'taplink.cc',
  'lnk.bio',
  'linkin.bio',
  'allmylinks.com',
  'campsite.bio',
];

// Marketplace e encurtadores também não são o site da empresa: apontam para
// perfis/aluguel de vitrine ou para outra URL que precisaria ser resolvida.
const MARKETPLACE_HOSTS = [
  'ifood.com.br',
  'getninjas.com.br',
  'doctoralia.com.br',
  'tripadvisor.com',
  'tripadvisor.com.br',
  'reclameaqui.com.br',
];

const SHORTENER_HOSTS = ['bit.ly', 'tinyurl.com', 't.co', 'is.gd'];

// CDN de foto/vídeo de rede social: o link é a imagem do perfil, não um site.
const MEDIA_CDN_HOSTS = ['cdninstagram.com', 'fbcdn.net', 'licdn.com'];

// Caminhos do Instagram que não são perfil de empresa.
const INSTAGRAM_RESERVED_SEGMENTS = new Set([
  'p',
  'reel',
  'reels',
  'tv',
  'stories',
  'story',
  'explore',
  'explorar',
  'accounts',
  'direct',
  'about',
  'invites',
  'lite',
]);

const PRIVATE_HOSTS = new Set(['localhost', 'localhost.localdomain']);

// Sufixos usados para não confundir "@cafe.aurora" (handle válido, com ponto)
// com um domínio colado na coluna de Instagram.
const COMMON_DOMAIN_SUFFIXES = new Set([
  'com', 'com.br', 'net', 'net.br', 'org', 'org.br', 'io', 'dev', 'app',
  'co', 'br', 'site', 'online', 'store', 'shop', 'me', 'info', 'biz', 'com.mx',
]);

function looksLikeDomain(value) {
  const parts = String(value || '').toLocaleLowerCase('en-US').split('.').filter(Boolean);
  if (parts.length < 2) return false;
  return COMMON_DOMAIN_SUFFIXES.has(parts[parts.length - 1])
    || COMMON_DOMAIN_SUFFIXES.has(parts.slice(-2).join('.'));
}

function cleanText(value) {
  // O painel do Maps injeta glifos de fonte Material (área privada Unicode) no
  // textContent. trim() sozinho não remove, então limpamos a faixa inteira.
  return String(value ?? '')
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{Co}\u{FE0E}\u{FE0F}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function hostOf(value) {
  const raw = cleanText(value).toLocaleLowerCase('en-US');
  if (!raw) return '';
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function matchesHost(host, suffixes) {
  return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function isGoogleOwnedUrl(value) {
  const host = hostOf(value);
  if (!host) return false;
  return matchesHost(host, GOOGLE_HOST_SUFFIXES);
}

function isSocialUrl(value) {
  const host = hostOf(value);
  if (!host) return false;
  return matchesHost(host, SOCIAL_HOSTS);
}

function isAggregatorUrl(value) {
  const host = hostOf(value);
  if (!host) return false;
  return matchesHost(host, AGGREGATOR_HOSTS);
}

function isMarketplaceUrl(value) {
  const host = hostOf(value);
  if (!host) return false;
  return matchesHost(host, MARKETPLACE_HOSTS);
}

function isShortenerUrl(value) {
  const host = hostOf(value);
  if (!host) return false;
  return matchesHost(host, SHORTENER_HOSTS);
}

function isMediaCdnUrl(value) {
  const host = hostOf(value);
  if (!host) return false;
  return matchesHost(host, MEDIA_CDN_HOSTS);
}

/**
 * Nada fora de domínio próprio deve ocupar o campo `site`: rede social,
 * link-in-bio (linktr.ee…), marketplace, encurtador, CDN de mídia e host do
 * Google. Instagram é o único caso que migra para o campo `instagram` em vez
 * de sumir.
 */
function isNonSiteUrl(value) {
  return isGoogleOwnedUrl(value)
    || isSocialUrl(value)
    || isAggregatorUrl(value)
    || isMarketplaceUrl(value)
    || isShortenerUrl(value)
    || isMediaCdnUrl(value);
}

function isInstagramHost(host) {
  return host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am' || host.endsWith('.instagr.am');
}

function isInstagramUrl(value) {
  return isInstagramHost(hostOf(value));
}

function isPrivateHost(host) {
  if (PRIVATE_HOSTS.has(host)) return true;
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
}

/** Remove o envelope do google.com/url?q=… que aparece em links copiados do Maps. */
function unwrapRedirect(value) {
  const raw = cleanText(value);
  if (!raw) return '';
  if (!isGoogleOwnedUrl(raw)) return raw;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    const target = url.searchParams.get('q') || url.searchParams.get('url') || '';
    if (target && !isGoogleOwnedUrl(target)) return target;
  } catch {
    return '';
  }
  return '';
}

function stripTrackingParams(url) {
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLocaleLowerCase('en-US')) || key.toLocaleLowerCase('en-US').startsWith('utm_')) {
      url.searchParams.delete(key);
    }
  }
  url.hash = '';
  if (!url.searchParams.toString()) url.search = '';
  return url;
}

/** Site "de verdade": http(s), domínio registrável, sem Google e sem rede local. */
function normalizeWebsite(value, options = {}) {
  const raw = unwrapRedirect(value);
  if (!raw) return '';
  // "@empresa" é handle de rede social colado na coluna de site.
  if (raw.startsWith('@')) return '';
  let url;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return '';
  }
  if (!['http:', 'https:'].includes(url.protocol)) return '';
  const host = url.hostname.toLocaleLowerCase('en-US').replace(/^www\./, '');
  if (!host || isPrivateHost(host)) return '';
  const parsed = parse(host);
  if (!parsed.domain) return '';
  if (isGoogleOwnedUrl(host)) return '';
  if (isInstagramUrl(host)) return options.allowInstagram ? withCleanQuery(url) : '';
  if (isSocialUrl(host) || isAggregatorUrl(host) || isMarketplaceUrl(host) || isShortenerUrl(host)) return '';
  if (isMediaCdnUrl(host)) return '';
  return withCleanQuery(url);
}

function withCleanQuery(url) {
  stripTrackingParams(url);
  return url.href;
}

/**
 * Decisão única de "tem site de verdade" para filtros, contadores e score.
 * Instagram/Linktree/Facebook/marketplace/encurtador retornam false.
 */
function isRealWebsite(value) {
  return Boolean(normalizeWebsite(value));
}

/** Aceita URL, "instagram.com/empresa", "@empresa" ou "empresa" e devolve o @handle. */
function extractInstagramHandle(value) {
  const raw = unwrapRedirect(value);
  if (!raw) return '';
  const cleaned = cleanText(raw).replace(/^@+/, '');
  if (!cleaned) return '';
  const explicitHandle = cleanText(raw).startsWith('@');
  if (!cleaned.includes('/')) {
    // "@cafe.co" é handle explícito; sem o @, um domínio colado na coluna de
    // Instagram não pode virar perfil.
    if (looksLikeDomain(cleaned) && !explicitHandle) return '';
    return /^[a-z0-9._]{1,30}$/i.test(cleaned) ? cleaned : '';
  }
  if (!isInstagramUrl(cleaned)) return '';
  let url;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`);
  } catch {
    return '';
  }
  const segments = url.pathname.split('/').map((segment) => segment.trim()).filter(Boolean);
  const first = segments[0] || '';
  if (!first) return '';
  // /p/, /reel/ e /stories/ são conteúdo, não o perfil da empresa.
  if (INSTAGRAM_RESERVED_SEGMENTS.has(first.toLocaleLowerCase('en-US'))) return '';
  const handle = decodeURIComponent(first).replace(/^@+/, '');
  return /^[a-z0-9._]{1,30}$/i.test(handle) ? handle : '';
}

function normalizeInstagram(value) {
  const handle = extractInstagramHandle(value);
  return handle ? `@${handle}` : '';
}

function instagramProfileUrl(value) {
  const handle = extractInstagramHandle(value);
  return handle ? `https://instagram.com/${handle}` : '';
}

/** Telefone legível: remove glifos invisíveis e normaliza espaços, mantendo o +. */
function normalizePhoneDisplay(value) {
  const text = cleanText(value);
  if (!text) return '';
  const digits = text.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 20) return '';
  const body = text.replace(/[^\d\s()-]/g, '').replace(/\s+/g, ' ').trim();
  return text.startsWith('+') ? `+${body}` : body;
}

/**
 * Consolida website/instagram de um lead: Instagram nunca fica no campo site e
 * link do Google nunca sobrevive como site da empresa.
 */
function normalizeLeadLinks(raw = {}) {
  let instagram = normalizeInstagram(raw.instagram || raw.ig);
  const rawWebsite = raw.website || raw.site || raw.url;
  let website = normalizeWebsite(rawWebsite, { allowInstagram: true });
  // Handle colado no campo de site vai para o campo de Instagram.
  if (!website && !instagram && cleanText(rawWebsite).startsWith('@')) {
    instagram = normalizeInstagram(rawWebsite);
  }
  if (website && isInstagramUrl(website)) {
    if (!instagram) instagram = normalizeInstagram(website);
    website = '';
  }
  return { website, instagram };
}

module.exports = {
  normalizeWebsite,
  normalizeInstagram,
  instagramProfileUrl,
  extractInstagramHandle,
  normalizePhoneDisplay,
  normalizeLeadLinks,
  isGoogleOwnedUrl,
  isSocialUrl,
  isAggregatorUrl,
  isMarketplaceUrl,
  isShortenerUrl,
  isMediaCdnUrl,
  isNonSiteUrl,
  isRealWebsite,
  isInstagramUrl,
  looksLikeDomain,
  hostOf,
  cleanText,
};
