import { EventEmitter } from 'events';
import ExcelJS from 'exceljs';
import logger from './logger.js';
import browserManager from './browser-manager.js';
import sessionManager, { parseCookieInput } from './session-manager.js';
import { GroupManager } from './group-manager.js';
import { extractPhonesFromText } from './phone-validator.js';
import { normalizeProvinceName } from './location-extractor.js';
import { buildProfileSearchUrl } from './search-engine.js';
import ocrManager from './ocr-manager.js';

/**
 * Safely parse potential multi-line or prefixed Facebook GraphQL response string
 */
export function safeParseGraphQLResponses(rawText = '') {
  if (!rawText || typeof rawText !== 'string') return [];
  const results = [];
  const lines = rawText.split('\n');
  for (const line of lines) {
    let clean = line.trim();
    if (clean.startsWith('for (;;);')) clean = clean.substring(9).trim();
    if (clean.startsWith('{') && clean.endsWith('}')) {
      try {
        results.push(JSON.parse(clean));
      } catch (e) {}
    }
  }
  return results;
}

/**
 * Deep recursive extractor that traverses any Facebook GraphQL JSON tree or Comet SSR JSON
 * looking for group member nodes (new_members, new_forum_members, all_participants, search_results)
 */
export function extractMembersFromAnyJson(root, targetGroupId = '') {
  const members = [];
  const seen = new Set();

  function traverse(obj) {
    if (!obj || typeof obj !== 'object') return;

    if (obj.node && typeof obj.node === 'object') {
      inspectCandidate(obj.node, obj);
    } else {
      inspectCandidate(obj);
    }

    if (Array.isArray(obj)) {
      for (const item of obj) traverse(item);
    } else {
      for (const val of Object.values(obj)) {
        if (typeof val === 'object' && val !== null) {
          traverse(val);
        }
      }
    }
  }

  function inspectCandidate(node, parentEdge = null) {
    if (!node || typeof node !== 'object') return;
    const id = node.id || node.user_id || node.uid;
    const name = node.name || node.text || node.title?.text;
    if (!id || !name || typeof name !== 'string') return;
    if (!/^\d{5,}$/.test(String(id))) return;
    if (String(id) === String(targetGroupId)) return;
    if (seen.has(String(id))) return;

    let joinedText = '';
    let subtitleText = '';

    const candidateTexts = [
      node.subtitle_text?.text,
      node.subtitle?.text,
      node.join_time_text,
      node.bio_text?.text,
      parentEdge?.subtitle_text?.text,
      parentEdge?.join_time_text
    ].filter(Boolean);

    for (const t of candidateTexts) {
      const lower = String(t).toLowerCase();
      if (lower.includes('tham gia') || lower.includes('trước') || lower.includes('hôm nay') || lower.includes('joined') || lower.includes('vừa xong') || lower.includes('thêm vào')) {
        if (!joinedText) joinedText = String(t).trim();
      } else if (!subtitleText && String(t).trim() !== String(name).trim()) {
        subtitleText = String(t).trim();
      }
    }

    seen.add(String(id));
    members.push({
      memberId: String(id),
      name: String(name).trim(),
      groupUserUrl: targetGroupId ? `https://www.facebook.com/groups/${targetGroupId}/user/${id}/` : `https://www.facebook.com/${id}`,
      joinedTimeText: joinedText,
      subtitleText: subtitleText
    });
  }

  traverse(root);
  return members;
}

export const SYSTEM_ROLE_BLACKLIST = [
  'người kiểm duyệt', 'nguoi kiem duyet', 'người đóng góp nhiều nhất',
  'nguoi dong gop nhieu nhat', 'quản trị viên', 'quan tri vien',
  'quản trị viên & người kiểm duyệt', 'quản trị viên và người kiểm duyệt',
  'chuyên gia nhóm', 'người tạo nhóm', 'top contributor', 'admin',
  'moderator', 'thành viên', 'thanh vien', 'thành viên mới', 'mới vào nhóm',
  'xem tất cả', 'xem them', 'xem thêm', 'bạn bè', 'facebook user', 'tài khoản facebook',
  'người theo dõi', 'người quản trị'
];

export function isSystemRoleOrInvalidName(name = '') {
  if (!name || typeof name !== 'string') return true;
  const clean = name.trim().toLowerCase();
  if (clean.length < 2 || clean.length > 50) return true;
  for (const role of SYSTEM_ROLE_BLACKLIST) {
    if (clean === role || clean.includes(role)) return true;
  }
  return false;
}

/**
 * Fast inspection of candidate member via lightweight HTTP requests (20x faster than Playwright page loads)
 * Queries contact info, bio, timeline, and about sections
 */
export function sanitizeProfileHtml(html = '') {
  if (!html || typeof html !== 'string') return '';
  // 1. Remove all <script>...</script> tags to avoid picking up viewer account metadata (e.g. CurrentUserInitialData)
  let clean = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
  // 2. Remove all <style>...</style> tags
  clean = clean.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
  // 3. Remove all <svg>...</svg> vector elements (CRITICAL: prevents Facebook logo path coordinates '0-4.09 1.116-4.09 4' from matching '0911164094')
  clean = clean.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ');
  // 4. Strip all remaining HTML tags
  clean = clean.replace(/<[^>]+>/g, ' ');
  // 5. Decode common HTML entities
  clean = clean
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  // 6. Collapse consecutive whitespace
  return clean.replace(/\s+/g, ' ').trim();
}

