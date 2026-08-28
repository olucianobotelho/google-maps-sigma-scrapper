const { createLeadId } = require("./prospecting-store");
const { classifyUrl, VERSION: CLASSIFIER_VERSION } = require("./url-classifier");

function normalizeLead(raw, options = {}) {
  const lead = raw || {};
  const address = clean(lead.address);
  const parsed = parseLocation(address, options.query || "");
  const phone = clean(lead.phone);
  const website = clean(lead.website);
  const whatsapp = inferWhatsapp(phone, website);
  const digitalPresence = classifyUrl(website);
  const company = {
    name: clean(lead.name || lead.company),
    category: clean(lead.category),
    address,
    city: clean(lead.city || parsed.city),
    state: clean(lead.state || parsed.state),
    phone,
    whatsapp,
    email: clean(lead.email),
    website,
    instagram: clean(lead.instagram),
    rating: Number(lead.rating || 0),
    totalReviews: clean(lead.totalReviews || lead.reviews || lead.reviewCount),
    reviewCount: Number(lead.reviewCount || lead.reviews || onlyDigits(lead.totalReviews) || 0),
    openingHours: clean(lead.openingHours || lead.hours || lead.description),
    latitude: lead.latitude || "",
    longitude: lead.longitude || "",
    googleMapsUrl: clean(lead.googleMapsUrl),
  };
  return {
    id: lead.id || createLeadId(company),
    source: clean(lead.source) || "google_maps",
    query: clean(options.query || lead.query),
    searchId: clean(options.searchId || lead.searchId),
    searchLabel: clean(options.searchLabel || lead.searchLabel || lead.searchName),
    company,
    digitalPresence: {
      primaryUrl: digitalPresence.normalizedUrl || website,
      type: digitalPresence.kind,
      platform: digitalPresence.platform || '',
      ownDomain: digitalPresence.ownDomain === true,
      reachable: null,
      domainQuality: digitalPresence.kind === 'own_domain' ? 'own' : digitalPresence.kind === 'none' ? 'none' : 'hosted_or_platform',
      riskFlags: digitalPresence.riskFlags || [],
      classifiedAt: Date.now(),
      classifierVersion: CLASSIFIER_VERSION,
    },
  };
}

function clean(value) {
  return String(value || "").trim();
}

function onlyDigits(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}

function parseLocation(address, query) {
  const text = `${address} ${query}`;
  const stateMatch = text.match(/\b(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/i);
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  let city = "";
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const beforeLast = parts[parts.length - 2];
    city = beforeLast && !/\d/.test(beforeLast) ? beforeLast : last.replace(/\b[A-Z]{2}\b/g, "").trim();
  }
  return { city, state: stateMatch ? stateMatch[1].toUpperCase() : "" };
}

function inferWhatsapp(phone, website) {
  const site = String(website || "");
  const waMatch = site.match(/(?:wa\.me\/|phone=)(\d{10,15})/i);
  if (waMatch) return `+${waMatch[1]}`;
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  const br = digits.startsWith("55") ? digits : `55${digits}`;
  if (br.length >= 12 && br.length <= 13) return `+${br}`;
  return "";
}

module.exports = { normalizeLead };
