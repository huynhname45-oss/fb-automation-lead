import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { finished } from 'stream/promises';
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

const GITHUB_REPO = 'huynhname45-oss/fb-automation-lead';
let LOCAL_APP_VERSION = '1.0.2';

try {
  const pkgFile = path.join(CWD, 'package.json');
  if (fsSync.existsSync(pkgFile)) {
    const raw = fsSync.readFileSync(pkgFile, 'utf8');
    const p = JSON.parse(raw);
    if (p.version) LOCAL_APP_VERSION = p.version;
  }
} catch (_) {}

/**
 * Compare two semver strings (e.g. "1.0.3" vs "1.0.2")
 * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
export function compareSemver(v1, v2) {
  const p1 = (v1 || '').replace(/^v/, '').split('.').map(x => parseInt(x, 10) || 0);
  const p2 = (v2 || '').replace(/^v/, '').split('.').map(x => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const num1 = p1[i] || 0;
    const num2 = p2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

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
  step: 'idle', // idle | checking | downloading | pulling | dependencies | restarting | error
  message: '',
  progress: 0,
  error: null
};

// Cache git check status for 3 minutes to prevent hammering Git / GitHub
let cachedStatus = null;
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
  if (typeof process.pkg !== 'undefined') {
    return { available: false, reason: 'Chạy dưới dạng file nhị phân độc lập .exe' };
  }
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
 * Kiểm tra cập nhật qua Cloud GitHub Releases API (Dành riêng cho máy Client chạy file .exe)
 */
export async function checkCloudUpdateStatus(force = false) {
  const now = Date.now();
  const busyCheck = isSystemBusy();
  const lastUpdateNotice = await getLastUpdateNotice();

  if (!force && cachedStatus && (now - lastCacheTime < CACHE_TTL_MS)) {
    return {
      ...cachedStatus,
      lastUpdateNotice,
      isBusy: busyCheck.isBusy,
      busyDetails: busyCheck.details,
      activeTasks: busyCheck.activeTasks,
      isUpdating
    };
  }

  try {
    let remoteVersion = null;
    let remoteTitle = 'Bản cập nhật mới';
    let remoteDate = '—';
    let releaseNotes = '';
    let downloadUrl = `https://github.com/${GITHUB_REPO}/releases/latest`;
    let isDirectExe = false;

    // 1. Thử gọi GitHub Releases API trước
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
        signal: controller.signal,
        headers: { 'User-Agent': 'FB-Automation-Client' }
      });
      clearTimeout(timer);

      if (res.ok) {
        const data = await res.json();
        remoteVersion = (data.tag_name || '').replace(/^v/, '');
        remoteTitle = data.name || `Phiên bản v${remoteVersion}`;
        remoteDate = data.published_at ? new Date(data.published_at).toLocaleDateString('vi-VN') : 'Mới nhất';
        releaseNotes = data.body || '';

        // Tìm asset FB_Automation.exe
        if (Array.isArray(data.assets)) {
          const exeAsset = data.assets.find(a => (a.name || '').toLowerCase() === 'fb_automation.exe');
          if (exeAsset && exeAsset.browser_download_url) {
            downloadUrl = exeAsset.browser_download_url;
            isDirectExe = true;
          }
        }
      }
    } catch (apiErr) {
      logger.debug({ err: apiErr.message }, 'Không thể lấy GitHub Releases API, thử raw package.json...');
    }

    // 2. Nếu chưa có Release hoặc API bị lỗi, fallback qua raw package.json
    if (!remoteVersion) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000);
        const rawRes = await fetch(`https://raw.githubusercontent.com/${GITHUB_REPO}/main/package.json`, {
          signal: controller.signal,
          headers: { 'User-Agent': 'FB-Automation-Client' }
        });
        clearTimeout(timer);

        if (rawRes.ok) {
          const pkgData = await rawRes.json();
          remoteVersion = (pkgData.version || '').replace(/^v/, '');
          remoteTitle = `Phiên bản v${remoteVersion}`;
          remoteDate = 'Mới nhất trên Git';
        }
      } catch (rawErr) {
        logger.debug({ err: rawErr.message }, 'Không thể lấy raw package.json');
      }
    }

    if (!remoteVersion) {
      return {
        supported: true,
        isExeMode: true,
        hasUpdate: false,
        fetchError: 'Không thể kết nối tới máy chủ cập nhật (Vui lòng kiểm tra kết nối mạng).',
        currentCommit: { sha: `v${LOCAL_APP_VERSION}`, message: `Phiên bản v${LOCAL_APP_VERSION}`, date: 'Cục bộ' },
        remoteCommit: null,
        lastUpdateNotice,
        isBusy: busyCheck.isBusy,
        busyDetails: busyCheck.details,
        activeTasks: busyCheck.activeTasks,
        isUpdating,
        lastChecked: new Date().toISOString()
      };
    }

    const hasUpdate = compareSemver(remoteVersion, LOCAL_APP_VERSION) > 0;

    cachedStatus = {
      supported: true,
      isExeMode: true,
      hasUpdate,
      behindCount: hasUpdate ? 1 : 0,
      currentCommit: {
        sha: `v${LOCAL_APP_VERSION}`,
        message: `Phiên bản hiện tại: v${LOCAL_APP_VERSION}`,
        date: 'Cục bộ'
      },
      remoteCommit: {
        sha: `v${remoteVersion}`,
        message: remoteTitle,
        date: remoteDate,
        downloadUrl,
        isDirectExe,
        notes: releaseNotes
      },
      downloadUrl,
      isDirectExe,
      lastChecked: new Date().toISOString()
    };
    lastCacheTime = now;

    return {
      ...cachedStatus,
      lastUpdateNotice,
      isBusy: busyCheck.isBusy,
      busyDetails: busyCheck.details,
      activeTasks: busyCheck.activeTasks,
      isUpdating
    };
  } catch (err) {
    logger.warn({ err: err.message }, 'Lỗi khi kiểm tra bản cập nhật Cloud');
    return {
      supported: true,
      isExeMode: true,
      hasUpdate: false,
      isBusy: busyCheck.isBusy,
      isUpdating,
      lastUpdateNotice
    };
  }
}

