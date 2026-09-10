import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import logger from './logger.js';
import searchEngine from './search-engine.js';
import memberScanner from './member-scanner.js';
import browserManager from './browser-manager.js';

const execAsync = promisify(exec);
const CWD = process.cwd();
const CONFIG_FILE = path.join(CWD, 'config.json');
const RESTART_FLAG_FILE = path.join(CWD, '.restart_flag');
const UPDATER_BAT_FILE = path.join(CWD, 'updater_restart.bat');
const LAST_UPDATE_NOTICE_FILE = path.join(CWD, 'data', 'last_update_notice.json');

/**
 * Đọc thông báo cập nhật thành công mới nhất cho toàn bộ client
 */
export async function getLastUpdateNotice() {
  try {
    if (fsSync.existsSync(LAST_UPDATE_NOTICE_FILE)) {
      const raw = await fs.readFile(LAST_UPDATE_NOTICE_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (data && data.updatedAt && (Date.now() - new Date(data.updatedAt).getTime() < 7 * 24 * 60 * 60 * 1000)) {
        return data;
      }
    }
  } catch (e) {
    logger.debug({ err: e.message }, 'Không thể đọc last_update_notice.json');
  }
  return null;
}

let isUpdating = false;
let updateProgress = {
  step: 'idle', // idle | checking | pulling | dependencies | restarting | error
  message: '',
  progress: 0,
  error: null
};

// Cache git check status for 3 minutes to prevent hammering Git
let cachedGitStatus = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 3 * 60 * 1000;

/**
 * Execute command with timeout and error handling
 */
async function runCommand(cmd, options = {}) {
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: CWD,
      timeout: options.timeout || 15000,
      windowsHide: true,
      env: { ...process.env, LANG: 'en_US.UTF-8' }
    });
    return { success: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    return { success: false, error: err.message, stdout: err.stdout ? err.stdout.trim() : '', stderr: err.stderr ? err.stderr.trim() : '' };
  }
}

/**
 * Kiểm tra xem Git repository có hợp lệ và sẵn sàng hay không
 */
export async function isGitAvailable() {
  if (!fsSync.existsSync(path.join(CWD, '.git'))) {
    return { available: false, reason: 'Thư mục không phải là Git repository (.git không tồn tại).' };
  }
  const res = await runCommand('git --version');
  if (!res.success) {
    return { available: false, reason: 'Git không được tìm thấy trong PATH hệ thống.' };
  }
  return { available: true };
}

/**
 * Kiểm tra xem hệ thống có đang bận chạy tác vụ cào dữ liệu nào không
 */
export function isSystemBusy() {
  const activeTasks = [];

  // 1. Kiểm tra searchEngine (default)
  if (['searching', 'processing', 'initializing'].includes(searchEngine.status)) {
    activeTasks.push('Tìm kiếm chính');
  }

  // 2. Kiểm tra searchEngine (các client isolated)
  if (searchEngine.clientTasks instanceof Map) {
    for (const [clientId, task] of searchEngine.clientTasks.entries()) {
      if (task && ['searching', 'processing', 'initializing'].includes(task.status)) {
        activeTasks.push(`Tìm kiếm (${clientId})`);
      }
    }
  }

  // 3. Kiểm tra memberScanner
  if (memberScanner.activeScans instanceof Map) {
    for (const [clientId, scan] of memberScanner.activeScans.entries()) {
      if (scan && scan.isScanning) {
        activeTasks.push(`Quét thành viên (${clientId})`);
      }
    }
  }

  // 4. Kiểm tra browserManager active contexts
  const hasClientContexts = browserManager.clientContexts && browserManager.clientContexts.size > 0;
  if ((browserManager.context !== null || hasClientContexts) && activeTasks.length === 0) {
    activeTasks.push('Trình duyệt Playwright đang mở');
  }

  return {
    isBusy: activeTasks.length > 0,
    activeTasks,
    details: activeTasks.length > 0 ? `Đang chạy: ${activeTasks.join(', ')}` : 'Hệ thống đang rảnh'
  };
}

/**
 * Dừng khẩn cấp toàn bộ các tác vụ đang chạy
 */
export async function stopAllTasks() {
  logger.info('🛑 Dừng khẩn cấp tất cả tác vụ để chuẩn bị cập nhật...');
  try {
    await searchEngine.stop('default');
  } catch (e) {
    logger.warn({ err: e.message }, 'Lỗi khi dừng searchEngine default');
  }

  if (searchEngine.clientTasks instanceof Map) {
    for (const clientId of searchEngine.clientTasks.keys()) {
      try {
        await searchEngine.stop(clientId);
      } catch (e) {
        logger.warn({ err: e.message, clientId }, 'Lỗi khi dừng searchEngine client');
      }
    }
  }

  if (memberScanner.activeScans instanceof Map) {
    for (const clientId of memberScanner.activeScans.keys()) {
      try {
        memberScanner.stopScan(clientId);
      } catch (e) {
        logger.warn({ err: e.message, clientId }, 'Lỗi khi dừng memberScanner');
      }
    }
  }

  try {
    await browserManager.closeBrowser();
  } catch (e) {
    logger.warn({ err: e.message }, 'Lỗi khi đóng browserManager');
  }
}

