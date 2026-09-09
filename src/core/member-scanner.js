import { EventEmitter } from 'events';
import ExcelJS from 'exceljs';
import logger from './logger.js';
import browserManager from './browser-manager.js';
import { parseCookieInput } from './session-manager.js';
import { GroupManager } from './group-manager.js';
import { extractPhonesFromText } from './phone-validator.js';
import { normalizeProvinceName } from './location-extractor.js';
import { buildProfileSearchUrl } from './search-engine.js';

export const SOFTWARE_BRANDS = [
  'misa', 'eshop', 'omicall', 'sapo', 'kiotviet', 'kiot viet', 'ipos', 'pos365',
  'cukcuk', 'haravan', 'nhanh.vn', 'nhanh vn', 'maybanhang', 'máy bán hàng',
  'ocha', 'suno', 'loop', 'dantrisoft', 'bepos', 'loyverse', 'fabico', 'tpos',
  'vietfn', 'posapp', 'salekit', 'vpage', 'pancake', 'chotdon', 'tuha'
];

export const SALE_KEYWORDS = [
  'nhận tư vấn', 'tư vấn phần mềm', 'tư vấn hỗ trợ', 'bên em hỗ trợ', 'bên e hỗ trợ',
  'kết nối zalo', 'inbox em', 'inbox e', 'ib em', 'ib e', 'lh:', 'liên hệ em',
  'liên hệ e', 'lh em', 'lh e', 'zalo em', 'zalo e', 'setup quán trọn gói',
  'setup quán', 'chuyên viên tư vấn', 'chuyên viên phần mềm', 'đại lý phần mềm',
  'nhân viên kinh doanh', 'nv kinh doanh', 'sale phần mềm', 'sales phần mềm',
  'bên em có', 'bên e có', 'em hỗ trợ mình', 'e hỗ trợ mình'
];

export const THANH_LY_KEYWORDS = [
  'thanh lý', 'thanh lí', 'pass lại', 'nhượng lại', 'cần pass', 'bán lại',
  'không dùng nữa', 'thu mua máy', 'thu mua phần mềm', 'thu mua pos',
  'hết hạn hợp đồng', 'sang quán', 'đóng cửa quán', 'pass gói', 'nhượng gói'
];

/**
 * Parses relative joined time text from Facebook "Mới vào nhóm" list
 * Returns { within24h, stopScrolling, normalizedText }
 */
export function parseMemberJoinedTime(rawText = '') {
  if (!rawText || typeof rawText !== 'string') {
    return { within24h: false, stopScrolling: false, normalizedText: '' };
  }
  const clean = rawText.trim();
  const lower = clean.toLowerCase();

  // Within 24h signals
  if (lower.includes('giây') || lower.includes('vừa xong') || lower.includes('second') || lower.includes('just now')) {
    return { within24h: true, stopScrolling: false, normalizedText: clean };
  }

  if (lower.includes('phút') || lower.includes('minute')) {
    return { within24h: true, stopScrolling: false, normalizedText: clean };
  }

  if (lower.includes('hôm nay') || lower.includes('today')) {
    return { within24h: true, stopScrolling: false, normalizedText: clean };
  }

  // Hours: e.g. "khoảng 1 giờ trước", "2 giờ trước", "23 giờ trước"
  const hourMatch = lower.match(/(\d+)\s*(?:giờ|hour|h)/i);
  if (hourMatch) {
    const hours = parseInt(hourMatch[1], 10);
    if (hours <= 24) {
      return { within24h: true, stopScrolling: false, normalizedText: clean };
    } else {
      return { within24h: false, stopScrolling: true, normalizedText: clean };
    }
  }

  // Days: e.g. "1 ngày trước", "2 ngày trước", "1 day ago" -> >= 24h -> STOP SCROLLING
  if (lower.includes('ngày') || lower.includes('day')) {
    return { within24h: false, stopScrolling: true, normalizedText: clean };
  }

  // Weeks, months, years -> STOP SCROLLING
  if (lower.includes('tuần') || lower.includes('week') || lower.includes('tháng') || lower.includes('month') || lower.includes('năm') || lower.includes('year')) {
    return { within24h: false, stopScrolling: true, normalizedText: clean };
  }

  // Default fallback
  return { within24h: true, stopScrolling: false, normalizedText: clean };
}

