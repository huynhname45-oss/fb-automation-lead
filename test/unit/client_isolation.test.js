import test from 'node:test';
import assert from 'node:assert/strict';
import searchEngine from '../../src/core/search-engine.js';
import { processResults } from '../../src/core/data-processor.js';

test('Client Isolation: searchEngine supports separate task results per clientId', async () => {
  const clientA = 'client_mac_test_' + Date.now();
  const clientB = 'client_win_test_' + Date.now();

  // Initially, both clients have empty results
  assert.deepEqual(searchEngine.getResults(clientA), []);
  assert.deepEqual(searchEngine.getResults(clientB), []);

  // Simulate client tasks in memory
  searchEngine.clientTasks.set(clientA, {
    status: 'searching',
    results: [{ key: 'post_1', authorName: 'Shop A' }],
    found: 1,
    total: 10,
    acceptedCount: 1,
    reviewCount: 0,
    rejectedCount: 0,
    keyword: 'bida',
    isStopped: false
  });

  searchEngine.clientTasks.set(clientB, {
    status: 'idle',
    results: [{ key: 'post_2', authorName: 'Shop B' }, { key: 'post_3', authorName: 'Shop C' }],
    found: 2,
    total: 20,
    acceptedCount: 2,
    reviewCount: 0,
    rejectedCount: 1,
    keyword: 'karaoke',
    isStopped: false
  });

  // Client A should only see its own results and progress
  const resultsA = searchEngine.getResults(clientA);
  assert.equal(resultsA.length, 1);
  assert.equal(resultsA[0].authorName, 'Shop A');
  const progressA = searchEngine.getProgress(clientA);
  assert.equal(progressA.keyword, 'bida');
  assert.equal(progressA.found, 1);
  assert.equal(progressA.status, 'searching');

  // Client B should only see its own results and progress
  const resultsB = searchEngine.getResults(clientB);
  assert.equal(resultsB.length, 2);
  assert.equal(resultsB[0].authorName, 'Shop B');
  const progressB = searchEngine.getProgress(clientB);
  assert.equal(progressB.keyword, 'karaoke');
  assert.equal(progressB.found, 2);
  assert.equal(progressB.status, 'idle');

  // Stopping Client A should stop Client A only
  await searchEngine.stop(clientA);
  assert.equal(searchEngine.clientTasks.get(clientA).isStopped, true);
  assert.equal(searchEngine.clientTasks.get(clientA).status, 'stopped');
  assert.equal(searchEngine.clientTasks.get(clientB).isStopped, false);

  // Clean up
  searchEngine.clientTasks.delete(clientA);
  searchEngine.clientTasks.delete(clientB);
});

test('Data Processor: processResults preserves unique key and id', async () => {
  const sample = [
    {
      key: 'fbid_123456789',
      id: 'fbid_123456789',
      authorName: 'Quán Lẩu Nướng',
      location: 'Hà Nội',
      content: 'Khai trương quán lẩu nướng mới 0912345678',
      postedTime: '2 giờ',
      postLink: 'https://www.facebook.com/quanlaunuong/posts/123456789',
      profileLink: 'https://www.facebook.com/quanlaunuong',
      phones: ['0912345678'],
      verifiedPhones: ['0912345678'],
      status: 'Mới tạo'
    }
  ];

  const processed = processResults(sample);
  assert.equal(processed.length, 1);
  assert.equal(processed[0].key, 'fbid_123456789');
  assert.equal(processed[0].id, 'fbid_123456789');
});
