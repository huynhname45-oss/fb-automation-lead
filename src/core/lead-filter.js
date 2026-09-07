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
export const LANDMARK_PREFIX_REGEX = /(?:địa\s*chỉ|đ\/c|dc|address|vị\s*trí|vi\s*tri|toạ\s*độ|tại|tai|ở|o|ngay|ngay\s*cổng|ngay\s*chân|đối\s*diện|doi\s*dien|doi\s*dien\s*cong|đối\s*diện\s*cổng|gần|gan|gần\s*cổng|gan\s*cong|cạnh|canh|kế\s*bên|ke\s*ben|kế|ke|sát\s*bên|sat\s*ben|sát|sat|cách|cach|sau\s*lưng|sau\s*lung|sau|trước\s*mặt|truoc\s*mat|trước|truoc|bên\s*hông|ben\s*hong|bên\s*cạnh|ben\s*canh|hướng\s*đi|huong\s*di|hướng\s*về|huong\s*ve|đoạn|doan|ngã\s*[345ba|tư|tu|năm|nam]|nga\s*[345ba|tu|nam]|vòng\s*xoay|vong\s*xoay|bùng\s*binh|bung\s*binh|chân\s*cầu|chan\s*cau|dưới\s*chân|duoi\s*chan|shophouse|tầng\s*trệt|tang\s*tret|khu\s*đô\s*thị|khu\s*do\s*thi|chung\s*cư|chung\s*cu|toà\s*nhà|tòa\s*nhà|toa\s*nha)\s*(?:của|ở|tại|phía|bên)?\s*(?:nhà\s*thuốc|siêu\s*thị|cửa\s*hàng|chi\s*nhánh|toà\s*nhà|tòa\s*nhà|toa\s*nha|chung\s*cư|chung\s*cu|dự\s*án|du\s*an|khu\s*đô\s*thị|khu\s*do\s*thi|trung\s*tâm|tttm|chợ|bệnh\s*viện|trường|cổng)?\s*$/i;

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
  /\b(?:thái\s*lan|bangkok|chiang\s*mai|phnom\s*penh|siem\s*reap|campuchia|vientiane|viêng\s*chăn|kuala\s*lumpur|singapore|taipei|taichung|kaohsiung|đài\s*bắc|đài\s*trung|đài\s*nam|cao\s*hùng|tokyo|osaka|nagoya|fukuoka|saitama|chiba|hokkaido|okinawa|seoul|busan|incheon|california|houston|sydney|melbourne|brisbane|vancouver|toronto)\b/i,

  // Đối tượng / thị trường / cộng đồng nước ngoài & xuất khẩu
  /\b(?:du học sinh|xklđ|xuất khẩu lao động|tu nghiệp sinh|tokutei|định cư|kiều bào|việt kiều)\s+(?:nhật|hàn|đài|mỹ|úc|canada|âu|đức|anh)/i,
  /(?:xuất\s*khẩu|xuat\s*khau|ship|gửi|gui|order|đơn\s*đi)\s+(?:sang|đi|cho|vào)\s+(?:mỹ|my|usa|canada|nhật|nhat|hàn|han|đài\s*loan|dai\s*loan|châu\s*âu|chau\s*au|úc|uc)/iu,
  /\b(?:ship toàn đài loan|ship toàn nhật|ship toàn hàn|ship us|order us|order uk|ship quốc tế)\b/i,
  /\b(?:tân đài tệ|đài tệ|tiền đài)\b/i,
  /(?:\b\d+[\d,.]*\s*(?:baht|bath|usd|dollar|đô|euro|eur|sgd|rmb|cny|tệ|jpy|yen|yên|krw|won|ntd|tân\s*đài\s*tệ|aud|cad|khr|riel|lak|kip|rub|bảng\s*anh|gbp|man|sen)\b|\$\s*\d+)/i
];

