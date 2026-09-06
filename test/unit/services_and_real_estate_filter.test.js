import test from 'node:test';
import assert from 'node:assert/strict';
import leadFilter, { checkForeignLead } from '../../src/core/lead-filter.js';
import aiLeadEvaluator from '../../src/core/ai-lead-evaluator.js';

test('Strictly reject real estate, building openings, sa ban, and unsupported services while accepting Bida and Karaoke', () => {
  const filterConfig = { excludeUnsupportedIndustries: true, excludeEnterpriseChains: true };

  // 1. User sample: Foreign post (Hứa Trương Duy - Thái Lan / Bangkok / 50 baht / vô gia cư)
  const foreignPost = {
    authorName: 'Hứa Trương Duy',
    content: 'ở nước láng giềng Thái Lan chính sách an sinh hỗ trợ người vô gia cư được triển khai, cụ thể Bangkok Baan Im Jai có nghĩa là "Ngôi nhà An vui"... Baan Im Jai, có nghĩa là Ngôi nhà An vui, đã mở cửa vào cuối tháng 2... gửi 50 baht (1,50 USD)...',
    phones: []
  };
  const foreignCheck = checkForeignLead(foreignPost);
  assert.equal(foreignCheck.isForeign, true, 'Must be detected as foreign');
  const foreignLeadRes = leadFilter.evaluateLead(foreignPost, filterConfig);
  assert.equal(foreignLeadRes.qualified, false, 'Must be rejected by LeadFilter');
  const foreignNlpRes = aiLeadEvaluator._localNLPEvaluate(foreignPost.authorName, foreignPost.content, foreignPost.phones);
  assert.equal(foreignNlpRes.isQualified, false, 'Must be rejected by Local NLP');
  assert.equal(foreignNlpRes.score, 0);

  // 2. User sample: Building opening / Sa bàn / Vinhomes (Thông Ngô Vũ Đoàn)
  const buildingPost = {
    authorName: 'Thông Ngô Vũ Đoàn',
    content: 'CHÍNH THỨC KHAI TRƯƠNG SA BÀN VINHOMES HẢI VÂN BAY TẠI TP.HCM. Sáng 06/09, không khí tại sự kiện khai trương sa bàn Vinhomes Hải Vân Bay tại TP.HCM thực sự bùng nổ... đại đô thị bên vịnh đầy tiềm năng... chinh phục những cột mốc doanh số mới... Liên hệ ngay 0924.176.176',
    phones: ['0924176176']
  };
  const buildingLeadRes = leadFilter.evaluateLead(buildingPost, filterConfig);
  assert.equal(buildingLeadRes.qualified, false, 'Sa bàn Vinhomes must be rejected by LeadFilter');
  const buildingNlpRes = aiLeadEvaluator._localNLPEvaluate(buildingPost.authorName, buildingPost.content, buildingPost.phones);
  assert.equal(buildingNlpRes.isQualified, false, 'Sa bàn Vinhomes must be rejected by Local NLP');
  assert.equal(buildingNlpRes.score, 0);

  // 3. Khai trương tòa nhà văn phòng / Cao ốc
  const officeBuildingPost = {
    authorName: 'Tòa Nhà Diamond Plaza',
    content: 'Lễ khai trương tòa nhà văn phòng cho thuê hạng A tại Quận 1. Diện tích sàn văn phòng từ 100m2 đến 1000m2. Hotline: 0912345678',
    phones: ['0912345678']
  };
  const officeLeadRes = leadFilter.evaluateLead(officeBuildingPost, filterConfig);
  assert.equal(officeLeadRes.qualified, false, 'Building opening must be rejected');
  const officeNlpRes = aiLeadEvaluator._localNLPEvaluate(officeBuildingPost.authorName, officeBuildingPost.content, officeBuildingPost.phones);
  assert.equal(officeNlpRes.isQualified, false, 'Building opening must be rejected by Local NLP');

  // 4. Các ngành dịch vụ phải bị loại hết: Gara / Sửa xe, Giặt là, Cắt tóc, Cầm đồ, Thú y, Gym
  const rejectedServices = [
    {
      authorName: 'Gara Ô tô Hoàng Gia',
      content: 'Tưng bừng khai trương Gara sửa chữa ô tô và cứu hộ xe. Giảm 30% thay nhớt và rửa xe. Hotline: 0987654321',
      phones: ['0987654321']
    },
    {
      authorName: 'Tiệm Giặt Sấy Eco',
      content: 'Khai trương tiệm giặt sấy tự động và giặt ủi lấy liền tại Tân Bình. Giá chỉ 20k/mẻ. Alo: 0933112233',
      phones: ['0933112233']
    },
    {
      authorName: 'Barbershop Phong Cách',
      content: 'Khai trương tiệm cắt tóc nam barbershop chi nhánh 2. Giảm 50% uốn nhuộm cắt tóc. SĐT: 0909887766',
      phones: ['0909887766']
    },
    {
      authorName: 'Cầm Đồ Phát Đạt',
      content: 'Khai trương tiệm cầm đồ và hỗ trợ tài chính lãi suất thấp tại Bình Thạnh. LH: 0911223344',
      phones: ['0911223344']
    },
    {
      authorName: 'Phòng Khám Thú Y PetCare',
      content: 'Mừng khai trương phòng khám thú y và dịch vụ spa thú cưng cắt tỉa lông chó mèo. Tel: 0944556677',
      phones: ['0944556677']
    },
    {
      authorName: 'Phòng Gym Titan',
      content: 'Khai trương phòng gym và yoga fitness với trang thiết bị hiện đại. Đăng ký nhận ưu đãi: 0966778899',
      phones: ['0966778899']
    }
  ];

  for (const s of rejectedServices) {
    const leadRes = leadFilter.evaluateLead(s, filterConfig);
    assert.equal(leadRes.qualified, false, `Service [${s.authorName}] must be rejected by LeadFilter`);
    const nlpRes = aiLeadEvaluator._localNLPEvaluate(s.authorName, s.content, s.phones);
    assert.equal(nlpRes.isQualified, false, `Service [${s.authorName}] must be rejected by Local NLP`);
    assert.equal(nlpRes.score, 0);
  }

  // 5. Ngành dịch vụ ĐƯỢC GIỮ LẠI DUY NHẤT: BIDA và KARAOKE
  const acceptedServices = [
    {
      authorName: 'CLB Bida Master',
      content: 'TƯNG BỪNG KHAI TRƯƠNG CLB BIDA MASTER chuẩn quốc tế! 20 bàn bida lỗ carom. Giảm 50% tiền giờ tuần lễ khai trương! Hotline: 0901234567',
      phones: ['0901234567']
    },
    {
      authorName: 'Karaoke Họa Mi',
      content: 'CHÍNH THỨC KHAI TRƯƠNG KARAOKE HỌA MI tại Quận 7. Âm thanh đỉnh cao, phòng hát sang trọng. Đặt phòng liên hệ: 0918765432',
      phones: ['0918765432']
    }
  ];

  for (const s of acceptedServices) {
    const leadRes = leadFilter.evaluateLead(s, filterConfig);
    assert.equal(leadRes.qualified, true, `Service [${s.authorName}] must be accepted by LeadFilter`);
    const nlpRes = aiLeadEvaluator._localNLPEvaluate(s.authorName, s.content, s.phones);
    assert.equal(nlpRes.isQualified, true, `Service [${s.authorName}] must be accepted by Local NLP`);
    assert.ok(nlpRes.score >= 80, 'Must have high score');
    assert.equal(nlpRes.businessType, 'Dịch vụ Giải trí - Bida / Karaoke');
  }

  // 6. F&B and Retail must also be accepted
  const shopPost = {
    authorName: 'Shop Thời Trang Mây',
    content: 'Tưng bừng khai trương shop quần áo váy đầm thiết kế tại 123 Lê Lợi. Giảm giá 30% toàn bộ sản phẩm! Hotline: 0977112233',
    phones: ['0977112233']
  };
  const shopLeadRes = leadFilter.evaluateLead(shopPost, filterConfig);
  assert.equal(shopLeadRes.qualified, true, 'Retail shop must be accepted');

  const restaurantPost = {
    authorName: 'Quán Ốc Bông Hậu',
    content: 'Khai trương quán ốc và hải sản tươi sống tại Quận 4. Tặng ngay dĩa ốc hương xào bơ tỏi cho bàn 4 người. LH: 0933445566',
    phones: ['0933445566']
  };
  const resLeadRes = leadFilter.evaluateLead(restaurantPost, filterConfig);
  assert.equal(resLeadRes.qualified, true, 'Seafood/snail restaurant must be accepted');
});

