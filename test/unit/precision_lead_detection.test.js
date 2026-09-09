import test from 'node:test';
import assert from 'node:assert/strict';
import leadFilter, { checkForeignLead, checkCongratulatoryLead, checkEventGiftServiceLead } from '../../src/core/lead-filter.js';
import aiLeadEvaluator from '../../src/core/ai-lead-evaluator.js';
import { extractPhonesFromText } from '../../src/core/phone-validator.js';

test('Lead Detection Precision: Qualified SMB Leads (Student discount, decor, lion dance, flower thanks, university landmark)', () => {
  const filterConfig = {
    excludeEnterpriseChains: true,
    excludePosCompetitors: true,
    excludeUnsupportedIndustries: true
  };

  // 1. Quán cafe/trà sữa giảm giá học sinh, sinh viên
  const studentDiscountPost = {
    authorName: 'Tiệm Trà & Cafe Mùa Hè',
    content: 'Tưng bừng khai trương quán vào ngày 10/09! Giảm giá 20% cho học sinh, sinh viên khi mang theo thẻ. Địa chỉ: 123 Nguyễn Văn Cừ. Hotline: 0987123456',
    phones: ['0987123456']
  };
  const res1 = leadFilter.evaluateLead(studentDiscountPost, filterConfig);
  assert.equal(res1.qualified, true, 'Quán cafe giảm giá sinh viên phải được nhận');
  const nlp1 = aiLeadEvaluator._localNLPEvaluate(studentDiscountPost.authorName, studentDiscountPost.content, studentDiscountPost.phones);
  assert.equal(nlp1.isQualified, true);
  assert.ok(nlp1.score >= 80);

  // 2. Quán ăn không gian decor xinh
  const decorPost = {
    authorName: 'Quán Nướng & Lẩu Chill',
    content: 'Chính thức mở cửa đón khách! Quán không gian decor cực xinh, check-in sống ảo cực đỉnh. Menu nướng lẩu chỉ từ 99k. Kính mời cả nhà ghé ủng hộ. ĐT: 0909876543',
    phones: ['0909876543']
  };
  const res2 = leadFilter.evaluateLead(decorPost, filterConfig);
  assert.equal(res2.qualified, true, 'Quán ăn decor xinh phải được nhận');
  const nlp2 = aiLeadEvaluator._localNLPEvaluate(decorPost.authorName, decorPost.content, decorPost.phones);
  assert.equal(nlp2.isQualified, true);
  assert.ok(nlp2.score >= 80);

  // 3. Khai trương có múa lân
  const lionDancePost = {
    authorName: 'Trà Sữa KOI Mới',
    content: 'Thông báo: 8h30 sáng mai quán khai trương có múa lân sư rồng khai mạc rộn ràng! Mua 1 tặng 1 toàn bộ menu. Đ/c: 45 Lê Lợi. SĐT: 0912345678',
    phones: ['0912345678']
  };
  const res3 = leadFilter.evaluateLead(lionDancePost, filterConfig);
  assert.equal(res3.qualified, true, 'Quán khai trương có múa lân phải được nhận');
  const nlp3 = aiLeadEvaluator._localNLPEvaluate(lionDancePost.authorName, lionDancePost.content, lionDancePost.phones);
  assert.equal(nlp3.isQualified, true);
  assert.ok(nlp3.score >= 80);

  // 4. Quán cảm ơn lẵng hoa tươi chúc mừng khai trương
  const flowerThanksPost = {
    authorName: 'Bún Bò Huế Cô Ba',
    content: 'Quán em xin chân thành cảm ơn lẵng hoa tươi và giỏ hoa của anh chị em đã gửi tặng chúc mừng khai trương hồng phát hôm nay. Kính mời mọi người ghé thưởng thức tô bún bò chuẩn vị. Hotline: 0938112233',
    phones: ['0938112233']
  };
  const congratCheck = checkCongratulatoryLead(flowerThanksPost);
  assert.equal(congratCheck.isCongratulatory, false, 'Quán cảm ơn hoa không phải bài chúc mừng của khách');
  const giftCheck = checkEventGiftServiceLead(flowerThanksPost);
  assert.equal(giftCheck.isEventGiftService, false, 'Quán nhận hoa không phải dịch vụ hoa');
  const res4 = leadFilter.evaluateLead(flowerThanksPost, filterConfig);
  assert.equal(res4.qualified, true, 'Quán cảm ơn hoa khai trương phải được nhận');
  const nlp4 = aiLeadEvaluator._localNLPEvaluate(flowerThanksPost.authorName, flowerThanksPost.content, flowerThanksPost.phones);
  assert.equal(nlp4.isQualified, true);
  assert.ok(nlp4.score >= 80);

  // 5. Địa chỉ đối diện cổng trường đại học
  const uniLandmarkPost = {
    authorName: 'Cơm Tấm Sườn Bì 365',
    content: 'Khai trương quán cơm tấm thơm ngon! Quán nằm đối diện cổng trường Đại học Sư phạm Kỹ thuật, số 1 Võ Văn Ngân, Thủ Đức. Ship tận nơi: 0977889900',
    phones: ['0977889900']
  };
  const res5 = leadFilter.evaluateLead(uniLandmarkPost, filterConfig);
  assert.equal(res5.qualified, true, 'Địa chỉ đối diện trường đại học phải được nhận');
  const nlp5 = aiLeadEvaluator._localNLPEvaluate(uniLandmarkPost.authorName, uniLandmarkPost.content, uniLandmarkPost.phones);
  assert.equal(nlp5.isQualified, true);
  assert.ok(nlp5.score >= 80);
});

