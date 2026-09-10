import test from 'node:test';
import assert from 'node:assert/strict';
import leadFilter, { checkRealEstateLead, isLandmarkContext } from '../../src/core/lead-filter.js';
import aiLeadEvaluator from '../../src/core/ai-lead-evaluator.js';

test('REAL-ESTATE-001: Strictly reject mini apartment openings, room rentals, and property broker posts', async () => {
  const config = {
    excludeEnterpriseChains: true,
    excludeRealEstate: true,
    excludeUnsupportedIndustries: false,
    aiEnabled: false
  };

  // 1. User reported post: HR Linh Khai Trương Chung Cư Mini
  const hrLinhPost = {
    authorName: 'HR Linh',
    groupName: 'PHÒNG TRỌ PHÚ NHUẬN',
    content: `KHAI TRƯƠNG CHUNG CƯ MINI 1PN + 1PK HƠN 50m2 BANCOL CAO CẤP  NGAY KHU ETOWN CỘNG HOÀ - NHA GA T3- VIEW THOÁNG MÁT ✨
📍 PHƯỜNG 13 - TÂN BÌNH
(Gần Quận Tân Phú , Quận 10, Phú Nhuận, Bình Thạnh... gần các tuyến đường lớn thuận tiện di chuyển)
- Nội thất: Tivi, giường, nệm, gối, tủ lạnh, lò bi sóng, máy hút mùi, nước nóng lạnh, bếp từ âm...
- Thuận tiện di chuyển các quận trung tâm như quận 1,3,10, gần bờ kè Hoàng Sa, Tuyến đường Nguyễn Văn Trỗi...
- Căn hộ bancol sang xịn siêu thoáng
- Toà nhà cao cấp, thang máy, full nội thất tiết kiệm điện
- Ngay NHỘN NHỊP NHIỀU TIỆN ÍCH
- Gần các trường đại học Huflit, UEH, Học viện hàng không....
📩 0585.692.129 gặp Linh xem phòng trước 30p`,
    phones: ['0585692129']
  };

  const reCheck = checkRealEstateLead(hrLinhPost);
  assert.equal(reCheck.isRealEstate, true, 'HR Linh post must be recognized as Real Estate');

  const ruleEval = leadFilter.evaluateLead(hrLinhPost, config);
  assert.equal(ruleEval.qualified, false, 'HR Linh post must NOT be qualified');
  assert.equal(ruleEval.leadQuality, 'rejected', 'HR Linh post must have leadQuality rejected');
  assert.equal(ruleEval.category, 'real_estate');

  const aiEval = await aiLeadEvaluator.evaluateLeadWithAI(hrLinhPost, config);
  assert.equal(aiEval.isQualified, false, 'HR Linh post must be rejected by AI evaluator');
  assert.equal(aiEval.score, 0, 'HR Linh post must score 0');
  assert.equal(aiEval.decision, 'REJECTED');

  // 2. Anonymous author post for room rental (No group, no HR author)
  const anonRentalPost = {
    authorName: 'Thu Hằng',
    groupName: '',
    content: 'Khai trương toà nhà căn hộ dịch vụ mới 100%. Phòng 1PN 1PK bancol thoáng mát, giờ giấc tự do, không chung chủ. Cọc 1 tháng, điện 4k nước 100k. Alo xem phòng: 0912345678',
    phones: ['0912345678']
  };

  const anonRuleEval = leadFilter.evaluateLead(anonRentalPost, config);
  assert.equal(anonRuleEval.qualified, false);
  assert.equal(anonRuleEval.leadQuality, 'rejected');

  const anonNlpEval = aiLeadEvaluator._localNLPEvaluate(anonRentalPost.authorName, anonRentalPost.content, anonRentalPost.phones);
  assert.equal(anonNlpEval.isQualified, false);
  assert.equal(anonNlpEval.score, 0);

  // 3. Sa Bàn Vinhomes Real Estate Post
  const saBanPost = {
    authorName: 'Thông Ngô BĐS',
    groupName: '',
    content: 'CHÍNH THỨC KHAI TRƯƠNG SA BÀN VINHOMES HẢI VÂN BAY TẠI TP.HCM. Sáng 06/09 không khí sự kiện bùng nổ... đại đô thị bên vịnh... mở bán dự án đợt 1. Hotline: 0924176176',
    phones: ['0924176176']
  };
  const saBanEval = leadFilter.evaluateLead(saBanPost, config);
  assert.equal(saBanEval.qualified, false);
  assert.equal(saBanEval.leadQuality, 'rejected');
});

test('REAL-ESTATE-002: Preserve authentic SMB shops located at or near apartment buildings (Address Landmark)', async () => {
  const config = {
    excludeEnterpriseChains: true,
    excludeRealEstate: true,
    excludeUnsupportedIndustries: false,
    aiEnabled: false
  };

  // 1. Milk Tea shop located at an apartment building shophouse
  const milkTeaPost = {
    authorName: 'Trà Sữa Miu Miu',
    groupName: '',
    content: `Tưng bừng khai trương Trà Sữa Miu Miu!
Nhân dịp khai trương cơ sở mới, giảm giá 30% toàn bộ menu từ ngày 10/09 đến 15/09.
Địa chỉ: Shophouse SH08, Tầng trệt Chung cư Sunrise City, Quận 7, TP.HCM.
Hotline đặt bàn / giao hàng: 0901234567`,
    phones: ['0901234567']
  };

  const teaCheck = checkRealEstateLead(milkTeaPost);
  assert.equal(teaCheck.isRealEstate, false, 'Shop located in apartment shophouse must not be flagged as real estate');

  const teaRuleEval = leadFilter.evaluateLead(milkTeaPost, config);
  assert.equal(teaRuleEval.qualified, true, 'Authentic milk tea shop must be qualified');
  assert.equal(teaRuleEval.leadQuality, 'high');

  const teaNlpEval = aiLeadEvaluator._localNLPEvaluate(milkTeaPost.authorName, milkTeaPost.content, milkTeaPost.phones);
  assert.equal(teaNlpEval.isQualified, true, 'Authentic milk tea shop must be qualified in Local NLP');
  assert.ok(teaNlpEval.score >= 80, `Expected score >= 80, got ${teaNlpEval.score}`);

  // 2. Broken Rice restaurant opposite an apartment building
  const ricePost = {
    authorName: 'Cơm Tấm Ba Ghiền 2',
    groupName: '',
    content: `Mừng khai trương Quán Cơm Tấm Ba Ghiền cơ sở 2!
Địa chỉ: Đối diện chung cư Sky9, đường Đỗ Xuân Hợp, Quận 9, TP.HCM.
Giảm 20% các món cơm sườn bì chả nhân dịp khai trương quán.
Liên hệ: 0938112233`,
    phones: ['0938112233']
  };

  const riceCheck = checkRealEstateLead(ricePost);
  assert.equal(riceCheck.isRealEstate, false, 'Restaurant opposite apartment landmark must not be flagged as real estate');

  const riceRuleEval = leadFilter.evaluateLead(ricePost, config);
  assert.equal(riceRuleEval.qualified, true);
  assert.equal(riceRuleEval.leadQuality, 'high');
});
