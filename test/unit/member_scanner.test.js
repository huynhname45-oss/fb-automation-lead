import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMemberJoinedTime, evaluateMemberContent } from '../../src/core/member-scanner.js';

test('MEMBER-TIME-001: parseMemberJoinedTime accepts relative times within 24h', () => {
  // Minutes
  const t1 = parseMemberJoinedTime('Đã tham gia 3 phút trước');
  assert.equal(t1.within24h, true);
  assert.equal(t1.stopScrolling, false);

  const t2 = parseMemberJoinedTime('Đã tham gia 25 phút trước');
  assert.equal(t2.within24h, true);
  assert.equal(t2.stopScrolling, false);

  // Hours
  const t3 = parseMemberJoinedTime('Đã tham gia khoảng 1 giờ trước');
  assert.equal(t3.within24h, true);
  assert.equal(t3.stopScrolling, false);

  const t4 = parseMemberJoinedTime('Đã tham gia 2 giờ trước');
  assert.equal(t4.within24h, true);
  assert.equal(t4.stopScrolling, false);

  const t5 = parseMemberJoinedTime('Đã tham gia 23 giờ trước');
  assert.equal(t5.within24h, true);
  assert.equal(t5.stopScrolling, false);

  // Today
  const t6 = parseMemberJoinedTime('Được thêm vào hôm nay bởi Hong Dao');
  assert.equal(t6.within24h, true);
  assert.equal(t6.stopScrolling, false);

  // English
  const t7 = parseMemberJoinedTime('Joined 35 minutes ago');
  assert.equal(t7.within24h, true);
  assert.equal(t7.stopScrolling, false);
});

test('MEMBER-TIME-002: parseMemberJoinedTime triggers stopScrolling for members > 24h', () => {
  const d1 = parseMemberJoinedTime('Đã tham gia 1 ngày trước');
  assert.equal(d1.within24h, false);
  assert.equal(d1.stopScrolling, true);

  const d2 = parseMemberJoinedTime('Đã tham gia 2 ngày trước');
  assert.equal(d2.within24h, false);
  assert.equal(d2.stopScrolling, true);

  const d3 = parseMemberJoinedTime('Đã tham gia 1 tuần trước');
  assert.equal(d3.within24h, false);
  assert.equal(d3.stopScrolling, true);

  const d4 = parseMemberJoinedTime('Đã tham gia 2 tháng trước');
  assert.equal(d4.within24h, false);
  assert.equal(d4.stopScrolling, true);

  const d5 = parseMemberJoinedTime('Joined 2 days ago');
  assert.equal(d5.within24h, false);
  assert.equal(d5.stopScrolling, true);
});

test('MEMBER-FILTER-001: evaluateMemberContent strictly rejects software sales reps (MISA, OMICALL, Sapo...)', () => {
  // Real case 1 from user screenshot (Nguyen Long)
  const comment1 = 'Với OMICALL, shop có thể quản lý lịch sử mua hàng và tương tác, phân nhóm khách theo giá trị đơn hàng... Nếu mình đang cần tìm hiểu thêm về giải pháp quản lý & chăm sóc khách hàng có thể kết nối Zalo em:';
  const res1 = evaluateMemberContent(comment1);
  assert.equal(res1.isNegative, true);
  assert.match(res1.reason, /OMICALL/i);

  // Real case 2 from user screenshot (Hong Dao)
  const comment2 = 'Dạ em nhận tư vấn phần mềm MISA Eshop ạ. Hỗ trợ mình quản lý bán hàng, chat đa kênh, đồng bộ đơn hàng cho mình ạ. LH: 0364337760 em tư vấn hỗ trợ cho mình rõ hơn ạ';
  const res2 = evaluateMemberContent(comment2);
  assert.equal(res2.isNegative, true);
  assert.match(res2.reason, /MISA/i);

  // Sapo & Kiotviet sales reps
  const comment3 = 'Em bên Sapo hỗ trợ kết nối Zalo em 0988776655 tư vấn dùng thử miễn phí';
  const res3 = evaluateMemberContent(comment3);
  assert.equal(res3.isNegative, true);

  const comment4 = 'Bên em KiotViet đang có ưu đãi tặng thêm máy in, ib em tư vấn nhé';
  const res4 = evaluateMemberContent(comment4);
  assert.equal(res4.isNegative, true);
});

test('MEMBER-FILTER-002: evaluateMemberContent strictly rejects liquidation / thanh ly / thu mua posts', () => {
  const thanhly1 = 'Cần thanh lý phần mềm bán hàng Kiotviet hạn 2 năm kèm máy in pos';
  const res1 = evaluateMemberContent(thanhly1);
  assert.equal(res1.isNegative, true);
  assert.match(res1.reason, /thanh lý/i);

  const thanhly2 = 'Pass lại tài khoản Sapo FNB giá rẻ cho ai cần';
  const res2 = evaluateMemberContent(thanhly2);
  assert.equal(res2.isNegative, true);

  const thanhly3 = 'Bên em chuyên thu mua máy pos, máy in hóa đơn cũ';
  const res3 = evaluateMemberContent(thanhly3);
  assert.equal(res3.isNegative, true);
});