/**
 * Kiểm tra trạng thái cập nhật từ Git (Remote vs Local)
 */
export async function checkUpdateStatus(force = false) {
  const now = Date.now();
  if (!force && cachedGitStatus && (now - lastCacheTime < CACHE_TTL_MS)) {
    const busyCheck = isSystemBusy();
    const lastUpdateNotice = await getLastUpdateNotice();
    return {
      ...cachedGitStatus,
      lastUpdateNotice,
      isBusy: busyCheck.isBusy,
      busyDetails: busyCheck.details,
      activeTasks: busyCheck.activeTasks,
      isUpdating
    };
  }

  const gitCheck = await isGitAvailable();
  if (!gitCheck.available) {
    const lastUpdateNotice = await getLastUpdateNotice();
    return {
      supported: false,
      reason: gitCheck.reason,
      hasUpdate: false,
      isBusy: false,
      isUpdating,
      lastUpdateNotice
    };
  }

  // 1. Lấy thông tin commit cục bộ (Local HEAD)
  const localShaRes = await runCommand('git rev-parse HEAD');
  const localSha = localShaRes.success ? localShaRes.stdout.substring(0, 7) : 'unknown';
  const fullLocalSha = localShaRes.success ? localShaRes.stdout : '';

  const localLogRes = await runCommand('git log -1 --pretty=format:"%s||%cd" --date=format:"%d/%m/%Y %H:%M"');
  let localMessage = 'Không xác định';
  let localDate = '—';
  if (localLogRes.success && localLogRes.stdout) {
    const parts = localLogRes.stdout.split('||');
    localMessage = parts[0] || '';
    localDate = parts[1] || '—';
  }

  // 2. Fetch origin main ngầm để lấy thông tin mới nhất từ remote
  const fetchRes = await runCommand('git fetch origin main', { timeout: 20000 });
  if (!fetchRes.success) {
    logger.warn({ err: fetchRes.error }, 'Không thể fetch origin main');
    const busyCheck = isSystemBusy();
    const lastUpdateNotice = await getLastUpdateNotice();
    return {
      supported: true,
      hasUpdate: false,
      fetchError: 'Không thể kết nối tới Git server để kiểm tra bản mới.',
      currentCommit: { sha: localSha, message: localMessage, date: localDate },
      remoteCommit: null,
      lastUpdateNotice,
      isBusy: busyCheck.isBusy,
      busyDetails: busyCheck.details,
      activeTasks: busyCheck.activeTasks,
      isUpdating,
      lastChecked: new Date().toISOString()
    };
  }

  // 3. Lấy thông tin commit remote origin/main
  const remoteShaRes = await runCommand('git rev-parse origin/main');
  const remoteSha = remoteShaRes.success ? remoteShaRes.stdout.substring(0, 7) : 'unknown';
  const fullRemoteSha = remoteShaRes.success ? remoteShaRes.stdout : '';

  const remoteLogRes = await runCommand('git log -1 --pretty=format:"%s||%cd" --date=format:"%d/%m/%Y %H:%M" origin/main');
  let remoteMessage = 'Bản cập nhật mới';
  let remoteDate = '—';
  if (remoteLogRes.success && remoteLogRes.stdout) {
    const parts = remoteLogRes.stdout.split('||');
    remoteMessage = parts[0] || '';
    remoteDate = parts[1] || '—';
  }

  // 4. Đếm số commits remote đang đi trước local
  const countBehindRes = await runCommand('git rev-list --count HEAD..origin/main');
  const behindCount = countBehindRes.success ? parseInt(countBehindRes.stdout, 10) || 0 : 0;

  // Có bản cập nhật khi remote đi trước local (behindCount > 0) hoặc mã SHA khác nhau (và remote có commit mới hơn)
  const hasUpdate = behindCount > 0;

  const busyCheck = isSystemBusy();
  const lastUpdateNotice = await getLastUpdateNotice();

  cachedGitStatus = {
    supported: true,
    hasUpdate,
    behindCount,
    currentCommit: { sha: localSha, message: localMessage, date: localDate },
    remoteCommit: { sha: remoteSha, message: remoteMessage, date: remoteDate },
    lastUpdateNotice,
    lastChecked: new Date().toISOString()
  };
  lastCacheTime = now;

  return {
    ...cachedGitStatus,
    isBusy: busyCheck.isBusy,
    busyDetails: busyCheck.details,
    activeTasks: busyCheck.activeTasks,
    isUpdating
  };
}

