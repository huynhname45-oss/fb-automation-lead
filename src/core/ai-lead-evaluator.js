import logger from './logger.js';
import configManager from './config-manager.js';
import leadFilter, { checkForeignLead, checkCongratulatoryLead, checkEventGiftServiceLead, checkIndustrialManufacturingLead, checkMediaEsportsGossipLead, isLandmarkContext } from './lead-filter.js';
import { cleanInvisibleCharacters } from './phone-validator.js';

/**
 * AI Lead Qualification & Scoring Engine for POS/SaaS Sales Prospecting
 * Evaluates candidate Facebook posts to identify SMB business leads for POS software (Sapo, KiotViet, etc.)
 */
export class AILeadEvaluator {
  constructor() {}

  /**
   * Evaluates a post using AI (with graceful fallback to Advanced Local NLP Rule-Engine)
   * Supports both Object signature { authorName, content, phones } and positional arguments.
   */
  async evaluateLeadWithAI(postOrAuthor = {}, ...rest) {
    let post = {};
    let overrideConfig = {};

    if (typeof postOrAuthor === 'string') {
      // Positional args: (authorName, content, phones, minScore, config)
      const [content = '', phones = [], minScore = null, cfg = {}] = rest;
      overrideConfig = { 
        ...(typeof minScore === 'number' ? { minLeadScore: minScore, acceptedLeadScore: minScore } : {}), 
        ...(cfg || {}) 
      };
      post = { authorName: postOrAuthor, content, phones };
    } else {
      post = postOrAuthor || {};
      overrideConfig = rest[0] || {};
    }

    const config = { ...configManager.get(), ...overrideConfig };
    const authorName = cleanInvisibleCharacters(post.authorName || '').trim();
    const content = cleanInvisibleCharacters(post.content || '').trim();
    const phones = Array.isArray(post.phones) ? post.phones : [];
    const minScore = typeof config.acceptedLeadScore === 'number'
      ? config.acceptedLeadScore
      : (config.minLeadScore ?? 60);

    // First: Run Deterministic Negative Rule Filter (Fast elimination of obvious enterprise/competitor/spam)
    const ruleEval = leadFilter.evaluateLead({ authorName, content, phones }, config);
    if (!ruleEval.qualified) {
      return {
        isQualified: ruleEval.leadQuality === 'review', // Allow 'review' to proceed for phone extraction
        score: ruleEval.leadQuality === 'review' ? 50 : 10,
        summary: `Bài viết: ${ruleEval.reason}`,
        businessType: 'Cần xem lại',
        intent: 'Cần kiểm tra',
        reason: ruleEval.reason,
        decision: ruleEval.leadQuality === 'rejected' ? 'REJECTED' : 'REVIEW',
        leadQuality: ruleEval.leadQuality,
        qualityBadge: ruleEval.qualityBadge || 'Cần xem lại',
        provider: 'rule_engine'
      };
    }

    // Try AI Evaluation if enabled
    if (config.aiEnabled !== false) {
      try {
        const aiResult = await this._callAIProvider(authorName, content, phones, config);
        if (aiResult && typeof aiResult.score === 'number') {
          const negativeList = [
            'cơ quan nhà nước', 'công an', 'quân đội', 'chính quyền', 'hành chính công',
            'đa cấp', 'cờ bạc', 'tài xỉu', 'lừa đảo', 'việc làm online'
          ];
          if (config.excludeRealEstate) negativeList.push('bất động sản', 'nhà đất', 'phòng trọ', 'căn hộ', 'chung cư');
          if (config.excludeHotels) negativeList.push('khách sạn', 'resort', 'homestay', 'nhà nghỉ', 'du lịch');
          if (config.excludeBeautySpa) negativeList.push('spa', 'thẩm mỹ', 'massage', 'salon tóc', 'tiệm nail', 'barber');
          if (config.excludeEventGifts !== false) negativeList.push('hoa khai trương', 'hoa sáp', 'hoa tiền', 'kệ hoa', 'lẵng hoa', 'giỏ trái cây', 'giỏ quà', 'mâm quả', 'decor gia tiên', 'múa lân', 'backdrop');
          if (config.excludeEnterpriseChains !== false) negativeList.push('chuỗi lớn');

          const negRegex = new RegExp(`\\b(?:${negativeList.join('|')})\\b`, 'i');
          const combinedAiCheck = `${aiResult.businessType || ''} ${aiResult.intent || ''} ${aiResult.reason || ''}`;
          const isNegative = negRegex.test(combinedAiCheck);
          
          const acceptedThreshold = (typeof minScore === 'number' && minScore >= 0 && minScore <= 100)
            ? minScore
            : (config.acceptedLeadScore ?? config.minLeadScore ?? 60);
          const reviewThreshold = config.reviewLeadScore ?? 35;

          if (isNegative || aiResult.score < reviewThreshold) {
            aiResult.isQualified = false;
            aiResult.decision = 'REJECTED';
            aiResult.leadQuality = 'rejected';
            aiResult.qualityBadge = 'Điểm thấp';
            aiResult.score = isNegative ? Math.min(aiResult.score, 15) : aiResult.score;
          } else if (aiResult.score < acceptedThreshold) {
            aiResult.isQualified = false;
            aiResult.decision = 'REVIEW';
            aiResult.leadQuality = 'review';
            aiResult.qualityBadge = 'Cần xem lại';
          } else {
            aiResult.isQualified = true;
            aiResult.decision = 'ACCEPTED';
            aiResult.leadQuality = 'high';
            aiResult.qualityBadge = 'Tiềm năng cao';
          }
          return aiResult;
        }
      } catch (err) {
        logger.warn({ err: err.message }, 'AI call failed');
        // SEARCH-P0-012: Unknown/error must NOT fail-open into ACCEPTED. Return REVIEW with AI_UNAVAILABLE.
        return {
          isQualified: false,
          decision: 'REVIEW',
          score: 50,
          summary: `Chưa thẩm định AI: Lỗi kết nối (${err.message})`,
          businessType: 'Chưa xác định',
          intent: 'Cần kiểm tra',
          reason: `Lỗi khi gọi AI (${err.message}). Cần kiểm tra thủ công.`,
          provider: config.aiProvider || 'unknown',
          errorCode: 'AI_UNAVAILABLE',
          error: err.message
        };
      }
    }

    // Fallback when AI is explicitly disabled: Local NLP Heuristic Evaluator
    const localResult = this._localNLPEvaluate(authorName, content, phones, minScore);
    const reviewThreshold = config.reviewLeadScore ?? 45;
    localResult.decision = localResult.isQualified
      ? 'ACCEPTED'
      : (localResult.score >= reviewThreshold ? 'REVIEW' : 'REJECTED');
    return localResult;
  }

