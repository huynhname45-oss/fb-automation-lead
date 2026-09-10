import test from 'node:test';
import assert from 'node:assert/strict';
import leadFilter, { checkMediaEsportsGossipLead } from '../../src/core/lead-filter.js';
import aiLeadEvaluator from '../../src/core/ai-lead-evaluator.js';

test('Lead Filter & AI Evaluator: Strictly reject Esports / Fanpage / Meme / Showbiz / Gossip leads while accepting genuine SMB grand openings', () => {
  const filterConfig = {};

  // 1. Esports, Gaming Fanpages, Meme Channels, Pro Player News must be REJECTED (Score = 0, leadQuality = rejected)
  const junkMediaPosts = [
    {
      authorName: 'Sở Thú Nhà T1',
      content: `Doran và mẹ của tuyển thủ Pyosik có gửi cây tới chúc mừng mẹ của Keria khai trương cửa hàng quần áo nè~~~~
“Mong cửa hàng sẽ luôn dồi dào may mắn và kinh doanh thật tốt!”
-T1 Doran-
“Mừng khai trương cửa hàng mới nhé!”
-Mẹ của Pyosik-
————————————
@w.zizii
@zjyun95`
    },
    {
      authorName: 'Beatvn Esports',
      content: 'Faker và đồng đội T1 gửi lời chúc mừng khai trương nhà hàng mới của đàn anh Bang tại Seoul.'
    },
    {
      authorName: 'Kênh 14 Showbiz',
      content: 'Dàn sao Hàn nô nức đến chúc mừng tiệc khai trương quán cà phê của diễn viên Lee Min Ho.'
    },
    {
      authorName: 'Hóng Hớt VCS',
      content: 'Tuyển thủ Levi cùng các thành viên GAM gửi quà chúc mừng người anh em khai trương cơ sở mới.'
    },
    {
      authorName: 'Gen.G Fanclub Vietnam',
      content: 'Chovy gửi lẵng hoa chúc mừng khai trương trung tâm đào tạo tuyển thủ trẻ.'
    }
  ];

  for (const post of junkMediaPosts) {
    const mediaCheck = checkMediaEsportsGossipLead(post);
    assert.equal(mediaCheck.isMediaEsports, true, `Post from [${post.authorName}] must be identified as Media/Esports`);

    const filterRes = leadFilter.evaluateLead(post, filterConfig);
    assert.equal(filterRes.qualified, false, `Post from [${post.authorName}] must be rejected by LeadFilter`);
    assert.equal(filterRes.leadQuality, 'rejected', `Post from [${post.authorName}] must have leadQuality rejected`);

    const localNLP = aiLeadEvaluator._localNLPEvaluate(post.authorName, post.content, []);
    assert.equal(localNLP.isQualified, false, `Post from [${post.authorName}] must be rejected by Local NLP`);
    assert.equal(localNLP.score, 0, `Post from [${post.authorName}] must receive 0 score`);
  }

  // 2. Genuine SMB grand openings (both specific category and generic retail/F&B) must be ACCEPTED with high score
  const authenticSmbPosts = [
    {
      authorName: 'Quán Ốc Bé Ba',
      content: 'Mừng khai trương chi nhánh 2 tại 45 Nguyễn Huệ. Ngày mai 10/9 chính thức lên đèn đón khách! Giảm 20% menu. Hotline: 0912345678',
      phones: ['0912345678']
    },
    {
      authorName: 'Tiệm Bánh Mì Cô Năm',
      content: 'Tưng bừng khai trương tiệm bánh mì chảo tại số 88 Cầu Giấy, mua 1 phần tặng 1 ly trà tắc! Kính mời bà con ghé ủng hộ quán em nha.',
      phones: ['0985123456']
    },
    {
      authorName: 'Shop Mẹ & Bé Baby Care',
      content: 'Chính thức mở cửa đón khách tại cơ sở mới! Giảm giá 15% tất cả bỉm tã sữa và quần áo trẻ em. Đón chào các mẹ ghé thăm!',
      phones: ['0909123456']
    },
    {
      authorName: 'Trà Sữa Cây Si',
      content: 'Sau bao ngày chờ đợi, ngày mai quán chúng mình chính thức mở bán! Mua 1 tặng 1 toàn bộ menu đồ uống trong tuần lễ khai trương.',
      phones: ['0977112233']
    },
    {
      authorName: 'Cơ Sở 2 - Tiệm Ăn Vặt Tuổi Thơ',
      content: 'Thông báo khai trương cơ sở mới tại số 12 Lê Lợi. Giảm ngay 20% cho hóa đơn từ 100k. Rất hân hạnh được phục vụ quý khách!',
      phones: ['0933445566']
    }
  ];

  for (const post of authenticSmbPosts) {
    const mediaCheck = checkMediaEsportsGossipLead(post);
    assert.equal(mediaCheck.isMediaEsports, false, `Authentic post from [${post.authorName}] must NOT be Media/Esports`);

    const filterRes = leadFilter.evaluateLead(post, filterConfig);
    assert.equal(filterRes.qualified, true, `Authentic post from [${post.authorName}] must be qualified`);
    assert.equal(filterRes.leadQuality, 'high', `Authentic post from [${post.authorName}] must have high leadQuality`);

    const localNLP = aiLeadEvaluator._localNLPEvaluate(post.authorName, post.content, post.phones);
    assert.equal(localNLP.isQualified, true, `Authentic post from [${post.authorName}] must be qualified by Local NLP`);
    assert.ok(localNLP.score >= 80, `Authentic post from [${post.authorName}] score must be >= 80 (got ${localNLP.score})`);
  }
});
