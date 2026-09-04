import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyPhoneType, isAllowedPhoneType } from '../../src/core/phone-validator.js';
import leadFilter from '../../src/core/lead-filter.js';

// =========================================================================
// SEARCH-P0-007 Tests: Accurate Phone Type Classification (mobile, landline, hotline, invalid)
// =========================================================================
test('SEARCH-P0-007: classifyPhoneType accurately distinguishes mobile, landline, hotline, and invalid', () => {
  // Mobile numbers (03x, 05x, 07x, 08x, 09x)
  assert.equal(classifyPhoneType('0912345678'), 'mobile');
  assert.equal(classifyPhoneType('0988776655'), 'mobile');
  assert.equal(classifyPhoneType('+84903123456'), 'mobile');
  assert.equal(classifyPhoneType('0354123456'), 'mobile');
  assert.equal(classifyPhoneType('0798123456'), 'mobile');
  assert.equal(classifyPhoneType('0868123456'), 'mobile');
  assert.equal(classifyPhoneType('0568123456'), 'mobile');

  // Landline numbers (02x - 11 digits)
  assert.equal(classifyPhoneType('02438889999'), 'landline'); // Hanoi
  assert.equal(classifyPhoneType('02839998888'), 'landline'); // HCMC
  assert.equal(classifyPhoneType('02513888999'), 'landline'); // Dong Nai

  // Toll-Free / Hotlines (1800, 1900)
  assert.equal(classifyPhoneType('19001080'), 'hotline');
  assert.equal(classifyPhoneType('18006601'), 'hotline');
  assert.equal(classifyPhoneType('19006067'), 'hotline');

  // Invalid formats / Junk numbers
  assert.equal(classifyPhoneType(''), 'invalid');
  assert.equal(classifyPhoneType('12345'), 'invalid');
  assert.equal(classifyPhoneType('0900000000'), 'invalid'); // Repeated suffix
  assert.equal(classifyPhoneType('0123456789'), 'invalid'); // Dummy sequential
});

test('SEARCH-P0-007: leadFilter with requireMobilePhoneOnly rejects non-mobile-only lists and accepts mobile lists', () => {
  const filterConfig = { requireMobilePhoneOnly: true };

  // Post with ONLY toll-free hotline -> Rejected
  const tollFreeOnly = leadFilter.evaluateLead({
    authorName: 'Tổng Đài CSKH',
    content: 'Liên hệ tổng đài để được tư vấn',
    phones: ['19001080']
  }, filterConfig);
  assert.equal(tollFreeOnly.qualified, false);
  assert.ok(tollFreeOnly.reason.includes('không có số di động cá nhân'));

  // Post with ONLY landline number -> Rejected when mobile only is required
  const landlineOnly = leadFilter.evaluateLead({
    authorName: 'Văn Phòng Công Ty',
    content: 'Liên hệ phòng kinh doanh',
    phones: ['02438889999']
  }, filterConfig);
  assert.equal(landlineOnly.qualified, false);
  assert.ok(landlineOnly.reason.includes('không có số di động cá nhân'));

  // Post with valid mobile phone -> Accepted
  const mobilePost = leadFilter.evaluateLead({
    authorName: 'Quán Cafe ABC',
    content: 'Tưng bừng khai trương quán cafe',
    phones: ['0912345678']
  }, filterConfig);
  assert.equal(mobilePost.qualified, true);

  // Post with both hotline AND personal mobile -> Accepted
  const mixedPost = leadFilter.evaluateLead({
    authorName: 'Tiệm Bánh Mì',
    content: 'Đặt hàng bánh mì qua hotline hoặc Zalo',
    phones: ['19001080', '0912345678']
  }, filterConfig);
  assert.equal(mixedPost.qualified, true);
});

// =========================================================================
// SEARCH-P0-006 Tests: No Presentation / Exporter Regex Fallbacks
// =========================================================================
test('SEARCH-P0-006: Excel Exporter does NOT run regex on content when post.phones is empty', async () => {
  // Read excel-exporter source code to assert that extractPhoneNumbers function is removed
  const fs = await import('fs/promises');
  const exporterSource = await fs.readFile('src/core/excel-exporter.js', 'utf-8');
  assert.equal(exporterSource.includes('function extractPhoneNumbers'), false, 'extractPhoneNumbers must be removed from excel-exporter.js');
  assert.equal(exporterSource.includes('extractPhoneNumbers('), false, 'No fallback regex call in excel-exporter.js');

  const appJsSource = await fs.readFile('public/js/app.js', 'utf-8');
  assert.equal(appJsSource.includes('function extractPhoneNumbers'), false, 'extractPhoneNumbers must be removed from app.js');
  assert.equal(appJsSource.includes('extractPhoneNumbers('), false, 'No fallback regex call in app.js');
});