  /**
   * Calls the configured AI Provider (Gemini / OpenAI / DeepSeek / Free Hybrid)
   * SEARCH-P0-008: Strictly respects config.aiProvider without unconditional Gemini override.
   */
  async _callAIProvider(authorName, content, phones, config = {}) {
    const provider = config.aiProvider || 'gemini';
    const geminiKey = (config.geminiApiKey || '').trim();
    const apiKey = (config.aiApiKey || '').trim();

    const contextInstruction = (config.aiPromptContext && config.aiPromptContext.trim())
      ? config.aiPromptContext.trim()
      : `Bạn là chuyên gia thẩm định khách hàng tiềm năng cho phần mềm Quản lý Bán hàng (POS) như Sapo, KiotViet, Haravan, MISA.
Mục tiêu của bạn là phân tích bài viết Facebook để xác định xem người đăng có phải là CHỦ CỬA HÀNG / QUÁN ĐỘC LẬP (SMB) đang chuẩn bị khai trương hoặc đang kinh doanh cần phần mềm bán hàng hay không.

QUY TẮC PHÂN LOẠI & CHẤM ĐIỂM (Score từ 0 đến 100):
1. ĐIỂM CAO (80 - 100 điểm) - KHÁCH MỤC TIÊU HỢP LỆ (F&B / BÁN LẺ / BIDA / KARAOKE):
   - Các quán F&B: quán cafe, trà sữa, quán ăn, quán cơm, bún, phở, lẩu nướng, quán nhậu, tiệm bánh, ăn vặt, sinh tố, chè...
   - Các cửa hàng bán lẻ độc lập: shop thời trang, mỹ phẩm, tạp hóa, siêu thị mini, mẹ & bé, pet shop, phụ kiện, đồ gia dụng...
   - DỊCH VỤ DUY NHẤT ĐƯỢC CHẤP NHẬN: CLB BIDA (Billiards / Bi-a) và Quán KARAOKE (Cần phần mềm tính tiền giờ chơi theo bàn/phòng và order đồ uống).
   - THÔNG BÁO KHAI TRƯƠNG, SẮP MỞ CỬA, MỞ CHI NHÁNH MỚI, ĐANG KINH DOANH (Cần máy in bill, phần mềm bán hàng, quản lý bàn/kho/giờ).

2. ĐIỂM 0 (0 - 15 điểm) - BẮT BUỘC LOẠI BỎ (isQualified = false):
    - KHÁCH HÀNG / BÀI VIẾT Ở NƯỚC NGOÀI (Thái Lan, Bangkok, Nhật, Hàn, Đài Loan, Mỹ, Úc, Canada... các bài viết tin tức xã hội, an sinh, người vô gia cư, chính sách nước ngoài, xuất khẩu hàng hóa ra nước ngoài).
    - NHÀ MÁY, XÍ NGHIỆP, KHU CÔNG NGHIỆP (KCN), CỤM CÔNG NGHIỆP, KHU CHẾ XUẤT, CÔNG TY SẢN XUẤT, XƯỞNG MAY, GIA CÔNG, XUẤT KHẨU HÀNG HÓA.
    - TUYỂN DỤNG CÔNG NHÂN, LAO ĐỘNG PHỔ THÔNG, THỢ MAY, CÔNG NHÂN SẢN XUẤT, THỜI VỤ.
    - KHAI TRƯƠNG TÒA NHÀ, SA BÀN, DỰ ÁN BẤT ĐỘNG SẢN, CAO ỐC, ĐẠI ĐÔ THỊ, VINHOMES, NOVALAND, MASTERISE, SUN GROUP, VĂN PHÒNG CHO THUÊ.
   - TẤT CẢ CÁC NGÀNH DỊCH VỤ CÒN LẠI (TRỪ BIDA VÀ KARAOKE):
     + Dịch vụ làm đẹp: Spa, Thẩm mỹ viện, Tiệm Nail, Triệt lông, Massage, Gội đầu dưỡng sinh, Cắt tóc, Salon tóc, Barbershop.
     + Dịch vụ kỹ thuật & sửa chữa: Gara ô tô, Sửa xe máy, Rửa xe, Chăm sóc xe, Sửa điện thoại, Sửa điện lạnh, Lắp camera, Thi công nội thất, Biển quảng cáo.
     + Dịch vụ tiện ích & vệ sinh: Giặt là, Giặt ủi, Giặt sấy, Vệ sinh công nghiệp, Dọn nhà.
     + Dịch vụ lưu trú: Khách sạn, Resort, Homestay, Nhà nghỉ, Motel.
     + Dịch vụ giao thông: Nhà xe, Xe khách, Tuyến xe, Tàu hỏa, Đường sắt, Du lịch, Tour, Vé máy bay.
     + Dịch vụ tài chính & pháp lý: Cầm đồ, Vay vốn, Công chứng, Luật sư.
     + Dịch vụ y tế & thú y: Phòng khám, Nha khoa, Nhà thuốc, Dịch vụ sinh đẻ, Gói thai sản, Phòng khám thú y, Spa thú cưng.
     + Dịch vụ giáo dục: Trường học, Lễ khai giảng, Khai trường năm học, Trung tâm tiếng Anh, Luyện thi, Phòng Gym, Yoga.
     + Dịch vụ sự kiện & quà tặng: Giỏ trái cây, Giỏ hoa quả, Giỏ quà biếu, Hoa khai trương, Kệ hoa, Decor tiệc cưới/gia tiên, In thiệp mời, Múa lân.
    - FANPAGE GIẢI TRÍ, ESPORTS, GAME, MEME, SHOWBIZ, TIN TỨC (Sở Thú Nhà T1, T1, Faker, Doran, Pyosik, Keria, LCK, Beatvn, Kênh 14, Hóng Hớt, chia sẻ tin tuyển thủ/idol/nghệ sĩ).
    - Bài viết của KHÁCH MỜI / BẠN BÈ / HỌC TRÒ / NGƯỜI THÂN gửi cây, gửi hoa, gửi quà chúc mừng khai trương (không phải bài viết từ chủ quán/chủ shop).
    - Bài viết rác, ảnh gia đình, meme, đời sống cá nhân không kinh doanh.`;

    const systemPrompt = `${contextInstruction}

Dữ liệu đầu vào:
- Tác giả: "${authorName}"
- Nội dung bài viết: "${content.substring(0, 600)}"
- Số điện thoại phát hiện: "${phones.join(', ') || 'Chưa có'}"

Yêu cầu định dạng đầu ra: BẮT BUỘC chỉ trả về duy nhất 1 chuỗi JSON hợp lệ theo cấu trúc sau (không thêm bất kỳ chữ nào ngoài JSON):
{
  "score": <số từ 0 đến 100>,
  "summary": "<TÓM TẮT NGẮN GỌN: Nêu rõ mô hình kinh doanh, tên quán/shop và sản phẩm kinh doanh cụ thể từ bài viết>",
  "location": "<Tên Tỉnh/Thành phố chuẩn phát hiện từ bài viết hoặc tên tác giả, ví dụ: Hà Nội, TP. Hồ Chí Minh, Đồng Nai... hoặc — nếu không rõ>",
  "businessType": "<Tên ngành nghề ngắn gọn, ví dụ: F&B - Cafe / Trà sữa, F&B - Quán ăn, Bán lẻ - Thời trang, Không phù hợp>",
  "intent": "<Mục đích bài đăng: Khai trương, Mở chi nhánh, Đang bán hàng, Tuyển dụng...>",
  "salesPitch": "<1 câu gợi ý ngắn gọn mở lời tiếp cận cho nhân viên Sale bán phần mềm POS>",
  "recommendedFeatures": "<Tính năng phần mềm POS nổi bật nên tư vấn>",
  "reason": "<1 câu ngắn gọn giải thích lý do đánh giá tiềm năng hoặc lý do loại bỏ>"
}`;

    // SEARCH-P0-008: Route based on configured provider
    if (provider === 'gemini') {
      const key = geminiKey || apiKey;
      if (!key) throw new Error('Chưa cấu hình Gemini API Key');
      try {
        return await this._callGeminiAPI(key, systemPrompt, config.geminiModel);
      } catch (geminiErr) {
        const isRateLimit = geminiErr.message && (
          geminiErr.message.includes('429') ||
          geminiErr.message.includes('Rate Limit') ||
          geminiErr.message.includes('RESOURCE_EXHAUSTED') ||
          geminiErr.message.includes('quota')
        );
        if (isRateLimit && config.groqApiKey) {
          logger.warn({ err: geminiErr.message }, '⚡ Gemini bị giới hạn tần suất (429 Rate Limit), tự động chuyển sang Groq LPU để không làm gián đoạn bóc tách lead...');
          return await this._callGroqAPI(config.groqApiKey, systemPrompt, config.groqModel || 'qwen/qwen3.8-27b');
        }
        throw geminiErr;
      }
    } else if (provider === 'openai') {
      const key = apiKey || geminiKey;
      if (!key) throw new Error('Chưa cấu hình OpenAI API Key');
      return await this._callOpenAIAPI(key, systemPrompt);
    } else if (provider === 'deepseek') {
      const key = apiKey || geminiKey;
      if (!key) throw new Error('Chưa cấu hình DeepSeek API Key');
      return await this._callDeepSeekAPI(key, systemPrompt);
    } else if (provider === 'groq') {
      const key = (config.groqApiKey || apiKey || geminiKey || '').trim();
      if (!key) throw new Error('Chưa cấu hình Groq API Key (Đăng ký miễn phí tại console.groq.com)');
      return await this._callGroqAPI(key, systemPrompt, config.groqModel);
    } else if (provider === 'free_hybrid') {
      return await this._callFreeAIPipeline(systemPrompt);
    } else {
      if (config.allowProviderFallback) {
        if (config.groqApiKey) return await this._callGroqAPI(config.groqApiKey, systemPrompt, config.groqModel);
        if (geminiKey) return await this._callGeminiAPI(geminiKey, systemPrompt);
        if (apiKey) return await this._callOpenAIAPI(apiKey, systemPrompt);
        return await this._callFreeAIPipeline(systemPrompt);
      }
      throw new Error(`AI Provider không hợp lệ: "${provider}"`);
    }
  }

