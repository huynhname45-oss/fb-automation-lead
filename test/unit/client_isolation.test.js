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

test('Session Isolation: sessionManager isolates client sessions in RAM and never leaks to server or disk', async () => {
  const fs = await import('fs');
  const path = await import('path');
  const { default: sessionManager } = await import('../../src/core/session-manager.js');

  const clientMac = 'client_mac_' + Date.now();
  const clientWin = 'client_win_' + Date.now();

  // Server default status must be 'none'
  const serverStatus = sessionManager.getStatus('default');
  assert.equal(serverStatus.status, 'none');
  assert.equal(serverStatus.user, null);

  // Client Mac sets session in memory
  sessionManager.clientSessions.set(clientMac, {
    status: 'active',
    user: { id: '111111', name: 'Hoàng Luận' },
    lastChecked: Date.now()
  });

  // Client Win sets different session in memory
  sessionManager.clientSessions.set(clientWin, {
    status: 'active',
    user: { id: '222222', name: 'Nguyễn Văn A' },
    lastChecked: Date.now()
  });

  // Client Mac sees only its own session
  const statusMac = sessionManager.getStatus(clientMac);
  assert.equal(statusMac.status, 'active');
  assert.equal(statusMac.user.name, 'Hoàng Luận');
  assert.equal(statusMac.user.id, '111111');

  // Client Win sees only its own session
  const statusWin = sessionManager.getStatus(clientWin);
  assert.equal(statusWin.status, 'active');
  assert.equal(statusWin.user.name, 'Nguyễn Văn A');
  assert.equal(statusWin.user.id, '222222');

  // Server itself still sees 'none'
  const serverCheck = sessionManager.getStatus('server');
  assert.equal(serverCheck.status, 'none');
  assert.equal(serverCheck.user, null);

  // Verify server disk does NOT have facebook.json or account_info.json
  const sessionFilePath = path.join(process.cwd(), 'session', 'facebook.json');
  const accountFilePath = path.join(process.cwd(), 'session', 'account_info.json');
  assert.equal(fs.existsSync(sessionFilePath), false, 'Server disk must not contain facebook.json');
  assert.equal(fs.existsSync(accountFilePath), false, 'Server disk must not contain account_info.json');

  // Logging out Mac client only removes Mac client
  await sessionManager.logout(clientMac);
  assert.equal(sessionManager.getStatus(clientMac).status, 'none');
  assert.equal(sessionManager.getStatus(clientWin).status, 'active');
  assert.equal(sessionManager.getStatus(clientWin).user.name, 'Nguyễn Văn A');

  // Clean up
  await sessionManager.logout(clientWin);
});