test('Lead Detection Precision: Exclude Junk Leads (Overseas, Modern chains, Unsupported services, Factory hiring)', () => {
  const filterConfig = {
    excludeEnterpriseChains: true,
    excludePosCompetitors: true,
    excludeUnsupportedIndustries: true
  };

  // 1. Chuỗi lớn hiện đại (Katinat, Phê La)
  const chainPost = {
    authorName: 'Katinat Saigon Kafe',
    content: 'Katinat tưng bừng khai trương chi nhánh mới tại Aeon Mall Bình Tân. Tặng voucher cho hóa đơn từ 100k.',
    phones: []
  };
  const chainRes = leadFilter.evaluateLead(chainPost, filterConfig);
  assert.equal(chainRes.qualified, false, 'Katinat phải bị loại bỏ');

  // 2. Bài viết nước ngoài kèm Line ID
  const foreignPost = {
    authorName: 'Quán Ăn Việt Tại Tokyo',
    content: 'Khai trương quán phở Việt tại Shin-Okubo, Tokyo, Nhật Bản. Mời bà con kiều bào ghé ủng hộ. Line ID: phoviet, Hotline: 0901234567',
    phones: ['0901234567']
  };
  const foreignRes = leadFilter.evaluateLead(foreignPost, filterConfig);
  assert.equal(foreignRes.qualified, false, 'Quán ở Nhật Bản phải bị loại bỏ');

  // 3. Bài viết trong group nước ngoài
  const overseasGroupPost = {
    authorName: 'Nguyễn Văn Nam',
    groupName: 'Cộng đồng người Việt tại Đài Loan',
    content: 'Chào cả nhà, quán ăn Việt Nam chuẩn bị khai trương tại Đài Trung, tuyển 2 bạn phục vụ bàn.',
    phones: []
  };
  const groupRes = leadFilter.evaluateLead(overseasGroupPost, filterConfig);
  assert.equal(groupRes.qualified, false, 'Bài viết trong group người Việt tại Đài Loan phải bị loại');

  // 4. Dịch vụ múa lân sự kiện (không phải quán mở)
  const lionTroupePost = {
    authorName: 'Đoàn Lân Sư Rồng Hưng Anh Đường',
    content: 'Nhận biểu diễn múa lân khai trương, khánh thành, động thổ tại TP.HCM và Bình Dương. Thuê múa lân gọi ngay: 0933112233',
    phones: ['0933112233']
  };
  const troupeRes = leadFilter.evaluateLead(lionTroupePost, filterConfig);
  assert.equal(troupeRes.qualified, false, 'Đoàn lân sư rồng phải bị loại');

  // 5. Cửa hàng hoa tươi bán hoa khai trương
  const flowerShopPost = {
    authorName: 'Shop Hoa Tươi Sài Gòn',
    content: 'Chuyên cung cấp hoa khai trương, kệ hoa chúc mừng, lẵng hoa giá rẻ giao tận nơi trong 2 giờ. Đặt hoa liên hệ: 0908123456',
    phones: ['0908123456']
  };
  const shopRes = leadFilter.evaluateLead(flowerShopPost, filterConfig);
  assert.equal(shopRes.qualified, false, 'Shop hoa tươi bán hoa khai trương phải bị loại');
});

test('Phone Number Extraction: Robust on emojis, call-to-actions, and social labels', () => {
  // SĐT đi kèm emoji điện thoại
  const t1 = 'Khai trương quán cafe! ☎️ 0901234567 hoặc 📞 0987654322. Ghé ủng hộ nhé.';
  const p1 = extractPhonesFromText(t1);
  assert.deepEqual(p1, ['0901234567', '0987654322']);

  // SĐT sau dấu gạch chéo
  const t2 = 'Tưng bừng mở cửa! Hotline/Zalo: 0912.334.455 để đặt bàn trước.';
  const p2 = extractPhonesFromText(t2);
  assert.deepEqual(p2, ['0912334455']);

  // SĐT chữ O
  const t3 = 'Khai trương tiệm bánh. Liên hệ O938.123.456 để đặt bánh.';
  const p3 = extractPhonesFromText(t3);
  assert.deepEqual(p3, ['0938123456']);

  // SĐT liền sau nhãn
  const t4 = 'Quán bún đậu khai trương. SĐT:0909998877 liên hệ ngay.';
  const p4 = extractPhonesFromText(t4);
  assert.deepEqual(p4, ['0909998877']);

  // SĐT trong bài có chia sẻ bài viết (đảm bảo không bị nuốt mất số)
  const t5 = 'Khách yêu like và chia sẻ bài viết để được giảm giá 30%. Đặt bàn liên hệ hotline: 0933221100!';
  const p5 = extractPhonesFromText(t5);
  assert.deepEqual(p5, ['0933221100']);
});
