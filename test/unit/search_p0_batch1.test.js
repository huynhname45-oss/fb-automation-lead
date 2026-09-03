import test from 'node:test';
import assert from 'node:assert/strict';

import { getCanonicalPostKey } from '../../src/core/history-manager.js';
import { 
  normalizeTargetAccepted, 
  resolveTimeResult, 
  matchesSelectedYear,
  getCleanCanonicalFacebookUrl 
} from '../../src/core/search-engine.js';

// =========================================================================
// SEARCH-P0-001 Tests: Target Accepted normalization & consistent loop bounds
// =========================================================================
test('SEARCH-P0-001: normalizeTargetAccepted handles null, undefined, and valid inputs correctly', () => {
  // If maxPosts is not passed or null, fallback to config value or default
  assert.equal(normalizeTargetAccepted(null, 50), 50);
  assert.equal(normalizeTargetAccepted(undefined, 30), 30);
  assert.equal(normalizeTargetAccepted(0, 25), 25);
  assert.equal(normalizeTargetAccepted(-5, 40), 40);
  
  // If maxPosts is passed as a valid positive integer, use it
  assert.equal(normalizeTargetAccepted(10, 50), 10);
  assert.equal(normalizeTargetAccepted(100, 50), 100);
  assert.equal(normalizeTargetAccepted('15', 50), 15);
});

// =========================================================================
// SEARCH-P0-002 Tests: Time resolver strictness & no fail-open on unknown
// =========================================================================
test('SEARCH-P0-002: resolveTimeResult does NOT fail-open on unknown, invalid, or empty time text', () => {
  const refTime = new Date('2026-08-28T12:00:00.000Z');

  // Empty or null
  const emptyRes = resolveTimeResult({ timeText: '', rawContent: 'Nội dung bài viết', recencyHours: 24, now: refTime });
  assert.equal(emptyRes.status, 'unknown');
  assert.equal(emptyRes.withinRequestedWindow, false);
  assert.equal(emptyRes.isWithin24h, false);

  // Unparseable random string
  const unkRes = resolveTimeResult({ timeText: 'bài viết linh tinh', rawContent: 'content', recencyHours: 24, now: refTime });
  assert.equal(unkRes.status, 'unknown');
  assert.equal(unkRes.withinRequestedWindow, false);
  assert.equal(unkRes.isWithin24h, false);

  // Accidentally passing full content (> 60 chars) as timeText should NOT fail-open
  const longTextRes = resolveTimeResult({ 
    timeText: 'TƯNG BỪNG KHAI TRƯƠNG QUÁN CƠM BÌNH DÂN TẠI 123 NGUYỄN TRÃI QUẬN 1 GIẢM GIÁ 20% CHO KHÁCH HÀNG', 
    rawContent: '...', 
    recencyHours: 24, 
    now: refTime 
  });
  assert.equal(longTextRes.status, 'unknown');
  assert.equal(longTextRes.withinRequestedWindow, false);
  assert.equal(longTextRes.isWithin24h, false);
});

test('SEARCH-P0-002: resolveTimeResult parses recent relative times accurately (minutes, hours)', () => {
  const refTime = new Date('2026-08-28T12:00:00.000Z');

  // "5 phút" -> 5 minutes ago
  const minRes = resolveTimeResult({ timeText: '5 phút', rawContent: '', recencyHours: 24, now: refTime });
  assert.equal(minRes.status, 'range');
  assert.equal(minRes.withinRequestedWindow, true);
  assert.equal(minRes.isWithin24h, true);
  assert.ok(minRes.earliestAt && minRes.latestAt);

  // "3 giờ" -> 3 hours ago
  const hourRes = resolveTimeResult({ timeText: '3 giờ', rawContent: '', recencyHours: 24, now: refTime });
  assert.equal(hourRes.status, 'range');
  assert.equal(hourRes.withinRequestedWindow, true);
  assert.equal(hourRes.isWithin24h, true);

  // "vừa xong" -> instant
  const justNowRes = resolveTimeResult({ timeText: 'vừa xong', rawContent: '', recencyHours: 24, now: refTime });
  assert.equal(justNowRes.status, 'exact');
  assert.equal(justNowRes.withinRequestedWindow, true);
  assert.equal(justNowRes.isWithin24h, true);
});

test('SEARCH-P0-002: resolveTimeResult handles "Hôm qua" as a time range and respects recency window', () => {
  // Reference time: 2026-08-28 at 14:00 (Vietnam time)
  const refTime = new Date('2026-08-28T07:00:00.000Z'); // 14:00 VN

  const yesterdayRes = resolveTimeResult({ timeText: 'Hôm qua', rawContent: '', recencyHours: 72, now: refTime });
  assert.equal(yesterdayRes.status, 'range');
  assert.equal(yesterdayRes.withinRequestedWindow, true);
  assert.ok(yesterdayRes.earliestAt);
  assert.ok(yesterdayRes.latestAt);
});

