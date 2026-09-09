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
