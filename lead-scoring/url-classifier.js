const { parse } = require('tldts');
const { findPlatform } = require('./platform-catalog');

const VERSION = '1.0.0';
const PRIVATE_HOSTS = new Set(['localhost', 'localhost.localdomain']);

function classifyUrl(rawValue) {
  const rawUrl = String(rawValue || '').trim();
  const base = { rawUrl, normalizedUrl: '', finalUrl: '', hostname: '', registrableDomain: '', platform: '', confidence: 0, reasons: [], riskFlags: [], classifierVersion: VERSION };
  if (!rawUrl) return { ...base, kind: 'none', crawlPolicy: 'skip', reasons: ['URL ausente'] };

  let url;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  } catch {
    return { ...base, kind: 'invalid', crawlPolicy: 'skip', reasons: ['URL inválida'] };
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const parsed = parse(host);
  const result = { ...base, normalizedUrl: url.href, finalUrl: url.href, hostname: host, registrableDomain: parsed.domain || '', confidence: 0.95, reasons: [], riskFlags: [] };
  if (!['http:', 'https:'].includes(url.protocol)) return { ...result, kind: 'suspicious', crawlPolicy: 'skip', confidence: 1, riskFlags: ['unsupported_scheme'], reasons: ['Esquema não HTTP(S)'] };
  if (PRIVATE_HOSTS.has(host) || isIpPrivate(host)) return { ...result, kind: 'suspicious', crawlPolicy: 'skip', confidence: 1, riskFlags: ['private_network'], reasons: ['Destino de rede privada/local'] };
  if (!parsed.domain) return { ...result, kind: 'suspicious', crawlPolicy: 'skip', confidence: 0.9, reasons: ['Domínio não registrável'] };

  const platform = findPlatform(host);
  if (platform) {
    const noFullCrawl = ['social', 'link_aggregator', 'marketplace'].includes(platform.kind);
    return { ...result, ...platform, crawlPolicy: noFullCrawl ? 'skip' : 'lightweight', ownDomain: false, reasons: [`Classificado como ${platform.kind}`] };
  }
  const hosted = host.split('.').length > 2 && ['github.io', 'netlify.app', 'vercel.app', 'web.app'].some((d) => host.endsWith(`.${d}`));
  return { ...result, kind: hosted ? 'hosted_subdomain' : 'own_domain', crawlPolicy: 'full', ownDomain: !hosted, reasons: [hosted ? 'Subdomínio hospedado' : 'Domínio próprio'] };
}

function isIpPrivate(host) {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return parts[0] === 10 || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
}

module.exports = { classifyUrl, isIpPrivate, VERSION };
