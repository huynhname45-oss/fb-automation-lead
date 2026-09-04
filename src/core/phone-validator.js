/**
 * Valid Vietnamese Telco Mobile Prefixes (10 Digits Total)
 * Viettel: 086, 096, 097, 098, 032, 033, 034, 035, 036, 037, 038, 039
 * Mobifone: 089, 090, 093, 070, 079, 077, 076, 078
 * Vinaphone: 088, 091, 094, 083, 084, 085, 081, 082
 * Vietnamobile: 092, 056, 058, 052
 * Gmobile: 099, 059
 * Itelecom/Wintel: 087, 055
 * Landline: 02x (11 Digits Total)
 */
export const VALID_VN_PREFIXES = new Set([
  // Viettel
  '086', '096', '097', '098', '032', '033', '034', '035', '036', '037', '038', '039',
  // Mobifone
  '089', '090', '093', '070', '079', '077', '076', '078',
  // Vinaphone
  '088', '091', '094', '083', '084', '085', '081', '082',
  // Vietnamobile & others
  '092', '056', '058', '052', '099', '059', '087', '055'
]);

export function isValidVietnamesePhone(digits) {
  if (!digits || typeof digits !== 'string') return false;
  
  // Mobile: 10 digits
  if (digits.length === 10) {
    const prefix3 = digits.substring(0, 3);
    if (!VALID_VN_PREFIXES.has(prefix3)) return false;
    
    // Check not all same digits (e.g. 0900000000)
    const suffix = digits.substring(3);
    if (/^(\d)\1+$/.test(suffix)) return false;
    if (digits === '0123456789' || digits === '0987654321') return false;
    
    return true;
  }

  // Landline: 11 digits starting with 02
  if (digits.length === 11 && digits.startsWith('02')) {
    const suffix = digits.substring(2);
    if (/^(\d)\1+$/.test(suffix)) return false;
    return true;
  }

  return false;
}

/**
 * Classifies phone number into 'mobile' | 'landline' | 'hotline' | 'invalid'
 * @param {string} phone
 * @returns {'mobile' | 'landline' | 'hotline' | 'invalid'}
 */
export function classifyPhoneType(phone = '') {
  if (!phone || typeof phone !== 'string') return 'invalid';
  let digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('+84')) digits = '0' + digits.substring(3);
  else if (digits.startsWith('84') && (digits.length === 11 || digits.length === 12)) digits = '0' + digits.substring(2);
  else if (digits.startsWith('0084')) digits = '0' + digits.substring(4);

  // 1. Hotline / Toll-Free: 1800 / 1900 (usually 8 to 10 digits)
  if (/^(?:1800|1900)\d{4,6}$/.test(digits)) {
    return 'hotline';
  }

  // 2. Personal Mobile: 10 digits starting with 03, 05, 07, 08, 09
  if (digits.length === 10) {
    const prefix3 = digits.substring(0, 3);
    if (VALID_VN_PREFIXES.has(prefix3)) {
      const suffix = digits.substring(3);
      if (!/^(\d)\1+$/.test(suffix) && digits !== '0123456789' && digits !== '0987654321') {
        return 'mobile';
      }
    }
  }

  // 3. Landline: 11 digits starting with 02x
  if (digits.length === 11 && digits.startsWith('02')) {
    const suffix = digits.substring(2);
    if (!/^(\d)\1+$/.test(suffix)) {
      return 'landline';
    }
  }

  return 'invalid';
}

/**
 * Checks if a phone number matches any of the allowed types (default: ['mobile', 'landline'])
 */
export function isAllowedPhoneType(phone = '', allowedTypes = ['mobile', 'landline']) {
  const type = classifyPhoneType(phone);
  return allowedTypes.includes(type);
}

export function normalizePhoneNumber(phone = '') {
  if (!phone || typeof phone !== 'string') return '';
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0084')) digits = '0' + digits.substring(4);
  else if (digits.startsWith('84') && (digits.length === 11 || digits.length === 12)) {
    digits = '0' + digits.substring(2);
  }
  if (digits.startsWith('00') && digits.length === 11) digits = digits.substring(1);
  return digits;
}

function toE164(phone = '') {
  const normalized = normalizePhoneNumber(phone);
  return normalized.startsWith('0') ? '+84' + normalized.substring(1) : '';
}

