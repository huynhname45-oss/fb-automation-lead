import ExcelJS from 'exceljs';
import logger from './logger.js';
import browserManager from './browser-manager.js';
import { parseCookieInput } from './session-manager.js';
import configManager from './config-manager.js';

/**
 * Group Manager - Fetches ALL Facebook groups the user has joined
 * Supports:
 * 1. Graph API with Access Token (auto-paginated)
 * 2. Cookie HTML fetch via mobile/mbasic (ultra-fast, zero browser overhead)
 * 3. Playwright browser automation on /groups/joins/ (bulletproof fallback)
 */
export class GroupManager {
  /**
   * Normalize raw group object into unified structure
   */
  static normalizeGroup(raw = {}) {
    let id = String(raw.id || '').trim();
    const slug = raw.slug || (id && !/^\d+$/.test(id) ? id : '');
    const name = String(raw.name || '').trim();
    const url = raw.url || (id ? `https://www.facebook.com/groups/${id}/` : '');
    
    let privacy = 'Công khai';
    const rawPriv = String(raw.privacy || raw.visibility || '').toUpperCase();
    if (rawPriv.includes('CLOSE') || rawPriv.includes('SECRET') || rawPriv.includes('PRIVATE') || rawPriv.includes('RIÊNG') || rawPriv.includes('KÍN')) {
      privacy = 'Riêng tư';
    }

    return {
      id,
      slug,
      name,
      url,
      privacy,
      membersCount: typeof raw.membersCount === 'number' ? raw.membersCount : (raw.members_count || null),
      avatar: raw.avatar || raw.icon || (raw.picture?.data?.url || '')
    };
  }

  /**
   * Cache for resolved numeric group IDs from vanity slugs
   */
  static _slugCache = new Map();

  /**
   * Resolve numeric Facebook Group ID from vanity text slug
   */
  static async resolveNumericGroupId(slug, cookieHeader = '') {
    if (!slug || typeof slug !== 'string') return null;
    const cleanSlug = slug.trim();
    if (/^\d+$/.test(cleanSlug)) return cleanSlug;

    if (this._slugCache.has(cleanSlug)) {
      return this._slugCache.get(cleanSlug);
    }

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Cookie': cookieHeader || '',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
    };

