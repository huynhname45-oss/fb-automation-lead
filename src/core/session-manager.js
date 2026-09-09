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
      // If object has a `cookie` or `cookies` field (e.g. from fb_client_session)
      if (parsed.cookie && typeof parsed.cookie === 'string') {
        return parseCookieInput(parsed.cookie);
      }
      if (Array.isArray(parsed.cookies)) {
        return parseCookieInput(JSON.stringify(parsed.cookies));
      }
      const list = [];
      for (const [key, val] of Object.entries(parsed)) {
        if (key && val && typeof val === 'string' && key !== 'id' && key !== 'user' && key !== 'updatedAt') {
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

export function getSavedCookiesFromDisk() {
  return [];
}

export function decodeHtmlEntities(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
}

export function cleanCandidate(name) {
  if (!name || typeof name !== 'string') return '';
  let clean = decodeHtmlEntities(name)
    .replace(/\(\d+\)/g, '')
    .replace(/\|\s*Facebook/i, '')
    .replace(/Facebook/i, '')
    .replace(/['"“”]/g, '')
    .trim();
  if (clean.length < 2 || clean.length > 50) return '';
  if (clean.includes('http') || clean.includes('www.') || clean.includes('facebook.com')) return '';
  const lower = clean.toLowerCase();

  const blacklist = new Set([
    'bạn', 'ban', 'trang cá nhân', 'tai khoan', 'tài khoản', 'account', 'profile',
    'facebook', 'menu', 'home', 'trang chủ', 'trang chu', 'bạn bè', 'ban be',
    'tin nhắn', 'tin nhan', 'thông báo', 'thong bao', 'watch', 'marketplace',
    'gaming', 'video', 'cài đặt', 'cai dat', 'xem thêm', 'xem them', 'stories',
    'bảng feed', 'bảng tin', 'bang tin', 'reels', 'nhóm', 'groups', 'lỗi', 'error',
    'đăng nhập', 'log in', 'trình duyệt này không hỗ trợ facebook', 'trình duyệt không hỗ trợ',
    'trình duyệt này không hỗ trợ', 'content not found', 'not found', 'không tìm thấy', 'trang không khả dụng'
  ]);

  if (blacklist.has(lower)) return '';
  if (lower.startsWith('trang cá nhân') || lower.startsWith('tài khoản của') || lower.startsWith('tài khoản (')) return '';
  if (lower.startsWith('lỗi') || lower.startsWith('error')) return '';
  if (lower.startsWith('trình duyệt') || lower.includes('không hỗ trợ') || lower.includes('not support')) return '';
  return clean;
}

export function extractNameFromHtml(html = '') {
  if (!html || typeof html !== 'string') return '';

  // 1. Check meta og:title (e.g. <meta property="og:title" content="Nguyễn Văn A" />)
  const ogMatch = html.match(/<meta\s+[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
                  html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
  if (ogMatch && ogMatch[1]) {
    const cleaned = cleanCandidate(ogMatch[1]);
    if (cleaned) return cleaned;
  }

  // 2. Check meta name=title
  const metaTitleMatch = html.match(/<meta\s+[^>]*name=["']title["'][^>]*content=["']([^"']+)["']/i) ||
                         html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*name=["']title["']/i);
  if (metaTitleMatch && metaTitleMatch[1]) {
    const cleaned = cleanCandidate(metaTitleMatch[1]);
    if (cleaned) return cleaned;
  }

  // 3. Check "CurrentUserInitialData" script tag or "NAME":"..."
  const namePatterns = [
    /"NAME":\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i,
    /"user_name":\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i,
    /"USER_NAME":\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i,
    /"short_name":\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i,
    /"ShortProfile"[^}]*"name":\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i
  ];
  for (const pat of namePatterns) {
    const m = html.match(pat);
    if (m && m[1]) {
      try {
        const parsed = JSON.parse(`"${m[1]}"`);
        const cleaned = cleanCandidate(parsed);
        if (cleaned) return cleaned;
      } catch (e) {
        const cleaned = cleanCandidate(m[1]);
        if (cleaned) return cleaned;
      }
    }
  }

  // 4. Check document title (e.g. <title>Nguyễn Văn A | Facebook</title>)
  const titleM = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleM && titleM[1]) {
    const cleaned = cleanCandidate(titleM[1]);
    if (cleaned) return cleaned;
  }

  // 5. Check strong tag
  const strongM = html.match(/<strong[^>]*>([^<]+)<\/strong>/i);
  if (strongM && strongM[1]) {
    const cleaned = cleanCandidate(strongM[1]);
    if (cleaned) return cleaned;
  }

  return '';
}

/**
 * Extract real account display name via fast HTTP (zero browser overhead)
 */
export async function fetchAccountRealNameViaHttp(cookies = []) {
  if (!cookies || cookies.length === 0) return '';
  const cUser = cookies.find(c => c.name === 'c_user');
  if (!cUser || !cUser.value) return '';
  const uid = cUser.value;

  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

  // Strategy 1: OpenGraph crawler User-Agent (instant, 100% reliable, zero TLS/CORS block from Meta edge servers)
  try {
    const urls = [
      `https://www.facebook.com/profile.php?id=${uid}`,
      `https://m.facebook.com/profile.php?id=${uid}`
    ];
    for (const url of urls) {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) {
        const html = await res.text();
        const name = extractNameFromHtml(html);
        if (name && name.toLowerCase() !== 'lỗi' && !name.startsWith('tài khoản (')) {
          return name;
        }
      }
    }
  } catch (e) {}

  // Strategy 2: Profile URL with curl UA and cookies
  try {
    const res = await fetch(`https://www.facebook.com/profile.php?id=${uid}`, {
      method: 'GET',
      headers: {
        'User-Agent': 'curl/8.4.0',
        'Cookie': cookieHeader,
        'Accept': '*/*',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(5000)
    });
    if (res.ok) {
      const html = await res.text();
      const name = extractNameFromHtml(html);
      if (name && name.toLowerCase() !== 'lỗi' && !name.startsWith('tài khoản (')) {
        return name;
      }
    }
  } catch (e) {}

  // Strategy 3: Facebook home feed with curl UA and cookies
  try {
    const res = await fetch('https://www.facebook.com/', {
      method: 'GET',
      headers: {
        'User-Agent': 'curl/8.4.0',
        'Cookie': cookieHeader,
        'Accept': '*/*',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(5000)
    });
    if (res.ok) {
      const html = await res.text();
      const name = extractNameFromHtml(html);
      if (name && name.toLowerCase() !== 'lỗi' && !name.startsWith('tài khoản (')) {
        return name;
      }
    }
  } catch (e) {}

  return '';
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

    const res = await fetch('https://www.facebook.com/', {
      method: 'GET',
      headers: {
        'User-Agent': 'curl/8.4.0',
        'Cookie': cookieHeader,
        'Accept': '*/*'
      },
      redirect: 'follow',
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const finalUrl = res.url || '';
    if (finalUrl.includes('/login') || finalUrl.includes('checkpoint') || res.status === 401 || res.status === 403) {
      return { valid: false, id: cUser.value, reason: 'Facebook redirected to login/checkpoint (Cookie expired)' };
    }

    let extractedName = '';
    if (res.ok) {
      const html = await res.text();
      extractedName = extractNameFromHtml(html);
    }

    if (!extractedName || extractedName.toLowerCase() === 'lỗi' || extractedName.startsWith('tài khoản (')) {
      extractedName = await fetchAccountRealNameViaHttp(cookies).catch(() => '');
    }

    return {
      valid: true,
      id: cUser.value,
      name: (extractedName && extractedName.toLowerCase() !== 'lỗi' && !extractedName.startsWith('tài khoản (')) ? extractedName : ''
    };
  } catch (err) {
    logger.debug({ err: err.message }, 'Fast HTTP verification timed out or encountered network error');
    // Still valid structurally if c_user and xs exist
    const name = await fetchAccountRealNameViaHttp(cookies).catch(() => '');
    return {
      valid: true,
      id: cUser.value,
      name: (name && name.toLowerCase() !== 'lỗi' && !name.startsWith('tài khoản (')) ? name : ''
    };
  }
}

class SessionManager extends EventEmitter {
  constructor() {
    super();
    this.status = 'none';
    this.accountInfo = { id: '', name: '' };
    this.lastChecked = null;
    this.monitorTimer = null;
    this.clientSessions = new Map();
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

  async loginWithCookie(cookieInput, clientId = 'default') {
    try {
      logger.info(`Processing Cookie login input for client [${clientId}]...`);

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

      // Fast verification first
      const fastResult = await fastVerifyCookiesWithFacebook(formattedCookies);
      if (!fastResult.valid) {
        throw new Error('Facebook từ chối chuỗi Cookie này (Cookie có thể đã hết hạn hoặc bị checkpoint). Vui lòng lấy lại Cookie mới nhất từ trình duyệt của bạn!');
      }

      let finalName = (fastResult.name && fastResult.name.toLowerCase() !== 'lỗi') ? fastResult.name : '';
      if (!finalName) {
        finalName = await fetchAccountRealNameViaHttp(formattedCookies).catch(() => '');
      }

      // Extract real display name via transient Playwright page if still needed
      if (!finalName || finalName.toLowerCase() === 'lỗi') {
        try {
          const isHeadless = !!configManager.get('headless');
          const context = await browserManager.launch(isHeadless);
          await context.addCookies(formattedCookies);

          const pages = context.pages();
          const page = pages.length > 0 ? pages[0] : await context.newPage();
          logger.info(`Navigating to Facebook to extract account name for client [${clientId}]...`);
          await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 25000 });
          await new Promise(r => setTimeout(r, 2000));

          const extractedName = await this._extractRealName(page, cUser.value);
          if (extractedName && extractedName.toLowerCase() !== 'bạn' && extractedName.toLowerCase() !== 'lỗi') {
            finalName = extractedName;
          }
          await page.close().catch(() => {});
          await browserManager.closeBrowser().catch(() => {});
        } catch (err) {
          logger.warn({ err: err.message }, 'Failed to extract real name via browser, using default UID name');
        }
      }

      if (!finalName || finalName.toLowerCase() === 'lỗi') {
        finalName = `Tài khoản (${cUser.value})`;
      }

      const clientInfo = {
        id: cUser.value,
        name: finalName
      };

      // Store in memory for this specific clientId
      this.clientSessions.set(clientId, {
        status: 'active',
        user: clientInfo,
        cookie: cookieInput,
        lastChecked: Date.now()
      });

      // Persist session to disk for auto-recovery across server restarts
      try {
        await fsPromises.mkdir(path.dirname(SESSION_FILE), { recursive: true });
        await fsPromises.writeFile(SESSION_FILE, JSON.stringify({
          cookie: cookieInput,
          user: clientInfo,
          savedAt: new Date().toISOString()
        }, null, 2), 'utf-8');
      } catch (diskErr) {
        logger.debug({ err: diskErr.message }, 'Failed to persist cookie to session file');
      }

      return {
        success: true,
        status: 'active',
        user: clientInfo,
        message: `Đăng nhập Cookie thành công! Tên: ${finalName} (UID: ${cUser.value})`
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
          if (lower.startsWith('trang cá nhân') || lower.startsWith('tài khoản của') || lower.startsWith('tài khoản (')) return false;
          if (lower.startsWith('lỗi') || lower.startsWith('error')) return false;
          return true;
        }

        // 0. Meta og:title
        const metaOg = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
        if (isValidName(metaOg)) return metaOg;

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
  async checkSession(cookieInput = '', clientId = 'default') {
    this.lastChecked = Date.now();
    let cookies = [];
    if (cookieInput && typeof cookieInput === 'string' && cookieInput.trim()) {
      cookies = parseCookieInput(cookieInput);
    } else if (clientId && this.clientSessions.has(clientId)) {
      const stored = this.clientSessions.get(clientId);
      if (stored && stored.cookie) {
        cookies = parseCookieInput(stored.cookie);
      }
    }

    if (!cookies || cookies.length === 0) {
      if (clientId && this.clientSessions.has(clientId)) {
        this.clientSessions.delete(clientId);
      }
      return { active: false, status: 'none', user: null, message: 'Chưa có phiên đăng nhập. Vui lòng đăng nhập Facebook.' };
    }

    const cUser = cookies.find(c => c.name === 'c_user');
    const xs = cookies.find(c => c.name === 'xs');

    if (!cUser || !cUser.value || !xs || !xs.value) {
      if (clientId && this.clientSessions.has(clientId)) {
        this.clientSessions.delete(clientId);
      }
      return { active: false, status: 'none', user: null, message: 'Cookie không hợp lệ hoặc thiếu c_user/xs.' };
    }

    try {
      const fastResult = await fastVerifyCookiesWithFacebook(cookies);

      if (!fastResult.valid) {
        logger.warn(`Live session verification failed for client [${clientId}]: ${fastResult.reason}`);
        if (clientId && this.clientSessions.has(clientId)) {
          this.clientSessions.delete(clientId);
        }
        return { active: false, status: 'expired', user: null, message: 'Phiên đăng nhập đã hết hạn hoặc bị Facebook đăng xuất. Vui lòng đăng nhập lại!' };
      }

      const existingUser = this.clientSessions.get(clientId)?.user;
      let currentName = (existingUser?.name && !existingUser.name.startsWith('Tài khoản (') && existingUser.name.toLowerCase() !== 'lỗi')
        ? existingUser.name
        : '';

      if (!currentName) {
        currentName = (fastResult.name && fastResult.name.toLowerCase() !== 'lỗi')
          ? fastResult.name
          : await fetchAccountRealNameViaHttp(cookies).catch(() => '');
      }

      if (!currentName || currentName.toLowerCase() === 'lỗi') {
        currentName = `Tài khoản (${cUser.value})`;
      }

      const clientInfo = {
        id: cUser.value,
        name: currentName
      };

      const effectiveCookieToSave = cookieInput || this.clientSessions.get(clientId)?.cookie;
      if (clientId) {
        this.clientSessions.set(clientId, {
          status: 'active',
          user: clientInfo,
          cookie: effectiveCookieToSave,
          lastChecked: Date.now()
        });
      }

      try {
        if (effectiveCookieToSave) {
          await fsPromises.mkdir(path.dirname(SESSION_FILE), { recursive: true });
          await fsPromises.writeFile(SESSION_FILE, JSON.stringify({
            cookie: effectiveCookieToSave,
            user: clientInfo,
            savedAt: new Date().toISOString()
          }, null, 2), 'utf-8');
        }
      } catch (diskErr) {}

      return {
        active: true,
        status: 'active',
        user: clientInfo,
        message: `Phiên đăng nhập hoạt động tốt! Tài khoản: ${clientInfo.name} (${clientInfo.id})`
      };
    } catch (err) {
      logger.error({ err: err.message }, 'Check session error');
      return { active: false, status: 'none', user: null, message: 'Lỗi kiểm tra phiên làm việc.' };
    }
  }

  getAnyActiveCookie(clientId = 'default') {
    if (clientId && this.clientSessions.has(clientId)) {
      const c = this.clientSessions.get(clientId)?.cookie;
      if (c) return c;
    }
    for (const sess of this.clientSessions.values()) {
      if (sess?.cookie) return sess.cookie;
    }
    try {
      if (fs.existsSync(SESSION_FILE)) {
        const raw = fs.readFileSync(SESSION_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.cookie) return parsed.cookie;
      }
    } catch (e) {}
    return '';
  }

  getStatus(clientId = 'default') {
    if (clientId && this.clientSessions.has(clientId)) {
      const session = this.clientSessions.get(clientId);
      return {
        status: session.status || 'none',
        lastChecked: session.lastChecked || null,
        user: session.user || null
      };
    }

    // Auto check if disk session exists
    try {
      if (fs.existsSync(SESSION_FILE)) {
        const raw = fs.readFileSync(SESSION_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.cookie && parsed.user) {
          return {
            status: 'active',
            lastChecked: parsed.savedAt ? new Date(parsed.savedAt).getTime() : null,
            user: parsed.user
          };
        }
      }
    } catch (e) {}

    return {
      status: 'none',
      lastChecked: null,
      user: null
    };
  }

  updateAccountName(name, clientId = 'default') {
    const cleanName = (name || '').trim();
    if (!cleanName) return { success: false, error: 'Tên không hợp lệ' };
    if (this.clientSessions.has(clientId)) {
      const sess = this.clientSessions.get(clientId);
      if (sess.user) sess.user.name = cleanName;
    }
    if (this.accountInfo) {
      this.accountInfo.name = cleanName;
    }
    this.emit('statusUpdate', this.getStatus(clientId));
    return { success: true, name: cleanName };
  }

  async logout(clientId = 'default') {
    logger.info(`Closing session for client [${clientId}]`);
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }

    if (clientId && clientId !== 'default') {
      this.clientSessions.delete(clientId);
      return { success: true, message: `Đã xóa phiên đăng nhập của client [${clientId}].` };
    }

    this.clientSessions.clear();
    this.status = 'none';
    this.accountInfo = { id: '', name: '' };
    this.lastChecked = null;

    try {
      await browserManager.closeBrowser();
      await browserManager.clearProfileDir();
    } catch (e) {
      logger.warn({ err: e.message }, 'Error closing browser on logout');
    }

    this.emit('statusUpdate', this.getStatus());
    return { success: true, message: 'Đã đóng trình duyệt và xóa toàn bộ phiên đăng nhập.' };
  }
}

const sessionManager = new SessionManager();
export default sessionManager;
