const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  recomputeStats,
  emptyStats,
  defaultLeadTrackingFields,
  formatDurationMs,
  formatHourLabel,
} = require('../campaigns/campaign-analytics');

describe('campaign-analytics', () => {
  it('emptyStats has funnel + histogram fields', () => {
    const s = emptyStats(10);
    assert.equal(s.total, 10);
    assert.equal(s.pending, 10);
    assert.equal(s.openCount, 0);
    assert.equal(s.replyCount, 0);
    assert.equal(s.replyHourHistogram.length, 24);
    assert.equal(s.avgReplyHour, null);
  });

  it('defaultLeadTrackingFields includes open/reply tracking', () => {
    const f = defaultLeadTrackingFields();
    assert.equal(f.openCount, 0);
    assert.equal(f.replyCount, 0);
    assert.deepEqual(f.replyTimestamps, []);
  });

  it('recomputeStats computes rates, opens, replies and hour avg', () => {
    const noon = new Date('2026-06-01T12:00:00').getTime();
    const twoPm = new Date('2026-06-01T14:00:00').getTime();
    const fourPm = new Date('2026-06-01T16:00:00').getTime();

    const campaign = {
      leads: [
        {
          status: 'replied',
          sentAt: noon,
          deliveredAt: noon + 5000,
          readAt: noon + 60000,
          repliedAt: twoPm,
          responseTimeMs: twoPm - noon,
          openCount: 2,
          openedAt: noon + 60000,
          replyCount: 2,
          replyTimestamps: [twoPm, fourPm],
        },
        {
          status: 'read',
          sentAt: noon,
          deliveredAt: noon + 3000,
          readAt: noon + 30000,
          openCount: 1,
          openedAt: noon + 30000,
          replyCount: 0,
        },
        {
          status: 'sent',
          sentAt: noon,
          openCount: 0,
        },
        {
          status: 'failed',
        },
      ],
    };

    const stats = recomputeStats(campaign);
    assert.equal(stats.total, 4);
    assert.equal(stats.sent, 3);
    assert.equal(stats.delivered, 2);
    assert.equal(stats.read, 2);
    assert.equal(stats.replied, 1);
    assert.equal(stats.failed, 1);
    assert.equal(stats.opened, 2);
    assert.equal(stats.openCount, 3);
    assert.equal(stats.replyCount, 2);
    assert.ok(stats.avgResponseTimeMs > 0);
    assert.ok(stats.deliveryRate > 0);
    assert.ok(stats.readRate > 0);
    assert.ok(stats.replyRate > 0);
    // Hours 14 and 16 from replyTimestamps
    assert.equal(stats.replyHourHistogram[14], 1);
    assert.equal(stats.replyHourHistogram[16], 1);
    assert.equal(stats.avgReplyHour, 15);
  });

  it('formatDurationMs and formatHourLabel', () => {
    assert.equal(formatDurationMs(500), '500ms');
    assert.equal(formatDurationMs(45000), '45s');
    assert.equal(formatDurationMs(125000), '2m 5s');
    assert.equal(formatHourLabel(9), '09:00');
    assert.equal(formatHourLabel(null), '—');
  });
});
