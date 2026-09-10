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
  return String(str || '')
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd');
}

/**
 * Boundary-safe text cleaner for accurate keyword matching (strips all emojis, punctuation, symbols)
 * Normalizes Unicode Mathematical Alphanumeric Symbols (e.g. bold, italic font styles) via NFKC
 */
function cleanTextForMatching(text = '') {
  if (!text || typeof text !== 'string') return '';
  const normalized = text.normalize('NFKC');
  // Replace anything that is not a letter, digit or whitespace with a space
  return ` ${normalized.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()} `;
}

export const VIETNAMESE_DIACRITICS_REGEX = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

export const ACCENT_SENSITIVE_KEYWORDS = new Set([
  'khai trường',
  'mùa khai trường',
  'đơn khai trường',
  'ngày hội khai trường',
  'con cưng',
  'concung',
  'căn hộ',
  'can ho',
  'lên giỏ',
  'len gio',
  'vá vỏ',
  'va vo',
  'vá xe',
  'va xe',
  'tắm bé',
  'tam be',
  'an cư',
  'an cu',
  'an sinh',
  'tiệc cưới',
  'cầm đồ',
  'cam do',
  'sinh thường'
]);

/**
 * Checks if text contains any of the keywords using whole-phrase inclusion (both accented and unaccented)
 */
function findMatchedKeyword(textClean, keywords = []) {
  if (!textClean || !Array.isArray(keywords)) return null;
  const isAccented = VIETNAMESE_DIACRITICS_REGEX.test(textClean);
  const textNoAccent = cleanTextForMatching(removeAccents(textClean));

  for (const kw of keywords) {
    const kwTrim = kw.toLowerCase().trim();
    const kwClean = ` ${kwTrim} `;

    // 1. Accented exact phrase match
    if (textClean.includes(kwClean)) {
      return kw;
    }

    // 2. Unaccented match (skip if text is already accented or keyword is accent-sensitive)
    const kwHasAccents = VIETNAMESE_DIACRITICS_REGEX.test(kwTrim);
    const allowUnaccented = (!kwHasAccents || !isAccented) && !ACCENT_SENSITIVE_KEYWORDS.has(kwTrim);

    if (allowUnaccented) {
      const kwNoAccent = ` ${removeAccents(kwTrim)} `;
      if (textNoAccent.includes(kwNoAccent)) {
        return kw;
      }
    }
  }
  return null;
}

/**
 * Regex identifying directional / address landmark prepositions in Vietnamese.
 * Used to avoid false-rejecting SMB posts that merely mention a landmark in their address line
 * (e.g. "Ngay Nhà thuốc Long Châu – đối diện Chung cư Sky9", "cạnh Vinmart", "gần bệnh viện...").
 */
export const LANDMARK_PREFIX_REGEX = /(?:địa\s*chỉ|đ\/c|dc|address|vị\s*trí|vi\s*tri|toạ\s*độ|tại|tai|ở|o|ngay|ngay\s*cổng|ngay\s*chân|đối\s*diện|doi\s*dien|doi\s*dien\s*cong|đối\s*diện\s*cổng|gần|gan|gần\s*cổng|gan\s*cong|cạnh|canh|kế\s*bên|ke\s*ben|kế|ke|sát\s*bên|sat\s*ben|sát|sat|cách|cach|sau\s*lưng|sau\s*lung|sau|trước\s*mặt|truoc\s*mat|trước|truoc|bên\s*hông|ben\s*hong|bên\s*cạnh|ben\s*canh|hướng\s*đi|huong\s*di|hướng\s*về|huong\s*ve|đoạn|doan|ngã\s*[345ba|tư|tu|năm|nam]|nga\s*[345ba|tu|nam]|vòng\s*xoay|vong\s*xoay|bùng\s*binh|bung\s*binh|chân\s*cầu|chan\s*cau|dưới\s*chân|duoi\s*chan|shophouse|tầng\s*trệt|tang\s*tret|khu\s*đô\s*thị|khu\s*do\s*thi|chung\s*cư|chung\s*cu|toà\s*nhà|tòa\s*nhà|toa\s*nha|đường|duong|phố|pho|ngõ|ngo|hẻm|hem|số|so)\s*(?:của|ở|tại|phía|bên)?\s*(?:nhà\s*thuốc|siêu\s*thị|cửa\s*hàng|chi\s*nhánh|toà\s*nhà|tòa\s*nhà|toa\s*nha|chung\s*cư|chung\s*cu|dự\s*án|du\s*an|khu\s*đô\s*thị|khu\s*do\s*thi|trung\s*tâm|tttm|chợ|bệnh\s*viện|trường|truong|trường\s*học|trường\s*đại\s*học|đại\s*học|dai\s*hoc|cao\s*đẳng|cao\s*dang|cổng|cong|cổng\s*trường|ktx|kcn|khu\s*công\s*nghiệp)?\s*[:\-\s]*$/i;

/**
 * Checks if ALL occurrences of a matched keyword in post content appear inside a directional landmark context.
 * If yes, the keyword is only serving as an address landmark / location indicator, NOT the business being opened.
 */
export function isLandmarkContext(content = '', matchedKeyword = '') {
  if (!content || !matchedKeyword) return false;

  const contentLower = content.toLowerCase();
  const kwLower = matchedKeyword.toLowerCase().trim();
  const contentNoAccent = removeAccents(contentLower);
  const kwNoAccent = removeAccents(kwLower);

  let searchIdx = 0;
  let matchesCount = 0;
  let landmarkMatches = 0;

  while (searchIdx < contentNoAccent.length) {
    const idx = contentNoAccent.indexOf(kwNoAccent, searchIdx);
    if (idx === -1) break;

    const charBefore = idx > 0 ? contentNoAccent[idx - 1] : ' ';
    const charAfter = idx + kwNoAccent.length < contentNoAccent.length ? contentNoAccent[idx + kwNoAccent.length] : ' ';
    const isWordBoundary = !/[a-z0-9]/i.test(charBefore) && !/[a-z0-9]/i.test(charAfter);

    if (isWordBoundary) {
      matchesCount++;
      const startPre = Math.max(0, idx - 80);
      const preText = content.substring(startPre, idx).trim();
      const preTextNoAccent = removeAccents(preText);

      if (LANDMARK_PREFIX_REGEX.test(preText) || LANDMARK_PREFIX_REGEX.test(preTextNoAccent)) {
        landmarkMatches++;
      }
    }

    searchIdx = idx + kwNoAccent.length;
  }

  return matchesCount > 0 && matchesCount === landmarkMatches;
}

/**
 * Robust Negative Entity Matcher with Directional Landmark Awareness.
 * 1. Checks authorName: If matched, 100% rejected (author represents the entity).
 * 2. Checks content: If matched, verifies whether it is merely an address landmark.
 */
