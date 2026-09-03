import logger from './logger.js';
import configManager from './config-manager.js';
import leadFilter, { checkForeignLead } from './lead-filter.js';
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
      : (config.minLeadScore ?? 75);

    // First: Run Deterministic Negative Rule Filter (Fast elimination of obvious enterprise/competitor/spam)
    const ruleEval = leadFilter.evaluateLead({ authorName, content, phones }, config);
    if (!ruleEval.qualified) {
      return {
        isQualified: false,
        score: 10,
        summary: `Bài viết thuộc danh mục loại trừ: ${ruleEval.reason}`,
        businessType: 'Không phù hợp',
        intent: 'Loại trừ',
        reason: ruleEval.reason,
        decision: 'REJECTED',
        provider: 'rule_engine'
      };
    }

    // Try AI Evaluation if enabled
    if (config.aiEnabled !== false) {
      try {
        const aiResult = await this._callAIProvider(authorName, content, phones, config);
        if (aiResult && typeof aiResult.score === 'number') {
          const isNegative = /\b(không phù hợp|loại trừ|cơ quan nhà nước|công an|quân đội|chính quyền|hành chính công|vận tải|đường sắt|du lịch|spa|thẩm mỹ|massage|khách sạn|bất động sản|sinh đẻ|hoa khai trương|múa lân|không xác định|chưa rõ)\b/i.test(`${aiResult.businessType || ''} ${aiResult.intent || ''} ${aiResult.reason || ''}`);
          
          // SEARCH-P0-009: Separate acceptedLeadScore & reviewLeadScore, remove Math.max(minScore, 60)
          const acceptedThreshold = (typeof minScore === 'number' && minScore >= 0 && minScore <= 100)
            ? minScore
            : (config.acceptedLeadScore ?? config.minLeadScore ?? 75);
          const reviewThreshold = config.reviewLeadScore ?? 45;

          if (isNegative || aiResult.score < acceptedThreshold) {
            aiResult.isQualified = false;
            aiResult.decision = (aiResult.score >= reviewThreshold && !isNegative) ? 'REVIEW' : 'REJECTED';
            aiResult.score = isNegative ? Math.min(aiResult.score, 15) : aiResult.score;
          } else {
            aiResult.isQualified = true;
            aiResult.decision = 'ACCEPTED';
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
1. ĐIỂM CAO (80 - 100 điểm) - KHÁCH MỤC TIÊU (F&B / BÁN LẺ SMB):
   - Các quán F&B: quán cafe, trà sữa, quán ăn, quán cơm, bún, phở, lẩu nướng, quán nhậu, tiệm bánh, ăn vặt, sinh tố, chè...
   - Các cửa hàng bán lẻ độc lập: shop thời trang, mỹ phẩm, tạp hóa, siêu thị mini, mẹ & bé, pet shop, phụ kiện, đồ gia dụng...
   - THÔNG BÁO KHAI TRƯƠNG, SẮP MỞ CỬA, MỞ CHI NHÁNH MỚI, ĐANG KINH DOANH (Cần máy in bill, phần mềm bán hàng, quản lý bàn/kho).

2. ĐIỂM THẤP (0 - 20 điểm) - BẮT BUỘC LOẠI BỎ (isQualified = false):
   - Dịch vụ làm đẹp / chăm sóc cá nhân: Spa, Thẩm mỹ viện, Tiệm Nail, Triệt lông, Massage, Gội đầu dưỡng sinh, Salon tóc.
   - Cơ quan Nhà nước, Công an, Cảnh sát, Quân đội, UBND, Trường học, Bệnh viện công, Cơ quan hành chính.
   - Giao thông & Du lịch: Vận tải, Đường sắt, Đoàn tàu, Xe khách, Hàng không, Tour du lịch, Khách sạn, Homestay.
   - Bất động sản, Căn hộ, Nhà trọ, Dịch vụ sinh đẻ, Gói thai sản.
   - B2B & Phụ trợ: In bao bì, Thi công nội thất/setup quán, Bán xe đẩy bán hàng, Múa lân, Mâm cúng, Lắp đặt camera.
   - Chuỗi thương hiệu lớn (Highlands, Phúc Long, WinMart, KFC, Aeon...).
   - Bài viết rác, chỉ có ảnh gia đình, meme, đời sống cá nhân không kinh doanh.`;

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
  "reason": "<1 câu ngắn gọn giải thích lý do đánh giá tiềm năng hoặc lý do loại bỏ>"
}`;

    // SEARCH-P0-008: Route based on configured provider
    if (provider === 'gemini') {
      const key = geminiKey || apiKey;
      if (!key) throw new Error('Chưa cấu hình Gemini API Key');
      return await this._callGeminiAPI(key, systemPrompt, config.geminiModel);
    } else if (provider === 'openai') {
      const key = apiKey || geminiKey;
      if (!key) throw new Error('Chưa cấu hình OpenAI API Key');
      return await this._callOpenAIAPI(key, systemPrompt);
    } else if (provider === 'deepseek') {
      const key = apiKey || geminiKey;
      if (!key) throw new Error('Chưa cấu hình DeepSeek API Key');
      return await this._callDeepSeekAPI(key, systemPrompt);
    } else if (provider === 'free_hybrid') {
      return await this._callFreeAIPipeline(systemPrompt);
    } else {
      if (config.allowProviderFallback) {
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

    // Explicit boost for gemini-3.6-flash as preferred primary model
    let boost = 0;
    if (n.includes('3.6-flash')) boost += 500;
    else if (n.includes('3.7-flash')) boost += 400;
    else if (n.includes('3.8-flash')) boost += 300;
    else if (n.includes('3.5-flash')) boost += 200;

    let typeScore = 0;
    if (n.includes('flash') && !n.includes('lite')) typeScore += 60;
    else if (n.includes('pro')) typeScore += 40;
    else if (n.includes('flash-lite') || n.includes('lite')) typeScore += 30;

    if (n.includes('exp')) typeScore -= 10;
    if (n.includes('preview')) typeScore -= 5;
    if (n.includes('customtools')) typeScore -= 50;

    return versionScore + boost + typeScore;
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
    if (globalThis._lastGeminiCallTs && (now - globalThis._lastGeminiCallTs) < 1500) {
      await new Promise(r => setTimeout(r, 1500 - (now - globalThis._lastGeminiCallTs)));
    }
    globalThis._lastGeminiCallTs = Date.now();

    for (const model of modelsToTry) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

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
              generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
            })
          });
          clearTimeout(timer);

          if (res.ok) {
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
            throw lastError;
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

    const textLower = `${authorName} ${content}`.toLowerCase();

    // 0. Explicit Negative Service & Unsupported Sector Check
    if (/đường sắt|duong sat|tàu hỏa|tau hoa|đoàn tàu|toa tàu|ga tàu|vận tải đường sắt|du lịch|tour du lịch|lữ hành|vé máy bay|hàng không|sân bay|du thuyền|tàu thủy|chi nhánh vận tải|tập đoàn đường sắt|tổng công ty đường sắt|tập đoàn quốc gia|ủy ban|ubnd|sở văn hóa|sở du lịch|sở giao thông/i.test(textLower)) {
      return { isQualified: false, score: 10, summary: 'Vận tải / Du lịch / Đường sắt / Cơ quan nhà nước (Đã loại trừ)', businessType: 'Không phù hợp - Vận tải/Du lịch', intent: 'Loại trừ', salesPitch: '', recommendedFeatures: '', reason: 'Ngành giao thông vận tải đường sắt / tour du lịch / cơ quan nhà nước, không phải cửa hàng bán lẻ/F&B SMB.', provider: 'local_nlp' };
    }
    if (/hoa khai trương|kệ hoa|giỏ hoa|lẵng hoa|đặt hoa khai trương|tiệm hoa|shop hoa/i.test(textLower)) {
      return { isQualified: false, score: 15, summary: 'Dịch vụ cung cấp hoa chúc mừng sự kiện khai trương', businessType: 'Dịch vụ Hoa', intent: 'Dịch vụ Hoa khai trương', salesPitch: '', recommendedFeatures: '', reason: 'Dịch vụ cung cấp hoa chúc mừng khai trương, không phải cửa hàng mở mới.', provider: 'local_nlp' };
    }
    if (/múa lân|lân khai trương|đoàn lân|lân sư rồng|thuê múa lân|trống hội/i.test(textLower)) {
      return { isQualified: false, score: 15, summary: 'Đoàn lân / Dịch vụ múa lân biểu diễn sự kiện', businessType: 'Dịch vụ Múa Lân', intent: 'Dịch vụ Biểu diễn', salesPitch: '', recommendedFeatures: '', reason: 'Đoàn lân / Dịch vụ múa lân sự kiện khai trương, không phải quán mở mới.', provider: 'local_nlp' };
    }
    if (/nhà xe|xe khách|xe limousine|tuyến xe|chuyến xe|vé xe khách|bến xe/i.test(textLower)) {
      return { isQualified: false, score: 15, summary: 'Dịch vụ nhà xe / Vận tải hành khách', businessType: 'Vận tải / Xe khách', intent: 'Dịch vụ Vận tải', salesPitch: '', recommendedFeatures: '', reason: 'Nhà xe / Dịch vụ xe khách vận tải hành khách.', provider: 'local_nlp' };
    }
    if (/nhà thuốc|tiệm thuốc tây|quầy thuốc|dược phẩm/i.test(textLower)) {
      return { isQualified: false, score: 15, summary: 'Tiệm thuốc tây / Quầy bán dược phẩm', businessType: 'Dược phẩm / Nhà thuốc', intent: 'Nhà thuốc', salesPitch: '', recommendedFeatures: '', reason: 'Tiệm thuốc tây / Quầy thuốc (Đã loại trừ theo yêu cầu).', provider: 'local_nlp' };
    }
    if (/khách sạn|hotel|resort|homestay|nhà nghỉ|motel|villa/i.test(textLower)) {
      return { isQualified: false, score: 15, summary: 'Cơ sở lưu trú / Khách sạn / Homestay / Resort', businessType: 'Khách sạn / Lưu trú', intent: 'Lưu trú / Hotel', salesPitch: '', recommendedFeatures: '', reason: 'Khách sạn / Resort / Homestay (Đã loại trừ theo yêu cầu).', provider: 'local_nlp' };
    }
    if (/bất động sản|nhà đất|bđs|phòng trọ|căn hộ|cho thuê phòng|cho thuê nhà/i.test(textLower)) {
      return { isQualified: false, score: 15, summary: 'Dịch vụ Bất động sản / Cho thuê nhà trọ, căn hộ', businessType: 'Bất động sản', intent: 'Bất động sản / Nhà trọ', salesPitch: '', recommendedFeatures: '', reason: 'Bất động sản / Căn hộ / Phòng trọ (Đã loại trừ theo yêu cầu).', provider: 'local_nlp' };
    }
    if (/dịch vụ sinh|sinh đẻ|sinh con|gói sinh|thai sản|khoa sản|phụ sản|khám thai|sinh mổ|sinh thường|tắm bé|thông tắc tia sữa|thông tia sữa/i.test(textLower)) {
      return { isQualified: false, score: 15, summary: 'Dịch vụ Y tế / Gói thai sản và sinh nở', businessType: 'Y tế / Dịch vụ Sinh đẻ', intent: 'Dịch vụ Thai sản / Sinh nở', salesPitch: '', recommendedFeatures: '', reason: 'Dịch vụ y tế sinh đẻ / Gói thai sản (Đã loại trừ theo yêu cầu).', provider: 'local_nlp' };
    }
    if (/spa|tiệm spa|thẩm mỹ viện|tham my vien|thẩm mỹ|massage|chăm sóc da|gội đầu dưỡng sinh|dưỡng sinh|phun xăm|nối mi|triệt lông|tiệm nail|làm nail/i.test(textLower)) {
      return { isQualified: false, score: 15, summary: 'Dịch vụ Spa / Nail / Thẩm mỹ viện / Massage (Đã loại trừ)', businessType: 'Spa / Thẩm mỹ', intent: 'Loại trừ', salesPitch: '', recommendedFeatures: '', reason: 'Dịch vụ Spa, Thẩm mỹ viện, Massage, Tiệm Nail (Đã loại trừ theo quy tắc POS bán lẻ/F&B).', provider: 'local_nlp' };
    }

    // 0. Education, School Opening, Kindergarten, Academic Year Exclusions (Highest Priority)
    if (/mùa khai trường|khai trường|khai giảng|lễ khai giảng|năm học|tựu trường|mầm non|tiểu học|thcs|thpt|đại học|cao đẳng|học viện|học sinh|sinh viên|tân sinh viên|tập thể lớp|niên khóa|bảng tên khai giảng|hoa khai giảng|phông khai giảng|bóng bay khai giảng|đơn khai trường/i.test(textLower)) {
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

    // 1. Opening / Launching Intent Keywords (Highest Intent)
    const openingKeywords = [
      'khai trương', 'grand opening', 'opening', 'chính thức mở cửa', 'tưng bừng khai trương',
      'ngày mở màn', 'lên đèn', 'chạy thử', 'soft opening', 'mừng khai trương',
      'ưu đãi khai trương', 'khuyến mãi khai trương', 'chuẩn bị khai trương', 'sắp khai trương'
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
    if (/cafe|cà phê|coffee|trà sữa|milktea|trà trái cây|quán nước|sinh tố|chè/i.test(textLower)) {
      businessType = 'F&B - Cafe / Trà sữa';
    } else if (/quán ăn|nhà hàng|bún|phở|cơm|lẩu|nướng|bbq|bánh mì|ăn vặt|quán nhậu|ốc/i.test(textLower)) {
      businessType = 'F&B - Quán ăn / Nhà hàng';
    } else if (/quần áo|thời trang|váy|đầm|shop|giày|túi xách|phụ kiện|unisex|boutique/i.test(textLower)) {
      businessType = 'Thời trang / Phụ kiện';
    } else if (/tạp hóa|siêu thị|bách hóa|tiện lợi|mini mart|mart/i.test(textLower)) {
      businessType = 'Tạp hóa / Siêu thị mini';
    } else if (/spa|nail|móng|mi|salon|gội đầu|massage|thẩm mỹ/i.test(textLower)) {
      businessType = 'Spa / Nail / Salon';
    } else if (/bida|billiard|bi-a|gym|fitness/i.test(textLower)) {
      businessType = 'Bida / Thể thao';
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
      score = 95;
      intent = 'Khai trương cửa hàng mới';
      reason = `${businessType} chuẩn bị khai trương / mở cửa, nhu cầu cao về phần mềm bán hàng và in hóa đơn.`;
      salesPitch = `Chào anh/chị, em thấy quán mình chuẩn bị khai trương, bên em đang có gói hỗ trợ máy in bill và phần mềm order bàn/quét mã cho quán mới mở...`;
      recommendedFeatures = businessType.includes('F&B') ? 'In bill bếp, Quản lý định lượng & Order QR' : 'In tem mã vạch & Quản lý tồn kho';
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
