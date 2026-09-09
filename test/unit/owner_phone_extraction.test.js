import test from 'node:test';
import assert from 'node:assert/strict';
import { 
  extractPhonesFromText, 
  isJobApplicantComment, 
  decodeVietnameseWordsToPhone,
  mergePhoneEvidence
} from '../../src/core/phone-validator.js';
import { 
  isAuthorOrOwnerCommentMatch,
  isAuthorCommentMatch 
} from '../../src/core/search-engine.js';

// =========================================================================
// TEST SUITE: AUTHENTIC OWNER PHONE EXTRACTION (SĐT ĐÚNG CHÍNH CHỦ)
// =========================================================================

test('OWNER-PHONE-001: Grace Tran comment extracts 0903033337 accurately', () => {
  const commentText = 'Anh chị xin tuyển liên lạc zalo trực tiếp anh chủ giúp nhé ạ 090.303.3337 anh khánh đang chờ tin ạ';
  const phones = extractPhonesFromText(commentText);
  assert.equal(phones.length, 1);
  assert.equal(phones[0], '0903033337');
});

test('OWNER-PHONE-002: isAuthorOrOwnerCommentMatch accepts Grace Tran comment as owner referral and author match', () => {
  // Case A: Author match
  const matchAuthor = isAuthorOrOwnerCommentMatch({
    commentAuthorName: 'Grace Tran',
    commentText: 'Anh chị xin tuyển liên lạc zalo trực tiếp anh chủ giúp nhé ạ 090.303.3337 anh khánh đang chờ tin ạ',
    targetAuthorName: 'Grace Tran'
  });
  assert.equal(matchAuthor.isMatch, true);
  assert.equal(matchAuthor.reason, 'author_direct');

  // Case B: Author name missing (e.g. avatar only in group), but comment contains explicit owner referral
  const matchReferral = isAuthorOrOwnerCommentMatch({
    commentAuthorName: '',
    commentText: 'Anh chị xin tuyển liên lạc zalo trực tiếp anh chủ giúp nhé ạ 090.303.3337 anh khánh đang chờ tin ạ',
    targetAuthorName: 'Grace Tran'
  });
  assert.equal(matchReferral.isMatch, true);
  assert.equal(matchReferral.reason, 'owner_referral');
});

test('OWNER-PHONE-003: isJobApplicantComment strictly rejects candidate job seekers', () => {
  const applicantComments = [
    'Em xin ứng tuyển vị trí phụ bếp sđt 0918112233',
    'Em tìm việc sđt 0909876543',
    'Cháu xin làm ca sáng sđt 0912345678',
    'Mình xin chân chạy bàn sđt 0903334455',
    'E muốn xin việc ạ 0901112233',
    'Đã nt zalo cho quán ạ',
    'Cho em xin 1 vé thử việc với ạ'
  ];

  for (const comment of applicantComments) {
    assert.equal(isJobApplicantComment(comment), true, `Should detect applicant: "${comment}"`);
    const match = isAuthorOrOwnerCommentMatch({
      commentAuthorName: 'Người Ứng Tuyển',
      commentText: comment,
      targetAuthorName: 'Grace Tran'
    });
    assert.equal(match.isMatch, false, `Should reject applicant comment: "${comment}"`);
  }
});

test('OWNER-PHONE-004: Preserves and extracts phone numbers from Zalo and WhatsApp URLs', () => {
  const zaloUrlPost = 'Mọi thông tin xin liên hệ Zalo: https://zalo.me/0903033337 để trao đổi chi tiết';
  const zaloPhones = extractPhonesFromText(zaloUrlPost);
  assert.ok(zaloPhones.includes('0903033337'), 'Should extract phone from https://zalo.me URL');

  const waUrlPost = 'Đặt bàn trực tiếp qua https://wa.me/84903033337 hoặc hotline';
  const waPhones = extractPhonesFromText(waUrlPost);
  assert.ok(waPhones.includes('0903033337'), 'Should extract phone from https://wa.me URL');

  const shortZalo = 'Inbox zalo.me/0777424679';
  const shortPhones = extractPhonesFromText(shortZalo);
  assert.ok(shortPhones.includes('0777424679'), 'Should extract phone from short zalo.me link');
});

test('OWNER-PHONE-005: Decodes Vietnamese verbal numbers accurately', () => {
  const verbal1 = 'Zalo: không chín không ba không ba ba ba ba bảy';
  const phones1 = extractPhonesFromText(verbal1);
  assert.ok(phones1.includes('0903033337'), 'Should decode pure Vietnamese words into phone');

  const mixed = 'Liên hệ: 0 9 0 ba 0 3 3 3 ba 7 nhé';
  const phonesMixed = extractPhonesFromText(mixed);
  assert.ok(phonesMixed.includes('0903033337'), 'Should decode mixed numbers and Vietnamese words');
});

test('OWNER-PHONE-006: Merges post_comment phone evidence with verified status', () => {
  let evidence = [];
  const metadata = {
    sourceUrl: 'https://facebook.com/groups/123/posts/456',
    authorMatched: true,
    minConfidence: 0.8
  };

  evidence = mergePhoneEvidence(
    evidence,
    [{ phone: '0903033337', verified: true, authorMatched: true }],
    'post_comment',
    0.98,
    'SĐT từ bình luận chính chủ của bài viết',
    metadata
  );

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].phone, '0903033337');
  assert.equal(evidence[0].verified, true);
  assert.equal(evidence[0].source, 'post_comment');
  assert.ok(evidence[0].confidence >= 0.95);
});
