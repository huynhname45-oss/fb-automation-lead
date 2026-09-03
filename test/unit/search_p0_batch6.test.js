import test from 'node:test';
import assert from 'node:assert/strict';

import { 
  normalizeProvinceName, 
  extractLocationDetailed, 
  extractLocationFromText 
} from '../../src/core/location-extractor.js';

// =========================================================================
// SEARCH-P0-010 Tests: Vietnam Province Normalization & Source Separation
// =========================================================================
test('SEARCH-P0-010: normalizeProvinceName maps aliases, abbreviations, and major cities to canonical names', () => {
  // TP. Hồ Chí Minh aliases
  assert.equal(normalizeProvinceName('tphcm'), 'TP. Hồ Chí Minh');
  assert.equal(normalizeProvinceName('Sài Gòn'), 'TP. Hồ Chí Minh');
  assert.equal(normalizeProvinceName('Thủ Đức'), 'TP. Hồ Chí Minh');
  assert.equal(normalizeProvinceName('Quận 1'), 'TP. Hồ Chí Minh');

  // Hà Nội aliases
  assert.equal(normalizeProvinceName('hanoi'), 'Hà Nội');
  assert.equal(normalizeProvinceName('Cầu Giấy'), 'Hà Nội');

  // Other major provinces & key cities
  assert.equal(normalizeProvinceName('Biên Hòa'), 'Đồng Nai');
  assert.equal(normalizeProvinceName('Thủ Dầu Một'), 'TP. Hồ Chí Minh');
  assert.equal(normalizeProvinceName('Vũng Tàu'), 'TP. Hồ Chí Minh');
  assert.equal(normalizeProvinceName('Nha Trang'), 'Khánh Hòa');
  assert.equal(normalizeProvinceName('Đà Lạt'), 'Lâm Đồng');
  assert.equal(normalizeProvinceName('Buôn Ma Thuột'), 'Đắk Lắk');
  assert.equal(normalizeProvinceName('Huế'), 'Huế');

  // Unparseable / empty
  assert.equal(normalizeProvinceName(''), '—');
  assert.equal(normalizeProvinceName('khong biet o dau'), '—');
});

test('SEARCH-P0-010: extractLocationDetailed prioritizes post content over author display name', () => {
  // Author name mentions "Hà Nội" (e.g. brand name), but post content explicitly states opening in "Quận 3, TP.HCM"
  const res = extractLocationDetailed({
    authorName: 'Bún Chả Hà Nội Gia Truyền',
    content: 'TƯNG BỪNG KHAI TRƯƠNG CHI NHÁNH MỚI TẠI SỐ 45 ĐƯỜNG LÊ VĂN SỸ QUẬN 3 TP.HCM'
  });

  assert.equal(res.province, 'TP. Hồ Chí Minh', 'Content address must take precedence over author name');
  assert.equal(res.source, 'content');
  assert.equal(res.confidence, 0.95);
});

test('SEARCH-P0-010: extractLocationDetailed falls back to author name location when content has no address', () => {
  const res = extractLocationDetailed({
    authorName: 'Trà Sữa Nhà Làm Biên Hòa',
    content: 'Tuyển nhân viên phụ quán ca tối lương thưởng hấp dẫn'
  });

  assert.equal(res.province, 'Đồng Nai');
  assert.equal(res.source, 'author_name');
});

test('SEARCH-P0-010: extractLocationFromText returns normalized province name string', () => {
  const locStr = extractLocationFromText({
    authorName: 'Shop Quần Áo',
    content: 'Giao hàng tận nơi tại Đà Nẵng freeship đơn từ 200k'
  });

  assert.equal(locStr, 'Đà Nẵng');
});
