import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTimeResult } from '../../src/core/search-engine.js';

test('TIME-RANGE-001: resolveTimeResult handles 1 week (168h) window accurately', () => {
  const refTime = new Date('2026-09-09T10:00:00.000Z');

  // "1 tuần" -> within 168h window
  const oneWeekRes = resolveTimeResult({
    timeText: '1 tuần',
    recencyHours: 168,
    now: refTime
  });
  assert.equal(oneWeekRes.withinRequestedWindow, true);
  assert.equal(oneWeekRes.isWithin24h, false);

  // "1 tuần" with 24h window -> outside
  const oneWeekIn24h = resolveTimeResult({
    timeText: '1 tuần',
    recencyHours: 24,
    now: refTime
  });
  assert.equal(oneWeekIn24h.withinRequestedWindow, false);

  // "1 tuần" with 72h window -> outside
  const oneWeekIn72h = resolveTimeResult({
    timeText: '1 tuần',
    recencyHours: 72,
    now: refTime
  });
  assert.equal(oneWeekIn72h.withinRequestedWindow, false);

  // "2 tuần" -> strictly outside 168h window
  const twoWeeksRes = resolveTimeResult({
    timeText: '2 tuần',
    recencyHours: 168,
    now: refTime
  });
  assert.equal(twoWeeksRes.withinRequestedWindow, false);

  // "5 ngày" -> within 168h window, but outside 24h & 72h window
  const fiveDaysRes = resolveTimeResult({
    timeText: '5 ngày',
    recencyHours: 168,
    now: refTime
  });
  assert.equal(fiveDaysRes.withinRequestedWindow, true);
});

test('TIME-RANGE-002: resolveTimeResult handles 3 days (72h) window accurately', () => {
  const refTime = new Date('2026-09-09T10:00:00.000Z');

  // "2 ngày" -> within 72h window
  const twoDaysRes = resolveTimeResult({
    timeText: '2 ngày',
    recencyHours: 72,
    now: refTime
  });
  assert.equal(twoDaysRes.withinRequestedWindow, true);
  assert.equal(twoDaysRes.isWithin24h, false);

  // "3 ngày" -> within 72h window
  const threeDaysRes = resolveTimeResult({
    timeText: '3 ngày',
    recencyHours: 72,
    now: refTime
  });
  assert.equal(threeDaysRes.withinRequestedWindow, true);

  // "4 ngày" -> outside 72h window
  const fourDaysRes = resolveTimeResult({
    timeText: '4 ngày',
    recencyHours: 72,
    now: refTime
  });
  assert.equal(fourDaysRes.withinRequestedWindow, false);
});