function normalizeEvidenceItem(item = {}) {
  return {
    source: item.source || 'unknown',
    sourceUrl: item.sourceUrl || '',
    rawSnippet: item.rawSnippet ? String(item.rawSnippet).substring(0, 220) : '',
    confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0)),
    authorMatched: item.authorMatched === true,
    sourceAuthorKey: item.sourceAuthorKey || '',
    targetAuthorKey: item.targetAuthorKey || '',
    capturedAt: item.capturedAt || new Date().toISOString()
  };
}

/**
 * Creates a structured phone aggregate. A valid mobile number is not automatically
 * verified: ownership needs a trusted source, an author match and enough confidence.
 */
export function createPhoneEvidence({
  phone = '',
  rawSnippet = '',
  source = 'unknown',
  sourceUrl = '',
  confidence = 0,
  verified = false,
  authorMatched = false,
  sourceAuthorKey = '',
  targetAuthorKey = '',
  minConfidence = 0.8
} = {}) {
  const normalized = normalizePhoneNumber(phone);
  const type = classifyPhoneType(normalized);
  const boundedConfidence = Math.max(0, Math.min(1, Number(confidence) || 0));
  const evidenceItem = normalizeEvidenceItem({
    source,
    sourceUrl,
    rawSnippet,
    confidence: boundedConfidence,
    authorMatched,
    sourceAuthorKey,
    targetAuthorKey
  });
  const isContactType = type === 'mobile' || type === 'landline';
  const ownershipVerified = verified === true &&
    authorMatched === true &&
    boundedConfidence >= minConfidence &&
    isContactType;

  return {
    phone: normalized,
    normalized,
    e164: toE164(normalized),
    type,
    source,
    sources: [source],
    sourceUrl,
    rawSnippet: evidenceItem.rawSnippet,
    confidence: boundedConfidence,
    authorMatched: authorMatched === true,
    verified: ownershipVerified,
    evidence: [evidenceItem]
  };
}

/**
 * Merge discoveries by canonical phone while preserving every independent source.
 * Cross-source confirmation can verify a number only when all contributing evidence
 * is tied to the target author.
 */
export function mergePhoneEvidence(
  existingEvidence = [],
  newPhones = [],
  source = 'unknown',
  confidence = 0,
  rawSnippet = '',
  metadata = {}
) {
  const evidenceMap = new Map();

  for (const item of (Array.isArray(existingEvidence) ? existingEvidence : [])) {
    if (!item?.phone) continue;
    const normalized = normalizePhoneNumber(item.phone);
    if (!normalized) continue;
    evidenceMap.set(normalized, {
      ...item,
      phone: normalized,
      normalized,
      sources: Array.from(new Set(item.sources || [item.source].filter(Boolean))),
      evidence: Array.isArray(item.evidence) ? [...item.evidence] : [
        normalizeEvidenceItem(item)
      ]
    });
  }

  for (const candidate of (Array.isArray(newPhones) ? newPhones : [newPhones])) {
    if (!candidate) continue;
    const candidateObject = typeof candidate === 'object' ? candidate : {};
    const phoneStr = typeof candidate === 'string' ? candidate : candidate.phone;
    const normalized = normalizePhoneNumber(phoneStr || '');
    if (!normalized || classifyPhoneType(normalized) === 'invalid') continue;

    const next = createPhoneEvidence({
      phone: normalized,
      rawSnippet: candidateObject.rawSnippet ?? rawSnippet,
      source: candidateObject.source ?? source,
      sourceUrl: candidateObject.sourceUrl ?? metadata.sourceUrl ?? '',
      confidence: typeof candidateObject.confidence === 'number'
        ? candidateObject.confidence
        : confidence,
      verified: typeof candidateObject.verified === 'boolean'
        ? candidateObject.verified
        : metadata.verified === true,
      authorMatched: typeof candidateObject.authorMatched === 'boolean'
        ? candidateObject.authorMatched
        : metadata.authorMatched === true,
      sourceAuthorKey: candidateObject.sourceAuthorKey ?? metadata.sourceAuthorKey ?? '',
      targetAuthorKey: candidateObject.targetAuthorKey ?? metadata.targetAuthorKey ?? '',
      minConfidence: metadata.minConfidence ?? 0.8
    });

    const current = evidenceMap.get(normalized);
    if (!current) {
      evidenceMap.set(normalized, next);
      continue;
    }

    const allEvidence = [...(current.evidence || []), ...(next.evidence || [])];
    const dedupedEvidence = allEvidence.filter((item, index, list) =>
      list.findIndex(other =>
        other.source === item.source &&
        other.sourceUrl === item.sourceUrl &&
        other.rawSnippet === item.rawSnippet
      ) === index
    );
    const sources = Array.from(new Set(dedupedEvidence.map(item => item.source)));
    const authorBoundEvidence = dedupedEvidence.filter(item => item.authorMatched);
    const independentlyConfirmed = new Set(
      authorBoundEvidence.map(item => item.source)
    ).size >= 2;
    const bestEvidence = dedupedEvidence.reduce((best, item) =>
      item.confidence > (best?.confidence ?? -1) ? item : best, null
    );
    const type = classifyPhoneType(normalized);
    const verified = current.verified === true ||
      next.verified === true ||
      (independentlyConfirmed &&
        (type === 'mobile' || type === 'landline') &&
        authorBoundEvidence.some(item => item.confidence >= 0.75));

    evidenceMap.set(normalized, {
      phone: normalized,
      normalized,
      e164: toE164(normalized),
      type,
      source: bestEvidence?.source || current.source || next.source,
      sources,
      sourceUrl: bestEvidence?.sourceUrl || '',
      rawSnippet: bestEvidence?.rawSnippet || '',
      confidence: Math.max(current.confidence || 0, next.confidence || 0),
      authorMatched: authorBoundEvidence.length > 0,
      verified,
      evidence: dedupedEvidence
    });
  }

  return Array.from(evidenceMap.values());
}