    // 1. Ultra-fast OpenGraph resolve using facebookexternalhit User-Agent
    try {
      const resMeta = await fetch(`https://www.facebook.com/groups/${encodeURIComponent(cleanSlug)}/`, {
        method: 'GET',
        headers: {
          'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(7000)
      });

      if (resMeta.ok) {
        const text = await resMeta.text();
        const m = text.match(/fb:\/\/group\/(\d+)/i) ||
                  text.match(/fb:\/\/group\/\?id=(\d+)/i) ||
                  text.match(/property=["']al:android:url["'][^>]*content=["'][^"']*?(\d{8,})["']/i) ||
                  text.match(/content=["'][^"']*?(\d{8,})["'][^>]*property=["']al:android:url["']/i) ||
                  text.match(/property=["']al:ios:url["'][^>]*content=["'][^"']*?id=(\d{8,})["']/i) ||
                  text.match(/content=["'][^"']*?id=(\d{8,})["'][^>]*property=["']al:ios:url["']/i) ||
                  text.match(/["']groupID["']\s*:\s*["'](\d+)["']/i) ||
                  text.match(/["']entity_id["']\s*:\s*["'](\d+)["']/i) ||
                  text.match(/["']target_id["']\s*:\s*["'](\d+)["']/i);
        if (m && m[1]) {
          this._slugCache.set(cleanSlug, m[1]);
          return m[1];
        }
      }
    } catch (e) {
      logger.debug({ slug: cleanSlug, err: e.message }, '[RESOLVE GROUP ID] facebookexternalhit failed');
    }

    // 2. Try mbasic.facebook.com/groups/<slug>/
    try {
      const res = await fetch(`https://mbasic.facebook.com/groups/${encodeURIComponent(cleanSlug)}/`, {
        method: 'GET',
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(6000)
      });

      if (res.ok) {
        const html = await res.text();

        // Android / iOS deep link
        const androidMatch = html.match(/content=["']fb:\/\/group\/(\d+)["']/i) ||
                             html.match(/fb:\/\/group\/(\d+)/i) ||
                             html.match(/fb:\/\/group\/\?id=(\d+)/i);
        if (androidMatch && androidMatch[1]) {
          this._slugCache.set(cleanSlug, androidMatch[1]);
          return androidMatch[1];
        }

        const metaMatch = html.match(/property=["']al:android:url["'][^>]*content=["'][^"']*?(\d{8,})["']/i) ||
                          html.match(/content=["'][^"']*?(\d{8,})["'][^>]*property=["']al:android:url["']/i) ||
                          html.match(/property=["']al:ios:url["'][^>]*content=["'][^"']*?id=(\d{8,})["']/i) ||
                          html.match(/content=["'][^"']*?id=(\d{8,})["'][^>]*property=["']al:ios:url["']/i);
        if (metaMatch && metaMatch[1]) {
          this._slugCache.set(cleanSlug, metaMatch[1]);
          return metaMatch[1];
        }

        // Leave group link
        const leaveMatch = html.match(/\/group\/leave\/\?[^"']*group_id=(\d+)/i);
        if (leaveMatch && leaveMatch[1]) {
          this._slugCache.set(cleanSlug, leaveMatch[1]);
          return leaveMatch[1];
        }

        // Members link
        const memMatch = html.match(/\/browse\/group\/members\/\?[^"']*id=(\d+)/i);
        if (memMatch && memMatch[1]) {
          this._slugCache.set(cleanSlug, memMatch[1]);
          return memMatch[1];
        }

        // Form inputs: target or ft_ent_identifier or id
        const formMatch = html.match(/name=["'](?:target|ft_ent_identifier|id)["'][^>]*value=["'](\d{8,})["']/i) ||
                          html.match(/value=["'](\d{8,})["'][^>]*name=["'](?:target|ft_ent_identifier|id)["']/i);
        if (formMatch && formMatch[1]) {
          this._slugCache.set(cleanSlug, formMatch[1]);
          return formMatch[1];
        }

        // Report group URL
        const reportMatch = html.match(/\/report\/group\/\?[^"']*group_id=(\d+)/i);
        if (reportMatch && reportMatch[1]) {
          this._slugCache.set(cleanSlug, reportMatch[1]);
          return reportMatch[1];
        }
      }
    } catch (e) {
      logger.warn({ slug: cleanSlug, err: e.message }, '[RESOLVE GROUP ID] Không thể resolve ID từ mbasic');
    }

    // 2. Try www.facebook.com/groups/<slug>/
    try {
      const resWww = await fetch(`https://www.facebook.com/groups/${encodeURIComponent(cleanSlug)}/`, {
        method: 'GET',
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(6000)
      });

      if (resWww.ok) {
        const htmlWww = await resWww.text();
        const wwwMatch = htmlWww.match(/["']groupID["']\s*:\s*["'](\d+)["']/i) ||
                         htmlWww.match(/["']entity_id["']\s*:\s*["'](\d+)["']/i) ||
                         htmlWww.match(/["']target_id["']\s*:\s*["'](\d+)["']/i) ||
                         htmlWww.match(/fb:\/\/group\/(\d+)/i) ||
                         htmlWww.match(/delegate_page["']\s*:\s*\{[^}]*["']id["']\s*:\s*["'](\d+)["']/i);
        if (wwwMatch && wwwMatch[1]) {
          this._slugCache.set(cleanSlug, wwwMatch[1]);
          return wwwMatch[1];
        }
      }
    } catch (e) {
      logger.warn({ slug: cleanSlug, err: e.message }, '[RESOLVE GROUP ID] Không thể resolve ID từ www.facebook.com');
    }

    return null;
  }

  /**
   * Extract Facebook Access Token (EAAB...) directly from user Cookie
   */
  static async extractTokenFromCookie(cookieInput) {
    const cookies = Array.isArray(cookieInput) ? cookieInput : parseCookieInput(cookieInput);
    if (!cookies || cookies.length === 0) return null;
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Cookie': cookieHeader,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
    };

    // 1. Try business.facebook.com/content_management
    try {
      const res = await fetch('https://business.facebook.com/content_management', {
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) {
        const text = await res.text();
        const m = text.match(/(EAAB\w{20,})/);
        if (m && m[1]) {
          logger.info('[TOKEN EXTRACT] Đã tự động trích xuất được Facebook Access Token từ business.facebook.com');
          return m[1];
        }
      }
    } catch (e) {}

    // 2. Try adsmanager.facebook.com/adsmanager/manage/campaigns
    try {
      const res = await fetch('https://adsmanager.facebook.com/adsmanager/manage/campaigns', {
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) {
        const text = await res.text();
        const m = text.match(/(EAAB\w{20,})/);
        if (m && m[1]) {
          logger.info('[TOKEN EXTRACT] Đã tự động trích xuất được Facebook Access Token từ adsmanager.facebook.com');
          return m[1];
        }
      }
    } catch (e) {}

    return null;
  }

  /**
   * Fetch all joined groups using Facebook Graph API
   * Recursively follows paging.next until all groups are retrieved.
   */
  static async fetchViaGraphAPI(accessToken) {
    if (!accessToken || typeof accessToken !== 'string') {
      throw new Error('Access Token không hợp lệ. Vui lòng kiểm tra lại!');
    }

    const cleanToken = accessToken.trim();
    const groups = [];
    const seenIds = new Set();
    let nextUrl = `https://graph.facebook.com/v20.0/me/groups?fields=id,name,privacy,members_count,icon,picture.type(large)&limit=250&access_token=${encodeURIComponent(cleanToken)}`;

    let pageIndex = 1;
    while (nextUrl) {
      logger.info(`[GRAPH API] Đang tải trang ${pageIndex} danh sách nhóm...`);
      const res = await fetch(nextUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const errMsg = errJson.error?.message || `HTTP ${res.status}: ${res.statusText}`;
        logger.error({ err: errMsg }, '[GRAPH API] Lỗi khi gọi Facebook Graph API');
        throw new Error(`Facebook Graph API lỗi: ${errMsg}`);
      }

      const json = await res.json();
      const items = Array.isArray(json.data) ? json.data : [];

      for (const item of items) {
        if (!item.id || seenIds.has(String(item.id))) continue;
        seenIds.add(String(item.id));
        groups.push(this.normalizeGroup({
          id: item.id,
          name: item.name,
          privacy: item.privacy,
          membersCount: item.members_count,
          avatar: item.picture?.data?.url || item.icon,
          url: `https://www.facebook.com/groups/${item.id}/`
        }));
      }

      nextUrl = json.paging?.next || null;
      pageIndex++;
      
      // Safety limit to avoid infinite loops (up to 5000 groups)
      if (pageIndex > 20) break;
    }

    logger.info(`[GRAPH API] Đã lấy thành công ${groups.length} nhóm đã tham gia.`);
    return groups;
  }

  /**
   * Fetch all joined groups using user Cookies via mbasic/mobile HTML
   */
  static async fetchViaCookie(cookieInput) {
    const cookies = Array.isArray(cookieInput) ? cookieInput : parseCookieInput(cookieInput);
    if (!cookies || cookies.length === 0) {
      throw new Error('Chưa có Cookie Facebook để tải nhóm. Vui lòng đăng nhập hoặc dán Cookie!');
    }

    const cUser = cookies.find(c => c.name === 'c_user')?.value;
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const groups = [];
    const seenIds = new Set();

    let targetUrl = 'https://mbasic.facebook.com/groups/?seemore';
    let pageCount = 0;
    const maxPages = 40; // Up to ~2000 groups

    while (targetUrl && pageCount < maxPages) {
      pageCount++;
      logger.info(`[COOKIE MBASIC] Đang tải trang ${pageCount}: ${targetUrl}`);

      const res = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Cookie': cookieHeader,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
        },
        redirect: 'follow'
      });

      if (!res.ok) {
        logger.warn(`[COOKIE MBASIC] HTTP ${res.status} khi tải ${targetUrl}`);
        break;
      }

      const html = await res.text();
      if (html.includes('/login') || html.includes('checkpoint')) {
        throw new Error('Phiên Cookie Facebook đã hết hạn hoặc bị đăng xuất. Vui lòng cập nhật lại Cookie!');
      }

      // Regex extracting group anchors: /groups/([a-zA-Z0-9._-]+)/?
      const anchorRegex = /<a\s+[^>]*href=["'](?:https?:\/\/[^"'/]+)?\/groups\/([a-zA-Z0-9._-]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
      let match;
      let foundInThisPage = 0;

      while ((match = anchorRegex.exec(html)) !== null) {
        const groupSlug = match[1];
        let rawText = match[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#039;/g, "'").trim();

        // Skip non-group anchors like "Tạo nhóm", "Khám phá", "Cài đặt"
        if (!groupSlug || ['create', 'discover', 'feed', 'notifications', 'search', 'joins', 'category', 'browse', 'your_groups', 'settings', 'edit', 'member'].includes(groupSlug.toLowerCase())) {
          continue;
        }

        // Surrounding context to extract privacy and membersCount
        const contextSnippet = html.substring(match.index, match.index + match[0].length + 220);
        let privacy = 'Công khai';
        if (/riêng tư|kín|secret|close|private/i.test(contextSnippet)) {
          privacy = 'Riêng tư';
        }

        let membersCount = null;
        const memMatch = contextSnippet.match(/([\d.,]+)\s*(?:k|tr|triệu|nghìn|ngàn|thành viên|members)/i);
        if (memMatch) {
          let numRaw = memMatch[1].replace(/\s/g, '');
          if (/k/i.test(memMatch[0])) {
            membersCount = Math.round(parseFloat(numRaw.replace(',', '.')) * 1000);
          } else if (/tr|triệu/i.test(memMatch[0])) {
            membersCount = Math.round(parseFloat(numRaw.replace(',', '.')) * 1000000);
          } else {
            membersCount = parseInt(numRaw.replace(/[.,]/g, ''), 10) || null;
          }
        }

        // Avatar
        const preSnippet = html.substring(Math.max(0, match.index - 200), match.index);
        const imgMatch = preSnippet.match(/<img[^>]+src=["']([^"']+)["']/i) || contextSnippet.match(/<img[^>]+src=["']([^"']+)["']/i);
        const avatar = imgMatch ? imgMatch[1].replace(/&amp;/g, '&') : '';

        if (rawText.includes('\n')) {
          rawText = rawText.split('\n')[0].trim();
        }
        rawText = rawText.replace(/·.*$/, '').trim();

        if (rawText && rawText.length >= 2 && !seenIds.has(groupSlug)) {
          seenIds.add(groupSlug);
          foundInThisPage++;
          groups.push(this.normalizeGroup({
            id: groupSlug,
            name: rawText,
            url: `https://www.facebook.com/groups/${groupSlug}/`,
            privacy,
            membersCount,
            avatar
          }));
        }
      }

      // Find "Xem thêm" pagination link: href="/groups/?seemore&start=..."
      const seemoreMatch = html.match(/<a[^>]+href=["'](\/groups\/\?[^"']*(?:seemore|start=[0-9]+)[^"']*)["'][^>]*>[\s\S]*?(?:Xem thêm|See more|nhóm khác)[\s\S]*?<\/a>/i) ||
                           html.match(/<a[^>]+href=["'](\/groups\/\?[^"']*(?:seemore|start=[0-9]+)[^"']*)["']/i);
      if (seemoreMatch && seemoreMatch[1]) {
        targetUrl = 'https://mbasic.facebook.com' + seemoreMatch[1].replace(/&amp;/g, '&');
      } else if (pageCount === 1 && foundInThisPage === 0 && targetUrl.includes('?seemore')) {
        targetUrl = 'https://mbasic.facebook.com/groups/';
      } else {
        targetUrl = null;
      }

      if (foundInThisPage === 0 && pageCount > 1) break;
    }

    // Batch-resolve any text vanity slugs to real numeric Group IDs
    const unresolved = groups.filter(g => g.id && !/^\d+$/.test(g.id));
    if (unresolved.length > 0) {
      logger.info(`[COOKIE MBASIC] Tìm thấy ${unresolved.length} nhóm có slug dạng chữ, đang chuyển đổi sang Numeric Group ID...`);
      const BATCH_SIZE = 5;
      for (let i = 0; i < unresolved.length; i += BATCH_SIZE) {
        const batch = unresolved.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (g) => {
          const numId = await this.resolveNumericGroupId(g.id, cookieHeader);
          if (numId && /^\d+$/.test(numId)) {
            g.slug = g.id;
            g.id = numId;
            g.url = `https://www.facebook.com/groups/${numId}/`;
          }
        }));
      }
      logger.info(`[COOKIE MBASIC] Hoàn tất chuyển đổi Numeric Group ID.`);
    }

    logger.info(`[COOKIE MBASIC] Đã tải thành công ${groups.length} nhóm đã tham gia.`);
    return groups;
  }

  /**
   * Fetch all joined groups using Playwright Browser on https://www.facebook.com/groups/joins/
   */
  static async fetchViaBrowser(cookieInput = null) {
    const isHeadless = !!configManager.get('headless');
    const context = await browserManager.launch(isHeadless);

    if (cookieInput) {
      const cookies = Array.isArray(cookieInput) ? cookieInput : parseCookieInput(cookieInput);
      if (cookies.length > 0) {
        await context.addCookies(cookies);
      }
    }

    let page;
    try {
      const pages = context.pages();
      page = pages.length > 0 ? pages[0] : await context.newPage();

      logger.info('1. Đang mở trang https://www.facebook.com/groups/joins/ để tải danh sách nhóm...');
      await page.goto('https://www.facebook.com/groups/joins/', { waitUntil: 'domcontentloaded', timeout: 35000 });
      await new Promise(r => setTimeout(r, 2500));

      const isLoginPage = await page.evaluate(() => {
        return window.location.href.includes('/login') || !!document.querySelector('input[name="email"]');
      });

      if (isLoginPage) {
        throw new Error('Chưa đăng nhập Facebook hoặc phiên làm việc đã hết hạn. Vui lòng đăng nhập lại tại Tab Session Manager!');
      }

      // Infinite scroll to load all groups
      let scrollAttempts = 0;
      let lastGroupCount = 0;
      let stableCountTimes = 0;

      while (scrollAttempts < 60) {
        scrollAttempts++;
        const currentCount = await page.evaluate(() => {
          return document.querySelectorAll('a[href*="/groups/"]').length;
        });

        if (currentCount === lastGroupCount) {
          stableCountTimes++;
          if (stableCountTimes >= 3) break;
        } else {
          stableCountTimes = 0;
          lastGroupCount = currentCount;
        }

        await page.evaluate(() => window.scrollBy(0, 1500));
        await new Promise(r => setTimeout(r, 1200));
      }

      // Extract all group cards from the fully scrolled page
      const rawGroups = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a[href*="/groups/"]'));
        const list = [];
        const seen = new Set();

        for (const a of anchors) {
          const href = a.getAttribute('href') || '';
          const m = href.match(/\/groups\/([^/?#]+)/i);
          if (!m || !m[1]) continue;
          const slug = m[1];
          if (['create', 'discover', 'feed', 'notifications', 'search', 'joins', 'member'].includes(slug.toLowerCase())) {
            continue;
          }

          if (seen.has(slug)) continue;
          seen.add(slug);

          // Find group title
          const card = a.closest('div[role="listitem"]') || a.closest('div[role="article"]') || a.parentElement;
          const nameEl = card ? (card.querySelector('span[dir="auto"], strong, h3, h2') || a) : a;
          const name = (nameEl.innerText || a.innerText || '').trim().split('\n')[0].trim();

          const fullCardText = (card?.innerText || '').toLowerCase();
          let privacy = 'Công khai';
          if (fullCardText.includes('riêng tư') || fullCardText.includes('private') || fullCardText.includes('kín')) {
            privacy = 'Riêng tư';
          }

          const img = card ? card.querySelector('img[src], image') : null;
          const avatar = img?.getAttribute('src') || '';

          if (name && name.length >= 2) {
            list.push({
              id: slug,
              name,
              url: `https://www.facebook.com/groups/${slug}/`,
              privacy,
              avatar
            });
          }
        }

        return list;
      });

      logger.info(`[PLAYWRIGHT BROWSER] Đã tải thành công ${rawGroups.length} nhóm từ trang web.`);
      const normalized = rawGroups.map(g => this.normalizeGroup(g));

      // Batch-resolve any unresolved text slugs
      const unresolvedInBrowser = normalized.filter(g => g.id && !/^\d+$/.test(g.id));
      if (unresolvedInBrowser.length > 0) {
        logger.info(`[PLAYWRIGHT BROWSER] Đang chuyển đổi ${unresolvedInBrowser.length} nhóm dạng slug chữ sang Numeric Group ID...`);
        const cookieHeader = cookieInput ? (Array.isArray(cookieInput) ? cookieInput : parseCookieInput(cookieInput)).map(c => `${c.name}=${c.value}`).join('; ') : '';
        const BATCH_SIZE = 5;
        for (let i = 0; i < unresolvedInBrowser.length; i += BATCH_SIZE) {
          const batch = unresolvedInBrowser.slice(i, i + BATCH_SIZE);
          await Promise.all(batch.map(async (g) => {
            const numId = await this.resolveNumericGroupId(g.id, cookieHeader);
            if (numId && /^\d+$/.test(numId)) {
              g.slug = g.id;
              g.id = numId;
              g.url = `https://www.facebook.com/groups/${numId}/`;
            }
          }));
        }
      }

      return normalized;

    } finally {
      if (page && !page.isClosed()) await page.close().catch(() => {});
      await browserManager.closeBrowser().catch(() => {});
    }
  }

  /**
   * Unified fetch: Automatically selects best method (Token > Cookie > Browser)
   */
  static async fetchAllGroups({ token = '', cookie = '', method = 'auto', clientId = 'default' } = {}) {
    // 1. If explicit Graph API token provided
    if (method === 'token' || (method === 'auto' && token && token.trim().length > 20)) {
      logger.info('🚀 Đang tải danh sách nhóm qua Facebook Graph API...');
      return await this.fetchViaGraphAPI(token.trim());
    }

    // 2. If cookie provided: try extracting Access Token first for instant Graph API
    if (cookie && cookie.trim().length > 10) {
      if (method === 'auto' || method === 'cookie') {
        try {
          const autoToken = await this.extractTokenFromCookie(cookie);
          if (autoToken) {
            logger.info('🔑 Tự động lấy được Access Token từ Cookie! Sử dụng Facebook Graph API...');
            const graphGroups = await this.fetchViaGraphAPI(autoToken);
            if (graphGroups.length > 0) return graphGroups;
          }
        } catch (tokenErr) {
          logger.warn({ err: tokenErr.message }, 'Tự động lấy Access Token từ Cookie không khả dụng, tiếp tục quét HTML...');
        }

        try {
          logger.info('🚀 Đang tải danh sách nhóm qua Cookie Facebook...');
          const cookieGroups = await this.fetchViaCookie(cookie);
          if (cookieGroups.length > 0) return cookieGroups;
        } catch (cookieErr) {
          logger.warn({ err: cookieErr.message }, 'Tải nhóm qua Cookie HTML lỗi, tự động chuyển sang Playwright...');
        }
      }
    }

    // 3. Fallback to Playwright
    logger.info('🚀 Đang tải danh sách nhóm qua Playwright Browser...');
    return await this.fetchViaBrowser(cookie);
  }

  /**
   * Export groups to Excel Buffer
   */
  static async exportToExcelBuffer(groups = []) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'FB Automation Tool';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Danh Sách Nhóm Đã Tham Gia');

    sheet.columns = [
      { header: 'STT', key: 'stt', width: 8 },
      { header: 'Tên Nhóm Facebook', key: 'name', width: 45 },
      { header: 'ID Nhóm (Group ID)', key: 'id', width: 22 },
      { header: 'Quyền Riêng Tư', key: 'privacy', width: 18 },
      { header: 'Số Lượng Thành Viên', key: 'membersCount', width: 22 },
      { header: 'Liên Kết Nhóm (URL)', key: 'url', width: 50 }
    ];

    // Style Header Row
    const headerRow = sheet.getRow(1);
    headerRow.height = 28;
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4F46E5' } // Indigo purple
      };
      cell.font = {
        name: 'Segoe UI',
        size: 11,
        bold: true,
        color: { argb: 'FFFFFFFF' }
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'medium', color: { argb: 'FFCBD5E1' } }
      };
    });

    // Populate data
    groups.forEach((g, idx) => {
      const row = sheet.addRow({
        stt: idx + 1,
        name: g.name,
        id: g.id,
        privacy: g.privacy || 'Công khai',
        membersCount: g.membersCount ? Number(g.membersCount).toLocaleString('vi-VN') : '—',
        url: g.url
      });

      row.height = 22;
      row.alignment = { vertical: 'middle' };
      row.getCell('stt').alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell('id').alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell('privacy').alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell('membersCount').alignment = { vertical: 'middle', horizontal: 'center' };

      // Alternating row background
      if (idx % 2 === 1) {
        row.eachCell((cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF8FAFC' }
          };
        });
      }
    });

    return await workbook.xlsx.writeBuffer();
  }
}

export default GroupManager;