  /**
   * Evaluates a single test post with a custom API key and custom prompt (used by UI Test Button)
   */
  async evaluateWithCustomPrompt(testPost, apiKey, provider = 'gemini', customContext = '') {
    const contextInstruction = (customContext && customContext.trim())
      ? customContext.trim()
      : `Bạn là chuyên gia thẩm định khách hàng tiềm năng cho phần mềm Quản lý Bán hàng (POS) như Sapo, KiotViet, Haravan, MISA.
Mục tiêu của bạn là phân tích bài viết Facebook để xác định xem người đăng có phải là CHỦ CỬA HÀNG / QUÁN ĐỘC LẬP (SMB) đang chuẩn bị khai trương hoặc đang kinh doanh cần phần mềm bán hàng hay không.`;

    const systemPrompt = `${contextInstruction}

Dữ liệu đầu vào:
- Tác giả: "${testPost.authorName || 'Chủ quán'}"
- Nội dung bài viết: "${(testPost.content || '').substring(0, 600)}"
- Số điện thoại phát hiện: "${(testPost.phones || []).join(', ') || 'Chưa có'}"

Yêu cầu định dạng đầu ra: BẮT BUỘC chỉ trả về duy nhất 1 chuỗi JSON hợp lệ theo cấu trúc sau (không thêm bất kỳ chữ nào ngoài JSON):
{
  "score": <số từ 0 đến 100>,
  "summary": "<TÓM TẮT NGẮN GỌN: Chỉ nêu ngành hàng và sản phẩm/dịch vụ kinh doanh (bán gì). Ví dụ: 'Quán cơm chay tự chọn', 'Quán trà sách & đồ uống', 'Tiệm bánh tráng & đồ ăn vặt'>",
  "location": "<Tên Tỉnh/Thành phố hoặc —>",
  "businessType": "<Tên ngành nghề ngắn gọn>",
  "intent": "<Mục đích chính>",
  "salesPitch": "<1 câu gợi ý mở lời tiếp cận cho Sale POS>",
  "recommendedFeatures": "<Tính năng POS nên chào>",
  "reason": "<1 câu ngắn gọn giải thích>"
}`;

    let result = null;
    if (provider === 'gemini') {
      const discovery = await this.discoverAndVerifyGeminiModels(apiKey, systemPrompt);
      result = discovery.result;
      if (result) {
        result.selectedModel = discovery.selectedModel;
        result.supportedModels = discovery.supportedModels;
        result.latencyMs = discovery.latencyMs;
      }
    } else if (provider === 'openai') {
      result = await this._callOpenAIAPI(apiKey, systemPrompt);
    } else if (provider === 'deepseek') {
      result = await this._callDeepSeekAPI(apiKey, systemPrompt);
    } else if (provider === 'groq') {
      const discovery = await this.discoverAndVerifyGroqModels(apiKey, systemPrompt);
      result = discovery.result;
      if (result) {
        result.selectedModel = discovery.selectedModel;
        result.supportedModels = discovery.supportedModels;
        result.latencyMs = discovery.latencyMs;
      }
    } else {
      result = await this._callFreeAIPipeline(systemPrompt);
    }

    if (result && typeof result.score === 'number') {
      result.isQualified = result.score >= 50;
    }
    return result;
  }

  /**
   * Helper function to score and rank Gemini models by version and performance
   */
  _scoreGeminiModel(name = '') {
    const n = name.toLowerCase();

    // 1. Strictly EXCLUDE non-text / media generation / robotics models
    if (/(?:image|tts|transcribe|clip|robotics|audio|computer-use|banana|lyria|gemma)/i.test(n)) {
      return -99999;
    }

    // 2. Parse major and minor version numbers dynamically (e.g. 3.8, 3.7, 3.6, 3.5, 2.5)
    const verMatch = n.match(/(?:gemini-)?(\d+)(?:\.(\d+))?/i);
    let versionScore = 0;
    if (verMatch) {
      const major = parseInt(verMatch[1], 10) || 1;
      const minor = parseInt(verMatch[2], 10) || 0;
      versionScore = major * 1000 + minor * 100;
    }

    // Explicit boost for speed-optimized models
    if (n.includes('3.5-flash-lite')) return 10000; // Ultra fast (~1.3s), identical 95 accuracy
    if (n.includes('3.6-flash')) return 9500;
    if (n.includes('3.7-flash')) return 9000;
    if (n.includes('3.8-flash')) return 8500;
    if (n.includes('3.5-flash')) return 8000;
    if (n.includes('3.1-flash-lite')) return 7500;
    if (n.includes('2.5-flash')) return 7000;

    let typeScore = 0;
    if (n.includes('flash') && !n.includes('lite')) typeScore += 60;
    else if (n.includes('pro')) typeScore += 40;
    else if (n.includes('flash-lite') || n.includes('lite')) typeScore += 50;

    if (n.includes('exp')) typeScore -= 10;
    if (n.includes('preview')) typeScore -= 5;
    if (n.includes('customtools')) typeScore -= 50;

    return versionScore + typeScore;
  }

  /**
   * Automatically discovers available Gemini models, ranks them, and verifies live execution
   */
  async discoverAndVerifyGeminiModels(apiKey, customPrompt = null) {
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error('Vui lòng cung cấp Google Gemini API Key!');
    }
    const cleanKey = apiKey.trim();

    // 1. Kiểm tra kết nối và lấy danh sách model được hỗ trợ cho API Key này
    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${cleanKey}`;
    let listRes;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      listRes = await fetch(listUrl, {
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }
      });
      clearTimeout(timer);
    } catch (netErr) {
      throw new Error(`Không thể kết nối đến máy chủ Google Gemini: ${netErr.message}`);
    }

    if (!listRes.ok) {
      const errJson = await listRes.json().catch(() => ({}));
      const errCode = listRes.status;
      const errMsg = errJson.error?.message || `Lỗi HTTP ${errCode}`;
      if (errCode === 400 && (errMsg.includes('API key not valid') || errMsg.includes('API_KEY_INVALID'))) {
        throw new Error('Google Gemini API Key không hợp lệ! Vui lòng kiểm tra lại API key từ Google AI Studio.');
      }
      if (errCode === 403) {
        throw new Error(`API Key bị từ chối truy cập (HTTP 403): ${errMsg}`);
      }
      throw new Error(`Google Gemini API trả về lỗi ${errCode}: ${errMsg}`);
    }

    const data = await listRes.json();
    const allModels = Array.isArray(data.models) ? data.models : [];

    // 2. Lọc các model hỗ trợ generateContent và loại trừ media/image/tts
    const contentModels = allModels
      .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map(m => m.name.replace(/^models\//, ''))
      .filter(name => name.startsWith('gemini') && this._scoreGeminiModel(name) > 0);

    if (contentModels.length === 0) {
      throw new Error('API Key hợp lệ nhưng tài khoản không có model Gemini nào hỗ trợ generateContent!');
    }

    // 3. Xếp hạng và chọn model MỚI NHẤT & TỐI ƯU NHẤT (Ưu tiên Gemini 3.6 Flash)
    const rankedModels = [...contentModels].sort((a, b) => this._scoreGeminiModel(b) - this._scoreGeminiModel(a));

    // 4. Gửi bài test thẩm định thực tế với model cao nhất
    let verifiedModel = null;
    let lastTestError = null;
    let testLatencyMs = 0;
    let testResult = null;

    const testPrompt = customPrompt || `Bạn là chuyên gia thẩm định khách hàng tiềm năng cho phần mềm POS.
Dữ liệu đầu vào:
- Tác giả: "Trà Sữa Cây Si"
- Nội dung bài viết: "TƯNG BỪNG KHAI TRƯƠNG chi nhánh 2 tại 45 Nguyễn Huệ vào ngày mai! Giảm 50% menu. Kính mời quý khách!"
- Số điện thoại phát hiện: "0912345678"

Yêu cầu đầu ra: Chỉ trả về JSON duy nhất:
{
  "score": 95,
  "summary": "Khai trương quán trà sữa chi nhánh 2",
  "location": "TP. Hồ Chí Minh",
  "businessType": "F&B - Trà sữa",
  "intent": "Khai trương",
  "salesPitch": "Chào anh/chị, em thấy quán mình chuẩn bị khai trương, bên em có giải pháp máy in bill và order bàn...",
  "recommendedFeatures": "In bill & Order QR",
  "reason": "Quán F&B mở chi nhánh mới, nhu cầu cao về phần mềm bán hàng"
}`;

    for (const candidateModel of rankedModels.slice(0, 8)) {
      const startTime = Date.now();
      try {
        const testUrl = `https://generativelanguage.googleapis.com/v1beta/models/${candidateModel}:generateContent?key=${cleanKey}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);