export function findMatchedNegativeEntity(authorName = '', content = '', keywords = []) {
  if (!Array.isArray(keywords) || keywords.length === 0) return null;

  const authorClean = cleanTextForMatching(authorName);
  const contentClean = cleanTextForMatching(content);
  const contentNoAccent = cleanTextForMatching(removeAccents(contentClean));
  const authorNoAccent = cleanTextForMatching(removeAccents(authorClean));

  const isAccentedAuthor = VIETNAMESE_DIACRITICS_REGEX.test(authorName);
  const isAccentedContent = VIETNAMESE_DIACRITICS_REGEX.test(content);

  // 1. Author match (100% priority, no landmark bypass)
  for (const kw of keywords) {
    const kwTrim = kw.toLowerCase().trim();
    const kwClean = ` ${kwTrim} `;
    if (authorClean.includes(kwClean)) return { term: kw, inAuthor: true };

    const kwHasAccents = VIETNAMESE_DIACRITICS_REGEX.test(kwTrim);
    const allowUnaccentedAuthor = (!kwHasAccents || !isAccentedAuthor) && !ACCENT_SENSITIVE_KEYWORDS.has(kwTrim);
    if (allowUnaccentedAuthor) {
      const kwNoAccent = ` ${removeAccents(kwTrim)} `;
      if (authorNoAccent.includes(kwNoAccent)) return { term: kw, inAuthor: true };
    }
  }

  // 2. Content match (with landmark bypass)
  for (const kw of keywords) {
    const kwTrim = kw.toLowerCase().trim();
    const kwClean = ` ${kwTrim} `;
    let hasMatch = contentClean.includes(kwClean);

    if (!hasMatch) {
      const kwHasAccents = VIETNAMESE_DIACRITICS_REGEX.test(kwTrim);
      const allowUnaccentedContent = (!kwHasAccents || !isAccentedContent) && !ACCENT_SENSITIVE_KEYWORDS.has(kwTrim);
      if (allowUnaccentedContent) {
        const kwNoAccent = ` ${removeAccents(kwTrim)} `;
        hasMatch = contentNoAccent.includes(kwNoAccent);
      }
    }

    if (hasMatch) {
      if (!isLandmarkContext(content, kwTrim)) {
        return { term: kw, inAuthor: false };
      }
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

// Prefix requires word boundary and whitespace (strictly avoids matching "mở", "phở", "cởi", etc.)
const LOC_PREFIX = '(?:^|[\\s,;:!?\\(\\[])(?:ở|tại|bên|sang|đi|khu\\s*vực|sống\\s*tại|đến\\s*từ|về\\s*từ|located\\s*in|lives\\s*in|address|cụ\\s*thể|nước|quốc\\s*gia)[\\s:\\.-]*(?:nước\\s+(?:láng\\s*giềng|bạn)?|thành\\s*phố|tp|tiểu\\s*bang|khu\\s*vực|bên)?\\s*';

// Patterns detecting foreign countries / overseas businesses & diaspora
export const FOREIGN_PATTERNS = [
  // Cụ thể địa điểm / khu vực nước ngoài (Yêu cầu tên quốc gia rõ ràng, tránh từ đơn trùng đại từ/tên người Việt)
  new RegExp(`${LOC_PREFIX}(?:nhật bản|tokyo|osaka|nagoya|fukuoka|saitama|chiba|hokkaido|okinawa|kobe|kyoto|nhật)\\b`, 'i'),
  new RegExp(`${LOC_PREFIX}(?:hàn quốc|korea|seoul|busan|incheon|daegu|daejeon|gwangju|suwon|hàn)\\b`, 'i'),
  new RegExp(`${LOC_PREFIX}(?:đài loan|taiwan|taipei|đài bắc|đài trung|đài nam|cao hùng|đào viên|taichung|kaohsiung)\\b`, 'i'),
  new RegExp(`${LOC_PREFIX}(?:mỹ|hoa kỳ|usa|california|cali|texas|houston|san jose|florida|seattle|new york|dallas)\\b`, 'i'),
  new RegExp(`${LOC_PREFIX}(?:úc|australia|sydney|melbourne|brisbane|perth|adelaide)\\b`, 'i'),
  new RegExp(`${LOC_PREFIX}(?:canada|toronto|vancouver|montreal|calgary)\\b`, 'i'),
  new RegExp(`${LOC_PREFIX}(?:châu âu|nước đức|germany|berlin|nước anh|vương quốc anh|london|nước pháp|paris|nước nga|ba lan|cộng hòa séc|ch séc|czech|uk)\\b`, 'i'),
  new RegExp(`${LOC_PREFIX}(?:singapore|malaysia|thái lan|bangkok|campuchia|phnom penh|nước lào|philippines)\\b`, 'i'),

  // Direct cities & specific overseas countries that never collide with Vietnamese pronouns
  /\b(?:đài\s*loan|taiwan|nhật\s*bản|hàn\s*quốc|hoa\s*kỳ|thái\s*lan|bangkok|chiang\s*mai|phnom\s*penh|siem\s*reap|campuchia|vientiane|viêng\s*chăn|kuala\s*lumpur|singapore|taipei|taichung|kaohsiung|đài\s*bắc|đài\s*trung|đài\s*nam|cao\s*hùng|tokyo|osaka|nagoya|fukuoka|saitama|chiba|hokkaido|okinawa|seoul|busan|incheon|california|houston|sydney|melbourne|brisbane|vancouver|toronto)\b/i,

  // Đối tượng / thị trường / cộng đồng nước ngoài & xuất khẩu
  /\b(?:du học sinh|xklđ|xuất khẩu lao động|tu nghiệp sinh|tokutei|định cư|kiều bào|việt kiều)\s+(?:nhật|hàn|đài|mỹ|úc|canada|âu|đức|anh)/i,
  /(?:xuất\s*khẩu|xuat\s*khau|ship|gửi|gui|order|đơn\s*đi)\s+(?:sang|đi|cho|vào)\s+(?:mỹ|my|usa|canada|nhật|nhat|hàn|han|đài\s*loan|dai\s*loan|châu\s*âu|chau\s*au|úc|uc)/iu,
  /\b(?:ship toàn đài loan|ship toàn nhật|ship toàn hàn|ship us|order us|order uk|ship quốc tế)\b/i,
  /\b(?:tân đài tệ|đài tệ|tiền đài)\b/i,
  /(?:\b\d+[\d,.]*\s*(?:baht|bath|usd|dollar|đô|euro|eur|sgd|rmb|cny|tệ|jpy|yen|yên|krw|won|ntd|tân\s*đài\s*tệ|aud|cad|khr|riel|lak|kip|rub|bảng\s*anh|gbp|man|sen)\b|\$\s*\d+)/i,
  /(?:người\s*việt|nguoi\s*viet|đồng\s*hương|hội|cộng\s*đồng|chợ\s*việt|du\s*học\s*sinh|xklđ)\s+(?:tại|ở|bên|tai|o)?\s*(?:đài\s*loan|nhật\s*bản|nhật|hàn\s*quốc|hàn|mỹ|úc|canada|anh|pháp|đức|ba\s*lan|séc|ch\s*séc|châu\s*âu|taiwan|japan|korea|tokyo|seoul|taipei|osaka|bangkok)/iu,
  /\b(?:line\s*id|id\s*line|kakaotalk|kakao\s*id)\b/i
];

// Patterns detecting celebratory / guest / attendee congratulatory posts (NOT the business owner)
export const CONGRATULATORY_PATTERNS = [
  /(?:^|[\s,;:.!?-])(?:chúc|chuc)\s+(?:\d+\s+)?(?:thầy|cô|bạn|anh|chị|em|cháu|bác|chú|dì|mẹ|ba|sếp|người anh|người em|con bạn|thằng bạn|mấy đứa|hai bạn|2 bạn|hai đứa|2 đứa|hai anh|2 anh|hai chị|2 chị|hai thầy|2 thầy|quán|team)[^\n.!?]{0,50}(?:khai trương|khai truong|hồng phát|hong phat|đại thắng|thành công|mua may bán đắt|bội thu)/iu,
  /(?:^|[\s,;:.!?-])(?:chúc\s*mừng|chuc\s*mung)\s+(?:[^\n.!?]{0,50}\s+)?(?:khai\s*trương|khai\s*truong)/iu,
  /(?:^|[\s,;:.!?-])(?:gửi\s*(?:cây|hoa|quà|lẵng|kệ)|tặng\s*(?:cây|hoa|quà|lẵng|kệ))\s+(?:tới|cho|sang|đến|để)?\s*(?:chúc\s*mừng|chuc\s*mung)/iu,
  /(?:^|[\s,;:.!?-])(?:mừng|mung)\s+(?:khai\s*trương|khai\s*truong)[^\n.!?]{0,30}(?:nhé|nha|ạ|nghen|chúc|may\s*mắn|bội\s*thu|hồng\s*phát)/iu,
  /(?:khai trương|khai truong)\s+(?:hồng phát|hong phat|đại thắng|thành công|may mắn)/iu,
  /(?:^|[\s,;:.!?-])(?:dự lễ|tham dự lễ|đi ăn|đi tiệc|ăn tiệc|đi chúc mừng|đến chúc mừng|qua chúc mừng)\s+(?:lễ\s+)?khai trương/iu,
  /(?:^|[\s,;:.!?-])(?:chung vui|đến chung vui|góp mặt)\s+(?:cùng|với)?[^\n.!?]{0,30}(?:khai trương|sinh nhật)/iu,
  /(?:mong|chúc)\s+(?:cửa\s*hàng|quán|tiệm|shop)[^\n.!?]{0,50}(?:may\s*mắn|kinh\s*doanh\s*thật\s*tốt|buôn\s*may\s*bán\s*đắt|đông\s*khách|hồng\s*phát|thành\s*công)/iu,
  /(?:kỷ niệm|sinh nhật)\s+lần\s+thứ\s+\d+/iu
];

export function checkCongratulatoryLead(post = {}) {
  const content = `${post.content || ''}`.normalize('NFKC');

  // Exemption: Strong shop owner / business signals (pricing, menu, discounts, address, gratitude, invitations)
  const isShopOwnerSignal = /(?:quán\s*(?:em|mình|chúng\s*mình|tụi\s*mình|nhà\s*em|tôi)|tiệm\s*(?:em|mình|chúng\s*mình)|shop\s*(?:em|mình)|chúng\s*mình\s*(?:mở|bán|khai\s*trương)|quán\s*chính\s*thức|mở\s*cửa\s*đón\s*khách|chính\s*thức\s*mở\s*cửa|lên\s*đèn|ngày\s*mai\s*mở\s*bán|cơ\s*sở\s*mới|chi\s*nhánh\s*mới|menu|thực\s*đơn|bảng\s*giá|đồng\s*giá|giảm\s*(?:giá\s*)?(?:\d+%)|khuyến\s*mãi|ưu\s*đãi|\bgọi\s*ngay\b|đặt\s*bàn|kính\s*mời|mời\s*mọi\s*người|mời\s*cả\s*nhà|thân\s*mời|ghé\s*quán|ghé\s*tiệm|ủng\s*hộ\s*quán|cảm\s*ơn\s*(?:mọi\s*người|cả\s*nhà|quý\s*khách|anh\s*chị|bạn\s*bè)|địa\s*chỉ\s*(?:quán|tiệm|cửa\s*hàng|ở|tại)?|hotline|sđt|sdt|ship\s*tận\s*nơi|order)/iu.test(content) ||
    /^(?:shop|quán|tiệm|nhà\s*hàng|bánh\s*mì|trà\s*sữa|cafe|cà\s*phê)\s+/iu.test(post.authorName || '');

  // If there are shop owner signals, it is definitive that the post is from the shop owner/seller, NOT a guest
  if (isShopOwnerSignal) {
    return { isCongratulatory: false };
  }

  for (const regex of CONGRATULATORY_PATTERNS) {
    const m = content.match(regex);
    if (m) {
      return { isCongratulatory: true, reason: `Lời chúc mừng của khách: "${m[0].trim()}"` };
    }
  }
  return { isCongratulatory: false };
}

/**
 * Patterns detecting Fanpages & Content about Esports, Gaming teams, Showbiz,
 * Memes, Entertainment, and Celebrity / Pro player news (e.g. "Sở Thú Nhà T1", Doran, Keria, Pyosik, Faker, Showbiz gossip).
 */
export const MEDIA_ESPORTS_GOSSIP_PATTERNS = {
  authorPatterns: [
    /\b(?:t1|gen\.g|geng|faker|keria|doran|pyosik|chovy|oner|gumayusi|zeus|showmaker|deft|canyon|beryl|dplus|drx|kt\s*rolster|hanwha\s*life|hle)\b/i,
    /\b(?:sở\s*thú\s*nhà|fanpage|fanclub|fandom|showbiz|hóng\s*hớt|hóng\s*biến|beatvn|kênh\s*14|kenh14|tiin|yan\s*news|tiin\.vn|bóng\s*đá|troll\s*bóng\s*đá|vietnam\s*esports|esports|gaming|game\s*tv|gamek|confessions|cộng\s*đồng\s*game|streamer|chuyện\s*showbiz|trạm\s*dừng\s*chân)\b/i,
    /\b(?:meme|troll|gen\s*z|góc\s*thư\s*giãn|hội\s*những\s*người|hội\s*cuồng|báo\s*mới|tin\s*tức\s*24h)\b/i
  ],
  contentPatterns: [
    /\b(?:tuyển\s*thủ|game\s*thủ|pro\s*player)\s+(?:pyosik|doran|keria|faker|chovy|gumayusi|oner|zeus|deft|showmaker|levi|sofm|kiaya)/i,
    /\b(?:t1\s+doran|t1\s+keria|t1\s+faker|t1\s+oner|t1\s+gumayusi|t1\s+zeus)\b/i,
    /\b(?:mẹ|bố|ba|gia\s*đình)\s+của\s+(?:tuyển\s*thủ|keria|doran|pyosik|faker|chovy)/i,
    /\b(?:lck|lpl|vcs|msi|worlds\s*\d{4}|chung\s*kết\s*thế\s*giới|cktg|vòng\s*bảng\s*lck)\b/i,
    /\b(?:esports|streamer|tiktoker|idol\s*kpop|showbiz\s*hàn|sao\s*hàn|diễn\s*viên\s*hàn)\b/i,
    /[\uac00-\ud7af]/
  ]
};

export function checkMediaEsportsGossipLead(post = {}) {
  const author = `${post.authorName || ''}`.normalize('NFKC');
  const content = `${post.content || ''}`.normalize('NFKC');

  // Shop Owner Exemption
  const isShopOwnerSignal = /(?:quán\s*(?:em|mình|nhà\s*em)|tiệm\s*(?:em|mình)|shop\s*(?:em|mình)|menu|thực\s*đơn|bảng\s*giá|giảm\s*(?:\d+%)|khuyến\s*mãi|kính\s*mời|mời\s*cả\s*nhà|đặt\s*bàn|địa\s*chỉ\s*(?:quán|tiệm|ở|tại)|hotline|sđt)/iu.test(content);

  for (const regex of MEDIA_ESPORTS_GOSSIP_PATTERNS.authorPatterns) {
    if (regex.test(author)) {
      if (!isShopOwnerSignal) {
        return { isMediaEsports: true, reason: `Fanpage / Kênh giải trí / Esports / Meme: "${author}"` };
      }
    }
  }

  for (const regex of MEDIA_ESPORTS_GOSSIP_PATTERNS.contentPatterns) {
    const m = content.match(regex);
    if (m) {
      if (!isShopOwnerSignal) {
        return { isMediaEsports: true, reason: `Nội dung Esports / Tuyển thủ / Showbiz / Chữ Hàn: "${m[0]}"` };
      }
    }
  }

  return { isMediaEsports: false };
}

// Patterns detecting B2B Supporting Services, Event Gifts, Fruit Gift Baskets, Florals, Wedding Decor, Printing
export const EVENT_GIFT_SERVICES_PATTERNS = [
  // 1. Giỏ trái cây, giỏ hoa quả, giỏ quà biếu, hộp quà trái cây, set quà trái cây, mâm quả
  /(?:^|[\s,;:.!?-])(?:giỏ|gio|hộp|hop|set|khay|mâm|mam)\s+(?:quà|qua|trái\s*cây|trai\s*cay|hoa\s*quả|hoa\s*qua|quả|qua)(?:[\s,;:.!?-]|$)/iu,
  /(?:^|[\s,;:.!?-])(?:đặt\s*giỏ|dat\s*gio|lên\s*giỏ|len\s*gio|mẫu\s*giỏ|mau\s*gio|lên\s*mẫu\s*giỏ|set\s*quà|món\s*quà\s*nhỏ)(?:[\s,;:.!?-]|$)/iu,
  /(?:^|[\s,;:.!?-])(?:quà\s*biếu|qua\s*bieu|quà\s*tặng|qua\s*tang)\s+(?:khai\s*trương|khai\s*truong|tân\s*gia|tan\s*gia|sinh\s*nhật|sinh\s*nhat|thăm\s*hỏi|tham\s*hoi)/iu,
  /(?:^|[\s,;:.!?-])(?:biếu|bieu|tặng|tang)\s+(?:bố\s*mẹ|ông\s*bà|đối\s*tác|khách\s*hàng|người\s*thân)[^\n.!?]{0,60}(?:khai\s*trương|khai\s*truong|tân\s*gia|sinh\s*nhật)/iu,
  /(?:^|[\s,;:.!?-])(?:mâm\s*quả|mam\s*qua)\s+(?:cưới\s*hỏi|cuoi\s*hoi|rồng\s*phụng|rong\s*phung|dạm\s*ngõ|dam\s*ngo)?/iu,
  /(?:^|[\s,;:.!?-])(?:quả\s*dạm\s*ngõ|qua\s*dam\s*ngo)/iu,

  // 2. Decor, trang trí gia tiên, tiệc cưới, rạp cưới, cổng hoa cưới, hoa bàn gia tiên
  /(?:^|[\s,;:.!?-])(?:decor|trang\s*trí|trang\s*tri)\s+(?:by\s+team|team|bàn\s+)?(?:gia\s*tiên|gia\s*tien|tiệc\s*cưới|tiec\s*cuoi|rạp\s*cưới|rap\s*cuoi|cổng\s*hoa|cong\s*hoa|xe\s*hoa)/iu,
  /(?:^|[\s,;:.!?-])chuyên\s+trang\s+trí\s+(?:gia\s*tiên|tiệc\s*cưới|sinh\s*nhật|khai\s*trương)/iu,
  /(?:^|[\s,;:.!?-])(?:bàn\s+gia\s+tiên|cổng\s+hoa\s+cưới|hoa\s+xe\s+cưới|hoa\s+cưới\s+cầm\s+tay)/iu,

  // 3. Dịch vụ hoa: tiệm hoa, hoa sáp, hoa viếng, nhận đặt/giao/sỉ hoa khai trương, đào tạo cắm hoa
  /(?:^|[\s,;:.!?-])(?:đặt|dat|bán|ban|sỉ|si|giao|ship|cung\s*cấp|chuyên|mẫu|mau)\s+(?:hoa\s*khai\s*trương|kệ\s*hoa|lẵng\s*hoa|giỏ\s*hoa|bó\s*hoa)/iu,
  /(?:^|[\s,;:.!?-])(?:hoa\s*viếng|hoa\s*vieng|hoa\s*chia\s*buồn|hoa\s*chia\s*buon|hoa\s*sáp|hoa\s*sap|hoa\s*tiền|hoa\s*tien|hoa\s*hội\s*nghị|hoa\s*hoi\s*nghi|hoa\s*tỏ\s*tình|hoa\s*tốt\s*nghiệp|hoa\s*kỷ\s*yếu|hoa\s*bánh\s*kẹo|bó\s*hoa\s*sáp|bó\s*hoa\s*tiền)(?:[\s,;:.!?-]|$)/iu,
  /(?:^|[\s,;:.!?-])(?:đào\s*tạo\s*học\s*viên|dao\s*tao\s*hoc\s*vien|dạy\s*cắm\s*hoa|day\s*cam\s*hoa|học\s*cắm\s*hoa|hoc\s*cam\s*hoa)/iu,
  /(?:^|[\s,;:.!?-])(?:shop\s*hoa|tiệm\s*hoa|tiem\s*hoa)\s+(?:tươi|tuoi|sáp|sap)?(?:[\s,;:.!?-]|$)/iu,

  // 4. In thiệp mời, phong bì, kẹp file, ấn phẩm sự kiện
  /(?:^|[\s,;:.!?-])(?:in|in\s*ấn)\s+(?:thiệp\s*mời|thiep\s*moi|thiệp\s*cưới|thiep\s*cuoi|phong\s*bì|phong\s*bi|kẹp\s*file|kep\s*file|voucher|tờ\s*rơi|to\s*roi|ấn\s*phẩm|an\s*pham)/iu,
  /(?:^|[\s,;:.!?-])in\s+thiệp\s+mời\s+(?:sự\s+kiện|khai\s+trương|hội\s+nghị)/iu,

  // 5. Múa lân sư rồng khai trương, âm thanh ánh sáng, backdrop, sân khấu
  /(?:^|[\s,;:.!?-])(?:đoàn\s*lân|đội\s*lân|múa\s*lân|mua\s*lan|lân\s*sư\s*rồng|trống\s*hội|thuê\s*múa\s*lân|dịch\s*vụ\s*múa\s*lân|âm\s*thanh\s*ánh\s*sáng|thuê\s*loa\s*kéo|cho\s*thuê\s*rạp|backdrop\s*khai\s*trương|thi\s*công\s*backdrop)/iu
];

export function checkEventGiftServiceLead(post = {}) {
  const content = `${post.content || ''}`.normalize('NFKC');
  const author = `${post.authorName || ''}`.normalize('NFKC');
  const rawText = `${author} ${content}`;

  // Exemption 1: Quán ăn / cafe / cửa hàng bán lẻ được tặng hoa hoặc cảm ơn hoa chúc mừng
  const isReceivingFlowers = /(?:cảm\s*ơn|cam\s*on|nhận\s*được|ngập\s*tràn|rực\s*rỡ|nhiều|tặng|tri\s*ân)\s+[^\n.!?]{0,30}(?:lẵng|kệ|giỏ|hoa|bó)/iu.test(content) ||
    /(?:quán\s*(?:em|mình)|tiệm\s*(?:em|mình)|bún|phở|cơm|cafe|cà\s*phê|trà\s*sữa|nướng|lẩu|ăn\s*vặt|bánh\s*mì|nhậu)/iu.test(author);

  // Exemption 2: Quán F&B / bán lẻ khai trương có tiết mục múa lân biểu diễn rộn ràng
  const isStoreHostingLionDance = !/(?:đoàn\s*lân|đội\s*lân|dịch\s*vụ\s*múa\s*lân|cho\s*thuê\s*múa\s*lân|nhận\s*show)/iu.test(author) &&
    /(?:quán|tiệm|bún|phở|cơm|cafe|cà\s*phê|trà\s*sữa|nướng|lẩu|ăn\s*vặt|bánh\s*mì|nhậu|bida|karaoke)/iu.test(rawText) &&
    /(?:có\s*(?:tiết\s*mục\s+|chương\s*trình\s+|biểu\s*diễn\s+)?múa\s*lân|đón\s*lân|xem\s*múa\s*lân|khai\s*mạc\s+rộn\s*ràng)/iu.test(content);

  for (const regex of EVENT_GIFT_SERVICES_PATTERNS) {
    const m = rawText.match(regex);
    if (m) {
      const matchedStr = m[0].trim();
      if (isReceivingFlowers && /(?:lẵng\s*hoa|kệ\s*hoa|giỏ\s*hoa|hoa\s*khai\s*trương|bó\s*hoa)/i.test(matchedStr)) {
        continue;
      }
      if (isStoreHostingLionDance && /(?:múa\s*lân|lân\s*sư\s*rồng|trống\s*hội)/i.test(matchedStr)) {
        continue;
      }
      return { isEventGiftService: true, reason: `Dịch vụ quà tặng / giỏ quả / hoa / decor / in ấn sự kiện: "${matchedStr}"` };
    }
  }
  return { isEventGiftService: false };
}

// Patterns detecting Industrial Manufacturing, Factories, Industrial Zones (KCN), and Manual Worker Recruitment
export const INDUSTRIAL_MANUFACTURING_PATTERNS = [
  // 1. Khu công nghiệp, khu chế xuất, cụm công nghiệp
  /(?:^|[\s,;:.!?-])(?:kcn|khu\s*công\s*nghiệp|khu\s*cong\s*nghiep|khu\s*chế\s*xuất|khu\s*che\s*xuat|cụm\s*công\s*nghiệp|cum\s*cong\s*nghiep)(?:[\s,;:.!?-]|$)/iu,

  // 2. Nhà máy, xí nghiệp, phân xưởng, xưởng sản xuất, công ty sản xuất
  /(?:^|[\s,;:.!?-])(?:nhà\s*máy|nha\s*may|xí\s*nghiệp|xi\s*nghiep|phân\s*xưởng|phan\s*xuong|xưởng\s*sản\s*xuất|xuong\s*san\s*xuat|công\s*ty\s*sản\s*xuất|cong\s*ty\s*san\s*xuat)(?:[\s,;:.!?-]|$)/iu,

  // 3. Tuyển công nhân, lao động phổ thông, công nhân may/sản xuất/thời vụ
  /(?:^|[\s,;:.!?-])(?:tuyển|tuyen)\s+(?:dụng\s+)?(?:gấp\s+)?(?:\d+\s+)?(?:công\s*nhân|cong\s*nhan|lao\s*động\s*phổ\s*thông|lao\s*dong\s*pho\s*thong|thợ\s*may|tho\s*may|công\s*nhân\s*may|công\s*nhân\s*sản\s*xuất|công\s*nhân\s*thời\s*vụ|thợ\s*hàn|thợ\s*tiện|thợ\s*cơ\s*khí)/iu,
  /(?:^|[\s,;:.!?-])(?:công\s*nhân\s*may|công\s*nhân\s*sản\s*xuất|công\s*nhân\s*thời\s*vụ|công\s*nhân\s*đứng\s*máy|lao\s*động\s*phổ\s*thông)(?:[\s,;:.!?-]|$)/iu,

  // 4. Gia công / Sản xuất công nghiệp hàng loạt (bít tất, may mặc, da giày, linh kiện, xuất khẩu)
  /(?:^|[\s,;:.!?-])(?:sản\s*xuất\s*(?:bít\s*tất|tất|vớ|giày|dép|may\s*mặc|quần\s*áo\s*xuất\s*khẩu|linh\s*kiện|bao\s*bì|nhựa|cơ\s*khí)|gia\s*công\s*(?:may|linh\s*kiện|hàng\s*xuất\s*khẩu|cơ\s*khí)|may\s*xuất\s*khẩu)/iu,

  // 5. Xuất khẩu sang nước ngoài
  /(?:^|[\s,;:.!?-])(?:xuất\s*khẩu|xuat\s*khau)\s+(?:sang|đi|cho|vào)\s+(?:mỹ|my|usa|canada|nhật|nhat|hàn|han|đài\s*loan|dai\s*loan|châu\s*âu|chau\s*au|úc|uc)/iu
];

export function checkIndustrialManufacturingLead(post = {}) {
  const author = `${post.authorName || ''}`.normalize('NFKC');
  const content = `${post.content || ''}`.normalize('NFKC');
  const combined = `${author} ${content}`;

  for (const regex of INDUSTRIAL_MANUFACTURING_PATTERNS) {
    const m = combined.match(regex);
    if (m) {
      const term = m[0].trim();
      if (!isLandmarkContext(content, term)) {
        return { isIndustrial: true, reason: `Cơ sở sản xuất / Nhà máy / Khu công nghiệp / Lao động phổ thông: "${term}"` };
      }
    }
  }
  return { isIndustrial: false };
}

/**
 * Checks if a post represents a business or person located overseas / in a foreign country.
 */
export function checkForeignLead(post = {}) {
  const phones = Array.isArray(post.phones) ? post.phones : (post.phone ? [post.phone] : []);

  // 1. Check International Phone Prefixes (+81, +82, +886, +1, +61, +44, +49, +33, +65, +60, +66...)
  for (const p of phones) {
    const cleanP = String(p).trim();
    if (/^\+(?!84)\d{6,}/.test(cleanP)) {
      return { isForeign: true, reason: `Số điện thoại quốc tế (${cleanP})` };
    }
  }

  // 1.1 Exemption: If post has a verified Vietnamese phone number (09x, 03x, 07x, 08x, 05x, or +84),
  // it is definitively a local Vietnamese business! Food origins (Mì cay Hàn Quốc, Trà sữa Đài Loan, Bò Mỹ, Lẩu Thái...) are NOT foreign!
  const hasVnPhone = phones.some(p => {
    const digits = String(p).replace(/[^\d]/g, '');
    return /^(?:03|05|07|08|09)\d{8}$/.test(digits) || /^84(?:3|5|7|8|9)\d{8}$/.test(digits);
  });

  const rawText = `${post.authorName || ''} ${post.content || ''} ${post.location || ''} ${post.groupName || ''}`;
  if (!rawText.trim()) return { isForeign: false };

  // Check if post is explicitly located in an overseas country/city or for overseas diaspora
  const isExplicitOverseas = /(?:tại|ở|bên|khu\s*vực|địa\s*chỉ)\s+(?:tokyo|osaka|nagoya|fukuoka|shin-okubo|nhật\s*bản|seoul|busan|hàn\s*quốc|đài\s*loan|taiwan|đài\s*bắc|đài\s*trung|cao\s*hùng|california|houston|texas|sydney|melbourne|bangkok|thái\s*lan|campuchia|phnom\s*penh)|\b(?:kiều\s*bào|việt\s*kiều|xklđ|tu\s*nghiệp\s*sinh|line\s*id|id\s*line|kakaotalk)\b/i.test(rawText);

  // If has VN phone or local VN address signals, and NOT an explicit overseas location, it is a local Vietnamese business!
  // Food origins (Mì cay Hàn Quốc, Trà sữa Đài Loan, Bò Mỹ, Lẩu Thái...) are NOT foreign!
  const hasVnAddressSignal = /(?:hà\s*nội|ha\s*noi|hồ\s*chí\s*minh|ho\s*chi\s*minh|tphcm|sài\s*gòn|sai\s*gon|đà\s*nẵng|da\s*nang|hải\s*phòng|hai\s*phong|cần\s*thơ|can\s*tho|bình\s*dương|binh\s*duong|đồng\s*nai|dong\s*nai|cầu\s*giấy|cau\s*giay|ba\s*đình|đống\s*đa|thanh\s*xuân|hoàn\s*kiếm|hai\s*bà\s*trưng|hoàng\s*mai|tây\s*hồ|bắc\s*từ\s*liêm|nam\s*từ\s*liêm|quận\s*\d+|phường|quận|huyện|đường|phố|ngõ|hẻm|địa\s*chỉ|ship\s*toàn\s*quốc)/i.test(rawText);

  if (!isExplicitOverseas && (hasVnPhone || hasVnAddressSignal)) {
    return { isForeign: false };
  }

  // 2. Check foreign patterns
  for (const regex of FOREIGN_PATTERNS) {
    const m = rawText.match(regex);
    if (m) {
      // Exclude food/product origin phrases like "bò úc", "thịt bò mỹ", "trà sữa đài loan", "lẩu thái", "mỹ phẩm hàn quốc"
      const matched = m[0].trim();
      if (/(?:bò|thịt|nho|táo|cam|sữa|trà\s*sữa|mỹ\s*phẩm|quần\s*áo|đồ|hàng|tiêu\s*chuẩn|phong\s*cách|chuẩn\s*vị|hương\s*vị|ẩm\s*thực|món|quán|tiệm|mì\s*cay)\s+(?:úc|mỹ|nhật|hàn|đài)/i.test(matched)) {
        continue;
      }
      const idx = m.index || 0;
      const preText = rawText.substring(Math.max(0, idx - 30), idx).toLowerCase();
      if (/(?:bò|thịt|nho|táo|cam|sữa|trà\s*sữa|mỹ\s*phẩm|quần\s*áo|đồ|hàng|tiêu\s*chuẩn|phong\s*cách|chuẩn\s*vị|hương\s*vị|gốc|món|ẩm\s*thực|mì\s*cay)\s*$/i.test(preText.trim())) {
        continue;
      }
      if (/(?:lẩu|trà|nem|gỏi|súp|món|ẩm\s*thực|chua\s*cay|chuẩn\s*vị|hương\s*vị)\s+thái(?:\s*lan)?/i.test(rawText)) {
        const cleanedOfThaiDish = rawText.replace(/(?:lẩu|trà|nem|gỏi|súp|món|ẩm\s*thực|chua\s*cay|chuẩn\s*vị|hương\s*vị)\s+thái(?:\s*lan)?/gi, '');
        if (!/(?:ở|tại|nước)\s+thái\s*lan|bangkok|\bbaht\b|\bbath\b/i.test(cleanedOfThaiDish)) {
          continue;
        }
      }
      return { isForeign: true, reason: `Địa điểm / Thị trường nước ngoài: "${matched}"` };
    }
  }

  return { isForeign: false };
}

export const REAL_ESTATE_GROUP_PATTERNS = [
  /(?:phòng\s*trọ|phong\s*tro|nhà\s*trọ|nha\s*tro)/i,
  /(?:căn\s*hộ|can\s*ho|căn\s*hộ\s*dịch\s*vụ|chdv)/i,
  /(?:chung\s*cư|chung\s*cu)/i,
  /(?:bất\s*động\s*sản|bat\s*dong\s*san|bđs|bds|nhà\s*đất|nha\s*dat|địa\s*ốc|dia\s*oc)/i,
  /(?:cho\s*thuê\s*phòng|cho\s*thue\s*phong|tìm\s*phòng\s*trọ|tim\s*phong\s*tro)/i,
  /(?:cho\s*thuê\s*căn\s*hộ|cho\s*thue\s*can\s*ho|cho\s*thuê\s*nhà|cho\s*thue\s*nha)/i,
  /(?:cho\s*thuê\s*mặt\s*bằng|cho\s*thue\s*mat\s*bang|nhượng\s*mặt\s*bằng)/i
];

export const REAL_ESTATE_AUTHOR_PATTERNS = [
  /\bHR\s+[A-ZÀ-Ỹa-zà-ỹ0-9_]+/i,
  /\b(?:bđs|bds|bất\s*động\s*sản|nhà\s*đất|địa\s*ốc|môi\s*giới|cho\s*thuê|phòng\s*trọ|căn\s*hộ|chdv)\b/i
];

export const REAL_ESTATE_CONTENT_PATTERNS = [
  /(?:khai\s*trương|mở\s*cửa|ra\s*mắt|khánh\s*thành)\s*(?:chung\s*cư|căn\s*hộ|toà\s*nhà|tòa\s*nhà|phòng\s*trọ|chdv|khu\s*trọ|dãy\s*trọ)/i,
  /(?:chung\s*cư\s*mini|ccmn|căn\s*hộ\s*mini|căn\s*hộ\s*dịch\s*vụ|chdv|toà\s*nhà\s*mini|tòa\s*nhà\s*mini)/i,
  /(?:1|2|3|4)\s*pn\s*(?:\+|\&|\/)?\s*(?:1|2|3|4)?\s*pk/i,
  /\b(?:1pn|2pn|3pn|1pk|2pk|1pn1pk|studio|duplex|bancol)\b/i,
  /căn\s*hộ\s*(?:bancol|studio|duplex|cao\s*cấp|mini|dịch\s*vụ|sang\s*xịn|view)/i,
  /toà\s*nhà\s*(?:cao\s*cấp|mới\s*xây)|tòa\s*nhà\s*(?:cao\s*cấp|mới\s*xây)/i,
  /thang\s*máy,\s*full\s*nội\s*thất|full\s*nội\s*thất\s*tiết\s*kiệm\s*điện|full\s*nội\s*thất\s*cao\s*cấp/i,
  /(?:phòng\s*trọ|nhà\s*trọ|tìm\s*phòng\s*trọ|cho\s*thuê\s*phòng|cho\s*thuê\s*căn\s*hộ|cho\s*thuê\s*nhà|nhượng\s*phòng|pass\s*phòng)/i,
  /(?:gặp|lh|liên\s*hệ|inbox)?\s*(?:[a-zà-ỹ\s]{0,20})?xem\s*phòng(?:\s*trước|\s*ngay|\s*trực\s*tiếp)?/i,
  /(?:hẹn\s*xem\s*phòng|đặt\s*cọc\s*phòng|cọc\s*(?:1|2)\s*tháng|tiền\s*cọc|tiền\s*phòng|giá\s*phòng|phí\s*dịch\s*vụ)/i,
  /(?:điện\s*\d+k|nước\s*\d+k|giờ\s*giấc\s*tự\s*do|không\s*chung\s*chủ|khóa\s*vân\s*tay|hầm\s*để\s*xe)/i,
  /(?:bất\s*động\s*sản|bđs|nhà\s*đất|đất\s*nền|condotel|officetel|biệt\s*thự|nhà\s*phố)/i,
  /mở\s*bán\s*(?:dự\s*án|căn\s*hộ|chung\s*cư|đất\s*nền|shophouse|biệt\s*thự|nhà\s*phố|phân\s*khu|tòa|khu\s*đô\s*thị)|lễ\s*mở\s*bán/i,
  /sa\s*bàn|đại\s*đô\s*thị|khu\s*đô\s*thị|dự\s*án\s*bất\s*động\s*sản/i,
  /\b(?:vinhomes|masterise|novaland|sun\s*group|hưng\s*thịnh|đất\s*xanh)\b/i
];

/**
 * Checks whether a candidate post represents a Real Estate / Room Rental / Mini Apartment / Property Sales post.
 * Excludes directional address landmarks for authentic food/retail SMB stores.
 */
export function checkRealEstateLead(post = {}) {
  const authorName = (post.authorName || '').trim();
  const content = (post.content || '').trim();
  const groupName = (post.groupName || '').trim();
  const combinedText = `${authorName} ${groupName} ${content}`;

  // 1. Group Name Check
  if (groupName) {
    for (const pat of REAL_ESTATE_GROUP_PATTERNS) {
      if (pat.test(groupName)) {
        return { isRealEstate: true, reason: `Đăng trong nhóm Chuyên Bất động sản / Phòng trọ / Căn hộ ("${groupName}")` };
      }
    }
  }

  // 2. Author Name Check
  if (authorName) {
    for (const pat of REAL_ESTATE_AUTHOR_PATTERNS) {
      if (pat.test(authorName)) {
        return { isRealEstate: true, reason: `Tác giả là môi giới BĐS / HR cho thuê phòng ("${authorName}")` };
      }
    }
  }

  // 3. Distinct food / retail signal
  const isStoreSellingFoodOrRetail = /(?:quán|tiệm|shop|cafe|cà\s*phê|trà\s*sữa|bún|phở|cơm|lẩu|nướng|ăn\s*vặt|bánh\s*mì|menu|thực\s*đơn|đồ\s*uống|món)/i.test(combinedText);

  // Strong Rental / Property Signals (These NEVER appear in authentic shop opening announcements)
  const strongRentalOrPropertySignal = /(?:khai\s*trương\s*(?:chung\s*cư|căn\s*hộ|toà\s*nhà|tòa\s*nhà|phòng\s*trọ|chdv)|chung\s*cư\s*mini|ccmn|căn\s*hộ\s*dịch\s*vụ|chdv|1pn|2pn|3pn|1pk|studio|duplex|bancol|xem\s*phòng|cọc\s*(?:1|2)\s*tháng|tiền\s*cọc|tiền\s*phòng|giá\s*phòng|giờ\s*giấc\s*tự\s*do|không\s*chung\s*chủ|mở\s*bán\s*(?:dự\s*án|căn\s*hộ|chung\s*cư|đất\s*nền)|sa\s*bàn|đại\s*đô\s*thị)/i.test(combinedText);

  if (strongRentalOrPropertySignal) {
    return { isRealEstate: true, reason: 'Nội dung cho thuê phòng trọ / Căn hộ dịch vụ / Chung cư mini / Bất động sản' };
  }

  // General content patterns with landmark bypass
  for (const pat of REAL_ESTATE_CONTENT_PATTERNS) {
    const match = combinedText.match(pat);
    if (match) {
      const matchedTerm = match[0];
      if (isLandmarkContext(content, matchedTerm) && isStoreSellingFoodOrRetail) {
        continue; // Landmark in address line of a food/retail store
      }
      return { isRealEstate: true, reason: `Chứa từ khóa Bất động sản / Nhà đất / Căn hộ / Phòng trọ: "${matchedTerm}"` };
    }
  }

  return { isRealEstate: false, reason: null };
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
    // 0. Foreign / Overseas Location Check (Highest Priority - POS software operates only in Vietnam)
    const foreignCheck = checkForeignLead(post);
    if (foreignCheck.isForeign) {
      return {
        qualified: false,
        leadQuality: 'rejected',
        qualityBadge: 'Loại trừ',
        category: 'foreign_location',
        matchedTerm: foreignCheck.reason,
        reason: `Khách hàng / Cửa hàng ở NƯỚC NGOÀI (${foreignCheck.reason}), không thuộc phạm vi kinh doanh tại Việt Nam.`
      };
    }

    // 0.1. Fanpage Media / Esports / Meme / Showbiz / Gossip Check
    const mediaCheck = checkMediaEsportsGossipLead(post);
    if (mediaCheck.isMediaEsports) {
      return {
        qualified: false,
        leadQuality: 'rejected',
        qualityBadge: 'Loại trừ',
        category: 'media_esports_gossip',
        matchedTerm: mediaCheck.reason,
        reason: `Fanpage tin tức / Esports / Giải trí / Tuyển thủ (${mediaCheck.reason}), không phải cơ sở kinh doanh độc lập.`
      };
    }

    // 0.4. Event & Supporting Services Check (Bán hoa sáp, giỏ quà, hoa khai trương, decor, in ấn, múa lân)
    // Always exclude by default when excludeEventGifts !== false (or excludeUnsupportedIndustries is true)
    if (config.excludeEventGifts !== false || config.excludeUnsupportedIndustries === true) {
      const eventGiftCheck = checkEventGiftServiceLead(post);
      if (eventGiftCheck.isEventGiftService) {
        return {
          qualified: false,
          leadQuality: 'rejected',
          qualityBadge: 'Loại trừ',
          category: 'event_gift_service',
          matchedTerm: eventGiftCheck.reason,
          reason: `Dịch vụ phụ trợ / Bán hoa khai trương / Giỏ quà / Decor / Múa lân (${eventGiftCheck.reason}).`
        };
      }
    }

    // 0.5. Guest / Congratulatory Post Check (Khách mời / Bạn bè chúc mừng khai trương)
    const congratCheck = checkCongratulatoryLead(post);
    if (congratCheck.isCongratulatory) {
      return {
        qualified: false,
        leadQuality: 'rejected',
        qualityBadge: 'Loại trừ',
        category: 'guest_congratulations',
        matchedTerm: congratCheck.reason,
        reason: `Bài viết chúc mừng khai trương của khách mời / bạn bè (${congratCheck.reason}), không phải chủ cơ sở kinh doanh mở mới.`
      };
    }

    // 0.6. Industrial Zone / Factory / Manufacturing / Worker Recruitment Check
    const industrialCheck = checkIndustrialManufacturingLead(post);
    if (industrialCheck.isIndustrial) {
      return {
        qualified: false,
        leadQuality: 'rejected',
        qualityBadge: 'Loại trừ',
        category: 'industrial_manufacturing',
        matchedTerm: industrialCheck.reason,
        reason: `Cơ sở sản xuất / Nhà máy / Khu công nghiệp / Lao động phổ thông (${industrialCheck.reason}).`
      };
    }

    // 0.7. Real Estate / Room Rental / Mini Apartment / Chung cư / Bất động sản Check
    if (config.excludeRealEstate !== false) {
      const realEstateCheck = checkRealEstateLead(post);
      if (realEstateCheck.isRealEstate) {
        return {
          qualified: false,
          leadQuality: 'rejected',
          qualityBadge: 'Bất động sản',
          category: 'real_estate',
          matchedTerm: realEstateCheck.reason,
          reason: `Ngành Bất động sản / Căn hộ / Phòng trọ / Chung cư (${realEstateCheck.reason}).`
        };
      }
    }

    const authorClean = cleanTextForMatching(post.authorName || '');
    const contentClean = cleanTextForMatching(post.content || '');
    const combinedText = `${authorClean} ${contentClean}`;
    const entities = this.getEntities();

    const excludeEnterprise = config.excludeEnterpriseChains !== false;
    const excludeCompetitors = config.excludePosCompetitors === true;
    const excludeRealEstate = config.excludeRealEstate === true;
    const excludeHotels = config.excludeHotels === true;
    const excludeBeautySpa = config.excludeBeautySpa === true;
    const excludeEventGifts = config.excludeEventGifts === true;
    const excludeUnsupported = config.excludeUnsupportedIndustries === true;
    const requireMobileOnly = config.requireMobilePhoneOnly !== false;

    // 1. Enterprise / Large Chain Check (Highest Priority)
    if (excludeEnterprise) {
      const matchedChain = findMatchedNegativeEntity(post.authorName, post.content, entities.enterpriseChains);
      if (matchedChain) {
        return {
          qualified: false,
          leadQuality: 'rejected',
          qualityBadge: 'Chuỗi lớn',
          category: 'enterprise_chain',
          matchedTerm: matchedChain.term,
          reason: `Nghi vấn chuỗi lớn / Doanh nghiệp quy mô lớn: "${matchedChain.term}"`
        };
      }
    }

    // 2. POS Software Competitor & Sale Seeding Check
    if (excludeCompetitors) {
      const matchedCompetitor = findMatchedNegativeEntity(post.authorName, post.content, entities.posCompetitors);
      if (matchedCompetitor) {
        return {
          qualified: false,
          leadQuality: 'rejected',
          qualityBadge: 'Đối thủ POS',
          category: 'pos_competitor',
          matchedTerm: matchedCompetitor.term,
          reason: `Đối thủ phần mềm POS / Bài bán hàng đối thủ: "${matchedCompetitor.term}"`
        };
      }
    }

    // 3. Granular Industry Check (Only exclude when user explicitly enabled corresponding toggle)
    if (excludeRealEstate) {
      const matchedRE = findMatchedNegativeEntity(post.authorName, post.content, [
        'bất động sản', 'bat dong san', 'bđs', 'nhà đất', 'nha dat', 'mua bán nhà', 'bán đất',
        'cho thuê nhà', 'cho thuê phòng', 'cho thuê phòng trọ', 'phòng trọ', 'phong tro',
        'căn hộ', 'can ho', 'chung cư', 'chung cu', 'shophouse', 'condotel', 'officetel',
        'cho thuê văn phòng', 'sàn văn phòng', 'mở bán dự án', 'dự án bất động sản'
      ]);
      if (matchedRE) {
        return {
          qualified: false,
          leadQuality: 'rejected',
          qualityBadge: 'Bất động sản',
          category: 'real_estate',
          matchedTerm: matchedRE.term,
          reason: `Ngành Bất động sản / Nhà đất / Phòng trọ: "${matchedRE.term}"`
        };
      }
    }

    if (excludeHotels) {
      const matchedHotel = findMatchedNegativeEntity(post.authorName, post.content, [
        'khách sạn', 'khach san', 'hotel', 'resort', 'nhà nghỉ', 'nha nghi', 'homestay',
        'villa', 'motel', 'tour du lịch', 'công ty du lịch', 'vé máy bay', 'lữ hành'
      ]);
      if (matchedHotel) {
        return {
          qualified: false,
          leadQuality: 'rejected',
          qualityBadge: 'Khách sạn/Du lịch',
          category: 'hotels',
          matchedTerm: matchedHotel.term,
          reason: `Ngành Khách sạn / Homestay / Du lịch: "${matchedHotel.term}"`
        };
      }
    }

    if (excludeBeautySpa) {
      const matchedSpa = findMatchedNegativeEntity(post.authorName, post.content, [
        'spa', 'tiệm spa', 'thẩm mỹ viện', 'massage', 'gội đầu dưỡng sinh', 'dưỡng sinh',
        'phun xăm', 'nối mi', 'triệt lông', 'tiệm nail', 'nail', 'tiệm cắt tóc', 'salon tóc',
        'hair salon', 'barber', 'barbershop', 'uốn tóc', 'nhuộm tóc'
      ]);
      if (matchedSpa) {
        return {
          qualified: false,
          leadQuality: 'rejected',
          qualityBadge: 'Spa/Thẩm mỹ',
          category: 'beauty_spa',
          matchedTerm: matchedSpa.term,
          reason: `Ngành Spa / Thẩm mỹ / Salon tóc / Nail: "${matchedSpa.term}"`
        };
      }
    }

    if (excludeUnsupported) {
      const matchedIndustry = findMatchedNegativeEntity(post.authorName, post.content, entities.unsupportedIndustries);
      if (matchedIndustry) {
        return {
          qualified: false,
          leadQuality: 'rejected',
          qualityBadge: 'Loại trừ',
          category: 'unsupported_industry',
          matchedTerm: matchedIndustry.term,
          reason: `Ngành hàng loại trừ: "${matchedIndustry.term}"`
        };
      }
    }

    // 4. Spam / Scam / MLM / Online Jobs Check (Hard Drop for illegal/scam spam)
    const matchedSpam = findMatchedNegativeEntity(post.authorName, post.content, entities.spamKeywords);
    if (matchedSpam) {
      return {
        qualified: false,
        leadQuality: 'rejected',
        qualityBadge: 'Spam',
        category: 'spam_job',
        matchedTerm: matchedSpam.term,
        reason: `Bài tuyển dụng đa cấp / việc làm online: "${matchedSpam.term}"`
      };
    }

    // 5. Phone Type / Mobile-Only Check (If post has extracted phones and requireMobileOnly is true)
    if (requireMobileOnly && Array.isArray(post.phones) && post.phones.length > 0) {
      const hasAnyMobile = post.phones.some(p => classifyPhoneType(p) === 'mobile');
      if (!hasAnyMobile) {
        return {
          qualified: false,
          leadQuality: 'rejected',
          qualityBadge: 'Số cố định',
          category: 'non_mobile_phone',
          matchedTerm: post.phones.join(', '),
          reason: `Danh sách SĐT không có số di động cá nhân (chỉ có số cố định/tổng đài): [${post.phones.join(', ')}]`
        };
      }
    }

    return {
      qualified: true,
      leadQuality: 'high',
      qualityBadge: 'Tiềm năng cao',
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