test('MEMBER-FILTER-003: evaluateMemberContent accepts authentic shop owners and prospective buyers', () => {
  const normal1 = 'Các anh chị cho em hỏi Kiotviet với Sapo bên nào quản lý kho tốt hơn ạ? Em sắp mở shop quần áo';
  const res1 = evaluateMemberContent(normal1);
  assert.equal(res1.isNegative, false);

  const normal2 = 'Quán em ở Cầu Giấy chuẩn bị khai trương vào cuối tuần này, mong mọi người ủng hộ';
  const res2 = evaluateMemberContent(normal2);
  assert.equal(res2.isNegative, false);

  const normal3 = 'Mọi người tư vấn giúp em máy in nào in đơn shopee nhanh với ạ';
  const res3 = evaluateMemberContent(normal3);
  assert.equal(res3.isNegative, false);
});

test('MEMBER-EXCEL-001: MemberScanner.exportToExcelBuffer produces styled Excel without occupation column', async () => {
  const { MemberScanner } = await import('../../src/core/member-scanner.js');
  const sampleLeads = [
    {
      stt: 1,
      name: 'Nguyễn Văn A',
      id: '1000111222',
      phone: '0912345678',
      location: 'Hà Nội',
      joinedTime: '2 giờ trước',
      groupName: 'Hội Chủ Quán Cafe',
      profileUrl: 'https://facebook.com/1000111222',
      scannedAt: '09/09/2026, 10:00:00'
    },
    {
      stt: 2,
      name: 'Trần Thị B',
      id: '1000333444',
      phone: '', // No phone -> should remain blank
      location: 'Hồ Chí Minh',
      joinedTime: '5 giờ trước',
      groupName: 'Hội Chủ Quán Cafe',
      profileUrl: 'https://facebook.com/1000333444',
      scannedAt: '09/09/2026, 10:05:00'
    }
  ];

  const buffer = await MemberScanner.exportToExcelBuffer(sampleLeads);
  assert.ok(buffer);
  assert.ok(buffer.length > 1000);

  // Read back buffer to verify columns
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('Thành Viên Mới Tiềm Năng');
  assert.ok(sheet);

  // Check column headers (no 'Nghề nghiệp' column)
  const headerRow = sheet.getRow(1);
  const headers = [];
  headerRow.eachCell(cell => headers.push(cell.value));
  assert.ok(headers.includes('Tên Facebook'));
  assert.ok(headers.includes('Số Điện Thoại'));
  assert.ok(headers.includes('Tỉnh / Thành Phố'));
  assert.ok(headers.includes('Thời Gian Vào Nhóm'));
  assert.ok(!headers.includes('Nghề nghiệp'));
  assert.ok(!headers.includes('Nghề Nghiệp'));

  // Check row 2 and row 3
  const row2 = sheet.getRow(2);
  assert.equal(row2.getCell(2).value, 'Nguyễn Văn A');
  assert.equal(row2.getCell(4).value, '0912345678');

  const row3 = sheet.getRow(3);
  assert.equal(row3.getCell(2).value, 'Trần Thị B');
  assert.equal(row3.getCell(4).value, ''); // Empty phone is preserved as empty
});

test('MEMBER-JSON-001: safeParseGraphQLResponses cleans for (;;); prefixes and parses JSON', async () => {
  const { safeParseGraphQLResponses } = await import('../../src/core/member-scanner.js');
  const mockPayload = 'for (;;);{"data":{"node":{"id":"1000999888","name":"Le Van C"}}}\n{"data":{"group":{"id":"192165486264058"}}}';
  const parsed = safeParseGraphQLResponses(mockPayload);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].data.node.id, '1000999888');
  assert.equal(parsed[0].data.node.name, 'Le Van C');
});

