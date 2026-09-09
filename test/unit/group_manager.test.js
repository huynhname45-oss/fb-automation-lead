import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import GroupManager from '../../src/core/group-manager.js';

test('GroupManager.normalizeGroup accurately cleanses and normalizes group data', () => {
  // 1. Graph API object
  const graphRaw = {
    id: '1234567890',
    name: 'Hội Chủ Quán Trà Sữa & Cafe Sài Gòn',
    privacy: 'OPEN',
    members_count: 45000,
    picture: { data: { url: 'https://fbcdn.net/avatar.jpg' } }
  };
  const normGraph = GroupManager.normalizeGroup(graphRaw);
  assert.equal(normGraph.id, '1234567890');
  assert.equal(normGraph.name, 'Hội Chủ Quán Trà Sữa & Cafe Sài Gòn');
  assert.equal(normGraph.privacy, 'Công khai');
  assert.equal(normGraph.membersCount, 45000);
  assert.equal(normGraph.avatar, 'https://fbcdn.net/avatar.jpg');
  assert.equal(normGraph.url, 'https://www.facebook.com/groups/1234567890/');

  // 2. Private group
  const privateRaw = {
    id: '9988776655',
    name: 'Nhóm Kín Bán Hàng Online',
    privacy: 'SECRET',
    members_count: 1200
  };
  const normPriv = GroupManager.normalizeGroup(privateRaw);
  assert.equal(normPriv.privacy, 'Riêng tư');

  // 3. Fallback and edge cases
  const emptyRaw = {};
  const normEmpty = GroupManager.normalizeGroup(emptyRaw);
  assert.equal(normEmpty.id, '');
  assert.equal(normEmpty.name, '');
  assert.equal(normEmpty.privacy, 'Công khai');
  assert.equal(normEmpty.membersCount, null);
});

test('GroupManager.exportToExcelBuffer produces a styled and valid Excel workbook', async () => {
  const sampleGroups = [
    {
      id: '1001',
      name: 'Nhóm 1: Sang Nhượng Quán Ăn Hà Nội',
      privacy: 'Công khai',
      membersCount: 25000,
      url: 'https://www.facebook.com/groups/1001/'
    },
    {
      id: '1002',
      name: 'Nhóm 2: Hội Mở Quán Cafe Việt Nam',
      privacy: 'Riêng tư',
      membersCount: 15000,
      url: 'https://www.facebook.com/groups/1002/'
    }
  ];

  const buffer = await GroupManager.exportToExcelBuffer(sampleGroups);
  assert.ok(buffer && buffer.length > 0, 'Buffer must not be empty');

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const sheet = wb.getWorksheet('Danh Sách Nhóm Đã Tham Gia');
  assert.ok(sheet, 'Worksheet "Danh Sách Nhóm Đã Tham Gia" must exist');

  // Verify headers
  const headerValues = sheet.getRow(1).values.slice(1);
  assert.deepEqual(headerValues, [
    'STT',
    'Tên Nhóm Facebook',
    'ID Nhóm (Group ID)',
    'Quyền Riêng Tư',
    'Số Lượng Thành Viên',
    'Liên Kết Nhóm (URL)'
  ]);

  // Verify Row 2
  const row2 = sheet.getRow(2);
  assert.equal(row2.getCell(1).value, 1);
  assert.equal(row2.getCell(2).value, 'Nhóm 1: Sang Nhượng Quán Ăn Hà Nội');
  assert.equal(row2.getCell(3).value, '1001');
  assert.equal(row2.getCell(4).value, 'Công khai');
  assert.equal(row2.getCell(6).value, 'https://www.facebook.com/groups/1001/');

  // Verify Row 3
  const row3 = sheet.getRow(3);
  assert.equal(row3.getCell(1).value, 2);
  assert.equal(row3.getCell(2).value, 'Nhóm 2: Hội Mở Quán Cafe Việt Nam');
  assert.equal(row3.getCell(3).value, '1002');
  assert.equal(row3.getCell(4).value, 'Riêng tư');
});

test('GroupManager.normalizeGroup correctly handles vanity slug and privacy flags', () => {
  const vanityGroup = {
    id: 'phanmemquanly0362790270',
    name: 'THANH LÝ PHẦN MỀM BÁN HÀNG',
    privacy: 'Nhóm kín',
    membersCount: 12500
  };
  const norm = GroupManager.normalizeGroup(vanityGroup);
  assert.equal(norm.id, 'phanmemquanly0362790270');
  assert.equal(norm.slug, 'phanmemquanly0362790270');
  assert.equal(norm.privacy, 'Riêng tư');
  assert.equal(norm.membersCount, 12500);

  const numericGroup = {
    id: '1750490916315535',
    name: 'KẾ TOÁN PHẦN MỀM BÁN HÀNG',
    privacy: 'Nhóm công khai'
  };
  const normNumeric = GroupManager.normalizeGroup(numericGroup);
  assert.equal(normNumeric.id, '1750490916315535');
  assert.equal(normNumeric.slug, '');
  assert.equal(normNumeric.privacy, 'Công khai');
});

test('GroupManager.resolveNumericGroupId returns numeric ID immediately if already digits', async () => {
  const result = await GroupManager.resolveNumericGroupId('1750490916315535');
  assert.equal(result, '1750490916315535');
});

test('GroupManager.resolveNumericGroupId caches resolved slugs', async () => {
  GroupManager._slugCache.set('test_vanity_slug_123', '9876543210');
  const result = await GroupManager.resolveNumericGroupId('test_vanity_slug_123');
  assert.equal(result, '9876543210');
});
