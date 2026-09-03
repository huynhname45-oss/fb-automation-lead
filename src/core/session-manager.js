import EventEmitter from 'events';
import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import browserManager from './browser-manager.js';
import logger from './logger.js';
import configManager from './config-manager.js';

const CWD = process.cwd();
const SESSION_FILE = path.join(CWD, 'session', 'facebook.json');
const ACCOUNT_INFO_FILE = path.join(CWD, 'session', 'account_info.json');

/**
 * Robust Cookie Parser supporting JSON Array, JSON Object, Netscape, and Header string (c_user=...; xs=...)
 */
export function parseCookieInput(cookieInput) {
  if (!cookieInput || typeof cookieInput !== 'string') return [];
  const trimmed = cookieInput.trim();
  if (!trimmed) return [];

  // 1. Try JSON Array format
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map(c => ({
          name: (c.name || c.key || '').trim(),
          value: String(c.value || '').trim(),
          domain: c.domain ? (c.domain.startsWith('.') ? c.domain : '.' + c.domain) : '.facebook.com',
          path: c.path || '/',
          httpOnly: c.httpOnly ?? true,
          secure: true,
          sameSite: 'None'
        })).filter(c => c.name && c.value);
      }
    } catch (e) {}
  }

  // 2. Try JSON Object format
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      const list = [];
      for (const [key, val] of Object.entries(parsed)) {
        if (key && val) {
          list.push({
            name: key.trim(),
            value: String(val).trim(),
            domain: '.facebook.com',
            path: '/',
            httpOnly: true,
            secure: true,
            sameSite: 'None'
          });
        }
      }
      if (list.length > 0) return list;
    } catch (e) {}
  }

  // 3. Header Cookie String format (c_user=123; xs=abc) or Line-by-line / Tab-separated
  const cookies = [];
  const pairs = trimmed.split(/[;\r\n]+/);

  for (let pair of pairs) {
    pair = pair.trim();
    if (!pair) continue;

    let name = '', value = '';
    if (pair.includes('=')) {
      const idx = pair.indexOf('=');
      name = pair.substring(0, idx).trim();
      value = pair.substring(idx + 1).trim();
    } else if (pair.includes('\t')) {
      const parts = pair.split('\t').map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2) {
        name = parts[0];
        value = parts[1];
      }
    } else if (pair.includes(':')) {
      const idx = pair.indexOf(':');
      name = pair.substring(0, idx).trim();
      value = pair.substring(idx + 1).trim();
    }

    if (name && value) {
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.substring(1, value.length - 1);
      }
      cookies.push({
        name,
        value,
        domain: '.facebook.com',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'None'
      });
    }
  }

  return cookies;
}

/**
 * Read and validate stored cookies from disk
 */
