import test from 'node:test';
import assert from 'node:assert/strict';
import leadFilter from '../../src/core/lead-filter.js';
import { getCanonicalAuthorKey, extractUidFromUrl } from '../../src/core/search-engine.js';

// =========================================================================
// TELECOM & ENTERPRISE CHAIN REJECTION TESTS
// =========================================================================
test('TELECOM-001: Khách Hàng Thân Thiết FPT Telecom is strictly rejected as enterprise chain', () => {
  const fptPost = {
    authorName: 'Khách Hàng Thân Thiết FPT Telecom',
    content: 'Tri ân khách hàng thân thiết FPT Telecom, đăng ký gói cước cáp quang siêu tốc nhận ưu đãi khủng...',
    phones: []
  };

  const res = leadFilter.evaluateLead(fptPost, { excludeEnterpriseChains: true });
  assert.equal(res.qualified, false, 'FPT Telecom must be rejected');
  assert.equal(res.leadQuality, 'rejected');
  assert.equal(res.qualityBadge, 'Chuỗi lớn');
  assert.equal(res.category, 'enterprise_chain');
});

test('TELECOM-002: Viettel, VNPT, MobiFone are strictly rejected as enterprise chains', () => {
  const viettelPost = {
    authorName: 'Viettel Telecom An Giang',
    content: 'Chương trình khuyến mãi lắp đặt internet Viettel...',
    phones: ['0981234567']
  };
  const resViettel = leadFilter.evaluateLead(viettelPost, { excludeEnterpriseChains: true });
  assert.equal(resViettel.qualified, false);
  assert.equal(resViettel.leadQuality, 'rejected');

  const vnptPost = {
    authorName: 'Trung Tâm Kinh Doanh VNPT VinaPhone',
    content: 'Đăng ký sim số đẹp VinaPhone...',
    phones: ['0912345678']
  };
  const resVnpt = leadFilter.evaluateLead(vnptPost, { excludeEnterpriseChains: true });
  assert.equal(resVnpt.qualified, false);
  assert.equal(resVnpt.leadQuality, 'rejected');
});

test('TELECOM-003: Authentic store with FPT landmark is preserved as qualified lead', () => {
  const cafePost = {
    authorName: 'Tiệm Trà & Cafe Genz',
    content: 'Khai trương tiệm trà tại 45 Nguyễn Huệ, đối diện trường FPT. Giảm giá 20% toàn bộ menu. Hotline: 0983123456',
    phones: ['0983123456']
  };

  const res = leadFilter.evaluateLead(cafePost, { excludeEnterpriseChains: true });
  assert.equal(res.qualified, true, 'Store with FPT landmark must be qualified');
  assert.equal(res.leadQuality, 'high');
});

// =========================================================================
// PHONE & AUTHOR DEDUPLICATION TESTS
// =========================================================================
test('DEDUP-001: getCanonicalAuthorKey unifies group user URLs across different groups', () => {
  const postGroupA = {
    authorName: 'Kim Quyên',
    profileLink: 'https://www.facebook.com/groups/123456789/user/100088997766554'
  };

  const postGroupB = {
    authorName: 'Kim Quyên',
    profileLink: 'https://www.facebook.com/groups/987654321/user/100088997766554'
  };

  const postDirectProfile = {
    authorName: 'Kim Quyên',
    profileLink: 'https://www.facebook.com/profile.php?id=100088997766554'
  };

  const keyA = getCanonicalAuthorKey(postGroupA);
  const keyB = getCanonicalAuthorKey(postGroupB);
  const keyDirect = getCanonicalAuthorKey(postDirectProfile);

  assert.equal(keyA, 'author_id_100088997766554');
  assert.equal(keyB, 'author_id_100088997766554');
  assert.equal(keyDirect, 'author_id_100088997766554');
  assert.equal(keyA, keyB, 'Both group posts from same user must have identical author key');
});

test('DEDUP-002: extractUidFromUrl extracts UID correctly across various formats', () => {
  assert.equal(extractUidFromUrl('https://www.facebook.com/groups/abc/user/100088997766554'), '100088997766554');
  assert.equal(extractUidFromUrl('https://www.facebook.com/groups/abc/member/100088997766554'), '100088997766554');
  assert.equal(extractUidFromUrl('https://www.facebook.com/profile.php?id=100088997766554'), '100088997766554');
  assert.equal(extractUidFromUrl('https://www.facebook.com/people/Kim-Quyen/100088997766554'), '100088997766554');
});
