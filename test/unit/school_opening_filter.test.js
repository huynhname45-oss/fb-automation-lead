import test from 'node:test';
import assert from 'node:assert/strict';
import leadFilter from '../../src/core/lead-filter.js';
import aiLeadEvaluator from '../../src/core/ai-lead-evaluator.js';

test('Lead Filter & AI Evaluator: Strictly reject school, kindergarten and academic opening posts while accepting store grand openings', () => {
  const filterConfig = { excludeUnsupportedIndustries: true };

  // 1. School & Academic Opening posts must be REJECTED
  const schoolPosts = [
    {
      authorName: 'Hai Ban',
      content: 'Hai Ban đã thêm ảnh vào album: Mầm non Hải Nam — đang cảm thấy đáng yêu.\nMùa khai trường'
    },
    {
      authorName: 'Tuyết Lưu',
      content: 'Đơn Khai Trường 2026-2027\nTập thể lớp America 2 Chúc mừng khai giảng năm học 2026 2027'
    },
    {
      authorName: 'Trường Đại học Công nghệ Thông tin - Đại học Quốc gia TP.HCM',
      content: 'UIT ĐÃ SẴN SÀNG CHO LỄ KHAI GIẢNG NĂM HỌC 2026 - 2027!\nLễ Khai giảng năm học 2026 - 2027'
    },
    {
      authorName: 'Shop In Biển',
      content: 'Nhận in phông khai giảng và bảng tên khai giảng cho các trường tiểu học năm học mới'
    }
  ];

  for (const post of schoolPosts) {
    const filterRes = leadFilter.evaluateLead(post, filterConfig);
    assert.equal(filterRes.qualified, false, `Post from [${post.authorName}] must be rejected by LeadFilter`);

    const localNLP = aiLeadEvaluator._localNLPEvaluate(post.authorName, post.content, []);
    assert.equal(localNLP.isQualified, false, `Post from [${post.authorName}] must be rejected by Local NLP`);
    assert.equal(localNLP.score, 0, `Post from [${post.authorName}] must receive 0 score`);
  }

  // 2. Real Store Grand Openings must be ACCEPTED (no false positives due to "khai trương" vs "khai trường")
  const storePosts = [
    {
      authorName: 'Café Yolk VN',
      content: 'Tưng bừng khai trương quán Café Yolk VN tại TP.HCM. Kính mời quý khách ghé thưởng thức cà phê và đồ ăn sáng với bò Úc, trứng và pate!'
    },
    {
      authorName: 'Shop Thời Trang Mèo Con',
      content: 'Mừng khai trương cơ sở mới, giảm giá 30% toàn bộ váy đầm và phụ kiện thời trang nữ!'
    },
    {
      authorName: 'Trà Sữa Đô Đô',
      content: 'Chính thức mở cửa khai trương chi nhánh thứ 3. Mua 1 tặng 1 trong 3 ngày đầu!'
    }
  ];

  for (const post of storePosts) {
    const filterRes = leadFilter.evaluateLead(post, filterConfig);
    assert.equal(filterRes.qualified, true, `Store opening post from [${post.authorName}] must be accepted by LeadFilter`);

    const localNLP = aiLeadEvaluator._localNLPEvaluate(post.authorName, post.content, []);
    assert.equal(localNLP.isQualified, true, `Store opening post from [${post.authorName}] must be accepted by Local NLP`);
    assert.ok(localNLP.score >= 80, `Store opening post from [${post.authorName}] must have score >= 80`);
  }
});
