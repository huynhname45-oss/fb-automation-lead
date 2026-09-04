import EventEmitter from 'events';
import browserManager from './browser-manager.js';
import configManager from './config-manager.js';
import logger from './logger.js';
import { processResults, generateExcerpt, generateSummary } from './data-processor.js';
import historyManager from './history-manager.js';
import { extractPhonesFromText, mergePhoneEvidence, mergePhoneEvidenceCollections } from './phone-validator.js';
import { extractLocationDetailed } from './location-extractor.js';
import leadFilter from './lead-filter.js';
import ocrManager from './ocr-manager.js';
import aiLeadEvaluator from './ai-lead-evaluator.js';
import fsSync from 'fs';
import path from 'path';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export function getLoggedInUserUid() {
  try {
    const sessionFile = path.join(process.cwd(), 'session', 'facebook.json');
    if (fsSync.existsSync(sessionFile)) {
      const raw = fsSync.readFileSync(sessionFile, 'utf-8');
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.cookies)) {
        const cUser = data.cookies.find(c => c.name === 'c_user');
        if (cUser && cUser.value) return String(cUser.value).trim();
      }
    }
  } catch (e) {}
  return '';
}

export function normalizeTargetAccepted(maxPosts, fallbackValue = 50) {
  const parsed = parseInt(maxPosts, 10);
  if (!isNaN(parsed) && parsed > 0) return parsed;
  const fallbackParsed = parseInt(fallbackValue, 10);
  return (!isNaN(fallbackParsed) && fallbackParsed > 0) ? fallbackParsed : 50;
}

/**
 * Robust Vietnamese & English Relative Time Resolver for Facebook Posts
 * Returns structured TimeResult. Does NOT fail-open on unknown/invalid strings.
 */
export function resolveTimeResult({ timeText = '', rawContent = '', recencyHours = 72, now = new Date() } = {}) {
  const cleanTime = (timeText || '').trim().toLowerCase();
  const nowTs = (now instanceof Date ? now : new Date(now)).getTime();

  if (!cleanTime || cleanTime.length > 60) {
    return {
      status: 'unknown',
      publishedAt: null,
      earliestAt: null,
      latestAt: null,
      source: 'feed_text',
      confidence: 0.1,
      withinRequestedWindow: false,
      isWithin24h: false,
      formattedDate: (cleanTime && cleanTime.length <= 60) ? timeText : 'Không xác định',
      fullContent: rawContent
    };
  }

  // 1. Instant / Just now
  if (/(?:^|\s)(?:vừa xong|vua xong|just now)(?:\s|$|[^\p{L}\p{N}])/iu.test(cleanTime)) {
    const iso = new Date(nowTs).toISOString();
    return {
      status: 'exact',
      publishedAt: iso,
      earliestAt: iso,
      latestAt: iso,
      source: 'feed_text',
      confidence: 0.95,
      withinRequestedWindow: true,
      isWithin24h: true,
      formattedDate: timeText,
      fullContent: rawContent
    };
  }

  // 2. Relative minutes
  const minMatch = cleanTime.match(/(?:^|\s)(\d+)\s*(?:giây|giay|phút|phut|min|m)(?:\s|$|[^\p{L}\p{N}])/iu);
  if (minMatch) {
    const mins = parseInt(minMatch[1], 10);
    const targetTs = nowTs - mins * 60 * 1000;
    const iso = new Date(targetTs).toISOString();
    const diffHours = mins / 60;
    return {
      status: 'range',
      publishedAt: iso,
      earliestAt: new Date(targetTs - 60000).toISOString(),
      latestAt: new Date(targetTs + 60000).toISOString(),
      source: 'feed_text',
      confidence: 0.9,
      withinRequestedWindow: diffHours <= recencyHours,
      isWithin24h: diffHours <= 24,
      formattedDate: timeText,
      fullContent: rawContent
    };
  }

  // 3. Relative hours
  const hourMatch = cleanTime.match(/(?:^|\s)(\d+)\s*(?:giờ|gio|hours?|h)(?:\s|$|[^\p{L}\p{N}])/iu);
  if (hourMatch) {
    const hours = parseInt(hourMatch[1], 10);
    const targetTs = nowTs - hours * 3600 * 1000;
    const iso = new Date(targetTs).toISOString();
    return {
      status: 'range',
      publishedAt: iso,
      earliestAt: new Date(targetTs - 1800000).toISOString(),
      latestAt: new Date(targetTs + 1800000).toISOString(),
      source: 'feed_text',
      confidence: 0.9,
      withinRequestedWindow: hours <= recencyHours,
      isWithin24h: hours <= 24,
      formattedDate: timeText,
      fullContent: rawContent
    };
  }

  // 4. "Hôm qua" / "yesterday" (range between yesterday 00:00 and yesterday 23:59:59)
  if (/(?:^|\s)(?:hôm qua|hom qua|yesterday)(?:\s|$|[^\p{L}\p{N}])/iu.test(cleanTime)) {
    const nowDate = new Date(nowTs);
    const yStart = new Date(nowDate);
    yStart.setDate(yStart.getDate() - 1);
    yStart.setHours(0, 0, 0, 0);
    const yEnd = new Date(nowDate);
    yEnd.setDate(yEnd.getDate() - 1);
    yEnd.setHours(23, 59, 59, 999);

    const diffHoursToYesterdayEnd = (nowTs - yEnd.getTime()) / (3600 * 1000);
    const diffHoursToYesterdayStart = (nowTs - yStart.getTime()) / (3600 * 1000);

    return {
      status: 'range',
      publishedAt: yEnd.toISOString(),
      earliestAt: yStart.toISOString(),
      latestAt: yEnd.toISOString(),
      source: 'feed_text',
      confidence: 0.85,
      withinRequestedWindow: diffHoursToYesterdayEnd <= recencyHours,
      isWithin24h: diffHoursToYesterdayStart <= 24,
      formattedDate: timeText,
      fullContent: rawContent
    };
  }

  // 4.1. "Hôm nay" / "today" (today at HH:mm)
  const todayMatch = cleanTime.match(/(?:hôm nay|hom nay|today)(?:\s+(?:lúc|at))?\s*(\d{1,2}):(\d{2})/iu);
  if (todayMatch) {
    const d = new Date(nowTs);
    d.setHours(parseInt(todayMatch[1], 10), parseInt(todayMatch[2], 10), 0, 0);
    const diffHours = (nowTs - d.getTime()) / (3600 * 1000);
    return {
      status: 'exact',
      publishedAt: d.toISOString(),
      earliestAt: d.toISOString(),
      latestAt: d.toISOString(),
      source: 'feed_text',
      confidence: 0.95,
      withinRequestedWindow: diffHours >= 0 && diffHours <= recencyHours,
      isWithin24h: diffHours >= 0 && diffHours <= 24,
      formattedDate: timeText,
      fullContent: rawContent
    };
  }

  // 4.2. Specific calendar date (e.g. "1 tháng 9 lúc 10:49", "01/09/2026", "1 Tháng 9")
  const dateMatch = cleanTime.match(/(?:ngày\s+)?(\d{1,2})(?:\s+tháng\s+|[\/\-])(\d{1,2})(?:[\/\-](\d{4}))?(?:(?:\s+lúc|\s+at)?\s*(\d{1,2}):(\d{2}))?/iu);
  if (dateMatch) {
    const day = parseInt(dateMatch[1], 10);
    const month = parseInt(dateMatch[2], 10) - 1;
    const year = dateMatch[3] ? parseInt(dateMatch[3], 10) : new Date(nowTs).getFullYear();
    const hours = dateMatch[4] ? parseInt(dateMatch[4], 10) : 12;
    const mins = dateMatch[5] ? parseInt(dateMatch[5], 10) : 0;
    
    let postDate = new Date(year, month, day, hours, mins, 0);
    if (!dateMatch[3] && postDate.getTime() > nowTs + 3600 * 1000) {
      postDate.setFullYear(year - 1);
    }
    const diffHours = (nowTs - postDate.getTime()) / (3600 * 1000);
    return {
      status: 'exact',
      publishedAt: postDate.toISOString(),
      earliestAt: postDate.toISOString(),
      latestAt: postDate.toISOString(),
      source: 'feed_text',
      confidence: 0.9,
      withinRequestedWindow: diffHours >= 0 && diffHours <= recencyHours,
      isWithin24h: diffHours >= 0 && diffHours <= 24,
      formattedDate: timeText,
      fullContent: rawContent
    };
  }

  // 5. Relative days (e.g. "2 ngày", "3 ngày", "4 ngày")
  const dayMatch = cleanTime.match(/(?:^|\s)(\d+)\s*(?:ngày|ngay|days?|d)(?:\s|$|[^\p{L}\p{N}])/iu);
  if (dayMatch) {
    const days = parseInt(dayMatch[1], 10);
    const diffHours = days * 24;
    const targetTs = nowTs - days * 24 * 3600 * 1000;
    return {
      status: 'range',
      publishedAt: new Date(targetTs).toISOString(),
      earliestAt: new Date(targetTs - 12 * 3600 * 1000).toISOString(),
      latestAt: new Date(targetTs + 12 * 3600 * 1000).toISOString(),
      source: 'feed_text',
      confidence: 0.8,
      withinRequestedWindow: recencyHours > 24 && diffHours <= recencyHours,
      isWithin24h: false,
      formattedDate: timeText,
      fullContent: rawContent
    };
  }

  // 6. Definite Old indicators (> weeks, months, years, old calendar years)
  if (/(?:^|\s)(?:\d+\s*(?:tuần|tuan|weeks?|tháng|thang|months?|năm|nam|years?)|năm 202[0-5])(?:\s|$|[^\p{L}\p{N}])/iu.test(cleanTime)) {
    return {
      status: 'range',
      publishedAt: null,
      earliestAt: null,
      latestAt: null,
      source: 'feed_text',
      confidence: 0.9,
      withinRequestedWindow: false,
      isWithin24h: false,
      formattedDate: timeText,
      fullContent: rawContent
    };
  }

  // Default fallback: unknown, strictly not within window
  return {
    status: 'unknown',
    publishedAt: null,
    earliestAt: null,
    latestAt: null,
    source: 'feed_text',
    confidence: 0.2,
    withinRequestedWindow: false,
    isWithin24h: false,
    formattedDate: timeText,
    fullContent: rawContent
  };
}

/**
 * Returns true/false when the selected Facebook year can be determined from
 * evidence, otherwise null. `null` must be reviewed rather than accepted.
 */
export function matchesSelectedYear(timeResult = {}, selectedYear = '') {
  const targetYear = Number.parseInt(selectedYear, 10);
  if (!Number.isInteger(targetYear) || targetYear < 2000 || targetYear > 2100) return true;

  const dateValues = [timeResult.publishedAt, timeResult.earliestAt, timeResult.latestAt]
    .filter(Boolean)
    .map(value => new Date(value))
    .filter(date => !Number.isNaN(date.getTime()));
  if (dateValues.length === 0) return null;

  return dateValues.some(date => date.getFullYear() === targetYear);
}

export function getCleanCanonicalFacebookUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let url = rawUrl.trim();
  if (url.startsWith('/')) {
    url = 'https://www.facebook.com' + url;
  }
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('facebook.com')) {
      parsed.hostname = 'www.facebook.com';
    }
    const paramsToKeep = ['story_fbid', 'id', 'fbid', 'set', 'v'];
    const newParams = new URLSearchParams();
    for (const key of paramsToKeep) {
      if (parsed.searchParams.has(key)) {
        newParams.set(key, parsed.searchParams.get(key));
      }
    }
    const cleanSearch = newParams.toString();
    return `${parsed.origin}${parsed.pathname}${cleanSearch ? '?' + cleanSearch : ''}`;
  } catch (e) {
    return url.split('?__cft__')[0].split('&__cft__')[0].split('?ref=')[0];
  }
}

/**
 * Extract Numeric User ID (UID) from Facebook URL string if present
 */
export function extractUidFromUrl(profileUrl = '') {
  if (!profileUrl || typeof profileUrl !== 'string') return '';
  const raw = profileUrl.trim();

  // 1. Numeric query parameter ?id=1000...
  const idParamMatch = raw.match(/[?&]id=(\d+)/i);
  if (idParamMatch && idParamMatch[1]) return idParamMatch[1];

  // 2. Path /groups/.../user/1000... or /user/1000...
  const groupUserMatch = raw.match(/\/groups\/[^/]+\/user\/(\d+)/i) || raw.match(/\/user\/(\d+)/i);
  if (groupUserMatch && groupUserMatch[1]) return groupUserMatch[1];

  // 3. Path /profile/1000...
  const profilePathMatch = raw.match(/\/profile\/(\d+)/i);
  if (profilePathMatch && profilePathMatch[1]) return profilePathMatch[1];

  // 4. Path /people/.../1000...
  const peopleMatch = raw.match(/\/people\/[^/]+\/(\d+)/i);
  if (peopleMatch && peopleMatch[1]) return peopleMatch[1];

  // 4. Raw UID string or numeric path
  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    const pathname = u.pathname.replace(/^\/+|\/+$/g, '');
    const numericOnly = pathname.match(/^(\d{8,})$/);
    if (numericOnly && numericOnly[1]) return numericOnly[1];
  } catch (e) {
    if (/^\d{8,}$/.test(raw)) return raw;
  }

  return '';
}

/**
 * Build Direct Profile Timeline Search URL (ALWAYS https://www.facebook.com/profile/{UID}/search/?q=...)
 */
export function buildProfileSearchUrl(profileUrlOrUid = '', keyword = 'lh') {
  if (!profileUrlOrUid || typeof profileUrlOrUid !== 'string') return '';
  const kw = encodeURIComponent(keyword.trim());
  const uid = extractUidFromUrl(profileUrlOrUid);
  if (uid) {
    return `https://www.facebook.com/profile/${uid}/search/?q=${kw}`;
  }
  return '';
}

/**
 * Canonical Author Key (SEARCH-P0-004)
 * Distinguishes different people with the same display name based on profile URL / ID.
 */
export function getCanonicalAuthorKey(post = {}) {
  const profileLink = (post.profileLink || post.authorUrl || '').trim();
  const authorName = (post.authorName || '').toLowerCase().replace(/\s+/g, ' ').trim();

  if (profileLink) {
    // 1. Extract id parameter if profile.php?id=12345
    const idMatch = profileLink.match(/[?&]id=(\d+)/i);
    if (idMatch && idMatch[1]) {
      return `author_id_${idMatch[1]}`;
    }

    // 2. Extract username from facebook.com/username
    try {
      const u = new URL(profileLink.startsWith('http') ? profileLink : `https://${profileLink}`);
      const pathname = u.pathname.replace(/^\/+|\/+$/g, '');
      if (pathname && !['profile.php', 'people', 'groups', 'pages'].includes(pathname.toLowerCase())) {
        const firstSegment = pathname.split('/')[0];
        if (firstSegment && firstSegment.length >= 2) {
          return `author_user_${firstSegment.toLowerCase()}`;
        }
      }
    } catch (e) {}

    const cleanUrl = getCleanCanonicalFacebookUrl(profileLink);
    if (cleanUrl) {
      return `author_url_${cleanUrl.toLowerCase()}`;
    }
  }

  // 3. Fallback to normalized author name if profile link is missing
  return `author_name_${authorName || 'unknown'}`;
}

/**
 * Checks if a comment is from the author of the post (SEARCH-P0-014)
 * Strict badge & exact normalized name match (no loose substring overlap).
 */
