import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { exportToExcel, exportToExcelBuffer, DEFAULT_IMPORT_CONFIG } from '../../src/core/excel-exporter.js';

test('Export to Excel: output format matches template_import_lead.xlsx exactly', async () => {
  const samplePosts = [
    { authorName: 'Quán Cháo Cây Thị', verifiedPhones: ['0909965605'] },
    { authorName: 'Tiệm Trà Sữa Cây Si', phones: ['0989613136'] },
    { authorName: 'Tiệm Bánh Không Có Số', verifiedPhones: [] }
  ];

  const testFilename = `test_export_verify_${Date.now()}.xlsx`;
  const exportedPath = await exportToExcel(samplePosts, testFilename);

  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(exportedPath);

    // 1. Verify Worksheets
    assert.equal(wb.worksheets.length >= 3, true, 'Must have at least 3 worksheets');
    const dataSheet = wb.getWorksheet('Nhập dữ liệu');
    assert.ok(dataSheet, 'Must contain "Nhập dữ liệu" worksheet');
    assert.ok(wb.getWorksheet('Sheet1'), 'Must contain "Sheet1" worksheet');
    assert.ok(wb.getWorksheet('Hướng dẫn'), 'Must contain "Hướng dẫn" worksheet');

    // 2. Verify Headers
    const expectedHeaders = [
      'Tên cơ hội', 'Số điện thoại', 'Tên đăng nhập / Email', 'Quốc gia',
      'Tỉnh/Thành phố', 'Quận/Huyện', 'Phường/Xã', 'Nhóm gói sản phẩm',
      'Mô tả', 'Lead level', 'UTM Content', 'UTM Source',
      'UTM Medium', 'Chiến dịch UTM', 'Nhân viên kinh doanh', 'Mã quảng cáo',
      'Số lượng nhân viên', 'Lĩnh vực kinh doanh', 'Kênh bán hàng chính', 'Đánh giá'
    ];
    const headerRowValues = dataSheet.getRow(1).values.slice(1);
    assert.deepEqual(headerRowValues, expectedHeaders, 'Header row must match template columns');

    // 3. Verify Red Fills on Mandatory Columns (5, 8, 15)
    const col5Fill = dataSheet.getRow(1).getCell(5).fill?.fgColor?.argb;
    const col8Fill = dataSheet.getRow(1).getCell(8).fill?.fgColor?.argb;
    const col15Fill = dataSheet.getRow(1).getCell(15).fill?.fgColor?.argb;
    assert.equal(col5Fill, 'FFFF0000', 'Col 5 (Tỉnh/Thành phố) header must be RED');
    assert.equal(col8Fill, 'FFFF0000', 'Col 8 (Nhóm gói sản phẩm) header must be RED');
    assert.equal(col15Fill, 'FFFF0000', 'Col 15 (Nhân viên kinh doanh) header must be RED');

    // 4. Verify Row Count
    assert.equal(dataSheet.rowCount, 4, '1 header row + 3 data rows = 4 rows');

    // 5. Verify Row 2 (Lead 1 with verified phone)
    const row2 = dataSheet.getRow(2).values.slice(1);
    assert.equal(row2[0], 'Quán Cháo Cây Thị', 'Col 1 must be authorName (Tên cơ hội)');
    assert.equal(row2[1], '0909965605', 'Col 2 must be phone number');
    assert.equal(row2[2] == null, true, 'Col 3 (Tên đăng nhập / Email) must be empty');
    assert.equal(row2[3] == null, true, 'Col 4 (Quốc gia) must be empty');
    assert.equal(row2[4], DEFAULT_IMPORT_CONFIG.provinceCode, 'Col 5 must keep provinceCode');
    assert.equal(row2[5] == null, true, 'Col 6 (Quận/Huyện) must be empty');
    assert.equal(row2[6] == null, true, 'Col 7 (Phường/Xã) must be empty');
    assert.equal(row2[7], DEFAULT_IMPORT_CONFIG.productGroup, 'Col 8 must keep productGroup');
    assert.equal(row2[8] == null, true, 'Col 9 (Mô tả) must be empty');
    assert.equal(row2[9] == null, true, 'Col 10 (Lead level) must be empty');
    assert.equal(row2[10] == null, true, 'Col 11 (UTM Content) must be empty');
    assert.equal(row2[11] == null, true, 'Col 12 (UTM Source) must be empty');
    assert.equal(row2[12] == null, true, 'Col 13 (UTM Medium) must be empty');
    assert.equal(row2[13] == null, true, 'Col 14 (Chiến dịch UTM) must be empty');
    assert.equal(row2[14], DEFAULT_IMPORT_CONFIG.salesRep, 'Col 15 must keep salesRep');
    assert.equal(row2[15] == null, true, 'Col 16 (Mã quảng cáo) must be empty');
    assert.equal(row2[16] == null, true, 'Col 17 (Số lượng nhân viên) must be empty');
    assert.equal(row2[17] == null, true, 'Col 18 (Lĩnh vực kinh doanh) must be empty');
    assert.equal(row2[18] == null, true, 'Col 19 (Kênh bán hàng chính) must be empty');
    assert.equal(row2[19] == null, true, 'Col 20 (Đánh giá) must be empty');

    // 6. Verify Row 3 (Lead 2)
    const row3 = dataSheet.getRow(3).values.slice(1);
    assert.equal(row3[0], 'Tiệm Trà Sữa Cây Si');
    assert.equal(row3[1], '0989613136');
    assert.equal(row3[4], DEFAULT_IMPORT_CONFIG.provinceCode);
    assert.equal(row3[7], DEFAULT_IMPORT_CONFIG.productGroup);
    assert.equal(row3[14], DEFAULT_IMPORT_CONFIG.salesRep);

    // 7. Verify Row 4 (Lead 3 without phone)
    const row4 = dataSheet.getRow(4).values.slice(1);
    assert.equal(row4[0], 'Tiệm Bánh Không Có Số');
    assert.equal(row4[1] == null, true, 'Phone must be empty when no phone found');
    assert.equal(row4[4], DEFAULT_IMPORT_CONFIG.provinceCode);
    assert.equal(row4[7], DEFAULT_IMPORT_CONFIG.productGroup);
    assert.equal(row4[14], DEFAULT_IMPORT_CONFIG.salesRep);

  } finally {
    await fs.unlink(exportedPath).catch(() => {});
  }
});

test('Export to Excel Buffer: streams binary workbook in RAM without saving to server disk', async () => {
  const samplePosts = [
    { authorName: 'Quán Cafe Client Mac', verifiedPhones: ['0912345678'] }
  ];

  const buffer = await exportToExcelBuffer(samplePosts, {
    provinceCode: 'TEST_PROVINCE',
    productGroup: 'TEST_GROUP',
    salesRep: 'mac_user@company.com'
  });

  assert.ok(Buffer.isBuffer(buffer) || buffer instanceof Uint8Array, 'Must return binary buffer');
  assert.ok(buffer.length > 1000, 'Excel buffer must have valid non-empty size');

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const dataSheet = wb.getWorksheet('Nhập dữ liệu');
  assert.ok(dataSheet, 'Must contain "Nhập dữ liệu" worksheet');
  assert.equal(dataSheet.rowCount, 2, 'Header row + 1 data row');

  const row2 = dataSheet.getRow(2).values.slice(1);
  assert.equal(row2[0], 'Quán Cafe Client Mac');
  assert.equal(row2[1], '0912345678');
  assert.equal(row2[4], 'TEST_PROVINCE');
  assert.equal(row2[7], 'TEST_GROUP');
  assert.equal(row2[14], 'mac_user@company.com');
});
