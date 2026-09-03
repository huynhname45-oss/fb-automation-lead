import test from 'node:test';
import assert from 'node:assert/strict';
import leadFilter, { checkCongratulatoryLead } from '../../src/core/lead-filter.js';
import aiLeadEvaluator from '../../src/core/ai-lead-evaluator.js';

test('Lead Filter & AI Evaluator: Strictly reject guest / attendee congratulatory opening posts while accepting store grand openings', () => {
  const filterConfig = {};

  // 1. Guest / Attendee Congratulatory Posts must be REJECTED
  const guestPosts = [
    {
      authorName: 'Nguyen Thi Quyen',
      content: 'Chúc 2 thầy Phạm Ngọc Hải Thái Phương khai trương HỒNG PHÁT 🥂🎉\n#heuwedding #10nam #sinhnhatlanthu10'
    },
    {
      authorName: 'Mai Phương',
      content: 'Chúc mừng khai trương quán trà sữa của em gái yêu, chúc em buôn may bán đắt và luôn đông khách nhé!'
    },
    {
      authorName: 'Tuấn Trần',
      content: 'Hôm nay dẫn cả nhà đi ăn tiệc khai trương quán ốc của bạn thân, đồ ăn tươi ngon phục vụ nhiệt tình.'
    },
    {
      authorName: 'Hoàng Long',
      content: 'Chúc anh chị khai trương hồng phát, phát tài phát lộc nha!'
    },
    {
      authorName: 'Kim Oanh',
      content: 'Đến chung vui cùng bạn thân nhân dịp sinh nhật lần thứ 10 của công ty.'
    }
  ];

  for (const post of guestPosts) {
    const check = checkCongratulatoryLead(post);
    assert.equal(check.isCongratulatory, true, `Post from [${post.authorName}] must be detected as congratulatory`);

    const filterRes = leadFilter.evaluateLead(post, filterConfig);
    assert.equal(filterRes.qualified, false, `Post from [${post.authorName}] must be rejected by LeadFilter`);
    assert.equal(filterRes.category, 'guest_congratulations');

    const localNLP = aiLeadEvaluator._localNLPEvaluate(post.authorName, post.content, []);
    assert.equal(localNLP.isQualified, false, `Post from [${post.authorName}] must be rejected by Local NLP`);
    assert.equal(localNLP.score, 0, `Post from [${post.authorName}] must receive 0 score`);
  }

  // 2. Real Store Grand Openings by the owner must be ACCEPTED
  const storePosts = [
    {
      authorName: 'Quán Nhậu Lẩu Cua Đồng Tý Meo',
      content: '🎉 KHAI TRƯƠNG QUÁN NHẬU LẨU CUA ĐỒNG TÝ MEO - Anh em ơi quán chính thức mở cửa ngày 5/9, giảm giá 10% bill trên 1 triệu. Đặt bàn: 0966068606'
    },
    {
      authorName: 'Bánh Cuốn Lĩnh Dương',
      content: 'KHAI TRƯƠNG BÁNH CUỐN LĨNH DƯƠNG - Chính thức khai trương vào ngày 04/09 tại Gốc Gạo – Tân Hợp! Bánh cuốn nóng tráng tại chỗ!'
    },
    {
      authorName: 'Cơm Tấm Sài Gòn',
      content: 'Tưng bừng khai trương quán cơm tấm tại 123 Nguyễn Huệ, giảm 20% cho 100 khách đầu tiên!'
    }
  ];

  for (const post of storePosts) {
    const check = checkCongratulatoryLead(post);
    assert.equal(check.isCongratulatory, false, `Store post from [${post.authorName}] must NOT be detected as congratulatory`);

    const filterRes = leadFilter.evaluateLead(post, filterConfig);
    assert.equal(filterRes.qualified, true, `Store opening post from [${post.authorName}] must be accepted by LeadFilter`);

    const localNLP = aiLeadEvaluator._localNLPEvaluate(post.authorName, post.content, ['0966068606']);
    assert.equal(localNLP.isQualified, true, `Store opening post from [${post.authorName}] must be accepted by Local NLP`);
    assert.ok(localNLP.score >= 80, `Store opening post from [${post.authorName}] must have score >= 80`);
  }
});
