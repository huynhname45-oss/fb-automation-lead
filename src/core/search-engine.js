import EventEmitter from 'events';
import browserManager from './browser-manager.js';
import configManager from './config-manager.js';
import logger from './logger.js';
import { processResults, generateExcerpt, generateSummary } from './data-processor.js';
import { getCanonicalPostKey } from './history-manager.js';
import { extractPhonesFromText, mergePhoneEvidence, mergePhoneEvidenceCollections } from './phone-validator.js';
import { extractLocationDetailed } from './location-extractor.js';
import leadFilter from './lead-filter.js';
import ocrManager from './ocr-manager.js';
import aiLeadEvaluator from './ai-lead-evaluator.js';
import fsSync from 'fs';
import path from 'path';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export function getLoggedInUserUid(cookieInput = '') {
  if (cookieInput && typeof cookieInput === 'string') {
    const m = cookieInput.match(/(?:^|[;\s])c_user=([a-zA-Z0-9_-]+)/);
    if (m && m[1]) return m[1].trim();
  }
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
export function buildProfileSearchUrl(profileUrlOrUid = '', keyword = 'sdt') {
  if (!profileUrlOrUid || typeof profileUrlOrUid !== 'string') return '';
  const kw = encodeURIComponent(keyword.trim());
  const uid = extractUidFromUrl(profileUrlOrUid);
  if (uid) {
    return `https://www.facebook.com/profile/${uid}/search/?q=${kw}`;
  }
  if (/^\d{8,}$/.test(profileUrlOrUid.trim())) {
    return `https://www.facebook.com/profile/${profileUrlOrUid.trim()}/search/?q=${kw}`;
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
 * Pure helper function to extract post metadata (authorName, profileLink, groupName, groupLink, postLink)
 * from an array of anchor objects [{ text, href, aria }].
 * Supports Facebook Group posts, Page posts, Personal posts, and Media posts.
 */
export function extractPostMetadataFromAnchors(anchorsData = []) {
  let authorName = '';
  let profileLink = '';
  let groupName = '';
  let groupLink = '';
  let postLink = '';

  function cleanUrl(href) {
    if (!href) return '';
    return href.startsWith('/') ? 'https://www.facebook.com' + href : href;
  }

  function isGroupHome(href) {
    return href.includes('/groups/') && 
           !href.includes('/user/') && 
           !href.includes('/member/') && 
           !href.includes('/members/') && 
           !href.includes('/posts/') && 
           !href.includes('/permalink');
  }

  // Phase 1: Extract Group Name (if posted in a Facebook Group)
  for (const a of anchorsData) {
    const rawTxt = (a.text || '').trim();
    const txt = rawTxt.split('\n')[0].trim();
    const href = a.href || '';
    if (!href || href === '#' || href.startsWith('javascript:')) continue;

    if (isGroupHome(href) && txt && txt.length >= 2 && txt.length <= 100) {
      if (!/(?:tham gia|join|theo dõi|follow|đã tham gia|thích|nhắn tin)/i.test(txt)) {
        groupName = txt;
        groupLink = cleanUrl(href);
        break;
      }
    }
  }

  // Phase 2: Extract Author Name & Profile Link (Supports Group Posts & Personal/Page Posts)
  for (const a of anchorsData) {
    const rawTxt = (a.text || '').trim();
    const txt = rawTxt.split('\n')[0].trim();
    const href = a.href || '';
    if (!href || href === '#' || href.startsWith('javascript:')) continue;

    const isPostPermalink = href.includes('/posts/') || 
                            href.includes('/permalink') || 
                            href.includes('story_fbid') || 
                            href.includes('pfbid') || 
                            href.includes('/photos/') || 
                            href.includes('/videos/') || 
                            href.includes('/reel/') || 
                            href.includes('fbid=') || 
                            href.includes('comment_id=') || 
                            href.includes('multi_permalinks');
    if (isPostPermalink) continue;
    if (isGroupHome(href)) continue;

    const isActionButton = /(?:xem thêm|ẩn bớt|theo dõi|tham gia|join|follow|đã tham gia|thích|like|nhắn tin|gửi tin nhắn|bình luận|chia sẻ|share)/i.test(txt);
    if (isActionButton) continue;

    const isTimestamp = /(?:\d{1,2}\s*(?:phút|giờ|h|ngày|tháng|năm)|vừa xong|hôm qua)/i.test(txt);
    if (isTimestamp) continue;

    const aria = (a.aria || '').trim();
    const isNavIcon = (!txt) || 
                      aria.includes('Home') || 
                      aria.includes('Trang chủ') || 
                      aria.includes('Watch') || 
                      aria.includes('Notifications') || 
                      aria.includes('Facebook');
    if (isNavIcon) continue;

    const isNonProfile = href.includes('/hashtag/') || 
                         href.includes('/events/') || 
                         href.includes('/gaming/') || 
                         href.includes('/watch/') || 
                         href.includes('/marketplace/') || 
                         href.includes('/search/') || 
                         href.includes('/messages/') || 
                         href.includes('/sharer/') || 
                         href.includes('/dialog/') || 
                         href.includes('/settings/') || 
                         href.includes('/help/');
    if (isNonProfile) continue;

    if (txt && txt.length >= 2 && txt.length <= 70 && !txt.startsWith('#')) {
      authorName = txt;
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
      break;
    }
  }

  // Phase 3: Post Permalink (Direct permalinks prioritized over media permalinks)
  for (const a of anchorsData) {
    const href = a.href || '';
    if (!href || href === '#' || href.startsWith('javascript:')) continue;

    const isDirectPosts = href.includes('/posts/') || 
                          href.includes('/permalink') || 
                          href.includes('story_fbid') || 
                          href.includes('pfbid') || 
                          href.includes('multi_permalinks');
    if (isDirectPosts) {
      postLink = cleanUrl(href);
      break;
    }
  }

  if (!postLink) {
    for (const a of anchorsData) {
      const href = a.href || '';
      if (!href || href === '#' || href.startsWith('javascript:')) continue;

      const isMediaPermalink = href.includes('/photos/') || 
                               href.includes('/videos/') || 
                               href.includes('/reel/') || 
                               href.includes('fbid=') || 
                               href.includes('/watch/?v=');
      if (isMediaPermalink) {
        postLink = cleanUrl(href);
        break;
      }
    }
  }

  return { authorName, profileLink, groupName, groupLink, postLink };
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
    this.currentKeyword = '';
    this.finishedReason = null;
    this.clientTasks = new Map();
  }

  async search(keyword, filters = {}, maxPosts = null, clientId = 'default') {
    const isClientIsolated = filters.isClientIsolated || (clientId && clientId !== 'default');
    const targetAccepted = normalizeTargetAccepted(maxPosts, configManager.get('maxPosts') || 50);

    const task = {
      clientId,
      status: 'searching',
      keyword,
      finishedReason: null,
      found: 0,
      acceptedCount: 0,
      reviewCount: 0,
      rejectedCount: 0,
      total: targetAccepted,
      isStopped: false,
      results: []
    };
    this.clientTasks.set(clientId, task);

    this.status = 'searching';
    this.currentKeyword = keyword;
    this.finishedReason = null;
    this.found = 0;
    this.acceptedCount = 0;
    this.reviewCount = 0;
    this.rejectedCount = 0;

    const isHeadless = !!configManager.get('headless');
    const crawlDelay = parseInt(configManager.get('crawlDelay'), 10) || 2000;

    const rawExcludes = filters.excludeKeywords || [];
    const excludeKeywords = (Array.isArray(rawExcludes) ? rawExcludes : String(rawExcludes).split(/[,，]+/))
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);

    this.total = targetAccepted;
    this.isStopped = false;
    this.results = [];
    this.emit('progress', this.getProgress(clientId));

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
      const context = isClientIsolated
        ? await browserManager.createClientContext(clientId, isHeadless)
        : await browserManager.launch(isHeadless);

      if (filters.cookie) {
        try {
          const { parseCookieInput } = await import('./session-manager.js');
          const formatted = parseCookieInput(filters.cookie);
          if (formatted.length > 0) {
            await context.addCookies(formatted);
            logger.info(`🍪 [CLIENT COOKIE] Đã nạp ${formatted.length} cookie từ máy Client vào phiên cào Playwright.`);
          }
        } catch (e) {
          logger.warn({ err: e }, 'Lỗi nạp cookie từ máy client');
        }
      }

      const pages = context.pages();
      page = pages.length > 0 ? pages[0] : await context.newPage();

      // 1. Navigate to Posts Search Page (Use /search/posts/ for full infinite-scroll feed of posts)
      const searchUrl = `https://www.facebook.com/search/posts/?q=${encodeURIComponent(keyword)}`;
      logger.info(`1. Đang mở trang tìm kiếm Bài viết Facebook: ${searchUrl}`);
      const navRes = await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await delay(crawlDelay);

      const pageBodyText = await page.evaluate(() => (document.body?.innerText || '').trim());
      const currentUrl = page.url();

      if (navRes?.status() === 404 || pageBodyText === 'Not Found' || currentUrl.includes('/login') || currentUrl.includes('/checkpoint')) {
        logger.warn('Facebook session expired or logged out. Directing user to re-login.');
        throw new Error('Phiên đăng nhập Facebook đã hết hạn hoặc bị đăng xuất (Facebook hiển thị Not Found / Yêu cầu đăng nhập). Bạn vui lòng vào Tab "Session Manager" đăng nhập lại Facebook rồi bấm Bắt đầu tìm kiếm tiếp nhé!');
      }

      // 2. Select All (Tất cả) Tab in sidebar to expand sub-filters (Bài viết mới đây, Ngày đăng)
      await this._applyAllTab(page);
      await delay(1500);

      // 3. Toggle "Bài viết mới đây" (Recent Posts)
      const enableRecent = filters.recentPosts !== false;
      if (enableRecent) {
        logger.info('3. Kích hoạt bộ lọc: Bật nút gạt "Bài viết mới đây" (Recent posts)...');
        await this._applyRecentPostsToggle(page, true);
        await delay(1500);
      }

      // 4. Select "Ngày đăng" (Date Posted - Year)
      if (filters.datePosted && filters.datePosted !== 'any' && filters.datePosted !== '') {
        logger.info(`4. Kích hoạt bộ lọc: "Ngày đăng" (Năm ${filters.datePosted})...`);
        await this._applyDateFilter(page, filters.datePosted);
        await delay(1500);
      }

      const processedPostKeys = new Set();
      if (Array.isArray(filters.existingKeys) && filters.existingKeys.length > 0) {
        filters.existingKeys.forEach(k => {
          if (k) processedPostKeys.add(String(k).trim());
        });
        logger.info(`ℹ️ [ĐỒNG BỘ CLIENT] Đã nạp ${filters.existingKeys.length} bài viết đã lưu từ máy Client để chống cào trùng.`);
      }

      const acceptedAuthorIndex = new Map();
      let scrollAttempts = 0;
      let noNewPostsCount = 0;

      logger.info(`⚡ [TĂNG TỐC QUÉT DỮ LIỆU & OCR] Bắt đầu tìm kiếm ${targetAccepted} bài viết hợp lệ.`);

      // =========================================================================
      // BƯỚC 4: CUỘN TRANG TIẾP TỤC CHO ĐẾN KHI ĐỦ BÀI (Continuous Stream Loop)
      // =========================================================================
      while ((isClientIsolated ? task.acceptedCount : this.acceptedCount) < targetAccepted && (isClientIsolated ? !task.isStopped : (!this.isStopped && !task.isStopped)) && noNewPostsCount < 150) {
        if (!page || page.isClosed() || (isClientIsolated ? task.isStopped : (this.isStopped || task.isStopped))) {
          break;
        }

        // Expand "Xem thêm" on search feed
        await this._expandSeeMore(page);

        if (page.isClosed() || (isClientIsolated ? task.isStopped : (this.isStopped || task.isStopped))) {
          break;
        }

        // Fast Candidate Post Extractor with Clean Visible Text & Image URLs
        let rawPosts = [];
        try {
          rawPosts = await page.evaluate(() => {
          let articles = Array.from(document.querySelectorAll('div[role="feed"] > div, div[role="article"], div[data-pagelet*="FeedUnit"]'));

          if (articles.length === 0) {
            const containers = Array.from(document.querySelectorAll('div[dir="auto"]'))
              .map(el => el.closest('div[role="feed"] > div') || el.closest('div[role="article"]') || el.closest('div[data-pagelet]'))
              .filter(Boolean);
            articles = Array.from(new Set(containers));
          }

          const list = [];

          articles.forEach(node => {
            // Trích xuất chính xác văn bản bài viết từ message container chính thức của Facebook
            let visibleText = '';
            const msgEl = node.querySelector('div[data-ad-preview="message"], div[data-ad-comet-preview="message"]');
            if (msgEl) {
              visibleText = (msgEl.innerText || '').trim();
            }
            if (!visibleText || visibleText.length < 20) {
              const dirEls = Array.from(node.querySelectorAll('div[dir="auto"]'));
              const candidateTexts = dirEls
                .map(d => (d.innerText || '').trim())
                .filter(t => t.length > 20 && !t.startsWith('#') && !/(?:xem thêm|thích|bình luận|chia sẻ|hoạt động|gợi ý)/i.test(t));
              if (candidateTexts.length > 0) {
                visibleText = candidateTexts.join('\n');
              }
            }
            if (!visibleText || visibleText.length < 20) {
              visibleText = (node.innerText || '').trim();
            }
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
            let groupName = '';
            let groupLink = '';
            let postLink = '';

            function cleanUrl(href) {
              if (!href) return '';
              return href.startsWith('/') ? 'https://www.facebook.com' + href : href;
            }

            function isGroupHome(href) {
              return href.includes('/groups/') && 
                     !href.includes('/user/') && 
                     !href.includes('/member/') && 
                     !href.includes('/members/') && 
                     !href.includes('/posts/') && 
                     !href.includes('/permalink');
            }

            // SEARCH-P0-003: Robust Candidate Anchors (Header elements first, followed by top 15 post anchors)
            const headerElements = Array.from(node.querySelectorAll('header a[href], h2 a[href], h3 a[href], h4 a[href], strong a[href], div[role="heading"] a[href]'));
            const candidateAnchors = [];
            const seenAnchorEls = new Set();
            for (const a of [...headerElements, ...anchors.slice(0, 15)]) {
              if (a && !seenAnchorEls.has(a)) {
                seenAnchorEls.add(a);
                candidateAnchors.push(a);
              }
            }

            // Phase 1: Extract Group Name (if posted in a Facebook Group)
            for (const a of candidateAnchors) {
              const rawTxt = (a.textContent || '').trim();
              const txt = rawTxt.split('\n')[0].trim();
              const href = a.getAttribute('href') || '';
              if (!href || href === '#' || href.startsWith('javascript:')) continue;

              if (isGroupHome(href) && txt && txt.length >= 2 && txt.length <= 100) {
                if (!/(?:tham gia|join|theo dõi|follow|đã tham gia|thích|nhắn tin)/i.test(txt)) {
                  groupName = txt;
                  groupLink = cleanUrl(href);
                  break;
                }
              }
            }

            // Phase 2: Extract Author Name & Profile Link (Supports Group Posts & Personal/Page Posts)
            for (const a of candidateAnchors) {
              const rawTxt = (a.textContent || '').trim();
              const txt = rawTxt.split('\n')[0].trim();
              const href = a.getAttribute('href') || '';
              if (!href || href === '#' || href.startsWith('javascript:')) continue;

              const isPostPermalink = href.includes('/posts/') || 
                                      href.includes('/permalink') || 
                                      href.includes('story_fbid') || 
                                      href.includes('pfbid') || 
                                      href.includes('/photos/') || 
                                      href.includes('/videos/') || 
                                      href.includes('/reel/') || 
                                      href.includes('fbid=') || 
                                      href.includes('comment_id=') || 
                                      href.includes('multi_permalinks');
              if (isPostPermalink) continue;
              if (isGroupHome(href)) continue;

              const isActionButton = /(?:xem thêm|ẩn bớt|theo dõi|tham gia|join|follow|đã tham gia|thích|like|nhắn tin|gửi tin nhắn|bình luận|chia sẻ|share)/i.test(txt);
              if (isActionButton) continue;

              const isTimestamp = /(?:\d{1,2}\s*(?:phút|giờ|h|ngày|tháng|năm)|vừa xong|hôm qua)/i.test(txt);
              if (isTimestamp) continue;

              const aria = (a.getAttribute('aria-label') || '').trim();
              const isNavIcon = (!txt) || 
                                aria.includes('Home') || 
                                aria.includes('Trang chủ') || 
                                aria.includes('Watch') || 
                                aria.includes('Notifications') || 
                                aria.includes('Facebook');
              if (isNavIcon) continue;

              const isNonProfile = href.includes('/hashtag/') || 
                                   href.includes('/events/') || 
                                   href.includes('/gaming/') || 
                                   href.includes('/watch/') || 
                                   href.includes('/marketplace/') || 
                                   href.includes('/search/') || 
                                   href.includes('/messages/') || 
                                   href.includes('/sharer/') || 
                                   href.includes('/dialog/') || 
                                   href.includes('/settings/') || 
                                   href.includes('/help/');
              if (isNonProfile) continue;

              if (txt && txt.length >= 2 && txt.length <= 70 && !txt.startsWith('#')) {
                authorName = txt;
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
                break; // Found post author!
              }
            }

            // Phase 3: Post Permalink (Direct permalinks prioritized over media permalinks)
            for (const a of anchors) {
              const href = a.getAttribute('href') || '';
              if (!href || href === '#' || href.startsWith('javascript:')) continue;

              const isDirectPosts = href.includes('/posts/') || 
                                    href.includes('/permalink') || 
                                    href.includes('story_fbid') || 
                                    href.includes('pfbid') || 
                                    href.includes('multi_permalinks');
              if (isDirectPosts) {
                postLink = cleanUrl(href);
                break;
              }
            }

            if (!postLink) {
              for (const a of anchors) {
                const href = a.getAttribute('href') || '';
                if (!href || href === '#' || href.startsWith('javascript:')) continue;

                const isMediaPermalink = href.includes('/photos/') || 
                                         href.includes('/videos/') || 
                                         href.includes('/reel/') || 
                                         href.includes('fbid=') || 
                                         href.includes('/watch/?v=');
                if (isMediaPermalink) {
                  postLink = cleanUrl(href);
                  break;
                }
              }
            }

            // Phase 4: Tagged Place / Fanpage Check-in
            let taggedPlaceName = '';
            let taggedPlaceUrl = '';
            const headerNode = node.querySelector('header, h2, h3, h4') || node.querySelector('div[role="article"] > div:first-child');
            if (headerNode) {
              const headerText = headerNode.textContent || '';
              const placeMatch = headerText.match(/(?:\s+tại\s+|\s+at\s+)([^.\n\r]+)/iu);
              if (placeMatch && placeMatch[1]) {
                const rawPlaceName = placeMatch[1].trim();
                for (const a of candidateAnchors) {
                  const aTxt = (a.textContent || '').trim();
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
                groupName: groupName,
                groupLink: groupLink,
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
        } catch (evalErr) {
          if (task.isStopped || (isClientIsolated ? task.isStopped : this.isStopped) || page.isClosed() || (evalErr.message && evalErr.message.includes('closed'))) {
            logger.info(`⏹ Trình duyệt đã đóng hoặc phiên quét đã dừng cho client [${clientId}].`);
            break;
          }
          throw evalErr;
        }

        let foundNewCandidateInThisBatch = false;

        // Process candidate posts with EXACT 4-STEP ORDER
        for (const post of rawPosts) {
          if ((isClientIsolated ? task.acceptedCount : this.acceptedCount) >= targetAccepted || (isClientIsolated ? task.isStopped : this.isStopped)) break;
          if (!post.authorName || !post.postLink) continue;

          // Unique Post Key Check
          const canonicalKey = getCanonicalPostKey(post);
          const postKey = `${post.authorName}_${post.content.substring(0, 60)}`;
          if (processedPostKeys.has(postKey) || (canonicalKey && processedPostKeys.has(canonicalKey))) continue;
          processedPostKeys.add(postKey);
          if (canonicalKey) processedPostKeys.add(canonicalKey);
          foundNewCandidateInThisBatch = true;

          // Resolve a stable author key. Multiple posts from the same author are
          // aggregated later instead of being discarded before enrichment.
          const authorKey = getCanonicalAuthorKey(post);

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

          const fullPostContent = (postVerification.fullContent && postVerification.fullContent.length >= (post.content || '').length)
            ? postVerification.fullContent
            : (post.content || postVerification.fullContent || '');

          if (!fullPostContent || fullPostContent.length < 25 || fullPostContent.trim().toLowerCase() === post.authorName.trim().toLowerCase()) {
            logger.info(`❌ [BỎ QUA NỘI DUNG RỖNG] BỎ QUA [${post.authorName}] vì không có nội dung bài viết chi tiết.`);
            this.rejectedCount++;
            continue;
          }

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
                verified: true,
                authorMatched: true
              })),
              'post_text',
              1.0,
              fullPostContent.substring(0, 220),
              evidenceMetadata
            );
          }

          let locationResult = extractLocationDetailed({
            content: fullPostContent + (post.groupName ? `\nNhóm: ${post.groupName}` : ''),
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
                    isTaggedPlace ? `Thông tin liên hệ từ trang Fanpage check-in [${post.taggedPlaceName}]` : (profileRes.source?.includes('search') ? `Bài viết tìm kiếm 'sdt' trên trang [${post.authorName}]` : (profileRes.source?.includes('timeline') ? `Bài viết mới nhất trên tường [${post.authorName}]` : 'Thông tin liên hệ trên trang của tác giả')),
                    {
                      ...evidenceMetadata,
                      sourceUrl: targetUrl,
                      verified: true
                    }
                  );
                  if (profileRes.location && profileRes.location !== '—' && (detectedLocation === '—' || profileRes.source?.includes('timeline') || profileRes.source?.includes('search'))) {
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

          // Ưu tiên các số điện thoại lấy trực tiếp từ bài viết (confidence cao nhất, 1.0) lên đầu
          phoneEvidence.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

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

          const itemKey = getCanonicalPostKey({ postLink: cleanPostUrl, authorName: post.authorName, content: fullPostContent });
          // Lưu bài viết đã được AI duyệt vào danh sách kết quả
          const cleanPostObj = {
            key: itemKey,
            id: itemKey,
            authorName: post.authorName,
            authorKey,
            location: detectedLocation,
            groupName: post.groupName || undefined,
            groupLink: post.groupLink || undefined,
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
            salesPitch: aiEval.salesPitch || '',
            recommendedFeatures: aiEval.recommendedFeatures || '',
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
            acceptedAuthorIndex.set(authorKey, task.results.length);
            if (!isClientIsolated) {
              this.results.push(cleanPostObj);
              this.acceptedCount++;
              this.found = this.acceptedCount;
            }
            task.results.push(cleanPostObj);
            task.acceptedCount++;
            task.found = task.acceptedCount;
          }
          this.emit('progress', this.getProgress(clientId));

          const phoneLogStr = phones.length > 0 ? `SĐT: [${phones.join(', ')}]` : `[CHƯA CÓ SĐT - NHẮN TIN FB]`;
          logger.info(`⚡ [THÀNH CÔNG] [${task.found}/${targetAccepted}] ${phoneLogStr} | Điểm: ${aiEval.score}/100 | Ngành: ${aiEval.businessType} | Tác giả: ${post.authorName}`);
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
        const clientAccepted = isClientIsolated ? task.acceptedCount : this.acceptedCount;
        const isTaskStopped = isClientIsolated ? task.isStopped : (this.isStopped || task.isStopped);
        if (clientAccepted < targetAccepted && !isTaskStopped) {
          scrollAttempts++;
          await this._smoothScrollDown(page, 2500);
          await delay(crawlDelay);
        }
      }

      const processedResults = processResults(this.results);
      const finalAccepted = isClientIsolated ? task.acceptedCount : this.acceptedCount;
      const isTaskStopped = isClientIsolated ? task.isStopped : (this.isStopped || task.isStopped);
      
      if (finalAccepted < targetAccepted && !isTaskStopped) {
        this.finishedReason = 'all_posts_exhausted';
        task.finishedReason = 'all_posts_exhausted';
        logger.info(`ℹ️ Đã quét hết toàn bộ bài viết khả dụng trên Facebook cho từ khóa "${keyword}" trong 24 giờ qua (Facebook không còn bài viết mới nào khác để tải thêm, tìm thấy ${finalAccepted}/${targetAccepted} bài đạt chuẩn).`);
      } else if (!isTaskStopped) {
        this.finishedReason = 'target_reached';
        task.finishedReason = 'target_reached';
      } else {
        this.finishedReason = 'user_stopped';
        task.finishedReason = 'user_stopped';
      }

      logger.info(`🎉 HOÀN TẤT! ${finalAccepted}/${targetAccepted} lead được duyệt, ${this.reviewCount} bài cần kiểm tra; đã thu thập ${task.results.length} bản ghi cho client [${clientId}].`);

      this.status = this.isStopped ? 'stopped' : 'idle';
      task.status = task.isStopped ? 'stopped' : 'idle';
      this.emit('progress', this.getProgress(clientId));
      
      return task.results.length > 0 ? task.results : processedResults;

    } catch (error) {
      const isClosedErr = error.message && (
        error.message.includes('Target page, context or browser has been closed') ||
        error.message.includes('TargetClosedError') ||
        error.message.includes('Session closed')
      );
      if (task.isStopped || (isClientIsolated ? task.isStopped : this.isStopped) || isClosedErr) {
        logger.info(`⏹ Phiên tìm kiếm của client [${clientId}] đã dừng (context closed).`);
        task.finishedReason = 'user_stopped';
        task.status = 'stopped';
        return task.results || [];
      }
      logger.error({ err: error }, 'Search failed');

      throw error;
    } finally {
      task.status = task.isStopped ? 'stopped' : 'idle';
      if (!isClientIsolated) {
        this.status = this.isStopped ? 'stopped' : 'idle';
      }
      this.emit('progress', this.getProgress(clientId));
      try {
        if (isClientIsolated) {
          await browserManager.closeClientContext(clientId);
          logger.info(`🔒 Đã đóng trình duyệt Chromium cho client [${clientId}].`);
        } else {
          await browserManager.closeBrowser();
          logger.info('🔒 Đã đóng trình duyệt Chromium.');
        }
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
      await inspectPage.waitForSelector('div[data-ad-preview="message"], div[data-ad-comet-preview="message"], div[role="article"], div[dir="auto"]', { timeout: 3500 }).catch(() => {});
      await delay(Math.min(crawlDelay, 2000));

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
        
        let mainText = '';

        // Ưu tiên 1: Lấy trực tiếp từ container thông điệp chính thức của bài viết Facebook
        const messageEls = Array.from(document.querySelectorAll('div[data-ad-preview="message"], div[data-ad-comet-preview="message"]'));
        if (messageEls.length > 0) {
          mainText = messageEls.map(el => (el.innerText || '').trim()).filter(Boolean).join('\n');
        }

        // Ưu tiên 2: Tìm kiếm các khối văn bản dir="auto" trong modal/article
        if (!mainText || mainText.length < 20) {
          const postContainers = Array.from(document.querySelectorAll('div[role="dialog"] div[role="article"], div[role="main"] div[role="article"], div[role="article"]'));
          for (const pNode of postContainers) {
            const textNodes = Array.from(pNode.querySelectorAll('div[dir="auto"]'));
            const validTexts = textNodes
              .map(t => (t.innerText || '').trim())
              .filter(t => t.length >= 20 && !/(?:bình luận|chia sẻ|thích|phản hồi|xem thêm)/i.test(t));
            if (validTexts.length > 0) {
              mainText = validTexts.join('\n');
              break;
            }
          }
        }

        // Ưu tiên 3: Fallback lấy toàn bộ nội dung trong articleNode
        if (!mainText || mainText.length < 20) {
          let articleNode = document.querySelector('div[role="dialog"] div[role="article"], div[role="article"], div[data-pagelet*="FeedUnit"]') || document.querySelector('div[role="main"]') || document.body;
          if (articleNode) {
            const clone = articleNode.cloneNode(true);
            const navs = clone.querySelectorAll('header, nav, div[role="navigation"], div[aria-label="Account"], div[role="banner"], svg, a[aria-label="Facebook"], div[aria-label*="Bình luận"], div[aria-label*="Comment"], form, ul, ol');
            navs.forEach(n => n.remove());
            mainText = (clone.innerText || '').trim();
          }
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

      // Kỹ thuật Jiggle Scroll để kích hoạt lại IntersectionObserver / Infinite Scroll của Facebook
      await page.evaluate(() => {
        const bottom = Math.max(
          document.body ? document.body.scrollHeight : 0,
          document.documentElement ? document.documentElement.scrollHeight : 0
        );
        // Cuộn ngược nhẹ 350px để lôi sentinel ra khỏi viewport
        window.scrollTo({ top: Math.max(0, bottom - 350), behavior: 'auto' });
        setTimeout(() => {
          // Cuộn lại chạm đáy và dispatch event scroll
          window.scrollTo({ top: bottom, behavior: 'auto' });
          window.dispatchEvent(new Event('scroll'));
        }, 50);

        // Tự động bấm nút "Thử lại" hoặc "Tải thêm" nếu Facebook bị nghẽn mạng
        const actionButtons = Array.from(document.querySelectorAll('div[role="button"], span, a'));
        for (const btn of actionButtons) {
          const txt = (btn.textContent || '').trim();
          if (/^(Thử lại|Tải thêm|Xem thêm kết quả|Retry|Load more)$/i.test(txt)) {
            try { btn.click(); } catch (e) {}
            break;
          }
        }
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

      let loggedInUid = '';
      if (context) {
        try {
          const contextCookies = await context.cookies();
          loggedInUid = contextCookies.find(c => c.name === 'c_user')?.value || '';
        } catch (e) {}
      }

      // 1. Phân giải numeric User ID (UID) của tác giả (loại trừ tài khoản đang đăng nhập)
      let resolvedUid = extractUidFromUrl(profileUrl);
      if (resolvedUid && loggedInUid && resolvedUid === loggedInUid) {
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

          // F) Trích xuất Ảnh bìa (Cover Photo) và Ảnh đại diện (Avatar) của trang
          let coverPhotoUrl = '';
          const coverSelectors = [
            'div[data-pagelet="ProfileCover"] img[src]',
            'div[data-pagelet*="Cover"] img[src]',
            'div[aria-label*="Ảnh bìa"] img[src]',
            'div[aria-label*="Cover photo"] img[src]',
            'div[aria-label*="Cover Photo"] img[src]',
            'a[href*="/photo"][aria-label*="bìa"] img[src]',
            'a[href*="/photo"][aria-label*="Cover"] img[src]',
            'img[data-imgperflogname="profileCoverPhoto"]',
            'div[role="banner"] img[src*="scontent"]',
            'div[role="banner"] img[src*="fbcdn"]'
          ];

          for (const sel of coverSelectors) {
            const el = document.querySelector(sel);
            if (el) {
              const s = el.src || el.getAttribute('src') || '';
              if (s && (s.includes('scontent') || s.includes('fbcdn')) && !s.includes('emoji') && !s.includes('rsrc.php')) {
                coverPhotoUrl = s;
                break;
              }
            }
          }

          if (!coverPhotoUrl) {
            const candidateImgs = Array.from(document.querySelectorAll('img[src*="scontent"], img[src*="fbcdn"]'));
            for (const img of candidateImgs) {
              const rect = img.getBoundingClientRect();
              if (rect.top < 450 && rect.width >= 300 && rect.height >= 80 && (rect.width / rect.height) >= 1.3) {
                const s = img.src || '';
                if (s && !s.includes('emoji') && !s.includes('rsrc.php') && !s.includes('/static.xx/')) {
                  coverPhotoUrl = s;
                  break;
                }
              }
            }
          }

          let avatarUrl = '';
          const avatarSelectors = [
            'div[data-pagelet="ProfileAvatar"] img[src]',
            'div[data-pagelet*="Avatar"] img[src]',
            'div[aria-label*="Ảnh đại diện"] img[src]',
            'div[aria-label*="Profile picture"] img[src]',
            'svg[aria-label*="Ảnh đại diện"] image',
            'svg[aria-label*="Profile picture"] image',
            'a[href*="/photo"][aria-label*="đại diện"] img[src]',
            'a[href*="/photo"][aria-label*="Profile picture"] img[src]'
          ];

          for (const sel of avatarSelectors) {
            const el = document.querySelector(sel);
            if (el) {
              const s = el.src || el.getAttribute('src') || el.getAttribute('xlink:href') || el.getAttribute('href') || '';
              if (s && (s.includes('scontent') || s.includes('fbcdn')) && !s.includes('emoji') && !s.includes('rsrc.php')) {
                avatarUrl = s;
                break;
              }
            }
          }

          return { uid, bioText, contactLinks, coverPhotoUrl, avatarUrl };
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

          // G) Quét OCR trên Ảnh Bìa (Cover Photo) và Avatar của trang (Nơi hầu hết các quán/shop đặt SĐT hotline và địa chỉ)
          const profileImages = [];
          if (profileData.coverPhotoUrl) profileImages.push(profileData.coverPhotoUrl);
          if (profileData.avatarUrl) profileImages.push(profileData.avatarUrl);

          if (profileImages.length > 0) {
            logger.info(`📸 [QUÉT ẢNH BÌA & AVATAR] Đang quét AI Vision / OCR trên Ảnh Bìa của [${targetAuthorName || 'Trang cá nhân'}]...`);
            const coverPhones = await ocrManager.extractPhonesFromImageUrls(profileImages);
            coverPhones.forEach(p => foundPhones.add(p));

            if (foundPhones.size > 0) {
              const phones = Array.from(foundPhones);
              logger.info(`✔ Tìm thấy ${phones.length} SĐT chính chủ từ Ảnh Bìa / Avatar của trang [${targetAuthorName || 'Tác giả'}]: [${phones.join(', ')}]`);
              return {
                phones,
                location: detectedLoc,
                locationResult,
                source: 'profile_cover_ocr',
                confidence: 0.95,
                verified: true
              };
            }
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

          // H) Nếu Bio, Ảnh bìa và Tường nhà chưa có SĐT: Tìm kiếm chuyên sâu trong bài viết của tác giả bằng từ khóa "sdt" (Profile Search)
          if (foundPhones.size === 0) {
            try {
              const searchProfileUrl = resolvedUid 
                ? `https://www.facebook.com/profile/${resolvedUid}/search/?q=sdt`
                : buildProfileSearchUrl(profileUrl, 'sdt');

              if (searchProfileUrl) {
                logger.info(`🔍 [TÌM KIẾM PROFILE] Đang tìm bài viết chứa 'sdt' của [${targetAuthorName || 'Tác giả'}]: ${searchProfileUrl}`);
                await profilePage.goto(searchProfileUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
                await delay(Math.min(crawlDelay, 2500));
                await this._expandSeeMore(profilePage);

                const searchResultsData = await profilePage.evaluate((targetAuthor) => {
                  function norm(s) {
                    return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
                  }
                  const targetNorm = norm(targetAuthor);

                  const articles = Array.from(document.querySelectorAll('div[role="feed"] > div, div[role="article"], div[data-pagelet*="FeedUnit"], div[data-ad-preview="message"]'));
                  const texts = [];
                  const imgs = [];

                  for (const art of articles.slice(0, 6)) {
                    const rawText = (art.innerText || art.textContent || '').trim();
                    if (rawText.length < 15) continue;

                    // Xác thực bài viết do chính tác giả đăng (hoặc tác giả đăng trong nhóm)
                    if (targetNorm) {
                      const authorLinks = Array.from(art.querySelectorAll('a[role="link"], h2 a, h3 a, h4 a, strong a'));
                      const authorFound = authorLinks.some(a => norm(a.textContent).includes(targetNorm));
                      if (!authorFound && !norm(rawText.substring(0, 200)).includes(targetNorm) && authorLinks.length > 0) {
                        continue;
                      }
                    }

                    texts.push(rawText);

                    const imgEls = Array.from(art.querySelectorAll('img[src]'));
                    for (const img of imgEls) {
                      const s = img.src || '';
                      if (s && (s.includes('scontent') || s.includes('fbcdn')) && !s.includes('emoji') && !s.includes('rsrc.php') && !s.includes('/static.xx/')) {
                        if (!imgs.includes(s)) imgs.push(s);
                      }
                    }
                  }
                  return { texts, imgs: imgs.slice(0, 3) };
                }, targetAuthorName);

                if (searchResultsData && searchResultsData.texts.length > 0) {
                  for (const st of searchResultsData.texts) {
                    const pList = extractPhonesFromText(st, { isOCR: false });
                    pList.forEach(p => foundPhones.add(p));

                    if (detectedLoc === '—') {
                      const sLoc = extractLocationDetailed({ content: st, authorName: targetAuthorName });
                      if (sLoc && sLoc.confidence >= 0.75 && !sLoc.conflict && sLoc.province !== '—') {
                        detectedLoc = sLoc.province;
                        locationResult = sLoc;
                      }
                    }
                  }

                  if (foundPhones.size > 0) {
                    const phones = Array.from(foundPhones);
                    logger.info(`✔ Tìm thấy ${phones.length} SĐT chính chủ từ tìm kiếm 'sdt' trên profile [${targetAuthorName || 'Tác giả'}]: [${phones.join(', ')}]`);
                    return {
                      phones,
                      location: detectedLoc,
                      locationResult,
                      source: 'profile_search',
                      confidence: 0.95,
                      verified: true
                    };
                  }

                  // Quét OCR trên ảnh kết quả tìm kiếm nếu chữ chưa có SĐT
                  if (searchResultsData.imgs.length > 0) {
                    const ocrPhones = await ocrManager.extractPhonesFromImageUrls(searchResultsData.imgs);
                    ocrPhones.forEach(p => foundPhones.add(p));
                    if (foundPhones.size > 0) {
                      const phones = Array.from(foundPhones);
                      logger.info(`✔ Tìm thấy ${phones.length} SĐT chính chủ từ ảnh tìm kiếm 'sdt' trên profile [${targetAuthorName || 'Tác giả'}]: [${phones.join(', ')}]`);
                      return {
                        phones,
                        location: detectedLoc,
                        locationResult,
                        source: 'profile_search_ocr',
                        confidence: 0.95,
                        verified: true
                      };
                    }
                  }
                }
              }
            } catch (searchErr) {
              logger.debug({ err: searchErr.message }, 'Lỗi khi tìm kiếm bài viết sdt trên profile');
            }
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

  async stop(clientId = 'default') {
    if (clientId && clientId !== 'default') {
      if (this.clientTasks.has(clientId)) {
        const task = this.clientTasks.get(clientId);
        task.isStopped = true;
        task.status = 'stopped';
      }
      this.emit('progress', this.getProgress(clientId));
      logger.info(`⏹ Đã nhận lệnh dừng tìm kiếm cho client [${clientId}]. Đang đóng Chromium context...`);
      try {
        await browserManager.closeClientContext(clientId);
      } catch (e) {
        logger.warn({ err: e.message }, `Failed to close client context for [${clientId}]`);
      }
      return;
    }

    this.isStopped = true;
    this.status = 'stopped';
    this.emit('progress', this.getProgress('default'));
    logger.info(`⏹ Đã nhận lệnh dừng tìm kiếm cho default server. Đang đóng trình duyệt Chromium...`);
    try {
      await browserManager.closeBrowser();
    } catch (e) {
      logger.warn({ err: e.message }, 'Failed to close browser on stop');
    }
  }

  getProgress(clientId = 'default') {
    if (clientId && clientId !== 'default' && this.clientTasks.has(clientId)) {
      const task = this.clientTasks.get(clientId);
      const phonesFound = Array.isArray(task.results)
        ? task.results.filter(r => (r.verifiedPhones && r.verifiedPhones.length > 0) || (r.phones && r.phones.length > 0)).length
        : 0;
      return {
        status: task.status,
        found: task.found,
        total: task.total,
        accepted: task.acceptedCount,
        review: task.reviewCount,
        rejected: task.rejectedCount,
        keyword: task.keyword || '',
        finishedReason: task.finishedReason || null,
        phoneCount: phonesFound
      };
    }

    const phonesFound = Array.isArray(this.results)
      ? this.results.filter(r => (r.verifiedPhones && r.verifiedPhones.length > 0) || (r.phones && r.phones.length > 0)).length
      : 0;

    return {
      status: this.status,
      found: this.found,
      total: this.total,
      accepted: this.acceptedCount,
      review: this.reviewCount,
      rejected: this.rejectedCount,
      keyword: this.currentKeyword || '',
      finishedReason: this.finishedReason || null,
      phoneCount: phonesFound
    };
  }

  getResults(clientId = 'default') {
    if (clientId && clientId !== 'default' && this.clientTasks.has(clientId)) {
      return this.clientTasks.get(clientId).results || [];
    }
    return this.results || [];
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
      logger.info('📌 Đang kiểm tra và chọn mục "Tất cả" trên thanh bộ lọc tìm kiếm...');
      await delay(1000);

      // 1. Check if sub-filters are already visible
      const isAlreadyExpanded = await page.evaluate(() => {
        const textNodes = Array.from(document.querySelectorAll('span, div, label, p'));
        return textNodes.some(el => /(Bài viết mới đây|Bài viết gần đây|Bài viết mới nhất|Recent posts|Ngày đăng|Date posted)/i.test((el.innerText || el.textContent || '').trim()));
      }).catch(() => false);

      if (isAlreadyExpanded) {
        logger.info('✔ Bộ lọc "Tất cả" đã được mở sẵn (sub-filters đã hiển thị).');
        return true;
      }

      let clicked = false;

      // Strategy 1: Find sidebar item with text "Tất cả" or "All"
      const allTabLocators = [
        page.locator('div[role="navigation"], div[aria-label*="Bộ lọc"], div[aria-label*="Filters"], div[data-pagelet*="LeftRail"]').locator('a, div[role="button"], div[role="listitem"], div[role="tab"]').filter({ hasText: /^Tất cả$|^All$/i }),
        page.getByRole('link', { name: /^Tất cả$|^All$/i }),
        page.getByRole('tab', { name: /^Tất cả$|^All$/i }),
        page.getByRole('button', { name: /^Tất cả$|^All$/i }),
        page.locator('div[role="listitem"]').filter({ hasText: /^Tất cả$|^All$/i }),
        page.getByText(/^Tất cả$|^All$/i)
      ];

      for (const loc of allTabLocators) {
        try {
          if (await loc.count() > 0) {
            const first = loc.first();
            if (await first.isVisible()) {
              const box = await first.boundingBox();
              if (box) {
                await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
              } else {
                await first.click({ force: true });
              }
              logger.info('✔ Đã click mục "Tất cả" (Playwright locator)');
              clicked = true;
              break;
            }
          }
        } catch (locErr) {}
      }

      // Strategy 2: DOM evaluate with dispatchEvent + mouse events
      if (!clicked) {
        clicked = await page.evaluate(() => {
          const allEls = Array.from(document.querySelectorAll('a, div[role="button"], div[role="listitem"], div[role="tab"], span, div'));
          for (const el of allEls) {
            const txt = (el.innerText || el.textContent || '').trim();
            if (/^(?:Tất cả|All)$/i.test(txt) || txt.startsWith('Tất cả\n') || txt.startsWith('All\n')) {
              const target = el.closest('a') || el.closest('div[role="button"]') || el.closest('div[role="listitem"]') || el.closest('div[role="tab"]') || el;
              target.scrollIntoView?.({ block: 'center' });
              target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
              target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
              target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
              if (target.click) target.click();
              return true;
            }
          }
          return false;
        }).catch(() => false);

        if (clicked) {
          logger.info('✔ Đã click mục "Tất cả" (DOM dispatchEvent)');
        }
      }

      // Strategy 3: Fallback to "Bài viết" / "Posts" if "Tất cả" was not found
      if (!clicked) {
        logger.info('ℹ️ Không thấy "Tất cả", thử tìm mục "Bài viết"...');
        const postsClicked = await this._applyPostsTab(page);
        if (postsClicked) return true;
      }

      // Wait up to 5s for sub-filters to render
      logger.info('⏳ Đang chờ Facebook mở rộng các tùy chọn bộ lọc con ("Bài viết mới đây", "Ngày đăng")...');
      for (let i = 0; i < 6; i++) {
        await delay(800);
        try {
          const subFilterReady = await page.evaluate(() => {
            const textNodes = Array.from(document.querySelectorAll('span, div, label, p'));
            return textNodes.some(el => /(Bài viết mới đây|Bài viết gần đây|Bài viết mới nhất|Recent posts|Ngày đăng|Date posted)/i.test((el.innerText || el.textContent || '').trim()));
          });
          if (subFilterReady) {
            logger.info('✔ Các mục bộ lọc con đã hiển thị thành công!');
            return true;
          }
        } catch (e) {}
      }

      logger.info('ℹ️ Đã hoàn tất bước chọn "Tất cả".');
      return true;
    } catch (e) {
      logger.warn({ err: e }, 'Không thể click mục Tất cả');
      return false;
    }
  }

  async _applyRecentPostsToggle(page, shouldEnable = true) {
    try {
      logger.info('🔘 Đang tìm và kích hoạt nút gạt "Bài viết mới đây"...');
      await delay(1000);

      // Strategy 1: Check if already matching
      const isAlreadyOn = await page.evaluate(() => {
        const labels = Array.from(document.querySelectorAll('span, div, label, p'));
        for (const label of labels) {
          const txt = (label.innerText || label.textContent || '').trim();
          if (!/(Bài viết mới đây|Bài viết gần đây|Bài viết mới nhất|Recent posts|Gần đây)/i.test(txt)) continue;
          let cur = label;
          for (let i = 0; i < 6 && cur; i++, cur = cur.parentElement) {
            const sw = cur.matches?.('div[role="checkbox"], div[role="switch"], input[type="checkbox"], div[aria-checked]')
              ? cur
              : cur.querySelector?.('div[role="checkbox"], div[role="switch"], input[type="checkbox"], div[aria-checked]');
            if (sw) return sw.getAttribute('aria-checked') === 'true' || sw.checked === true;
          }
        }
        return null;
      }).catch(() => null);

      if (isAlreadyOn === shouldEnable) {
        logger.info(`✔ Nút gạt "Bài viết mới đây" đã ở trạng thái ${shouldEnable}.`);
        return true;
      }

      // Strategy 2: Click via Playwright locator on the row / switch
      const toggleRow = page.locator('div, label').filter({ hasText: /(Bài viết mới đây|Bài viết gần đây|Bài viết mới nhất|Recent posts)/i }).first();
      let clicked = false;
      if (await toggleRow.count() > 0 && await toggleRow.isVisible()) {
        const switchLoc = toggleRow.locator('div[role="checkbox"], div[role="switch"], input[type="checkbox"]').first();
        const targetToClick = (await switchLoc.count() > 0 && await switchLoc.isVisible()) ? switchLoc : toggleRow;
        const box = await targetToClick.boundingBox();
        if (box) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        } else {
          await targetToClick.click({ force: true });
        }
        logger.info('✔ Đã click nút gạt "Bài viết mới đây" (Playwright locator)');
        clicked = true;
        await delay(1500);
      }

      // Strategy 3: DOM evaluate click + dispatchEvent
      if (!clicked) {
        clicked = await page.evaluate((targetState) => {
          const candidateLabels = Array.from(document.querySelectorAll('span, div, label, p'));
          for (const label of candidateLabels) {
            const txt = (label.innerText || label.textContent || '').trim();
            if (/(Bài viết mới đây|Bài viết gần đây|Bài viết mới nhất|Recent posts|Gần đây)/i.test(txt)) {
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
              clickTarget.scrollIntoView?.({ block: 'center' });
              clickTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
              clickTarget.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
              clickTarget.click();
              return true;
            }
          }
          return false;
        }, shouldEnable).catch(() => false);

        if (clicked) {
          logger.info('✔ Đã click nút gạt "Bài viết mới đây" (DOM dispatchEvent)');
          await delay(1500);
        }
      }

      return true;
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

      // 1. Check if year is ALREADY selected
      const alreadySelected = await page.evaluate((targetYear) => {
        const textNodes = Array.from(document.querySelectorAll('span, div, label, [role="button"], [role="radio"]'));
        return textNodes.some(el => {
          const txt = (el.innerText || el.textContent || '').trim();
          return (txt === targetYear || txt === `Năm ${targetYear}` || txt.includes(`${targetYear}`)) &&
                 (el.closest('[aria-checked="true"]') || el.classList.toString().includes('selected') || el.querySelector('i, svg'));
        });
      }, String(yearStr)).catch(() => false);

      if (alreadySelected) {
        logger.info(`✔ Bộ lọc Năm ${yearStr} đã được chọn từ trước.`);
        return true;
      }

      // 2. Check if year options are already open/visible
      const yearRegex = new RegExp(`^(?:Năm\\s*)?${yearStr}$`, 'i');
      let yearOption = page.locator('div[role="radio"], div[role="button"], div[role="menuitemradio"], span, label')
        .filter({ hasText: yearRegex })
        .first();

      let isYearVisible = false;
      try {
        isYearVisible = (await yearOption.count() > 0) && (await yearOption.isVisible());
      } catch (e) {}

      // If not yet visible, click "Ngày đăng" / "Date posted" to expand
      if (!isYearVisible) {
        logger.info(`🔍 Đang click mở mục "Ngày đăng"...`);
        const dateHeaderLocators = [
          page.locator('div[role="button"], div[aria-expanded], span, label').filter({ hasText: /^(?:Ngày đăng|Date posted)$/i }),
          page.getByRole('button', { name: /Ngày đăng|Date posted/i }),
          page.getByText(/^(?:Ngày đăng|Date posted)$/i)
        ];

        let opened = false;
        for (const loc of dateHeaderLocators) {
          try {
            if (await loc.count() > 0 && await loc.first().isVisible()) {
              const box = await loc.first().boundingBox();
              if (box) {
                await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
              } else {
                await loc.first().click({ force: true });
              }
              opened = true;
              logger.info('✔ Đã click mở danh sách Ngày đăng (Playwright locator)');
              break;
            }
          } catch (e) {}
        }

        if (!opened) {
          opened = await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('span, div[role="button"], div[aria-expanded], label'));
            for (const el of elements) {
              const txt = (el.innerText || el.textContent || '').trim();
              if (/^(Ngày đăng|Date posted)$/i.test(txt) || txt.startsWith('Ngày đăng\n') || txt.startsWith('Date posted\n')) {
                const btn = el.closest('div[role="button"]') || el.closest('div[aria-expanded]') || el;
                btn.scrollIntoView?.({ block: 'center' });
                btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                btn.click();
                return true;
              }
            }
            return false;
          }).catch(() => false);

          if (opened) {
            logger.info('✔ Đã click mở danh sách Ngày đăng (DOM dispatchEvent)');
          }
        }

        logger.info('⏳ Chờ 1.5s để menu Ngày đăng mở...');
        await delay(1500);
      }

      // 3. Click the target Year (e.g. "2026" / "Năm 2026")
      yearOption = page.locator('div[role="radio"], div[role="button"], div[role="menuitemradio"], span, label')
        .filter({ hasText: yearRegex })
        .first();

      let selected = false;
      try {
        if (await yearOption.count() > 0 && await yearOption.isVisible()) {
          const box = await yearOption.boundingBox();
          if (box) {
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          } else {
            await yearOption.click({ force: true });
          }
          selected = true;
          logger.info(`✔ Đã click chọn Năm ${yearStr} (Playwright locator)`);
        }
      } catch (e) {}

      if (!selected) {
        selected = await page.evaluate((targetYear) => {
          const candidates = Array.from(document.querySelectorAll('span, div[role="radio"], div[role="button"], div[role="menuitemradio"], label'));
          for (const el of candidates) {
            const txt = (el.innerText || el.textContent || '').trim();
            if (txt === targetYear || txt === `Năm ${targetYear}` || txt === `Year ${targetYear}`) {
              const clickTarget = el.closest('div[role="radio"]') || el.closest('div[role="button"]') || el.closest('label') || el;
              clickTarget.scrollIntoView?.({ block: 'center' });
              clickTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
              clickTarget.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
              clickTarget.click();
              return true;
            }
          }
          return false;
        }, String(yearStr)).catch(() => false);

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