/**
 * Tạo batch script restart độc lập cho Windows
 */
async function generateRestartHelper(port) {
  const currentPort = port || process.env.PORT || 3001;
  const batContent = `@echo off
chcp 65001 >nul 2>&1
timeout /t 3 /nobreak >nul
cd /d "%~dp0"

:: Nếu .restart_flag đã bị ChayTool_VPS.bat xóa nghĩa là ChayTool_VPS đã tự loop khởi động lại rồi
if not exist "%~dp0.restart_flag" (
    exit
)

:: Nếu .restart_flag vẫn còn, chứng tỏ script runner cũ không có loop -> updater_restart.bat sẽ tự kích hoạt
del "%~dp0.restart_flag" >nul 2>&1

:: Giải phóng cổng nếu còn tiến trình treo
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":${currentPort}" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

if exist "%~dp0node.exe" (
    set "NODE_CMD=%~dp0node.exe"
) else (
    set "NODE_CMD=node"
)

start "FB Automation Tool" "%NODE_CMD%" server.js
exit
`;
  await fs.writeFile(UPDATER_BAT_FILE, batContent, 'utf8');
}

/**
 * Thực thi cập nhật 1-Click từ xa (Self-Update Pipeline)
 */
export async function executeSelfUpdate({ force = false, port = 3001 } = {}) {
  if (isUpdating) {
    throw new Error('Hệ thống đang trong quá trình cập nhật! Vui lòng không gửi yêu cầu trùng lặp.');
  }

  const busyCheck = isSystemBusy();
  if (busyCheck.isBusy && !force) {
    return {
      success: false,
      status: 'busy',
      message: 'Hệ thống đang có tác vụ cào lead hoặc quét nhóm đang chạy ngầm.',
      activeTasks: busyCheck.activeTasks,
      busyDetails: busyCheck.details
    };
  }

  isUpdating = true;
  updateProgress = {
    step: 'preparing',
    message: 'Đang chuẩn bị cập nhật...',
    progress: 10,
    error: null
  };

  try {
    // 1. Dừng tác vụ nếu có lệnh ép buộc (force)
    if (busyCheck.isBusy && force) {
      updateProgress = { step: 'stopping_tasks', message: 'Đang dừng các tác vụ cào dữ liệu...', progress: 20, error: null };
      await stopAllTasks();
    }

    // 2. Sao lưu file cấu hình config.json (để không bị mất API Key AI và tùy chọn cá nhân)
    updateProgress = { step: 'backup_config', message: 'Đang bảo toàn cấu hình hệ thống & API Keys...', progress: 30, error: null };
    let savedConfig = null;
    try {
      if (fsSync.existsSync(CONFIG_FILE)) {
        const raw = await fs.readFile(CONFIG_FILE, 'utf8');
        savedConfig = JSON.parse(raw);
        logger.info('Đã sao lưu cấu hình config.json an toàn vào bộ nhớ tạm.');
      }
    } catch (cfgErr) {
      logger.warn({ err: cfgErr }, 'Không thể sao lưu config.json, tiếp tục cập nhật.');
    }

    // 3. Kiểm tra xem file package.json có thay đổi giữa HEAD và origin/main không
    updateProgress = { step: 'checking_deps', message: 'Kiểm tra thay đổi thư viện mã nguồn...', progress: 40, error: null };
    const diffFilesRes = await runCommand('git diff --name-only HEAD origin/main');
    const hasPackageChanges = diffFilesRes.success && diffFilesRes.stdout.includes('package.json');

    // 4. Kéo code mới từ Git: fetch & reset --hard
    updateProgress = { step: 'pulling', message: 'Đang tải code mới nhất từ GitHub...', progress: 50, error: null };
    const fetchRes = await runCommand('git fetch origin main', { timeout: 30000 });
    if (!fetchRes.success) {
      throw new Error(`Không thể fetch code từ GitHub: ${fetchRes.error || fetchRes.stderr}`);
    }

    const resetRes = await runCommand('git reset --hard origin/main', { timeout: 15000 });
    if (!resetRes.success) {
      throw new Error(`Không thể cập nhật code sang nhánh mới: ${resetRes.error || resetRes.stderr}`);
    }
    logger.info('Đã đồng bộ toàn bộ mã nguồn sang bản mới nhất trên origin/main.');

    // 4.1. Lưu thông báo cập nhật thành công (phát Pop-up thông báo cho toàn bộ Client)
    try {
      const newCommitRes = await runCommand('git log -1 --pretty=format:"%h||%s||%cd" --date=format:"%d/%m/%Y %H:%M"');
      let newCommit = { sha: '', message: 'Bản cập nhật mới nhất từ Git', date: 'Vừa xong' };
      if (newCommitRes.success && newCommitRes.stdout) {
        const parts = newCommitRes.stdout.split('||');
        newCommit = {
          sha: parts[0] || '',
          message: parts[1] || 'Bản cập nhật mới nhất từ Git',
          date: parts[2] || 'Vừa xong'
        };
      }
      const noticePayload = {
        noticeId: `update_${newCommit.sha || Date.now()}`,
        updatedAt: new Date().toISOString(),
        commitSha: newCommit.sha,
        commitMsg: newCommit.message,
        commitDate: newCommit.date,
        version: '1.0.2'
      };
      const dataDir = path.dirname(LAST_UPDATE_NOTICE_FILE);
      if (!fsSync.existsSync(dataDir)) {
        fsSync.mkdirSync(dataDir, { recursive: true });
      }
      await fs.writeFile(LAST_UPDATE_NOTICE_FILE, JSON.stringify(noticePayload, null, 2), 'utf8');
      logger.info({ noticeId: noticePayload.noticeId }, 'Đã lưu thông báo cập nhật mới cho các client.');
    } catch (noticeErr) {
      logger.warn({ err: noticeErr.message }, 'Không thể ghi last_update_notice.json');
    }

    // 5. Khôi phục & Hợp nhất lại cấu hình config.json
    if (savedConfig) {
      updateProgress = { step: 'restoring_config', message: 'Đang khôi phục lại cấu hình cá nhân & API Keys...', progress: 65, error: null };
      try {
        let newConfigTemplate = {};
        if (fsSync.existsSync(CONFIG_FILE)) {
          const newRaw = await fs.readFile(CONFIG_FILE, 'utf8');
          newConfigTemplate = JSON.parse(newRaw);
        }
        // Hợp nhất: template mới có gì giữ nấy, nhưng ghi đè các cấu hình người dùng đã lưu
        const mergedConfig = {
          ...newConfigTemplate,
          ...savedConfig,
          defaultFilters: {
            ...(newConfigTemplate.defaultFilters || {}),
            ...(savedConfig.defaultFilters || {})
          }
        };
        await fs.writeFile(CONFIG_FILE, JSON.stringify(mergedConfig, null, 2), 'utf8');
        logger.info('Đã hợp nhất và khôi phục thành công config.json.');
      } catch (restoreErr) {
        logger.warn({ err: restoreErr }, 'Lỗi khi khôi phục config.json');
      }
    }

    // 6. Cài đặt npm nếu có thay đổi thư viện
    if (hasPackageChanges) {
      updateProgress = { step: 'dependencies', message: 'Phát hiện thư viện mới! Đang chạy npm install...', progress: 80, error: null };
      logger.info('Phát hiện package.json thay đổi, đang chạy npm install...');
      await runCommand('npm install --no-audit --no-fund', { timeout: 60000 });
    }

    // 7. Chuẩn bị khởi động lại Server
    updateProgress = { step: 'restarting', message: 'Cập nhật hoàn tất! Đang khởi động lại server...', progress: 95, error: null };
    
    // Ghi file cờ .restart_flag (để script ChayTool_VPS.bat nhận diện nếu đang dùng bản loop)
    await fs.writeFile(RESTART_FLAG_FILE, 'restart', 'utf8');

    // Tạo updater_restart.bat độc lập (hỗ trợ cho cả các máy đang chạy bat cũ chưa có loop)
    await generateRestartHelper(port);

    // Kích hoạt detached script
    try {
      const child = spawn('cmd.exe', ['/c', UPDATER_BAT_FILE], {
        cwd: CWD,
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      });
      child.unref();
      logger.info('Đã kích hoạt tiến trình restart độc lập.');
    } catch (spawnErr) {
      logger.error({ err: spawnErr }, 'Lỗi khi kích hoạt tiến trình restart helper');
    }

    // Xóa cache git status
    cachedGitStatus = null;
    lastCacheTime = 0;

    // Hẹn giờ thoát tiến trình sau 1.5 giây để Express gửi kịp response về Client
    setTimeout(() => {
      logger.info('👋 Thoát tiến trình Node.js hiện tại để nạp phiên bản mới...');
      process.exit(0);
    }, 1500);

    return {
      success: true,
      status: 'success',
      message: 'Cập nhật phiên bản mới thành công! Hệ thống đang tự khởi động lại...',
      restartDelayMs: 5000
    };

  } catch (error) {
    isUpdating = false;
    updateProgress = {
      step: 'error',
      message: error.message,
      progress: 0,
      error: error.message
    };
    logger.error({ err: error }, 'Quá trình cập nhật thất bại');
    throw error;
  }
}

/**
 * Lấy trạng thái tiến độ cập nhật
 */
export function getUpdateProgress() {
  return {
    isUpdating,
    ...updateProgress
  };
}
