import { test } from 'node:test';
import assert from 'node:assert';
import {
  isGitAvailable,
  checkUpdateStatus,
  isSystemBusy,
  getUpdateProgress
} from '../src/core/update-manager.js';
import searchEngine from '../src/core/search-engine.js';
import memberScanner from '../src/core/member-scanner.js';

test('UPDATE-001: isGitAvailable detects git repo correctly', async () => {
  const res = await isGitAvailable();
  assert.strictEqual(res.available, true, 'Git repo should be detected in project directory');
});

test('UPDATE-002: checkUpdateStatus returns structured version info', async () => {
  const status = await checkUpdateStatus(true);
  assert.strictEqual(status.supported, true);
  assert.ok(status.currentCommit);
  assert.ok(typeof status.currentCommit.sha === 'string');
  assert.ok(typeof status.hasUpdate === 'boolean');
  assert.ok(typeof status.isBusy === 'boolean');
  assert.ok(typeof status.isUpdating === 'boolean');
});

test('UPDATE-003: isSystemBusy accurately detects active search and scanning tasks', () => {
  // Test idle state
  const originalSearchStatus = searchEngine.status;
  searchEngine.status = 'idle';
  const idleCheck = isSystemBusy();
  assert.strictEqual(idleCheck.isBusy, false);

  // Test busy search state
  searchEngine.status = 'searching';
  const busySearchCheck = isSystemBusy();
  assert.strictEqual(busySearchCheck.isBusy, true);
  assert.ok(busySearchCheck.activeTasks.includes('Tìm kiếm chính'));

  // Revert search status
  searchEngine.status = originalSearchStatus;

  // Test busy member scanner state
  memberScanner.activeScans.set('test_client', { isScanning: true });
  const busyScanCheck = isSystemBusy();
  assert.strictEqual(busyScanCheck.isBusy, true);
  assert.ok(busyScanCheck.activeTasks.some(t => t.includes('Quét thành viên')));

  // Clean up
  memberScanner.activeScans.delete('test_client');
  const cleanCheck = isSystemBusy();
  assert.strictEqual(cleanCheck.isBusy, false);
});

test('UPDATE-004: getUpdateProgress returns initial idle state', () => {
  const progress = getUpdateProgress();
  assert.strictEqual(progress.isUpdating, false);
  assert.strictEqual(progress.step, 'idle');
});

test('UPDATE-005: getLastUpdateNotice reads and parses notice file correctly', async () => {
  const { getLastUpdateNotice } = await import('../src/core/update-manager.js');
  const fs = await import('node:fs/promises');
  const fsSync = await import('node:fs');
  const path = await import('node:path');

  const noticePath = path.join(process.cwd(), 'data', 'last_update_notice.json');
  const backup = fsSync.existsSync(noticePath) ? await fs.readFile(noticePath, 'utf8') : null;

  try {
    const mockNotice = {
      noticeId: 'update_test_12345',
      updatedAt: new Date().toISOString(),
      commitSha: 'a1b2c3d',
      commitMsg: 'feat: test update notice',
      commitDate: '10/09/2026 14:00',
      version: '1.0.2'
    };

    const dataDir = path.dirname(noticePath);
    if (!fsSync.existsSync(dataDir)) {
      fsSync.mkdirSync(dataDir, { recursive: true });
    }
    await fs.writeFile(noticePath, JSON.stringify(mockNotice), 'utf8');

    const notice = await getLastUpdateNotice();
    assert.ok(notice, 'Notice should be parsed successfully');
    assert.strictEqual(notice.noticeId, 'update_test_12345');
    assert.strictEqual(notice.commitSha, 'a1b2c3d');

    const status = await checkUpdateStatus(false);
    assert.ok(status.lastUpdateNotice, 'checkUpdateStatus should return lastUpdateNotice');
    assert.strictEqual(status.lastUpdateNotice.noticeId, 'update_test_12345');
  } finally {
    if (backup !== null) {
      await fs.writeFile(noticePath, backup, 'utf8');
    } else if (fsSync.existsSync(noticePath)) {
      await fs.unlink(noticePath);
    }
  }
});

