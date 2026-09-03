import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { classifyPhoneType } from './phone-validator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'config', 'excluded-entities.json');

let excludedEntities = {
  enterpriseChains: [],
  posCompetitors: [],
  unsupportedIndustries: [],
  spamKeywords: []
};

try {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  excludedEntities = JSON.parse(raw);
} catch (e) {
  // Fallback defaults
}

/**
 * Strips Vietnamese diacritics / accents
 */
function removeAccents(str = '') {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd');
}

/**
 * Boundary-safe text cleaner for accurate keyword matching (strips all emojis, punctuation, symbols)
 */
function cleanTextForMatching(text = '') {
  if (!text || typeof text !== 'string') return '';
  // Replace anything that is not a letter, digit or whitespace with a space
  return ` ${text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()} `;
}

/**
 * Checks if text contains any of the keywords using whole-phrase inclusion (both accented and unaccented)
 */
function findMatchedKeyword(textClean, keywords = []) {
  if (!textClean || !Array.isArray(keywords)) return null;
  const textNoAccent = cleanTextForMatching(removeAccents(textClean));

  for (const kw of keywords) {
    const kwClean = ` ${kw.toLowerCase().trim()} `;
    const kwNoAccent = ` ${removeAccents(kw.toLowerCase().trim())} `;

    if (textClean.includes(kwClean) || textNoAccent.includes(kwNoAccent)) {
      return kw;
    }
  }
  return null;
}

/**
 * Valid Vietnamese Personal Mobile Number Check (10 digits starting with 03, 05, 07, 08, 09)
 */
export function isPersonalMobilePhone(phone = '') {
  if (!phone || typeof phone !== 'string') return false;
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.length === 10) {
    return /^(?:03|05|07|08|09)\d{8}$/.test(digits);
  }
  if (digits.length === 11 && digits.startsWith('84')) {
    return /^84(?:3|5|7|8|9)\d{8}$/.test(digits);
  }
  return false;
}

/**
 * Checks if the extracted phone numbers consist ONLY of 1800/1900 hotline numbers with NO personal mobile numbers.
 */
export function hasOnlyTollFreeNumbers(phones = []) {
  if (!Array.isArray(phones) || phones.length === 0) return false;

  let hasMobile = false;
  let hasTollFree = false;

  for (const p of phones) {
    const digits = p.replace(/[^\d]/g, '');
    if (digits.startsWith('1800') || digits.startsWith('1900')) {
      hasTollFree = true;
    } else if (isPersonalMobilePhone(p)) {
      hasMobile = true;
    }
  }

  // If it has a toll-free number AND lacks any personal mobile phone, consider it enterprise hotline
  return hasTollFree && !hasMobile;
}

export class LeadFilter {
  constructor(customEntities = null) {
    this.customEntities = customEntities;
  }

  getEntities() {
    if (this.customEntities) return this.customEntities;
    try {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      return JSON.parse(raw);
    } catch (e) {
      return excludedEntities;
    }
  }

  /**
   * Evaluates whether a post represents a qualified SMB lead for POS/SaaS sales.
   * @param {Object} post - Candidate post with { authorName, content, phones, location }
   * @param {Object} config - System settings with toggle flags
   * @returns {Object} { qualified: boolean, reason: string, matchedTerm: string }
   */
  evaluateLead(post = {}, config = {}) {
    const authorClean = cleanTextForMatching(post.authorName || '');
    const contentClean = cleanTextForMatching(post.content || '');
    const combinedText = `${authorClean} ${contentClean}`;
    const entities = this.getEntities();

    const excludeEnterprise = config.excludeEnterpriseChains !== false;
    const excludeCompetitors = config.excludePosCompetitors !== false;
    const excludeUnsupported = config.excludeUnsupportedIndustries !== false;
    const requireMobileOnly = config.requireMobilePhoneOnly !== false;

    // 1. Enterprise / Large Chain Check (Highest Priority)
    if (excludeEnterprise) {
      const matchedChain = findMatchedKeyword(combinedText, entities.enterpriseChains);
      if (matchedChain) {
        return {
          qualified: false,
          category: 'enterprise_chain',
          matchedTerm: matchedChain,
          reason: `Chuỗi lớn / Doanh nghiệp quy mô lớn: "${matchedChain}"`
        };
      }
    }

    // 2. POS Software Competitor & Sale Seeding Check
    if (excludeCompetitors) {
      const matchedCompetitor = findMatchedKeyword(combinedText, entities.posCompetitors);
      if (matchedCompetitor) {
        return {
          qualified: false,
          category: 'pos_competitor',
          matchedTerm: matchedCompetitor,
          reason: `Đối thủ phần mềm POS / Bài bán hàng đối thủ: "${matchedCompetitor}"`
        };
      }
    }

    // 3. Unsupported Industry Check (Hotel, Resort, Real Estate, Hospitals...)
    if (excludeUnsupported) {
      const matchedIndustry = findMatchedKeyword(combinedText, entities.unsupportedIndustries);
      if (matchedIndustry) {
        return {
          qualified: false,
          category: 'unsupported_industry',
          matchedTerm: matchedIndustry,
          reason: `Ngành hàng không phù hợp với POS SMB: "${matchedIndustry}"`
        };
      }
    }

    // 4. Spam / Scam / MLM / Online Jobs Check
    const matchedSpam = findMatchedKeyword(combinedText, entities.spamKeywords);
    if (matchedSpam) {
      return {
        qualified: false,
        category: 'spam_job',
        matchedTerm: matchedSpam,
        reason: `Bài tuyển dụng đa cấp / việc làm online: "${matchedSpam}"`
      };
    }

    // 5. Phone Type / Mobile-Only Check (If post has extracted phones and requireMobileOnly is true)
    if (requireMobileOnly && Array.isArray(post.phones) && post.phones.length > 0) {
      const hasAnyMobile = post.phones.some(p => classifyPhoneType(p) === 'mobile');
      if (!hasAnyMobile) {
        return {
          qualified: false,
          category: 'non_mobile_phone',
          matchedTerm: post.phones.join(', '),
          reason: `Danh sách SĐT không có số di động cá nhân (chỉ có số cố định/tổng đài): [${post.phones.join(', ')}]`
        };
      }
    }
    return {
      qualified: true,
      category: 'qualified_smb_lead',
      matchedTerm: '',
      reason: 'Khách hàng mục tiêu hợp lệ (Hộ kinh doanh / Quán độc lập SMB)'
    };
  }

  hasOnlyTollFreeNumbers(phones = []) {
    return hasOnlyTollFreeNumbers(phones);
  }

  isPersonalMobilePhone(phone = '') {
    return isPersonalMobilePhone(phone);
  }

  classifyPhoneType(phone = '') {
    return classifyPhoneType(phone);
  }
}

const leadFilter = new LeadFilter();
export default leadFilter;