test('Directional landmarks and Tiệm Trà Sunrise acceptance', () => {
  const filterConfig = {
    excludeUnsupportedIndustries: true,
    excludeEnterpriseChains: true,
    excludePosCompetitors: true,
    requireMobilePhoneOnly: true
  };

  // 1. User sample post: Tiệm Trà Sunrise (https://web.facebook.com/share/p/1GeDC6HCL6/)
  const sunrisePost = {
    authorName: 'Mymy Sun',
    content: `11/9 NÀY – TIỆM TRÀ SUNRISE CHÍNH THỨC KHAI TRƯƠNG! Sau bao ngày chuẩn bị, cuối cùng Tiệm Trà Sunrise cũng sắp được gặp mọi người rồi  Trà trái cây tươi – pha mới từng ly TƯƠI VỊ QUẢ, SÁNG VỊ TRÀ Nhiều món trà trái cây tươi mát, thơm ngon, dễ uống DEAL KHAI TRƯƠNG TRONG 3 NGÀY ĐỒNG GIÁ CHỈ 25K TẶNG THÊM BÁNH TRÁNG Thời gian: 11/9 – 13/9/2026 Mở cửa: 8:00 – 22:00 Địa chỉ: 92 Đường số 1, KDC Phú Hữu, Quận 9 Ngay Nhà thuốc Long Châu – đối diện Chung cư Sky9 Hotline: 0768 947 627 Một chiếc tiệm nhỏ, rất nhiều tâm huyết và đặc biệt là rất mong được đón những vị khách đầu tiên trong ngày khai trương!Hẹn mọi người 11/9 ghé Sunrise nha! #TiemTraSunrise #KhaiTruong #Quan9 #PhuHuu #Sky9 #TraTraiCay #25K #KhaiTruong119`,
    phones: ['0768947627']
  };

  const evalRes = leadFilter.evaluateLead(sunrisePost, filterConfig);
  assert.equal(evalRes.qualified, true, `Tiệm Trà Sunrise must be QUALIFIED, got: ${JSON.stringify(evalRes)}`);

  const nlpRes = aiLeadEvaluator._localNLPEvaluate(sunrisePost.authorName, sunrisePost.content, sunrisePost.phones);
  assert.equal(nlpRes.isQualified, true, 'Tiệm Trà Sunrise must be accepted by Local NLP');
  assert.ok(nlpRes.score >= 80, `Score should be >= 80, got: ${nlpRes.score}`);

  // 2. Unaccented #KhaiTruong or khai truong must NOT collide with "khai trường" (school opening)
  const unaccentedPost = {
    authorName: 'Trà Sữa Mới',
    content: 'Tung bung khai truong quan tra sua moi giam gia 50% #khaitruong hotline 0901234567',
    phones: ['0901234567']
  };
  const unaccentedLead = leadFilter.evaluateLead(unaccentedPost, filterConfig);
  assert.equal(unaccentedLead.qualified, true, 'Unaccented khai truong must not be rejected as khai trường');
});