// Patterns detecting celebratory / guest / attendee congratulatory posts (NOT the business owner)
export const CONGRATULATORY_PATTERNS = [
  /(?:^|[\s,;:.!?-])(?:chúc|chuc)\s+(?:\d+\s+)?(?:thầy|cô|bạn|anh|chị|em|cháu|bác|chú|dì|mẹ|ba|sếp|người anh|người em|con bạn|thằng bạn|mấy đứa|hai bạn|2 bạn|hai đứa|2 đứa|hai anh|2 anh|hai chị|2 chị|hai thầy|2 thầy|quán|team)[^\n.!?]{0,50}(?:khai trương|khai truong|hồng phát|hong phat|đại thắng|thành công|mua may bán đắt|bội thu)/iu,
  /(?:^|[\s,;:.!?-])(?:chúc mừng|chuc mung)\s+(?:khai trương|khai truong)/iu,
  /(?:khai trương|khai truong)\s+(?:hồng phát|hong phat|đại thắng|thành công|may mắn)/iu,
  /(?:^|[\s,;:.!?-])(?:dự lễ|tham dự lễ|đi ăn|đi tiệc|ăn tiệc|đi chúc mừng|đến chúc mừng|qua chúc mừng)\s+(?:lễ\s+)?khai trương/iu,
  /(?:^|[\s,;:.!?-])(?:chung vui|đến chung vui|góp mặt)\s+(?:cùng|với)?[^\n.!?]{0,30}(?:khai trương|sinh nhật)/iu,
  /(?:kỷ niệm|sinh nhật)\s+lần\s+thứ\s+\d+/iu
];

export function checkCongratulatoryLead(post = {}) {
  const content = `${post.content || ''}`.normalize('NFKC');
  for (const regex of CONGRATULATORY_PATTERNS) {
    const m = content.match(regex);
    if (m) {
      return { isCongratulatory: true, reason: `Lời chúc mừng của khách: "${m[0].trim()}"` };
    }
  }
  return { isCongratulatory: false };
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

  // 3. Dịch vụ hoa: hoa khai trương, kệ hoa, lẵng hoa, giỏ hoa, hoa viếng, hoa sáp, đào tạo cắm hoa
  /(?:^|[\s,;:.!?-])(?:hoa\s*khai\s*trương|hoa\s*khai\s*truong|kệ\s*hoa|ke\s*hoa|lẵng\s*hoa|lang\s*hoa|giỏ\s*hoa|gio\s*hoa|bó\s*hoa|bo\s*hoa)(?:[\s,;:.!?-]|$)/iu,
  /(?:^|[\s,;:.!?-])(?:hoa\s*viếng|hoa\s*vieng|hoa\s*chia\s*buồn|hoa\s*chia\s*buon|hoa\s*sáp|hoa\s*sap|hoa\s*tiền|hoa\s*tien|hoa\s*hội\s*nghị|hoa\s*hoi\s*nghi)(?:[\s,;:.!?-]|$)/iu,
  /(?:^|[\s,;:.!?-])(?:đào\s*tạo\s*học\s*viên|dao\s*tao\s*hoc\s*vien|dạy\s*cắm\s*hoa|day\s*cam\s*hoa|học\s*cắm\s*hoa|hoc\s*cam\s*hoa)/iu,
  /(?:^|[\s,;:.!?-])(?:shop\s*hoa|tiệm\s*hoa|tiem\s*hoa)\s+(?:tươi|tuoi|sáp|sap)?(?:[\s,;:.!?-]|$)/iu,

  // 4. In thiệp mời, phong bì, kẹp file, ấn phẩm sự kiện
  /(?:^|[\s,;:.!?-])(?:in|in\s*ấn)\s+(?:thiệp\s*mời|thiep\s*moi|thiệp\s*cưới|thiep\s*cuoi|phong\s*bì|phong\s*bi|kẹp\s*file|kep\s*file|voucher|tờ\s*rơi|to\s*roi|ấn\s*phẩm|an\s*pham)/iu,
  /(?:^|[\s,;:.!?-])in\s+thiệp\s+mời\s+(?:sự\s+kiện|khai\s+trương|hội\s+nghị)/iu
];

