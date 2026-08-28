/**
 * Campaign analytics helpers.
 * Computes funnel rates, response timing and hour-of-day distribution
 * so campaigns can be optimized from the monitor UI.
 */

const STATUS_SENT = new Set(['sent', 'delivered', 'read', 'replied']);
const STATUS_DELIVERED = new Set(['delivered', 'read', 'replied']);
const STATUS_READ = new Set(['read', 'replied']);

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid];
}

function avg(values) {
  if (!values.length) return 0;
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}

function pct(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10; // 1 decimal
}

/**
 * Recompute full campaign stats from lead records.
 * @param {{ leads?: Array }} campaign
 */
function recomputeStats(campaign) {
  const leads = campaign?.leads || [];
  const sentLeads = leads.filter((l) => STATUS_SENT.has(l.status) || l.sentAt || l.messageId);
  const deliveredLeads = leads.filter(
    (l) => STATUS_DELIVERED.has(l.status) || l.deliveredAt || STATUS_READ.has(l.status) || l.repliedAt
  );
  const readLeads = leads.filter((l) => STATUS_READ.has(l.status) || l.readAt || l.repliedAt);
  const repliedLeads = leads.filter((l) => l.repliedAt || l.replyCount > 0 || l.status === 'replied');
  const openedLeads = leads.filter((l) => (l.openCount || 0) > 0 || l.readAt || l.openedAt);

  const responseTimes = leads
    .map((l) => l.responseTimeMs)
    .filter((v) => Number.isFinite(v) && v >= 0);

  const deliveryTimes = leads
    .filter((l) => l.sentAt && l.deliveredAt)
    .map((l) => Math.max(0, l.deliveredAt - l.sentAt));

  const readTimes = leads
    .filter((l) => l.sentAt && l.readAt)
    .map((l) => Math.max(0, l.readAt - l.sentAt));

  const openCount = leads.reduce((sum, l) => sum + (Number(l.openCount) || 0), 0);
  const replyCount = leads.reduce((sum, l) => {
    if (Number.isFinite(l.replyCount) && l.replyCount > 0) return sum + l.replyCount;
    return sum + (l.repliedAt ? 1 : 0);
  }, 0);

  // Hour-of-day histogram (0-23) from each reply timestamp
  const replyHourHistogram = Array.from({ length: 24 }, () => 0);
  const replyHours = [];
  for (const lead of repliedLeads) {
    const stamps = [];
    if (Array.isArray(lead.replyTimestamps) && lead.replyTimestamps.length) {
      for (const t of lead.replyTimestamps) {
        if (Number.isFinite(t)) stamps.push(t);
      }
    } else if (lead.repliedAt) {
      stamps.push(lead.repliedAt);
    }
    for (const t of stamps) {
      const hour = new Date(t).getHours();
      if (hour >= 0 && hour <= 23) {
        replyHourHistogram[hour] += 1;
        replyHours.push(hour);
      }
    }
  }

  const sent = sentLeads.length;
  const delivered = deliveredLeads.length;
  const read = readLeads.length;
  const replied = repliedLeads.length;
  const opened = openedLeads.length;

  // Breakdown por número (connectionId) — útil em campanhas multi-conexão
  const byConnection = {};
  for (const lead of leads) {
    const cid = lead.connectionId || '_none';
    if (!byConnection[cid]) {
      byConnection[cid] = {
        connectionId: lead.connectionId || null,
        total: 0,
        pending: 0,
        sent: 0,
        delivered: 0,
        read: 0,
        replied: 0,
        failed: 0,
      };
    }
    const row = byConnection[cid];
    row.total += 1;
    if (lead.status === 'pending') row.pending += 1;
    if (lead.status === 'failed') row.failed += 1;
    if (STATUS_SENT.has(lead.status) || lead.sentAt || lead.messageId) row.sent += 1;
    if (STATUS_DELIVERED.has(lead.status) || lead.deliveredAt) row.delivered += 1;
    if (STATUS_READ.has(lead.status) || lead.readAt || lead.repliedAt) row.read += 1;
    if (lead.repliedAt || lead.replyCount > 0 || lead.status === 'replied') row.replied += 1;
  }

  return {
    total: leads.length,
    pending: leads.filter((l) => l.status === 'pending').length,
    sent,
    delivered,
    read,
    replied,
    failed: leads.filter((l) => l.status === 'failed').length,
    opened,
    openCount,
    replyCount,
    avgResponseTimeMs: avg(responseTimes),
    medianResponseTimeMs: median(responseTimes),
    minResponseTimeMs: responseTimes.length ? Math.min(...responseTimes) : 0,
    maxResponseTimeMs: responseTimes.length ? Math.max(...responseTimes) : 0,
    avgDeliveryTimeMs: avg(deliveryTimes),
    avgReadTimeMs: avg(readTimes),
    deliveryRate: pct(delivered, sent),
    readRate: pct(read, sent),
    replyRate: pct(replied, sent),
    openRate: pct(opened, sent),
    avgReplyHour: replyHours.length
      ? Math.round((replyHours.reduce((s, h) => s + h, 0) / replyHours.length) * 10) / 10
      : null,
    replyHourHistogram,
    byConnection,
  };
}

/**
 * Empty stats template for new campaigns.
 */
function emptyStats(total = 0) {
  return {
    total,
    pending: total,
    sent: 0,
    delivered: 0,
    read: 0,
    replied: 0,
    failed: 0,
    opened: 0,
    openCount: 0,
    replyCount: 0,
    avgResponseTimeMs: 0,
    medianResponseTimeMs: 0,
    minResponseTimeMs: 0,
    maxResponseTimeMs: 0,
    avgDeliveryTimeMs: 0,
    avgReadTimeMs: 0,
    deliveryRate: 0,
    readRate: 0,
    replyRate: 0,
    openRate: 0,
    avgReplyHour: null,
    replyHourHistogram: Array.from({ length: 24 }, () => 0),
    byConnection: {},
  };
}

/**
 * Lead fields related to tracking (defaults).
 */
function defaultLeadTrackingFields() {
  return {
    status: 'pending',
    errorMessage: null,
    sentAt: null,
    deliveredAt: null,
    readAt: null,
    repliedAt: null,
    lastReplyAt: null,
    responseTimeMs: null,
    messageId: null,
    retryCount: 0,
    openCount: 0,
    openedAt: null,
    lastOpenAt: null,
    replyCount: 0,
    replyTimestamps: [],
  };
}

/**
 * Human-readable duration (pt-BR short).
 */
function formatDurationMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return remSec ? `${min}m ${remSec}s` : `${min}m`;
  const h = Math.floor(min / 60);
  const remMin = min % 60;
  if (h < 48) return remMin ? `${h}h ${remMin}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/**
 * Format hour as HH:00.
 */
function formatHourLabel(hour) {
  if (!Number.isFinite(hour) && hour !== 0) return '—';
  const h = Math.round(hour) % 24;
  return `${String(h).padStart(2, '0')}:00`;
}

module.exports = {
  recomputeStats,
  emptyStats,
  defaultLeadTrackingFields,
  formatDurationMs,
  formatHourLabel,
  STATUS_SENT,
  STATUS_DELIVERED,
  STATUS_READ,
};
