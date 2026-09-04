import test from 'node:test';
import assert from 'node:assert/strict';
import leadFilter, { checkEventGiftServiceLead } from '../../src/core/lead-filter.js';
import aiLeadEvaluator from '../../src/core/ai-lead-evaluator.js';

test('Lead Filter & Local NLP: Strictly reject fruit gift baskets, wedding decor, invitation printing, and floristry', async (t) => {
  const rejectedPosts = [
    {
      title: 'Hồng Yume (Giỏ quà trái cây nhập khẩu)',
      authorName: 'Hồng Yume',
      content: 'GIỎ QUÀ TRÁI CÂY NHẬP KHẨU - MÓN QUÀ CỦA SỰ TINH TẾ. Trao trọn yêu thương - Gửi ngàn lời chúc tốt đẹp. Một món quà vừa đẹp mắt, vừa ý nghĩa cho những dịp đặc biệt: Biếu đối tác - Tặng khách hàng - Thăm hỏi - Sinh nhật - Khai trương. Hotline: 0379.502.325',
      phones: ['0379502325']
    },
    {
      title: 'Hoài Ngân Decor (Trang trí gia tiên, tiệc cưới, khai trương)',
      authorName: 'Nguyễn Hoài Ngân',
      content: 'Một lời hứa, một cái nắm tay, một đời bên nhau. Lễ Tân Hôn: Thanh Tùng & Thanh Thảo. Decor by team: HOÀI NGÂN DECOR. Chuyên trang trí gia tiên, tiệc cưới, sinh nhật, khai trương và Mâm Quả Cưới Hỏi. Hotline: 0325944224',
      phones: ['0325944224']
    },
    {
      title: 'Hoa Trà Florals (Đào tạo học viên, hoa viếng, hoa khai trương, mâm quả)',
      authorName: 'Hoa Trà Florals',
      content: 'ĐAO TẠO HỌC VIEN - HOA TRA FLORALS - FLOWER & WEDDING. Hotline: 036.5254.539. Mâm quả cưới hỏi Rồng-Phụng, Quả Dạm Ngõ, Hoa viếng. Hoa hội nghị.Hoa Khai Trương, Giỏ trái cây, Hoa cưới.Trang trí xe hoa, bàn gia tiên, Hoa tươi - Hoa sáp, Bó Hoa - Giỏ Hoa',
      phones: ['0365254539']
    },
    {
      title: 'Pinky Fruit (Giỏ trái cây cao đầy sang trọng biếu khai trương)',
      authorName: 'Pinky Fruit - Giỏ quà trái cây Nhập Khẩu TP.HCM',
      content: 'GIỎ TRÁI CÂY CAO ĐẦY – SANG TRỌNG TỪ ÁNH NHÌN ĐẦU TIÊN. Từng loại trái cây được lựa chọn và phối màu hài hòa... phù hợp cho nhiều dịp như sinh nhật, chúc mừng, khai trương, tân gia, thăm hỏi...',
      phones: ['0909123456']
    },
    {
      title: 'In Ấn Đức Dương (In thiệp mời, phong bì, kẹp file khai trương)',
      authorName: 'In Thiệp mời - Phong bì - Kẹp file',
      content: 'IN THIỆP MỜI – PHONG BÌ – KẸP FILE THEO YÊU CẦU. In Ấn Đức Dương nhận: In thiệp mời sự kiện, khai trương, hội nghị. In phong bì thư doanh nghiệp. Hotline: 0979008304',
      phones: ['0979008304']
    },
    {
      title: 'HT & fruits (Giỏ trái cây quà tặng khai trương)',
      authorName: 'HT & fruits',
      content: 'GIỎ TRÁI CÂY NHẬP KHẨU – MÓN QUÀ NHỎ, TÌNH CẢM LỚN. Có thể dùng để biếu bố mẹ, thăm người thân, tặng đối tác, khách hàng, khai trương, sinh nhật... Đặt giỏ: 0383 127 193',
      phones: ['0383127193']
    }
  ];

  for (const post of rejectedPosts) {
    // 1. checkEventGiftServiceLead directly
    const directCheck = checkEventGiftServiceLead(post);
    assert.equal(directCheck.isEventGiftService, true, `Expected checkEventGiftServiceLead to flag: ${post.title}`);

    // 2. evaluateLead (deterministic rule filter)
    const ruleEval = leadFilter.evaluateLead(post, { excludeUnsupportedIndustries: true });
    assert.equal(ruleEval.qualified, false, `Expected leadFilter to reject: ${post.title}`);

    // 3. Local NLP Fallback
    const localEval = aiLeadEvaluator._localNLPEvaluate(post.authorName, post.content, post.phones);
    assert.equal(localEval.isQualified, false, `Expected Local NLP to reject: ${post.title}`);
    assert.equal(localEval.score, 0, `Expected Local NLP score to be 0 for: ${post.title}`);
  }

  // 4. Legitimate SMB store openings must remain QUALIFIED
  const legitimatePost = {
    authorName: 'Trà Sữa KOI Thé Quận 1',
    content: 'TƯNG BỪNG KHAI TRƯƠNG QUÁN TRÀ SỮA & CÀ PHÊ MỚI TẠI 45 LÊ LỢI, QUẬN 1! Giảm 30% toàn bộ menu từ ngày 10/10. Mời cả nhà ghé thưởng thức nhé. Hotline đặt bàn/giao hàng: 0912345678',
    phones: ['0912345678']
  };

  const legitRuleEval = leadFilter.evaluateLead(legitimatePost, {
    excludeEnterpriseChains: false,
    excludeUnsupportedIndustries: true
  });
  assert.equal(legitRuleEval.qualified, true, 'Legitimate SMB store opening should be qualified by leadFilter');

  const legitLocalEval = aiLeadEvaluator._localNLPEvaluate(legitimatePost.authorName, legitimatePost.content, legitimatePost.phones);
  assert.equal(legitLocalEval.isQualified, true, 'Legitimate SMB store opening should be qualified by Local NLP');
  assert.ok(legitLocalEval.score >= 75, 'Legitimate SMB store opening should have high score');
});
