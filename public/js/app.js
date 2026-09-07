const state = {
    currentTab: 'session',
    session: { status: 'none', lastChecked: null, user: null },
    search: { status: 'idle', keyword: '', results: [], progress: { found: 0, total: 10 } },
    config: { headless: false, crawlDelay: 2500, maxPosts: 10 },
    pagination: { currentPage: 1, pageSize: 10, totalPages: 1 },
    selectedKeys: new Set(),
    dateFilter: { query: '', fromDate: null, toDate: null, status: 'all', active: false },
    aiScoreFilter: 'all',
    pollingInterval: null
};

/**
 * Unique Client Identifier (Độc lập cho từng thiết bị Mac/Windows)
 */
function getClientId() {
    let id = localStorage.getItem('fb_client_id');
    if (!id) {
        id = 'client_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
        localStorage.setItem('fb_client_id', id);
    }
    return id;
}

const DEFAULT_AI_PROMPT_CONTEXT = `Bạn là chuyên gia thẩm định khách hàng tiềm năng cho phần mềm Quản lý Bán hàng (POS) như Sapo, KiotViet, Haravan, MISA.
Mục tiêu của bạn là phân tích bài viết Facebook để xác định xem người đăng có phải là CHỦ CỬA HÀNG / QUÁN ĐỘC LẬP (SMB) đang chuẩn bị khai trương hoặc đang kinh doanh cần phần mềm bán hàng hay không.

QUY TẮC PHÂN LOẠI & CHẤM ĐIỂM (Score từ 0 đến 100):
1. ĐIỂM CAO (80 - 100 điểm) - CHẮC CHẮN LÀ KHÁCH TIỀM NĂNG:
   - Các quán F&B (quán cafe, trà sữa, quán ăn, nhà hàng, quán nhậu, tiệm bánh, bida, sinh tố, chè...).
   - Các cửa hàng bán lẻ & dịch vụ độc lập (shop thời trang, mỹ phẩm, tiệm tạp hóa, siêu thị mini, phụ kiện, mẹ & bé, tiệm nail, spa, salon tóc...).
   - THÔNG BÁO KHAI TRƯƠNG, SẮP MỞ CỬA, MỞ CHI NHÁNH MỚI, CHẠY THỬ (Cực kỳ cần máy in bill, phần mềm bán hàng, quản lý bàn/kho).

2. ĐIỂM VỪA (50 - 79 điểm) - TIỀM NĂNG:
   - Cửa hàng/quán độc lập đang TUYỂN THU NGÂN, nhân viên bán hàng, quản lý kho, hoặc SANG NHƯỢNG quán.
   - Bài viết nhắc đến phần mềm POS đối thủ (KiotViet, Sapo, MISA, Haravan, iPOS...), hỏi mua máy tính tiền, thanh lý máy in bill, hoặc hỏi tư vấn phần mềm bán hàng.

3. ĐIỂM THẤP (0 - 49 điểm) - BẮT BUỘC LOẠI BỎ (KHÔNG PHẢI KHÁCH MỤC TIÊU):
   - Cửa hàng, quán, khách hàng ở NƯỚC NGOÀI (Nhật Bản, Hàn Quốc, Đài Loan, Mỹ, Úc, Canada, Châu Âu, Singapore, Thái Lan...). Bắt buộc quán/cửa hàng phải kinh doanh tại Việt Nam.
   - Khu công nghiệp (KCN), Cụm công nghiệp, Khu chế xuất, Nhà máy, Xí nghiệp, Phân xưởng, Công ty sản xuất, Cơ sở sản xuất, Gia công may mặc, Sản xuất bít tất, Hàng xuất khẩu.
   - Bài tuyển dụng Công nhân, Lao động phổ thông, Công nhân may, Công nhân sản xuất, Thời vụ.
   - Trường học, Mầm non, Nhà trẻ, Trường tiểu học, THCS, THPT, Đại học, Cao đẳng, Học viện.
   - Lễ khai giảng, Khai trường năm học mới, Mùa khai trường, Ngày hội tựu trường, Năm học mới, Học sinh, Sinh viên, Tân sinh viên, Lớp học, Niên khóa.
   - Dịch vụ in ấn biển bảng/hoa/bóng bay chúc mừng khai giảng năm học.
   - Spa / Tiệm Nail / Thẩm mỹ viện / Massage / Chăm sóc da / Gội đầu dưỡng sinh / Phun xăm / Nối mi.
   - Chuỗi lớn / Franchise quy mô lớn (Phúc Long, Highlands, WinMart, KFC, Lotte, XanhSM...).
   - Nhà thuốc / Tiệm thuốc tây / Quầy thuốc.
   - Khách sạn / Hotel / Resort / Homestay / Nhà nghỉ.
   - Bất động sản / Căn hộ / Phòng trọ / Cho thuê nhà đất.
   - Dịch vụ Sinh đẻ / Gói thai sản / Khám sản phụ khoa / Bệnh viện phụ sản / Chăm sóc mẹ và bé sau sinh / Tắm bé / Thông tắc tia sữa.
   - Dịch vụ Hoa khai trương / Kệ hoa / Giỏ hoa chúc mừng.
   - Dịch vụ Múa Lân khai trương / Đoàn lân / Lân sư rồng.
   - Nhà xe / Xe khách / Tuyến xe / Vé xe limousine.
   - Bài tuyển dụng đa cấp, việc làm online, bài viết đời sống cá nhân không kinh doanh.`;

/**
 * App Initialization
 */
document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    initNavigation();
    initEventListeners();
    await initClientStorage();
    checkSessionStatus();
    fetchConfig();
    fetchResultsHistory(); // Automatically load history on startup
    startIdleSync();
});

/**
 * Theme Switcher (Giao diện Sáng / Tối)
 */
function initTheme() {
    const savedTheme = localStorage.getItem('fb_theme') || 'light';
    applyTheme(savedTheme);

    const btnThemeToggle = document.getElementById('btnThemeToggle');
    if (btnThemeToggle) {
        btnThemeToggle.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
            const newTheme = currentTheme === 'light' ? 'dark' : 'light';
            applyTheme(newTheme);
            localStorage.setItem('fb_theme', newTheme);
            showToast(`Đã chuyển sang ${newTheme === 'light' ? 'Giao diện Sáng ☀️' : 'Giao diện Tối 🌙'}`, 'info');
        });
    }
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const iconEl = document.getElementById('themeToggleIcon');
    const textEl = document.getElementById('themeToggleText');
    if (iconEl && textEl) {
        if (theme === 'dark') {
            iconEl.textContent = '🌙';
            textEl.textContent = 'Giao diện Tối';
        } else {
            iconEl.textContent = '☀️';
            textEl.textContent = 'Giao diện Sáng';
        }
    }
}

function initNavigation() {
    const navSession = document.getElementById('navSession');
    const navSearch = document.getElementById('navSearch');
    const navConfig = document.getElementById('navConfig');
    
    const tabSession = document.getElementById('tabSession');
    const tabSearch = document.getElementById('tabSearch');
    const tabConfig = document.getElementById('tabConfig');

    const tabs = [
        { btn: navSession, target: tabSession, name: 'session' },
        { btn: navSearch, target: tabSearch, name: 'search' },
        { btn: navConfig, target: tabConfig, name: 'config' }
    ];

    tabs.forEach(tab => {
        if (tab.btn) {
            tab.btn.addEventListener('click', (e) => {
                e.preventDefault();
                switchTab(tab.name, tabs);
            });
        }
    });
}

function switchTab(tabName, tabs) {
    state.currentTab = tabName;
    const pageTitle = document.getElementById('pageTitle');
    if (pageTitle) {
        if (tabName === 'session') pageTitle.textContent = 'Session Manager';
        else if (tabName === 'search') pageTitle.textContent = 'Search & Export';
        else if (tabName === 'config') pageTitle.textContent = 'Cấu hình Hệ thống';
    }

    tabs.forEach(t => {
        if (t.name === tabName) {
            if (t.btn) t.btn.classList.add('active');
            if (t.target) t.target.classList.add('active');
        } else {
            if (t.btn) t.btn.classList.remove('active');
            if (t.target) t.target.classList.remove('active');
        }
    });
}