/**
 * Combines already-structured aggregates without flattening away their source
 * evidence. This is used when several posts from the same author are grouped.
 */
export function mergePhoneEvidenceCollections(...collections) {
  let merged = [];

  for (const collection of collections) {
    for (const aggregate of (Array.isArray(collection) ? collection : [])) {
      if (!aggregate?.phone) continue;
      const evidenceItems = Array.isArray(aggregate.evidence) && aggregate.evidence.length > 0
        ? aggregate.evidence
        : [aggregate];

      for (const evidence of evidenceItems) {
        merged = mergePhoneEvidence(
          merged,
          [{
            phone: aggregate.phone,
            rawSnippet: evidence.rawSnippet || aggregate.rawSnippet || '',
            source: evidence.source || aggregate.source || 'unknown',
            sourceUrl: evidence.sourceUrl || aggregate.sourceUrl || '',
            confidence: typeof evidence.confidence === 'number'
              ? evidence.confidence
              : aggregate.confidence,
            verified: aggregate.verified === true,
            authorMatched: evidence.authorMatched === true || aggregate.authorMatched === true,
            sourceAuthorKey: evidence.sourceAuthorKey || '',
            targetAuthorKey: evidence.targetAuthorKey || ''
          }],
          evidence.source || aggregate.source || 'unknown',
          evidence.confidence || aggregate.confidence || 0,
          evidence.rawSnippet || aggregate.rawSnippet || '',
          { minConfidence: 0.8 }
        );
      }
    }
  }

  return merged;
}

/**
 * Removes zero-width, invisible, and combining characters injected by DOM obfuscation
 */