test('SEARCH-P0-002: resolveTimeResult accurately flags old posts (> 24h / > 72h)', () => {
  const refTime = new Date('2026-08-28T12:00:00.000Z');

  // "4 ngày" -> 4 days ago (96h ago) -> out of 24h & 72h window
  const fourDaysRes = resolveTimeResult({ timeText: '4 ngày', rawContent: '', recencyHours: 72, now: refTime });
  assert.equal(fourDaysRes.status, 'range');
  assert.equal(fourDaysRes.withinRequestedWindow, false);
  assert.equal(fourDaysRes.isWithin24h, false);

  // "2 tuần" -> out of window
  const twoWeeksRes = resolveTimeResult({ timeText: '2 tuần', rawContent: '', recencyHours: 72, now: refTime });
  assert.equal(twoWeeksRes.status, 'range');
  assert.equal(twoWeeksRes.withinRequestedWindow, false);

  // "năm 2024" -> out of window
  const oldYearRes = resolveTimeResult({ timeText: 'năm 2024', rawContent: '', recencyHours: 72, now: refTime });
  assert.equal(oldYearRes.status, 'range');
  assert.equal(oldYearRes.withinRequestedWindow, false);
});

test('SEARCH-P0-002: selected year is enforced locally even if Facebook UI fails to reflect it', () => {
  const currentYearResult = resolveTimeResult({
    timeText: '2 giờ',
    now: new Date('2026-08-28T12:00:00.000Z')
  });
  assert.equal(matchesSelectedYear(currentYearResult, '2026'), true);
  assert.equal(matchesSelectedYear(currentYearResult, '2025'), false);
  assert.equal(matchesSelectedYear({ publishedAt: null }, '2026'), null);
});

// =========================================================================
// SEARCH-P0-013 Tests: Post ID vs Profile URL dedupe separation
// =========================================================================
test('SEARCH-P0-013: getCanonicalPostKey extracts post IDs correctly from direct permalinks', () => {
  // Direct post path /posts/pfbid...
  const key1 = getCanonicalPostKey({ postLink: 'https://www.facebook.com/username/posts/pfbid02abcxyz123?__cft__=test' });
  assert.equal(key1, 'post_pfbid02abcxyz123');

  // Direct story_fbid parameter
  const key2 = getCanonicalPostKey({ postLink: 'https://www.facebook.com/permalink.php?story_fbid=1122334455&id=1000998877' });
  assert.equal(key2, 'fbid_1122334455');

  // Direct photo path
  const key3 = getCanonicalPostKey({ postLink: 'https://www.facebook.com/username/photos/a.123/9876543210/' });
  assert.equal(key3, 'post_9876543210');
});

test('SEARCH-P0-013: getCanonicalPostKey does NOT use profile URL as post key and preserves different posts from same author', () => {
  // Author has a profile URL, but two different posts with NO direct post permalink
  const postA = {
    authorName: 'Chery Nguyễn',
    profileLink: 'https://www.facebook.com/chery.nguyen.123',
    postLink: '', // No direct post link
    content: 'Tưng bừng khai trương quán trà sữa tại số 10 đường 3/2 Biên Hòa Đồng Nai'
  };

  const postB = {
    authorName: 'Chery Nguyễn',
    profileLink: 'https://www.facebook.com/chery.nguyen.123',
    postLink: '', // No direct post link
    content: 'Tuyển nhân viên phục vụ quán cafe làm việc theo ca sáng tối'
  };

  const keyA = getCanonicalPostKey(postA);
  const keyB = getCanonicalPostKey(postB);

  // Neither key should be url_https://www.facebook.com/chery.nguyen.123
  assert.notEqual(keyA, 'url_https://www.facebook.com/chery.nguyen.123');
  assert.notEqual(keyB, 'url_https://www.facebook.com/chery.nguyen.123');

  // Key A and Key B must be distinct so Post B is NOT rejected as a duplicate of Post A
  assert.notEqual(keyA, keyB);
  assert.ok(keyA.startsWith('sig_chery nguyễn_'));
  assert.ok(keyB.startsWith('sig_chery nguyễn_'));
});

test('SEARCH-P0-013: getCleanCanonicalFacebookUrl separates postLink and profileLink correctly', () => {
  // If postLink is empty, it should return empty, not fallback to profile link
  const emptyPostLink = getCleanCanonicalFacebookUrl('');
  assert.equal(emptyPostLink, '');

  const validPostLink = getCleanCanonicalFacebookUrl('https://www.facebook.com/quan.an.ngon/posts/123456?__cft__=489');
  assert.equal(validPostLink, 'https://www.facebook.com/quan.an.ngon/posts/123456');
});