function initEventListeners() {
    const btnLogin = document.getElementById('btnLogin');
    const btnLoginCookie = document.getElementById('btnLoginCookie');
    const btnVerifySession = document.getElementById('btnVerifySession');
    const btnCloseBrowser = document.getElementById('btnCloseBrowser');

    if (btnLogin) btnLogin.addEventListener('click', handleLogin);
    if (btnLoginCookie) btnLoginCookie.addEventListener('click', handleLoginCookie);
    if (btnVerifySession) btnVerifySession.addEventListener('click', handleVerifySession);
    if (btnCloseBrowser) btnCloseBrowser.addEventListener('click', handleLogout);

    const searchForm = document.getElementById('searchForm');
    const btnStopSearch = document.getElementById('btnStopSearch');
    const btnExport = document.getElementById('btnExport');
    const btnClearHistory = document.getElementById('btnClearHistory');
    const btnDeleteSelected = document.getElementById('btnDeleteSelected');
    const btnSelectClientFolder = document.getElementById('btnSelectClientFolder');
    const btnBackupData = document.getElementById('btnBackupData');

    if (searchForm) searchForm.addEventListener('submit', handleStartSearch);
    if (btnStopSearch) btnStopSearch.addEventListener('click', handleStopSearch);
    if (btnExport) btnExport.addEventListener('click', handleExport);
    if (btnClearHistory) btnClearHistory.addEventListener('click', handleClearHistory);
    if (btnDeleteSelected) btnDeleteSelected.addEventListener('click', handleDeleteSelected);
    if (btnSelectClientFolder) btnSelectClientFolder.addEventListener('click', handleSelectClientFolder);
    if (btnBackupData) btnBackupData.addEventListener('click', handleBackupData);

    const configForm = document.getElementById('configForm');
    if (configForm) configForm.addEventListener('submit', handleSaveConfig);

    const btnTestAiConnection = document.getElementById('btnTestAiConnection');
    if (btnTestAiConnection) btnTestAiConnection.addEventListener('click', handleTestAiConnection);

    const selAiProvider = document.getElementById('cfgAiProvider');
    if (selAiProvider) {
        let prevProvider = selAiProvider.value;
        selAiProvider.addEventListener('change', (e) => {
            const inputApiKey = document.getElementById('cfgGeminiApiKey');
            if (inputApiKey && state.config) {
                const entered = inputApiKey.value.trim();
                if (entered) {
                    if (prevProvider === 'groq') state.config.groqApiKey = entered;
                    else if (prevProvider === 'gemini') state.config.geminiApiKey = entered;
                    else state.config.aiApiKey = entered;
                }
            }
            prevProvider = e.target.value;
            updateAiProviderUI(e.target.value);
        });
    }

    const inputGeminiKey = document.getElementById('cfgGeminiApiKey');
    if (inputGeminiKey) {
        inputGeminiKey.addEventListener('paste', () => {
            setTimeout(() => {
                const val = inputGeminiKey.value.trim();
                if (val.length > 15) {
                    const currentProv = document.getElementById('cfgAiProvider')?.value || 'groq';
                    const provLabel = currentProv === 'groq' ? 'Groq' : 'Gemini';
                    showToast(`Đã phát hiện ${provLabel} API Key! Đang tự động kiểm tra kết nối...`, 'info');
                    handleTestAiConnection();
                }
            }, 200);
        });
    }

    const btnResetAiContext = document.getElementById('btnResetAiContext');
    if (btnResetAiContext) {
        btnResetAiContext.addEventListener('click', () => {
            const txtAiContext = document.getElementById('cfgAiPromptContext');
            if (txtAiContext) {
                txtAiContext.value = DEFAULT_AI_PROMPT_CONTEXT;
                showToast('Đã khôi phục ngữ cảnh AI mặc định!', 'info');
            }
        });
    }

    const configHeadless = document.getElementById('configHeadless');
    if (configHeadless) {
        configHeadless.addEventListener('change', async (e) => {
            try {
                await api('PUT', '/api/config', { headless: e.target.checked });
                const cfgHeadless = document.getElementById('cfgHeadless');
                if (cfgHeadless) cfgHeadless.checked = e.target.checked;
                showToast(`Đã ${e.target.checked ? 'bật' : 'tắt'} chế độ chạy ngầm (Headless)`, 'info');
            } catch (err) {
                showToast('Lỗi cập nhật cấu hình', 'error');
            }
        });
    }

    // Filter Listeners (Trạng thái & Từ ngày -> Đến ngày)
    const btnApplyDateFilter = document.getElementById('btnApplyDateFilter');
    const btnResetDateFilter = document.getElementById('btnResetDateFilter');
    const filterStatusSelect = document.getElementById('filterStatusSelect');
    
    if (btnApplyDateFilter) btnApplyDateFilter.addEventListener('click', handleApplyDateFilter);
    if (btnResetDateFilter) btnResetDateFilter.addEventListener('click', handleResetDateFilter);

    if (filterStatusSelect) {
        filterStatusSelect.addEventListener('change', (e) => {
            state.dateFilter.status = e.target.value;
            state.pagination.currentPage = 1;
            
            const btnReset = document.getElementById('btnResetDateFilter');
            if (btnReset) {
                btnReset.style.display = (e.target.value !== 'all' || (state.aiScoreFilter && state.aiScoreFilter !== 'all') || state.dateFilter.query || state.dateFilter.fromDate || state.dateFilter.toDate) ? 'inline-flex' : 'none';
            }
            
            renderTable();
        });
    }

    // Gắn sự kiện Click-to-Filter cho 5 huy hiệu thống kê Realtime
    function setupStatPillFilter(pillId, targetStatus) {
        const pill = document.getElementById(pillId);
        if (!pill) return;

        const triggerFilter = () => {
            const currentStatus = state.dateFilter.status || 'all';
            let nextStatus = targetStatus;

            // Bấm lại đúng pill đang active thì hủy lọc quay về 'all'
            if (targetStatus !== 'all' && currentStatus === targetStatus) {
                nextStatus = 'all';
            }

            state.dateFilter.status = nextStatus;
            state.pagination.currentPage = 1;

            if (filterStatusSelect) {
                filterStatusSelect.value = nextStatus;
            }

            const btnReset = document.getElementById('btnResetDateFilter');
            if (btnReset) {
                btnReset.style.display = (nextStatus !== 'all' || (state.aiScoreFilter && state.aiScoreFilter !== 'all') || state.dateFilter.query || state.dateFilter.fromDate || state.dateFilter.toDate) ? 'inline-flex' : 'none';
            }

            renderTable();
        };

        pill.addEventListener('click', triggerFilter);
        pill.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                triggerFilter();
            }
        });
    }

    setupStatPillFilter('statPillTotal', 'all');
    setupStatPillFilter('statPillNew', 'Mới tạo');
    setupStatPillFilter('statPillLead', 'Đã nhập lead');
    setupStatPillFilter('statPillDuplicate', 'Trùng lead');
    setupStatPillFilter('statPillNone', 'Không có nhu cầu');

    const filterAiScoreSelect = document.getElementById('filterAiScoreSelect');
    if (filterAiScoreSelect) {
        filterAiScoreSelect.addEventListener('change', (e) => {
            state.aiScoreFilter = e.target.value;
            state.pagination.currentPage = 1;
            
            const btnReset = document.getElementById('btnResetDateFilter');
            if (btnReset) {
                btnReset.style.display = (e.target.value !== 'all' || (state.dateFilter.status && state.dateFilter.status !== 'all') || state.dateFilter.query || state.dateFilter.fromDate || state.dateFilter.toDate) ? 'inline-flex' : 'none';
            }
            
            renderTable();
        });
    }

    // Auto-save and auto-restore excluded keywords from LocalStorage
    const excludeKeywordsInput = document.getElementById('excludeKeywordsInput');
    if (excludeKeywordsInput) {
        const savedExclude = localStorage.getItem('fb_automation_exclude_keywords');
        if (savedExclude !== null && savedExclude.trim() !== '') {
            excludeKeywordsInput.value = savedExclude;
        }

        excludeKeywordsInput.addEventListener('input', (e) => {
            localStorage.setItem('fb_automation_exclude_keywords', e.target.value);
        });

        excludeKeywordsInput.addEventListener('change', (e) => {
            const val = e.target.value.trim();
            localStorage.setItem('fb_automation_exclude_keywords', val);
            api('PUT', '/api/config', { excludeKeywords: val }).catch(() => {});
        });
    }

    const filterKeywordInput = document.getElementById('filterKeywordInput');
    if (filterKeywordInput) {
        filterKeywordInput.addEventListener('input', (e) => {
            state.dateFilter.query = e.target.value;
            state.pagination.currentPage = 1;
            
            const btnReset = document.getElementById('btnResetDateFilter');
            if (btnReset) {
                btnReset.style.display = (e.target.value.trim() !== '' || state.dateFilter.status !== 'all' || state.dateFilter.fromDate || state.dateFilter.toDate) ? 'inline-flex' : 'none';
            }
            
            renderTable();
        });
    }

    // Select All Checkbox Header
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            const currentData = getFilteredAndSortedResults();
            currentData.forEach(item => {
                const key = getItemKey(item);
                if (isChecked) state.selectedKeys.add(key);
                else state.selectedKeys.delete(key);
            });
            renderTable();
        });
    }

    // Pagination Listeners (10 rows per page)
    const btnPrevPage = document.getElementById('btnPrevPage');
    const btnNextPage = document.getElementById('btnNextPage');

    if (btnPrevPage) {
        btnPrevPage.addEventListener('click', () => {
            if (state.pagination.currentPage > 1) {
                state.pagination.currentPage--;
                renderTable();
            }
        });
    }

    if (btnNextPage) {
        btnNextPage.addEventListener('click', () => {
            if (state.pagination.currentPage < state.pagination.totalPages) {
                state.pagination.currentPage++;
                renderTable();
            }
        });
    }
}

/**
 * Unique Item Identifier Helper
 */
function getItemKey(post) {
  if (!post) return '';
  if (post.id) return String(post.id).trim();
  if (post._id) return String(post._id).trim();

  const postLink = post.postLink || post.postUrl || '';

  if (postLink && typeof postLink === 'string') {
    // 1. Extract story_fbid or fbid parameter
    const fbidMatch = postLink.match(/(?:story_fbid|fbid)=([a-zA-Z0-9_-]+)/i);
    if (fbidMatch && fbidMatch[1]) {
      return `fbid_${fbidMatch[1]}`.toLowerCase().trim();
    }

    // 2. Extract /posts/pfbid... or /posts/123456... or /photos/123456...
    const pathMatch = postLink.match(/\/(?:posts|photos|permalink|reel|videos)\/([a-zA-Z0-9_-]+)/i);
    if (pathMatch && pathMatch[1]) {
      return `post_${pathMatch[1]}`.toLowerCase().trim();
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
  const cleanAuthor = (post.authorName || '').normalize('NFC').toLowerCase().trim();
  const cleanSnippet = (post.content || '').normalize('NFC').replace(/\s+/g, ' ').trim().substring(0, 60).toLowerCase();
  return `sig_${cleanAuthor}_${cleanSnippet}`;
}

/**
 * Parse Date strings (e.g. "08:30 30/07/2026", "30/07/2026") to Unix timestamp for filtering and sorting
 */
function parsePostDateTimestamp(timeStr = '') {
    if (!timeStr) return 0;
    
    // HH:mm DD/MM/YYYY
    const m = timeStr.match(/(\d{1,2}):(\d{1,2})\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) {
        const [, hour, min, day, month, year] = m;
        return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(min)).getTime();
    }

    // DD/MM/YYYY
    const dOnly = timeStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dOnly) {
        const [, day, month, year] = dOnly;
        return new Date(parseInt(year), parseInt(month) - 1, parseInt(day)).getTime();
    }

    // Relative fallbacks
    const now = Date.now();
    const relMin = timeStr.match(/(\d+)\s*phút/i);
    if (relMin) return now - parseInt(relMin[1]) * 60 * 1000;

    const relHour = timeStr.match(/(\d+)\s*giờ/i) || timeStr.match(/(\d+)h\b/i);
    if (relHour) return now - parseInt(relHour[1]) * 3600 * 1000;

    if (timeStr.toLowerCase().includes('hôm qua')) return now - 24 * 3600 * 1000;

    return now;
}

/**
 * Cleans obfuscated Facebook string noise and tracking strings for readable display
 */
function cleanPostTextForDisplay(text = '') {
    if (!text) return '—';
    return text
        .replace(/rSoostpdne\w+/gi, '')
        .replace(/pfbid\w+/gi, '')
        .replace(/https?:\/\/[^\s]+/gi, '')
        .replace(/Back to Previous Page/gi, '')
        .replace(/Exit typeahead/gi, '')
        .replace(/Facebook Account controls and settings/gi, '')
        .replace(/Chỉ báo trạng thái online\s*Đang hoạt động/gi, '')
        .replace(/\s+/g, ' ')
        .trim() || '—';
}

/**
 * Remove Vietnamese accents (Dấu tiếng Việt) and normalize string for fuzzy matching
 */
