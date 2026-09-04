import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPostMetadataFromAnchors } from '../../src/core/search-engine.js';
import { extractLocationDetailed } from '../../src/core/location-extractor.js';
import { extractPhonesFromText } from '../../src/core/phone-validator.js';

test('SEARCH-GROUP-001: Correctly extracts author, groupName, and postLink from Facebook Group post', () => {
  // Simulating anchor elements from the real Facebook group post in media_1788487021745.png:
  // "CHỢ CÁI TẮC HẬU GIANG · Tham gia"
  // "Hủ Tiếu Nam Vang Cái Tắc · 9 giờ · 🌐"
  const simulatedAnchors = [
    {
      text: 'CHỢ CÁI TẮC HẬU GIANG',
      href: 'https://www.facebook.com/groups/1010375836262947/?ref=share',
      aria: 'CHỢ CÁI TẮC HẬU GIANG'
    },
    {
      text: 'Tham gia',
      href: '#',
      aria: 'Tham gia nhóm'
    },
    {
      text: 'Hủ Tiếu Nam Vang Cái Tắc',
      href: 'https://www.facebook.com/groups/1010375836262947/user/100085432924155/?__cft__[0]=AZ...',
      aria: 'Hủ Tiếu Nam Vang Cái Tắc'
    },
    {
      text: '9 giờ',
      href: 'https://www.facebook.com/groups/1010375836262947/posts/123456789012345/?__cft__[0]=AZ...',
      aria: '9 giờ trước'
    },
    {
      text: '',
      href: 'https://www.facebook.com/photo/?fbid=2600221167063336&set=pcb.2600227207062732',
      aria: 'Ảnh của Hủ Tiếu'
    }
  ];

  const meta = extractPostMetadataFromAnchors(simulatedAnchors);

  // Assertions
  assert.equal(meta.authorName, 'Hủ Tiếu Nam Vang Cái Tắc', 'Author name should be correctly extracted from group post');
  assert.equal(meta.groupName, 'CHỢ CÁI TẮC HẬU GIANG', 'Group name should be extracted');
  assert.equal(meta.groupLink, 'https://www.facebook.com/groups/1010375836262947/?ref=share');
  assert.equal(meta.profileLink, 'https://www.facebook.com/profile.php?id=100085432924155', 'Numeric user id in group should be canonicalized to direct profile link');
  assert.equal(meta.postLink, 'https://www.facebook.com/groups/1010375836262947/posts/123456789012345/?__cft__[0]=AZ...');
});

test('SEARCH-GROUP-002: Author with SVG badge or Messenger icon is not rejected as nav icon', () => {
  const simulatedAnchors = [
    {
      text: 'Bánh Cuốn Nóng Lĩnh Dương\nNhắn tin',
      href: 'https://www.facebook.com/profile.php?id=100063548291024',
      aria: 'Bánh Cuốn Nóng Lĩnh Dương'
    },
    {
      text: '2 giờ',
      href: 'https://www.facebook.com/100063548291024/posts/9988776655/',
      aria: '2 giờ trước'
    }
  ];

  const meta = extractPostMetadataFromAnchors(simulatedAnchors);
  assert.equal(meta.authorName, 'Bánh Cuốn Nóng Lĩnh Dương');
  assert.equal(meta.profileLink, 'https://www.facebook.com/profile.php?id=100063548291024');
  assert.equal(meta.postLink, 'https://www.facebook.com/100063548291024/posts/9988776655/');
});

test('SEARCH-GROUP-003: Group post content and groupName automatically infers provincial location', () => {
  const postContent = `🎉🎉 TƯNG BỪNG KHAI TRƯƠNG – MUA 5 TẶNG 1 🎉🎉
🍀❤️🍲 HỦ TIẾU GÕ 15K 🍲❤️🍀
🔥 Khai trương tưng bừng – ưu đãi cực hấp dẫn!
👉 MUA 5 TÔ – TẶNG NGAY 1 TÔ 🎁
🍲 Hủ tiếu gõ 15k
🥩 Hủ tiếu xương 20k-30k
🥩 Hủ tiếu thập cẩm 35k-40k
🌸🌸 E ship từ 5 phần trở lên🌸🌸
☎️☎️ 0833.460.600 Ẩn bớt`;

  const groupName = 'CHỢ CÁI TẮC HẬU GIANG';

  // Test phone extraction
  const phones = extractPhonesFromText(postContent);
  assert.ok(phones.includes('0833460600'), 'Phone 0833460600 must be extracted from post body');

  // Test location deduction using groupName
  const locResult = extractLocationDetailed({
    content: postContent + `\nNhóm: ${groupName}`,
    authorName: 'Hủ Tiếu Nam Vang Cái Tắc'
  });

  assert.equal(locResult.legacyProvince, 'Hậu Giang', 'legacyProvince should accurately be Hậu Giang from groupName');
  assert.equal(locResult.province, 'Cần Thơ', 'Province maps to Cần Thơ per canonical regional grouping');
  assert.ok(locResult.confidence >= 0.75, 'Confidence should be high enough to display');
});

test('SEARCH-GROUP-004: Standard personal/page post without group works seamlessly', () => {
  const simulatedAnchors = [
    {
      text: 'Trần Tâm (Kebab Ngon)',
      href: 'https://www.facebook.com/trantam.kebab',
      aria: 'Trần Tâm'
    },
    {
      text: '5 giờ',
      href: 'https://www.facebook.com/trantam.kebab/posts/pfbid02XYZ',
      aria: '5 giờ trước'
    }
  ];

  const meta = extractPostMetadataFromAnchors(simulatedAnchors);
  assert.equal(meta.authorName, 'Trần Tâm (Kebab Ngon)');
  assert.equal(meta.groupName, '');
  assert.equal(meta.profileLink, 'https://www.facebook.com/trantam.kebab');
  assert.equal(meta.postLink, 'https://www.facebook.com/trantam.kebab/posts/pfbid02XYZ');
});