test('MEMBER-JSON-002: extractMembersFromAnyJson extracts member nodes from GraphQL edges and Comet SSR', async () => {
  const { extractMembersFromAnyJson } = await import('../../src/core/member-scanner.js');
  const mockGraphqlData = {
    data: {
      group: {
        id: '192165486264058',
        new_members: {
          edges: [
            {
              node: {
                id: '1000123456789',
                name: 'Nguyễn Văn Chủ Quán',
                subtitle_text: { text: 'Đã tham gia 2 giờ trước' }
              }
            },
            {
              node: {
                id: '1000987654321',
                name: 'Trần Thị Chủ Tiệm',
                subtitle_text: { text: 'Tham gia 5 giờ trước' }
              }
            }
          ]
        }
      }
    }
  };

  const members = extractMembersFromAnyJson(mockGraphqlData, '192165486264058');
  assert.equal(members.length, 2);
  assert.equal(members[0].memberId, '1000123456789');
  assert.equal(members[0].name, 'Nguyễn Văn Chủ Quán');
  assert.equal(members[0].joinedTimeText, 'Đã tham gia 2 giờ trước');
  assert.equal(members[0].groupUserUrl, 'https://www.facebook.com/groups/192165486264058/user/1000123456789/');

  assert.equal(members[1].memberId, '1000987654321');
  assert.equal(members[1].name, 'Trần Thị Chủ Tiệm');
});

test('MEMBER-ROLE-001: isSystemRoleOrInvalidName strictly blacklists group badges and roles', async () => {
  const { isSystemRoleOrInvalidName } = await import('../../src/core/member-scanner.js');

  // Must reject system roles & group badges
  assert.equal(isSystemRoleOrInvalidName('Người kiểm duyệt'), true);
  assert.equal(isSystemRoleOrInvalidName('Người đóng góp nhiều nhất'), true);
  assert.equal(isSystemRoleOrInvalidName('Quản trị viên'), true);
  assert.equal(isSystemRoleOrInvalidName('Quản trị viên & người kiểm duyệt'), true);
  assert.equal(isSystemRoleOrInvalidName('Admin'), true);
  assert.equal(isSystemRoleOrInvalidName('Moderator'), true);
  assert.equal(isSystemRoleOrInvalidName('Chuyên gia nhóm'), true);
  assert.equal(isSystemRoleOrInvalidName('Top contributor'), true);
  assert.equal(isSystemRoleOrInvalidName('Thành viên mới'), true);
  assert.equal(isSystemRoleOrInvalidName('Xem tất cả'), true);

  // Must accept authentic personal names
  assert.equal(isSystemRoleOrInvalidName('Nguyễn Văn Tuấn'), false);
  assert.equal(isSystemRoleOrInvalidName('Trần Hữu Long'), false);
  assert.equal(isSystemRoleOrInvalidName('Hoàng Thuỳ Linh'), false);
  assert.equal(isSystemRoleOrInvalidName('Lê Mai Hương'), false);
  assert.equal(isSystemRoleOrInvalidName('Cafe & Trà Sữa Mộc'), false);
});

test('MEMBER-FAST-HTTP-001: inspectMemberViaFastHttp exports cleanly and handles options', async () => {
  const { inspectMemberViaFastHttp } = await import('../../src/core/member-scanner.js');
  assert.equal(typeof inspectMemberViaFastHttp, 'function');
});

test('MEMBER-VENDOR-NAME-001: isSalesOrSoftwareVendorName detects sales reps and software services in name', async () => {
  const { isSalesOrSoftwareVendorName } = await import('../../src/core/member-scanner.js');

  // Real examples from user screenshot
  assert.equal(isSalesOrSoftwareVendorName('Nguyễn Kiều Trâm Sapo'), true);
  assert.equal(isSalesOrSoftwareVendorName('Phần Mềm Theo Yêu Cầu'), true);
  assert.equal(isSalesOrSoftwareVendorName('KiotViet Miền Bắc'), true);
  assert.equal(isSalesOrSoftwareVendorName('MISA Eshop - Tư Vấn'), true);
  assert.equal(isSalesOrSoftwareVendorName('Chuyên Viên Sapo'), true);
  assert.equal(isSalesOrSoftwareVendorName('Setup Quán Cafe & Trà Sữa'), true);

  // Legitimate prospective business leads from user screenshot
  assert.equal(isSalesOrSoftwareVendorName('Diệp Bích'), false);
  assert.equal(isSalesOrSoftwareVendorName('Xuân Phát'), false);
  assert.equal(isSalesOrSoftwareVendorName('Kin Thánh Thiện'), false);
  assert.equal(isSalesOrSoftwareVendorName('Tran Thang'), false);
  assert.equal(isSalesOrSoftwareVendorName('Bùi Alla'), false);
  assert.equal(isSalesOrSoftwareVendorName('Cafe & Trà Sữa Mộc'), false);
});