function normalizeVietnamese(str = '') {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .replace(/[^\w\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Valid Vietnamese Telco Mobile Prefixes (10 Digits Total)
 */
const VALID_VN_PREFIXES = new Set([
  '086', '096', '097', '098', '032', '033', '034', '035', '036', '037', '038', '039',
  '089', '090', '093', '070', '079', '077', '076', '078',
  '088', '091', '094', '083', '084', '085', '081', '082',
  '092', '056', '058', '052', '099', '059', '087', '055'
]);

function isValidVietnamesePhone(digits) {
  if (!digits || typeof digits !== 'string') return false;
  if (digits.length === 10) {
    const prefix3 = digits.substring(0, 3);
    if (!VALID_VN_PREFIXES.has(prefix3)) return false;
    const suffix = digits.substring(3);
    if (/^(\d)\1+$/.test(suffix)) return false;
    if (digits === '0123456789' || digits === '0987654321') return false;
    return true;
  }
  if (digits.length === 11 && digits.startsWith('02')) {
    const suffix = digits.substring(2);
    if (/^(\d)\1+$/.test(suffix)) return false;
    return true;
  }
  return false;
}

/**
 * Extract digits only for phone matching
 */
function normalizeDigits(str = '') {
  if (!str) return '';
  return str.replace(/[^\d]/g, '');
}

/**
 * Advanced Fuzzy Matcher (Strictly checks Phone Numbers & Author Name only)
 */
function isFuzzyMatch(item, rawQuery = '') {
  if (!rawQuery || !rawQuery.trim()) return true;

  const cleanQuery = normalizeVietnamese(rawQuery);
  const digitsQuery = normalizeDigits(rawQuery);

  // 1. Check verified numbers and legacy/unverified discoveries. The latter
  // remain searchable so old data is not hidden, but the table labels them.
  const verifiedPhones = Array.isArray(item.verifiedPhones) ? item.verifiedPhones : [];
  const discoveredPhones = Array.isArray(item.phones) ? item.phones : [];
  const rawPhones = Array.from(new Set([...verifiedPhones, ...discoveredPhones]));
  if (digitsQuery.length >= 2) {
    const matchedPhone = rawPhones.some(p => {
      const pDigits = normalizeDigits(p);
      return pDigits.includes(digitsQuery);
    });
    if (matchedPhone) return true;
  }

  // 2. Check Author Name (Accent-Insensitive & Substring match)
  const cleanAuthor = normalizeVietnamese(item.authorName || '');
  if (cleanAuthor.includes(cleanQuery)) return true;

  // 3. Multi-word Author Name match (Every word in query exists in author name)
  const queryWords = cleanQuery.split(' ').filter(w => w.length > 0);
  if (queryWords.length > 1) {
    const allWordsMatch = queryWords.every(w => cleanAuthor.includes(w));
    if (allWordsMatch) return true;
  }

  // 4. Check Content & Summary text
  const cleanContent = normalizeVietnamese(item.content || '');
  if (cleanContent.includes(cleanQuery)) return true;
  const cleanSummary = normalizeVietnamese(item.summary || '');
  if (cleanSummary.includes(cleanQuery)) return true;

  // 5. Check Province / City (Tỉnh thành)
  const cleanLocation = normalizeVietnamese(item.location || '');
  if (cleanLocation.includes(cleanQuery)) return true;

  return false;
}

/**
 * Filters dataset by Quick Search Query (SĐT/Tên tương đối), Date Range, & Lead Status, and sorts newest first on top if date filter is active
 */
function getFilteredAndSortedResults() {
    let list = [...(state.search.results || [])];

    // 1. Instant Fuzzy Search Filter (Phone numbers or Author Name or Content)
    const query = state.dateFilter.query || '';
    if (query.trim()) {
        list = list.filter(item => isFuzzyMatch(item, query));
    }

    // 2. Filter by Lead Status (Mới tạo, Đã nhập lead, Không có nhu cầu)
    const selectedStatus = state.dateFilter.status || 'all';
    if (selectedStatus !== 'all') {
        list = list.filter(item => {
            const itemStatus = item.status || 'Mới tạo';
            return itemStatus === selectedStatus;
        });
    }

    // 3. Filter by AI Score (all / high / medium)
    const selectedAiScore = state.aiScoreFilter || 'all';
    if (selectedAiScore === 'high') {
        list = list.filter(item => (typeof item.aiScore === 'number' ? item.aiScore >= 80 : false));
    } else if (selectedAiScore === 'medium') {
        list = list.filter(item => (typeof item.aiScore === 'number' ? (item.aiScore >= 50 && item.aiScore < 80) : false));
    }

    // 4. Filter by Date & Time Range
    if (state.dateFilter.active && (state.dateFilter.fromDate || state.dateFilter.toDate)) {
        let fromTs = 0;
        let toTs = Infinity;

        if (state.dateFilter.fromDate) {
            const fStr = state.dateFilter.fromDate.includes('T') ? state.dateFilter.fromDate : state.dateFilter.fromDate + 'T00:00:00';
            fromTs = new Date(fStr).getTime() || 0;
        }

        if (state.dateFilter.toDate) {
            const tStr = state.dateFilter.toDate.includes('T') ? state.dateFilter.toDate : state.dateFilter.toDate + 'T23:59:59';
            toTs = new Date(tStr).getTime() || Infinity;
        }

        list = list.filter(item => {
            const ts = parsePostDateTimestamp(item.postedTime);
            if (!ts) return true;
            return ts >= fromTs && ts <= toTs;
        });

        // Chỉ sắp xếp mới nhất ở trên khi ĐANG BẬT BỘ LỌC THỜI GIAN
        list.sort((a, b) => parsePostDateTimestamp(b.postedTime) - parsePostDateTimestamp(a.postedTime));
    }

    return list;
}

function handleApplyDateFilter() {
    const fromVal = document.getElementById('filterFromDate').value;
    const toVal = document.getElementById('filterToDate').value;
    const statusVal = document.getElementById('filterStatusSelect') ? document.getElementById('filterStatusSelect').value : 'all';
    const aiScoreVal = document.getElementById('filterAiScoreSelect') ? document.getElementById('filterAiScoreSelect').value : 'all';
    const queryVal = document.getElementById('filterKeywordInput') ? document.getElementById('filterKeywordInput').value.trim() : '';

    if (!fromVal && !toVal && statusVal === 'all' && aiScoreVal === 'all' && !queryVal) {
        showToast('Vui lòng nhập từ khóa, thời gian hoặc chọn bộ lọc để lọc', 'warning');
        return;
    }

    state.dateFilter.fromDate = fromVal;
    state.dateFilter.toDate = toVal;
    state.dateFilter.status = statusVal;
    state.dateFilter.query = queryVal;
    state.aiScoreFilter = aiScoreVal;
    state.dateFilter.active = true;
    state.pagination.currentPage = 1;
    
    const btnReset = document.getElementById('btnResetDateFilter');
    if (btnReset) btnReset.style.display = 'inline-flex';

    renderTable();
    showToast('Đã áp dụng bộ lọc dữ liệu!', 'info');
}

function handleResetDateFilter() {
    document.getElementById('filterFromDate').value = '';
    document.getElementById('filterToDate').value = '';
    const filterStatusSelect = document.getElementById('filterStatusSelect');
    if (filterStatusSelect) filterStatusSelect.value = 'all';
    const filterAiScoreSelect = document.getElementById('filterAiScoreSelect');
    if (filterAiScoreSelect) filterAiScoreSelect.value = 'all';
    const filterKeywordInput = document.getElementById('filterKeywordInput');
    if (filterKeywordInput) filterKeywordInput.value = '';

    state.dateFilter = { query: '', fromDate: null, toDate: null, status: 'all', active: false };
    state.aiScoreFilter = 'all';
    
    const btnReset = document.getElementById('btnResetDateFilter');
    if (btnReset) btnReset.style.display = 'none';

    state.pagination.currentPage = 1;
    renderTable();
    showToast('Đã hủy bộ lọc', 'info');
}

/**
 * Client Storage Handlers (IndexedDB & File System Access API)
 * Lưu trữ 100% dữ liệu và cookie trên máy Client (Mac/Windows)
 */
async function initClientStorage() {
    try {
        if (window.ClientDB) {
            await window.ClientDB.init();
        }
        if (window.ClientFS) {
            const savedFolder = window.ClientFS.getFolderName();
            if (savedFolder) {
                updateClientFolderUI(savedFolder);
            }
        }
    } catch (e) {
        console.warn('[ClientStorage] Khởi tạo bộ nhớ client:', e);
    }
}

function updateClientFolderUI(folderName) {
    const txtClientFolderName = document.getElementById('txtClientFolderName');
    const btnSelectClientFolder = document.getElementById('btnSelectClientFolder');
    if (folderName) {
        if (txtClientFolderName) txtClientFolderName.textContent = '📁 ' + folderName;
        if (btnSelectClientFolder) {
            btnSelectClientFolder.classList.add('connected');
            btnSelectClientFolder.title = `Đang kết nối: ${folderName}. Bấm để chọn thư mục khác`;
        }
    } else {
        if (txtClientFolderName) txtClientFolderName.textContent = 'Chọn thư mục máy...';
        if (btnSelectClientFolder) {
            btnSelectClientFolder.classList.remove('connected');
            btnSelectClientFolder.title = 'Chọn thư mục trên máy bạn để tự động lưu file Excel và data';
        }
    }
}

async function handleSelectClientFolder() {
    if (!window.ClientFS) return;
    try {
        const folderName = await window.ClientFS.selectFolder();
        if (folderName) {
            updateClientFolderUI(folderName);
            showToast(`Đã kết nối thư mục máy bạn: "${folderName}"! Các file Excel sẽ tự động lưu vào exports/`, 'success');
        }
    } catch (err) {
        showToast(err.message || 'Không thể chọn thư mục trên máy bạn', 'warning');
    }
}


async function handleBackupData() {
    const btn = document.getElementById('btnBackupData');
    if (btn) setLoading(btn, true);
    try {
        let allLeads = [];
        if (window.ClientDB) {
            allLeads = await window.ClientDB.getAllLeads();
        }
        if (!allLeads || allLeads.length === 0) {
            allLeads = state.search.results || [];
        }

        if (!allLeads.length) {
            showToast('Chưa có dữ liệu bài viết nào trên máy để sao lưu', 'warning');
            return;
        }

        const dateStr = new Date().toISOString().slice(0, 10);
        const filename = `fb_leads_backup_${dateStr}.json`;
        const content = JSON.stringify(allLeads, null, 2);

        if (window.ClientFS) {
            const saveRes = await window.ClientFS.saveFile('data', filename, content, 'application/json');
            if (saveRes && saveRes.directWrite) {
                showToast(`Đã lưu file sao lưu vào thư mục máy bạn: ${saveRes.path}`, 'success');
            } else {
                showToast(`Đã tải file sao lưu ${filename} về máy bạn!`, 'success');
            }
        } else {
            const blob = new Blob([content], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            showToast(`Đã tải file sao lưu: ${filename}`, 'success');
        }
    } catch (err) {
        showToast(err.message || 'Lỗi khi sao lưu dữ liệu', 'error');
    } finally {
        if (btn) setLoading(btn, false);
    }
}

/**
 * Session API Handlers
 */
let loginMonitorInterval = null;

async function checkSessionStatus() {
    try {
        // 1. Luôn ưu tiên kiểm tra session lưu trong IndexedDB / LocalStorage của chính Client này
        if (window.ClientDB) {
            const clientSession = await window.ClientDB.getSession();
            if (clientSession && clientSession.status === 'active' && clientSession.cookie) {
                state.session = clientSession;
                updateSessionUI({
                    status: 'active',
                    user: clientSession.user || { name: 'Tài khoản Facebook' },
                    isClientSession: true
                });
                return;
            }
        }

        // 2. Nếu Client chưa có session trong ClientDB, kiểm tra theo clientId của máy này trên server
        const clientId = getClientId();
        const res = await api('GET', `/api/session/status?clientId=${encodeURIComponent(clientId)}`);
        if (res && res.status === 'active' && res.user) {
            state.session = res;
            updateSessionUI(res);
            return;
        }

        // Mặc định: Thiết bị này chưa đăng nhập
        state.session = { status: 'none', user: null };
        updateSessionUI({ status: 'none', user: null });
    } catch (err) {
        state.session = { status: 'none', user: null };
        updateSessionUI({ status: 'none', user: null });
    }
}

async function handleVerifySession() {
    const btnVerifySession = document.getElementById('btnVerifySession');
    if (btnVerifySession) setLoading(btnVerifySession, true);
    showToast('Đang kết nối và kiểm tra session với Facebook...', 'info');

    try {
        const clientSession = window.ClientDB ? await window.ClientDB.getSession() : null;
        const cookieVal = clientSession?.cookie || localStorage.getItem('fb_cookie') || '';
        if (!cookieVal) {
            showToast('Chưa có Cookie Facebook trên máy bạn. Vui lòng dán Cookie vào ô bên dưới!', 'warning');
            updateSessionUI({ status: 'none', user: null });
            return;
        }

        const res = await api('POST', '/api/session/verify', { 
            cookie: cookieVal, 
            clientId: getClientId() 
        });

        if (res.active && res.status === 'active') {
            if (window.ClientDB) {
                await window.ClientDB.saveSession({
                    cookie: cookieVal,
                    user: res.user || clientSession?.user || { name: 'Facebook User' },
                    status: 'active'
                });
            }
            state.session = res;
            updateSessionUI(res);
            showToast(res.message || 'Session hoạt động tốt!', 'success');
        } else {
            if (window.ClientDB) {
                await window.ClientDB.clearSession();
            }
            state.session = { status: 'none', user: null };
            updateSessionUI({ status: 'none', user: null });
            showToast(res.message || 'Phiên đăng nhập đã hết hạn! Vui lòng lấy lại Cookie mới.', 'warning');
        }
    } catch (err) {
        showToast(err.message || 'Lỗi kiểm tra session', 'error');
    } finally {
        if (btnVerifySession) setLoading(btnVerifySession, false);
    }
}

async function handleLogin() {
    const btnLogin = document.getElementById('btnLogin');
    setLoading(btnLogin, true);
    showToast('Đang mở trình duyệt Chromium... Vui lòng đăng nhập Facebook trên cửa sổ mở ra!', 'info');

    if (loginMonitorInterval) {
        clearInterval(loginMonitorInterval);
        loginMonitorInterval = null;
    }

    try {
        const res = await api('POST', '/api/session/login');
        updateSessionUI({ status: 'authenticating', user: null });

        // Start live polling session status until user completes login on the browser window
        let pollCount = 0;
        loginMonitorInterval = setInterval(async () => {
            pollCount++;
            if (pollCount > 120) { // 3 minutes timeout
                clearInterval(loginMonitorInterval);
                loginMonitorInterval = null;
                setLoading(btnLogin, false);
                return;
            }

            try {
                const statusRes = await api('GET', `/api/session/status?clientId=${encodeURIComponent(getClientId())}`);
                if (statusRes.status === 'active') {
                    clearInterval(loginMonitorInterval);
                    loginMonitorInterval = null;
                    setLoading(btnLogin, false);
                    updateSessionUI(statusRes);
                    showToast(`Đăng nhập Facebook thành công! Xin chào ${statusRes.user?.name || ''}`, 'success');
                }
            } catch (e) {}
        }, 1500);

    } catch (err) {
        setLoading(btnLogin, false);
        showToast(err.message || 'Không thể mở trình duyệt', 'error');
    }
}

async function handleLoginCookie() {
    const inputCookie = document.getElementById('inputCookie');
    const btnLoginCookie = document.getElementById('btnLoginCookie');
    if (!inputCookie) return;

    const cookieVal = inputCookie.value.trim();
    if (!cookieVal) {
        showToast('Vui lòng dán chuỗi Cookie Facebook vào ô nhập', 'warning');
        return;
    }

    setLoading(btnLoginCookie, true);
    showToast('Đang kiểm tra và nạp Cookie với Facebook...', 'info');

    try {
        const res = await api('POST', '/api/session/login-cookie', { 
            cookie: cookieVal,
            clientId: getClientId() 
        });

        if (res.status === 'active') {
            if (window.ClientDB) {
                await window.ClientDB.saveSession({
                    cookie: cookieVal,
                    user: res.user || { name: 'Facebook User' },
                    status: 'active'
                });
            }
            showToast(res.message || 'Đăng nhập Cookie Facebook thành công! Dữ liệu cookie đã được lưu an toàn trên máy bạn.', 'success');
            inputCookie.value = '';
            state.session = res;
            updateSessionUI(res);
        } else {
            showToast(res.message || 'Đăng nhập Cookie không thành công', 'warning');
        }
    } catch (err) {
        showToast(err.message || 'Lỗi nạp Cookie', 'error');
    } finally {
        setLoading(btnLoginCookie, false);
    }
}

async function handleLogout() {
    if (!confirm('Bạn có chắc chắn muốn xóa phiên đăng nhập Facebook trên máy bạn?')) return;

    const btnCloseBrowser = document.getElementById('btnCloseBrowser');
    if (btnCloseBrowser) setLoading(btnCloseBrowser, true);

    try {
        if (window.ClientDB) {
            await window.ClientDB.clearSession();
        }
        await api('POST', '/api/session/logout', { clientId: getClientId() });
        if (loginMonitorInterval) {
            clearInterval(loginMonitorInterval);
            loginMonitorInterval = null;
        }
        state.session = { status: 'none', user: null, lastChecked: null };
        updateSessionUI({ status: 'none', user: null });
        showToast('Đã xóa phiên đăng nhập Facebook trên máy bạn thành công!', 'info');
    } catch (err) {
        showToast(err.message || 'Lỗi đăng xuất', 'error');
    } finally {
        if (btnCloseBrowser) setLoading(btnCloseBrowser, false);
    }
}

function updateSessionUI(sessionData) {
    state.session = sessionData || { status: 'none', user: null };
    const box = document.getElementById('sessionStatusBox');
    const icon = document.getElementById('sessionStatusIcon');
    const title = document.getElementById('sessionStatusTitle');
    const subtext = document.getElementById('sessionStatusSubtext');
    const accountInfoContainer = document.getElementById('accountInfoContainer');
    const accountDisplayName = document.getElementById('accountDisplayName');
    const accountUid = document.getElementById('accountUid');

    const globalIndicator = document.getElementById('globalSessionStatusIndicator');
    const globalText = document.getElementById('globalSessionStatusText');

    const status = sessionData.status || 'none';

    if (globalIndicator) globalIndicator.className = `status-indicator ${status}`;
    if (globalText) {
        if (status === 'active') globalText.textContent = 'Đã đăng nhập';
        else if (status === 'authenticating') globalText.textContent = 'Đang đăng nhập...';
        else if (status === 'expired') globalText.textContent = 'Hết hạn';
        else globalText.textContent = 'Chưa đăng nhập';
    }

    if (box) {
        box.className = `session-status-box ${status}`;
    }

    if (status === 'active') {
        if (icon) icon.textContent = '✔';
        if (title) title.textContent = 'Phiên đăng nhập hoạt động tốt!';
        if (subtext) subtext.textContent = 'Đã kết nối với Facebook. Sẵn sàng bóc tách dữ liệu.';
        
        if (accountInfoContainer) accountInfoContainer.style.display = 'block';
        if (accountDisplayName) accountDisplayName.textContent = sessionData.user?.name || 'Tài khoản Facebook';
        if (accountUid) accountUid.textContent = sessionData.user?.id || 'Active';
    } else if (status === 'authenticating') {
        if (icon) icon.textContent = '⏳';
        if (title) title.textContent = 'Đang chờ đăng nhập trên trình duyệt...';
        if (subtext) subtext.textContent = 'Vui lòng hoàn tất đăng nhập tài khoản Facebook trên cửa sổ Chromium vừa mở.';
        if (accountInfoContainer) accountInfoContainer.style.display = 'none';
    } else if (status === 'expired') {
        if (icon) icon.textContent = '⚠️';
        if (title) title.textContent = 'Phiên đăng nhập đã hết hạn!';
        if (subtext) subtext.textContent = 'Vui lòng bấm Đăng nhập lại hoặc dán Cookie mới để tiếp tục.';
        if (accountInfoContainer) accountInfoContainer.style.display = 'none';
    } else {
        if (icon) icon.textContent = '✖';
        if (title) title.textContent = 'Chưa có session đăng nhập!';
        if (subtext) subtext.textContent = 'Vui lòng bấm Mở trình duyệt đăng nhập hoặc dán Cookie Facebook bên dưới để bắt đầu.';
        if (accountInfoContainer) accountInfoContainer.style.display = 'none';
    }
}

/**
 * Search API Handlers
 */
async function handleStartSearch(e) {
    e.preventDefault();
    if (state.search.status === 'searching') return;

    // Retrieve client session & cookie if present
    const clientSession = window.ClientDB ? await window.ClientDB.getSession() : null;
    const clientCookie = clientSession?.cookie || localStorage.getItem('fb_cookie') || '';
    const hasActiveSession = (state.session && state.session.status === 'active') || (clientCookie && clientCookie.length > 10);

    // 1. Mandatory Session Guard: Must be active on server OR have client cookie
    if (!hasActiveSession) {
        showToast('Bạn chưa đăng nhập Facebook! Vui lòng vào mục "Session Manager" để đăng nhập hoặc dán Cookie trước khi tìm kiếm.', 'warning');
        const navSession = document.getElementById('navSession');
        if (navSession) navSession.click();
        return;
    }

    const keyword = document.getElementById('searchInput').value.trim();
    const rawExclude = (document.getElementById('excludeKeywordsInput')?.value || '').trim();
    localStorage.setItem('fb_automation_exclude_keywords', rawExclude);
    api('PUT', '/api/config', { excludeKeywords: rawExclude }).catch(() => {});

    const excludeKeywords = rawExclude
        ? rawExclude.split(/[,，]+/).map(s => s.trim().toLowerCase()).filter(Boolean)
        : [];

    const maxPosts = parseInt(document.getElementById('filterMaxPosts').value, 10) || state.config?.maxPosts || 50;
    const datePosted = document.getElementById('filterDatePosted').value;
    const recentPosts = document.getElementById('filterRecentPosts').checked;
    const requirePhoneOnly = document.getElementById('chkRequirePhoneOnly')?.checked || false;

    if (!keyword) {
        showToast('Vui lòng nhập từ khóa tìm kiếm', 'warning');
        return;
    }

    // Get existing keys from client IndexedDB to avoid crawling duplicates
    const existingSignatures = window.ClientDB ? await window.ClientDB.getSignatures() : { keys: [] };

    const payload = {
        keyword,
        maxPosts,
        filters: { recentPosts, datePosted, excludeKeywords, requirePhoneOnly },
        cookie: clientCookie || undefined,
        existingKeys: existingSignatures.keys,
        clientId: getClientId()
    };

    setSearchState('searching');
    state.search.keyword = keyword;
    state.search.progress.total = maxPosts;
    state.selectedKeys = new Set();  // Reset selections for new search

    try {
        await api('POST', '/api/search/start', payload);
        showToast(`Bắt đầu tìm kiếm từ khóa "${keyword}"`, 'info');
        startPollingSearch();
    } catch (err) {
        showToast(err.message || 'Không thể bắt đầu tìm kiếm', 'error');
        setSearchState('idle');
        if (err.message && (err.message.includes('đăng nhập') || err.message.includes('Session') || err.message.includes('Cookie'))) {
            const navSession = document.getElementById('navSession');
            if (navSession) navSession.click();
        }
    }
}

async function handleStopSearch() {
    try {
        await api('POST', '/api/search/stop', { clientId: getClientId() });
        showToast('Đã gửi yêu cầu dừng', 'info');
        stopPollingSearch();
        setSearchState('stopped');
    } catch (err) {
        showToast('Không thể dừng', 'error');
    }
}

function startPollingSearch() {
    stopPollingSearch();
    state.pollingInterval = setInterval(pollSearchProgress, 1000);
}

function stopPollingSearch() {
    if (state.pollingInterval) {
        clearInterval(state.pollingInterval);
        state.pollingInterval = null;
    }
}

let _idleSyncInterval = null;

/**
 * Đồng bộ dữ liệu ngầm Realtime định kỳ khi hệ thống đang ở trạng thái nhàn rỗi (idle)
 */
function startIdleSync() {
    if (_idleSyncInterval) clearInterval(_idleSyncInterval);
    _idleSyncInterval = setInterval(async () => {
        // Chỉ chạy khi không đang trong tiến trình tìm kiếm và tab trình duyệt đang mở
        if (state.search.status === 'searching' || document.hidden) return;
        try {
            if (window.ClientDB) {
                const clientLeads = await window.ClientDB.getAllLeads();
                if (clientLeads && clientLeads.length > 0) {
                    const oldLength = (state.search.results || []).length;
                    if (clientLeads.length !== oldLength) {
                        state.search.results = clientLeads;
                        updateStatPills();
                        const kwInput = document.getElementById('filterKeywordInput');
                        if (!kwInput || document.activeElement !== kwInput) {
                            renderTable();
                        }
                    }
                }
            }
        } catch (e) {}
    }, 4000);
}

// Khi người dùng quay lại tab trình duyệt, tự động nạp lại lịch sử dữ liệu mới nhất
window.addEventListener('focus', () => {
    if (state.search.status !== 'searching') {
        fetchResultsHistory();
    }
});

async function pollSearchProgress() {
    const clientId = getClientId();
    try {
        const progress = await api('GET', `/api/search/status?clientId=${encodeURIComponent(clientId)}`);
        const resData = await api('GET', `/api/search/results?clientId=${encodeURIComponent(clientId)}`);

        state.search.progress = progress;
        if (resData.results && resData.results.length > 0) {
            if (window.ClientDB) {
                await window.ClientDB.saveLeads(resData.results);
                state.search.results = await window.ClientDB.getAllLeads();
            } else {
                state.search.results = resData.results;
            }
            renderTable();
        }

        updateProgressUI(progress);

        if (progress.status === 'idle' || progress.status === 'stopped') {
            const wasSearching = state.search.status === 'searching';
            stopPollingSearch();
            setSearchState('idle');

            // Final fetch to get fully persisted results
            try {
                const finalData = await api('GET', `/api/search/results?clientId=${encodeURIComponent(clientId)}`);
                if (finalData.results && finalData.results.length > 0) {
                    if (window.ClientDB) {
                        await window.ClientDB.saveLeads(finalData.results);
                        state.search.results = await window.ClientDB.getAllLeads();
                    } else {
                        state.search.results = finalData.results;
                    }
                    renderTable();
                }
            } catch (e) {}

            if (wasSearching && progress.status === 'idle') {
                showToast(`Hoàn tất tìm kiếm! Đã thu thập đủ bài viết vào máy bạn`, 'success');
                showSearchCompletionModal(progress);
            }
        }
    } catch (err) {
        // Silently retry polling
    }
}

function showSearchCompletionModal(progress) {
    const existing = document.getElementById('searchCompletionModalOverlay');
    if (existing) existing.remove();

    const keyword = progress.keyword || document.getElementById('inputKeyword')?.value?.trim() || '';
    const accepted = progress.accepted || progress.found || 0;
    const total = progress.total || 0;
    const phones = progress.phoneCount || 0;
    const rejected = progress.rejected || 0;
    const isExhausted = progress.finishedReason === 'all_posts_exhausted';

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'searchCompletionModalOverlay';
    overlay.innerHTML = `
      <div class="modal glass-panel" style="max-width: 480px; border-radius: 16px; border: 1px solid var(--glass-border); box-shadow: 0 20px 60px rgba(0,0,0,0.25); animation: fadeIn 0.25s ease-out; background: var(--bg-card);">
        <div class="modal-header" style="border-bottom: 1px solid var(--glass-border); padding-bottom: 14px; margin-bottom: 0;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 1.8rem;">🎉</span>
            <div>
              <h3 style="margin: 0; font-size: 1.2rem; font-weight: 700; color: var(--text-primary);">Hoàn Tất Quét Bài Viết</h3>
              ${keyword ? `<p style="margin: 3px 0 0 0; font-size: 0.85rem; color: var(--text-secondary);">Từ khóa: <strong style="color: var(--color-primary, #2563eb); font-weight: 700;">"${escapeHtml(keyword)}"</strong></p>` : ''}
            </div>
          </div>
          <button class="modal-close" id="btnCloseCompleteModal" style="color: var(--text-primary); font-size: 1.6rem; line-height: 1; cursor: pointer; padding: 0 4px;">&times;</button>
        </div>
        <div class="modal-body" style="padding-top: 16px; margin-bottom: 16px;">
          <div class="modal-completion-banner ${isExhausted ? 'exhausted' : 'target-reached'}">
            ${isExhausted 
              ? `<div class="banner-title">⚡ Đã quét sạch toàn bộ bài viết trên Facebook!</div>
                 <span class="banner-desc">Facebook không còn bài viết mới nào khác để cuộn thêm trong 24 giờ qua cho từ khóa này.</span>` 
              : `<div class="banner-title">🎯 Đã hoàn thành thu thập đủ ${accepted}/${total} lead mục tiêu!</div>
                 <span class="banner-desc">Hệ thống đã bóc tách đầy đủ bài viết và số điện thoại theo chỉ tiêu đã đặt.</span>`}
          </div>

          <div class="modal-stat-grid">
            <div class="modal-stat-card modal-stat-card-green">
              <div class="stat-number">${accepted}</div>
              <div class="stat-label">Lead được duyệt</div>
            </div>
            <div class="modal-stat-card modal-stat-card-blue">
              <div class="stat-number">${phones}</div>
              <div class="stat-label">Có số điện thoại</div>
            </div>
            <div class="modal-stat-card modal-stat-card-red">
              <div class="stat-number">${rejected}</div>
              <div class="stat-label">Bài rác đã loại</div>
            </div>
          </div>
        </div>
        <div class="modal-footer" style="border-top: 1px solid var(--glass-border); padding-top: 14px; gap: 10px;">
          <button class="btn btn-secondary" id="btnDismissCompleteModal" style="font-weight: 600;">Xem Danh Sách Lead</button>
          <button class="btn btn-primary" id="btnExportFromModal" style="background: #059669; border-color: #059669; font-weight: 700; color: #ffffff;">📊 Xuất File Excel</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const closeFn = () => overlay.remove();
    document.getElementById('btnCloseCompleteModal')?.addEventListener('click', closeFn);
    document.getElementById('btnDismissCompleteModal')?.addEventListener('click', closeFn);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeFn();
    });
    document.getElementById('btnExportFromModal')?.addEventListener('click', () => {
        closeFn();
        handleExport();
    });
}

function setSearchState(status) {
    state.search.status = status;
    const btnSearch = document.getElementById('btnSearch');
    const btnStopSearch = document.getElementById('btnStopSearch');
    const progressSection = document.getElementById('searchProgressSection');

    if (status === 'searching') {
        if (btnSearch) btnSearch.style.display = 'none';
        if (btnStopSearch) btnStopSearch.style.display = 'block';
        if (progressSection) progressSection.style.display = 'block';
    } else {
        if (btnSearch) btnSearch.style.display = 'block';
        if (btnStopSearch) btnStopSearch.style.display = 'none';
    }
}

function updateProgressUI(progress) {
    const text = document.getElementById('searchProgressText');
    const count = document.getElementById('searchProgressCount');
    const fill = document.getElementById('searchProgressFill');

    const found = progress.found || 0;
    const review = progress.review || 0;
    const total = progress.total || state.search.progress.total || 10;
    const percent = Math.min(100, Math.round((found / total) * 100));

    if (text) text.textContent = `Đang quét Bảng tin & Bóc tách SĐT... (${percent}%)`;
    if (count) count.textContent = `${found} / ${total} lead đã duyệt${review ? ` · ${review} cần kiểm tra` : ''}`;
    if (fill) fill.style.width = `${percent}%`;
}

async function fetchResultsHistory() {
    try {
        // 1. Nạp 100% dữ liệu từ IndexedDB trên máy Client (độc lập hoàn toàn, không nạp tự động từ Server)
        if (window.ClientDB) {
            const clientLeads = await window.ClientDB.getAllLeads();
            state.search.results = clientLeads || [];
            renderTable();
            return;
        }

        // 2. Fallback nếu trình duyệt không hỗ trợ IndexedDB (chỉ lấy task kết quả của riêng clientId này)
        const clientId = getClientId();
        const res = await api('GET', `/api/search/results?clientId=${encodeURIComponent(clientId)}`);
        if (res && res.results) {
            state.search.results = res.results;
            renderTable();
        }
    } catch (e) {}
}

let _prevStatCounts = { total: -1, new: -1, lead: -1, duplicate: -1, none: -1 };

/**
 * Cập nhật số liệu thống kê Realtime & Trạng thái Active trên các huy hiệu (Stat Pills)
 */
function updateStatPills() {
    const allStoredResults = state.search.results || [];
    const statTotalCount = allStoredResults.length;
    let statNewCount = 0;
    let statLeadCount = 0;
    let statDuplicateCount = 0;
    let statNoneCount = 0;

    allStoredResults.forEach(item => {
        const s = item.status || 'Mới tạo';
        if (s === 'Mới tạo') statNewCount++;
        else if (s === 'Đã nhập lead') statLeadCount++;
        else if (s === 'Trùng lead') statDuplicateCount++;
        else if (s === 'Không có nhu cầu') statNoneCount++;
        else statNewCount++;
    });

    const currentCounts = {
        total: statTotalCount,
        new: statNewCount,
        lead: statLeadCount,
        duplicate: statDuplicateCount,
        none: statNoneCount
    };

    const currentFilterStatus = state.dateFilter.status || 'all';

    function setPillUI(elId, count, labelHtml, countKey, isActive) {
        const el = document.getElementById(elId);
        if (!el) return;

        el.innerHTML = labelHtml;

        if (isActive) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }

        // Hiệu ứng nhịp đập (pulse) thời gian thực khi số liệu thay đổi
        if (_prevStatCounts[countKey] !== -1 && _prevStatCounts[countKey] !== count) {
            el.classList.remove('pill-pulse');
            void el.offsetWidth; // Trigger reflow for animation restart
            el.classList.add('pill-pulse');
        }
    }

    setPillUI('statPillTotal', statTotalCount, `📊 Tổng: <strong>${statTotalCount}</strong> bài`, 'total', currentFilterStatus === 'all');
    setPillUI('statPillNew', statNewCount, `🆕 <strong>${statNewCount}</strong> Mới`, 'new', currentFilterStatus === 'Mới tạo');
    setPillUI('statPillLead', statLeadCount, `📥 <strong>${statLeadCount}</strong> Lead`, 'lead', currentFilterStatus === 'Đã nhập lead');
    setPillUI('statPillDuplicate', statDuplicateCount, `⚠️ <strong>${statDuplicateCount}</strong> Trùng`, 'duplicate', currentFilterStatus === 'Trùng lead');
    setPillUI('statPillNone', statNoneCount, `❌ <strong>${statNoneCount}</strong> Bỏ`, 'none', currentFilterStatus === 'Không có nhu cầu');

    _prevStatCounts = currentCounts;
}

/**
 * Render Table with Pagination (10 Rows per Page) & Checkboxes & Date Filter
 */
function renderTable() {
    const resultsSection = document.getElementById('resultsSection');
    const tbody = document.getElementById('resultsTableBody');
    const emptyResults = document.getElementById('emptyResults');
    const paginationInfo = document.getElementById('paginationInfo');
    const pageNumbersContainer = document.getElementById('pageNumbersContainer');
    const btnPrevPage = document.getElementById('btnPrevPage');
    const btnNextPage = document.getElementById('btnNextPage');
    const resultTotalBadge = document.getElementById('resultTotalBadge');
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    const btnDeleteSelected = document.getElementById('btnDeleteSelected');
    const selectedCountBadge = document.getElementById('selectedCountBadge');

    if (!resultsSection || !tbody) return;
    resultsSection.style.display = 'block';
    tbody.innerHTML = '';

    // Cập nhật huy hiệu thống kê Realtime
    updateStatPills();

    const data = getFilteredAndSortedResults();
    const totalItems = data.length;
    state.pagination.totalPages = Math.max(1, Math.ceil(totalItems / state.pagination.pageSize));

    if (state.pagination.currentPage > state.pagination.totalPages) {
        state.pagination.currentPage = state.pagination.totalPages;
    }

    if (resultTotalBadge) {
        const isQueryActive = state.dateFilter.query && state.dateFilter.query.trim() !== '';
        const isStatusFiltered = state.dateFilter.status && state.dateFilter.status !== 'all';
        const isDateFiltered = state.dateFilter.active && (state.dateFilter.fromDate || state.dateFilter.toDate);
        
        let label = `Tổng cộng: ${totalItems} bài viết đã lưu`;
        const filters = [];
        if (isQueryActive) filters.push(`Từ khóa: "${state.dateFilter.query.trim()}"`);
        if (isStatusFiltered) filters.push(`Trạng thái: ${state.dateFilter.status}`);
        if (isDateFiltered) filters.push(`Mới nhất ở trên`);

        if (filters.length > 0) {
            label = `Đang lọc: ${totalItems} kết quả [ ${filters.join(' | ')} ]`;
        }

        resultTotalBadge.textContent = label;
    }

    // Update Selected Badge (cố định luôn hiển thị nút Xóa đã chọn)
    if (selectedCountBadge) {
        selectedCountBadge.textContent = state.selectedKeys.size;
    }

    // Update Select All Checkbox state based on visible data
    if (selectAllCheckbox) {
        const allKeys = data.map(getItemKey);
        selectAllCheckbox.checked = allKeys.length > 0 && allKeys.every(k => state.selectedKeys.has(k));
    }

    if (totalItems === 0) {
        if (emptyResults) emptyResults.style.display = 'block';
        if (paginationInfo) paginationInfo.textContent = 'Chưa có kết quả nào';
        if (btnPrevPage) btnPrevPage.disabled = true;
        if (btnNextPage) btnNextPage.disabled = true;
        if (pageNumbersContainer) pageNumbersContainer.innerHTML = '';
        return;
    }

    if (emptyResults) emptyResults.style.display = 'none';

    // Slice 10 rows per page
    const startIndex = (state.pagination.currentPage - 1) * state.pagination.pageSize;
    const endIndex = Math.min(startIndex + state.pagination.pageSize, totalItems);
    const pageData = data.slice(startIndex, endIndex);

    pageData.forEach((item, idx) => {
        const globalIndex = startIndex + idx + 1;
        const key = getItemKey(item);
        const isChecked = state.selectedKeys.has(key);

        const tr = document.createElement('tr');
        const rawPhonesList = Array.isArray(item.phones) && item.phones.length > 0
            ? item.phones
            : (Array.isArray(item.verifiedPhones) ? item.verifiedPhones : []);
        const uniquePhones = Array.from(new Set(rawPhonesList)).slice(0, 4);
        const phoneDisplay = uniquePhones.length > 0
            ? uniquePhones.map(p => `<span class="badge badge-active">${escapeHtml(p)}</span>`).join(' ')
            : '<span class="text-muted">—</span>';

        const summaryText = cleanPostTextForDisplay(item.summary || item.aiSummary || item.content || '');
        const fullContent = cleanPostTextForDisplay(item.content || item.summary || '');
        const summarySnippet = summaryText.length > 250 ? summaryText.substring(0, 250) + '...' : summaryText;
        const summaryDisplay = `<div class="summary-cell text-sm font-normal" title="${escapeHtml(fullContent)}" style="line-height: 1.5; color: var(--text-primary);">${escapeHtml(summarySnippet || '—')}</div>`;

        const locationDisplay = (item.location && item.location !== '—')
            ? `<span class="location-pill" title="Địa điểm: ${escapeHtml(item.location)}">📍 ${escapeHtml(item.location)}</span>`
            : '<span class="text-muted">—</span>';

        const postLink = item.postLink || item.postUrl || '';
        const profileLink = item.profileLink || item.authorUrl || '';

        const statusVal = item.status || 'Mới tạo';

        tr.innerHTML = `
            <td class="text-center">
                <input type="checkbox" class="row-checkbox custom-checkbox" data-key="${escapeHtml(key)}" ${isChecked ? 'checked' : ''}>
            </td>
            <td class="text-center font-medium" style="color: #94a3b8;">${globalIndex}</td>
            <td>
                <select class="status-select-sm" data-key="${escapeHtml(key)}" data-status="${escapeHtml(statusVal)}">
                    <option value="Mới tạo" ${statusVal === 'Mới tạo' ? 'selected' : ''}>🆕 Mới tạo</option>
                    <option value="Đã nhập lead" ${statusVal === 'Đã nhập lead' ? 'selected' : ''}>📥 Đã nhập lead</option>
                    <option value="Trùng lead" ${statusVal === 'Trùng lead' ? 'selected' : ''}>⚠️ Trùng lead</option>
                    <option value="Không có nhu cầu" ${statusVal === 'Không có nhu cầu' ? 'selected' : ''}>❌ Không có nhu cầu</option>
                </select>
            </td>
            <td><strong>${escapeHtml(item.authorName || 'N/A')}</strong></td>
            <td>${locationDisplay}</td>
            <td>${phoneDisplay}</td>
            <td>${escapeHtml(item.postedTime || '')}</td>
            <td>${summaryDisplay}</td>
            <td style="min-width: 125px; white-space: nowrap;">
                <div class="d-flex flex-col gap-1" style="min-width: 115px;">
                    ${postLink ? `<a href="${escapeHtml(postLink)}" target="_blank" class="btn btn-ghost btn-xs text-xs font-semibold" style="color: #60a5fa; border: 1px solid rgba(96, 165, 250, 0.4); border-radius: 5px; padding: 4px 8px; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; gap: 4px; white-space: nowrap;" title="Mở đúng bài viết gốc trên Facebook">📄 Bài Viết ↗</a>` : ''}
                    ${profileLink ? `<a href="${escapeHtml(profileLink)}" target="_blank" class="link text-xs text-muted" style="display: inline-flex; align-items: center; gap: 3px; padding-left: 4px; white-space: nowrap;" title="Mở Profile">👤 Profile ↗</a>` : ''}
                    ${(!postLink && !profileLink) ? '<span class="text-muted">—</span>' : ''}
                </div>
            </td>
        `;

        const statusSelect = tr.querySelector('.status-select-sm');
        if (statusSelect) {
            statusSelect.addEventListener('change', async (e) => {
                const newStatus = e.target.value;
                const prevStatus = item.status || 'Mới tạo';
                e.target.setAttribute('data-status', newStatus);
                item.status = newStatus;

                // 1. Đồng bộ ngay lập tức vào mảng dữ liệu đang lưu trong bộ nhớ (state.search.results)
                if (Array.isArray(state.search.results)) {
                    const found = state.search.results.find(r => getItemKey(r) === key);
                    if (found) found.status = newStatus;
                }

                // 2. Cập nhật vào cơ sở dữ liệu IndexedDB trên máy Client
                if (window.ClientDB) {
                    window.ClientDB.updateStatus(key, newStatus).catch(() => {});
                }

                // 3. Cập nhật số liệu thống kê realtime ngay lập tức trên các huy hiệu (pills)
                updateStatPills();

                // 4. Nếu đang áp dụng lọc theo trạng thái, lọc lại bảng ngay lập tức để danh sách hiển thị khớp thời gian thực
                if (state.dateFilter.status && state.dateFilter.status !== 'all') {
                    renderTable();
                }

                try {
                    const res = await api('POST', '/api/search/update-status', { key: key, status: newStatus });
                    if (res && Array.isArray(res.results)) {
                        state.search.results = res.results;
                        updateStatPills();
                    }
                    showToast(`Đã cập nhật trạng thái: "${newStatus}"`, 'success');
                } catch (err) {
                    // Trạng thái đã được lưu an toàn trong IndexedDB máy Client
                    showToast(`Đã lưu trạng thái "${newStatus}" trên máy bạn!`, 'info');
                }
            });
        }

        // Row checkbox listener
        const chk = tr.querySelector('.row-checkbox');
        if (chk) {
            chk.addEventListener('change', (e) => {
                if (e.target.checked) state.selectedKeys.add(key);
                else state.selectedKeys.delete(key);
                renderTable();
            });
        }

        tbody.appendChild(tr);
    });

    // Update Pagination Bar
    if (paginationInfo) {
        paginationInfo.textContent = `Hiển thị ${startIndex + 1} - ${endIndex} trên ${totalItems} kết quả (Trang ${state.pagination.currentPage}/${state.pagination.totalPages})`;
    }

    if (btnPrevPage) btnPrevPage.disabled = state.pagination.currentPage <= 1;
    if (btnNextPage) btnNextPage.disabled = state.pagination.currentPage >= state.pagination.totalPages;

    // Render Page Numbers
    if (pageNumbersContainer) {
        pageNumbersContainer.innerHTML = '';
        const maxPagesToShow = 5;
        let startP = Math.max(1, state.pagination.currentPage - 2);
        let endP = Math.min(state.pagination.totalPages, startP + maxPagesToShow - 1);

        for (let p = startP; p <= endP; p++) {
            const btnP = document.createElement('button');
            btnP.type = 'button';
            btnP.className = `btn btn-sm ${p === state.pagination.currentPage ? 'btn-purple-full' : 'btn-ghost'}`;
            btnP.style.padding = '4px 10px';
            btnP.textContent = p;
            btnP.addEventListener('click', () => {
                state.pagination.currentPage = p;
                renderTable();
            });
            pageNumbersContainer.appendChild(btnP);
        }
    }
}

async function handleExport() {
    const btnExport = document.getElementById('btnExport');
    let exportData = getFilteredAndSortedResults();

    // If items are checked, export ONLY checked items!
    if (state.selectedKeys.size > 0) {
        exportData = exportData.filter(item => state.selectedKeys.has(getItemKey(item)));
    }

    if (!exportData || !exportData.length) {
        showToast('Không có dữ liệu để xuất Excel', 'warning');
        return;
    }
    
    setLoading(btnExport, true);
    try {
        const exportConfig = {
            provinceCode: document.getElementById('cfgExportProvinceCode')?.value.trim() || state.config?.exportConfig?.provinceCode || '__export__.res_province_121_cf34d119',
            productGroup: document.getElementById('cfgExportProductGroup')?.value.trim() || state.config?.exportConfig?.productGroup || 'RETAIL_PRO',
            salesRep: document.getElementById('cfgExportSalesRep')?.value.trim() || state.config?.exportConfig?.salesRep || 'trucnt@sapo.vn'
        };

        const response = await fetch('/api/export/excel-stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ results: exportData, exportConfig })
        });

        if (!response.ok) {
            const errJson = await response.json().catch(() => ({}));
            throw new Error(errJson.error || `Lỗi xuất file (${response.status})`);
        }

        const blob = await response.blob();
        const headerFilename = response.headers.get('X-Filename');
        const filename = headerFilename || `fb_leads_import_${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`;

        // Ghi trực tiếp vào thư mục máy Client (exports/filename) hoặc tải về Downloads
        if (window.ClientFS) {
            const saveRes = await window.ClientFS.saveFile('exports', filename, blob, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            if (saveRes && saveRes.directWrite) {
                showToast(`Đã xuất ${exportData.length} lead và lưu trực tiếp vào thư mục máy bạn: ${saveRes.path}!`, 'success');
            } else {
                showToast(`Đã tải file Excel: ${filename} về máy của bạn!`, 'success');
            }
        } else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            showToast(`Đã tải file Excel: ${filename}`, 'success');
        }
    } catch (e) {
        showToast(e.message || 'Xuất Excel thất bại', 'error');
    } finally {
        setLoading(btnExport, false);
    }
}

async function handleClearHistory() {
    if (!confirm('Bạn có chắc chắn muốn xóa TOÀN BỘ lịch sử dữ liệu bóc tách trên máy bạn?')) return;
    try {
        if (window.ClientDB) {
            await window.ClientDB.clearAll();
        }
        api('POST', '/api/search/clear-history', { clientId: getClientId() }).catch(() => {});
        state.search.results = [];
        state.selectedKeys.clear();
        state.pagination.currentPage = 1;
        renderTable();
        showToast('Đã xóa toàn bộ lịch sử dữ liệu trên máy bạn!', 'info');
    } catch (e) {
        showToast('Không thể xóa lịch sử', 'error');
    }
}

async function handleDeleteSelected() {
    if (state.selectedKeys.size === 0) {
        showToast('Vui lòng tích chọn ít nhất 1 bài viết để xóa!', 'warning');
        return;
    }
    const keysArray = Array.from(state.selectedKeys);
    if (!confirm(`Bạn có chắc chắn muốn xóa vĩnh viễn ${keysArray.length} bài viết đã chọn khỏi lịch sử?`)) return;

    try {
        if (window.ClientDB) {
            await window.ClientDB.deleteSelected(keysArray);
            state.search.results = await window.ClientDB.getAllLeads();
        } else {
            state.search.results = (state.search.results || []).filter(item => !state.selectedKeys.has(getItemKey(item)));
        }

        api('POST', '/api/search/delete-selected', { keys: keysArray, clientId: getClientId() }).catch(() => {});
        state.selectedKeys.clear();
        renderTable();
        showToast(`Đã xóa vĩnh viễn ${keysArray.length} bài viết đã chọn khỏi lịch sử!`, 'info');
    } catch (e) {
        showToast(e.message || 'Không thể xóa bài viết khỏi lịch sử', 'error');
    }
}

/**
 * Config API Handlers
 */
async function fetchConfig() {
    try {
        const config = await api('GET', '/api/config');
        state.config = config;
        
        const chkHeadless = document.getElementById('cfgHeadless');
        const configHeadless = document.getElementById('configHeadless');
        const inputCrawlDelay = document.getElementById('cfgCrawlDelay');
        const inputMaxPosts = document.getElementById('cfgMaxPosts');
        const filterMaxPosts = document.getElementById('filterMaxPosts');

        const chkExcludeEnterprise = document.getElementById('cfgExcludeEnterprise');
        const chkExcludeCompetitors = document.getElementById('cfgExcludeCompetitors');
        const chkExcludeUnsupported = document.getElementById('cfgExcludeUnsupported');
        const chkRequireMobileOnly = document.getElementById('cfgRequireMobileOnly');

        const isHeadless = !!config.headless;
        const crawlDelay = config.crawlDelay || 2000;
        const maxPosts = config.maxPosts || 50;

        if (chkHeadless) chkHeadless.checked = isHeadless;
        if (configHeadless) configHeadless.checked = isHeadless;
        if (inputCrawlDelay) inputCrawlDelay.value = crawlDelay;
        if (inputMaxPosts) inputMaxPosts.value = maxPosts;
        if (filterMaxPosts) filterMaxPosts.value = maxPosts;

        if (chkExcludeEnterprise) chkExcludeEnterprise.checked = config.excludeEnterpriseChains !== false;
        if (chkExcludeCompetitors) chkExcludeCompetitors.checked = config.excludePosCompetitors === true;
        if (chkExcludeUnsupported) chkExcludeUnsupported.checked = config.excludeUnsupportedIndustries !== false;
        if (chkRequireMobileOnly) chkRequireMobileOnly.checked = config.requireMobilePhoneOnly !== false;
        const chkRequirePhoneOnly = document.getElementById('chkRequirePhoneOnly');
        const cfgRequirePhoneOnly = document.getElementById('cfgRequirePhoneOnly');
        if (chkRequirePhoneOnly) chkRequirePhoneOnly.checked = config.requirePhoneOnly === true;
        if (cfgRequirePhoneOnly) cfgRequirePhoneOnly.checked = config.requirePhoneOnly === true;

        // AI Configuration Sync
        const chkAiEnabled = document.getElementById('cfgAiEnabled');
        const selAiProvider = document.getElementById('cfgAiProvider');
        const inputGeminiApiKey = document.getElementById('cfgGeminiApiKey');
        const inputMinLeadScore = document.getElementById('cfgMinLeadScore');
        const txtAiPromptContext = document.getElementById('cfgAiPromptContext');

        if (chkAiEnabled) chkAiEnabled.checked = config.aiEnabled !== false;
        const currentProvider = config.aiProvider || 'groq';
        if (selAiProvider) selAiProvider.value = currentProvider;
        updateAiProviderUI(currentProvider);

        if (inputGeminiApiKey) {
            if (currentProvider === 'groq') {
                inputGeminiApiKey.value = config.groqApiKey || '';
            } else if (currentProvider === 'gemini') {
                inputGeminiApiKey.value = config.geminiApiKey || config.aiApiKey || '';
            } else {
                inputGeminiApiKey.value = config.aiApiKey || '';
            }
        }

        if (inputMinLeadScore && typeof (config.acceptedLeadScore ?? config.minLeadScore) === 'number') {
            inputMinLeadScore.value = config.acceptedLeadScore ?? config.minLeadScore;
        }
        if (txtAiPromptContext) txtAiPromptContext.value = config.aiPromptContext || DEFAULT_AI_PROMPT_CONTEXT;

        const inputExportProvince = document.getElementById('cfgExportProvinceCode');
        const inputExportProduct = document.getElementById('cfgExportProductGroup');
        const inputExportSalesRep = document.getElementById('cfgExportSalesRep');
        if (config.exportConfig) {
            if (inputExportProvince && config.exportConfig.provinceCode) inputExportProvince.value = config.exportConfig.provinceCode;
            if (inputExportProduct && config.exportConfig.productGroup) inputExportProduct.value = config.exportConfig.productGroup;
            if (inputExportSalesRep && config.exportConfig.salesRep) inputExportSalesRep.value = config.exportConfig.salesRep;
        }

        if (config.defaultFilters) {
            const filterRecentPosts = document.getElementById('filterRecentPosts');
            if (filterRecentPosts && config.defaultFilters.recentPosts !== undefined) {
                filterRecentPosts.checked = !!config.defaultFilters.recentPosts;
            }
            const filterDatePosted = document.getElementById('filterDatePosted');
            if (filterDatePosted && config.defaultFilters.datePosted !== undefined) {
                filterDatePosted.value = config.defaultFilters.datePosted === 'any' ? '' : config.defaultFilters.datePosted;
            }
        }

        const excludeKeywordsInput = document.getElementById('excludeKeywordsInput');
        if (excludeKeywordsInput) {
            const localVal = localStorage.getItem('fb_automation_exclude_keywords');
            if (localVal !== null && localVal.trim() !== '') {
                excludeKeywordsInput.value = localVal;
            } else if (config.excludeKeywords) {
                excludeKeywordsInput.value = config.excludeKeywords;
                localStorage.setItem('fb_automation_exclude_keywords', config.excludeKeywords);
            }
        }
    } catch (err) {
        // Silently use defaults
    }
}

function updateAiProviderUI(provider) {
    const lblApiKey = document.getElementById('cfgApiKeyLabel');
    const inputApiKey = document.getElementById('cfgGeminiApiKey');
    const linkHelp = document.getElementById('cfgApiKeyHelpLink');
    const badgeModel = document.getElementById('cfgGeminiModelBadge');
    const statusText = document.getElementById('testAiStatusText');

    if (provider === 'groq') {
        if (lblApiKey) lblApiKey.textContent = 'Groq API Key (Miễn phí 100%, 14.400 req/ngày - Khuyên dùng)';
        if (inputApiKey) {
            inputApiKey.placeholder = 'Dán Groq API Key của bạn (gsk_...)';
            if (state.config?.groqApiKey) inputApiKey.value = state.config.groqApiKey;
        }
        if (linkHelp) {
            linkHelp.href = 'https://console.groq.com/keys';
            linkHelp.textContent = '👉 Bấm vào đây để lấy Groq API Key miễn phí (14.400 req/ngày)';
        }
        if (badgeModel) {
            badgeModel.textContent = `⚡ Model: ${state.config?.groqModel || 'qwen/qwen3.8-27b'}`;
            badgeModel.style.background = 'rgba(16, 185, 129, 0.15)';
            badgeModel.style.color = '#10b981';
            badgeModel.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        }
        if (statusText) statusText.textContent = 'Bấm để kiểm tra kết nối với Groq Cloud (Tự động phát hiện model mới nhất).';
    } else if (provider === 'gemini') {
        if (lblApiKey) lblApiKey.textContent = 'Google Gemini API Key (Miễn phí)';
        if (inputApiKey) {
            inputApiKey.placeholder = 'Dán Gemini API Key của bạn (AIzaSy...)';
            if (state.config?.geminiApiKey || state.config?.aiApiKey) {
                inputApiKey.value = state.config.geminiApiKey || state.config.aiApiKey;
            }
        }
        if (linkHelp) {
            linkHelp.href = 'https://aistudio.google.com/app/apikey';
            linkHelp.textContent = '👉 Bấm vào đây để lấy Gemini API Key miễn phí tại Google AI Studio';
        }
        if (badgeModel) {
            badgeModel.textContent = `⚡ Model: ${state.config?.geminiModel || 'gemini-3.5-flash-lite'}`;
            badgeModel.style.background = 'rgba(16, 185, 129, 0.15)';
            badgeModel.style.color = '#10b981';
            badgeModel.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        }
        if (statusText) statusText.textContent = 'Bấm để kiểm tra kết nối với Google Gemini AI mới nhất.';
    } else if (provider === 'openai') {
        if (lblApiKey) lblApiKey.textContent = 'OpenAI API Key (sk-...)';
        if (inputApiKey) {
            inputApiKey.placeholder = 'sk-...';
            if (state.config?.aiApiKey) inputApiKey.value = state.config.aiApiKey;
        }
        if (linkHelp) {
            linkHelp.href = 'https://platform.openai.com/api-keys';
            linkHelp.textContent = '👉 Lấy OpenAI API Key tại platform.openai.com';
        }
        if (badgeModel) {
            badgeModel.textContent = '⚡ Model: GPT-4o-mini';
            badgeModel.style.background = 'rgba(59, 130, 246, 0.15)';
            badgeModel.style.color = '#60a5fa';
            badgeModel.style.borderColor = 'rgba(59, 130, 246, 0.4)';
        }
        if (statusText) statusText.textContent = 'Bấm để kiểm tra kết nối với OpenAI GPT-4o-mini.';
    } else if (provider === 'deepseek') {
        if (lblApiKey) lblApiKey.textContent = 'DeepSeek API Key (sk-...)';
        if (inputApiKey) {
            inputApiKey.placeholder = 'sk-...';
            if (state.config?.aiApiKey) inputApiKey.value = state.config.aiApiKey;
        }
        if (linkHelp) {
            linkHelp.href = 'https://platform.deepseek.com/api_keys';
            linkHelp.textContent = '👉 Lấy DeepSeek API Key tại platform.deepseek.com';
        }
        if (badgeModel) {
            badgeModel.textContent = '⚡ Model: DeepSeek V3';
            badgeModel.style.background = 'rgba(168, 85, 247, 0.15)';
            badgeModel.style.color = '#c084fc';
            badgeModel.style.borderColor = 'rgba(168, 85, 247, 0.4)';
        }
        if (statusText) statusText.textContent = 'Bấm để kiểm tra kết nối với DeepSeek V3.';
    } else if (provider === 'free_hybrid') {
        if (lblApiKey) lblApiKey.textContent = 'API Key (Không bắt buộc với Free Hybrid)';
        if (inputApiKey) {
            inputApiKey.placeholder = 'Không cần API Key (Hệ thống tự cân bằng)';
            inputApiKey.value = '';
        }
        if (linkHelp) {
            linkHelp.href = '#';
            linkHelp.textContent = 'Không cần đăng ký API Key';
        }
        if (badgeModel) {
            badgeModel.textContent = '⚡ Model: Free Hybrid AI';
            badgeModel.style.background = 'rgba(234, 179, 8, 0.15)';
            badgeModel.style.color = '#facc15';
            badgeModel.style.borderColor = 'rgba(234, 179, 8, 0.4)';
        }
        if (statusText) statusText.textContent = 'Chế độ miễn phí tốc độ cao không cần key.';
    }
}

async function handleSaveConfig(e) {
    e.preventDefault();
    const btnSave = document.getElementById('btnSaveConfig');
    setLoading(btnSave, true);

    const headlessVal = document.getElementById('configHeadless')?.checked ?? (state.config?.headless || false);
    const crawlDelayVal = parseInt(document.getElementById('cfgCrawlDelay')?.value, 10) || 2000;
    const maxPostsVal = parseInt(document.getElementById('cfgMaxPosts')?.value, 10) || 50;

    const excludeEnterprise = document.getElementById('cfgExcludeEnterprise')?.checked ?? true;
    const excludeCompetitors = document.getElementById('cfgExcludeCompetitors')?.checked ?? false;
    const excludeUnsupported = document.getElementById('cfgExcludeUnsupported')?.checked ?? true;
    const requireMobileOnly = document.getElementById('cfgRequireMobileOnly')?.checked ?? true;
    const requirePhoneOnly = document.getElementById('cfgRequirePhoneOnly')?.checked ?? false;

    const aiEnabledVal = document.getElementById('cfgAiEnabled')?.checked ?? true;
    const aiProviderVal = document.getElementById('cfgAiProvider')?.value || 'groq';
    const enteredApiKey = document.getElementById('cfgGeminiApiKey')?.value.trim() || '';
    const minLeadScoreVal = parseInt(document.getElementById('cfgMinLeadScore')?.value, 10) || 75;
    const aiPromptContextVal = document.getElementById('cfgAiPromptContext')?.value.trim() || DEFAULT_AI_PROMPT_CONTEXT;

    const exportProvinceCode = document.getElementById('cfgExportProvinceCode')?.value.trim() || '__export__.res_province_121_cf34d119';
    const exportProductGroup = document.getElementById('cfgExportProductGroup')?.value.trim() || 'RETAIL_PRO';
    const exportSalesRep = document.getElementById('cfgExportSalesRep')?.value.trim() || 'trucnt@sapo.vn';

    const groqKey = aiProviderVal === 'groq' ? enteredApiKey : (state.config?.groqApiKey || '');
    const geminiKey = aiProviderVal === 'gemini' ? enteredApiKey : (state.config?.geminiApiKey || '');

    const payload = {
        headless: headlessVal,
        crawlDelay: crawlDelayVal,
        maxPosts: maxPostsVal,
        excludeEnterpriseChains: excludeEnterprise,
        excludePosCompetitors: excludeCompetitors,
        excludeUnsupportedIndustries: excludeUnsupported,
        requireMobilePhoneOnly: requireMobileOnly,
        requirePhoneOnly: requirePhoneOnly,
        aiEnabled: aiEnabledVal,
        aiProvider: aiProviderVal,
        aiApiKey: enteredApiKey,
        geminiApiKey: geminiKey,
        geminiModel: state.config?.geminiModel || 'gemini-3.5-flash-lite',
        groqApiKey: groqKey,
        groqModel: state.config?.groqModel || 'qwen/qwen3.8-27b',
        minLeadScore: minLeadScoreVal,
        acceptedLeadScore: minLeadScoreVal,
        reviewLeadScore: state.config?.reviewLeadScore ?? 45,
        aiPromptContext: aiPromptContextVal,
        exportConfig: {
            provinceCode: exportProvinceCode,
            productGroup: exportProductGroup,
            salesRep: exportSalesRep
        }
    };

    try {
        await api('PUT', '/api/config', payload);
        state.config = payload;
        
        const configHeadless = document.getElementById('configHeadless');
        if (configHeadless) configHeadless.checked = payload.headless;

        const filterMaxPosts = document.getElementById('filterMaxPosts');
        if (filterMaxPosts) filterMaxPosts.value = maxPostsVal;

        showToast(`Đã lưu cấu hình AI & Ngữ cảnh thành công!`, 'success');
    } catch (err) {
        showToast(err.message || 'Lỗi lưu cấu hình', 'error');
    } finally {
        setLoading(btnSave, false);
    }
}

/**
 * Real-time AI Connection & Prompt Context Tester
 */
async function handleTestAiConnection() {
    const btnTest = document.getElementById('btnTestAiConnection');
    const resultBox = document.getElementById('testAiResultBox');
    const statusText = document.getElementById('testAiStatusText');
    const apiKey = (document.getElementById('cfgGeminiApiKey')?.value || '').trim();
    const provider = document.getElementById('cfgAiProvider')?.value || 'groq';
    const context = document.getElementById('cfgAiPromptContext')?.value.trim() || '';

    const providerName = provider === 'groq' ? 'Groq Cloud' : (provider === 'gemini' ? 'Google Gemini' : provider.toUpperCase());

    if (!apiKey && provider !== 'free_hybrid') {
        showToast(`Vui lòng dán ${providerName} API Key vào ô trên trước khi kiểm tra!`, 'warning');
        return;
    }

    if (btnTest) setLoading(btnTest, true);
    if (statusText) statusText.textContent = `⏳ Đang kiểm tra kết nối ${providerName}...`;
    if (resultBox) {
        resultBox.style.display = 'block';
        resultBox.innerHTML = `<div class="p-3 text-sm" style="color: #93c5fd;">⏳ Đang kết nối tới ${providerName} để kiểm tra kết nối... Vui lòng đợi trong giây lát!</div>`;
    }

    try {
        const res = await api('POST', '/api/config/test-ai', {
            apiKey,
            provider,
            context
        });

        if (res.success) {
            const selectedModel = res.selectedModel || res.result?.provider || (provider === 'groq' ? 'qwen/qwen3.8-27b' : 'gemini-3.5-flash-lite');
            if (provider === 'gemini') {
                state.config.geminiModel = selectedModel;
                state.config.geminiApiKey = apiKey;
            } else if (provider === 'groq') {
                state.config.groqModel = selectedModel;
                state.config.groqApiKey = apiKey;
            }
            state.config.aiApiKey = apiKey;

            const modelBadge = document.getElementById('cfgGeminiModelBadge');
            if (modelBadge) {
                modelBadge.textContent = `⚡ Model: ${selectedModel}`;
                modelBadge.style.background = 'rgba(16, 185, 129, 0.15)';
                modelBadge.style.color = '#10b981';
                modelBadge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
            }

            showToast(`✅ Kết nối thành công! Model: ${selectedModel} (${res.latencyMs}ms)`, 'success');
            if (statusText) statusText.innerHTML = `<span style="color: #10b981; font-weight: 600;">✅ Kết nối thành công (${res.latencyMs}ms) — Đã chọn: ${selectedModel}</span>`;
            if (resultBox) {
                const supportedList = Array.isArray(res.supportedModels) ? res.supportedModels.slice(0, 6).join(', ') : selectedModel;
                const resultData = res.result || {};
                resultBox.innerHTML = `
                <div class="ai-result-success-card" style="padding: 16px 20px;">
                    <div class="ai-result-header" style="color: #059669; margin-bottom: 8px; font-size: 0.95rem; display: flex; align-items: center; gap: 8px; font-weight: 700;">
                        <span>✅</span> KẾT NỐI ${providerName.toUpperCase()} THÀNH CÔNG (${res.latencyMs}ms)
                    </div>
                    <div style="font-size: 0.88rem; color: var(--text-primary); margin-bottom: 6px;">
                        🚀 <strong>Model được sử dụng:</strong> <span class="badge" style="background: rgba(16, 185, 129, 0.2); color: #047857; font-size: 0.85rem; padding: 3px 8px; font-weight: 700;">${escapeHtml(selectedModel)}</span>
                    </div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 12px;">
                        📋 <strong>Mô hình:</strong> <code>${escapeHtml(supportedList)}</code>
                    </div>
                    <div style="background: var(--bg-card); border: 1px solid var(--glass-border); border-radius: 8px; padding: 12px; font-size: 0.85rem; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
                        <div style="color: #0284c7; font-weight: 700; margin-bottom: 4px;">🧪 Kết quả thẩm định thử nghiệm:</div>
                        <div style="color: var(--text-primary); margin-bottom: 3px;">- Ngành nghề: <strong>${escapeHtml(resultData.businessType || 'F&B - Trà sữa')}</strong> (Điểm: <strong style="color: #059669;">${resultData.score || 95}/100</strong>)</div>
                        <div style="color: var(--text-primary); margin-bottom: 3px;">- Tóm tắt: ${escapeHtml(resultData.summary || 'Khai trương quán mới')}</div>
                        ${resultData.salesPitch ? `<div style="color: #7c3aed; margin-top: 4px; font-weight: 600;">- Gợi ý mở lời (Sales Pitch): <em>"${escapeHtml(resultData.salesPitch)}"</em></div>` : ''}
                    </div>
                </div>`;
            }
        } else {
            throw new Error(res.error || 'Lỗi kiểm tra AI');
        }
    } catch (err) {
        const providerName = provider === 'groq' ? 'Groq Cloud' : (provider === 'gemini' ? 'Google Gemini' : provider.toUpperCase());
        showToast('❌ ' + (err.message || `Lỗi kết nối ${providerName} API`), 'error');
        if (statusText) statusText.innerHTML = `<span style="color: #dc2626; font-weight: 700;">❌ Thất bại: Không thể kết nối</span>`;
        if (resultBox) {
            const helpLink = provider === 'groq'
                ? '<a href="https://console.groq.com/keys" target="_blank" style="color: #2563eb; text-decoration: underline; font-weight: 700;">Groq Console (console.groq.com/keys)</a>'
                : '<a href="https://aistudio.google.com/app/apikey" target="_blank" style="color: #2563eb; text-decoration: underline; font-weight: 700;">Google AI Studio (aistudio.google.com)</a>';
            resultBox.innerHTML = `
            <div class="ai-result-error-card">
                <div class="ai-result-header" style="color: #dc2626; font-weight: 700;">
                    <span>⚠️</span> THÔNG BÁO TỪ ${providerName.toUpperCase()} API
                </div>
                <div class="ai-field-item" style="border-left: 3px solid #dc2626; color: #991b1b; margin-bottom: 10px; font-size: 0.9rem; font-weight: 600;">
                    ${escapeHtml(err.message)}
                </div>
                <div style="font-size: 0.85rem; color: var(--text-primary); line-height: 1.5;">
                    👉 <strong>Hướng dẫn khắc phục:</strong> Hãy lấy API Key mới và miễn phí tại ${helpLink} rồi dán lại vào ô bên trên nhé!
                </div>
            </div>`;
        }
    } finally {
        if (btnTest) setLoading(btnTest, false);
    }
}

/**
 * Global Helpers
 */
async function api(method, url, data = null) {
    const options = {
        method,
        headers: { 'Content-Type': 'application/json' }
    };
    if (data) options.body = JSON.stringify(data);

    const res = await fetch(url, options);
    const json = await res.json();

    if (!res.ok) {
        throw new Error(json.error || json.message || 'API request failed');
    }
    return json;
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let iconSvg = '';
    if (type === 'success') iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
    else if (type === 'error') iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
    else if (type === 'warning') iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
    else iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';

    toast.innerHTML = `${iconSvg} <span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function setLoading(buttonEl, loading) {
    if (!buttonEl) return;
    if (loading) {
        buttonEl.dataset.originalHtml = buttonEl.innerHTML;
        buttonEl.disabled = true;
        buttonEl.innerHTML = '<span class="loading-spinner"></span> Đang xử lý...';
    } else {
        buttonEl.disabled = false;
        if (buttonEl.dataset.originalHtml) {
            buttonEl.innerHTML = buttonEl.dataset.originalHtml;
        }
    }
}

function escapeHtml(str) {
    if (typeof str !== 'string') return str;
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
