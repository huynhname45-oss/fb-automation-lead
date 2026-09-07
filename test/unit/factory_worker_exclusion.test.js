import test from 'node:test';
import assert from 'node:assert/strict';
import leadFilter from '../../src/core/lead-filter.js';
import aiLeadEvaluator from '../../src/core/ai-lead-evaluator.js';

test('Factory, Industrial Zone & Worker Recruitment Exclusion', async () => {
  const longKhaiPost = {
    authorName: 'Công ty CP Long Khải - Chi nhánh Đà Nẵng',
    content: 'CÔNG TY CỔ PHẦN LONG KHẢI TUYỂN DỤNG\n📍 Địa điểm làm việc: Lô 16 KCN Đà Nẵng (KCN An Đồn - Sơn Trà)\n🏭 Công việc: Sản xuất bít tất xuất khẩu sang Mỹ & Canada\n⏰ Thời gian: 8h00 - 16h30, giờ hành chính\n👤 Số lượng: 20 người\n👤 Đối tượng: Nam/Nữ từ 18 tuổi trở lên\n💰 Có hỗ trợ tiền thuê nhà 600.000đ/tháng cho người ngoại tỉnh\n🏢 Môi trường làm việc sạch, mát, có cơm trưa\n📑 Công việc ổn định, đầy đủ chế độ\n📞 Hotline/Zalo: 0919.188.051',
    phones: ['0919188051']
  };

  const eval1 = leadFilter.evaluateLead(longKhaiPost);
  assert.equal(eval1.qualified, false, 'Long Khai factory post must be rejected by leadFilter');

  const localEval = aiLeadEvaluator._localNLPEvaluate(longKhaiPost.authorName, longKhaiPost.content, longKhaiPost.phones);
  assert.equal(localEval.isQualified, false, 'Long Khai factory post must be rejected by _localNLPEvaluate');

  const factory2 = {
    authorName: 'Xưởng May Gia Công Phú Tài',
    content: 'Xưởng may gia công hàng xuất khẩu cần tuyển 50 công nhân may công nghiệp, đứng máy may 1 kim, bao cơm trưa, liên hệ 0905112233',
    phones: ['0905112233']
  };
  const eval2 = leadFilter.evaluateLead(factory2);
  assert.equal(eval2.qualified, false, 'Garment factory recruitment must be rejected');

  const validShop = {
    authorName: 'Quán Cơm Tấm Sài Gòn',
    content: 'Quán Cơm Tấm Sài Gòn chi nhánh 2 chuẩn bị khai trương, giảm 20% các món cơm sườn, cơm bì chả, hotline 0905123456',
    phones: ['0905123456']
  };
  const evalShop = leadFilter.evaluateLead(validShop);
  assert.equal(evalShop.qualified, true, 'Valid F&B restaurant must be accepted');
});