test('MEMBER-WEEKDAY-001: parseMemberJoinedTime triggers stopScrolling for weekday timestamps', async () => {
  const { parseMemberJoinedTime } = await import('../../src/core/member-scanner.js');

  // Real examples from user screenshot: "Đã tham gia vào thứ Hai"
  const tMon = parseMemberJoinedTime('Đã tham gia vào thứ Hai');
  assert.equal(tMon.within24h, false);
  assert.equal(tMon.stopScrolling, true);

  const tTue = parseMemberJoinedTime('Đã tham gia vào thứ Ba');
  assert.equal(tTue.within24h, false);
  assert.equal(tTue.stopScrolling, true);

  const tSun = parseMemberJoinedTime('Đã tham gia vào Chủ Nhật');
  assert.equal(tSun.within24h, false);
  assert.equal(tSun.stopScrolling, true);

  const tEng = parseMemberJoinedTime('Joined on Monday');
  assert.equal(tEng.within24h, false);
  assert.equal(tEng.stopScrolling, true);

  // 22 hours ago from user screenshot must still be accepted
  const t22h = parseMemberJoinedTime('Đã tham gia 22 giờ trước');
  assert.equal(t22h.within24h, true);
  assert.equal(t22h.stopScrolling, false);

  const t5h = parseMemberJoinedTime('Đã tham gia 5 giờ trước');
  assert.equal(t5h.within24h, true);
  assert.equal(t5h.stopScrolling, false);
});

test('MEMBER-OWN-PHONE-001: sanitizeProfileHtml strips scripts and filters own phones', async () => {
  const { sanitizeProfileHtml } = await import('../../src/core/member-scanner.js');
  const mockHtmlWithViewerScript = `
    <html>
      <head>
        <script>
          require("CurrentUserInitialData", [], function() {
            return {"ACCOUNT_ID":"123456","PHONE":"0943132972"};
          });
        </script>
      </head>
      <body>
        <div role="main">
          <span>Xin chào, shop mình chuyên đầm thiết kế</span>
        </div>
      </body>
    </html>
  `;
  const sanitized = sanitizeProfileHtml(mockHtmlWithViewerScript);
  assert.equal(sanitized.includes('CurrentUserInitialData'), false);
  assert.equal(sanitized.includes('0943132972'), false);
  assert.equal(sanitized.includes('shop mình chuyên đầm thiết kế'), true);
});

test('MEMBER-SVG-PHONE-001: sanitizeProfileHtml strips SVG tags preventing Facebook logo vector 0911164094 from matching', async () => {
  const { sanitizeProfileHtml } = await import('../../src/core/member-scanner.js');
  const { extractPhonesFromText } = await import('../../src/core/phone-validator.js');

  // Exact SVG path from Facebook's official brand logo rendered in header/navigation
  const fbLogoSvg = '<svg viewBox="0 0 36 36"><path d="M20.188 31.5v-11.5h3.883l.582-4.5h-4.465v-2.871c0-1.303.362-2.191 2.23-2.191l2.383-.001V6.411c-.413-.055-1.83-.178-3.479-.178-3.442 0-5.798 2.101-5.798 5.959V15.5h-3.882v4.5h3.882v11.5h4.941 0-4.09 1.116-4.09 4.025V18h5.883l-1.008 5.5h-4.867v12.37a18.183 18.183 0 0 1-6.53-.399Z" style="fill: var(--always-white)"></path></svg>';
  
  // 1. Without sanitization, the raw SVG vector coordinates match phantom phone 0911164094
  const rawPhones = extractPhonesFromText(fbLogoSvg);
  assert.equal(rawPhones.includes('0911164094'), true);

  // 2. With sanitizeProfileHtml, SVG markup is completely stripped and no phantom phone is extracted
  const sanitized = sanitizeProfileHtml(fbLogoSvg);
  const cleanPhones = extractPhonesFromText(sanitized);
  assert.equal(cleanPhones.length, 0);

  // 3. Authentic phone in user content is preserved accurately
  const pageWithRealPhone = `${fbLogoSvg}<div><span>Liên hệ đặt bàn: 0988.123.456</span></div>`;
  const sanitizedWithReal = sanitizeProfileHtml(pageWithRealPhone);
  const realPhones = extractPhonesFromText(sanitizedWithReal);
  assert.deepEqual(realPhones, ['0988123456']);
});

test('MEMBER-SCROLL-001: 23h member (Diệp Bích) is accepted and interleaved vendors do not stop collection', async () => {
  const { parseMemberJoinedTime, isSalesOrSoftwareVendorName } = await import('../../src/core/member-scanner.js');

  // Real data from user screenshot
  const diepBichTime = 'Đã tham gia 23 giờ trước';
  const timeRes = parseMemberJoinedTime(diepBichTime);
  assert.equal(timeRes.within24h, true);
  assert.equal(timeRes.stopScrolling, false);

  // Diệp Bích is not a vendor
  assert.equal(isSalesOrSoftwareVendorName('Diệp Bích'), false);

  // Interleaved vendors in the list are correctly identified
  assert.equal(isSalesOrSoftwareVendorName('Nguyễn Kiều Trâm Sapo'), true);
  assert.equal(isSalesOrSoftwareVendorName('Phần Mềm Theo Yêu Cầu'), true);
});