/**
 * Evaluates whether text reveals a Software Sales Rep or Thanh Lý / Liquidation agent
 */
export function evaluateMemberContent(text = '') {
  if (!text || typeof text !== 'string') return { isNegative: false, reason: '' };
  const lower = text.toLowerCase();

  // 1. Check Thanh lý
  for (const kw of THANH_LY_KEYWORDS) {
    if (lower.includes(kw)) {
      return { isNegative: true, reason: `Phát hiện nhu cầu thanh lý/thu mua: "${kw}"` };
    }
  }

  // 2. Check combination: Brand + Sales CTA
  const matchedBrand = SOFTWARE_BRANDS.find(b => lower.includes(b));
  const matchedCTA = SALE_KEYWORDS.find(k => lower.includes(k));

  if (matchedBrand && matchedCTA) {
    return { isNegative: true, reason: `Phát hiện Sale chào mời PM: [${matchedBrand.toUpperCase()}] kèm ["${matchedCTA}"]` };
  }

  // 3. Check explicit workplace / job title
  const jobPatterns = [
    /làm việc tại\s+.*(sapo|kiotviet|kiot viet|ipos|pos365|misa|omicall|cukcuk|haravan)/i,
    /chuyên viên\s+.*(sapo|kiotviet|kiot viet|ipos|pos365|misa|omicall|tư vấn)/i,
    /nhân viên\s+.*(sapo|kiotviet|kiot viet|ipos|pos365|misa|kinh doanh)/i,
    /tư vấn\s+.*(sapo|kiotviet|kiot viet|ipos|pos365|misa|phần mềm)/i,
    /sale[s]?\s+.*(sapo|kiotviet|kiot viet|ipos|pos365|misa|phần mềm)/i,
    /đại lý\s+.*(sapo|kiotviet|kiot viet|ipos|pos365|misa|phần mềm)/i
  ];
  for (const pat of jobPatterns) {
    if (pat.test(lower)) {
      const matchText = pat.exec(lower)?.[0] || '';
      return { isNegative: true, reason: `Phát hiện chức danh/nghề nghiệp Sale PM (${matchText})` };
    }
  }

  // 4. Standalone aggressive sales patterns
  if (lower.includes('nhận tư vấn phần mềm') || lower.includes('em nhận tư vấn') || lower.includes('kết nối zalo em') || lower.includes('ib e tư vấn') || lower.includes('ib em tư vấn')) {
    return { isNegative: true, reason: 'Phát hiện bình luận tư vấn dịch vụ' };
  }

  return { isNegative: false, reason: '' };
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export class MemberScanner extends EventEmitter {
  constructor() {
    super();
    this.activeScans = new Map(); // clientId -> scanState
  }

  getProgress(clientId = 'default') {
    return this.activeScans.get(clientId) || {
      isScanning: false,
      currentGroup: '',
      processedMembers: 0,
      qualifiedLeads: 0,
      skippedCount: 0,
      leads: [],
      logs: []
    };
  }

  stopScan(clientId = 'default') {
    if (this.activeScans.has(clientId)) {
      const state = this.activeScans.get(clientId);
      state.abortRequested = true;
      state.isScanning = false;
      logger.info(`[MEMBER-SCANNER] Đã nhận lệnh dừng quét cho client [${clientId}]`);
      return { success: true, message: 'Đã gửi yêu cầu dừng quét.' };
    }
    return { success: false, message: 'Không có tiến trình quét nào đang chạy.' };
  }

  /**
   * Main scan function
   */
  async scanGroups({
    groupUrlsOrIds = [],
    clientId = 'default',
    cookie = '',
    filters = {}
  } = {}) {
    if (!Array.isArray(groupUrlsOrIds) || groupUrlsOrIds.length === 0) {
      throw new Error('Vui lòng cung cấp ít nhất một nhóm Facebook để quét.');
    }

    const {
      deepPhoneSearch = true,
      maxMembersPerGroup = 60,
      excludeSales = true
    } = filters;

    const state = {
      isScanning: true,
      abortRequested: false,
      currentGroup: '',
      processedMembers: 0,
      qualifiedLeads: 0,
      skippedCount: 0,
      leads: [],
      logs: []
    };
    this.activeScans.set(clientId, state);

    const log = (msg) => {
      const entry = `[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`;
      state.logs.unshift(entry);
      if (state.logs.length > 100) state.logs.pop();
      this.emit('progress', { clientId, state });
    };

    let context = null;
    let page = null;

    try {
      log('🚀 Đang khởi động trình duyệt Chromium để quét thành viên...');
      const isHeadless = true;
      context = await browserManager.createClientContext(clientId, isHeadless);

      // Inject cookie
      if (cookie) {
        const parsed = Array.isArray(cookie) ? cookie : parseCookieInput(cookie);
        const formatted = parsed.map(c => ({
          name: c.name.trim(),
          value: String(c.value).trim(),
          domain: '.facebook.com',
          path: '/',
          secure: true
        })).filter(c => c.name && c.value);
        if (formatted.length > 0) {
          await context.addCookies(formatted);
          log(`🔑 Đã nạp ${formatted.length} cookies vào trình duyệt.`);
        }
      }

      page = await context.newPage();

      for (let gIdx = 0; gIdx < groupUrlsOrIds.length; gIdx++) {
        if (state.abortRequested) break;

        const rawTarget = String(groupUrlsOrIds[gIdx]).trim();
        if (!rawTarget) continue;

        // Resolve group ID & URL
        let groupId = rawTarget;
        if (rawTarget.includes('/groups/')) {
          const m = rawTarget.match(/\/groups\/([^/?]+)/i);
          if (m && m[1]) groupId = m[1];
        }

        // Check if vanity slug needs numeric resolution
        if (!/^\d+$/.test(groupId)) {
          log(`🔍 Đang giải mã ID nhóm cho slug [${groupId}]...`);
          const resolved = await GroupManager.resolveNumericGroupId(groupId);
          if (resolved) groupId = resolved;
        }

        const membersUrl = `https://www.facebook.com/groups/${groupId}/members`;
        state.currentGroup = `Nhóm ${groupId}`;
        log(`📂 Đang mở danh sách thành viên: ${membersUrl}`);

        try {
          await page.goto(membersUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
          await delay(2500);

          // Scroll to find "Mới vào nhóm"
          log('📜 Đang cuộn tìm mục "Mới vào nhóm"...');
          let foundHeading = false;
          for (let s = 0; s < 8; s++) {
            const hasHeading = await page.evaluate(() => {
              const elements = Array.from(document.querySelectorAll('span, h2, h3, div'));
              return elements.some(el => {
                const t = el.textContent.trim();
                return t === 'Mới vào nhóm' || t === 'New to the group';
              });
            });

            if (hasHeading) {
              foundHeading = true;
              break;
            }
            await page.evaluate(() => window.scrollBy(0, 700));
            await delay(1200);
          }

          if (!foundHeading) {
            log(`⚠️ Không tìm thấy mục "Mới vào nhóm" tại nhóm [${groupId}]. Có thể nhóm này ẩn thành viên hoặc cần quyền phê duyệt.`);
            continue;
          }

          log('✅ Đã tìm thấy mục "Mới vào nhóm". Đang quét danh sách thành viên trong 24h...');

          // Scroll & collect members
          const candidateMembers = [];
          const seenMemberIds = new Set();
          let hitTimeLimit = false;
          let noNewCount = 0;

          for (let scrollStep = 0; scrollStep < 15; scrollStep++) {
            if (state.abortRequested || hitTimeLimit) break;

            const extractedInPage = await page.evaluate((currentGroupId) => {
              // Find the "Mới vào nhóm" section container
              const allElements = Array.from(document.querySelectorAll('span, h2, h3, div'));
              const headingEl = allElements.find(el => {
                const t = el.textContent.trim();
                return t === 'Mới vào nhóm' || t === 'New to the group';
              });

              if (!headingEl) return [];

              // Walk up to find the common section container
              let sectionParent = headingEl.parentElement;
              for (let i = 0; i < 4; i++) {
                if (sectionParent && sectionParent.parentElement && sectionParent.parentElement.children.length > 2) {
                  sectionParent = sectionParent.parentElement;
                  break;
                }
                if (sectionParent && sectionParent.parentElement) sectionParent = sectionParent.parentElement;
              }

              const results = [];
              if (!sectionParent) return results;

              // Find member links within this section
              const userLinks = Array.from(sectionParent.querySelectorAll('a[href*="/user/"], a[role="link"][href*="/groups/"]'));
              for (const a of userLinks) {
                const href = a.getAttribute('href') || '';
                const mId = href.match(/\/user\/(\d+)/i) || href.match(/\/user\/([^/?]+)/i);
                if (!mId) continue;
                const memberId = mId[1];

                const container = a.closest('div[role="listitem"]') || a.closest('div[data-visualcompletion="ignore-dynamic-snippet"]') || a.parentElement?.parentElement;
                if (!container) continue;

                // Extract name
                const nameEl = container.querySelector('a[role="link"] span, strong, h3');
                const name = nameEl ? nameEl.textContent.trim() : a.textContent.trim();
                if (!name || name.length < 2) continue;

                // Extract lines of text in this container
                const rawLines = (container.innerText || container.textContent || '')
                  .split('\n')
                  .map(l => l.trim())
                  .filter(Boolean);

                let joinedTimeText = '';
                let subtitleText = '';

                for (const line of rawLines) {
                  const lowerL = line.toLowerCase();
                  if (lowerL.includes('tham gia') || lowerL.includes('trước') || lowerL.includes('hôm nay') || lowerL.includes('joined') || lowerL.includes('thêm vào')) {
                    if (!joinedTimeText) joinedTimeText = line;
                  } else if (line !== name && !line.includes('Theo dõi') && !line.includes('Thêm bạn bè') && !line.includes('Nhắn tin')) {
                    if (!subtitleText) subtitleText = line;
                  }
                }

                results.push({
                  memberId,
                  name,
                  groupUserUrl: `https://www.facebook.com/groups/${currentGroupId}/user/${memberId}/`,
                  joinedTimeText,
                  subtitleText
                });
              }

              return results;
            }, groupId);

            let addedInThisScroll = 0;
            for (const item of extractedInPage) {
              if (!seenMemberIds.has(item.memberId)) {
                seenMemberIds.add(item.memberId);

                // Time check
                const timeCheck = parseMemberJoinedTime(item.joinedTimeText);
                if (timeCheck.stopScrolling) {
                  hitTimeLimit = true;
                  log(`⏹ Gặp thành viên vào quá 24h ("${item.joinedTimeText}"). Dừng nạp thêm.`);
                  break;
                }

                candidateMembers.push(item);
                addedInThisScroll++;

                if (candidateMembers.length >= maxMembersPerGroup) break;
              }
            }

            if (candidateMembers.length >= maxMembersPerGroup || hitTimeLimit) break;

            if (addedInThisScroll === 0) {
              noNewCount++;
              if (noNewCount >= 3) break;
            } else {
              noNewCount = 0;
            }

            await page.evaluate(() => window.scrollBy(0, 900));
            await delay(1500);
          }

          log(`👥 Đã thu thập ${candidateMembers.length} thành viên mới trong 24h. Bắt đầu thẩm định từng thành viên...`);

          // Inspect each candidate member
          for (const member of candidateMembers) {
            if (state.abortRequested) break;
            state.processedMembers++;

            log(`🔍 [${state.processedMembers}/${candidateMembers.length}] Đang kiểm tra: ${member.name} (${member.joinedTimeText || '24h qua'})`);

            // Tier 1: Fast check on name and subtitle
            if (excludeSales) {
              const t1Check = evaluateMemberContent(`${member.name} ${member.subtitleText}`);
              if (t1Check.isNegative) {
                state.skippedCount++;
                log(`⏩ [TẦNG 1] Bỏ qua ${member.name}: ${t1Check.reason}`);
                continue;
              }
            }

            // Tier 2: Open /groups/{groupId}/user/{memberId}/ to inspect "Hoạt động mới đây" & "Bài viết trong nhóm"
            let profileUrl = `https://www.facebook.com/${member.memberId}`;
            let province = normalizeProvinceName(member.subtitleText) || '';
            let groupActivityCheckFailed = false;

            try {
              await page.goto(member.groupUserUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
              await delay(2000);

              const groupProfileData = await page.evaluate(() => {
                // Find "Xem trang cá nhân" link
                const viewProfileLink = document.querySelector('a[href*="/user/"][role="link"], a[href*="facebook.com/"][role="button"], a[role="link"]');
                const profileHref = viewProfileLink ? viewProfileLink.getAttribute('href') : '';

                // Extract all text from "Hoạt động mới đây" and "Bài viết trong nhóm"
                const activityContainers = Array.from(document.querySelectorAll('div'));
                let activityText = '';
                for (const d of activityContainers) {
                  const t = (d.innerText || '').trim();
                  if (t.includes('Hoạt động mới đây') || t.includes('Recent activity') || t.includes('Bài viết trong nhóm')) {
                    activityText += ' ' + t;
                  }
                }

                // Subtitle/intro text
                const introEl = document.querySelector('div[role="main"]');
                const introText = introEl ? (introEl.innerText || '').substring(0, 1500) : '';

                return {
                  profileHref,
                  activityText: activityText || introText
                };
              });

              if (groupProfileData.profileHref && groupProfileData.profileHref.startsWith('http')) {
                profileUrl = groupProfileData.profileHref;
              }

              // Evaluate activity content
              if (excludeSales && groupProfileData.activityText) {
                const t2Check = evaluateMemberContent(groupProfileData.activityText);
                if (t2Check.isNegative) {
                  state.skippedCount++;
                  log(`⏩ [TẦNG 2] Bỏ qua ${member.name}: ${t2Check.reason}`);
                  groupActivityCheckFailed = true;
                  continue;
                }
              }
            } catch (err) {
              logger.debug({ err: err.message }, 'Could not load group user activity page, proceeding to profile');
            }

            if (groupActivityCheckFailed) continue;

            // Tier 3: Open profile to extract Province & Phone
            let phone = '';

            try {
              log(`👤 Đang mở trang cá nhân của ${member.name}...`);
              await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
              await delay(2200);

              // 3.1 Extract Province from /about if not yet found
              if (!province) {
                const profileText = await page.evaluate(() => document.body ? document.body.innerText : '');
                province = normalizeProvinceName(profileText) || '';
              }

              // 3.2 Extract Phone from profile text & bio
              const profileInfo = await page.evaluate(() => {
                const bioEl = document.querySelector('div[data-pagelet*="ProfileIntro"], div[role="main"]');
                return bioEl ? (bioEl.innerText || '') : '';
              });

              const foundPhones = extractPhonesFromText(profileInfo);
              if (foundPhones.length > 0) {
                phone = foundPhones[0];
                log(`📞 Tìm thấy SĐT trên Bio/Giới thiệu của ${member.name}: ${phone}`);
              }

              // 3.3 Deep Phone Search via profile timeline search: profile/{UID}/search/?q=sdt
              if (!phone && deepPhoneSearch) {
                const searchUrl = buildProfileSearchUrl(member.memberId, 'sdt') || `https://www.facebook.com/profile/${member.memberId}/search/?q=sdt`;
                log(`🔎 [TÌM KIẾM CHUYÊN SÂU] Tìm 'sdt' trên tường của ${member.name}: ${searchUrl}`);

                try {
                  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
                  await delay(2000);

                  const searchPostsText = await page.evaluate(() => {
                    const articles = Array.from(document.querySelectorAll('div[role="feed"] > div, div[role="article"]'));
                    return articles.slice(0, 4).map(a => a.innerText || '').join('\n');
                  });

                  // Check if the search results reveal a hidden sale PM
                  if (excludeSales && searchPostsText) {
                    const searchCheck = evaluateMemberContent(searchPostsText);
                    if (searchCheck.isNegative) {
                      state.skippedCount++;
                      log(`⏩ [TẦNG 3] Bỏ qua ${member.name}: ${searchCheck.reason}`);
                      continue;
                    }
                  }

                  const deepPhones = extractPhonesFromText(searchPostsText);
                  if (deepPhones.length > 0) {
                    phone = deepPhones[0];
                    log(`🎯 Tìm thấy SĐT qua tìm kiếm bài viết của ${member.name}: ${phone}`);
                  }
                } catch (searchErr) {
                  logger.debug({ err: searchErr.message }, 'Profile search error');
                }
              }

            } catch (profErr) {
              logger.debug({ err: profErr.message }, 'Profile navigation error');
            }

            // Record qualified lead
            const qualifiedLead = {
              stt: state.qualifiedLeads + 1,
              id: member.memberId,
              name: member.name,
              profileUrl,
              phone: phone || '',
              location: province || '',
              joinedTime: member.joinedTimeText || 'Mới tham gia',
              groupName: state.currentGroup,
              groupUrl: membersUrl,
              scannedAt: new Date().toLocaleString('vi-VN')
            };

            state.qualifiedLeads++;
            state.leads.unshift(qualifiedLead);
            log(`⭐ [LEAD HỢP LỆ #${state.qualifiedLeads}] ${member.name} | Tỉnh: ${province || '(Trống)'} | SĐT: ${phone || '(Trống)'}`);

            this.emit('lead', { clientId, lead: qualifiedLead });
            this.emit('progress', { clientId, state });

            // Safe human-like delay
            await delay(2000 + Math.random() * 2000);
          }

        } catch (grpErr) {
          log(`❌ Lỗi khi xử lý nhóm [${groupId}]: ${grpErr.message}`);
        }
      }

      log(`🎉 Hoàn tất tiến trình quét! Đã kiểm tra: ${state.processedMembers}, Bỏ qua (Sale/Thanh lý): ${state.skippedCount}, Thu được: ${state.qualifiedLeads} leads chất lượng.`);

    } catch (err) {
      log(`❌ Lỗi hệ thống khi quét thành viên: ${err.message}`);
      logger.error({ err: err.message }, 'Member scanner fatal error');
    } finally {
      state.isScanning = false;
      this.emit('progress', { clientId, state });
      if (page && !page.isClosed()) await page.close().catch(() => {});
      if (context) await browserManager.closeClientContext(clientId).catch(() => {});
    }

    return state;
  }

  /**
   * Export scanned members to Excel buffer
   */
  static async exportToExcelBuffer(leads = []) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'FB Automation Tool';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Thành Viên Mới Tiềm Năng');

    sheet.columns = [
      { header: 'STT', key: 'stt', width: 8 },
      { header: 'Tên Facebook', key: 'name', width: 28 },
      { header: 'ID Facebook (UID)', key: 'id', width: 22 },
      { header: 'Số Điện Thoại', key: 'phone', width: 18 },
      { header: 'Tỉnh / Thành Phố', key: 'location', width: 22 },
      { header: 'Thời Gian Vào Nhóm', key: 'joinedTime', width: 25 },
      { header: 'Nhóm Nguồn', key: 'groupName', width: 35 },
      { header: 'Link Trang Cá Nhân', key: 'profileUrl', width: 45 },
      { header: 'Thời Gian Quét', key: 'scannedAt', width: 22 }
    ];

    // Header styling
    const headerRow = sheet.getRow(1);
    headerRow.height = 28;
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF059669' } // Emerald green
      };
      cell.font = {
        name: 'Segoe UI',
        size: 11,
        bold: true,
        color: { argb: 'FFFFFFFF' }
      };
      cell.alignment = {
        vertical: 'middle',
        horizontal: 'center',
        wrapText: true
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF047857' } },
        left: { style: 'thin', color: { argb: 'FF047857' } },
        bottom: { style: 'medium', color: { argb: 'FF047857' } },
        right: { style: 'thin', color: { argb: 'FF047857' } }
      };
    });

    // Populate data
    leads.forEach((lead, idx) => {
      const row = sheet.addRow({
        stt: idx + 1,
        name: lead.name || '',
        id: lead.id || '',
        phone: lead.phone || '',
        location: lead.location || '',
        joinedTime: lead.joinedTime || '',
        groupName: lead.groupName || '',
        profileUrl: lead.profileUrl || '',
        scannedAt: lead.scannedAt || ''
      });

      row.height = 24;
      const isEven = idx % 2 === 0;

      row.eachCell((cell, colNumber) => {
        cell.font = { name: 'Segoe UI', size: 10 };
        cell.alignment = { vertical: 'middle' };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: isEven ? 'FFFFFFFF' : 'FFF9FAFB' }
        };

        if (colNumber === 1 || colNumber === 3 || colNumber === 4 || colNumber === 5 || colNumber === 6) {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        }

        // Highlight phone cell in light green if present
        if (colNumber === 4 && lead.phone) {
          cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF047857' } };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFD1FAE5' }
          };
        }

        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
        };
      });
    });

    return await workbook.xlsx.writeBuffer();
  }
}

const memberScanner = new MemberScanner();
export default memberScanner;
