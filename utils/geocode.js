const fs = require("fs");
const path = require("path");

let cachePathOverride = null;
let memCache = null;
let lastRequestAt = 0;

function getCacheFilePath() {
  if (cachePathOverride) return cachePathOverride;
  try {
    const { app } = require("electron");
    return path.join(app.getPath("userData"), "geocode-cache.json");
  } catch {
    return path.join(__dirname, "..", ".geocode-cache.json");
  }
}

function setCachePath(p) {
  cachePathOverride = p;
  memCache = null;
}

function loadCache() {
  if (memCache) return memCache;
  try {
    const fp = getCacheFilePath();
    if (fs.existsSync(fp)) {
      const raw = JSON.parse(fs.readFileSync(fp, "utf-8"));
      if (raw && typeof raw === "object") {
        memCache = raw;
        return memCache;
      }
    }
  } catch {}
  memCache = {};
  return memCache;
}

function saveCache() {
  try {
    const fp = getCacheFilePath();
    const dir = path.dirname(fp);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const entries = Object.entries(memCache || {});
    const trimmed = entries.length > 5000 ? Object.fromEntries(entries.slice(-5000)) : memCache;
    fs.writeFileSync(fp, JSON.stringify(trimmed, null, 2));
  } catch {}
}

function normalizeKey(address, hint) {
  const combined = `${address || ""} ${hint || ""}`.toLowerCase().trim().replace(/\s+/g, " ");
  return combined.replace(/brasil$/i, "").trim().slice(0, 240);
}

function extractCep(address) {
  const m = String(address || "").match(/\d{5}-?\d{3}/);
  return m ? m[0] : "";
}

function isValidCoord(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) > 0.1 && Math.abs(lng) > 0.1;
}

async function throttle() {
  const now = Date.now();
  const elapsed = now - lastRequestAt;
  if (elapsed < 1100) {
    await new Promise((r) => setTimeout(r, 1100 - elapsed));
  }
  lastRequestAt = Date.now();
}

async function geocodeAddress(address, hint) {
  const query = `${address || ""} ${hint || ""}`.trim();
  if (!query || query.length < 4) return null;

  const key = normalizeKey(address, hint);
  const cache = loadCache();
  const cached = cache[key];
  if (cached && cached.lat != null) {
    if (Date.now() - (cached.ts || 0) < 30 * 24 * 60 * 60 * 1000) {
      return cached;
    }
  }

  await throttle();

  const q = encodeURIComponent(query);
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${q}&addressdetails=1&countrycodes=br`;

  let res;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": "SigmaGMaps/1.0 (sigma-gmaps-scraper)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  let data;
  try {
    data = await res.json();
  } catch {
    return null;
  }

  if (!Array.isArray(data) || !data.length) return null;

  const hit = data[0];
  const lat = parseFloat(hit.lat);
  const lng = parseFloat(hit.lon);
  if (!isValidCoord(lat, lng)) return null;

  const type = hit.type || hit.class || "";
  const importance = hit.importance || 0;
  let confidence = "approximate";
  if (type === "house" || type === "building" || importance > 0.7) confidence = "exact";
  else if (importance > 0.4) confidence = "approximate";

  const result = {
    lat,
    lng,
    confidence,
    source: "nominatim",
    displayName: hit.display_name || "",
    ts: Date.now(),
  };

  cache[key] = result;
  saveCache();
  return result;
}

function geocodeFromCache(address, hint) {
  const key = normalizeKey(address, hint);
  const cache = loadCache();
  return cache[key] || null;
}

module.exports = {
  geocodeAddress,
  geocodeFromCache,
  setCachePath,
  normalizeKey,
  extractCep,
  isValidCoord,
  _loadCache: loadCache,
};
