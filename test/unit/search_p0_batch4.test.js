import test from 'node:test';
import assert from 'node:assert/strict';

import { 
  getCanonicalAuthorKey, 
  isAuthorCommentMatch 
} from '../../src/core/search-engine.js';

// =========================================================================
// SEARCH-P0-004 Tests: Canonical Author Dedupe Key
// =========================================================================
test('SEARCH-P0-004: getCanonicalAuthorKey distinguishes different users with the same display name', () => {
  const author1 = {
    authorName: 'Quán Cơm Bình Dân',
    profileLink: 'https://www.facebook.com/quan.com.saigon'
  };

  const author2 = {
    authorName: 'Quán Cơm Bình Dân', // Same common name
    profileLink: 'https://www.facebook.com/quan.com.hanoi'
  };

  const key1 = getCanonicalAuthorKey(author1);
  const key2 = getCanonicalAuthorKey(author2);

  // Must NOT be the same key! Different individuals must not block each other
  assert.notEqual(key1, key2);
  assert.equal(key1, 'author_user_quan.com.saigon');
  assert.equal(key2, 'author_user_quan.com.hanoi');
});

test('SEARCH-P0-004: getCanonicalAuthorKey canonicalizes tracking URLs to the same user key', () => {
  const postA = {
    authorName: 'Chery Nguyễn',
    profileLink: 'https://www.facebook.com/chery.nguyen.123?__cft__=abcdef&__tn__=%3C'
  };

  const postB = {
    authorName: 'Chery Nguyễn',
    profileLink: 'https://www.facebook.com/chery.nguyen.123?ref=profile_search'
  };

  const keyA = getCanonicalAuthorKey(postA);
  const keyB = getCanonicalAuthorKey(postB);

  assert.equal(keyA, keyB);
  assert.equal(keyA, 'author_user_chery.nguyen.123');
});

test('SEARCH-P0-004: getCanonicalAuthorKey handles profile.php?id= numeric IDs correctly', () => {
  const postNumeric = {
    authorName: 'Nguyễn Văn A',
    profileLink: 'https://www.facebook.com/profile.php?id=100088997766554&sk=about'
  };

  const key = getCanonicalAuthorKey(postNumeric);
  assert.equal(key, 'author_id_100088997766554');
});

// =========================================================================
// SEARCH-P0-014 Tests: Author Comment Verification (No loose substring match)
// =========================================================================
test('SEARCH-P0-014: isAuthorCommentMatch rejects commenters with partial substring overlap', () => {
  // Target Author is "Lan"
  const targetAuthor = 'Lan';

  // Commenter is "Hương Lan" (should NOT match)
  const isMatch1 = isAuthorCommentMatch({
    commentAuthorName: 'Hương Lan',
    commentText: 'Cho mình xin giá với',
    targetAuthorName: targetAuthor
  });
  assert.equal(isMatch1, false, 'Should not match "Hương Lan" when author is "Lan"');

  // Target Author is "Quán Ăn Ngon Sài Gòn"
  // Commenter is "Sài Gòn Phố" (contains "Sài Gòn", should NOT match)
  const isMatch2 = isAuthorCommentMatch({
    commentAuthorName: 'Sài Gòn Phố',
    commentText: 'Quán đẹp quá',
    targetAuthorName: 'Quán Ăn Ngon Sài Gòn'
  });
  assert.equal(isMatch2, false, 'Should not match substring overlap "Sài Gòn"');
});

test('SEARCH-P0-014: isAuthorCommentMatch accepts exact name match and Author badges only', () => {
  // Exact name match
  const exactMatch = isAuthorCommentMatch({
    commentAuthorName: 'Chery Nguyễn',
    commentText: 'Dạ quán em ở số 10 đường 3/2 ạ, SĐT 0912345678',
    targetAuthorName: 'Chery Nguyễn'
  });
  assert.equal(exactMatch, true);

  // Badge match ("Tác giả" in comment header/badge)
  const badgeMatch = isAuthorCommentMatch({
    commentAuthorName: 'Khác Tên',
    commentText: 'Tác giả: Liên hệ hotline 0988776655',
    targetAuthorName: 'Chủ Quán'
  });
  assert.equal(badgeMatch, true);

  // A pinned comment is not proof that it belongs to the author.
  const pinnedMatch = isAuthorCommentMatch({
    commentAuthorName: 'Admin',
    commentText: 'Đã ghim: Bảng giá menu khai trương',
    targetAuthorName: 'Chủ Quán'
  });
  assert.equal(pinnedMatch, false);
});
