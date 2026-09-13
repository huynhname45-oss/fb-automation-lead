import path from 'path';
import fs from 'fs/promises';
import logger from './logger.js';
import { extractLocationDetailed } from './location-extractor.js';

const CWD = process.cwd();
const DATA_DIR = path.join(CWD, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

/**
 * Checks if a URL is a direct Facebook post permalink
 */
export function isDirectPostUrl(url = '') {
  if (!url || typeof url !== 'string') return false;
  return /\/(?:posts|photos|permalink|reel|videos|watch|photo)\/|(?:story_fbid|fbid)=/i.test(url);
}

/**
 * Extract canonical Post Key (Post ID, Clean URL, or Content Signature)
 */
export function getCanonicalPostKey(post) {
  if (!post) return '';

  const postLink = post.postLink || post.postUrl || '';

  if (postLink && typeof postLink === 'string' && isDirectPostUrl(postLink)) {
    // 1. Extract story_fbid or fbid parameter
    const fbidMatch = postLink.match(/(?:story_fbid|fbid)=([a-zA-Z0-9_-]+)/i);
    if (fbidMatch && fbidMatch[1]) {
      return `fbid_${fbidMatch[1]}`.toLowerCase();
    }

    // 2. Extract /photos/a.123/9876543210 or /posts/pfbid... or /videos/123...
    const photoAlbumMatch = postLink.match(/\/photos\/[^/]+\/(\d+)/i);
    if (photoAlbumMatch && photoAlbumMatch[1]) {
      return `post_${photoAlbumMatch[1]}`.toLowerCase();
    }

    const pathMatch = postLink.match(/\/(?:posts|photos|permalink|reel|videos|watch|photo)\/([a-zA-Z0-9_-]+)/i);
    if (pathMatch && pathMatch[1]) {
      return `post_${pathMatch[1]}`.toLowerCase();
    }

    // 3. Clean URL without tracking query strings (?__cft__=..., &ref=...)
    try {
      const u = new URL(postLink);
      return `url_${u.origin}${u.pathname}`.toLowerCase().trim();
    } catch (e) {
      return `url_${postLink.split('?')[0]}`.toLowerCase().trim();
    }
  }

  // 4. Content fallback signature (Author + First 60 chars of text)
  const cleanAuthor = (post.authorName || '').toLowerCase().trim();
  const cleanSnippet = (post.content || '').replace(/\s+/g, ' ').trim().substring(0, 60).toLowerCase();
  return `sig_${cleanAuthor}_${cleanSnippet}`;
}

class HistoryManager {
  constructor() {
    this.history = [];
    this.initPromise = this.init();
  }

  async init() {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      try {
        const raw = await fs.readFile(HISTORY_FILE, 'utf-8');
        this.history = JSON.parse(raw);
        if (!Array.isArray(this.history)) this.history = [];
        
        // Auto-backfill location & postedTime & unique ID for past historical records
        let updatedExisting = false;
        for (let i = 0; i < this.history.length; i++) {
          const item = this.history[i];
          if (!item.id) {
            item.id = `lead_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}`;
            updatedExisting = true;
          }

          if (!item.location || item.location === '—') {
            const loc = extractLocationDetailed({ content: item.content, authorName: item.authorName });
            if (loc.confidence >= 0.75 && !loc.conflict && loc.province !== '—') {
              item.location = loc.province;
              item.locationSource = item.locationSource || loc.source;
              item.locationConfidence = item.locationConfidence ?? loc.confidence;
              item.locationEvidence = item.locationEvidence || loc.evidence;
              updatedExisting = true;
            } else if (!item.location) {
              item.location = '—';
            }
          }

          if (!item.postedTime || item.postedTime.trim() === '' || item.postedTime === 'Không xác định') {
            if (item.createdAt) {
              const d = new Date(item.createdAt);
              const hours = String(d.getHours()).padStart(2, '0');
              const mins = String(d.getMinutes()).padStart(2, '0');
              const day = String(d.getDate()).padStart(2, '0');
              const month = String(d.getMonth() + 1).padStart(2, '0');
              const year = d.getFullYear();
              item.postedTime = `${hours}:${mins} ${day}/${month}/${year}`;
              updatedExisting = true;
            } else {
              item.postedTime = 'Gần đây';
              updatedExisting = true;
            }
          }
        }
        if (updatedExisting) {
          await this.persist();
        }

        logger.info(`Loaded ${this.history.length} historical extraction records from ${HISTORY_FILE}`);
      } catch (e) {
        this.history = [];
        await this.persist();
      }
    } catch (err) {
      logger.error({ err }, 'Failed to initialize HistoryManager');
    }
  }

  async persist() {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(HISTORY_FILE, JSON.stringify(this.history, null, 2), 'utf-8');
    } catch (err) {
      logger.error({ err }, 'Failed to persist extraction history');
    }
  }

  async hasPost(post) {
    await this.initPromise;
    const targetKey = getCanonicalPostKey(post);
    if (!targetKey) return false;

    return this.history.some(existing => getCanonicalPostKey(existing) === targetKey);
  }

  async addPosts(newPosts = []) {
    await this.initPromise;
    if (!Array.isArray(newPosts) || newPosts.length === 0) return this.history;

    let addedCount = 0;
    const existingKeys = new Set(this.history.map(getCanonicalPostKey));

    for (const post of newPosts) {
      const key = getCanonicalPostKey(post);
      if (!key) continue;

      if (!existingKeys.has(key)) {
        existingKeys.add(key);
        // Unshift newest posts to top
        this.history.unshift({
          ...post,
          id: post.id || `lead_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          location: post.location || (() => {
            const loc = extractLocationDetailed({ content: post.content, authorName: post.authorName });
            return loc.confidence >= 0.75 && !loc.conflict ? loc.province : '—';
          })(),
          status: post.status || 'Mới tạo',
          createdAt: post.createdAt || new Date().toISOString()
        });
        addedCount++;
      }
    }

    if (addedCount > 0) {
      await this.persist();
      logger.info(`Saved ${addedCount} new posts into extraction history (Total: ${this.history.length})`);
    } else {
      logger.info('Tất cả bài viết bóc tách đều đã tồn tại trong lịch sử (Không có bài mới cần lưu).');
    }

    return this.history;
  }

  async getHistory() {
    await this.initPromise;
    try {
      const raw = await fs.readFile(HISTORY_FILE, 'utf-8');
      const diskHistory = JSON.parse(raw);
      if (Array.isArray(diskHistory)) {
        this.history = diskHistory;
      }
    } catch (e) {
      // fallback to memory
    }
    return this.history;
  }

  async clearHistory() {
    await this.initPromise;
    this.history = [];
    await this.persist();
    return [];
  }

  async deletePostsByKeys(keys = []) {
    await this.initPromise;
    if (!Array.isArray(keys) || keys.length === 0) return this.history;

    const normalizedKeySet = new Set(keys.map(k => String(k).normalize('NFC').toLowerCase().trim()));
    const rawKeySet = new Set(keys.map(k => String(k).trim()));

    const prevCount = this.history.length;
    this.history = this.history.filter(post => {
      // 1. Direct ID & Key match
      if (post.key && (rawKeySet.has(post.key) || normalizedKeySet.has(String(post.key).toLowerCase()))) {
        return false;
      }
      if (post.id && (rawKeySet.has(post.id) || normalizedKeySet.has(String(post.id).toLowerCase()))) {
        return false;
      }
      if (post._id && (rawKeySet.has(post._id) || normalizedKeySet.has(String(post._id).toLowerCase()))) {
        return false;
      }

      // 2. Canonical key match
      const key = getCanonicalPostKey(post);
      const keyNFC = String(key).normalize('NFC').toLowerCase().trim();
      if (normalizedKeySet.has(keyNFC)) return false;

      // 3. Match by authorName + content snippet
      const author = (post.authorName || '').normalize('NFC').toLowerCase().trim();
      const content = (post.content || '').normalize('NFC').toLowerCase().trim();
      for (const k of normalizedKeySet) {
        if (author && k.includes(author)) {
          if (!post.postLink || k.includes('sig_')) return false;
        }
        if (post.postLink && k.includes(post.postLink.toLowerCase())) {
          return false;
        }
        if (post.profileLink && k.includes(post.profileLink.toLowerCase())) {
          return false;
        }
      }

      return true;
    });

    await this.persist();
    logger.info(`Deleted ${prevCount - this.history.length} items from history. Remaining: ${this.history.length}`);
    return this.history;
  }

  async updatePostStatus(key, status) {
    await this.initPromise;
    if (!key) return this.history;

    const targetKey = String(key).normalize('NFC').toLowerCase().trim();
    let updated = false;

    for (const post of this.history) {
      const pKey = String(getCanonicalPostKey(post)).normalize('NFC').toLowerCase().trim();
      if (post.id === key || pKey === targetKey || (post.authorName && targetKey.includes((post.authorName).toLowerCase()))) {
        post.status = status || 'Mới tạo';
        updated = true;
        break;
      }
    }

    if (updated) {
      await this.persist();
      logger.info(`Updated status for post [${key}] -> [${status}]`);
    }

    return this.history;
  }
}

const historyManager = new HistoryManager();
export default historyManager;