export const SOFTWARE_BRANDS = [
  'misa', 'eshop', 'omicall', 'sapo', 'kiotviet', 'kiot viet', 'ipos', 'pos365',
  'cukcuk', 'haravan', 'nhanh.vn', 'nhanh vn', 'maybanhang', 'máy bán hàng',
  'ocha', 'suno', 'loop', 'dantrisoft', 'bepos', 'loyverse', 'fabico', 'tpos',
  'vietfn', 'posapp', 'salekit', 'vpage', 'pancake', 'chotdon', 'tuha',
  'gosell', 'sobanhang', 'sổ bán hàng', 'trustpos', 'sunpos', 'bpos', 'ezpos',
  'webcake', 'ladipage', 'ladi', 'softdreams', 'easypos', 'easyinvoice', 'easybooks'
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

export const VENDOR_NAME_KEYWORDS = [
  'phần mềm', 'phan mem', 'software', 'thiết kế web', 'thiet ke web',
  'setup quán', 'setup f&b', 'pos bán hàng', 'máy bán hàng', 'máy in bill',
  'máy pos', 'phần mềm thu ngân', 'máy thu ngân', 'pos thu ngân', 'thiết bị thu ngân',
  'marketing online', 'quảng cáo facebook', 'dịch vụ f&b', 'omnichannel'
];

export const VENDOR_COVER_KEYWORDS = [
  'omnichannel', 'giải pháp bán hàng', 'giai phap ban hang',
  'bán hàng đa kênh', 'ban hang da kenh', 'website ecom',
  'thiết kế web', 'thiet ke web', 'thiết kế website',
  'phần mềm quản lý', 'phan mem quan ly', 'tư vấn phần mềm',
  'phần mềm tính tiền', 'máy bán hàng', 'máy in hóa đơn',
  'máy pos', 'setup quán', 'setup f&b', 'chuyên viên giải pháp'
];

/**
 * Extract cover photo URL from Facebook Comet SSR JSON, OpenGraph meta, or DOM attributes
 */
export function extractCoverPhotoFromHtml(html = '') {
  if (!html || typeof html !== 'string') return '';

  // 1. Check Comet SSR JSON Relay objects: cover_photo / coverPhoto / profile_cover / header_photo
  const relayPatterns = [
    /"(?:cover_photo|coverPhoto|profile_cover)"\s*:\s*\{[^}]*?"uri"\s*:\s*"([^"]+)"/i,
    /"(?:cover_photo|coverPhoto|profile_cover)"\s*:\s*\{[^}]*?"image"\s*:\s*\{[^}]*?"uri"\s*:\s*"([^"]+)"/i,
    /"focus"\s*:\s*\{[^}]*?"uri"\s*:\s*"([^"]+)"/i,
    /"header_photo"[^}]*?"uri"\s*:\s*"([^"]+)"/i,
    /"cover_photo_id"[^}]*?"uri"\s*:\s*"([^"]+)"/i,
    /"profileCoverPhoto"[^}]*?"uri"\s*:\s*"([^"]+)"/i
  ];

  for (const pat of relayPatterns) {
    const m = html.match(pat);
    if (m && m[1]) {
      const url = m[1].replace(/\\\/|\//g, '/').replace(/\\u0025/g, '%').replace(/&amp;/g, '&');
      if (url.startsWith('http') && !url.includes('emoji') && !url.includes('rsrc.php') && !url.includes('static.xx')) {
        return url;
      }
    }
  }

  // 2. DOM / Meta tags
  const domPatterns = [
    /<img\b[^>]*data-imgperflogname=["']profileCoverPhoto["'][^>]*src=["']([^"']+)["']/i,
    /<img\b[^>]*src=["']([^"']+)["'][^>]*data-imgperflogname=["']profileCoverPhoto["']/i,
    /<div\b[^>]*data-pagelet=["'][^"']*Cover[^"']*["'][^>]*>[\s\S]*?<img\b[^>]*src=["']([^"']+)["']/i,
    /<div\b[^>]*aria-label=["'][^"']*(?:Ảnh bìa|Cover photo)[^"']*["'][^>]*>[\s\S]*?<img\b[^>]*src=["']([^"']+)["']/i,
    /<meta\s+[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i
  ];

  for (const pat of domPatterns) {
    const m = html.match(pat);
    if (m && m[1]) {
      const url = m[1].replace(/\\\/|\//g, '/').replace(/&amp;/g, '&');
      if (url.startsWith('http') && !url.includes('emoji') && !url.includes('rsrc.php') && !url.includes('static.xx')) {
        return url;
      }
    }
  }

  // 3. High-resolution scontent banner images (-6/ or t39.30808-6 or t39.10873-6)
  const cdnCoverPattern = /https:[\\\/]+[a-z0-9.-]+\.fbcdn\.net[\\\/]v[\\\/](?:t39\.30808-6|t39\.10873-6|t1\.6435-6)[^"'\s<>\\]+/gi;
  const cdnMatches = html.match(cdnCoverPattern);
  if (cdnMatches && cdnMatches.length > 0) {
    for (const rawUrl of cdnMatches) {
      const url = rawUrl.replace(/\\\/|\//g, '/').replace(/&amp;/g, '&');
      if (!url.includes('p50x50') && !url.includes('s150x150') && !url.includes('s24x24') && !url.includes('s32x32') && !url.includes('s40x40')) {
        return url;
      }
    }
  }

  return '';
}

/**
 * Evaluate Cover Photo OCR text:
 * Rejects software sales/vendors immediately if banner displays software brand (Haravan, Sapo, etc.)
 * or sales/agency marketing keywords (Omnichannel, Giải pháp bán hàng, etc.)
 */
export function evaluateCoverPhotoText(text = '') {
  if (!text || typeof text !== 'string') return { isNegative: false, reason: '' };
  const lower = text.toLowerCase();

  // 1. Software brand on cover photo -> Definitive vendor rejection (e.g. Haravan banner for Xuân Phát)
  for (const brand of SOFTWARE_BRANDS) {
    if (lower.includes(brand)) {
      return {
        isNegative: true,
        reason: `Ảnh bìa chứa thương hiệu phần mềm [${brand.toUpperCase()}]`
      };
    }
  }

  // 2. Vendor marketing keywords on cover photo
  for (const kw of VENDOR_COVER_KEYWORDS) {
    if (lower.includes(kw)) {
      return {
        isNegative: true,
        reason: `Ảnh bìa quảng cáo dịch vụ/phần mềm: "${kw}"`
      };
    }
  }

  return { isNegative: false, reason: '' };
}

export function isSalesOrSoftwareVendorName(name = '') {
  if (!name || typeof name !== 'string') return false;
  const lower = name.toLowerCase();

  // 1. Check generic vendor / agency services in name
  for (const kw of VENDOR_NAME_KEYWORDS) {
    if (lower.includes(kw)) return true;
  }

  // 2. Any software brand in name
  for (const brand of SOFTWARE_BRANDS) {
    if (lower.includes(brand)) return true;
  }

  return false;
}

function extractValidProvince(rawText = '') {
  if (!rawText || typeof rawText !== 'string') return '';
  const p = normalizeProvinceName(rawText);
  return (p && p !== '—') ? p : '';
}

/**
 * Fast inspection of candidate member via lightweight HTTP requests (20x faster than Playwright page loads)
 * Queries contact info, bio, timeline, and about sections
 */
export async function inspectMemberViaFastHttp(member, cookieHeader, { excludeSales = true, deepPhoneSearch = true, groupId = '', ownPhones = new Set() } = {}) {
  let phone = '';
  let province = extractValidProvince(member.subtitleText);
  let coverPhotoUrl = '';
  let phoneFromCover = false;

  const headers = {
    'User-Agent': 'curl/8.4.0',
    'Cookie': cookieHeader,
    'Accept': '*/*',
    'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
  };

  // 1. Fetch Group Member Activity (Inspect "Hoạt động mới đây" & "Bài viết trong nhóm")
  if (excludeSales) {
    const groupUserUrl = member.groupUserUrl || (groupId ? `https://www.facebook.com/groups/${groupId}/user/${member.memberId}/` : '');
    if (groupUserUrl) {
      try {
        const resGrp = await fetch(groupUserUrl, { headers, signal: AbortSignal.timeout(3000) });
        if (resGrp.ok) {
          const grpHtml = await resGrp.text();
          if (!coverPhotoUrl) coverPhotoUrl = extractCoverPhotoFromHtml(grpHtml);
          const cleanGrpHtml = sanitizeProfileHtml(grpHtml);
          const evalGrp = evaluateMemberContent(cleanGrpHtml.substring(0, 20000));
          if (evalGrp.isNegative) {
            return { isNegative: true, reason: evalGrp.reason, phone: '', province: '', coverPhotoUrl, phoneFromCover: false };
          }
          if (!phone) {
            const grpPhones = extractPhonesFromText(cleanGrpHtml).filter(p => !ownPhones.has(p));
            if (grpPhones.length > 0) phone = grpPhones[0];
          }
          if (!province) {
            province = extractValidProvince(cleanGrpHtml);
          }
        }
      } catch (e) {}
    }
  }

  // 2 & 3. Fetch Contact Info and Profile Timeline IN PARALLEL for maximum speed
  try {
    const contactUrl = `https://www.facebook.com/${member.memberId}/about_contact_and_basic_info`;
    const profileUrl = `https://www.facebook.com/${member.memberId}`;

    const [contactSettled, profileSettled] = await Promise.allSettled([
      fetch(contactUrl, { headers, signal: AbortSignal.timeout(3000) }),
      fetch(profileUrl, { headers, signal: AbortSignal.timeout(3000) })
    ]);

    // Process Contact Info tab
    if (contactSettled.status === 'fulfilled' && contactSettled.value.ok) {
      const contactHtml = await contactSettled.value.text();
      if (!coverPhotoUrl) coverPhotoUrl = extractCoverPhotoFromHtml(contactHtml);
      const cleanContactHtml = sanitizeProfileHtml(contactHtml);

      if (excludeSales) {
        const evalContact = evaluateMemberContent(cleanContactHtml.substring(0, 10000));
        if (evalContact.isNegative) {
          return { isNegative: true, reason: evalContact.reason, phone: '', province: '', coverPhotoUrl, phoneFromCover: false };
        }
      }

      const foundPhones = extractPhonesFromText(cleanContactHtml).filter(p => !ownPhones.has(p));
      if (foundPhones.length > 0) phone = foundPhones[0];
      if (!province) province = extractValidProvince(cleanContactHtml);
    }

    // Process Profile Overview tab
    if (profileSettled.status === 'fulfilled' && profileSettled.value.ok) {
      const profileHtml = await profileSettled.value.text();
      if (!coverPhotoUrl) coverPhotoUrl = extractCoverPhotoFromHtml(profileHtml);
      const cleanProfileHtml = sanitizeProfileHtml(profileHtml);

      if (excludeSales) {
        const evalProfile = evaluateMemberContent(cleanProfileHtml.substring(0, 15000));
        if (evalProfile.isNegative) {
          return { isNegative: true, reason: evalProfile.reason, phone: '', province: '', coverPhotoUrl, phoneFromCover: false };
        }
      }

      if (!phone) {
        const foundPhones = extractPhonesFromText(cleanProfileHtml).filter(p => !ownPhones.has(p));
        if (foundPhones.length > 0) phone = foundPhones[0];
      }
      if (!province) province = extractValidProvince(cleanProfileHtml);
    }
  } catch (e) {}

  // 4. Fallback: OpenGraph crawler if phone, province, or cover photo is still missing
  if ((!phone || !province || !coverPhotoUrl) && deepPhoneSearch) {
    try {
      const ogUrl = `https://www.facebook.com/profile.php?id=${member.memberId}`;
      const resOg = await fetch(ogUrl, {
        headers: {
          'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
        },
        signal: AbortSignal.timeout(3000)
      });
      if (resOg.ok) {
        const ogHtml = await resOg.text();
        if (!coverPhotoUrl) coverPhotoUrl = extractCoverPhotoFromHtml(ogHtml);
        const cleanOgHtml = sanitizeProfileHtml(ogHtml);
        if (!phone) {
          const ogPhones = extractPhonesFromText(cleanOgHtml).filter(p => !ownPhones.has(p));
          if (ogPhones.length > 0) phone = ogPhones[0];
        }
        if (!province) {
          province = extractValidProvince(cleanOgHtml);
        }
      }
    } catch (e) {}
  }

  // 5. Inspect Cover Photo via OCR / AI Vision (detects sales banners like Haravan/Sapo, and extracts hotline/phone)
  if (coverPhotoUrl) {
    try {
      const ocrData = await ocrManager.inspectImage(coverPhotoUrl);
      if (ocrData) {
        if (excludeSales && ocrData.text) {
          const coverCheck = evaluateCoverPhotoText(ocrData.text);
          if (coverCheck.isNegative) {
            return { isNegative: true, reason: coverCheck.reason, phone: '', province: '', coverPhotoUrl, phoneFromCover: false };
          }
        }
        if (!phone && Array.isArray(ocrData.phones) && ocrData.phones.length > 0) {
          const validOcrPhones = ocrData.phones.filter(p => !ownPhones.has(p));
          if (validOcrPhones.length > 0) {
            phone = validOcrPhones[0];
            phoneFromCover = true;
          }
        }
      }
    } catch (ocrErr) {
      logger.debug({ err: ocrErr.message }, 'Cover photo OCR inspection error');
    }
  }

  return {
    isNegative: false,
    reason: '',
    phone,
    province,
    coverPhotoUrl,
    phoneFromCover
  };
}


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

  // Weekdays (e.g. "Đã tham gia vào thứ Hai", "vào thứ Ba", "Joined on Monday") -> >= 24h-48h -> STOP SCROLLING
  const weekdayPatterns = [
    'thứ hai', 'thu hai', 'thứ ba', 'thu ba', 'thứ tư', 'thu tu',
    'thứ năm', 'thu nam', 'thứ sáu', 'thu sau', 'thứ bảy', 'thu bay',
    'chủ nhật', 'chu nhat', 'monday', 'tuesday', 'wednesday',
    'thursday', 'friday', 'saturday', 'sunday'
  ];
  for (const wd of weekdayPatterns) {
    if (lower.includes(wd)) {
      return { within24h: false, stopScrolling: true, normalizedText: clean };
    }
  }

  // Weeks, months, years -> STOP SCROLLING
  if (lower.includes('tuần') || lower.includes('week') || lower.includes('tháng') || lower.includes('month') || lower.includes('năm') || lower.includes('year')) {
    return { within24h: false, stopScrolling: true, normalizedText: clean };
  }

  // Specific dates (e.g. "15 tháng 8", "August 15") -> STOP SCROLLING
  if (/\d+\s*(?:tháng|thg|\/|-)\s*\d+/i.test(lower)) {
    return { within24h: false, stopScrolling: true, normalizedText: clean };
  }

  // Strict fallback: If it doesn't match any within-24h pattern, it is NOT within 24h
  return { within24h: false, stopScrolling: false, normalizedText: clean };
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

  // 2. Check vendor service keywords directly
  if (lower.includes('phần mềm theo yêu cầu') || lower.includes('phan mem theo yeu cau') ||
      lower.includes('cung cấp phần mềm') || lower.includes('giải pháp phần mềm') ||
      lower.includes('thiết kế web') || lower.includes('setup quán trọn gói') ||
      lower.includes('omnichannel') || lower.includes('website ecom') || lower.includes('bán hàng đa kênh')) {
    return { isNegative: true, reason: 'Phát hiện dịch vụ/đơn vị cung cấp phần mềm / Omnichannel' };
  }

  // 3. Check combination: Brand + Sales CTA
  const matchedBrand = SOFTWARE_BRANDS.find(b => lower.includes(b));
  const matchedCTA = SALE_KEYWORDS.find(k => lower.includes(k));

  if (matchedBrand && matchedCTA) {
    return { isNegative: true, reason: `Phát hiện Sale chào mời PM: [${matchedBrand.toUpperCase()}] kèm ["${matchedCTA}"]` };
  }

  // 4. Check explicit workplace / job title
  const jobPatterns = [
    /làm việc tại\s+.*(sapo|kiotviet|kiot viet|ipos|pos365|misa|omicall|cukcuk|haravan|gosell)/i,
    /chuyên viên\s+.*(sapo|kiotviet|kiot viet|ipos|pos365|misa|omicall|cukcuk|haravan|gosell|tư vấn|kinh doanh)/i,
    /nhân viên\s+.*(sapo|kiotviet|kiot viet|ipos|pos365|misa|omicall|cukcuk|haravan|gosell|kinh doanh)/i,
    /tư vấn\s+.*(sapo|kiotviet|kiot viet|ipos|pos365|misa|omicall|cukcuk|haravan|gosell|phần mềm)/i,
    /sale[s]?\s+.*(sapo|kiotviet|kiot viet|ipos|pos365|misa|omicall|cukcuk|haravan|gosell|phần mềm)/i,
    /đại lý\s+.*(sapo|kiotviet|kiot viet|ipos|pos365|misa|omicall|cukcuk|haravan|gosell|phần mềm)/i,
    /(sapo|kiotviet|kiot viet|ipos|pos365|misa|omicall|cukcuk|haravan|gosell)\s+.*(chuyên viên|nhân viên|tư vấn|sale|kinh doanh|website|omnichannel)/i
  ];
  for (const pat of jobPatterns) {
    if (pat.test(lower)) {
      const matchText = pat.exec(lower)?.[0] || '';
      return { isNegative: true, reason: `Phát hiện chức danh/nghề nghiệp Sale PM (${matchText})` };
    }
  }

  // 5. Standalone aggressive sales patterns
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
    if (this.activeScans.has(clientId)) {
      return this.activeScans.get(clientId);
    }
    // Fail-safe: If only one scan is running, return it so polling never misses it
    if (this.activeScans.size === 1) {
      return this.activeScans.values().next().value;
    }
    return {
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
    let state = this.activeScans.get(clientId);
    if (!state && this.activeScans.size === 1) {
      state = this.activeScans.values().next().value;
    }
    if (state) {
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

    const log = (msg, type = 'info') => {
      const entry = {
        timestamp: Date.now(),
        message: msg,
        type
      };
      state.logs.push(entry);
      if (state.logs.length > 150) state.logs.shift();
      logger.info(`[MEMBER-SCANNER] [${clientId}] ${msg}`);
      this.emit('progress', { clientId, state });
    };

    let context = null;
    let page = null;

    try {
      log('🚀 Đang khởi động trình duyệt Chromium để quét thành viên...', 'info');
      const isHeadless = true;
      context = await browserManager.createClientContext(clientId, isHeadless);

      // Resolve cookie with fallback to active sessions on disk/memory
      let effectiveCookie = cookie;
      if (!effectiveCookie) {
        effectiveCookie = sessionManager.getAnyActiveCookie(clientId);
      }

      if (!effectiveCookie) {
        log('❌ Chưa có Cookie Facebook! Meta chặn xem danh sách thành viên nếu không đăng nhập.', 'error');
        throw new Error('Chưa có Cookie Facebook! Vui lòng vào tab Cài đặt để nạp Cookie trước khi quét.');
      }

      const parsed = Array.isArray(effectiveCookie) ? effectiveCookie : parseCookieInput(effectiveCookie);
      const formatted = parsed.map(c => ({
        name: c.name.trim(),
        value: String(c.value).trim(),
        domain: '.facebook.com',
        path: '/',
        secure: true
      })).filter(c => c.name && c.value);

      if (formatted.length === 0) {
        log('❌ Chuỗi Cookie không hợp lệ (thiếu c_user hoặc xs).', 'error');
        throw new Error('Chuỗi Cookie không hợp lệ! Vui lòng kiểm tra lại Cookie Facebook.');
      }

      const cookieHeader = formatted.map(c => `${c.name}=${c.value}`).join('; ');
      const loggedInUid = formatted.find(c => c.name === 'c_user')?.value || '';
      const ownPhones = new Set();
      if (loggedInUid) {
        try {
          const selfUrl = `https://www.facebook.com/${loggedInUid}/about_contact_and_basic_info`;
          const selfRes = await fetch(selfUrl, {
            headers: {
              'User-Agent': 'curl/8.4.0',
              'Cookie': cookieHeader,
              'Accept': '*/*',
              'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
            },
            signal: AbortSignal.timeout(4000)
          });
          if (selfRes.ok) {
            const selfHtml = await selfRes.text();
            const cleanSelf = sanitizeProfileHtml(selfHtml);
            const detectedOwn = extractPhonesFromText(cleanSelf);
            detectedOwn.forEach(p => ownPhones.add(p));
            if (detectedOwn.length > 0) {
              logger.info(`[MEMBER-SCANNER] Đã nhận diện SĐT tài khoản chủ (sẽ loại trừ khỏi kết quả): ${detectedOwn.join(', ')}`);
            }
          }
        } catch (e) {}
      }

      await context.addCookies(formatted);
      log(`🔑 Đã nạp ${formatted.length} cookies vào trình duyệt Chromium.`, 'info');

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
          log(`🔍 Đang giải mã ID nhóm cho slug [${groupId}]...`, 'info');
          const resolved = await GroupManager.resolveNumericGroupId(groupId);
          if (resolved) groupId = resolved;
        }

        const membersUrl = `https://www.facebook.com/groups/${groupId}/members`;
        state.currentGroup = `Nhóm ${groupId}`;
        log(`📂 Đang mở danh sách thành viên: ${membersUrl}`, 'info');

        const candidateMembers = [];
        const seenMemberIds = new Set();
        let hitTimeLimit = false;

        const addCandidate = (item) => {
          if (!item || !item.memberId) return;
          if (seenMemberIds.has(item.memberId)) return;
          seenMemberIds.add(item.memberId);

          if (isSystemRoleOrInvalidName(item.name)) return;

          // In "Mới vào nhóm", all genuine 24h new members MUST have relative timestamps
          // Silently skip anyone without a join timestamp (Admins, Moderators, or "Thành viên có điểm chung")
          if (!item.joinedTimeText) {
            return;
          }

          const timeCheck = parseMemberJoinedTime(item.joinedTimeText);
          if (timeCheck.stopScrolling) {
            hitTimeLimit = true;
            log(`⏹ Gặp thành viên đã vào nhóm quá 24h: ${item.name} ("${item.joinedTimeText}"). Dừng nạp thêm.`, 'warning');
            return;
          }
          if (!timeCheck.within24h) return;

          // Check sales ONLY after confirming they are genuine 24h new members
          if (excludeSales && isSalesOrSoftwareVendorName(item.name)) {
            state.skippedCount++;
            log(`⏩ [BỎ QUA SALE] Tên tài khoản dịch vụ/phần mềm: ${item.name}`, 'warning');
            return;
          }

          candidateMembers.push(item);
        };

        // Real-time GraphQL Network Interception
        const graphqlListener = async (response) => {
          const resUrl = response.url();
          if (resUrl.includes('/api/graphql') || resUrl.includes('/graphql')) {
            try {
              const text = await response.text().catch(() => '');
              if (!text) return;
              const jsonObjects = safeParseGraphQLResponses(text);
              for (const json of jsonObjects) {
                const found = extractMembersFromAnyJson(json, groupId);
                for (const m of found) {
                  addCandidate(m);
                }
              }
            } catch (e) {}
          }
        };

        page.on('response', graphqlListener);

        try {
          await page.goto(membersUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
          await delay(2500);

          // Check if Facebook redirected to Login Wall
          const isLoginPage = await page.evaluate(() => {
            const t = (document.title || '').toLowerCase();
            const b = (document.body?.innerText || '').toLowerCase();
            return t.includes('log in') || t.includes('đăng nhập') ||
                   b.includes('join or log in to facebook') || b.includes('đăng nhập facebook') ||
                   document.querySelector('input[type="password"]') !== null;
          });

          if (isLoginPage) {
            log('❌ TRÌNH DUYỆT BỊ CHẶN BỞI TRANG ĐĂNG NHẬP FACEBOOK!', 'error');
            log('👉 Cookie hiện tại không có quyền truy cập hoặc đã hết hạn. Vui lòng lấy lại Cookie mới từ Facebook của bạn!', 'error');
            page.off('response', graphqlListener);
            continue;
          }

          // Check if Private Group is locked
          const isPrivateLocked = await page.evaluate(() => {
            const b = (document.body?.innerText || '').toLowerCase();
            return (b.includes('nhóm riêng tư') || b.includes('private group')) &&
                   (b.includes('tham gia nhóm') || b.includes('join group'));
          });

          if (isPrivateLocked) {
            log(`⚠️ Nhóm [${groupId}] là nhóm Riêng tư và tài khoản của bạn chưa là thành viên. Vui lòng tham gia nhóm trước!`, 'warning');
            page.off('response', graphqlListener);
            continue;
          }

          // Step: Auto-anchor and scroll directly into "Mới vào nhóm" section
          log('🎯 Đang định vị và cuộn trực tiếp tới khu vực "Mới vào nhóm"...', 'info');
          const anchorResult = await page.evaluate(() => {
            const headings = Array.from(document.querySelectorAll('h2, h3, span, div[role="heading"]'));
            for (const h of headings) {
              const text = (h.innerText || '').trim().toLowerCase();
              if (text === 'mới vào nhóm' || text === 'new to the group' || text.startsWith('mới vào nhóm') || text.startsWith('new to the group')) {
                h.scrollIntoView({ behavior: 'instant', block: 'start' });
                return true;
              }
            }
            return false;
          });
          if (anchorResult) {
            await delay(1200);
          }

          // Phase 1: Fast Instant JSON Extraction from SSR Script Tags (Targeting new_members & join_time)
          log('⚡ [QUÉT NHANH JSON] Đang trích xuất thành viên mới từ dữ liệu JSON gốc của Facebook...', 'info');
          const jsonMembers = await page.evaluate((currentGroupId) => {
            const scripts = Array.from(document.querySelectorAll('script[type="application/json"]'));
            const found = [];
            for (const s of scripts) {
              const text = s.textContent || '';
              if (text.includes('new_members') || text.includes('new_forum_members') || (text.includes('join_time') && text.includes('name'))) {
                try {
                  const data = JSON.parse(text);
                  const queue = [data];
                  while (queue.length > 0) {
                    const cur = queue.pop();
                    if (!cur || typeof cur !== 'object') continue;
                    const node = cur.node || cur;
                    const id = node.id || node.user_id || node.uid;
                    const name = node.name || node.text || node.title?.text;
                    if (id && name && typeof name === 'string' && /^\d{5,}$/.test(String(id))) {
                      let joinedText = '';
                      let subtitleText = '';
                      const texts = [
                        node.subtitle_text?.text,
                        node.subtitle?.text,
                        node.join_time_text,
                        cur.subtitle_text?.text
                      ].filter(Boolean);
                      for (const t of texts) {
                        const low = String(t).toLowerCase();
                        if (low.includes('tham gia') || low.includes('trước') || low.includes('hôm nay') || low.includes('joined') || low.includes('vừa xong')) {
                          if (!joinedText) joinedText = String(t).trim();
                        } else if (!subtitleText) {
                          subtitleText = String(t).trim();
                        }
                      }
                      if (joinedText) {
                        found.push({
                          memberId: String(id),
                          name: String(name).trim(),
                          groupUserUrl: `https://www.facebook.com/groups/${currentGroupId}/user/${id}/`,
                          joinedTimeText: joinedText,
                          subtitleText: subtitleText
                        });
                      }
                    }
                    for (const k of Object.keys(cur)) {
                      if (typeof cur[k] === 'object' && cur[k] !== null) queue.push(cur[k]);
                    }
                  }
                } catch (e) {}
              }
            }
            return found;
          }, groupId);

          for (const m of jsonMembers) {
            addCandidate(m);
          }

          if (candidateMembers.length > 0) {
            log(`⚡ [JSON NHANH] Đã bóc tách được ${candidateMembers.length} thành viên trực tiếp từ JSON!`, 'success');
          }

          // Phase 2: Scroll to trigger GraphQL pagination & DOM updates inside "Mới vào nhóm"
          log('📜 Đang cuộn trang để nạp thành viên mới qua GraphQL & DOM...', 'info');
          let noNewCount = 0;
          let prevCandidateCount = candidateMembers.length;

          for (let scrollStep = 0; scrollStep < 35; scrollStep++) {
            if (state.abortRequested || hitTimeLimit) break;
            if (candidateMembers.length >= maxMembersPerGroup) break;

            await page.evaluate(() => {
              window.scrollBy(0, 1000);
              if (document.scrollingElement) {
                document.scrollingElement.scrollTop += 1000;
              }
            });
            await delay(1200);

            // DOM extraction fallback
            const domMembers = await page.evaluate((currentGroupId) => {
              const userLinks = Array.from(document.querySelectorAll('a[href*="/user/"], a[role="link"][href*="/groups/"]'));
              const results = [];
              const blacklist = [
                'kiểm duyệt', 'kiem duyet', 'đóng góp', 'dong gop',
                'quản trị', 'quan tri', 'chuyên gia', 'admin', 'moderator',
                'thành viên', 'thanh vien', 'xem tất cả', 'bạn bè'
              ];

              for (const a of userLinks) {
                const href = a.getAttribute('href') || '';
                const mId = href.match(/\/user\/(\d+)/i) || href.match(/\/user\/([^/?]+)/i);
                if (!mId) continue;
                const memberId = mId[1];
                if (!memberId || memberId === currentGroupId || memberId.toLowerCase() === 'members') continue;

                const container = a.closest('div[role="listitem"]') ||
                                  a.closest('div[data-visualcompletion="ignore-dynamic-snippet"]') ||
                                  a.parentElement?.parentElement?.parentElement ||
                                  a.parentElement?.parentElement;
                if (!container) continue;

                const nameEl = container.querySelector('a[role="link"] span, strong, h3');
                const name = (nameEl ? nameEl.textContent : a.textContent || '').trim();
                if (!name || name.length < 2) continue;

                const lowerName = name.toLowerCase();
                if (blacklist.some(b => lowerName.includes(b))) continue;

                const rawLines = (container.innerText || container.textContent || '')
                  .split('\n')
                  .map(l => l.trim())
                  .filter(Boolean);

                let joinedTimeText = '';
                let subtitleText = '';

                for (const line of rawLines) {
                  const lowerL = line.toLowerCase();
                  if (lowerL.includes('tham gia') || lowerL.includes('trước') || lowerL.includes('hôm nay') || lowerL.includes('joined') || lowerL.includes('thêm vào') || lowerL.includes('vừa xong')) {
                    if (!joinedTimeText) joinedTimeText = line;
                  } else if (line !== name && !line.includes('Theo dõi') && !line.includes('Thêm bạn bè') && !line.includes('Nhắn tin') && !line.includes('Thành viên')) {
                    if (!subtitleText) subtitleText = line;
                  }
                }

                // Strictly require joinedTimeText so only the 24h new members section is collected
                if (!joinedTimeText) continue;

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

            for (const m of domMembers) {
              addCandidate(m);
              if (hitTimeLimit || candidateMembers.length >= maxMembersPerGroup) break;
            }

            if (candidateMembers.length === prevCandidateCount) {
              noNewCount++;
              if (noNewCount >= 8) {
                log('📄 Đã cuộn hết danh sách thành viên mới trong 24h.', 'info');
                break;
              }
            } else {
              noNewCount = 0;
              prevCandidateCount = candidateMembers.length;
            }
          }

          page.off('response', graphqlListener);

          log(`👥 Đã thu thập được ${candidateMembers.length} thành viên mới trong 24h. Bắt đầu thẩm định siêu tốc qua API...`, 'info');

          // Inspect candidate members via high-speed parallel HTTP API workers (Concurrency = 3)
          const CONCURRENCY = 3;
          let candidateIndex = 0;

          const inspectWorker = async () => {
            while (candidateIndex < candidateMembers.length) {
              if (state.abortRequested) break;
              const idx = candidateIndex++;
              const member = candidateMembers[idx];
              state.processedMembers++;

              log(`🔍 [${state.processedMembers}/${candidateMembers.length}] Đang kiểm tra: ${member.name} (${member.joinedTimeText || '24h qua'})`, 'info');

              // Tier 1: Fast check on name and subtitle
              if (excludeSales) {
                if (isSalesOrSoftwareVendorName(member.name)) {
                  state.skippedCount++;
                  log(`⏩ [BỎ QUA SALE] Tên tài khoản dịch vụ/phần mềm: ${member.name}`, 'warning');
                  continue;
                }
                const t1Check = evaluateMemberContent(`${member.name} ${member.subtitleText}`);
                if (t1Check.isNegative) {
                  state.skippedCount++;
                  log(`⏩ [TẦNG 1] Bỏ qua ${member.name}: ${t1Check.reason}`, 'warning');
                  continue;
                }
              }

              // High-speed HTTP API inspection (Group Activity, Contact Info, Bio, Timeline, Cover Photo OCR)
              let inspectResult = { isNegative: false, reason: '', phone: '', province: '', coverPhotoUrl: '', phoneFromCover: false };
              try {
                inspectResult = await inspectMemberViaFastHttp(member, cookieHeader, {
                  excludeSales,
                  deepPhoneSearch,
                  groupId,
                  ownPhones
                });
              } catch (inspectErr) {
                logger.debug({ err: inspectErr.message }, 'Member HTTP inspection error');
              }

              if (inspectResult.isNegative) {
                state.skippedCount++;
                log(`⏩ [BỎ QUA SALE/THANH LÝ] ${member.name}: ${inspectResult.reason}`, 'warning');
                continue;
              }

              let phone = inspectResult.phone || '';
              const province = inspectResult.province || '';
              let coverPhotoUrl = inspectResult.coverPhotoUrl || '';

              // Playwright fallback for cover photo if not found via fast HTTP
              if (!coverPhotoUrl && page && !page.isClosed()) {
                try {
                  const groupUserUrl = member.groupUserUrl || (groupId ? `https://www.facebook.com/groups/${groupId}/user/${member.memberId}/` : '');
                  if (groupUserUrl) {
                    coverPhotoUrl = await page.evaluate(async (url) => {
                      try {
                        const res = await fetch(url, { credentials: 'include' });
                        if (!res.ok) return '';
                        const html = await res.text();
                        const m = html.match(/"(?:cover_photo|coverPhoto|profile_cover)"\s*:\s*\{[^}]*?"uri"\s*:\s*"([^"]+)"/i)
                               || html.match(/"(?:cover_photo|coverPhoto|profile_cover)"\s*:\s*\{[^}]*?"image"\s*:\s*\{[^}]*?"uri"\s*:\s*"([^"]+)"/i)
                               || html.match(/<img\b[^>]*data-imgperflogname=["']profileCoverPhoto["'][^>]*src=["']([^"']+)["']/i)
                               || html.match(/<div\b[^>]*aria-label=["'][^"']*(?:Ảnh bìa|Cover photo)[^"']*["'][^>]*>[\s\S]*?<img\b[^>]*src=["']([^"']+)["']/i)
                               || html.match(/https:[\\\/]+[a-z0-9.-]+\.fbcdn\.net[\\\/]v[\\\/](?:t39\.30808-6|t39\.10873-6)[^"'\s<>\\]+/i);
                        if (m && m[1]) return m[1].replace(/\\\/|\//g, '/').replace(/&amp;/g, '&');
                        if (m && typeof m[0] === 'string' && m[0].startsWith('http')) return m[0].replace(/\\\/|\//g, '/').replace(/&amp;/g, '&');
                        return '';
                      } catch (e) {
                        return '';
                      }
                    }, groupUserUrl);
                  }
                } catch (evalErr) {
                  logger.debug({ err: evalErr.message }, 'Playwright page.evaluate cover fetch error');
                }
              }

              // Inspect Cover Photo with OCR / AI Vision if found via fallback
              if (coverPhotoUrl && !inspectResult.coverPhotoUrl) {
                try {
                  const ocrData = await ocrManager.inspectImage(coverPhotoUrl);
                  if (ocrData) {
                    if (excludeSales && ocrData.text) {
                      const coverCheck = evaluateCoverPhotoText(ocrData.text);
                      if (coverCheck.isNegative) {
                        state.skippedCount++;
                        log(`⏩ [BỎ QUA SALE ẢNH BÌA] ${member.name}: ${coverCheck.reason}`, 'warning');
                        continue;
                      }
                    }
                    if (!phone && Array.isArray(ocrData.phones) && ocrData.phones.length > 0) {
                      const validOcrPhones = ocrData.phones.filter(p => !ownPhones.has(p));
                      if (validOcrPhones.length > 0) {
                        phone = validOcrPhones[0];
                        log(`📸 [OCR ẢNH BÌA] Đã nhận diện SĐT từ ảnh bìa của ${member.name}: ${phone}`, 'success');
                      }
                    }
                  }
                } catch (ocrErr) {
                  logger.debug({ err: ocrErr.message }, 'Cover photo OCR error');
                }
              }

              if (phone) {
                if (inspectResult.phoneFromCover) {
                  log(`📸 [OCR ẢNH BÌA] Đã nhận diện SĐT từ ảnh bìa của ${member.name}: ${phone}`, 'success');
                } else {
                  log(`📞 Tìm thấy SĐT của ${member.name}: ${phone}`, 'success');
                }
              }
              if (province) {
                log(`📍 Xác định địa phương của ${member.name}: ${province}`, 'info');
              }

              // Record qualified lead
              const profileUrl = `https://www.facebook.com/${member.memberId}`;
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
                coverPhotoUrl: coverPhotoUrl || '',
                scannedAt: new Date().toLocaleString('vi-VN')
              };

              state.qualifiedLeads++;
              state.leads.unshift(qualifiedLead);
              log(`⭐ [LEAD HỢP LỆ #${state.qualifiedLeads}] ${member.name} | Tỉnh: ${province || '(Trống)'} | SĐT: ${phone || '(Trống)'}`, 'success');

              this.emit('lead', { clientId, lead: qualifiedLead });
              this.emit('progress', { clientId, state });

              await delay(80);
            }
          };

          const pool = Array.from({ length: Math.min(CONCURRENCY, candidateMembers.length) }, () => inspectWorker());
          await Promise.all(pool);

        } catch (grpErr) {
          log(`❌ Lỗi khi xử lý nhóm [${groupId}]: ${grpErr.message}`, 'error');
        }
      }

      log(`🎉 Hoàn tất tiến trình quét! Đã kiểm tra: ${state.processedMembers}, Bỏ qua (Sale/Thanh lý): ${state.skippedCount}, Thu được: ${state.qualifiedLeads} leads chất lượng.`, 'success');

    } catch (err) {
      log(`❌ Lỗi hệ thống khi quét thành viên: ${err.message}`, 'error');
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
