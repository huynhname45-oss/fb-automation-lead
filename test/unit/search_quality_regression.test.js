import test from 'node:test';
import assert from 'node:assert/strict';

import { processResults } from '../../src/core/data-processor.js';
import { createReviewRecord, isPhoneExplicitlyContactLabeled } from '../../src/core/search-engine.js';

test('quality regression: persistence retains phone proof and decision fields', () => {
  const [result] = processResults([{
    authorName: 'Quán Mộc',
    location: '—',
    content: 'Khai trương quán cơm tại Quận 1',
    postedTime: '2 giờ',
    postLink: 'https://www.facebook.com/example/posts/1',
    profileLink: 'https://www.facebook.com/example',
    phones: ['0912345678'],
    verifiedPhones: [],
    phoneEvidence: [{ phone: '0912345678', verified: false, source: 'image_ocr' }],
    decision: 'REVIEW',
    decisionReasons: ['AI_REVIEW'],
    authorKey: 'author_user_example',
    locationSource: 'content',
    locationConfidence: 0.9,
    timeStatus: 'unknown',
    timeConfidence: 0
  }]);

  assert.equal(result.decision, 'REVIEW');
  assert.deepEqual(result.verifiedPhones, []);
  assert.equal(result.phoneEvidence[0].source, 'image_ocr');
  assert.equal(result.location, 'TP. Hồ Chí Minh');
});

test('quality regression: uncertain time becomes a review item, not a silently lost post', () => {
  const review = createReviewRecord({
    post: {
      authorName: 'Tiệm Bánh A',
      content: 'Sắp khai trương',
      feedTimeText: '',
      postLink: 'https://www.facebook.com/example/posts/2'
    },
    authorKey: 'author_user_bakery',
    reasonCode: 'TIME_UNKNOWN',
    timeResult: { status: 'unknown', confidence: 0 },
    locationResult: { province: '—', source: 'unknown', confidence: 0, evidence: [] }
  });

  assert.equal(review.decision, 'REVIEW');
  assert.equal(review.status, 'Cần kiểm tra');
  assert.deepEqual(review.decisionReasons, ['TIME_UNKNOWN']);
});

test('quality regression: a contact label must be adjacent to the number before ownership is asserted', () => {
  assert.equal(
    isPhoneExplicitlyContactLabeled('Liên hệ Zalo 0912 345 678 để đặt bàn', '0912345678'),
    true
  );
  assert.equal(
    isPhoneExplicitlyContactLabeled('Bài viết nhắc số 0912 345 678 của đối tác giao hàng', '0912345678'),
    false
  );
});
