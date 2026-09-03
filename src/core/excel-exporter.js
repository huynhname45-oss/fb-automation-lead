import ExcelJS from 'exceljs';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import logger from './logger.js';
import configManager from './config-manager.js';

const EXPORTS_DIR = path.join(process.cwd(), 'exports');
const TEMPLATE_FILE = path.join(process.cwd(), 'template_import_lead.xlsx');

export const DEFAULT_IMPORT_CONFIG = {
  provinceCode: '__export__.res_province_121_cf34d119',
  productGroup: 'RETAIL_PRO',
  salesRep: 'trucnt@sapo.vn'
};

const TEMPLATE_HEADERS = [
  'Tên cơ hội',
  'Số điện thoại',
  'Tên đăng nhập / Email',
  'Quốc gia',
  'Tỉnh/Thành phố',
  'Quận/Huyện',
  'Phường/Xã',
  'Nhóm gói sản phẩm',
  'Mô tả',
  'Lead level',
  'UTM Content',
  'UTM Source',
  'UTM Medium',
  'Chiến dịch UTM',
  'Nhân viên kinh doanh',
  'Mã quảng cáo',
  'Số lượng nhân viên',
  'Lĩnh vực kinh doanh',
  'Kênh bán hàng chính',
  'Đánh giá'
];

/**
 * Export qualified leads to Excel matching the exact format of template_import_lead.xlsx
 */
export async function exportToExcel(posts = [], filename, customConfig = {}) {
  try {
    await fs.mkdir(EXPORTS_DIR, { recursive: true });

    const savedExportConfig = configManager.get('exportConfig') || {};
    const provinceCode = customConfig.provinceCode || savedExportConfig.provinceCode || DEFAULT_IMPORT_CONFIG.provinceCode;
    const productGroup = customConfig.productGroup || savedExportConfig.productGroup || DEFAULT_IMPORT_CONFIG.productGroup;
    const salesRep = customConfig.salesRep || savedExportConfig.salesRep || DEFAULT_IMPORT_CONFIG.salesRep;

    const workbook = new ExcelJS.Workbook();
    let dataSheet;

    if (existsSync(TEMPLATE_FILE)) {
      logger.info(`Đang tải template mẫu từ: ${TEMPLATE_FILE}`);
      await workbook.xlsx.readFile(TEMPLATE_FILE);
      dataSheet = workbook.getWorksheet('Nhập dữ liệu');

      if (dataSheet) {
        // Clear previous sample rows (from row 2 to end)
        const totalRows = dataSheet.rowCount;
        for (let r = totalRows; r >= 2; r--) {
          dataSheet.spliceRows(r, 1);
        }
      }
    }

    // Fallback if template file is missing or has no "Nhập dữ liệu" sheet
    if (!dataSheet) {
      logger.warn('Không tìm thấy template_import_lead.xlsx, tự động tạo cấu trúc chuẩn tương đương...');
      dataSheet = workbook.addWorksheet('Nhập dữ liệu', {
        views: [{ state: 'frozen', ySplit: 1 }]
      });

      // Add standard headers
      dataSheet.addRow(TEMPLATE_HEADERS);
      const headerRow = dataSheet.getRow(1);
      headerRow.font = { bold: true, size: 11, color: { theme: 1 }, name: 'Arial', family: 2, scheme: 'minor' };
      headerRow.alignment = { vertical: 'middle' };
      headerRow.height = 24;

      // Highlight mandatory fields with red background (cols 5, 8, 15)
      [5, 8, 15].forEach(colIndex => {
        headerRow.getCell(colIndex).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFF0000' },
          bgColor: { indexed: 64 }
        };
      });

      // Set standard column widths
      TEMPLATE_HEADERS.forEach((h, idx) => {
        dataSheet.getColumn(idx + 1).width = Math.max(h.length + 5, 18);
      });

      // Add auxiliary sheets
      workbook.addWorksheet('Sheet1');
      const guideSheet = workbook.addWorksheet('Hướng dẫn');
      guideSheet.addRow(['Lĩnh vực kinh doanh', 'Đánh giá', 'Nhân viên kinh doanh']);
      guideSheet.getRow(1).font = { bold: true, name: 'Arial', size: 11 };
    }

    // Populate data rows for each lead
    posts.forEach(post => {
      let phone = '';
      if (Array.isArray(post.verifiedPhones) && post.verifiedPhones.length > 0) {
        phone = post.verifiedPhones[0];
      } else if (Array.isArray(post.phones) && post.phones.length > 0) {
        phone = post.phones[0];
      } else if (typeof post.phone === 'string') {
        phone = post.phone;
      }
      phone = String(phone || '').replace(/[^0-9+]/g, '').trim();

      const rowValues = [
        post.authorName || '',                 // 1. Tên cơ hội (Tên người đăng)
        phone || null,                         // 2. Số điện thoại
        null,                                  // 3. Tên đăng nhập / Email (để trống)
        null,                                  // 4. Quốc gia (để trống)
        provinceCode,                          // 5. Tỉnh/Thành phố (giữ nguyên)
        null,                                  // 6. Quận/Huyện (để trống)
        null,                                  // 7. Phường/Xã (để trống)
        productGroup,                          // 8. Nhóm gói sản phẩm (giữ nguyên)
        null,                                  // 9. Mô tả (để trống)
        null,                                  // 10. Lead level (để trống)
        null,                                  // 11. UTM Content (để trống)
        null,                                  // 12. UTM Source (để trống)
        null,                                  // 13. UTM Medium (để trống)
        null,                                  // 14. Chiến dịch UTM (để trống)
        salesRep,                              // 15. Nhân viên kinh doanh (giữ nguyên)
        null,                                  // 16. Mã quảng cáo (để trống)
        null,                                  // 17. Số lượng nhân viên (để trống)
        null,                                  // 18. Lĩnh vực kinh doanh (để trống)
        null,                                  // 19. Kênh bán hàng chính (để trống)
        null                                   // 20. Đánh giá (để trống)
      ];

      const newRow = dataSheet.addRow(rowValues);
      newRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.font = { name: 'Arial', size: 11 };
        if (colNumber === 2 && phone) {
          cell.numFmt = '@'; // Format phone as Text so leading zero is preserved
        }
      });
    });

    const filePath = path.join(EXPORTS_DIR, filename);
    await workbook.xlsx.writeFile(filePath);

    logger.info(`Excel file exported successfully matching template_import_lead.xlsx: ${filePath} (${posts.length} records)`);
    return filePath;
  } catch (error) {
    logger.error({ err: error }, 'Failed to export Excel file');
    throw error;
  }
}