export function isAuthorCommentMatch({ commentAuthorName = '', commentText = '', targetAuthorName = '' } = {}) {
  const cleanCommentText = (commentText || '').trim();
  
  // 1. Only Facebook's author badge is ownership evidence. A pinned comment
  // can belong to anyone and must never be treated as the post author.
  const hasAuthorBadge = /(?:^|\s|[^\p{L}\p{N}])(?:tác giả|tac gia|author|người tạo bài viết|người tạo|nguoi tao)(?:\s|$|[^\p{L}\p{N}])/iu.test(cleanCommentText);
  if (hasAuthorBadge) {
    return true;
  }

  // 2. Exact Author Name Match (case-insensitive & whitespace-normalized)
  const normCommentAuthor = (commentAuthorName || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const normTargetAuthor = (targetAuthorName || '').toLowerCase().replace(/\s+/g, ' ').trim();

  if (normCommentAuthor && normTargetAuthor && normCommentAuthor === normTargetAuthor) {
    return true;
  }

  return false;
}

export function createReviewRecord({
  post = {},
  authorKey = '',
  reasonCode = 'NEEDS_REVIEW',
  reason = 'Cần kiểm tra thủ công',
  timeResult = null,
  phoneEvidence = [],
  locationResult = null,
  aiResult = null
} = {}) {
  const verifiedPhones = phoneEvidence.filter(item => item?.verified === true).map(item => item.phone);
  const allPhones = phoneEvidence.map(item => item?.phone).filter(Boolean);
  return {
    authorName: post.authorName || 'Không xác định',
    authorKey,
    location: locationResult?.confidence >= 0.75 && !locationResult?.conflict
      ? locationResult.province
      : '—',
    locationSource: locationResult?.source || 'unknown',
    locationConfidence: locationResult?.confidence || 0,
    locationEvidence: Array.isArray(locationResult?.evidence) ? locationResult.evidence : [],
    postedTime: post.feedTimeText || 'Không xác định',
    timeStatus: timeResult?.status || 'unknown',
    timeConfidence: timeResult?.confidence || 0,
    content: post.content || '',
    summary: aiResult?.summary || reason,
    aiScore: typeof aiResult?.score === 'number' ? aiResult.score : undefined,
    businessType: aiResult?.businessType || 'Chưa xác định',
    intent: aiResult?.intent || 'Cần kiểm tra',
    salesPitch: aiResult?.salesPitch || '',
    recommendedFeatures: aiResult?.recommendedFeatures || '',
    aiReason: aiResult?.reason || reason,
    postLink: post.postLink ? getCleanCanonicalFacebookUrl(post.postLink) : '',
    profileLink: post.profileLink ? getCleanCanonicalFacebookUrl(post.profileLink) : '',
    phones: allPhones,
    verifiedPhones,
    phoneEvidence,
    decision: 'REVIEW',
    decisionReasons: [reasonCode],
    status: 'Cần kiểm tra',
    supportingPosts: []
  };
}

/**
 * A phone visible in a post is not automatically the author's phone. Mark it
 * as contact evidence only when a contact label appears next to that number.
 */
export function isPhoneExplicitlyContactLabeled(content = '', phone = '') {
  const normalized = String(phone).replace(/\D/g, '');
  if (!content || normalized.length < 10 || !normalized.startsWith('0')) return false;

  const suffixPattern = normalized.substring(1).split('').join('[\\s.()\\-_]*');
  const phonePattern = `(?:0|\\+?84)[\\s.()\\-_]*${suffixPattern}`;
  const contactLabel = '(?:☎|📞|📱|hotline|sđt|sdt|đt|dt|lh|zalo|liên\\s*hệ|liên\\s*lạc|điện\\s*thoại|phone|tel|gọi|call|đặt\\s*bàn|booking|order|ship|tư\\s*vấn|cskh|nhượng\\s*quyền|alo|inbox|ib)';
  const labeledPhone = new RegExp(`(?:${contactLabel}[\\s\\S]{0,35}?${phonePattern}|${phonePattern}[\\s\\S]{0,16}?${contactLabel})`, 'i');
  return labeledPhone.test(content);
}

class SearchEngine extends EventEmitter {
  constructor() {
    super();
    this.status = 'idle';
    this.found = 0;
    this.acceptedCount = 0;
    this.reviewCount = 0;
    this.rejectedCount = 0;
    this.total = 0;
    this.isStopped = false;
    this.results = [];
  }

  async search(keyword, filters = {}, maxPosts = null) {
    this.status = 'searching';
    this.found = 0;
    this.acceptedCount = 0;
    this.reviewCount = 0;
    this.rejectedCount = 0;

    const isHeadless = !!configManager.get('headless');
    const crawlDelay = parseInt(configManager.get('crawlDelay'), 10) || 2000;
    const targetAccepted = normalizeTargetAccepted(maxPosts, configManager.get('maxPosts') || 50);

    const rawExcludes = filters.excludeKeywords || [];
    const excludeKeywords = (Array.isArray(rawExcludes) ? rawExcludes : String(rawExcludes).split(/[,，]+/))
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);

    this.total = targetAccepted;
    this.isStopped = false;
    this.results = [];
    this.emit('progress', this.getProgress());

    logger.info(`⚙️ [ÁP DỤNG CẤU HÌNH] Chế độ Headless: ${isHeadless ? 'BẬT (Chạy ngầm)' : 'TẮT (Hiện trình duyệt)'} | Thời gian chờ: ${crawlDelay}ms | Số bài cần bóc tách: ${targetAccepted}`);
    if (excludeKeywords.length > 0) {
      logger.info(`🚫 [DANH SÁCH TỪ KHÓA LOẠI BỎ]: [${excludeKeywords.join(', ')}]`);
    }

    const filterConfig = {
      excludeEnterpriseChains: configManager.get('excludeEnterpriseChains') !== false,
      excludePosCompetitors: configManager.get('excludePosCompetitors') === true,
      excludeUnsupportedIndustries: configManager.get('excludeUnsupportedIndustries') !== false,
      requireMobilePhoneOnly: configManager.get('requireMobilePhoneOnly') !== false,
      requirePhoneOnly: filters.requirePhoneOnly !== undefined ? !!filters.requirePhoneOnly : (configManager.get('requirePhoneOnly') === true)
    };

    logger.info(`⚙️ [BỘ LỌC LEAD SMB]: Chuỗi lớn: ${filterConfig.excludeEnterpriseChains ? 'CHẶN' : 'BỎ QUA'} | Ngành Hotel/BĐS/Sinh nở: ${filterConfig.excludeUnsupportedIndustries ? 'CHẶN' : 'BỎ QUA'} | Chỉ lấy bài có SĐT: ${filterConfig.requirePhoneOnly ? 'BẬT (Bắt buộc có SĐT)' : 'TẮT (Lấy cả bài không SĐT)'}`);

    let page;

    try {
      const context = await browserManager.launch(isHeadless);
      const pages = context.pages();
      page = pages.length > 0 ? pages[0] : await context.newPage();

      // 1. Navigate to Search Page (Use /search/top/ which contains the full "Tất cả" sidebar filters: "Bài viết mới đây", "Ngày đăng")
      const searchUrl = `https://www.facebook.com/search/top/?q=${encodeURIComponent(keyword)}`;
      logger.info(`1. Đang mở trang tìm kiếm Facebook: ${searchUrl}`);
      const navRes = await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await delay(crawlDelay);

      const pageBodyText = await page.evaluate(() => (document.body?.innerText || '').trim());
      const currentUrl = page.url();

      if (navRes?.status() === 404 || pageBodyText === 'Not Found' || currentUrl.includes('/login') || currentUrl.includes('/checkpoint')) {
        logger.warn('Facebook session expired or logged out. Directing user to re-login.');
        throw new Error('Phiên đăng nhập Facebook đã hết hạn hoặc bị đăng xuất (Facebook hiển thị Not Found / Yêu cầu đăng nhập). Bạn vui lòng vào Tab "Session Manager" đăng nhập lại Facebook rồi bấm Bắt đầu tìm kiếm tiếp nhé!');
      }

      // 2. Select All (Tất cả) Tab in sidebar (if present) to display sub-filters
      await this._applyAllTab(page);
      await delay(1000);

      // 3. Toggle "Bài viết mới đây" (Recent Posts)
      const enableRecent = filters.recentPosts !== false;
      if (enableRecent) {
        logger.info('2. Kích hoạt bộ lọc: Bật nút gạt "Bài viết mới đây" (Recent posts)...');
        await this._applyRecentPostsToggle(page, true);
        await delay(1500);
      }

      // 4. Select "Ngày đăng" (Date Posted - Year)
      if (filters.datePosted && filters.datePosted !== 'any' && filters.datePosted !== '') {
        logger.info(`3. Kích hoạt bộ lọc: "Ngày đăng" (Năm ${filters.datePosted})...`);
        await this._applyDateFilter(page, filters.datePosted);
        await delay(1500);
      }

      const processedPostKeys = new Set();
      const acceptedAuthorIndex = new Map();
      let scrollAttempts = 0;
      let noNewPostsCount = 0;

      logger.info(`⚡ [TĂNG TỐC QUÉT DỮ LIỆU & OCR] Bắt đầu tìm kiếm ${targetAccepted} bài viết hợp lệ.`);

      // =========================================================================
      // BƯỚC 4: CUỘN TRANG TIẾP TỤC CHO ĐẾN KHI ĐỦ BÀI (Continuous Stream Loop)
      // =========================================================================
      while (this.acceptedCount < targetAccepted && !this.isStopped && noNewPostsCount < 150) {

        // Expand "Xem thêm" on search feed
        await this._expandSeeMore(page);

        // Fast Candidate Post Extractor with Clean Visible Text & Image URLs
        const rawPosts = await page.evaluate(() => {
          let articles = Array.from(document.querySelectorAll('div[role="feed"] > div, div[role="article"], div[data-pagelet*="FeedUnit"], div[aria-describedby]'));

          if (articles.length === 0) {
            const containers = Array.from(document.querySelectorAll('div[dir="auto"]'))
              .map(el => el.closest('div[role="feed"] > div') || el.closest('div[role="article"]') || el.closest('div[data-pagelet]'))
              .filter(Boolean);
            articles = Array.from(new Set(containers));
          }

          const list = [];

          articles.forEach(node => {
            // ONLY extract clean visible text to avoid matching hidden HTML IDs or URLs
            const visibleText = (node.innerText || '').trim();
            if (!visibleText || visibleText.length < 15) return;

            // Extract real post image URLs for OCR (supporting <img>, background-image, and SVG image elements)
            const imgElements = Array.from(node.querySelectorAll('img[src], image, div[style*="url("], a[style*="url("], span[style*="url("]'));
            const imageUrls = [];
            for (const el of imgElements) {
              let src = el.src || el.getAttribute('src') || el.getAttribute('href') || el.getAttribute('xlink:href') || '';
              if (!src) {
                const style = el.getAttribute('style') || '';
                const bgMatch = style.match(/url\(["']?(https?:\/\/[^"')]+)["']?\)/i);
                if (bgMatch) src = bgMatch[1];
              }
              if (src && (src.includes('scontent') || src.includes('fbcdn')) && 
                  !src.includes('rsrc.php') && !src.includes('emoji') && !src.includes('/static.xx/')) {
                if (!imageUrls.includes(src)) imageUrls.push(src);
              }
            }

            // Extract Feed Timestamp Text (e.g. "2 giờ", "14 giờ", "18h", "Vừa xong", "Hôm qua")
            let feedTimeText = '';
            const timeEls = Array.from(node.querySelectorAll('a[aria-label], span[aria-label], a[role="link"], span[id], abbr'));
            for (const el of timeEls) {
              const aria = (el.getAttribute('aria-label') || '').trim();
              const txt = (el.textContent || '').trim();
              
              function parseCleanTime(s) {
                if (!s || s.length > 60) return '';
                if (/(?:xem tin|xem story|nhắn tin|theo dõi|thích|bình luận|chia sẻ|hoạt động)/i.test(s)) return '';
                const m = s.match(/(?:\d{1,2}\s*(?:phút|giờ|h|ngày|tháng|năm)\s*(?:trước)?|vừa xong|hôm qua(?:\s*lúc\s*\d{1,2}:\d{2})?|\d{1,2}\s*tháng\s*\d{1,2}(?:\s*lúc\s*\d{1,2}:\d{2})?)/i);
                return m ? m[0] : '';
              }

              const timeFromAria = parseCleanTime(aria);
              if (timeFromAria) {
                feedTimeText = timeFromAria;
                break;
              }
              const timeFromTxt = parseCleanTime(txt);
              if (timeFromTxt) {
                feedTimeText = timeFromTxt;
                break;
              }
            }

            const anchors = Array.from(node.querySelectorAll('a[href]'));
            let authorName = '';
            let profileLink = '';
            let postLink = '';

            function cleanUrl(href) {
              if (!href) return '';
              return href.startsWith('/') ? 'https://www.facebook.com' + href : href;
            }

            // SEARCH-P0-003: Dedicated Header-first Selector for Author Extraction
            const headerNode = node.querySelector('header, h2, h3, h4, strong') || node.querySelector('div[role="article"] > div:first-child');
            const headerAnchors = headerNode ? Array.from(headerNode.querySelectorAll('a[href]')) : Array.from(node.querySelectorAll('a[href]')).slice(0, 8);

            for (const a of headerAnchors) {
              const text = a.textContent.trim();
              const href = a.getAttribute('href') || '';
              if (!href || href === '#' || href.startsWith('javascript:')) continue;

              const isPostPermalink = href.includes('/posts/') || 
                                      href.includes('/permalink/') || 
                                      href.includes('story_fbid') || 
                                      href.includes('pfbid') || 
                                      href.includes('/photos/') || 
                                      href.includes('/videos/') || 
                                      href.includes('/reel/') ||
                                      href.includes('fbid=') ||
                                      href.includes('comment_id=') ||
                                      href.includes('multi_permalinks');

              if (text && text.length >= 2 && text.length <= 60 && !isPostPermalink && !text.startsWith('#')) {
                const aria = a.getAttribute('aria-label') || '';
                const isNavIcon = aria.includes('Home') || aria.includes('Trang chủ') || aria.includes('Watch') || aria.includes('Notifications') || a.querySelector('svg');
                
                // Group home page is not an author profile, BUT /groups/.../user/... IS an author profile!
                const isGroupHomeLink = href.includes('/groups/') && !href.includes('/user/') && !href.includes('/member/');

                const isNonProfile = href.includes('/hashtag/') || 
                                     isGroupHomeLink || 
                                     href.includes('/events/') || 
                                     href.includes('/gaming/') || 
                                     href.includes('/watch/') || 
                                     href.includes('/marketplace/') || 
                                     href.includes('/search/') || 
                                     href.includes('/messages/');

                const isActionButton = /(?:xem thêm|theo dõi|tham gia|join|follow|đã tham gia|thích|nhắn tin|gửi tin nhắn)/i.test(text);

                if (!isNavIcon && !isNonProfile && !isActionButton) {
                  authorName = text;
                  // If group user link, canonicalize to root user URL if possible
                  if (href.includes('/groups/') && href.includes('/user/')) {
                    const mUid = href.match(/\/user\/([^/?#]+)/i);
                    if (mUid && mUid[1]) {
                      profileLink = /^\d+$/.test(mUid[1]) 
                        ? `https://www.facebook.com/profile.php?id=${mUid[1]}`
                        : `https://www.facebook.com/${mUid[1]}`;
                    } else {
                      profileLink = cleanUrl(href);
                    }
                  } else {
                    profileLink = cleanUrl(href);
                  }
                  break; // Found primary post author in header!
                }
              }
            }

            // B) Post Permalink
            for (const a of anchors) {
              const href = a.getAttribute('href') || '';
              if (!href || href === '#' || href.startsWith('javascript:')) continue;

              const isDirectPosts = href.includes('/posts/') || 
                                    href.includes('/permalink') || 
                                    href.includes('story_fbid') || 
                                    href.includes('pfbid') || 
                                    href.includes('/photos/') ||
                                    href.includes('/videos/') ||
                                    href.includes('/reel/') ||
                                    href.includes('fbid=') ||
                                    href.includes('/watch/?v=') ||
                                    href.includes('multi_permalinks');

              if (isDirectPosts && !postLink) {
                postLink = cleanUrl(href);
                break;
              }
            }

            // C) Tagged Place / Fanpage Check-in (e.g. "Duc Bach cùng với ... tại cafeyolk VN.")
            let taggedPlaceName = '';
            let taggedPlaceUrl = '';
            if (headerNode) {
              const headerText = headerNode.textContent || '';
              const placeMatch = headerText.match(/(?:\s+tại\s+|\s+at\s+)([^.\n\r]+)/iu);
              if (placeMatch && placeMatch[1]) {
                const rawPlaceName = placeMatch[1].trim();
                for (const a of headerAnchors) {
                  const aTxt = a.textContent.trim();
                  const aHref = a.getAttribute('href') || '';
                  if (aTxt && (rawPlaceName === aTxt || rawPlaceName.startsWith(aTxt)) && aHref && aHref !== profileLink) {
                    taggedPlaceName = aTxt;
                    taggedPlaceUrl = cleanUrl(aHref);
                    break;
                  }
                }
                if (!taggedPlaceName && rawPlaceName.length < 50) {
                  taggedPlaceName = rawPlaceName;
                }
              }
            }

            // BẮT BUỘC: Phải có Tác giả VÀ có Link bài viết mới đưa vào danh sách ứng viên
            if (authorName && postLink && visibleText.length > 20) {
              list.push({
                authorName: authorName,
                taggedPlaceName: taggedPlaceName,
                taggedPlaceUrl: taggedPlaceUrl,
                content: visibleText,
                postLink: postLink,
                profileLink: profileLink,
                feedTimeText: feedTimeText,
                imageUrls: imageUrls
              });
            }
          });

          return list;
        });

        let foundNewCandidateInThisBatch = false;

        // Process candidate posts with EXACT 4-STEP ORDER
        for (const post of rawPosts) {
          if (this.acceptedCount >= targetAccepted || this.isStopped) break;
          if (!post.authorName || !post.postLink) continue;

          // Unique Post Key Check
          const postKey = `${post.authorName}_${post.content.substring(0, 60)}`;
          if (processedPostKeys.has(postKey)) continue;
          processedPostKeys.add(postKey);
          foundNewCandidateInThisBatch = true;

          // Resolve a stable author key. Multiple posts from the same author are
          // aggregated later instead of being discarded before enrichment.
          const authorKey = getCanonicalAuthorKey(post);

          // History Deduplication Check
          const isAlreadyInHistory = await historyManager.hasPost(post);
          if (isAlreadyInHistory) {
            logger.info(`ℹ️ [ĐÃ CÓ TRONG KẾT QUẢ/LỊCH SỬ] Bỏ qua bài của [${post.authorName}] vì đã được lưu trước đó (tránh trùng lặp lead).`);
            continue;
          }

          // Quick Exclude Keywords Check on feed preview
          if (excludeKeywords.length > 0) {
            const previewText = (post.content || '').toLowerCase();
            const matchedQuickEx = excludeKeywords.find(kw => previewText.includes(kw));
            if (matchedQuickEx) {
              logger.info(`❌ [TỪ KHÓA LOẠI TRỪ] BỎ QUA bài viết của [${post.authorName}] vì chứa từ khóa loại bỏ: "${matchedQuickEx}"`);
              continue;
            }
          }

          // Quick Lead Qualification Check (Chuỗi lớn, Đối thủ POS, Ngành không phù hợp, Nước ngoài)
          const quickEval = leadFilter.evaluateLead({
            authorName: post.authorName,
            content: post.content,
            location: post.feedTimeText || '',
            phones: post.phones || []
          }, filterConfig);

          if (!quickEval.qualified) {
            logger.info(`❌ [LOẠI TRỪ LEAD] BỎ QUA [${post.authorName}]: ${quickEval.reason}`);
            continue;
          }

          // =========================================================================
          // BƯỚC 1: KIỂM TRA THỜI GIAN ĐĂNG BÀI - CHỈ LẤY BÀI DƯỚI 24H (SEARCH-P0-002)
          // =========================================================================
          const feedTimeLower = (post.feedTimeText || '').toLowerCase().trim();

          // Loại bỏ ngay lập tức tại bảng tin nếu bài viết hiển thị "1 ngày", "2 ngày", "hôm qua", "tháng", "năm" hoặc >= 24h (không cần vào xem)
          const isExplicitlyOver24h = /(?:\b(?:[1-9]\d*)\s*(?:ngày|ngay|days?|d|tuần|tuan|tháng|thang|năm|nam)\b|hôm qua|hom qua|yesterday)/iu.test(feedTimeLower) ||
            /\b(?:2[4-9]|[3-9]\d|\d{3,})\s*(?:giờ|gio|h)\b/iu.test(feedTimeLower);

          if (enableRecent && isExplicitlyOver24h) {
            logger.info(`⏩ [BỎ QUA BÀI >= 24H] [${post.authorName}] (${post.feedTimeText || 'Cũ'}) - Loại ngay tại bảng tin, không cần vào xem.`);
            this.rejectedCount++;
            continue;
          }

          const targetRecencyHours = enableRecent ? 24 : 240;
          let postVerification = resolveTimeResult({
            timeText: post.feedTimeText,
            rawContent: post.content,
            recencyHours: targetRecencyHours
          });

          // Mở trang chi tiết bài viết nếu bản xem trước trên feed chưa có SĐT hoặc thời gian chưa rõ
          const feedHasPhone = extractPhonesFromText(post.content).length > 0;
          if (!feedHasPhone || !postVerification.withinRequestedWindow || postVerification.status === 'unknown') {
            if (post.postLink) {
              const detailedVerif = await this._verifyPostDetails(
                context, 
                post.postLink, 
                post.content, 
                crawlDelay, 
                post.authorName, 
                post.feedTimeText,
                targetRecencyHours
              );
              if (detailedVerif && detailedVerif.formattedDate !== 'Lỗi kiểm tra') {
                postVerification = detailedVerif;
              }
            }
          }

          if (enableRecent && (!postVerification.isWithin24h || !postVerification.withinRequestedWindow || postVerification.status === 'unknown')) {
            logger.info(`❌ [BƯỚC 1 - SAI THỜI GIAN] BỎ QUA [${post.authorName}] (${postVerification.formattedDate}) - Bài viết không thuộc 24 giờ qua!`);
            this.rejectedCount++;
            continue;
          }

          if (filters.datePosted && filters.datePosted !== 'any' && filters.datePosted !== '') {
            const selectedYearMatch = matchesSelectedYear(postVerification, filters.datePosted);
            if (selectedYearMatch !== true) {
              logger.info(`❌ [BỘ LỌC NĂM] BỎ QUA [${post.authorName}] vì không thuộc năm ${filters.datePosted}.`);
              this.rejectedCount++;
              continue;
            }
          }

          const fullPostContent = postVerification.fullContent || post.content;

          // Deep Exclude Keywords Check on Full Content
          if (excludeKeywords.length > 0) {
            const fullTextLower = fullPostContent.toLowerCase();
            const matchedDeepEx = excludeKeywords.find(kw => fullTextLower.includes(kw));
            if (matchedDeepEx) {
              logger.info(`❌ [TỪ KHÓA LOẠI TRỪ] BỎ QUA bài viết của [${post.authorName}] vì nội dung chứa: "${matchedDeepEx}"`);
              continue;
            }
          }

          // Deep Lead Qualification Check on Full Content
          const deepEval = leadFilter.evaluateLead({
            authorName: post.authorName,
            content: fullPostContent
          }, filterConfig);

          if (!deepEval.qualified) {
            logger.info(`❌ [LOẠI TRỪ LEAD] BỎ QUA [${post.authorName}]: ${deepEval.reason}`);
            continue;
          }

          const postImages = (postVerification.imageUrls && postVerification.imageUrls.length > 0) 
            ? postVerification.imageUrls 
            : (post.imageUrls || []);

          const postExcerpt = generateExcerpt(fullPostContent);


          // =========================================================================
          // BƯỚC 3: TRÍCH XUẤT SĐT NHANH TRỰC TIẾP TỪ VĂN BẢN (0ms)
          // =========================================================================
          let phoneEvidence = [];
          const evidenceMetadata = {
            authorMatched: true,
            sourceAuthorKey: authorKey,
            targetAuthorKey: authorKey,
            sourceUrl: post.postLink || '',
            minConfidence: 0.8
          };

          const textPhones = extractPhonesFromText(fullPostContent);
          if (textPhones.length > 0) {
            phoneEvidence = mergePhoneEvidence(
              phoneEvidence,
              textPhones.map(phone => ({
                phone,
                verified: isPhoneExplicitlyContactLabeled(fullPostContent, phone),
                authorMatched: true
              })),
              'post_text',
              0.95,
              fullPostContent.substring(0, 220),
              evidenceMetadata
            );
          }

          let locationResult = extractLocationDetailed({
            content: fullPostContent,
            authorName: post.authorName
          });
          let detectedLocation = locationResult.confidence >= 0.75 && !locationResult.conflict
            ? locationResult.province
            : '—';

          // =========================================================================
          // BƯỚC 4: THẨM ĐỊNH AI SỚM (FAST AI PRE-EVALUATION)
          // Tự động loại bỏ ngay các bài rác/không kinh doanh chỉ trong 1s mà KHÔNG
          // tốn 10-15s tải ảnh chạy OCR hay mở trang cá nhân của bài không đạt!
          // =========================================================================
          const currentPhones = phoneEvidence.map(e => e.phone);

          const aiEval = await aiLeadEvaluator.evaluateLeadWithAI({
            authorName: post.authorName,
            content: fullPostContent,
            phones: currentPhones,
            location: detectedLocation
          }, filterConfig);

          if (!aiEval.isQualified) {
            if (aiEval.errorCode === 'AI_UNAVAILABLE') {
              // Tự động chuyển tiếp sang Local NLP khi API AI bị giới hạn tần suất (429) hoặc lỗi mạng
              const localEval = aiLeadEvaluator._localNLPEvaluate(post.authorName, fullPostContent, currentPhones);
              if (localEval.isQualified) {
                logger.info(`⚡ [LOCAL NLP DUYỆT LEAD - ${localEval.score}/100] [${post.authorName}] | Ngành: ${localEval.businessType} (AI tạm thời bận)`);
                Object.assign(aiEval, localEval, { isQualified: true, decision: 'ACCEPTED' });
              } else {
                logger.info(`❌ [LOCAL NLP LOẠI TRỪ SỚM] BỎ QUA [${post.authorName}] - Điểm: ${localEval.score}/100 - Lý do: ${localEval.reason}`);
                this.rejectedCount++;
                continue;
              }
            } else {
              logger.info(`❌ [AI LOẠI TRỪ SỚM] BỎ QUA [${post.authorName}] - Điểm: ${aiEval.score}/100 - Lý do: ${aiEval.reason}`);
              this.rejectedCount++;
              continue; // Bỏ qua ngay: tiết kiệm 10-15s cho mỗi bài rác!
            }
          }

          // =========================================================================
          // BƯỚC 5: TRÍCH XUẤT SĐT CHUYÊN SÂU (CHỈ CHẠY CHO BÀI VIẾT ĐÃ ĐƯỢC AI DUYỆT)
          // =========================================================================
          // 5.1. Nếu bài viết được AI duyệt mà chưa có SĐT: quét OCR trên ảnh bài viết
          if (phoneEvidence.length === 0 && postImages.length > 0) {
            logger.info(`📸 [OCR ẢNH QUÁN TIỀM NĂNG] Đang quét OCR ${postImages.length} ảnh của bài viết [${post.authorName}]...`);
            const ocrPhones = await ocrManager.extractPhonesFromImageUrls(postImages);
            if (ocrPhones.length > 0) {
              phoneEvidence = mergePhoneEvidence(
                phoneEvidence,
                ocrPhones,
                'image_ocr',
                0.9,
                'OCR từ ảnh biển hiệu / xe bán hàng của quán',
                { ...evidenceMetadata, verified: true }
              );
            }
          }

          // 5.2. Nếu vẫn chưa có SĐT nào (cả trong chữ lẫn ảnh): Mới truy vấn Profile / Tagged Place Page
          if (phoneEvidence.length === 0) {
            const candidateUrls = [];
            if (post.taggedPlaceUrl) candidateUrls.push(post.taggedPlaceUrl);
            if (post.profileLink) candidateUrls.push(post.profileLink);

            const targetsToSearch = candidateUrls.filter(url => {
              if (!url || !url.startsWith('http')) return false;
              if (url.includes('/hashtag/') || url.includes('/events/') || url.includes('/watch/') || url.includes('/gaming/') || url.includes('/marketplace/')) return false;
              // Only filter out group homepages, allow group author profile URLs (/user/ or /member/)
              if (url.includes('/groups/') && !url.includes('/user/') && !url.includes('/member/')) return false;
              return true;
            }).slice(0, 2);

            if (targetsToSearch.length > 0) {
              for (const targetUrl of targetsToSearch) {
                const isTaggedPlace = targetUrl === post.taggedPlaceUrl;
                const profileRes = await this._extractPhonesFromProfile(context, targetUrl, crawlDelay, post.authorName);
                if (profileRes && profileRes.phones && profileRes.phones.length > 0) {
                  phoneEvidence = mergePhoneEvidence(
                    phoneEvidence,
                    profileRes.phones,
                    isTaggedPlace ? 'tagged_page_bio' : (profileRes.source || 'profile_bio'),
                    profileRes.confidence || 0.9,
                    isTaggedPlace ? `Thông tin liên hệ từ trang Fanpage check-in [${post.taggedPlaceName}]` : (profileRes.source?.includes('timeline') ? `Bài viết mới nhất trên tường [${post.authorName}]` : 'Thông tin liên hệ trên trang của tác giả'),
                    {
                      ...evidenceMetadata,
                      sourceUrl: targetUrl,
                      verified: true
                    }
                  );
                  if (profileRes.location && profileRes.location !== '—' && (detectedLocation === '—' || profileRes.source?.includes('timeline'))) {
                    detectedLocation = profileRes.location;
                    locationResult = profileRes.locationResult || {
                      province: profileRes.location,
                      source: profileRes.source || 'profile_bio',
                      confidence: profileRes.confidence || 0.8,
                      conflict: false,
                      evidence: []
                    };
                  }
                  if (isTaggedPlace && post.taggedPlaceName) {
                    post.authorName = post.taggedPlaceName;
                  }
                  break;
                }
              }
            }
          }

          const phones = phoneEvidence.map(e => e.phone);
          const verifiedPhones = phoneEvidence.filter(e => e.verified === true).map(e => e.phone);

          // Kiểm tra loại trừ số tổng đài / số cố định (SEARCH-P0-007: nếu có số và bật requireMobilePhoneOnly)
          if (phones.length > 0 && filterConfig.requireMobilePhoneOnly && !phones.some(p => leadFilter.classifyPhoneType(p) === 'mobile')) {
            logger.info(`❌ [LOẠI TRỪ SỐ KHÔNG PHẢI DI ĐỘNG] BỎ QUA [${post.authorName}] vì không có SĐT di động cá nhân.`);
            continue;
          }

          // Kiểm tra chế độ "Chỉ lấy bài có SĐT"
          if (filterConfig.requirePhoneOnly && verifiedPhones.length === 0) {
            logger.info(`ℹ️ [BỎ QUA DO BẬT CHẾ ĐỘ CHỈ LẤY CÓ SĐT] [${post.authorName}] (Không có SĐT đã xác minh chính chủ)`);
            this.rejectedCount++;
            continue;
          }

          // Đảm bảo Link bài viết gốc được chuẩn hóa sạch và chính xác (SEARCH-P0-013: Không gán profile link làm post link)
          const cleanPostUrl = post.postLink ? getCleanCanonicalFacebookUrl(post.postLink) : '';
          const cleanProfileUrl = post.profileLink ? getCleanCanonicalFacebookUrl(post.profileLink) : '';

          logger.info(`🤖 [AI DUYỆT LEAD - ${aiEval.score}/100] [${post.authorName}] | Ngành: ${aiEval.businessType} | Mục đích: ${aiEval.intent}`);

          // Lưu bài viết đã được AI duyệt vào danh sách kết quả
          const cleanPostObj = {
            authorName: post.authorName,
            authorKey,
            location: detectedLocation,
            locationSource: locationResult?.source || 'unknown',
            locationConfidence: locationResult?.confidence || 0,
            locationEvidence: Array.isArray(locationResult?.evidence) ? locationResult.evidence : [],
            postedTime: postVerification.formattedDate || post.feedTimeText || 'Gần đây',
            timeStatus: postVerification.status || 'unknown',
            timeConfidence: postVerification.confidence || 0,
            content: fullPostContent.replace(/\n+/g, ' ').trim(),
            summary: aiEval.summary || aiEval.reason || postExcerpt,
            aiSummary: aiEval.summary || '',
            aiScore: aiEval.score,
            businessType: aiEval.businessType,
            intent: aiEval.intent,
            aiReason: aiEval.reason,
            postLink: cleanPostUrl,
            profileLink: cleanProfileUrl,
            phones: phones,
            verifiedPhones: verifiedPhones,
            phoneEvidence: phoneEvidence,
            decision: 'ACCEPTED',
            decisionReasons: ['AI_ACCEPTED'],
            status: 'Mới tạo',
            supportingPosts: []
          };

          if (acceptedAuthorIndex.has(authorKey)) {
            const existingIndex = acceptedAuthorIndex.get(authorKey);
            const existingLead = this.results[existingIndex];
            const mergedEvidence = mergePhoneEvidenceCollections(
              existingLead.phoneEvidence,
              cleanPostObj.phoneEvidence
            );
            existingLead.phoneEvidence = mergedEvidence;
            existingLead.phones = mergedEvidence.map(item => item.phone);
            existingLead.verifiedPhones = mergedEvidence
              .filter(item => item.verified === true)
              .map(item => item.phone);
            existingLead.supportingPosts = [
              ...(Array.isArray(existingLead.supportingPosts) ? existingLead.supportingPosts : []),
              {
                postLink: cleanPostObj.postLink,
                postedTime: cleanPostObj.postedTime,
                content: cleanPostObj.content,
                aiScore: cleanPostObj.aiScore
              }
            ];

            if ((cleanPostObj.aiScore || 0) > (existingLead.aiScore || 0)) {
              for (const field of [
                'summary', 'aiSummary', 'aiScore', 'businessType', 'intent',
                'salesPitch', 'recommendedFeatures', 'aiReason'
              ]) {
                existingLead[field] = cleanPostObj[field];
              }
            }
            if (existingLead.location === '—' && cleanPostObj.location !== '—') {
              existingLead.location = cleanPostObj.location;
              existingLead.locationSource = cleanPostObj.locationSource;
              existingLead.locationConfidence = cleanPostObj.locationConfidence;
              existingLead.locationEvidence = cleanPostObj.locationEvidence;
            }
            logger.info(`➕ [GỘP BÀI CÙNG TÁC GIẢ] Đã bổ sung bằng chứng từ bài khác của [${post.authorName}] mà không tăng số lead.`);
          } else {
            acceptedAuthorIndex.set(authorKey, this.results.length);
            this.results.push(cleanPostObj);
            this.acceptedCount++;
          }
          this.found = this.acceptedCount;
          this.emit('progress', this.getProgress());

          const phoneLogStr = phones.length > 0 ? `SĐT: [${phones.join(', ')}]` : `[CHƯA CÓ SĐT - NHẮN TIN FB]`;
          logger.info(`⚡ [THÀNH CÔNG] [${this.found}/${targetAccepted}] ${phoneLogStr} | Điểm: ${aiEval.score}/100 | Ngành: ${aiEval.businessType} | Tác giả: ${post.authorName}`);
        }

        if (!foundNewCandidateInThisBatch) {
          noNewPostsCount++;
          if (noNewPostsCount % 5 === 0) {
            logger.info(`⏳ [CHỜ DỮ LIỆU MỚI] Đang cuộn Facebook để tải thêm bài viết... (Lần ${noNewPostsCount}/150)`);
          }
        } else {
          noNewPostsCount = 0;
        }

        // =========================================================================
        // BƯỚC 4: CUỘN TRANG TIẾP TỤC CHO ĐẾN KHI ĐỦ BÀI (SEARCH-P0-001)
        // =========================================================================
        if (this.acceptedCount < targetAccepted && !this.isStopped) {
          scrollAttempts++;
          await this._smoothScrollDown(page, 2500);
          await delay(crawlDelay);
        }
      }

      const processedResults = processResults(this.results);
      await historyManager.addPosts(processedResults);
      
      if (this.acceptedCount < targetAccepted && !this.isStopped) {
        logger.info(`ℹ️ Đã quét hết toàn bộ bài viết khả dụng trên Facebook cho từ khóa "${keyword}" trong 24 giờ qua (Facebook không còn bài viết mới nào khác để tải thêm, tìm thấy ${this.acceptedCount}/${targetAccepted} bài đạt chuẩn).`);
      }

      logger.info(`🎉 HOÀN TẤT! ${this.acceptedCount}/${targetAccepted} lead được duyệt, ${this.reviewCount} bài cần kiểm tra; đã lưu ${processedResults.length} bản ghi.`);

      this.status = this.isStopped ? 'stopped' : 'idle';
      this.emit('progress', this.getProgress());
      
      return processedResults;

    } catch (error) {
      logger.error({ err: error }, 'Search failed');

      if (this.results.length > 0) {
        try {
          const processedResults = processResults(this.results);
          await historyManager.addPosts(processedResults);
          logger.info(`💾 Đã lưu ${processedResults.length} bài viết đã thu thập trước khi dừng do lỗi.`);
        } catch (saveErr) {
          logger.warn({ err: saveErr }, 'Failed to save partial results on error');
        }
      }

      throw error;
    } finally {
      this.status = this.isStopped ? 'stopped' : 'idle';
      this.emit('progress', this.getProgress());
      try {
        await browserManager.closeBrowser();
        logger.info('🔒 Đã đóng trình duyệt Chromium.');
      } catch (closeErr) {}
    }
  }

  /**
   * Fast DOM Post Verification (No Resource Aborting, Ultra Fast Page Load)
   */
  async _verifyPostDetails(context, postUrl, rawFeedContent = '', crawlDelay = 2000, targetAuthorName = '', rawFeedTimeText = '', recencyHours = 24) {
    let inspectPage;
    try {
      if (!postUrl || !postUrl.startsWith('http')) {
        return resolveTimeResult({ timeText: rawFeedTimeText, rawContent: rawFeedContent, recencyHours });
      }

      inspectPage = await context.newPage();
      await inspectPage.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await delay(Math.min(crawlDelay, 2500));

      await this._expandSeeMore(inspectPage);

      const pageData = await inspectPage.evaluate((authorName) => {
        let creationTime = '';

        const scripts = Array.from(document.querySelectorAll('script[type="application/json"]'));
        for (const s of scripts) {
          const text = s.textContent || '';
          const m = text.match(/"creation_time":\s*(\d{9,11})/);
          if (m) {
            creationTime = m[1];
            break;
          }
        }

        const metaTime = document.querySelector('meta[property="article:published_time"]')?.getAttribute('content') || '';
        
        let articleNode = document.querySelector('div[role="article"], div[data-pagelet*="FeedUnit"], div[data-ad-preview="message"]')?.closest('div[role="article"]') || document.querySelector('div[role="article"]') || document.querySelector('div[role="main"]') || document.body;
        
        let mainText = '';
        if (articleNode) {
          const clone = articleNode.cloneNode(true);
          const navs = clone.querySelectorAll('header, nav, div[role="navigation"], div[aria-label="Account"], div[role="banner"], svg, a[aria-label="Facebook"], div[aria-label*="Bình luận"], div[aria-label*="Comment"], form, ul, ol');
          navs.forEach(n => n.remove());
          mainText = (clone.innerText || '').trim();
        }

        if (!mainText || mainText.length < 20) {
          let messageEl = document.querySelector('div[data-ad-preview="message"], div[data-ad-comet-preview="message"]');
          if (messageEl) mainText = (messageEl.innerText || '').trim();
        }

        if (mainText) {
          mainText = mainText
            .replace(/(?:Facebook\s*){2,}/gi, ' ')
            .replace(/^Facebook\s+/i, '')
            .replace(/\s+Facebook$/i, '')
            .replace(/\s+/g, ' ')
            .trim();
        }

        // Extract comments ONLY from the author of the post. "Pinned" is not an
        // ownership signal because page/group admins may pin another person's comment.
        const commentEls = Array.from(document.querySelectorAll('div[aria-label*="Bình luận"], div[aria-label*="Comment"], ul li, div[role="article"] ul li'));
        const authorCommentTexts = [];

        for (const el of commentEls) {
          const rawText = (el.innerText || '').trim();
          if (rawText.length < 5 || rawText.startsWith('Thích') || rawText.startsWith('Phản hồi') || rawText.includes('Facebook Account')) {
            continue;
          }

          // Check if this comment is from the author (SEARCH-P0-014)
          const hasAuthorBadge = /(?:^|\s|[^\p{L}\p{N}])(?:tác giả|tac gia|author|người tạo bài viết|người tạo|nguoi tao)(?:\s|$|[^\p{L}\p{N}])/iu.test(rawText);
          
          let isSameAuthor = false;
          if (authorName && authorName.trim().length >= 2) {
            const authorAnchor = el.querySelector('a[role="link"], a[href]');
            const commentAuthorName = (authorAnchor?.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
            const targetAuthorNameNorm = authorName.replace(/\s+/g, ' ').trim().toLowerCase();
            if (commentAuthorName && commentAuthorName === targetAuthorNameNorm) {
              isSameAuthor = true;
            }
          }

          if (hasAuthorBadge || isSameAuthor) {
            const cleanCommentText = rawText
              .replace(/\b(Tác giả|Author|Người tạo bài viết|Người tạo|Đã ghim|Pinned)\b/gi, '')
              .replace(/\b(Thích|Phản hồi|Chia sẻ|Like|Reply|Share|\d+\s*(giờ|phút|ngày|h|m|d))\b/gi, '')
              .replace(/\s+/g, ' ')
              .trim();

            if (cleanCommentText.length > 5 && !authorCommentTexts.includes(cleanCommentText)) {
              authorCommentTexts.push(cleanCommentText);
            }
          }
        }

        if (authorCommentTexts.length > 0) {
          mainText += '\n' + authorCommentTexts.slice(0, 3).join('\n');
        }

        mainText = mainText
          .replace(/(?:^|\s)(?:Facebook\s*){2,}/gi, ' ')
          .replace(/Back to Previous Page/gi, '')
          .replace(/Exit typeahead/gi, '')
          .replace(/Facebook Account controls and settings/gi, '')
          .replace(/Chỉ báo trạng thái online\s*Đang hoạt động/gi, '')
          .replace(/\s+/g, ' ')
          .trim();

        const imgElements = Array.from(document.querySelectorAll('img[src], image, div[style*="url("], a[style*="url("], span[style*="url("]'));
        const imageUrls = [];
        for (const el of imgElements) {
          let src = el.src || el.getAttribute('src') || el.getAttribute('href') || el.getAttribute('xlink:href') || '';
          if (!src) {
            const style = el.getAttribute('style') || '';
            const bgMatch = style.match(/url\(["']?(https?:\/\/[^"')]+)["']?\)/i);
            if (bgMatch) src = bgMatch[1];
          }
          if (src && (src.includes('scontent') || src.includes('fbcdn')) && 
              !src.includes('rsrc.php') && !src.includes('emoji') && !src.includes('/static.xx/')) {
            if (!imageUrls.includes(src)) imageUrls.push(src);
          }
        }

        return { creationTime, metaTime, fullContent: mainText.trim(), imageUrls };
      }, targetAuthorName);

      let exactTimeSec = pageData.creationTime ? parseInt(pageData.creationTime, 10) : null;
      let formattedDate = '';
      let isWithin24h = false;
      let withinRequestedWindow = false;

      if (exactTimeSec) {
        const nowSec = Math.floor(Date.now() / 1000);
        const diffHours = (nowSec - exactTimeSec) / 3600;
        isWithin24h = diffHours >= 0 && diffHours <= 24;
        withinRequestedWindow = diffHours >= 0 && diffHours <= recencyHours;

        const d = new Date(exactTimeSec * 1000);
        const hours = String(d.getHours()).padStart(2, '0');
        const mins = String(d.getMinutes()).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        formattedDate = `${hours}:${mins} ${day}/${month}/${year}`;
      } else if (pageData.metaTime) {
        const d = new Date(pageData.metaTime);
        const diffHours = (Date.now() - d.getTime()) / (3600 * 1000);
        isWithin24h = diffHours >= 0 && diffHours <= 24;
        withinRequestedWindow = diffHours >= 0 && diffHours <= recencyHours;
        
        const hours = String(d.getHours()).padStart(2, '0');
        const mins = String(d.getMinutes()).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        formattedDate = `${hours}:${mins} ${day}/${month}/${year}`;
      } else {
        const fallback = resolveTimeResult({ timeText: rawFeedTimeText, rawContent: pageData.fullContent || rawFeedContent, recencyHours });
        return { ...fallback, imageUrls: pageData.imageUrls || [] };
      }

      return { 
        status: 'exact',
        publishedAt: new Date(exactTimeSec ? exactTimeSec * 1000 : pageData.metaTime).toISOString(),
        earliestAt: new Date(exactTimeSec ? exactTimeSec * 1000 : pageData.metaTime).toISOString(),
        latestAt: new Date(exactTimeSec ? exactTimeSec * 1000 : pageData.metaTime).toISOString(),
        source: exactTimeSec ? 'post_creation_time' : 'post_meta_time',
        confidence: 0.99,
        isWithin24h,
        withinRequestedWindow,
        formattedDate, 
        fullContent: pageData.fullContent || rawFeedContent,
        imageUrls: pageData.imageUrls || [] 
      };
    } catch (e) {
      return resolveTimeResult({ timeText: rawFeedTimeText, rawContent: rawFeedContent, recencyHours });
    } finally {
      if (inspectPage) await inspectPage.close().catch(() => {});
    }
  }

  _checkTextTimestampFallback(timeText = '', rawContent = '', recencyHours = 24) {
    return resolveTimeResult({ timeText, rawContent, recencyHours });
  }

  async _smoothScrollDown(page, totalDistance = 2500) {
    try {
      await page.evaluate(async (dist) => {
        await new Promise((resolve) => {
          let moved = 0;
          const step = 250;
          const timer = setInterval(() => {
            window.scrollBy(0, step);
            moved += step;
            if (moved >= dist) {
              clearInterval(timer);
              resolve();
            }
          }, 30);
        });
      }, totalDistance);

      // Scroll to document bottom to ensure Facebook infinite scroll sentinel is triggered
      await page.evaluate(() => {
        const bottom = Math.max(
          document.body ? document.body.scrollHeight : 0,
          document.documentElement ? document.documentElement.scrollHeight : 0
        );
        window.scrollTo({ top: bottom, behavior: 'auto' });
      });

      try {
        await page.keyboard.press('PageDown');
      } catch (keyErr) {}
    } catch (e) {}
  }

  async _extractPhonesFromProfile(context, profileUrl, crawlDelay = 2000, targetAuthorName = '') {
    if (this.isStopped || !profileUrl || !profileUrl.startsWith('http')) return { phones: [], location: '—' };

    let profilePage;
    try {
      profilePage = await context.newPage();
      let detectedLoc = '—';
      let locationResult = null;
      const foundPhones = new Set();

      const loggedInUid = getLoggedInUserUid();

      // 1. Phân giải numeric User ID (UID) của tác giả (loại trừ tài khoản đang đăng nhập)
      let resolvedUid = extractUidFromUrl(profileUrl);
      if (resolvedUid && resolvedUid === loggedInUid) {
        resolvedUid = '';
      }

      // Nếu profileUrl là dạng username hoặc cần phân giải, mở trang để đọc UID và Bio/Intro của tác giả
      try {
        logger.info(`🔍 Đang phân giải UID và thông tin liên hệ của tác giả từ: ${profileUrl}`);
        await profilePage.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await delay(1200);

        const profileData = await profilePage.evaluate((myUid) => {
          function isValidAuthorUid(id) {
            return id && /^\d{8,}$/.test(id) && id !== myUid;
          }

          let uid = '';
          // A) Check app deep link meta tags
          const androidMeta = document.querySelector('meta[property="al:android:url"]')?.getAttribute('content') || '';
          const m1 = androidMeta.match(/fb:\/\/(?:profile|page|user)\/(\d+)/i) || androidMeta.match(/[?&]id=(\d+)/i);
          if (m1 && isValidAuthorUid(m1[1])) uid = m1[1];

          if (!uid) {
            const iosMeta = document.querySelector('meta[property="al:ios:url"]')?.getAttribute('content') || '';
            const m2 = iosMeta.match(/fb:\/\/(?:profile|page|user)\/(\d+)/i) || iosMeta.match(/[?&]id=(\d+)/i);
            if (m2 && isValidAuthorUid(m2[1])) uid = m2[1];
          }

          // B) Nút Nhắn tin / Message trên trang tác giả
          if (!uid) {
            const msgLink = document.querySelector('a[href*="/messages/t/"]');
            if (msgLink) {
              const href = msgLink.getAttribute('href') || '';
              const m = href.match(/\/messages\/t\/(\d+)/i);
              if (m && isValidAuthorUid(m[1])) uid = m[1];
            }
          }

          // C) Các nút hành động trên trang cá nhân
          if (!uid) {
            const actionAnchors = Array.from(document.querySelectorAll('a[href*="profile_id="], a[href*="member_id="], a[href*="subject_id="], a[href*="id="], div[data-profileid]'));
            for (const el of actionAnchors) {
              const pid = el.getAttribute('data-profileid') || '';
              if (isValidAuthorUid(pid)) { uid = pid; break; }
              const href = el.getAttribute('href') || '';
              const m = href.match(/[?&](?:profile_id|member_id|subject_id|id)=(\d+)/i);
              if (m && isValidAuthorUid(m[1])) { uid = m[1]; break; }
            }
          }

          // D) Script JSON
          if (!uid) {
            const scripts = Array.from(document.querySelectorAll('script[type="application/json"], script:not([src])'));
            for (const s of scripts) {
              const t = s.textContent || '';
              const matches = t.matchAll(/"(?:entity_id|profile_id|target_id|owning_profile_id)":"?(\d{8,})"?/gi);
              for (const match of matches) {
                if (match && isValidAuthorUid(match[1])) { uid = match[1]; break; }
              }
              if (uid) break;
              const vanityMatch = t.match(/"user_vanity":".*?","user_id":"(\d{8,})"/i);
              if (vanityMatch && isValidAuthorUid(vanityMatch[1])) { uid = vanityMatch[1]; break; }
            }
          }

          // E) Trích xuất SĐT trực tiếp từ phần Bio / Giới thiệu / Nút Gọi ngay trên Fanpage hoặc Trang cá nhân
          const contactLinks = Array.from(document.querySelectorAll('a[href^="tel:"], a[href*="zalo.me/"], a[href*="wa.me/"]'))
            .map(a => a.getAttribute('href') || '')
            .filter(Boolean);

          const introNodes = Array.from(document.querySelectorAll('div[data-pagelet*="ProfileTiles"], div[data-pagelet*="ProfileTabs"], div[role="main"] div[dir="auto"], div[aria-label*="Giới thiệu"], div[aria-label*="Intro"]'));
          let bioText = '';
          for (const el of introNodes) {
            const t = (el.innerText || '').trim();
            if (t.length > 5 && t.length < 500) bioText += '\n' + t;
          }

          return { uid, bioText, contactLinks };
        }, loggedInUid);

        if (profileData) {
          if (!resolvedUid && profileData.uid) resolvedUid = profileData.uid;

          // Kiểm tra SĐT từ Bio / Giới thiệu
          if (profileData.bioText) {
            const bioPhones = extractPhonesFromText(profileData.bioText, { isOCR: false });
            bioPhones.forEach(p => foundPhones.add(p));

            const bioLoc = extractLocationDetailed({ content: profileData.bioText, authorName: targetAuthorName });
            if (bioLoc && bioLoc.confidence >= 0.75 && !bioLoc.conflict && bioLoc.province !== '—') {
              detectedLoc = bioLoc.province;
              locationResult = bioLoc;
            }
          }
          if (Array.isArray(profileData.contactLinks)) {
            for (const l of profileData.contactLinks) {
              extractPhonesFromText(l, { isOCR: false }).forEach(p => foundPhones.add(p));
            }
          }

          if (foundPhones.size > 0) {
            const phones = Array.from(foundPhones);
            logger.info(`✔ Tìm thấy ${phones.length} SĐT chính chủ từ phần Giới thiệu / Bio của trang: [${phones.join(', ')}]`);
            return {
              phones,
              location: detectedLoc,
              locationResult,
              source: 'profile_bio',
              confidence: 0.95,
              verified: true
            };
          }

          // F) Nếu Bio chưa có SĐT: Cuộn nhẹ xuống xem 1-2 bài viết mới nhất trên tường chính chủ
          try {
            await profilePage.mouse.wheel(0, 600);
            await delay(1200);
            await this._expandSeeMore(profilePage);

            const timelineData = await profilePage.evaluate(() => {
              const articles = Array.from(document.querySelectorAll('div[role="feed"] div[role="article"], div[data-pagelet*="ProfileTimeline"] div[role="article"], div[role="main"] div[role="article"]')).slice(0, 3);
              const texts = [];
              const imgs = [];

              for (const art of articles) {
                const txt = (art.innerText || '').trim();
                if (txt.length > 20) {
                  texts.push(txt);
                }
                const imgEls = Array.from(art.querySelectorAll('img[src]'));
                for (const img of imgEls) {
                  const s = img.src || '';
                  if (s && (s.includes('scontent') || s.includes('fbcdn')) && !s.includes('emoji') && !s.includes('rsrc.php')) {
                    if (!imgs.includes(s)) imgs.push(s);
                  }
                }
              }
              return { texts, imgs: imgs.slice(0, 2) };
            });

            if (timelineData && timelineData.texts.length > 0) {
              for (const postText of timelineData.texts) {
                const pList = extractPhonesFromText(postText, { isOCR: false });
                pList.forEach(p => foundPhones.add(p));

                if (detectedLoc === '—') {
                  const tlLoc = extractLocationDetailed({ content: postText, authorName: targetAuthorName });
                  if (tlLoc && tlLoc.confidence >= 0.75 && !tlLoc.conflict && tlLoc.province !== '—') {
                    detectedLoc = tlLoc.province;
                    locationResult = tlLoc;
                  }
                }
              }

              if (foundPhones.size > 0) {
                const phones = Array.from(foundPhones);
                logger.info(`✔ Tìm thấy ${phones.length} SĐT chính chủ từ bài viết mới nhất trên tường [${targetAuthorName || 'Tác giả'}]: [${phones.join(', ')}]`);
                return {
                  phones,
                  location: detectedLoc,
                  locationResult,
                  source: 'profile_timeline',
                  confidence: 0.95,
                  verified: true
                };
              }

              // Nếu chữ chưa có SĐT nhưng có ảnh: Quét AI Vision OCR trên ảnh bài viết mới nhất của quán
              if (timelineData.imgs.length > 0) {
                const ocrPhones = await ocrManager.extractPhonesFromImageUrls(timelineData.imgs);
                ocrPhones.forEach(p => foundPhones.add(p));
                if (foundPhones.size > 0) {
                  const phones = Array.from(foundPhones);
                  logger.info(`✔ Tìm thấy ${phones.length} SĐT chính chủ từ ảnh trên tường [${targetAuthorName || 'Tác giả'}] qua AI Vision: [${phones.join(', ')}]`);
                  return {
                    phones,
                    location: detectedLoc,
                    locationResult,
                    source: 'profile_timeline_ocr',
                    confidence: 0.95,
                    verified: true
                  };
                }
              }
            }
          } catch (tlErr) {
            logger.debug({ err: tlErr.message }, 'Lỗi khi đọc bài viết trên tường profile');
          }
        }
        return {
          phones: Array.from(foundPhones),
          location: detectedLoc,
          locationResult,
          source: foundPhones.size > 0 ? 'profile_bio' : 'profile_unknown',
          confidence: foundPhones.size > 0 ? 0.95 : 0,
          verified: foundPhones.size > 0
        };
      } catch (resolveErr) {
        logger.warn({ err: resolveErr }, `Không thể tải trang giới thiệu: ${profileUrl}`);
        return { phones: [], location: '—' };
      }
    } catch (e) {
      logger.warn({ err: e }, `Không thể tải trang cá nhân: ${profileUrl}`);
      return { phones: [], location: '—' };
    } finally {
      if (profilePage) await profilePage.close().catch(() => {});
    }
  }

  async stop() {
    this.isStopped = true;
    this.status = 'stopped';
    this.emit('progress', this.getProgress());
    logger.info('⏹ Đã nhận lệnh dừng tìm kiếm. Đang đóng trình duyệt Chromium...');
    try {
      await browserManager.closeBrowser();
    } catch (e) {
      logger.warn({ err: e.message }, 'Failed to close browser on stop');
    }
  }

  getProgress() {
    return {
      status: this.status,
      found: this.found,
      total: this.total,
      accepted: this.acceptedCount,
      review: this.reviewCount,
      rejected: this.rejectedCount
    };
  }

  async _expandSeeMore(page) {
    try {
      await page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll('span, div, a, [role="button"]'));
        for (const el of candidates) {
          const txt = (el.innerText || el.textContent || '').trim();
          if ((txt === 'Xem thêm' || txt === 'See more' || txt === 'Xem thêm…' || txt === 'See More' || txt === '... Xem thêm') && el.children.length <= 1) {
            try {
              el.click();
            } catch (err) {}
          }
        }
      });
    } catch (e) {}
  }

  async _applyPostsTab(page) {
    try {
      logger.info('📌 Đang chọn mục "Bài viết" trên thanh bộ lọc tìm kiếm...');
      // Strategy 1: Find sidebar item with text "Bài viết" or "Posts"
      const postsTabLocators = [
        page.locator('div[role="navigation"] a, div[role="navigation"] div[role="button"], div[role="listitem"]').filter({ hasText: /^Bài viết$|^Posts$/i }),
        page.getByRole('link', { name: /^Bài viết$|^Posts$/i }),
        page.getByRole('tab', { name: /^Bài viết$|^Posts$/i }),
        page.getByText(/^Bài viết$|^Posts$/i)
      ];

      for (const loc of postsTabLocators) {
        if (await loc.count() > 0) {
          const first = loc.first();
          if (await first.isVisible()) {
            await first.click({ force: true });
            logger.info('✔ Đã click mục "Bài viết" (Playwright locator)');
            await delay(1000);
            return true;
          }
        }
      }

      // Strategy 2: DOM evaluate with dispatchEvent
      const clicked = await page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll('a[href*="/search/posts"], div[role="listitem"], div[role="button"], div[role="tab"], span'));
        for (const el of candidates) {
          const txt = el.textContent.trim();
          if (/^(Bài viết|Posts)$/i.test(txt) || txt.startsWith('Bài viết\n') || txt.startsWith('Posts\n')) {
            const target = el.closest('a') || el.closest('div[role="button"]') || el.closest('div[role="listitem"]') || el;
            target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            return true;
          }
        }
        return false;
      });

      if (clicked) {
        logger.info('✔ Đã click mục "Bài viết" (DOM dispatchEvent)');
        await delay(1000);
        return true;
      }
    } catch (e) {
      logger.warn({ err: e }, 'Không thể click mục Bài viết');
    }
    return false;
  }

  async _applyAllTab(page) {
    try {
      logger.info('📌 Đang chọn mục "Tất cả" trên thanh bộ lọc tìm kiếm...');
      // Strategy 1: Find sidebar item with text "Tất cả" or "All"
      const allTabLocators = [
        page.locator('div[role="navigation"] a, div[role="navigation"] div[role="button"], div[role="listitem"]').filter({ hasText: /^Tất cả$|^All$/i }),
        page.getByRole('link', { name: /^Tất cả$|^All$/i }),
        page.getByRole('tab', { name: /^Tất cả$|^All$/i }),
        page.getByText(/^Tất cả$|^All$/i)
      ];

      for (const loc of allTabLocators) {
        if (await loc.count() > 0) {
          const first = loc.first();
          if (await first.isVisible()) {
            await first.click({ force: true });
            logger.info('✔ Đã click mục "Tất cả" (Playwright locator)');
            await delay(1000);
            return true;
          }
        }
      }

      // Strategy 2: DOM evaluate with dispatchEvent
      const clicked = await page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll('a[href*="/search/top"], div[role="listitem"], div[role="button"], div[role="tab"], span'));
        for (const el of candidates) {
          const txt = el.textContent.trim();
          if (/^(Tất cả|All)$/i.test(txt) || txt.startsWith('Tất cả\n') || txt.startsWith('All\n')) {
            const target = el.closest('a') || el.closest('div[role="button"]') || el.closest('div[role="listitem"]') || el;
            target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            return true;
          }
        }
        return false;
      });

      if (clicked) {
        logger.info('✔ Đã click mục "Tất cả" (DOM dispatchEvent)');
        await delay(1000);
        return true;
      }
    } catch (e) {
      logger.warn({ err: e }, 'Không thể click mục Tất cả');
    }
    return false;
  }

  async _applyRecentPostsToggle(page, shouldEnable = true) {
    try {
      logger.info('🔘 Đang tìm và kích hoạt nút gạt "Bài viết mới đây"...');
      await delay(1200);

      // Strategy 1: Check if already matching
      const isAlreadyOn = await page.evaluate(() => {
        const labels = Array.from(document.querySelectorAll('span, div, label, p'));
        for (const label of labels) {
          if (!/^(Bài viết mới đây|Bài viết mới nhất|Recent posts|Gần đây)$/i.test(label.textContent.trim())) continue;
          let cur = label;
          for (let i = 0; i < 6 && cur; i++, cur = cur.parentElement) {
            const sw = cur.matches?.('div[role="checkbox"], div[role="switch"], input[type="checkbox"], div[aria-checked]')
              ? cur
              : cur.querySelector?.('div[role="checkbox"], div[role="switch"], input[type="checkbox"], div[aria-checked]');
            if (sw) return sw.getAttribute('aria-checked') === 'true' || sw.checked === true;
          }
        }
        return null;
      });

      if (isAlreadyOn === shouldEnable) {
        logger.info(`✔ Nút gạt "Bài viết mới đây" đã ở trạng thái ${shouldEnable}.`);
        return true;
      }

      // Strategy 2: Click via Playwright locator on the row / switch
      const toggleRow = page.locator('div, label').filter({ hasText: /^(Bài viết mới đây|Bài viết mới nhất|Recent posts)$/i }).first();
      if (await toggleRow.count() > 0 && await toggleRow.isVisible()) {
        const switchLoc = toggleRow.locator('div[role="checkbox"], div[role="switch"], input[type="checkbox"]').first();
        if (await switchLoc.count() > 0) {
          await switchLoc.click({ force: true });
        } else {
          await toggleRow.click({ force: true });
        }
        logger.info('✔ Đã click nút gạt "Bài viết mới đây" (Playwright locator)');
        await delay(1200);
      } else {
        // Strategy 3: DOM evaluate click + dispatchEvent
        const clicked = await page.evaluate((targetState) => {
          const candidateLabels = Array.from(document.querySelectorAll('span, div, label, p'));
          for (const label of candidateLabels) {
            const txt = label.textContent.trim();
            if (/^(Bài viết mới đây|Bài viết mới nhất|Recent posts|Gần đây)$/i.test(txt)) {
              let sw = null;
              let cur = label;
              for (let i = 0; i < 6; i++) {
                if (!cur) break;
                sw = cur.matches?.('div[role="checkbox"], div[role="switch"], input[type="checkbox"], div[aria-checked]')
                  ? cur
                  : cur.querySelector?.('div[role="checkbox"], div[role="switch"], input[type="checkbox"], div[aria-checked]');
                if (sw) break;
                cur = cur.parentElement;
              }
              const clickTarget = sw || cur || label;
              clickTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
              clickTarget.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
              clickTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
              return true;
            }
          }
          return false;
        }, shouldEnable);

        if (clicked) {
          logger.info('✔ Đã click nút gạt "Bài viết mới đây" (DOM dispatchEvent)');
          await delay(1200);
        }
      }

      // Verification
      const verifiedState = await page.evaluate(() => {
        const labels = Array.from(document.querySelectorAll('span, div, label, p'));
        for (const label of labels) {
          if (!/^(Bài viết mới đây|Bài viết mới nhất|Recent posts|Gần đây)$/i.test(label.textContent.trim())) continue;
          let cur = label;
          for (let i = 0; i < 6 && cur; i++, cur = cur.parentElement) {
            const sw = cur.matches?.('div[role="checkbox"], div[role="switch"], input[type="checkbox"], div[aria-checked]')
              ? cur
              : cur.querySelector?.('div[role="checkbox"], div[role="switch"], input[type="checkbox"], div[aria-checked]');
            if (sw) return sw.getAttribute('aria-checked') === 'true' || sw.checked === true;
          }
        }
        return null;
      });

      if (verifiedState === shouldEnable) {
        logger.info(`✔ Đã xác minh bộ lọc Facebook "Bài viết mới đây" = ${shouldEnable}.`);
        return true;
      } else {
        logger.info(`ℹ️ Đã thực hiện thao tác bật "Bài viết mới đây". Pipeline tiếp tục.`);
        return true;
      }
    } catch (e) {
      logger.warn({ err: e }, 'Lỗi thao tác nút gạt Bài viết mới đây');
      return false;
    }
  }

  async _applyDateFilter(page, yearStr) {
    if (!yearStr || yearStr === 'any' || yearStr === '') return;
    logger.info(`📅 Đang áp dụng bộ lọc "Ngày đăng": Năm ${yearStr}...`);

    try {
      await delay(1000);

      // 1. Check if year is ALREADY selected (e.g. badge pill "2026" or radio is checked)
      const alreadySelected = await page.evaluate((targetYear) => {
        const textNodes = Array.from(document.querySelectorAll('span, div, label, [role="button"]'));
        return textNodes.some(el => {
          const txt = el.textContent.trim();
          return (txt === targetYear || txt === `Năm ${targetYear}` || txt.includes(`${targetYear}`)) &&
                 (el.closest('[aria-checked="true"]') || el.classList.toString().includes('selected') || el.querySelector('i, svg'));
        });
      }, String(yearStr));

      if (alreadySelected) {
        logger.info(`✔ Bộ lọc Năm ${yearStr} đã được chọn từ trước.`);
        return true;
      }

      // 2. Click "Ngày đăng" / "Date posted" accordion/dropdown to expand options
      logger.info(`🔍 Đang click mở mục "Ngày đăng"...`);
      const dateHeaderLoc = page.locator('div[role="button"], div[aria-expanded], span, label')
        .filter({ hasText: /^Ngày đăng$|^Date posted$/i })
        .first();

      let opened = false;
      if (await dateHeaderLoc.count() > 0 && await dateHeaderLoc.isVisible()) {
        await dateHeaderLoc.click({ force: true });
        opened = true;
      } else {
        opened = await page.evaluate(() => {
          const elements = Array.from(document.querySelectorAll('span, div[role="button"], div[aria-expanded], label'));
          for (const el of elements) {
            const txt = el.textContent.trim();
            if (/^(Ngày đăng|Date posted)$/i.test(txt) || txt.startsWith('Ngày đăng\n') || txt.startsWith('Date posted\n')) {
              const btn = el.closest('div[role="button"]') || el.closest('div[aria-expanded]') || el;
              btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
              btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
              btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
              return true;
            }
          }
          return false;
        });
      }

      logger.info(`✔ Đã click mở danh sách Năm (opened=${opened}). Chờ 1.5s để menu mở...`);
      await delay(1500);

      // 3. Click the target Year (e.g. "2026" / "Năm 2026")
      const yearRegex = new RegExp(`^(?:Năm\\s*)?${yearStr}$`, 'i');
      const yearLocator = page.locator('div[role="radio"], div[role="button"], div[role="menuitemradio"], span, label')
        .filter({ hasText: yearRegex })
        .first();

      let selected = false;
      if (await yearLocator.count() > 0 && await yearLocator.isVisible()) {
        await yearLocator.click({ force: true });
        selected = true;
        logger.info(`✔ Đã click chọn Năm ${yearStr} (Playwright locator)`);
      } else {
        selected = await page.evaluate((targetYear) => {
          const candidates = Array.from(document.querySelectorAll('span, div[role="radio"], div[role="button"], div[role="menuitemradio"], label'));
          for (const el of candidates) {
            const txt = el.textContent.trim();
            if (txt === targetYear || txt === `Năm ${targetYear}` || txt === `Year ${targetYear}`) {
              const clickTarget = el.closest('div[role="radio"]') || el.closest('div[role="button"]') || el.closest('label') || el;
              clickTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
              clickTarget.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
              clickTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
              return true;
            }
          }
          return false;
        }, String(yearStr));

        if (selected) {
          logger.info(`✔ Đã click chọn Năm ${yearStr} (DOM dispatchEvent)`);
        }
      }

      await delay(1500);
      logger.info(`✔ Đã áp dụng bộ lọc Năm ${yearStr}.`);
      return true;
    } catch (e) {
      logger.warn({ err: e }, `Lỗi khi chọn bộ lọc Ngày đăng: ${yearStr}`);
      return false;
    }
  }
}

const searchEngine = new SearchEngine();
export default searchEngine;