        const testRes = await fetch(testUrl, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: testPrompt }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
          })
        });
        clearTimeout(timer);

        if (testRes.ok) {
          const testData = await testRes.json();
          const replyText = testData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (replyText) {
            testLatencyMs = Date.now() - startTime;
            verifiedModel = candidateModel;
            testResult = this._parseJSONResponse(replyText, verifiedModel);
            break;
          }
        } else {
          const errData = await testRes.json().catch(() => ({}));
          lastTestError = new Error(errData.error?.message || `HTTP ${testRes.status}`);
          logger.warn(`Model candidate [${candidateModel}] failed test: ${lastTestError.message}. Trying next candidate...`);
        }
      } catch (err) {
        lastTestError = err;
        logger.warn(`Model candidate [${candidateModel}] error: ${err.message}. Trying next candidate...`);
      }
    }

    if (!verifiedModel) {
      throw new Error(`Không thể kích hoạt bất kỳ model Gemini nào: ${lastTestError?.message || 'Lỗi không xác định'}`);
    }

    // Tự động lưu model đã được kiểm tra thực tế vào cấu hình hệ thống
    await configManager.update({
      geminiApiKey: cleanKey,
      geminiModel: verifiedModel
    }).catch(() => {});

    return {
      success: true,
      selectedModel: verifiedModel,
      supportedModels: rankedModels,
      latencyMs: testLatencyMs,
      result: testResult,
      message: `Kết nối thành công! Đã tự động chọn model mới nhất: ${verifiedModel} (${testLatencyMs}ms)`
    };
  }

  /**
   * Google Gemini API Integration (Dynamic Model Selection & Fallbacks)
   */
  async _callGeminiAPI(apiKey, prompt, preferredModel = null) {
    const config = configManager.get();
    const activeModel = preferredModel || config.geminiModel;

    const keys = (apiKey || '').split(/[,;\n\r]+/).map(k => k.trim()).filter(Boolean);
    if (keys.length === 0) throw new Error('Vui lòng cung cấp Google Gemini API Key');

    if (globalThis._geminiKeyIdx === undefined) globalThis._geminiKeyIdx = 0;

    const modelsToTry = [];
    if (activeModel) modelsToTry.push(activeModel);

    const standardModels = [
      'gemini-3.6-flash',
      'gemini-3.7-flash',
      'gemini-3.5-flash',
      'gemini-2.5-flash'
    ];
    for (const m of standardModels) {
      if (!modelsToTry.includes(m)) modelsToTry.push(m);
    }

    let lastError = null;

    // Throttle between AI calls to avoid hitting Gemini 15 RPM rate limits
    const now = Date.now();
    if (globalThis._lastGeminiCallTs && (now - globalThis._lastGeminiCallTs) < 350) {
      await new Promise(r => setTimeout(r, 350 - (now - globalThis._lastGeminiCallTs)));
    }
    globalThis._lastGeminiCallTs = Date.now();

    for (let k = 0; k < keys.length; k++) {
      const currentKey = keys[(globalThis._geminiKeyIdx + k) % keys.length];

      for (const model of modelsToTry) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${currentKey}`;

        for (let attempt = 1; attempt <= 2; attempt++) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 14000);

          try {
            const res = await fetch(url, {
              method: 'POST',
              signal: controller.signal,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                  responseMimeType: 'application/json',
                  temperature: 0.1,
                  maxOutputTokens: 450
                }
              })
            });
            clearTimeout(timer);

            if (res.ok) {
              globalThis._geminiKeyIdx = (globalThis._geminiKeyIdx + k) % keys.length;
              const data = await res.json();
              const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
              if (text) {
                return this._parseJSONResponse(text, model);
              }
            } else {
              const errJson = await res.json().catch(() => ({}));
              const errMessage = errJson.error?.message || `Google Gemini API (${model}) trả về lỗi HTTP ${res.status}`;
              
              if (res.status === 429) {
                lastError = new Error(`Google Gemini API chạm giới hạn tần suất (Rate Limit 429): ${errMessage}`);
                if (keys.length > 1) {
                  logger.warn(`⚠️ Gemini Key ${k + 1}/${keys.length} bị chạm 429, tự động chuyển sang Gemini Key tiếp theo...`);
                  break;
                }
                if (attempt < 2) {
                  logger.warn(`⚠️ Gemini API bị chạm Rate Limit 429. Đang đợi 2.5s rồi thử lại lần ${attempt + 1}...`);
                  await new Promise(r => setTimeout(r, 2500));
                  continue;
                }
                throw lastError;
              }

              lastError = new Error(errMessage);
              if (res.status === 404 || errJson.error?.status === 'NOT_FOUND') {
                break; // Model not available, try next model
              }
              if (res.status === 400 || res.status === 403) {
                throw lastError;
              }
            }
          } catch (err) {
            clearTimeout(timer);
            lastError = err;
            if (err.name === 'AbortError') {
              lastError = new Error(`Quá thời gian chờ phản hồi từ Google Gemini (${model})`);
            }
            if (err.message && (err.message.includes('API_KEY_INVALID') || err.message.includes('API key not valid') || err.message.includes('PERMISSION_DENIED') || err.message.includes('Rate Limit 429'))) {
              if (keys.length > 1 && err.message.includes('Rate Limit 429')) break;
              throw lastError;
            }
          }
        }
      }
    }

    throw lastError || new Error('Không thể kết nối tới mô hình Google Gemini. Vui lòng kiểm tra lại API Key.');
  }

  /**
   * OpenAI API Integration
   */
  async _callOpenAIAPI(apiKey, prompt) {
    const url = 'https://api.openai.com/v1/chat/completions';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0.1
        })
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`OpenAI API HTTP ${res.status}`);
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      return this._parseJSONResponse(text, 'openai');
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * DeepSeek API Integration
   */
  async _callDeepSeekAPI(apiKey, prompt) {
    const url = 'https://api.deepseek.com/v1/chat/completions';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1
        })
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`DeepSeek API HTTP ${res.status}`);
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      return this._parseJSONResponse(text, 'deepseek');
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Helper function to score and rank Groq models by capability and speed
   */
  _scoreGroqModel(name = '') {
    const n = name.toLowerCase();
    if (/(?:whisper|guard|safeguard|orpheus|audio|tts|embed)/i.test(n)) return -99999;
    if (n === 'groq/compound') return -99999; // known request_too_large error

    // Top tier for Vietnamese: Qwen 3.8 27B (fluent Vietnamese + vision capable + ultra fast 300ms)
    if (n.includes('qwen3.8-27b') || n.includes('qwen/qwen3.8-27b')) return 10000;
    // Qwen 3.6 27B
    if (n.includes('qwen3.6-27b') || n.includes('qwen/qwen3.6-27b')) return 9500;
    // GPT-OSS 120B (120B params - strong open model)
    if (n.includes('gpt-oss-120b')) return 9000;
    // GPT-OSS 20B
    if (n.includes('gpt-oss-20b')) return 8500;
    // Compound Mini
    if (n.includes('compound-mini')) return 8000;
    // Llama 3.3 / 3.1
    if (n.includes('llama-3.3-70b')) return 7500;
    if (n.includes('llama-3.1-70b')) return 7000;
    if (n.includes('llama-3.2-11b')) return 6500;
    if (n.includes('llama-3.1-8b') || n.includes('llama-3.2-3b')) return 6000;
    if (n.includes('allam')) return 4000;

    return 1000;
  }

  /**
   * Automatically discovers available Groq models, ranks them, and verifies live execution
   */
  async discoverAndVerifyGroqModels(apiKey, customPrompt = null) {
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error('Vui lòng cung cấp Groq API Key!');
    }
    const cleanKey = apiKey.trim();

    // 1. Lấy danh sách model khả dụng từ Groq
    let listRes;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      listRes = await fetch('https://api.groq.com/openai/v1/models', {
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${cleanKey}`,
          'Content-Type': 'application/json'
        }
      });
      clearTimeout(timer);
    } catch (netErr) {
      throw new Error(`Không thể kết nối đến máy chủ Groq Cloud: ${netErr.message}`);
    }

    if (!listRes.ok) {
      const errJson = await listRes.json().catch(() => ({}));
      const errCode = listRes.status;
      const errMsg = errJson.error?.message || `Lỗi HTTP ${errCode}`;
      if (errCode === 401 || errMsg.includes('Invalid API Key') || errMsg.includes('invalid_api_key')) {
        throw new Error('Groq API Key không hợp lệ! Vui lòng kiểm tra lại API key từ https://console.groq.com/keys.');
      }
      throw new Error(`Groq API trả về lỗi ${errCode}: ${errMsg}`);
    }

    const data = await listRes.json();
    const allModels = Array.isArray(data.data) ? data.data.map(m => m.id) : [];

    const contentModels = allModels.filter(name => this._scoreGroqModel(name) > 0);
    if (contentModels.length === 0) {
      throw new Error('API Key hợp lệ nhưng không tìm thấy mô hình tương thích trên Groq Cloud!');
    }

    // 2. Sắp xếp thứ tự ưu tiên các model
    const rankedModels = [...contentModels].sort((a, b) => this._scoreGroqModel(b) - this._scoreGroqModel(a));

    const baseContext = (customPrompt && customPrompt.trim())
      ? customPrompt.trim()
      : (configManager.get().aiPromptContext || DEFAULT_AI_PROMPT_CONTEXT);

    const testPrompt = `${baseContext}

Dữ liệu kiểm tra:
- Tác giả: "Trà Sữa Cây Si - Chi Nhánh 2"
- Nội dung: "TƯNG BỪNG KHAI TRƯƠNG chi nhánh 2 tại 45 Nguyễn Huệ vào ngày mai! Giảm 50% toàn bộ menu trà sữa và trà trái cây. Kính mời quý khách ghé trải nghiệm! Hotline: 0912345678"

Yêu cầu định dạng đầu ra: BẮT BUỘC chỉ trả về duy nhất 1 chuỗi JSON hợp lệ (JSON format object) theo cấu trúc sau (không thêm bất kỳ chữ nào ngoài JSON):
{
  "score": 95,
  "summary": "Khai trương quán trà sữa & cà phê chi nhánh 2",
  "location": "TP. Hồ Chí Minh",
  "businessType": "F&B - Trà Sữa & Cà Phê",
  "intent": "Khai trương",
  "salesPitch": "Chúc mừng quán khai trương hồng phát! Bên em hỗ trợ giải pháp bán hàng Sapo in bill nhanh chóng.",
  "recommendedFeatures": "Quản lý bàn, In bill",
  "reason": "Quán mở chi nhánh mới cần máy in hóa đơn và phần mềm POS quản lý bàn"
}`;

    let lastError = null;
    let selectedModel = null;
    let testResult = null;
    let latencyMs = 0;

    // 3. Thử nghiệm model mạnh nhất và tự động fallback
    for (const model of rankedModels) {
      const startTime = Date.now();
      try {
        testResult = await this._callGroqAPI(cleanKey, testPrompt, model);
        latencyMs = Date.now() - startTime;
        selectedModel = model;
        break;
      } catch (err) {
        lastError = err;
        logger.warn({ model, err: err.message }, 'Mô hình Groq thử nghiệm thất bại, đang chuyển sang model tiếp theo...');
      }
    }

    if (!selectedModel || !testResult) {
      throw new Error(`Không thể kích hoạt mô hình Groq nào khả dụng: ${lastError ? lastError.message : 'Lỗi không xác định'}`);
    }

    // 4. Lưu lại cấu hình model tốt nhất
    try {
      configManager.update({
        groqModel: selectedModel,
        groqApiKey: cleanKey,
        aiProvider: 'groq'
      }).catch(() => {});
    } catch {
      // Non-blocking
    }

    return {
      success: true,
      selectedModel,
      supportedModels: rankedModels,
      latencyMs,
      result: testResult,
      message: `Đã kết nối thành công tới Groq Cloud! Model mạnh nhất được chọn: ${selectedModel} (${latencyMs}ms - Siêu Tốc)`
    };
  }

  /**
   * Groq Cloud API Integration (100% Free, Ultra-Fast LPUs, 14,400 RPD, 30 RPM)
   * Tự động fallback model nếu gặp 404 hoặc model bị deprecate
   */
  async _callGroqAPI(apiKey, prompt, customModel = '') {
    const url = 'https://api.groq.com/openai/v1/chat/completions';
    const config = configManager.get();
    
    // Fallback candidates if specified model is 404 or deprecated
    const candidateModels = [
      customModel,
      config.groqModel,
      'qwen/qwen3.8-27b',
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
      'groq/compound-mini',
      'llama-3.3-70b-versatile'
    ].filter(Boolean);

    const modelsToTry = [...new Set(candidateModels)];

    // Ensure prompt explicitly contains the word 'json' as required by Groq API
    let promptContent = prompt;
    if (!promptContent.toLowerCase().includes('json')) {
      promptContent = `${promptContent}\n\nBẮT BUỘC: Hãy trả về kết quả dưới định dạng JSON object duy nhất (JSON format).`;
    }

    let lastErr = null;
    for (const model of modelsToTry) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const res = await fetch(url, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: model,
            messages: [{ role: 'user', content: promptContent }],
            response_format: { type: 'json_object' },
            temperature: 0.1
          })
        });
        clearTimeout(timer);

        if (!res.ok) {
          const errBody = await res.text().catch(() => '');
          if (res.status === 404 || errBody.includes('does not exist') || errBody.includes('model_not_found')) {
            logger.warn({ model, status: res.status }, 'Groq model 404, thử model tiếp theo...');
            lastErr = new Error(`Groq API HTTP ${res.status}: ${errBody.substring(0, 150)}`);
            continue;
          }
          throw new Error(`Groq API HTTP ${res.status}: ${errBody.substring(0, 150)}`);
        }

        const data = await res.json();
        const text = data.choices?.[0]?.message?.content || '';
        return this._parseJSONResponse(text, 'groq');
      } catch (err) {
        lastErr = err;
        if (err.name === 'AbortError') {
          logger.warn({ model }, 'Groq request timed out, thử model tiếp theo...');
          continue;
        }
        if (err.message && (err.message.includes('404') || err.message.includes('does not exist'))) {
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastErr || new Error('Không thể kết nối tới mô hình Groq khả dụng');
  }

  /**
   * Free Zero-Config AI Pipeline
   */
  async _callFreeAIPipeline(prompt) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    try {
      const endpoint = `https://text.pollinations.ai/${encodeURIComponent(prompt + '\n\nChỉ trả về JSON thuần túy!')}?json=true&seed=42`;
      const res = await fetch(endpoint, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });
      clearTimeout(timer);
      if (res.ok) {
        const text = await res.text();
        return this._parseJSONResponse(text, 'free_hybrid');
      }
    } finally {
      clearTimeout(timer);
    }
    return null;
  }

  /**
   * Robust JSON Parser with Sanitization
   */
  _parseJSONResponse(rawText, providerName = 'ai') {
    if (!rawText || typeof rawText !== 'string') return null;

    try {
      // Clean markdown code fence formatting if present
      let clean = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
      const firstBrace = clean.indexOf('{');
      const lastBrace = clean.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        clean = clean.substring(firstBrace, lastBrace + 1);
      }

      const parsed = JSON.parse(clean);
      const score = Math.max(0, Math.min(100, parseInt(parsed.score, 10) || 50));
      return {
        score,
        summary: parsed.summary || parsed.reason || '',
        location: (parsed.location && parsed.location !== '—' && parsed.location !== '-') ? parsed.location.trim() : '—',
        businessType: parsed.businessType || 'Kinh doanh SMB',
        intent: parsed.intent || 'Kinh doanh',
        salesPitch: parsed.salesPitch || '',
        recommendedFeatures: parsed.recommendedFeatures || '',
        reason: parsed.reason || 'Bài viết kinh doanh tiềm năng cho giải pháp POS',
        provider: providerName
      };
    } catch (e) {
      logger.debug({ err: e.message, rawText }, 'Failed to parse AI JSON response');
      return null;
    }
  }

  /**
   * Advanced Local NLP Heuristic Lead Evaluator (Zero-Network Fallback)
   */
  _localNLPEvaluate(authorName, content, phones, minScore = 50) {
    // -1. Foreign Location Check (Highest Priority)
    const foreignCheck = checkForeignLead({ authorName, content, phones });
    if (foreignCheck.isForeign) {
      return {
        isQualified: false,
        score: 0,
        summary: 'Cửa hàng / Quán ở Nước ngoài (Đã loại trừ)',
        businessType: 'Nước ngoài',
        intent: 'Loại trừ',
        salesPitch: '',
        recommendedFeatures: '',
        reason: `Bài viết ở NƯỚC NGOÀI (${foreignCheck.reason}), không thuộc phạm vi triển khai POS tại Việt Nam.`,
        provider: 'local_nlp'
      };
    }

    // -0.5. Guest / Congratulatory Post Check (Highest Priority)
    const congratCheck = checkCongratulatoryLead({ authorName, content, phones });
    if (congratCheck.isCongratulatory) {
      return {
        isQualified: false,
        score: 0,
        summary: 'Khách mời / Bạn bè chúc mừng khai trương (Đã loại trừ)',
        businessType: 'Khách mời chúc mừng',
        intent: 'Loại trừ',
        salesPitch: '',
        recommendedFeatures: '',
        reason: `Bài viết chúc mừng khai trương của khách mời / bạn bè (${congratCheck.reason}), không phải chủ cơ sở kinh doanh mở mới.`,
        provider: 'local_nlp'
      };
    }

    // -0.4. Event Gifts, Fruit Baskets, Florals, Decor & Printing Check (Highest Priority)
    const giftEventCheck = checkEventGiftServiceLead({ authorName, content, phones });
    if (giftEventCheck.isEventGiftService) {
      return {
        isQualified: false,
        score: 0,
        summary: 'Dịch vụ phụ trợ / Giỏ trái cây / Hoa / Decor / In ấn sự kiện (Đã loại trừ)',
        businessType: 'Dịch vụ phụ trợ / Quà tặng',
        intent: 'Loại trừ',
        salesPitch: '',
        recommendedFeatures: '',
        reason: `Dịch vụ phụ trợ sự kiện / Giỏ quà / Hoa / Decor / In ấn (${giftEventCheck.reason}), không phải cửa hàng F&B/Bán lẻ SMB mở mới.`,
        provider: 'local_nlp'
      };
    }

    // -0.3. Industrial Manufacturing, Factory, KCN & Worker Recruitment Check (Highest Priority)
    const industrialCheck = checkIndustrialManufacturingLead({ authorName, content, phones });
    if (industrialCheck.isIndustrial) {
      return {
        isQualified: false,
        score: 0,
        summary: 'Cơ sở sản xuất / Nhà máy / Khu công nghiệp / Lao động phổ thông (Đã loại trừ)',
        businessType: 'Sản xuất công nghiệp / KCN',
        intent: 'Loại trừ',
        salesPitch: '',
        recommendedFeatures: '',
        reason: `Cơ sở sản xuất / Nhà máy / Khu công nghiệp / Lao động phổ thông (${industrialCheck.reason}), không phải cửa hàng F&B/Bán lẻ SMB mở mới.`,
        provider: 'local_nlp'
      };
    }

    // -0.2. Fanpage Media / Esports / Meme / Showbiz / Gossip Check (Highest Priority)
    const mediaCheck = checkMediaEsportsGossipLead({ authorName, content, phones });
    if (mediaCheck.isMediaEsports) {
      return {
        isQualified: false,
        score: 0,
        summary: 'Fanpage tin tức / Esports / Giải trí / Meme / Tuyển thủ (Đã loại trừ)',
        businessType: 'Fanpage Tin tức / Giải trí',
        intent: 'Loại trừ',
        salesPitch: '',
        recommendedFeatures: '',
        reason: `Fanpage tin tức / Esports / Giải trí / Tuyển thủ (${mediaCheck.reason}), không phải cơ sở kinh doanh độc lập.`,
        provider: 'local_nlp'
      };
    }

    const textLower = `${authorName} ${content}`.toLowerCase();
    const cleanPadded = ` ${textLower.normalize('NFKC').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()} `;

    // 0. Explicit Negative Service & Unsupported Sector Check
    if (/đường sắt|duong sat|tàu hỏa|tau hoa|đoàn tàu|toa tàu|ga tàu|vận tải đường sắt|du lịch|tour du lịch|lữ hành|vé máy bay|hàng không|sân bay|du thuyền|tàu thủy|chi nhánh vận tải|tập đoàn đường sắt|tổng công ty đường sắt|tập đoàn quốc gia|ủy ban|ubnd|sở văn hóa|sở du lịch|sở giao thông/i.test(textLower)) {
      return { isQualified: false, score: 10, summary: 'Vận tải / Du lịch / Đường sắt / Cơ quan nhà nước (Đã loại trừ)', businessType: 'Không phù hợp - Vận tải/Du lịch', intent: 'Loại trừ', salesPitch: '', recommendedFeatures: '', reason: 'Ngành giao thông vận tải đường sắt / tour du lịch / cơ quan nhà nước, không phải cửa hàng bán lẻ/F&B SMB.', provider: 'local_nlp' };
    }
    if (/(?:tiệm\s*hoa|shop\s*hoa|hoa\s*sáp|hoa\s*viếng|hoa\s*chia\s*buồn|đặt\s*hoa\s*khai\s*trương|cung\s*cấp\s*hoa)/i.test(textLower)) {
      const isShopThanking = /(?:cảm\s*ơn|cam\s*on|nhận\s*được|ngập\s*tràn|rực\s*rỡ|tặng)/i.test(content) ||
        /(?:quán|tiệm|bún|phở|cơm|cafe|cà\s*phê|trà\s*sữa|nướng|lẩu|ăn\s*vặt|bánh\s*mì|nhậu)/i.test(authorName);
      if (!isShopThanking) {
        return { isQualified: false, score: 15, summary: 'Dịch vụ cung cấp hoa chúc mừng sự kiện khai trương', businessType: 'Dịch vụ Hoa', intent: 'Dịch vụ Hoa khai trương', salesPitch: '', recommendedFeatures: '', reason: 'Dịch vụ cung cấp hoa chúc mừng khai trương, không phải cửa hàng mở mới.', provider: 'local_nlp' };
      }
    }
    if (/(?:đoàn\s*lân|đội\s*lân|thuê\s*múa\s*lân|dịch\s*vụ\s*múa\s*lân)/i.test(textLower)) {
      const isStoreOpeningEvent = /(?:quán|tiệm|shop|cafe|cà\s*phê|trà\s*sữa|bún|phở|cơm|lẩu|nướng|ăn\s*vặt|bánh\s*mì|menu|mua\s*1\s*tặng\s*1|giảm\s*\d+%)/i.test(textLower);
      if (!isStoreOpeningEvent) {
        return { isQualified: false, score: 15, summary: 'Đoàn lân / Dịch vụ múa lân biểu diễn sự kiện', businessType: 'Dịch vụ Múa Lân', intent: 'Dịch vụ Biểu diễn', salesPitch: '', recommendedFeatures: '', reason: 'Đoàn lân / Dịch vụ múa lân sự kiện khai trương, không phải quán mở mới.', provider: 'local_nlp' };
      }
    }
    if (/nhà xe|xe khách|xe limousine|tuyến xe|chuyến xe|vé xe khách|bến xe/i.test(textLower)) {
      return { isQualified: false, score: 15, summary: 'Dịch vụ nhà xe / Vận tải hành khách', businessType: 'Vận tải / Xe khách', intent: 'Dịch vụ Vận tải', salesPitch: '', recommendedFeatures: '', reason: 'Nhà xe / Dịch vụ xe khách vận tải hành khách.', provider: 'local_nlp' };
    }
    if (/nhà thuốc|tiệm thuốc tây|quầy thuốc|dược phẩm/i.test(textLower)) {
      const matchedTerm = (textLower.match(/nhà thuốc|tiệm thuốc tây|quầy thuốc|dược phẩm/i) || [])[0] || '';
      if (!isLandmarkContext(content, matchedTerm)) {
        return { isQualified: false, score: 15, summary: 'Tiệm thuốc tây / Quầy bán dược phẩm', businessType: 'Dược phẩm / Nhà thuốc', intent: 'Nhà thuốc', salesPitch: '', recommendedFeatures: '', reason: 'Tiệm thuốc tây / Quầy thuốc (Đã loại trừ theo yêu cầu).', provider: 'local_nlp' };
      }
    }
    if (/khách sạn|hotel|resort|homestay|nhà nghỉ|motel|villa/i.test(textLower)) {
      const matchedTerm = (textLower.match(/khách sạn|hotel|resort|homestay|nhà nghỉ|motel|villa/i) || [])[0] || '';
      if (!isLandmarkContext(content, matchedTerm)) {
        return { isQualified: false, score: 15, summary: 'Cơ sở lưu trú / Khách sạn / Homestay / Resort', businessType: 'Khách sạn / Lưu trú', intent: 'Lưu trú / Hotel', salesPitch: '', recommendedFeatures: '', reason: 'Khách sạn / Resort / Homestay (Đã loại trừ theo yêu cầu).', provider: 'local_nlp' };
      }
    }
    if (/(?:khai\s*trương\s*tòa\s*nhà|tòa\s*nhà|cao\s*ốc|building|tower|sa\s*bàn|đại\s*đô\s*thị|khu\s*đô\s*thị|dự\s*án\s*bất\s*động\s*sản|mở\s*bán\s*(?:dự\s*án|căn\s*hộ|chung\s*cư|đất\s*nền|shophouse|biệt\s*thự|nhà\s*phố|phân\s*khu|tòa)|lễ\s*mở\s*bán|bất\s*động\s*sản|nhà\s*đất|bđs|phòng\s*trọ|căn\s*hộ|chung\s*cư|cho\s*thuê\s*phòng|cho\s*thuê\s*nhà|cho\s*thuê\s*văn\s*phòng|vinhomes|masterise|novaland|sun\s*group)/iu.test(textLower)) {
      const isStoreSellingFoodOrRetail = /(?:quán|tiệm|shop|cafe|cà\s*phê|trà\s*sữa|bún|phở|cơm|lẩu|nướng|ăn\s*vặt|bánh\s*mì|menu|thực\s*đơn|đồ\s*uống|món)/i.test(textLower);
      const matchedTerm = (textLower.match(/(?:khai\s*trương\s*tòa\s*nhà|tòa\s*nhà|cao\s*ốc|building|tower|sa\s*bàn|đại\s*đô\s*thị|khu\s*đô\s*thị|dự\s*án\s*bất\s*động\s*sản|mở\s*bán\s*(?:dự\s*án|căn\s*hộ|chung\s*cư|đất\s*nền|shophouse|biệt\s*thự|nhà\s*phố|phân\s*khu|tòa)|lễ\s*mở\s*bán|bất\s*động\s*sản|nhà\s*đất|bđs|phòng\s*trọ|căn\s*hộ|chung\s*cư|cho\s*thuê\s*phòng|cho\s*thuê\s*nhà|cho\s*thuê\s*văn\s*phòng|vinhomes|masterise|novaland|sun\s*group)/iu) || [])[0] || '';
      if (!isLandmarkContext(content, matchedTerm) && !isStoreSellingFoodOrRetail) {
        return { isQualified: false, score: 0, summary: 'Khai trương tòa nhà / Sa bàn / Bất động sản (Đã loại trừ)', businessType: 'Bất động sản / Tòa nhà', intent: 'Loại trừ', salesPitch: '', recommendedFeatures: '', reason: 'Khai trương tòa nhà, sa bàn, dự án bất động sản, căn hộ, văn phòng (Đã loại trừ theo yêu cầu).', provider: 'local_nlp' };
      }
    }
    if (/(?:gara|garage|sửa\s*xe|tiệm\s*sửa\s*xe|sửa\s*xe\s*máy|rửa\s*xe|tiệm\s*rửa\s*xe|chăm\s*sóc\s*xe|detailing|cứu\s*hộ\s*xe|cứu\s*hộ\s*giao\s*thông|vá\s*vỏ|vá\s*xe|thay\s*nhớt)/iu.test(textLower)) {
      return { isQualified: false, score: 0, summary: 'Dịch vụ sửa xe / Gara / Rửa xe (Đã loại trừ)', businessType: 'Dịch vụ Sửa xe / Gara', intent: 'Loại trừ', salesPitch: '', recommendedFeatures: '', reason: 'Ngành dịch vụ sửa xe, gara, rửa xe (Đã loại trừ theo quy tắc chỉ nhận Bida/Karaoke).', provider: 'local_nlp' };
    }
    if (/(?:sửa\s*điện\s*thoại|ép\s*kính|sửa\s*máy\s*tính|sửa\s*laptop|sửa\s*chữa\s*điện\s*lạnh|sửa\s*điều\s*hòa|lắp\s*điều\s*hòa|lắp\s*đặt\s*camera|thợ\s*điện|thợ\s*nước|nhôm\s*kính|xưởng\s*mộc|thi\s*công\s*nội\s*thất|làm\s*biển\s*quảng\s*cáo|bảng\s*hiệu\s*quảng\s*cáo)/iu.test(textLower)) {
      return { isQualified: false, score: 0, summary: 'Dịch vụ kỹ thuật / Sửa chữa / Nội thất / Quảng cáo (Đã loại trừ)', businessType: 'Dịch vụ Kỹ thuật / Sửa chữa', intent: 'Loại trừ', salesPitch: '', recommendedFeatures: '', reason: 'Ngành dịch vụ sửa chữa kỹ thuật, nội thất, quảng cáo (Đã loại trừ theo quy tắc chỉ nhận Bida/Karaoke).', provider: 'local_nlp' };
    }
    if (/(?:giặt\s*là|giặt\s*ủi|giặt\s*sấy|tiệm\s*giặt|vệ\s*sinh\s*công\s*nghiệp|dọn\s*nhà|dọn\s*dẹp\s*vệ\s*sinh|chuyển\s*nhà\s*trọn\s*gói|hút\s*hầm\s*cầu|thông\s*cống)/iu.test(textLower)) {
      return { isQualified: false, score: 0, summary: 'Dịch vụ giặt là / Vệ sinh / Dọn nhà (Đã loại trừ)', businessType: 'Dịch vụ Tiện ích / Giặt là', intent: 'Loại trừ', salesPitch: '', recommendedFeatures: '', reason: 'Ngành dịch vụ giặt là, vệ sinh (Đã loại trừ theo quy tắc chỉ nhận Bida/Karaoke).', provider: 'local_nlp' };
    }
    if (/(?:cắt\s*tóc|tiệm\s*cắt\s*tóc|salon\s*tóc|hair\s*salon|barber|barbershop|tiệm\s*tóc|uốn\s*tóc|nhuộm\s*tóc)/iu.test(textLower)) {
      return { isQualified: false, score: 0, summary: 'Dịch vụ cắt tóc / Salon tóc / Barbershop (Đã loại trừ)', businessType: 'Dịch vụ Tóc / Barber', intent: 'Loại trừ', salesPitch: '', recommendedFeatures: '', reason: 'Ngành dịch vụ cắt tóc, salon tóc, barbershop (Đã loại trừ theo quy tắc chỉ nhận Bida/Karaoke).', provider: 'local_nlp' };
    }
    if (/(?:cầm\s*đồ|tiệm\s*cầm\s*đồ|cho\s*vay|vay\s*vốn|đáo\s*hạn|văn\s*phòng\s*công\s*chứng|công\s*chứng|luật\s*sư|tư\s*vấn\s*luật|kế\s*toán\s*thuế)/iu.test(textLower)) {
      return { isQualified: false, score: 0, summary: 'Dịch vụ tài chính / Cầm đồ / Pháp lý (Đã loại trừ)', businessType: 'Dịch vụ Tài chính / Pháp lý', intent: 'Loại trừ', salesPitch: '', recommendedFeatures: '', reason: 'Ngành dịch vụ tài chính, cầm đồ, pháp lý (Đã loại trừ theo quy tắc chỉ nhận Bida/Karaoke).', provider: 'local_nlp' };
    }
    if (/(?:phòng\s*khám\s*thú\s*y|thú\s*y|bác\s*sĩ\s*thú\s*y|spa\s*thú\s*cưng|cắt\s*tỉa\s*lông\s*(?:chó|mèo))/iu.test(textLower)) {
      return { isQualified: false, score: 0, summary: 'Dịch vụ thú y / Spa thú cưng (Đã loại trừ)', businessType: 'Dịch vụ Thú y / Thú cưng', intent: 'Loại trừ', salesPitch: '', recommendedFeatures: '', reason: 'Ngành dịch vụ chăm sóc thú cưng, thú y (Đã loại trừ theo quy tắc chỉ nhận Bida/Karaoke).', provider: 'local_nlp' };
    }
    if (/(?:phòng\s*gym|tập\s*gym|yoga|dance\s*studio|lớp\s*nhảy|hồ\s*bơi|bể\s*bơi)/iu.test(textLower)) {
      return { isQualified: false, score: 0, summary: 'Dịch vụ Thể hình / Gym / Yoga (Đã loại trừ)', businessType: 'Dịch vụ Thể hình / Gym', intent: 'Loại trừ', salesPitch: '', recommendedFeatures: '', reason: 'Ngành dịch vụ thể hình, gym, yoga (Đã loại trừ theo quy tắc chỉ nhận Bida/Karaoke).', provider: 'local_nlp' };
    }
    if (/(?:người\s*vô\s*gia\s*cư|chính\s*sách\s*an\s*sinh|tạm\s*trú|nhà\s*tình\s*thương|viện\s*dưỡng\s*lão|trại\s*trẻ\s*mồ\s*côi|an\s*sinh\s*xã\s*hội|phó\s*thống\s*đốc|thị\s*trưởng)/iu.test(textLower)) {
      return { isQualified: false, score: 0, summary: 'Tin tức xã hội / An sinh / Phi kinh doanh (Đã loại trừ)', businessType: 'Phi thương mại / Xã hội', intent: 'Loại trừ', salesPitch: '', recommendedFeatures: '', reason: 'Bài viết tin tức xã hội, an sinh, phi kinh doanh thương mại.', provider: 'local_nlp' };
    }
    if (/dịch vụ sinh|sinh đẻ|sinh con|gói sinh|thai sản|khoa sản|phụ sản|khám thai|sinh mổ|sinh thường|tắm bé|thông tắc tia sữa|thông tia sữa/i.test(textLower)) {
      return { isQualified: false, score: 15, summary: 'Dịch vụ Y tế / Gói thai sản và sinh nở', businessType: 'Y tế / Dịch vụ Sinh đẻ', intent: 'Dịch vụ Thai sản / Sinh nở', salesPitch: '', recommendedFeatures: '', reason: 'Dịch vụ y tế sinh đẻ / Gói thai sản (Đã loại trừ theo yêu cầu).', provider: 'local_nlp' };
    }
    if (/spa|tiệm spa|thẩm mỹ viện|tham my vien|thẩm mỹ|massage|chăm sóc da|gội đầu dưỡng sinh|dưỡng sinh|phun xăm|nối mi|triệt lông|tiệm nail|làm nail/i.test(textLower)) {
      return { isQualified: false, score: 15, summary: 'Dịch vụ Spa / Nail / Thẩm mỹ viện / Massage (Đã loại trừ)', businessType: 'Spa / Thẩm mỹ', intent: 'Loại trừ', salesPitch: '', recommendedFeatures: '', reason: 'Dịch vụ Spa, Thẩm mỹ viện, Massage, Tiệm Nail (Đã loại trừ theo quy tắc POS bán lẻ/F&B).', provider: 'local_nlp' };
    }

    // 0. Education, School Opening, Kindergarten, Academic Year Exclusions (Highest Priority)
    const schoolMatches = textLower.match(/mùa khai trường|khai trường|khai giảng|lễ khai giảng|năm học mới|tựu trường|mầm non|tiểu học|thcs|thpt|trường đại học|trường cao đẳng|học viện|tập thể lớp|niên khóa|bảng tên khai giảng|hoa khai giảng|phông khai giảng|bóng bay khai giảng|đơn khai trường/i);
    if (schoolMatches) {
      const term = schoolMatches[0];
      const isLandmark = isLandmarkContext(content, term);
      const isFBRetail = /(?:quán\s+(?:cafe|cà\s*phê|trà\s*sữa|ăn|nhậu|cơm|phở|bún|nướng|lẩu|nước|ốc)|tiệm\s+(?:trà|cơm|bánh|phở|bún|nướng)|cafe|cà\s*phê|trà\s*sữa|bún\s*bò|phở|cơm\s*tấm|lẩu\s*nướng|menu\s*(?:quán|món)|giảm\s*(?:\d+%)|(?:học\s*sinh|sinh\s*viên))/i.test(textLower) && !/(?:in\s*phông|bảng\s*tên|in\s*biển|in\s*ấn|in\s*thiệp)/i.test(textLower);
      if (!isLandmark && !isFBRetail) {
        return {
          isQualified: false,
          score: 0,
          summary: 'Trường học / Lễ khai giảng năm học / Giáo dục (Đã loại trừ)',
          businessType: 'Giáo dục / Trường học',
          intent: 'Loại trừ',
          salesPitch: '',
          recommendedFeatures: '',
          reason: 'Bài viết về trường học, lễ khai giảng, mùa khai trường năm học mới (Không phải quán kinh doanh F&B/Bán lẻ).',
          provider: 'local_nlp'
        };
      }
    }

    // 1. Opening / Launching Intent Keywords (Highest Intent)
    const openingKeywords = [
      'khai trương', 'grand opening', 'opening', 'chính thức mở cửa', 'tưng bừng khai trương',
      'ngày mở màn', 'lên đèn', 'chạy thử', 'soft opening', 'mừng khai trương',
      'ưu đãi khai trương', 'khuyến mãi khai trương', 'chuẩn bị khai trương', 'sắp khai trương',
      'mở cửa đón khách', 'chính thức đón khách', 'ngày mai mở bán', 'ngày đầu mở bán', 'mở quán', 'mở tiệm', 'mở shop'
    ];
    const isOpening = openingKeywords.some(kw => textLower.includes(kw));

    // 2. Hiring Cashier / Sales / Staff (High Intent)
    const hiringKeywords = [
      'tuyển thu ngân', 'tuyển nhân viên thu ngân', 'tuyển nhân viên bán hàng', 'tuyển thu ngân ca',
      'tuyển phục vụ', 'tuyển nhân viên order', 'tuyển quản lý quán', 'tuyển nhân viên ca'
    ];
    const isHiring = hiringKeywords.some(kw => textLower.includes(kw));

    // 3. Expansion & Transferring Intent
    const expansionKeywords = ['chi nhánh mới', 'cơ sở mới', 'mở rộng', 'sang quán', 'sang nhượng'];
    const isExpanding = expansionKeywords.some(kw => textLower.includes(kw));

    // 3.5. POS / Hardware & Competitor Software Intent
    const posKeywords = ['kiotviet', 'sapo', 'misa', 'ipos', 'haravan', 'pos365', 'máy tính tiền', 'máy in bill', 'máy in hóa đơn', 'phần mềm bán hàng', 'máy pos'];
    const isPosRelated = posKeywords.some(kw => textLower.includes(kw));

    // 4. Identify Business Category
    let businessType = 'Bán lẻ / Dịch vụ SMB';
    const hasFBKeyword = /(?:quán\s+ăn|nhà\s+hàng|bánh\s+mì|ăn\s+vặt|quán\s+nhậu|hải\s+sản|quán\s+ốc|tiệm\s+ốc|quán\s+cơm|tiệm\s+cơm|quán\s+phở|tiệm\s+phở|quán\s+bún|tiệm\s+bún|quán\s+lẩu|quán\s+nướng|tiệm\s+nướng|quán\s+bia)/i.test(textLower) ||
      [' bún bò ', ' bún chả ', ' bún riêu ', ' bún đậu ', ' phở bò ', ' phở gà ', ' cơm tấm ', ' cơm gà ', ' cơm niêu ', ' cơm bình dân ', ' cơm sườn ', ' lẩu nướng ', ' bbq '].some(kw => cleanPadded.includes(kw)) ||
      ([' bún ', ' phở ', ' lẩu ', ' nướng ', ' bbq ', ' ốc '].some(kw => cleanPadded.includes(kw)) && !/(?:tiền\s*cơm|bao\s*cơm|hỗ\s*trợ\s*cơm|phụ\s*cấp\s*cơm|có\s*cơm|ăn\s*cơm)/i.test(textLower));

    if (/\b(?:bida|billiard|billiards|bi-a|karaoke|hát\s*cho\s*nhau\s*nghe)\b/i.test(textLower)) {
      businessType = 'Dịch vụ Giải trí - Bida / Karaoke';
    } else if (/cafe|cà phê|coffee|trà sữa|milktea|trà trái cây|quán nước|sinh tố|chè/i.test(textLower)) {
      businessType = 'F&B - Cafe / Trà sữa';
    } else if (hasFBKeyword) {
      businessType = 'F&B - Quán ăn / Nhà hàng';
    } else if (/quần áo|thời trang|váy|đầm|shop|giày|túi xách|phụ kiện|unisex|boutique/i.test(textLower)) {
      businessType = 'Thời trang / Phụ kiện';
    } else if (/tạp hóa|siêu thị|bách hóa|tiện lợi|mini mart|mart/i.test(textLower)) {
      businessType = 'Tạp hóa / Siêu thị mini';
    } else if (/mỹ phẩm|son|skincare|nước hoa/i.test(textLower)) {
      businessType = 'Mỹ phẩm / Làm đẹp';
    } else if (/mẹ và bé|bỉm sữa|đồ chơi|sơ sinh/i.test(textLower)) {
      businessType = 'Mẹ & Bé';
    }

    // 5. Score Calculation & Sales Pitch Generation
    let score = 25;
    let intent = 'Chưa rõ mục đích';
    let reason = 'Bài viết không có tín hiệu rõ ràng về kinh doanh bán lẻ hay F&B.';
    let salesPitch = '';
    let recommendedFeatures = '';

    const hasSpecificBusinessCategory = businessType !== 'Bán lẻ / Dịch vụ SMB';
    if (hasSpecificBusinessCategory) {
      score = 60;
      intent = 'Hoạt động kinh doanh';
      reason = `${businessType} đang hoạt động kinh doanh độc lập.`;
      salesPitch = `Chào anh/chị, em thấy ${businessType} của mình đang hoạt động, bên em đang có giải pháp máy tính tiền và in bill chuyên dụng...`;
      recommendedFeatures = 'In bill & Quản lý bán hàng';
    }

    if (isOpening) {
      if (hasSpecificBusinessCategory) {
        score = 95;
        intent = 'Khai trương cửa hàng mới';
        reason = `${businessType} chuẩn bị khai trương / mở cửa, nhu cầu cao về phần mềm bán hàng và in hóa đơn.`;
      } else {
        const hasRetailSignal = /(?:quán|tiệm|shop|cửa\s*hàng|cơ\s*sở|chi\s*nhánh|menu|thực\s*đơn|món|nước|ly|tô|đĩa|bán|giá|order|đặt\s*bàn|mua|bán\s*lẻ|sản\s*phẩm|ưu\s*đãi|giảm\s*(?:\d+%)|khuyến\s*mãi|kính\s*mời|mời\s*(?:cả\s*nhà|mọi\s*người)|ủng\s*hộ|địa\s*chỉ|tọa\s*lạc|check-?in|đón\s*khách)/iu.test(textLower);
        if (hasRetailSignal) {
          score = 85;
          intent = 'Khai trương cửa hàng mới';
          reason = `${businessType} chuẩn bị khai trương / mở cửa, nhu cầu cao về phần mềm bán hàng và in hóa đơn.`;
        } else {
          score = 35;
          intent = 'Chưa rõ mô hình';
          reason = 'Bài viết thông báo khai trương nhưng không rõ sản phẩm F&B hay bán lẻ.';
        }
      }
      salesPitch = `Chào anh/chị, em thấy quán mình chuẩn bị khai trương, bên em đang có gói hỗ trợ máy in bill và phần mềm order bàn/quét mã cho quán mới mở...`;
      recommendedFeatures = businessType.includes('F&B') 
        ? 'In bill bếp, Quản lý định lượng & Order QR' 
        : (businessType.includes('Bida') || businessType.includes('Karaoke'))
          ? 'Tính tiền giờ theo bàn/phòng & Order đồ uống'
          : 'In tem mã vạch & Quản lý tồn kho';
    } else if (isHiring) {
      score = 75;
      intent = 'Tuyển dụng thu ngân / bán hàng';
      reason = `${businessType} đang tuyển nhân sự thu ngân/bán hàng, cần tối ưu quy trình quản lý quầy.`;
      salesPitch = `Chào anh/chị, bên em có phần mềm bán hàng giao diện đơn giản giúp nhân viên thu ngân mới làm quen chỉ sau 5 phút...`;
      recommendedFeatures = 'Phân quyền thu ngân & Chống thất thoát';
    } else if (isPosRelated) {
      score = 75;
      intent = 'Phần mềm / Thiết bị bán hàng';
      reason = `Bài viết quan tâm hoặc nhắc đến giải pháp phần mềm POS/thiết bị bán hàng, cơ hội tốt để chào giá cạnh tranh.`;
      salesPitch = `Chào anh/chị, em thấy mình đang tìm hiểu/sử dụng phần mềm quản lý, bên em đang có chính sách chuyển đổi tặng máy in và chiết khấu tốt hơn...`;
      recommendedFeatures = 'Gói chuyển đổi phần mềm & Tặng kèm thiết bị';
    } else if (isExpanding) {
      score = 70;
      intent = 'Mở chi nhánh / Sang nhượng';
      reason = `${businessType} mở rộng chi nhánh hoặc chuyển giao cơ sở kinh doanh.`;
      salesPitch = `Chào anh/chị, bên em có gói phần mềm quản lý chuỗi nhiều chi nhánh giúp đồng bộ doanh thu về điện thoại...`;
      recommendedFeatures = 'Quản lý chuỗi chi nhánh & Báo cáo từ xa';
    }

    // Generate clean post summary for local NLP fallback
    let cleanSnippet = (content || '')
      .replace(/(?:Facebook\s*){2,}/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleanSnippet.length > 180) {
      cleanSnippet = cleanSnippet.substring(0, 180) + '...';
    }
    const dynamicSummary = cleanSnippet ? `${authorName ? `[${authorName}] ` : ''}${cleanSnippet}` : reason;

    return {
      isQualified: score >= minScore,
      score,
      summary: dynamicSummary,
      businessType,
      intent,
      salesPitch,
      recommendedFeatures,
      reason,
      provider: 'local_nlp'
    };
  }
}

const aiLeadEvaluator = new AILeadEvaluator();
export default aiLeadEvaluator;