export function cleanInvisibleCharacters(text = '') {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/[\u200B-\u200D\uFEFF\u034F\u0847\u202A-\u202E\u00AD\u17B4\u17B5\u200E\u200F\u2060-\u206F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks if text is random OCR/DOM noise (e.g. high density of single-character words)
 */
export function isGibberishOrNoise(text = '') {
  if (!text) return true;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length >= 6) {
    const singleCharWords = words.filter(w => w.length === 1);
    if (singleCharWords.length / words.length > 0.35) {
      return true;
    }
  }
  return false;
}

/**
 * Robust Vietnamese Phone Extractor
 * Strictly filters out false positives from dates, prices, dimensions, and OCR noise.
 */
export function extractPhonesFromText(text = '', options = { isOCR: false }) {
  if (!text || typeof text !== 'string') return [];

  // Step 0: Clean invisible/zero-width chars
  let clean = cleanInvisibleCharacters(text);

  // Step 1: Remove URLs, emails, and Facebook internal tracking tokens
  clean = clean
    .replace(/https?:\/\/[^\s]+/gi, ' ')
    .replace(/www\.[^\s]+/gi, ' ')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi, ' ')
    .replace(/pfbid[a-zA-Z0-9_-]+/gi, ' ')
    .replace(/fbid=\d+/gi, ' ')
    .replace(/story_fbid=\d+/gi, ' ')
    .replace(/comment_id=\d+/gi, ' ')
    .replace(/set=[a-zA-Z0-9._-]+/gi, ' ');

  // Step 2: Normalize letter O/o/l/I replaced for digits
  clean = clean
    .replace(/([oO])(?=[\s.\-\/\(\):]*\d)/g, '0')
    .replace(/(\d[\s.\-\/\(\):]*)[oO]/g, '$10')
    .replace(/0([lI])(?=\d{8})/g, '01');

  // Step 3: Remove REAL calendar dates and timestamps (Day: 1-31, Month: 1-12)
  // Protected with negative lookaround to prevent cutting phone numbers (e.g. 0909.04.04.50, 0988.12.34.56)
  clean = clean
    .replace(/(?<![\d.\-\/])(?:0?[1-9]|[12]\d|3[01])[\/\-.](?:0?[1-9]|1[012])[\/\-.](?:19\d\d|20\d\d)(?![\d.\-\/])/g, ' ')
    .replace(/(?<![\d.\-\/])(?:0?[1-9]|[12]\d|3[01])\/(?:0?[1-9]|1[012])\/\d{2}(?![\d.\-\/])/g, ' ')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ')
    .replace(/\b\d{1,2}h\d{0,2}\b/gi, ' ')
    .replace(/\b\d+m\s*[xX*]\s*\d+m\b/g, ' ')
    .replace(/\b\d{1,3}(?:[.,]\d{3})+\s*(?:k|đ|vnđ|vnd|triệu|tr)\b/gi, ' ');

  const results = new Set();

  function addCleanPhone(raw) {
    if (!raw) return;
    let digits = raw.replace(/[^\d+]/g, '');
    if (digits.startsWith('+84')) digits = '0' + digits.substring(3);
    else if (digits.startsWith('84') && (digits.length === 11 || digits.length === 12)) digits = '0' + digits.substring(2);
    else if (digits.startsWith('0084')) digits = '0' + digits.substring(4);

    if (digits.startsWith('00') && digits.length === 11) digits = digits.substring(1);

    if (isValidVietnamesePhone(digits)) {
      results.add(digits);
    }
  }

  // Tier 3: Formatted Vietnamese Numbers (dots, dashes, spaces, parentheses)
  const generalPattern = /(?<![\w\d])(?:\+?84[\s.\-\(\)]*|0)[235789](?:[\s.\-\(\)]*\d){8,9}(?![\w\d])/gi;

  // Tier 1: Explicit labels (Hotline, Zalo, SĐT, LH, Call, Tel, Liên hệ, ĐT, CSKH, Tư vấn, Alo, Inbox, Đặt bàn, Ship, Gặp, Gọi...)
  const labelPattern = /(?:hotline|lh|sđt|sdt|đt|dt|zalo|tel|call|liên\s*hệ|phone|dđ|cskh|tư\s*vấn|alo|ib|inbox|liên\s*lạc|đặt\s*bàn|booking|ship|gọi|gặp|order)[\s:\.\-]*([^\n,;]{8,70})/gi;
  let lm;
  while ((lm = labelPattern.exec(clean)) !== null) {
    if (lm[1]) {
      const pMatches = lm[1].match(generalPattern) || [];
      for (const m of pMatches) {
        addCleanPhone(m);
      }
      const candidates = lm[1].split(/[,;&|\s]+/);
      for (const cand of candidates) {
        addCleanPhone(cand);
      }
    }
  }

  // Tier 2: Spaced out digits (e.g. 0 9 8 8 7 7 6 6 5 5 or 0 9 8 8 . 7 7 6 . 6 5 5)
  const spacedOutPattern = /(?<!\d)(?:0|\+?84)(?:[\s.\-]+[235789])(?:[\s.\-]+\d){8}(?!\d)/gi;
  const spacedMatches = clean.match(spacedOutPattern) || [];
  for (let match of spacedMatches) {
    addCleanPhone(match);
  }

  // Tier 3: Formatted Vietnamese Numbers (dots, dashes, spaces, parentheses)
  const generalMatches = clean.match(generalPattern) || [];
  for (let match of generalMatches) {
    addCleanPhone(match);
  }

  // Tier 4: Continuous digits (Standalone)
  if (!options.isOCR || !isGibberishOrNoise(clean)) {
    const standalonePattern = /(?<![\w\d])(?:\+?84|0)[235789]\d{8}(?![\w\d])/gi;
    const standaloneMatches = clean.match(standalonePattern) || [];
    for (let match of standaloneMatches) {
      addCleanPhone(match);
    }
  }

  return Array.from(results).slice(0, 4);
}