/**
 * Kiểm tra trạng thái cập nhật (Hỗ trợ cả Git Repo & Máy Client chạy file .exe)
 */
export async function checkUpdateStatus(force = false) {
  const gitCheck = await isGitAvailable();
  if (!gitCheck.available) {
    // Tự động chuyển tiếp sang kiểm tra qua Cloud GitHub Releases API cho máy Client
    return await checkCloudUpdateStatus(force);
  }

  const now = Date.now();
  if (!force && cachedStatus && (now - lastCacheTime < CACHE_TTL_MS)) {
    const busyCheck = isSystemBusy();
    const lastUpdateNotice = await getLastUpdateNotice();
    return {
      ...cachedStatus,
      lastUpdateNotice,
      isBusy: busyCheck.isBusy,
      busyDetails: busyCheck.details,
      activeTasks: busyCheck.activeTasks,
      isUpdating
    };
  }

  // 1. Lấy thông tin commit cục bộ (Local HEAD)
  const localShaRes = await runCommand('git rev-parse HEAD');
  const localSha = localShaRes.success ? localShaRes.stdout.substring(0, 7) : 'unknown';

  const localLogRes = await runCommand('git log -1 --pretty=format:"%s||%cd" --date=format:"%d/%m/%Y %H:%M"');
  let localMessage = 'Không xác định';
  let localDate = '—';
  if (localLogRes.success && localLogRes.stdout) {
    const parts = localLogRes.stdout.split('||');
    localMessage = parts[0] || '';
    localDate = parts[1] || '—';
  }

  // 2. Fetch origin main ngầm để lấy thông tin mới nhất từ remote
  let fetchRes = await runCommand('git fetch origin main', { timeout: 20000 });
  if (!fetchRes.success) {
    await new Promise(r => setTimeout(r, 1500));
    fetchRes = await runCommand('git fetch origin main', { timeout: 20000 });
  }
  if (!fetchRes.success) {
    logger.warn({ err: fetchRes.error }, 'Không thể kết nối tới Git server để kiểm tra bản cập nhật');
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
  const hasUpdate = behindCount > 0;

  const busyCheck = isSystemBusy();
  const lastUpdateNotice = await getLastUpdateNotice();

  cachedStatus = {
    supported: true,
    isExeMode: false,
    hasUpdate,
    behindCount,
    currentCommit: { sha: localSha, message: localMessage, date: localDate },
    remoteCommit: { sha: remoteSha, message: remoteMessage, date: remoteDate },
    lastUpdateNotice,
    lastChecked: new Date().toISOString()
  };
  lastCacheTime = now;

  return {
    ...cachedStatus,
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
  const isExe = typeof process.pkg !== 'undefined';
  const startCmd = isExe
    ? `start "FB Automation Tool" "${process.execPath}"`
    : `if exist "%~dp0node.exe" (\n    set "NODE_CMD=%~dp0node.exe"\n) else (\n    set "NODE_CMD=node"\n)\nstart "FB Automation Tool" "%NODE_CMD%" server.js`;

  const batContent = `@echo off
chcp 65001 >nul 2>&1
timeout /t 3 /nobreak >nul
cd /d "%~dp0"

if not exist "%~dp0.restart_flag" (
    exit
)

del "%~dp0.restart_flag" >nul 2>&1

for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":${currentPort}" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

${startCmd}
exit
`;
  await fs.writeFile(UPDATER_BAT_FILE, batContent, 'utf8');
}

/**
 * Thực thi cập nhật 1-Click tự động cho file .exe (Client Auto-Update Pipeline)
 */
async function executeExeSelfUpdate({ force = false } = {}) {
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

  const cloudStatus = await checkCloudUpdateStatus(true);
  const downloadUrl = cloudStatus.downloadUrl || cloudStatus.remoteCommit?.downloadUrl;
  const isDirectExe = cloudStatus.isDirectExe || (downloadUrl && downloadUrl.toLowerCase().endsWith('.exe'));

  if (!downloadUrl || !isDirectExe) {
    return {
      success: false,
      status: 'manual_download',
      message: 'Vui lòng bấm vào liên kết để tải file FB_Automation.exe phiên bản mới nhất.',
      downloadUrl: downloadUrl || `https://github.com/${GITHUB_REPO}/releases/latest`
    };
  }

  isUpdating = true;
  updateProgress = {
    step: 'preparing',
    message: 'Đang chuẩn bị cập nhật file .exe mới...',
    progress: 10,
    error: null
  };

  try {
    if (busyCheck.isBusy && force) {
      updateProgress = { step: 'stopping_tasks', message: 'Đang dừng các tác vụ cào dữ liệu...', progress: 20, error: null };
      await stopAllTasks();
    }

    const currentExePath = process.execPath;
    const targetDir = path.dirname(currentExePath);
    const newExePath = path.join(targetDir, 'FB_Automation_new.exe');

    updateProgress = { step: 'downloading', message: 'Đang tải bản cập nhật FB_Automation.exe từ GitHub...', progress: 35, error: null };
    logger.info(`Đang tải file cập nhật từ: ${downloadUrl}`);

    const res = await fetch(downloadUrl, {
      redirect: 'follow',
      headers: { 'User-Agent': 'FB-Automation-Updater' }
    });

    if (!res.ok) {
      throw new Error(`Không thể tải bản cập nhật từ máy chủ (HTTP ${res.status})`);
    }

    const fileStream = fsSync.createWriteStream(newExePath);
    await finished(Readable.fromWeb(res.body).pipe(fileStream));

    const stat = fsSync.statSync(newExePath);
    if (stat.size < 1000000) { // < 1MB indicates broken download
      try { fsSync.unlinkSync(newExePath); } catch (_) {}
      throw new Error('File cập nhật tải về không hợp lệ hoặc bị lỗi đường truyền.');
    }

    logger.info(`Tải thành công FB_Automation_new.exe (${Math.round(stat.size / 1024 / 1024)} MB)!`);

    // Lưu thông báo cập nhật thành công cho lần mở tới
    try {
      const noticePayload = {
        noticeId: `update_${Date.now()}`,
        updatedAt: new Date().toISOString(),
        commitSha: cloudStatus.remoteCommit?.sha || 'vMới',
        commitMsg: cloudStatus.remoteCommit?.message || 'Bản cập nhật mới nhất',
        commitDate: cloudStatus.remoteCommit?.date || 'Vừa xong',
        version: cloudStatus.remoteCommit?.sha?.replace(/^v/, '') || 'Mới'
      };
      const dataDir = path.dirname(LAST_UPDATE_NOTICE_FILE);
      if (!fsSync.existsSync(dataDir)) {
        fsSync.mkdirSync(dataDir, { recursive: true });
      }
      await fs.writeFile(LAST_UPDATE_NOTICE_FILE, JSON.stringify(noticePayload, null, 2), 'utf8');
    } catch (_) {}

    updateProgress = { step: 'restarting', message: 'Tải hoàn tất! Đang khởi động lại phiên bản mới...', progress: 95, error: null };

    // Tạo script hoán đổi file trong %TEMP% để không bị khóa file
    const swapBatPath = path.join(os.tmpdir(), `fb_swap_${Date.now()}.bat`);
    const swapBatContent = `@echo off
chcp 65001 >nul 2>&1
timeout /t 2 /nobreak >nul

:kill_loop
taskkill /F /IM "FB_Automation.exe" >nul 2>&1

:move_loop
move /Y "${newExePath}" "${currentExePath}" >nul 2>&1
if errorlevel 1 (
    timeout /t 1 /nobreak >nul
    goto move_loop
)

start "" "${currentExePath}"
(goto) 2>nul & del "%~f0"
exit
`;
    await fs.writeFile(swapBatPath, swapBatContent, 'utf8');

    // Chạy detached swap script
    const child = spawn('cmd.exe', ['/c', swapBatPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    child.unref();

    setTimeout(() => {
      logger.info('👋 Thoát file .exe hiện tại để hoàn tất quá trình nâng cấp...');
      process.exit(0);
    }, 1500);

    return {
      success: true,
      status: 'success',
      message: 'Đã tải xong bản cập nhật! Ứng dụng đang tự khởi động lại...',
      restartDelayMs: 4000
    };

  } catch (err) {
    isUpdating = false;
    updateProgress = { step: 'error', message: err.message, progress: 0, error: err.message };
    logger.error({ err: err.message }, 'Cập nhật file .exe thất bại');
    throw err;
  }
}

/**
 * Thực thi cập nhật 1-Click tự động từ xa (Self-Update Pipeline)
 */
export async function executeSelfUpdate({ force = false, port = 3001 } = {}) {
  if (isUpdating) {
    throw new Error('Hệ thống đang trong quá trình cập nhật! Vui lòng không gửi yêu cầu trùng lặp.');
  }

  const gitCheck = await isGitAvailable();
  if (!gitCheck.available) {
    // Thực thi cập nhật file .exe cho client
    return await executeExeSelfUpdate({ force });
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
    let fetchRes = await runCommand('git fetch origin main', { timeout: 30000 });
    if (!fetchRes.success) {
      await new Promise(r => setTimeout(r, 2000));
      fetchRes = await runCommand('git fetch origin main', { timeout: 30000 });
    }
    if (!fetchRes.success) {
      throw new Error(`Không thể kết nối tải code từ GitHub: ${fetchRes.error || fetchRes.stderr}`);
    }

    const resetRes = await runCommand('git reset --hard origin/main', { timeout: 15000 });
    if (!resetRes.success) {
      throw new Error(`Không thể cập nhật code sang nhánh mới: ${resetRes.error || resetRes.stderr}`);
    }
    logger.info('Đã đồng bộ toàn bộ mã nguồn sang bản mới nhất trên origin/main.');

    // 4.1. Lưu thông báo cập nhật thành công
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
        version: LOCAL_APP_VERSION
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

    // 7. Khởi động lại Server
    updateProgress = { step: 'restarting', message: 'Cập nhật hoàn tất! Đang khởi động lại server...', progress: 95, error: null };
    await fs.writeFile(RESTART_FLAG_FILE, 'restart', 'utf8');
    await generateRestartHelper(port);

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

    cachedStatus = null;
    lastCacheTime = 0;

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