test('Phonetic and diacritic collision protection (Hiên hải sản quán, bà con cùng, và vợ, cần họ, lên giờ, tấm bé)', () => {
  const filterConfig = {
    excludeUnsupportedIndustries: true,
    excludeEnterpriseChains: true,
    excludePosCompetitors: true,
    requireMobilePhoneOnly: true
  };

  // 1. Hiên hải sản quán (contains "bà con cùng" which previously collided with "con cưng")
  const hienPost = {
    authorName: 'Hiên hải sản quán',
    content: 'CHỈ CÒN VÀI NGÀY NỮA!! HIÊN HẢI SẢN QUÁN CHÍNH THỨC CÓ MẶT. Quý bà con cùng Hiên đếm ngược từng ngày đến khai trương nhé!',
    phones: ['0909123456']
  };
  const hienRes = leadFilter.evaluateLead(hienPost, filterConfig);
  assert.equal(hienRes.qualified, true, `Hiên hải sản quán must be qualified, got: ${JSON.stringify(hienRes)}`);

  // 2. "và vợ tôi phụ việc" must not collide with "vá vỏ"
  const vaVoPost = {
    authorName: 'Quán Cơm Mẹ Nấu',
    content: 'Quán sắp khai trương, có hai vợ chồng và vợ tôi phụ việc',
    phones: ['0912345678']
  };
  assert.equal(leadFilter.evaluateLead(vaVoPost, filterConfig).qualified, true);

  // 3. "cần họ đến chung vui" must not collide with "căn hộ"
  const canHoPost = {
    authorName: 'Lẩu Nướng 99',
    content: 'Quán khai trương cần họ đến chung vui ủng hộ',
    phones: ['0912345678']
  };
  assert.equal(leadFilter.evaluateLead(canHoPost, filterConfig).qualified, true);

  // 4. "lên giờ khai trương" must not collide with "lên giỏ"
  const lenGioPost = {
    authorName: 'Bia Tươi Phố Cổ',
    content: 'Quán lên giờ khai trương đón khách',
    phones: ['0912345678']
  };
  assert.equal(leadFilter.evaluateLead(lenGioPost, filterConfig).qualified, true);

  // 5. "từ lúc tấm bé" must not collide with "tắm bé"
  const tamBePost = {
    authorName: 'Cafe Kỷ Niệm',
    content: 'Từ lúc tấm bé tôi đã ước mơ mở quán cà phê này, hôm nay khai trương',
    phones: ['0912345678']
  };
  assert.equal(leadFilter.evaluateLead(tamBePost, filterConfig).qualified, true);
});