test('leadFilter rejects enterprise chains including GO Việt Nam and Siêu thị GO', () => {
  const goPost = leadFilter.evaluateLead({
    authorName: 'GO Việt Nam',
    content: 'Chương trình khuyến mãi hè siêu hot tại GO Việt Nam'
  });
  assert.equal(goPost.qualified, false);
  assert.equal(goPost.category, 'enterprise_chain');

  const sieuThiGoPost = leadFilter.evaluateLead({
    authorName: 'Siêu Thị GO!',
    content: 'Khai trương cơ sở mới'
  });
  assert.equal(sieuThiGoPost.qualified, false);
  assert.equal(sieuThiGoPost.category, 'enterprise_chain');
});

test('extractUidFromUrl and buildProfileSearchUrl generate exact profile/{UID}/search/?q= format', async () => {
  const { buildProfileSearchUrl, extractUidFromUrl } = await import('../../src/core/search-engine.js');

  // Direct UID
  assert.equal(extractUidFromUrl('100026785061078'), '100026785061078');
  assert.equal(extractUidFromUrl('https://www.facebook.com/profile.php?id=100026785061078'), '100026785061078');
  assert.equal(extractUidFromUrl('https://www.facebook.com/people/Nguyen-Van-A/100026785061078/'), '100026785061078');
  assert.equal(extractUidFromUrl('https://www.facebook.com/groups/vieclamcantho/user/100026785061078/'), '100026785061078');

  // Search URL generation from ID
  assert.equal(
    buildProfileSearchUrl('https://www.facebook.com/profile.php?id=100026785061078', 'lh'),
    'https://www.facebook.com/profile/100026785061078/search/?q=lh'
  );

  assert.equal(
    buildProfileSearchUrl('https://www.facebook.com/groups/vieclamcantho/user/100026785061078/', 'lh'),
    'https://www.facebook.com/profile/100026785061078/search/?q=lh'
  );

  assert.equal(
    buildProfileSearchUrl('100026785061078', 'sđt'),
    'https://www.facebook.com/profile/100026785061078/search/?q=s%C4%91t'
  );
});

test('cleanOCRDigits cleans digit substitutions and extracts valid phones', async () => {
  const { cleanOCRDigits } = await import('../../src/core/ocr-manager.js');
  const { extractPhonesFromText } = await import('../../src/core/phone-validator.js');

  const rawOcr = 'LH: O912.345.678 hoac 0988.l23.456';
  const cleaned = cleanOCRDigits(rawOcr);
  const phones = extractPhonesFromText(cleaned, { isOCR: true });

  assert.deepEqual(phones, ['0912345678', '0988123456']);
});

test('resolveTimeResult strictly flags 1 day and > 24h as outside 24h window', async () => {
  const { resolveTimeResult } = await import('../../src/core/search-engine.js');

  const post2Hours = resolveTimeResult({ timeText: '2 giờ', recencyHours: 24 });
  assert.equal(post2Hours.withinRequestedWindow, true);
  assert.equal(post2Hours.isWithin24h, true);

  const post1Day = resolveTimeResult({ timeText: '1 ngày', recencyHours: 24 });
  assert.equal(post1Day.withinRequestedWindow, false);
  assert.equal(post1Day.isWithin24h, false);

  const post3Days = resolveTimeResult({ timeText: '3 ngày trước', recencyHours: 24 });
  assert.equal(post3Days.withinRequestedWindow, false);
  assert.equal(post3Days.isWithin24h, false);

  // Calendar dates like '1 tháng 9 lúc 10:49' when now is September 3, 2026
  const refDate = new Date('2026-09-03T20:54:25+07:00');
  const postSept1 = resolveTimeResult({ timeText: '1 tháng 9 lúc 10:49', recencyHours: 24, now: refDate });
  assert.equal(postSept1.withinRequestedWindow, false, '1 tháng 9 must be rejected when today is 3 tháng 9');
  assert.equal(postSept1.isWithin24h, false);

  // Today post '3 tháng 9 lúc 10:00'
  const postToday = resolveTimeResult({ timeText: '3 tháng 9 lúc 10:00', recencyHours: 24, now: refDate });
  assert.equal(postToday.withinRequestedWindow, true, '3 tháng 9 lúc 10:00 should be within 24h');
  assert.equal(postToday.isWithin24h, true);

  // "Hôm nay lúc 14:00"
  const postHomNay = resolveTimeResult({ timeText: 'Hôm nay lúc 14:00', recencyHours: 24, now: refDate });
  assert.equal(postHomNay.withinRequestedWindow, true);
  assert.equal(postHomNay.isWithin24h, true);
});

test('extractPhonesFromText: accurately extracts paired dotted phone numbers like 0909.04.04.50 without date collision', async () => {
  const { extractPhonesFromText } = await import('../../src/core/phone-validator.js');
  
  const postSnippet = 'Quán cà phê LEO ARABICA tuyển dụng: 📞 Gọi trực tiếp 0909.04.04.50 (Ms. Diễm) - không trả lời tin nhắn';
  const extracted = extractPhonesFromText(postSnippet);
  assert.deepEqual(extracted, ['0909040450']);

  const withDates = 'Khai trương ngày 20/11/2024 hotline: 0909.04.04.50 hoặc 0909-04-04-50';
  const extracted2 = extractPhonesFromText(withDates);
  assert.deepEqual(extracted2, ['0909040450']);
});
