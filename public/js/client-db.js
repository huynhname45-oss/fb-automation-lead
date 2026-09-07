/**
 * Client-Side Database Engine (IndexedDB)
 * Lưu trữ 100% dữ liệu (Leads, Session Cookie, Cấu hình) trực tiếp trên máy Client (Mac / Windows)
 */

const DB_NAME = 'FBAutomationClientDB';
const DB_VERSION = 1;

let _dbInstance = null;

/**
 * Khởi tạo kết nối IndexedDB trên trình duyệt của máy Client
 */
function initClientDB() {
    return new Promise((resolve, reject) => {
        if (_dbInstance) return resolve(_dbInstance);

        if (!window.indexedDB) {
            console.warn('[IndexedDB] Trình duyệt không hỗ trợ IndexedDB. Sử dụng LocalStorage fallback.');
            return resolve(null);
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (e) => {
            const db = e.target.result;

            // 1. Store lưu trữ bài viết & lead bóc tách
            if (!db.objectStoreNames.contains('leads')) {
                const leadsStore = db.createObjectStore('leads', { keyPath: 'key' });
                leadsStore.createIndex('status', 'status', { unique: false });
                leadsStore.createIndex('postedTime', 'postedTime', { unique: false });
                leadsStore.createIndex('aiScore', 'aiScore', { unique: false });
                leadsStore.createIndex('createdAt', 'createdAt', { unique: false });
            }

            // 2. Store lưu phiên đăng nhập Facebook của Client
            if (!db.objectStoreNames.contains('session')) {
                db.createObjectStore('session', { keyPath: 'id' });
            }

            // 3. Store lưu cấu hình & mốc thiết lập cá nhân
            if (!db.objectStoreNames.contains('config')) {
                db.createObjectStore('config', { keyPath: 'key' });
            }
        };

        request.onsuccess = (e) => {
            _dbInstance = e.target.result;
            console.log('[IndexedDB] Kết nối cơ sở dữ liệu trên máy Client thành công.');
            resolve(_dbInstance);
        };

        request.onerror = (e) => {
            console.error('[IndexedDB] Lỗi mở cơ sở dữ liệu trên máy Client:', e.target.error);
            reject(e.target.error);
        };
    });
}

/**
 * Trích xuất hoặc tạo mã định danh duy nhất (Key) cho bài viết
 */
function computeLeadKey(post) {
  if (!post) return '';
  if (post.key) return String(post.key).trim();
  if (post.id) return String(post.id).trim();
  if (post._id) return String(post._id).trim();

  const postLink = post.postLink || post.postUrl || '';
  if (postLink && typeof postLink === 'string') {
    const fbidMatch = postLink.match(/(?:story_fbid|fbid)=([a-zA-Z0-9_-]+)/i);
    if (fbidMatch && fbidMatch[1]) {
      return `fbid_${fbidMatch[1]}`.toLowerCase().trim();
    }
    const pathMatch = postLink.match(/\/(?:posts|photos|permalink|reel|videos)\/([a-zA-Z0-9_-]+)/i);
    if (pathMatch && pathMatch[1]) {
      return `post_${pathMatch[1]}`.toLowerCase().trim();
    }
    try {
      const u = new URL(postLink);
      return `url_${u.origin}${u.pathname}`.toLowerCase().trim();
    } catch (e) {
      return `url_${postLink.split('?')[0]}`.toLowerCase().trim();
    }
  }

  const cleanAuthor = (post.authorName || '').normalize('NFC').toLowerCase().trim();
  const cleanSnippet = (post.content || '').normalize('NFC').replace(/\s+/g, ' ').trim().substring(0, 60).toLowerCase();
  if (cleanAuthor || cleanSnippet) {
    return `sig_${cleanAuthor}_${cleanSnippet}`;
  }
  return `lead_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Lưu 1 Lead vào IndexedDB trên máy Client
 */
async function dbSaveLead(lead) {
    if (!lead) return;
    const cleanKey = lead.key || computeLeadKey(lead);
    if (!cleanKey) return;
    lead.key = cleanKey;

    const db = await initClientDB();
    if (!db) return;

    return new Promise((resolve, reject) => {
        const tx = db.transaction('leads', 'readwrite');
        const store = tx.objectStore('leads');
        const getReq = store.get(cleanKey);
        getReq.onsuccess = () => {
            const existing = getReq.result;
            if (existing && existing.status) {
                lead.status = existing.status;
            } else if (!lead.status) {
                lead.status = 'Mới tạo';
            }
            if (existing && existing.createdAt) {
                lead.createdAt = existing.createdAt;
            } else if (!lead.createdAt) {
                lead.createdAt = new Date().toISOString();
            }
            store.put(lead);
        };
        tx.oncomplete = () => resolve(lead);
        tx.onerror = (e) => reject(e.target.error);
    });
}

/**
 * Lưu danh sách Lead (hàng loạt) vào IndexedDB trên máy Client
 */
async function dbSaveLeads(leads = []) {
    if (!Array.isArray(leads) || leads.length === 0) return 0;
    const db = await initClientDB();
    if (!db) return 0;

    return new Promise((resolve, reject) => {
        const tx = db.transaction('leads', 'readwrite');
        const store = tx.objectStore('leads');
        let count = 0;

        leads.forEach(lead => {
            if (lead) {
                const cleanKey = lead.key || computeLeadKey(lead);
                if (cleanKey) {
                    lead.key = cleanKey;
                    const getReq = store.get(cleanKey);
                    getReq.onsuccess = () => {
                        const existing = getReq.result;
                        if (existing && existing.status) {
                            lead.status = existing.status;
                        } else if (!lead.status) {
                            lead.status = 'Mới tạo';
                        }
                        if (existing && existing.createdAt) {
                            lead.createdAt = existing.createdAt;
                        } else if (!lead.createdAt) {
                            lead.createdAt = new Date().toISOString();
                        }
                        store.put(lead);
                        count++;
                    };
                }
            }
        });

        tx.oncomplete = () => resolve(count);
        tx.onerror = (e) => reject(e.target.error);
    });
}

/**
 * Lấy toàn bộ Lead đã lưu trên máy Client
 */
async function dbGetAllLeads() {
    const db = await initClientDB();
    if (!db) return [];

    return new Promise((resolve, reject) => {
        const tx = db.transaction('leads', 'readonly');
        const store = tx.objectStore('leads');
        const req = store.getAll();

        req.onsuccess = () => {
            const results = req.result || [];
            // Sắp xếp mới nhất lên trên
            results.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
            resolve(results);
        };
        req.onerror = (e) => reject(e.target.error);
    });
}

/**
 * Cập nhật trạng thái của 1 Lead trong IndexedDB
 */
async function dbUpdateLeadStatus(key, newStatus) {
    if (!key) return null;
    const db = await initClientDB();
    if (!db) return null;

    return new Promise((resolve, reject) => {
        const tx = db.transaction('leads', 'readwrite');
        const store = tx.objectStore('leads');
        const getReq = store.get(key);

        getReq.onsuccess = () => {
            const item = getReq.result;
            if (item) {
                item.status = newStatus;
                item.updatedAt = new Date().toISOString();
                store.put(item);
                resolve(item);
            } else {
                resolve(null);
            }
        };
        getReq.onerror = (e) => reject(e.target.error);
    });
}

/**
 * Xóa các Lead đã chọn trong IndexedDB trên máy Client
 */
async function dbDeleteSelectedLeads(keys = []) {
    if (!Array.isArray(keys) || keys.length === 0) return 0;
    const db = await initClientDB();
    if (!db) return 0;

    return new Promise((resolve, reject) => {
        const tx = db.transaction('leads', 'readwrite');
        const store = tx.objectStore('leads');
        let deleted = 0;

        keys.forEach(k => {
            store.delete(k);
            deleted++;
        });

        tx.oncomplete = () => resolve(deleted);
        tx.onerror = (e) => reject(e.target.error);
    });
}

/**
 * Xóa toàn bộ dữ liệu Lead trên máy Client
 */
async function dbClearAllLeads() {
    const db = await initClientDB();
    if (!db) return;

    return new Promise((resolve, reject) => {
        const tx = db.transaction('leads', 'readwrite');
        const store = tx.objectStore('leads');
        const req = store.clear();
        req.onsuccess = () => resolve(true);
        req.onerror = (e) => reject(e.target.error);
    });
}

/**
 * Lấy tập hợp tất cả các key và phone đã tồn tại trên máy Client
 * (Dùng để chống cào trùng lặp ngay khi gửi request lên server)
 */
async function dbGetExistingSignatures() {
    const all = await dbGetAllLeads();
    const keys = [];
    const phones = [];

    all.forEach(item => {
        if (item.key) keys.push(item.key);
        if (Array.isArray(item.phones)) {
            item.phones.forEach(p => {
                const digits = String(p).replace(/[^\d]/g, '');
                if (digits.length >= 9) phones.push(digits);
            });
        }
        if (Array.isArray(item.verifiedPhones)) {
            item.verifiedPhones.forEach(p => {
                const digits = String(p).replace(/[^\d]/g, '');
                if (digits.length >= 9) phones.push(digits);
            });
        }
    });

    return {
        keys: Array.from(new Set(keys)),
        phones: Array.from(new Set(phones))
    };
}

/**
 * Quản lý Session Cookie trên máy Client
 */
async function dbSaveClientSession(sessionData) {
    if (!sessionData) return;
    const db = await initClientDB();
    if (!db) {
        localStorage.setItem('fb_client_session', JSON.stringify(sessionData));
        return;
    }

    return new Promise((resolve, reject) => {
        const tx = db.transaction('session', 'readwrite');
        const store = tx.objectStore('session');
        store.put({ id: 'current_session', ...sessionData, updatedAt: new Date().toISOString() });
        tx.oncomplete = () => {
            localStorage.setItem('fb_client_session', JSON.stringify(sessionData));
            resolve(sessionData);
        };
        tx.onerror = (e) => reject(e.target.error);
    });
}

async function dbGetClientSession() {
    const db = await initClientDB();
    if (!db) {
        try {
            return JSON.parse(localStorage.getItem('fb_client_session') || 'null');
        } catch(e) { return null; }
    }

    return new Promise((resolve) => {
        const tx = db.transaction('session', 'readonly');
        const store = tx.objectStore('session');
        const req = store.get('current_session');
        req.onsuccess = () => {
            if (req.result) {
                resolve(req.result);
            } else {
                try {
                    resolve(JSON.parse(localStorage.getItem('fb_client_session') || 'null'));
                } catch(e) { resolve(null); }
            }
        };
        req.onerror = () => {
            try {
                resolve(JSON.parse(localStorage.getItem('fb_client_session') || 'null'));
            } catch(e) { resolve(null); }
        };
    });
}

async function dbClearClientSession() {
    localStorage.removeItem('fb_client_session');
    const db = await initClientDB();
    if (!db) return;

    return new Promise((resolve) => {
        const tx = db.transaction('session', 'readwrite');
        const store = tx.objectStore('session');
        store.delete('current_session');
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
    });
}

// Export ra window toàn cầu
window.ClientDB = {
    init: initClientDB,
    computeKey: computeLeadKey,
    saveLead: dbSaveLead,
    saveLeads: dbSaveLeads,
    getAllLeads: dbGetAllLeads,
    updateStatus: dbUpdateLeadStatus,
    deleteSelected: dbDeleteSelectedLeads,
    clearAll: dbClearAllLeads,
    getSignatures: dbGetExistingSignatures,
    saveSession: dbSaveClientSession,
    getSession: dbGetClientSession,
    clearSession: dbClearClientSession
};
