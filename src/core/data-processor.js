import { z } from 'zod';
import stringSimilarity from 'string-similarity';
import dayjs from 'dayjs';
import { extractLocationDetailed } from './location-extractor.js';

const postSchema = z.object({
  key: z.string().optional(),
  id: z.string().optional(),
  authorName: z.string().min(1),
  location: z.string().default('—'),
  content: z.string(),
  postedTime: z.string(),
  postLink: z.string(),
  profileLink: z.string(),
  phones: z.array(z.string()).default([]),
  verifiedPhones: z.array(z.string()).default([]),
  phoneEvidence: z.array(z.any()).default([]),
  decision: z.enum(['ACCEPTED', 'REVIEW', 'REJECTED']).default('ACCEPTED'),
  decisionReasons: z.array(z.string()).default([]),
  authorKey: z.string().optional(),
  locationSource: z.string().optional(),
  locationConfidence: z.number().min(0).max(1).optional(),
  locationEvidence: z.array(z.any()).default([]),
  timeStatus: z.string().optional(),
  timeConfidence: z.number().min(0).max(1).optional(),
  supportingPosts: z.array(z.any()).default([]),
  summary: z.string().default(''),
  aiScore: z.number().optional(),
  businessType: z.string().optional(),
  intent: z.string().optional(),
  salesPitch: z.string().optional(),
  recommendedFeatures: z.string().optional(),
  aiReason: z.string().optional(),
  groupName: z.string().optional(),
  groupLink: z.string().optional(),
  status: z.string().default('Mới tạo')
});

import { cleanInvisibleCharacters } from './phone-validator.js';

export function cleanText(text) {
  if (!text) return '';
  return cleanInvisibleCharacters(text)
    .replace(/Back to Previous Page/gi, '')
    .replace(/Exit typeahead/gi, '')
    .replace(/Facebook Account controls and settings/gi, '')
    .replace(/Search Facebook/gi, '')
    .replace(/Notifications/gi, '')
    .replace(/Messenger/gi, '')
    .replace(/Menu/gi, '')
    .replace(/Meta © \d+/gi, '')
    .replace(/Privacy\s*·\s*Terms\s*·\s*Advertising\s*·\s*Ad Choices/gi, '')
    .replace(/(?:^|\s)(?:Facebook\s*){2,}/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generates a trimmed excerpt of the text for preview (NOT an AI-generated summary)
 */
export function generateExcerpt(content = '', maxLength = 130) {
  if (!content) return '';
  const clean = cleanText(content);
  if (clean.length <= maxLength) return clean;
  return clean.substring(0, maxLength).trim() + '...';
}

/**
 * Generates a clean 1-2 sentence post content summary (excerpt)
 */
export function generateSummary(content = '') {
  return generateExcerpt(content, 130);
}

/**
 * Fast post content summary (Deprecated alias for generateExcerpt)
 */
export async function aiSummarize(text = '') {
  return generateExcerpt(text, 130);
}

export function normalizeTime(fbTimeString) {
  if (!fbTimeString) return null;
  
  const now = dayjs();
  const lower = fbTimeString.toLowerCase();

  const minMatch = lower.match(/(\d+)\s*phút/);
  if (minMatch) return now.subtract(parseInt(minMatch[1]), 'minute').toISOString();

  const hourMatch = lower.match(/(\d+)\s*giờ/);
  if (hourMatch) return now.subtract(parseInt(hourMatch[1]), 'hour').toISOString();

  const dayMatch = lower.match(/(\d+)\s*ngày/);
  if (dayMatch) return now.subtract(parseInt(dayMatch[1]), 'day').toISOString();

  if (lower.includes('hôm qua')) {
    return now.subtract(1, 'day').toISOString();
  }

  return fbTimeString;
}

export function deduplicatePosts(posts, threshold = 0.85) {
  if (!posts || posts.length <= 1) return posts;

  const unique = [];

  for (const post of posts) {
    let isDuplicate = false;
    for (const existing of unique) {
      if (post.authorName.toLowerCase() === existing.authorName.toLowerCase()) {
        const similarity = stringSimilarity.compareTwoStrings(
          post.content.substring(0, 100),
          existing.content.substring(0, 100)
        );
        if (similarity >= threshold) {
          isDuplicate = true;
          break;
        }
      }
    }
    if (!isDuplicate) {
      unique.push(post);
    }
  }

  return unique;
}

export function validatePost(postData) {
  return postSchema.parse(postData);
}

export function processResults(rawPosts) {
  if (!Array.isArray(rawPosts)) return [];

  const processed = [];

  for (const post of rawPosts) {
    try {
      const cleanedContent = cleanText(post.content);
      const fallbackLocation = extractLocationDetailed({ content: cleanedContent, authorName: post.authorName });
      const trustedFallbackLocation = fallbackLocation.confidence >= 0.75 && !fallbackLocation.conflict
        ? fallbackLocation.province
        : '—';
      const suppliedLocationIsTrusted = post.location && post.location !== '—' &&
        (typeof post.locationConfidence !== 'number' || post.locationConfidence >= 0.75);
      const cleaned = {
        key: post.key || post.id || undefined,
        id: post.id || post.key || undefined,
        authorName: cleanText(post.authorName),
        location: suppliedLocationIsTrusted ? post.location : trustedFallbackLocation,
        content: cleanedContent,
        postedTime: cleanText(post.postedTime),
        postLink: post.postLink || '',
        profileLink: post.profileLink || '',
        phones: Array.isArray(post.phones) ? post.phones.slice(0, 4) : [],
        verifiedPhones: Array.isArray(post.verifiedPhones) ? post.verifiedPhones.slice(0, 4) : [],
        phoneEvidence: Array.isArray(post.phoneEvidence) ? post.phoneEvidence : [],
        decision: ['ACCEPTED', 'REVIEW', 'REJECTED'].includes(post.decision)
          ? post.decision
          : 'ACCEPTED',
        decisionReasons: Array.isArray(post.decisionReasons) ? post.decisionReasons : [],
        authorKey: post.authorKey || undefined,
        locationSource: post.locationSource || (trustedFallbackLocation !== '—' ? fallbackLocation.source : undefined),
        locationConfidence: typeof post.locationConfidence === 'number'
          ? post.locationConfidence
          : (trustedFallbackLocation !== '—' ? fallbackLocation.confidence : undefined),
        locationEvidence: Array.isArray(post.locationEvidence) && post.locationEvidence.length > 0
          ? post.locationEvidence
          : fallbackLocation.evidence,
        timeStatus: post.timeStatus || undefined,
        timeConfidence: typeof post.timeConfidence === 'number'
          ? post.timeConfidence
          : undefined,
        supportingPosts: Array.isArray(post.supportingPosts) ? post.supportingPosts : [],
        summary: post.summary || generateSummary(cleanedContent),
        aiScore: typeof post.aiScore === 'number' ? post.aiScore : undefined,
        businessType: post.businessType || undefined,
        intent: post.intent || undefined,
        salesPitch: post.salesPitch || undefined,
        recommendedFeatures: post.recommendedFeatures || undefined,
        aiReason: post.aiReason || undefined,
        groupName: post.groupName || undefined,
        groupLink: post.groupLink || undefined,
        status: post.status || 'Mới tạo'
      };
      
      const validated = validatePost(cleaned);
      processed.push(validated);
    } catch (err) {
      // Skip invalid posts
    }
  }

  return deduplicatePosts(processed);
}
