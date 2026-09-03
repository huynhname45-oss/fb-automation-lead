import test from 'node:test';
import assert from 'node:assert/strict';
import leadFilter, { checkForeignLead } from '../../src/core/lead-filter.js';
import aiLeadEvaluator from '../../src/core/ai-lead-evaluator.js';

test('Lead Filter & AI Evaluator: Strictly reject foreign / overseas leads while accepting domestic Vietnamese shops', () => {
  const filterConfig = { excludeUnsupportedIndustries: true };

  // 1. Foreign / Overseas Posts must be strictly REJECTED
  const foreignPosts = [
    {
      authorName: 'Phở Việt Tokyo',
      content: 'Tưng bừng khai trương quán phở tại Shinjuku, Tokyo, Nhật Bản. Mời kiều bào và du học sinh ghé ủng hộ. Giá chỉ 1 sen / bát.',
      phones: ['+818012345678']
    },
    {
      authorName: 'Quán Cơm Seoul',
      content: 'Khai trương quán ăn Việt Nam ở Seoul, Hàn Quốc. Đồ ăn chuẩn vị quê nhà.',
      phones: ['+821012345678']
    },
    {
      authorName: 'Shop Quần Áo Đài Bắc',
      content: 'Mở cửa hàng tại Đài Bắc (Taipei), nhận ship toàn Đài Loan. Thanh toán chuyển khoản tân đài tệ hoặc nhận hàng trả tiền.',
      phones: ['+886912345678']
    },
    {
      authorName: 'Nail Houston TX',
      content: 'Tuyển thợ nail gấp tại Houston, Texas, bao lương 1500 USD / tuần.',
      phones: ['+17145551234']
    },
    {
      authorName: 'Trà Sữa Sydney',
      content: 'Chính thức mở chi nhánh tại Sydney, Úc. Kính mời quý khách.',
      phones: ['+61412345678']
    },
    {
      authorName: 'Shop Quần Áo Tokutei',
      content: 'Tổng kho sỉ quần áo cho du học sinh và tu nghiệp sinh xklđ tại Nhật. Giá từ 2 man.',
      phones: []
    }
  ];

  for (const post of foreignPosts) {
    const foreignCheck = checkForeignLead(post);
    assert.equal(foreignCheck.isForeign, true, `Post from [${post.authorName}] must be detected as foreign`);

    const filterRes = leadFilter.evaluateLead(post, filterConfig);
    assert.equal(filterRes.qualified, false, `Post from [${post.authorName}] must be rejected by LeadFilter`);
    assert.equal(filterRes.category, 'foreign_location');

    const localNLP = aiLeadEvaluator._localNLPEvaluate(post.authorName, post.content, post.phones);
    assert.equal(localNLP.isQualified, false, `Post from [${post.authorName}] must be rejected by Local NLP`);
    assert.equal(localNLP.score, 0);
  }

  // 2. Domestic Vietnamese shops with foreign product styles must be PRESERVED
  const domesticPosts = [
    {
      authorName: 'Café Yolk VN',
      content: 'Ăn sáng với bò Úc, trứng và pate tại cafeyolk VN, Quận 1, TP. Hồ Chí Minh',
      phones: ['0908123456']
    },
    {
      authorName: 'Trà Sữa Đài Loan Cô Ba',
      content: 'Khai trương quán trà sữa chuẩn vị Đài Loan tại Cầu Giấy, Hà Nội. Giảm giá 20%!',
      phones: ['0912345678']
    },
    {
      authorName: 'Shop Mỹ Phẩm Hàn Quốc',
      content: 'Khai trương shop mỹ phẩm Hàn Quốc chính hãng tại Đà Nẵng. Mua 1 tặng 1!',
      phones: ['0988654321']
    },
    {
      authorName: 'Ty Meo Meo',
      content: 'KHAI TRƯƠNG QUÁN NHẬU LẨU CUA ĐỒNG TÝ MEO - Mở tới khi nào anh em hết buồn, ship mọi lúc mọi nơi khi khách hàng có nhu cầu. Đặt bàn: 0966068606',
      phones: ['0966068606', '0964616242']
    }
  ];

  for (const post of domesticPosts) {
    const foreignCheck = checkForeignLead(post);
    assert.equal(foreignCheck.isForeign, false, `Domestic shop [${post.authorName}] must NOT be detected as foreign`);

    const filterRes = leadFilter.evaluateLead(post, filterConfig);
    assert.equal(filterRes.qualified, true, `Domestic shop [${post.authorName}] must be qualified`);

    const localNLP = aiLeadEvaluator._localNLPEvaluate(post.authorName, post.content, post.phones);
    assert.equal(localNLP.isQualified, true, `Domestic shop [${post.authorName}] must be qualified by Local NLP`);
    assert.ok(localNLP.score >= 60, `Domestic shop [${post.authorName}] score must be >= 60`);
  }
});
