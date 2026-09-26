import { chromium } from 'playwright';
import logger from './logger.js';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';

const CWD = process.cwd();
const LOCAL_BROWSERS_DIR = path.join(CWD, 'browsers');
const PROFILE_DIR = path.join(os.tmpdir(), 'fb_automation_browser_profile');
const SESSION_FILE = path.join(CWD, 'session', 'facebook.json');

// Check if local project ./browsers folder exists (Windows portable package)
if (fsSync.existsSync(LOCAL_BROWSERS_DIR)) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = LOCAL_BROWSERS_DIR;
}

/**
 * Clean stale Chromium profile lock files to prevent lock contention
 */
function cleanProfileLock(profileDir) {
  try {
    if (!profileDir || !fsSync.existsSync(profileDir)) return;
    const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile'];
    for (const f of lockFiles) {
      const p = path.join(profileDir, f);
      if (fsSync.existsSync(p)) {
        try {
          fsSync.rmSync(p, { force: true, recursive: true });
        } catch (_) {}
      }
    }
  } catch (_) {}
}

/**
 * Searches local directory recursively for chrome.exe or chromium
 */
function findLocalChromiumExecutable() {
  try {
    if (!fsSync.existsSync(LOCAL_BROWSERS_DIR)) return null;

    function searchDir(dir, depth = 0) {
      if (depth > 5) return null;
      const files = fsSync.readdirSync(dir);
      for (const file of files) {
        const full = path.join(dir, file);
        try {
          const stat = fsSync.statSync(full);
          if (stat.isDirectory()) {
            const res = searchDir(full, depth + 1);
            if (res) return res;
          } else if (
            file.toLowerCase() === 'chrome.exe' ||
            file.toLowerCase() === 'chromium.exe' ||
            file.toLowerCase() === 'msedge.exe' ||
            file === 'chromium' ||
            file === 'chrome'
          ) {
            return full;
          }
        } catch (_) {}
      }
      return null;
    }

    return searchDir(LOCAL_BROWSERS_DIR);
  } catch (e) {
    return null;
  }
}

/**
 * Scans Windows for any pre-installed Chromium-based browsers:
 * 1. Google Chrome (most popular)
 * 2. Microsoft Edge (pre-installed on 100% of Windows 10 & 11)
 * 3. CocCoc (hugely popular in Vietnam)
 * 4. Brave Browser
 * 5. Standalone ./browsers Chromium if present
 */
