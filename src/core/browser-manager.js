import { chromium } from 'playwright';
import logger from './logger.js';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import { execSync } from 'child_process';

const CWD = process.cwd();
const LOCAL_BROWSERS_DIR = path.join(CWD, 'browsers');
const PROFILE_DIR = path.join(os.tmpdir(), 'fb_automation_browser_profile');
const SESSION_FILE = path.join(CWD, 'session', 'facebook.json');

// Check if local project ./browsers folder exists (Windows portable package)
if (fsSync.existsSync(LOCAL_BROWSERS_DIR)) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = LOCAL_BROWSERS_DIR;
}

function findLocalChromiumExecutable() {
  try {
    if (!fsSync.existsSync(LOCAL_BROWSERS_DIR)) return null;

    function searchDir(dir) {
      const files = fsSync.readdirSync(dir);
      for (const file of files) {
        const full = path.join(dir, file);
        const stat = fsSync.statSync(full);
        if (stat.isDirectory()) {
          const res = searchDir(full);
          if (res) return res;
        } else if (file === 'chrome.exe' || file === 'chromium' || file === 'chrome') {
          return full;
        }
      }
      return null;
    }

    return searchDir(LOCAL_BROWSERS_DIR);
  } catch (e) {
    return null;
  }
}

function ensureLocalChromiumInstalled() {
  // If running inside Docker / Linux with preinstalled Playwright browsers, return null to let Playwright handle it
  if (process.env.PLAYWRIGHT_BROWSERS_PATH === '/ms-playwright' || (!fsSync.existsSync(LOCAL_BROWSERS_DIR) && process.platform === 'linux')) {
    return null;
  }

  const existingExe = findLocalChromiumExecutable();
  if (existingExe) {
    logger.info(`Found local standalone Chromium executable at: ${existingExe}`);
    return existingExe;
  }

  if (fsSync.existsSync(LOCAL_BROWSERS_DIR)) {
    logger.info(`Local Chromium missing in ${LOCAL_BROWSERS_DIR}. Downloading Chromium binary automatically...`);
    try {
      execSync('npx playwright install chromium', {
        stdio: 'inherit',
        env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: LOCAL_BROWSERS_DIR }
      });
      const downloadedExe = findLocalChromiumExecutable();
      if (downloadedExe) {
        logger.info(`Chromium successfully downloaded into local project browsers/ directory: ${downloadedExe}`);
        return downloadedExe;
      }
    } catch (err) {
      logger.warn({ err }, 'Auto download local chromium failed');
    }
  }

  return null;
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

    const executablePath = ensureLocalChromiumInstalled();
    const launchArgs = [
      '--disable-notifications',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled'
    ];
    if (!headless) {
      launchArgs.push('--start-maximized');
    }

    const launchOptions = {
      headless: !!headless,
      viewport: headless ? { width: 1280, height: 800 } : null,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      executablePath: executablePath || undefined,
      args: launchArgs
    };

    let ctx;
    try {
      ctx = await chromium.launchPersistentContext(clientProfileDir, launchOptions);
    } catch (err1) {
      try {
        ctx = await chromium.launchPersistentContext(clientProfileDir, {
          ...launchOptions,
          executablePath: undefined,
          channel: 'msedge'
        });
      } catch (err2) {
        ctx = await chromium.launchPersistentContext(clientProfileDir, {
          ...launchOptions,
          executablePath: undefined,
          channel: 'chrome'
        });
      }
    }

    this.clientContexts.set(clientId, { context: ctx, profileDir: clientProfileDir });
    logger.info(`[MULTI-CLIENT] Created isolated Chromium context for client [${clientId}]`);
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
        await fs.rm(record.profileDir, { recursive: true, force: true });
      } catch (e) {}
      logger.info(`[MULTI-CLIENT] Closed and cleaned Chromium context for client [${clientId}]`);
    }
  }

  async clearProfileDir() {
    try {
      if (fsSync.existsSync(PROFILE_DIR)) {
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
    logger.info(`Launching persistent browser context at ${PROFILE_DIR} (headless: ${headless})...`);

    const executablePath = ensureLocalChromiumInstalled();

    const launchArgs = [
      '--disable-notifications',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled'
    ];
    if (!headless) {
      launchArgs.push('--start-maximized');
    }

    const launchOptions = {
      headless: !!headless,
      viewport: headless ? { width: 1280, height: 800 } : null,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      executablePath: executablePath || undefined,
      args: launchArgs
    };

    try {
      this.context = await chromium.launchPersistentContext(PROFILE_DIR, launchOptions);
      this.currentHeadless = headless;
      logger.info(`Chromium browser launched successfully from ${executablePath || 'Playwright defaults'}!`);
      return this.context;
    } catch (err1) {
      logger.warn({ err: err1.message }, 'Failed to launch with local Chromium. Trying system Edge...');
    }

    // Fallback Edge
    try {
      this.context = await chromium.launchPersistentContext(PROFILE_DIR, {
        ...launchOptions,
        executablePath: undefined,
        channel: 'msedge'
      });
      this.currentHeadless = headless;
      logger.info('Launched Microsoft Edge system browser successfully!');
      return this.context;
    } catch (err2) {
      logger.warn({ err: err2.message }, 'Failed to launch Edge');
    }

    // Fallback Chrome
    try {
      this.context = await chromium.launchPersistentContext(PROFILE_DIR, {
        ...launchOptions,
        executablePath: undefined,
        channel: 'chrome'
      });
      this.currentHeadless = headless;
      logger.info('Launched Google Chrome system browser successfully!');
      return this.context;
    } catch (err3) {
      throw new Error('Không thể khởi chạy Chromium! Vui lòng mở Terminal và chạy: npx playwright install chromium');
    }
  }

  async getContext() {
    if (!this.context) {
      throw new Error('Browser is not launched. Call launch() first.');
    }
    return this.context;
  }

  async saveSession() {
    // In client-isolated architecture, client cookies are managed strictly client-side.
    // Server does not persist client cookies or storageState to disk.
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
      logger.info('Browser context closed');
    }
  }
}

const browserManager = new BrowserManager();
export default browserManager;