export function checkEventGiftServiceLead(post = {}) {
  const rawText = `${post.authorName || ''} ${post.content || ''}`.normalize('NFKC');
  for (const regex of EVENT_GIFT_SERVICES_PATTERNS) {
    const m = rawText.match(regex);
    if (m) {
      return { isEventGiftService: true, reason: `Dịch vụ quà tặng / giỏ quả / hoa / decor / in ấn sự kiện: "${m[0].trim()}"` };
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

  const rawText = `${post.authorName || ''} ${post.content || ''} ${post.location || ''}`;
  if (!rawText.trim()) return { isForeign: false };

  // 2. Check foreign patterns
  for (const regex of FOREIGN_PATTERNS) {
    const m = rawText.match(regex);
    if (m) {
      // Exclude food/product origin phrases like "bò úc", "thịt bò mỹ", "trà sữa đài loan", "lẩu thái", "trà thái"
      const matched = m[0].trim();
      if (/(?:bò|thịt|nho|táo|cam|sữa|trà\s*sữa|mỹ\s*phẩm|đồ|hàng|tiêu\s*chuẩn|phong\s*cách)\s+(?:úc|mỹ|nhật|hàn|đài)/i.test(matched)) {
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
        category: 'foreign_location',
        matchedTerm: foreignCheck.reason,
        reason: `Khách hàng / Cửa hàng ở NƯỚC NGOÀI (${foreignCheck.reason}), không thuộc phạm vi triển khai POS tại Việt Nam.`
      };
    }

    // 0.5. Guest / Congratulatory Post Check (Khách mời / Bạn bè chúc mừng khai trương)
    const congratCheck = checkCongratulatoryLead(post);
    if (congratCheck.isCongratulatory) {
      return {
        qualified: false,
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
        category: 'industrial_manufacturing',
        matchedTerm: industrialCheck.reason,
        reason: `Cơ sở sản xuất / Nhà máy / Khu công nghiệp / Lao động phổ thông (${industrialCheck.reason}), không phải cửa hàng F&B/Bán lẻ SMB.`
      };
    }

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
      const matchedChain = findMatchedNegativeEntity(post.authorName, post.content, entities.enterpriseChains);
      if (matchedChain) {
        return {
          qualified: false,
          category: 'enterprise_chain',
          matchedTerm: matchedChain.term,
          reason: `Chuỗi lớn / Doanh nghiệp quy mô lớn: "${matchedChain.term}"`
        };
      }
    }

    // 2. POS Software Competitor & Sale Seeding Check
    if (excludeCompetitors) {
      const matchedCompetitor = findMatchedNegativeEntity(post.authorName, post.content, entities.posCompetitors);
      if (matchedCompetitor) {
        return {
          qualified: false,
          category: 'pos_competitor',
          matchedTerm: matchedCompetitor.term,
          reason: `Đối thủ phần mềm POS / Bài bán hàng đối thủ: "${matchedCompetitor.term}"`
        };
      }
    }

    // 3. Unsupported Industry Check (Hotel, Resort, Real Estate, Hospitals, Gifts, Event Decor, Florals, Printing...)
    if (excludeUnsupported) {
      const eventGiftCheck = checkEventGiftServiceLead(post);
      if (eventGiftCheck.isEventGiftService) {
        return {
          qualified: false,
          category: 'event_gift_service',
          matchedTerm: eventGiftCheck.reason,
          reason: `Dịch vụ phụ trợ / Giỏ quà / Hoa sự kiện / Decor / In ấn (${eventGiftCheck.reason}), không phải cơ sở kinh doanh SMB mở mới.`
        };
      }

      const matchedIndustry = findMatchedNegativeEntity(post.authorName, post.content, entities.unsupportedIndustries);
      if (matchedIndustry) {
        return {
          qualified: false,
          category: 'unsupported_industry',
          matchedTerm: matchedIndustry.term,
          reason: `Ngành hàng không phù hợp với POS SMB: "${matchedIndustry.term}"`
        };
      }
    }

    // 4. Spam / Scam / MLM / Online Jobs Check
    const matchedSpam = findMatchedNegativeEntity(post.authorName, post.content, entities.spamKeywords);
    if (matchedSpam) {
      return {
        qualified: false,
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
