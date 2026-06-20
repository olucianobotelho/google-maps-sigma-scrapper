const crypto = require("crypto");
const path = require("path");

const CONNECTION_ID_RE = /^wa_[A-Za-z0-9_-]{6,80}$/;
const MEDIA_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".mp4",
  ".mov",
  ".3gp",
  ".mp3",
  ".wav",
  ".ogg",
  ".opus",
  ".webm",
  ".m4a",
  ".pdf",
  ".doc",
  ".docx",
]);

function createConnectionId() {
  return `wa_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
}

function assertConnectionId(value) {
  if (typeof value !== "string" || !CONNECTION_ID_RE.test(value)) {
    throw new Error("Invalid connection ID");
  }
  return value;
}

function resolveInside(baseDir, ...parts) {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, ...parts);
  const relative = path.relative(base, target);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return target;
  }
  throw new Error("Path escapes allowed directory");
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function limitString(value, maxLength, fallback = "") {
  if (value == null) return fallback;
  return String(value).slice(0, maxLength);
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (e) {
    return false;
  }
}

function assertAllowedMediaPath(filePath, allowedPaths) {
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new Error("Invalid file path");
  }
  const resolved = path.resolve(filePath);
  if (allowedPaths && !allowedPaths.has(resolved)) {
    throw new Error("File was not selected through the app");
  }
  const ext = path.extname(resolved).toLowerCase();
  if (!MEDIA_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported file type: ${ext || "unknown"}`);
  }
  return resolved;
}

function assertMaxBytes(size, maxBytes, label) {
  if (size > maxBytes) {
    throw new Error(`${label} exceeds maximum size`);
  }
}

module.exports = {
  CONNECTION_ID_RE,
  MEDIA_EXTENSIONS,
  assertAllowedMediaPath,
  assertConnectionId,
  assertMaxBytes,
  clampInteger,
  createConnectionId,
  isHttpUrl,
  limitString,
  resolveInside,
};