export function getAllInstalledBrowserCandidates() {
  const candidates = [];

  // 1. Local portable ./browsers
  const localExe = findLocalChromiumExecutable();
  if (localExe) {
    candidates.push({ name: 'Local Chromium', path: localExe });
  }

  const localApp = process.env.LOCALAPPDATA || '';
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  // 2. Google Chrome
  const chromePaths = [
    path.join(programFiles, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(programFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(localApp, 'Google\\Chrome\\Application\\chrome.exe')
  ];
  for (const p of chromePaths) {
    if (fsSync.existsSync(p)) {
      candidates.push({ name: 'Google Chrome', path: p });
      break;
    }
  }

  // 3. Microsoft Edge (Pre-installed on 100% of Windows 10 & 11)
  const edgePaths = [
    path.join(programFilesX86, 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(programFiles, 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(localApp, 'Microsoft\\Edge\\Application\\msedge.exe')
  ];
  for (const p of edgePaths) {
    if (fsSync.existsSync(p)) {
      candidates.push({ name: 'Microsoft Edge', path: p });
      break;
    }
  }

  // 4. CocCoc Browser (Vietnam)
  const coccocPaths = [
    path.join(programFiles, 'CocCoc\\Browser\\Application\\browser.exe'),
    path.join(programFilesX86, 'CocCoc\\Browser\\Application\\browser.exe'),
    path.join(localApp, 'CocCoc\\Browser\\Application\\browser.exe')
  ];
  for (const p of coccocPaths) {
    if (fsSync.existsSync(p)) {
      candidates.push({ name: 'Cốc Cốc Browser', path: p });
      break;
    }
  }

  // 5. Brave Browser
  const bravePaths = [
    path.join(programFiles, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
    path.join(programFilesX86, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
    path.join(localApp, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe')
  ];
  for (const p of bravePaths) {
    if (fsSync.existsSync(p)) {
      candidates.push({ name: 'Brave Browser', path: p });
      break;
    }
  }

  return candidates;
}

class BrowserManager {
  constructor() {
    this.context = null;
    this.currentHeadless = null;
    this.clientContexts = new Map(); // clientId -> { context, profileDir }
  }

  async createClientContext(clientId = 'default', headless = true) {
    if (this.clientContexts.has(clientId)) {
      await this.closeClientContext(clientId);
    }

    const clientProfileDir = path.join(os.tmpdir(), 'fb_automation_profiles', clientId);
    await fs.mkdir(clientProfileDir, { recursive: true });
    cleanProfileLock(clientProfileDir);

    const launchArgs = [
      '--disable-notifications',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--no-first-run',
      '--disable-blink-features=AutomationControlled'
    ];
    if (!headless) {
      launchArgs.push('--start-maximized');
    }

    const baseOptions = {
      headless: !!headless,
      viewport: headless ? { width: 1280, height: 800 } : null,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      args: launchArgs
    };

    const candidates = getAllInstalledBrowserCandidates();
    let ctx = null;
    let lastError = null;

    // 1. Try explicit paths first (Chrome, Edge, CocCoc, Brave, Local)
    for (const candidate of candidates) {
      try {
        cleanProfileLock(clientProfileDir);
        ctx = await chromium.launchPersistentContext(clientProfileDir, {
          ...baseOptions,
          executablePath: candidate.path
        });
        logger.info(`[MULTI-CLIENT] Khởi chạy thành công trình duyệt [${candidate.name}] tại: ${candidate.path} cho client [${clientId}]`);
        break;
      } catch (err) {
        lastError = err;
        logger.warn({ err: err.message, browser: candidate.name }, `Không thể mở trình duyệt ${candidate.name}, thử lựa chọn tiếp theo...`);
      }
    }

    // 2. Fallback to channel: msedge if no candidate path succeeded
    if (!ctx) {
      try {
        cleanProfileLock(clientProfileDir);
        ctx = await chromium.launchPersistentContext(clientProfileDir, {
          ...baseOptions,
          channel: 'msedge'
        });
        logger.info(`[MULTI-CLIENT] Khởi chạy thành công Microsoft Edge qua channel: msedge cho client [${clientId}]`);
      } catch (err) {
        lastError = err;
      }
    }

    // 3. Fallback to channel: chrome
    if (!ctx) {
      try {
        cleanProfileLock(clientProfileDir);
        ctx = await chromium.launchPersistentContext(clientProfileDir, {
          ...baseOptions,
          channel: 'chrome'
        });
        logger.info(`[MULTI-CLIENT] Khởi chạy thành công Google Chrome qua channel: chrome cho client [${clientId}]`);
      } catch (err) {
        lastError = err;
      }
    }

    // 4. Fallback to default Playwright chromium
    if (!ctx) {
      try {
        cleanProfileLock(clientProfileDir);
        ctx = await chromium.launchPersistentContext(clientProfileDir, baseOptions);
        logger.info(`[MULTI-CLIENT] Khởi chạy thành công Playwright Chromium mặc định cho client [${clientId}]`);
      } catch (err) {
        lastError = err;
      }
    }

    if (!ctx) {
      const errMsg = `Không thể tìm thấy hoặc khởi chạy bất kỳ trình duyệt nào (Chrome, Edge, Cốc Cốc)! Lỗi chi tiết: ${lastError?.message || 'Không xác định'}. Vui lòng kiểm tra Google Chrome hoặc Microsoft Edge trên máy tính.`;
      logger.error(errMsg);
      throw new Error(errMsg);
    }

    this.clientContexts.set(clientId, { context: ctx, profileDir: clientProfileDir });
    return ctx;
  }

  async closeClientContext(clientId = 'default') {
    if (this.clientContexts.has(clientId)) {
      const record = this.clientContexts.get(clientId);
      this.clientContexts.delete(clientId);
      try {
        await record.context.close();
      } catch (e) {}
      try {
        cleanProfileLock(record.profileDir);
      } catch (e) {}
      logger.info(`[MULTI-CLIENT] Closed Chromium context for client [${clientId}]`);
    }
  }

  async clearProfileDir() {
    try {
      if (fsSync.existsSync(PROFILE_DIR)) {
        cleanProfileLock(PROFILE_DIR);
        await fs.rm(PROFILE_DIR, { recursive: true, force: true });
        logger.info(`Cleared browser profile directory: ${PROFILE_DIR}`);
      }
    } catch (e) {
      logger.warn({ err: e.message }, `Failed to clear profile directory`);
    }
  }

  async injectSessionCookies() {
    if (!this.context) return;
    try {
      if (fsSync.existsSync(SESSION_FILE)) {
        const raw = await fs.readFile(SESSION_FILE, 'utf-8');
        const state = JSON.parse(raw);
        if (state && Array.isArray(state.cookies) && state.cookies.length > 0) {
          const cleanCookies = state.cookies.map(c => ({
            name: c.name.trim(),
            value: String(c.value).trim(),
            domain: '.facebook.com',
            path: '/',
            secure: true
          })).filter(c => c.name && c.value);

          await this.context.addCookies(cleanCookies);
          logger.info(`Successfully injected ${cleanCookies.length} session cookies into browser context!`);
        }
      }
    } catch (e) {
      logger.warn({ err: e.message }, 'Failed to inject session cookies');
    }
  }

  async launch(headless = false) {
    if (this.context && this.currentHeadless === headless) {
      try {
        const pages = this.context.pages();
        if (pages && pages.length > 0) return this.context;
      } catch (e) {
        // Disconnected
      }
    }

    await this.closeBrowser();

    await fs.mkdir(PROFILE_DIR, { recursive: true });
    cleanProfileLock(PROFILE_DIR);
    logger.info(`Launching persistent browser context at ${PROFILE_DIR} (headless: ${headless})...`);

    const launchArgs = [
      '--disable-notifications',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--no-first-run',
      '--disable-blink-features=AutomationControlled'
    ];
    if (!headless) {
      launchArgs.push('--start-maximized');
    }

    const baseOptions = {
      headless: !!headless,
      viewport: headless ? { width: 1280, height: 800 } : null,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      args: launchArgs
    };

    const candidates = getAllInstalledBrowserCandidates();
    let lastError = null;

    // 1. Try explicit paths first (Chrome, Edge, CocCoc, Brave, Local)
    for (const candidate of candidates) {
      try {
        cleanProfileLock(PROFILE_DIR);
        this.context = await chromium.launchPersistentContext(PROFILE_DIR, {
          ...baseOptions,
          executablePath: candidate.path
        });
        this.currentHeadless = headless;
        logger.info(`Khởi chạy thành công trình duyệt [${candidate.name}] tại: ${candidate.path}`);
        return this.context;
      } catch (err) {
        lastError = err;
        logger.warn({ err: err.message, browser: candidate.name }, `Không thể mở trình duyệt ${candidate.name}, thử lựa chọn tiếp theo...`);
      }
    }

    // 2. Fallback to channel: msedge
    try {
      cleanProfileLock(PROFILE_DIR);
      this.context = await chromium.launchPersistentContext(PROFILE_DIR, {
        ...baseOptions,
        channel: 'msedge'
      });
      this.currentHeadless = headless;
      logger.info('Khởi chạy Microsoft Edge qua channel: msedge thành công!');
      return this.context;
    } catch (err) {
      lastError = err;
    }

    // 3. Fallback to channel: chrome
    try {
      cleanProfileLock(PROFILE_DIR);
      this.context = await chromium.launchPersistentContext(PROFILE_DIR, {
        ...baseOptions,
        channel: 'chrome'
      });
      this.currentHeadless = headless;
      logger.info('Khởi chạy Google Chrome qua channel: chrome thành công!');
      return this.context;
    } catch (err) {
      lastError = err;
    }

    // 4. Fallback to default Playwright chromium
    try {
      cleanProfileLock(PROFILE_DIR);
      this.context = await chromium.launchPersistentContext(PROFILE_DIR, baseOptions);
      this.currentHeadless = headless;
      logger.info('Khởi chạy Playwright Chromium mặc định thành công!');
      return this.context;
    } catch (err) {
      lastError = err;
    }

    const errMsg = `Không thể khởi chạy bất kỳ trình duyệt nào (Chrome, Edge, Cốc Cốc)! Lỗi: ${lastError?.message || 'Không xác định'}. Vui lòng đảm bảo máy tính đã cài đặt Google Chrome hoặc Microsoft Edge.`;
    logger.error(errMsg);
    throw new Error(errMsg);
  }

  async getContext() {
    if (!this.context) {
      throw new Error('Browser is not launched. Call launch() first.');
    }
    return this.context;
  }

  async saveSession() {
    logger.debug('Session persistence bypassed (client-isolated architecture).');
  }

  async closeBrowser() {
    if (this.context) {
      try {
        await this.context.close();
      } catch (e) {
        // Safe ignore if already closed
      }
      this.context = null;
      this.currentHeadless = null;
      try {
        cleanProfileLock(PROFILE_DIR);
      } catch (e) {}
      logger.info('Browser context closed');
    }
  }
}

const browserManager = new BrowserManager();
export default browserManager;
