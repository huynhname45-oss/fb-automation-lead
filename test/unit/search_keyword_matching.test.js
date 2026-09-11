import test from 'node:test';
import assert from 'node:assert/strict';
import leadFilter, { matchesSearchKeyword } from '../../src/core/lead-filter.js';

test('SEARCH-KEYWORD-001: Pass open if search keyword is empty or undefined', () => {
  assert.equal(matchesSearchKeyword('', 'Nội dung bất kỳ'), true);
  assert.equal(matchesSearchKeyword(null, 'Nội dung bất kỳ'), true);
  assert.equal(matchesSearchKeyword(undefined, 'Nội dung bất kỳ'), true);
});

test('SEARCH-KEYWORD-002: Exact match accented and unaccented', () => {
  const kw = 'chính thức mở cửa';
  assert.equal(matchesSearchKeyword(kw, 'Hôm nay quán chính thức mở cửa đón khách'), true);
  assert.equal(matchesSearchKeyword(kw, 'Hom nay quan chinh thuc mo cua don khach'), true);
  assert.equal(matchesSearchKeyword('khai trương', 'Tưng bừng khai trương chi nhánh 2'), true);
  assert.equal(matchesSearchKeyword('khai truong', 'Tung bung khai truong co so moi'), true);
});

test('SEARCH-KEYWORD-003: Opening search matches opening intent signals', () => {
  const kw = 'chính thức mở cửa';
  assert.equal(matchesSearchKeyword(kw, 'Tiệm trà sữa May khai trương ngày 15/9, ưu đãi mua 1 tặng 1'), true);
  assert.equal(matchesSearchKeyword(kw, 'Grand opening! Quán bún bò Huế kính mời quý khách'), true);
  assert.equal(matchesSearchKeyword(kw, 'Ngày mai quán mở cửa đón khách từ 7h sáng'), true);
  assert.equal(matchesSearchKeyword(kw, 'Tiệm bánh chính thức mở bán từ tuần này'), true);
  assert.equal(matchesSearchKeyword(kw, 'Quán cafe mới toạ lạc tại Cầu Giấy chính thức hoạt động'), true);
});

test('SEARCH-KEYWORD-004: Strictly reject off-topic posts lacking search keyword (Hoang Phi recruitment post)', () => {
  const kw = 'chính thức mở cửa';
  const hoangPhiPost = `CẦN TUYỂN GẤP NỮ NHÂN VIÊN PHỤC VỤ VS NAM PHỤC VỤ.... TẠI NHÀ HÀNG NĂM LỬA 26 

Mô tả công việc
•Thực hiện quy trình phụ các công việc :
• Phục vụ khách hàng: chăm sóc khách hàng , lên món ăn
• Các công việc theo sự chỉ định quản lý của nhà hàng
Khung giờ:
- Nữ: 16h30-23h30
- Nam: 16h-23h30`;

  assert.equal(matchesSearchKeyword(kw, hoangPhiPost), false);
  assert.equal(leadFilter.matchesSearchKeyword(kw, hoangPhiPost), false);
});

test('SEARCH-KEYWORD-005: Strictly reject personal / generic social posts', () => {
  const kw = 'chính thức mở cửa';
  const socialPost = 'Hôm nay thời tiết đẹp quá mọi người ơi, chúc cả nhà ngày mới vui vẻ';
  assert.equal(matchesSearchKeyword(kw, socialPost), false);

  const salePost = 'Thanh lý tủ đông Sanaky còn bảo hành 6 tháng giá 3 triệu';
  assert.equal(matchesSearchKeyword(kw, salePost), false);
});

test('SEARCH-KEYWORD-006: Multi-token decomposition matches when all tokens are present', () => {
  const kw = 'quán ăn vặt';
  assert.equal(matchesSearchKeyword(kw, 'Chào các bạn, quán trà sữa và ăn vặt của mình chuẩn bị bán'), true);
  assert.equal(matchesSearchKeyword(kw, 'Tuyển thợ cắt tóc nam lương cao'), false);
});