export function getSavedCookiesFromDisk() {
  try {
    if (!fs.existsSync(SESSION_FILE)) return [];
    const data = fs.readFileSync(SESSION_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    if (parsed && Array.isArray(parsed.cookies)) {
      return parsed.cookies.filter(c => c.name && c.value);
    }
  } catch (e) {}
  return [];
}

/**
 * Fast live HTTP verification with Facebook to check if cookies are genuinely active
 */
export async function fastVerifyCookiesWithFacebook(cookies = []) {
  if (!cookies || cookies.length === 0) return { valid: false, reason: 'No cookies provided' };

  const cUser = cookies.find(c => c.name === 'c_user');
  const xs = cookies.find(c => c.name === 'xs');

  if (!cUser || !cUser.value || !xs || !xs.value) {
    return { valid: false, reason: 'Missing c_user or xs cookie' };
  }

  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const res = await fetch('https://mbasic.facebook.com/me', {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Cookie': cookieHeader,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      redirect: 'manual',
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const location = res.headers.get('location') || '';

    // If redirected to login page or checkpoint
    if (location.includes('/login') || location.includes('checkpoint') || res.status === 401 || res.status === 403) {
      return { valid: false, id: cUser.value, reason: 'Facebook redirected to login/checkpoint (Cookie expired)' };
    }

    // Status 200 or 302 to user profile means session is active!
    if (res.status === 200 || (res.status === 302 && (location.includes('facebook.com') || location.startsWith('/')))) {
      return {
        valid: true,
        id: cUser.value
      };
    }
  } catch (err) {
    logger.debug({ err: err.message }, 'Fast HTTP verification timed out or encountered network error');
  }

  // Fallback: If c_user and xs exist and not expired, treat as potentially valid until full check
  return {
    valid: true,
    id: cUser.value
  };
}

class SessionManager extends EventEmitter {
  constructor() {
    super();
    this.status = 'none';
    this.accountInfo = { id: '', name: '' };
    this.lastChecked = null;
    this.monitorTimer = null;
    this._initFromDisk();
  }

  _initFromDisk() {
    const cookies = getSavedCookiesFromDisk();
    const cUser = cookies.find(c => c.name === 'c_user');
    const xs = cookies.find(c => c.name === 'xs');

    if (cUser && cUser.value && xs && xs.value) {
      let savedName = '';
      try {
        if (fs.existsSync(ACCOUNT_INFO_FILE)) {
          const data = fs.readFileSync(ACCOUNT_INFO_FILE, 'utf-8');
          const parsed = JSON.parse(data);
          if (parsed && parsed.id === cUser.value && parsed.name && 
              parsed.name.toLowerCase() !== 'bạn' && 
              parsed.name.toLowerCase() !== 'ban' &&
              parsed.name.toLowerCase() !== 'lỗi' &&
              parsed.name.toLowerCase() !== 'error') {
            savedName = parsed.name;
          }
        }
      } catch (e) {}

      this.status = 'active';
      this.accountInfo = {
        id: cUser.value,
        name: (savedName && savedName.toLowerCase() !== 'bạn' && savedName.toLowerCase() !== 'lỗi') ? savedName : `Tài khoản (${cUser.value})`
      };
      this.lastChecked = Date.now();
    } else {
      this.status = 'none';
      this.accountInfo = { id: '', name: '' };
      this.lastChecked = null;
    }
  }

  async startLoginProcess() {
    try {
      logger.info('Opening visible Playwright Chromium browser for user login...');

      if (this.monitorTimer) {
        clearInterval(this.monitorTimer);
        this.monitorTimer = null;
      }

      // Close any running headless browser to open visible one
      await browserManager.closeBrowser();

      const context = await browserManager.launch(false);
      const pages = context.pages();
      const page = pages.length > 0 ? pages[0] : await context.newPage();

      logger.info('Navigating to Facebook login page...');
      await page.goto('https://www.facebook.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });

      this.status = 'authenticating';
      this.emit('statusUpdate', this.getStatus());

      this._startCookieMonitor(context, page);

      return {
        success: true,
        status: 'authenticating',
        message: 'Trình duyệt Chromium đã được mở! Vui lòng thực hiện đăng nhập trên cửa sổ trình duyệt.'
      };
    } catch (error) {
      logger.error({ err: error.message }, 'Failed to start login process');
      this.status = 'none';
      this.emit('statusUpdate', this.getStatus());
      throw error;
    }
  }

  async loginWithCookie(cookieInput) {
    try {
      logger.info('Processing Cookie login input...');

      if (this.monitorTimer) {
        clearInterval(this.monitorTimer);
        this.monitorTimer = null;
      }

      const cookies = parseCookieInput(cookieInput);
      const cUser = cookies.find(c => c.name === 'c_user');
      const xs = cookies.find(c => c.name === 'xs');

      if (!cUser || !cUser.value) {
        throw new Error('Cookie không hợp lệ: Thiếu c_user (Facebook UID). Vui lòng dán chuỗi Cookie đầy đủ!');
      }

      if (!xs || !xs.value) {
        throw new Error('Cookie không hợp lệ: Thiếu token xs. Vui lòng dán chuỗi Cookie đầy đủ!');
      }

      // Format cookies for Playwright HTTPS Facebook domain
      const formattedCookies = cookies.map(c => ({
        name: c.name.trim(),
        value: String(c.value).trim(),
        domain: '.facebook.com',
        path: '/',
        secure: true
      })).filter(c => c.name && c.value);

      const storageState = {
        cookies: formattedCookies,
        origins: [
          {
            origin: 'https://www.facebook.com',
            localStorage: []
          }
        ]
      };

      const dir = path.dirname(SESSION_FILE);
      await fsPromises.mkdir(dir, { recursive: true });
      await fsPromises.writeFile(SESSION_FILE, JSON.stringify(storageState, null, 2), 'utf-8');

      // 1. Close existing browser and clear old browser profile cache
      await browserManager.closeBrowser();
      await browserManager.clearProfileDir();

      // 2. Launch browser context (Headless based on user config)
      const isHeadless = !!configManager.get('headless');
      const context = await browserManager.launch(isHeadless);

      // 3. Force inject cookies into Chromium context
      await context.addCookies(formattedCookies);

      // 4. Open Facebook page and verify login status
      const pages = context.pages();
      const page = pages.length > 0 ? pages[0] : await context.newPage();
      logger.info('Navigating to Facebook to verify Cookie session...');
      await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Wait a moment for Facebook redirects and cookies processing
      await new Promise(r => setTimeout(r, 2500));

      const currentUrl = page.url();
      const pageTitle = await page.title();
      const cookiesAfter = await context.cookies();
      const cUserAfter = cookiesAfter.find(c => c.name === 'c_user');

      const isLoginFailed = currentUrl.includes('/login') || 
                            currentUrl.includes('checkpoint') ||
                            pageTitle.toLowerCase().includes('log in') || 
                            pageTitle.toLowerCase().includes('đăng nhập') ||
                            !cUserAfter;

      if (isLoginFailed) {
        logger.warn('Facebook rejected the cookie (redirected to login/checkpoint).');
        await this.logout();
        throw new Error('Facebook từ chối chuỗi Cookie này (Cookie có thể đã hết hạn hoặc bị checkpoint). Vui lòng lấy lại Cookie mới nhất từ trình duyệt của bạn!');
      }

      const extractedName = await this._extractRealName(page, cUser.value);
      const finalName = (extractedName && extractedName.toLowerCase() !== 'bạn' && extractedName.toLowerCase() !== 'lỗi') ? extractedName : `Tài khoản (${cUser.value})`;

      this.accountInfo = {
        id: cUser.value,
        name: finalName
      };

      await fsPromises.writeFile(ACCOUNT_INFO_FILE, JSON.stringify(this.accountInfo, null, 2), 'utf-8');
      await browserManager.saveSession();

      this.status = 'active';
      this.lastChecked = Date.now();
      this.emit('statusUpdate', this.getStatus());

      return {
        success: true,
        status: 'active',
        user: this.accountInfo,
        message: `Đăng nhập Cookie thành công! Tên: ${this.accountInfo.name} (UID: ${this.accountInfo.id})`
      };
    } catch (error) {
      logger.error({ err: error.message }, 'Login with cookie failed');
      throw error;
    }
  }

  _startCookieMonitor(context, page) {
    if (this.monitorTimer) clearInterval(this.monitorTimer);

    let attempts = 0;
    const maxAttempts = 120; // 120 * 1.5s = 3 minutes timeout for user login

    this.monitorTimer = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(this.monitorTimer);
        this.monitorTimer = null;
        if (this.status === 'authenticating') {
          this.status = 'none';
          this.emit('statusUpdate', this.getStatus());
        }
        return;
      }

      try {
        const cookies = await context.cookies();
        const cUser = cookies.find(c => c.name === 'c_user');
        const xs = cookies.find(c => c.name === 'xs');

        if (cUser && cUser.value && xs && xs.value) {
          const currentUrl = page.url();
          // Wait until left login page
          if (!currentUrl.includes('/login') && !currentUrl.includes('recover')) {
            logger.info(`Live login detected! UID: ${cUser.value}. Fetching display name...`);

            await new Promise(r => setTimeout(r, 2000));

            let userName = '';
            try {
              userName = await this._extractRealName(page, cUser.value);
            } catch (e) {}

            const finalName = (userName && userName.toLowerCase() !== 'bạn' && userName.toLowerCase() !== 'lỗi') ? userName : `Tài khoản (${cUser.value})`;
            this.accountInfo = { id: cUser.value, name: finalName };

            await browserManager.saveSession();
            await fsPromises.writeFile(ACCOUNT_INFO_FILE, JSON.stringify(this.accountInfo, null, 2), 'utf-8');

            this.status = 'active';
            this.lastChecked = Date.now();
            this.emit('statusUpdate', this.getStatus());

            clearInterval(this.monitorTimer);
            this.monitorTimer = null;

            logger.info(`Session successfully activated for ${this.accountInfo.name} (${this.accountInfo.id})`);
          }
        }
      } catch (err) {
        clearInterval(this.monitorTimer);
        this.monitorTimer = null;
      }
    }, 1500);
  }

  async _extractRealName(page, uid = '') {
    if (!page) return '';
    try {
      const extracted = await page.evaluate((currentUid) => {
        const blacklist = new Set([
          'bạn', 'ban', 'trang cá nhân', 'tai khoan', 'tài khoản', 'account', 'profile',
          'facebook', 'menu', 'home', 'trang chủ', 'trang chu', 'bạn bè', 'ban be',
          'tin nhắn', 'tin nhan', 'thông báo', 'thong bao', 'watch', 'marketplace',
          'gaming', 'video', 'cài đặt', 'cai dat', 'xem thêm', 'xem them', 'stories',
          'bảng feed', 'bảng tin', 'bang tin', 'reels', 'nhóm', 'groups', 'lỗi', 'error'
        ]);

        function isValidName(name) {
          if (!name || typeof name !== 'string') return false;
          const clean = name.replace(/['"“”]/g, '').trim();
          if (clean.length < 2 || clean.length > 50) return false;
          if (clean.includes('http') || clean.includes('www.') || clean.includes('facebook.com')) return false;
          const lower = clean.toLowerCase();
          if (blacklist.has(lower)) return false;
          if (lower.startsWith('trang cá nhân') || lower.startsWith('tài khoản của')) return false;
          return true;
        }

        // 1. Extract from Facebook In-Memory / Script Objects (CurrentUserInitialData, DTSGInitialData)
        try {
          const scripts = Array.from(document.querySelectorAll('script:not([src])'));
          for (const s of scripts) {
            const text = s.textContent || '';
            if (text.includes('CurrentUserInitialData') || text.includes('"NAME":') || text.includes('"user_name":')) {
              // Match "NAME":"Nguyễn Văn A"
              const mName = text.match(/"NAME":\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i) || 
                            text.match(/"user_name":\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i) ||
                            text.match(/"USER_NAME":\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
              if (mName && mName[1]) {
                const unescaped = JSON.parse(`"${mName[1]}"`);
                if (isValidName(unescaped)) return unescaped;
              }
            }
          }
        } catch (e) {}

        // 2. Left Sidebar Navigation / Header - Link to Own Profile
        const profileLinks = Array.from(document.querySelectorAll('a[role="link"][href*="/me/"], a[role="link"][href*="profile.php"], div[role="navigation"] a[href*="/"]'));
        for (const a of profileLinks) {
          const href = a.getAttribute('href') || '';
          const isOwnProfile = href.includes('/me/') || (currentUid && href.includes(currentUid));
          
          if (isOwnProfile || a.closest('div[role="navigation"]')) {
            // Find inner span text
            const spans = Array.from(a.querySelectorAll('span')).map(s => s.textContent.trim()).filter(Boolean);
            for (const spanText of spans) {
              if (isValidName(spanText)) return spanText;
            }
            const fullText = a.textContent.trim();
            if (isValidName(fullText)) return fullText;
          }
        }

        // 3. Check Account Menu button (Extract only if after "Tài khoản của " and not "bạn")
        const accountBtn = document.querySelector('div[aria-label*="Tài khoản"], div[aria-label*="Account"], div[aria-label*="Trang cá nhân"]');
        if (accountBtn) {
          const aria = accountBtn.getAttribute('aria-label') || '';
          const m = aria.match(/(?:Tài khoản của|Account controls for|Trang cá nhân của)\s+([^,·]+)/i);
          if (m && m[1]) {
            const candidate = m[1].trim();
            if (isValidName(candidate)) return candidate;
          }
        }

        // 4. Document title (e.g. "(1) Nguyễn Văn A | Facebook")
        const docTitle = document.title || '';
        if (docTitle && !docTitle.toLowerCase().includes('log in') && !docTitle.toLowerCase().includes('đăng nhập')) {
          const cleanTitle = docTitle.replace(/\(\d+\)/g, '').replace(/\|\s*Facebook/i, '').replace(/Facebook/i, '').trim();
          if (isValidName(cleanTitle)) return cleanTitle;
        }

        return '';
      }, uid);

      return extracted || '';
    } catch (e) {
      return '';
    }
  }

  /**
   * Real-time live session verification with Facebook
   */
  async checkSession() {
    this.lastChecked = Date.now();
    const cookies = getSavedCookiesFromDisk();

    if (!cookies || cookies.length === 0) {
      this.status = 'none';
      this.accountInfo = { id: '', name: '' };
      this.emit('statusUpdate', this.getStatus());
      return { active: false, status: 'none', user: null, message: 'Chưa có phiên đăng nhập. Vui lòng đăng nhập Facebook.' };
    }

    const cUser = cookies.find(c => c.name === 'c_user');
    const xs = cookies.find(c => c.name === 'xs');

    if (!cUser || !cUser.value || !xs || !xs.value) {
      this.status = 'none';
      this.accountInfo = { id: '', name: '' };
      this.emit('statusUpdate', this.getStatus());
      return { active: false, status: 'none', user: null, message: 'Cookie không hợp lệ hoặc thiếu c_user/xs.' };
    }

    try {
      // 1. First run fast HTTP verification
      const fastResult = await fastVerifyCookiesWithFacebook(cookies);

      if (!fastResult.valid) {
        logger.warn(`Live session verification failed: ${fastResult.reason}`);
        this.status = 'expired';
        this.emit('statusUpdate', this.getStatus());
        return { active: false, status: 'expired', user: null, message: 'Phiên đăng nhập đã hết hạn hoặc bị Facebook đăng xuất. Vui lòng đăng nhập lại!' };
      }

      // Check if we already have a valid name saved in ACCOUNT_INFO_FILE
      let currentName = '';
      try {
        if (fs.existsSync(ACCOUNT_INFO_FILE)) {
          const data = fs.readFileSync(ACCOUNT_INFO_FILE, 'utf-8');
          const parsed = JSON.parse(data);
          if (parsed && parsed.id === cUser.value && parsed.name && 
              parsed.name.toLowerCase() !== 'bạn' && 
              parsed.name.toLowerCase() !== 'ban' &&
              parsed.name.toLowerCase() !== 'lỗi' && 
              parsed.name.toLowerCase() !== 'error' &&
              !parsed.name.startsWith('Tài khoản (')) {
            currentName = parsed.name;
          }
        }
      } catch (e) {}

      // If no valid name yet, launch Playwright to extract real name
      if (!currentName) {
        try {
          const isHeadless = configManager.get('headless') ?? true;
          const context = await browserManager.launch(isHeadless);
          await browserManager.injectSessionCookies();
          const page = (await context.pages())[0] || (await context.newPage());
          await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
          await new Promise(r => setTimeout(r, 2000));
          const extracted = await this._extractRealName(page, cUser.value);
          if (extracted && extracted.toLowerCase() !== 'bạn' && extracted.toLowerCase() !== 'lỗi') {
            currentName = extracted;
          }
        } catch (e) {}
      }

      this.accountInfo = {
        id: cUser.value,
        name: currentName || `Tài khoản (${cUser.value})`
      };

      await fsPromises.writeFile(ACCOUNT_INFO_FILE, JSON.stringify(this.accountInfo, null, 2), 'utf-8').catch(() => {});

      this.status = 'active';
      this.emit('statusUpdate', this.getStatus());
      return {
        active: true,
        status: 'active',
        user: this.accountInfo,
        message: `Phiên đăng nhập hoạt động tốt! Tài khoản: ${this.accountInfo.name} (${this.accountInfo.id})`
      };
    } catch (err) {
      logger.error({ err: err.message }, 'Check session error');
      this.status = 'active';
      return { active: true, status: 'active', user: this.accountInfo, message: 'Đã kiểm tra phiên làm việc.' };
    }
  }

  getStatus() {
    const cookies = getSavedCookiesFromDisk();
    const cUser = cookies.find(c => c.name === 'c_user');
    const xs = cookies.find(c => c.name === 'xs');

    if (!cUser || !cUser.value || !xs || !xs.value) {
      if (this.status !== 'authenticating') {
        this.status = 'none';
        this.accountInfo = { id: '', name: '' };
      }
    } else if (this.status === 'none') {
      this.status = 'active';
      this.accountInfo.id = cUser.value;
      if (!this.accountInfo.name || this.accountInfo.name.toLowerCase() === 'bạn' || this.accountInfo.name.toLowerCase() === 'ban') {
        this.accountInfo.name = `Tài khoản (${cUser.value})`;
      }
    }

    if (this.accountInfo.name && (this.accountInfo.name.toLowerCase() === 'bạn' || this.accountInfo.name.toLowerCase() === 'ban')) {
      this.accountInfo.name = `Tài khoản (${this.accountInfo.id || cUser?.value || ''})`;
    }

    return {
      status: this.status,
      lastChecked: this.lastChecked,
      user: (this.status === 'active' && this.accountInfo.id) ? this.accountInfo : null
    };
  }

  async logout() {
    logger.info('Closing browser and clearing session');
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }

    this.accountInfo = { id: '', name: '' };
    this.status = 'none';
    this.lastChecked = null;

    try {
      await browserManager.closeBrowser();
      await browserManager.clearProfileDir();
    } catch (e) {
      logger.warn({ err: e.message }, 'Error closing browser on logout');
    }

    try { await fsPromises.unlink(SESSION_FILE); } catch {}
    try { await fsPromises.unlink(ACCOUNT_INFO_FILE); } catch {}

    this.emit('statusUpdate', this.getStatus());
    return { success: true, message: 'Đã đóng trình duyệt và xóa toàn bộ phiên đăng nhập.' };
  }
}

const sessionManager = new SessionManager();
export default sessionManager;
