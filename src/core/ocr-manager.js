import { createWorker } from 'tesseract.js';
import logger from './logger.js';
import configManager from './config-manager.js';
import { extractPhonesFromText } from './phone-validator.js';

export function cleanOCRDigits(text = '') {
  if (!text || typeof text !== 'string') return '';
  // Replace letter O/o/D/Q when acting as leading 0 or inside digits
  let cleaned = text.replace(/(?<=[0-9.\s\-_/])[oOQD](?=[0-9.\s\-_/])/g, '0')
                    .replace(/(?<=\s|^)[oOQD](?=\d{8,9}\b)/g, '0');
  // Replace l/I/|/i/! when acting as 1 inside digit sequences
  cleaned = cleaned.replace(/(?<=[0-9.\s\-_/])[lI|i!](?=[0-9.\s\-_/])/g, '1')
                   .replace(/(?<=\s|^)[lI|i!](?=\d{8,9}\b)/g, '1');
  // Replace S/s surrounded by digits with 5
  cleaned = cleaned.replace(/(?<=[0-9.\s\-_/])[Ss](?=[0-9.\s\-_/])/g, '5');
  // Replace B surrounded by digits with 8
  cleaned = cleaned.replace(/(?<=[0-9.\s\-_/])B(?=[0-9.\s\-_/])/g, '8');
  return cleaned;
}

class OCRManager {
  constructor() {
    this.worker = null;
    this.isInitializing = false;
    this.initPromise = null;
    this.cache = new Map(); // Image URL -> phones array
  }

  async initWorker() {
    if (this.worker) return this.worker;
    if (this.initPromise) return this.initPromise;

    this.isInitializing = true;
    this.initPromise = (async () => {
      try {
        logger.info('Initializing Tesseract OCR worker for Image Phone Recognition...');
        this.worker = await createWorker('eng');
        logger.info('Tesseract OCR worker initialized successfully!');
        return this.worker;
      } catch (err) {
        logger.warn({ err: err.message }, 'Failed to initialize Tesseract OCR worker');
        this.worker = null;
        return null;
      } finally {
        this.isInitializing = false;
      }
    })();

    return this.initPromise;
  }

  /**
   * High-accuracy AI Vision OCR using Google Gemini (Reads curved text, colored fonts on kiosks, banners)
   */
  async _extractPhonesWithGeminiVision(buffer, mimeType = 'image/jpeg') {
    const config = configManager.get();
    const apiKey = (config.geminiApiKey || config.aiApiKey || '').trim();
    if (!apiKey) return null;

    const model = (config.geminiModel && config.geminiModel.startsWith('gemini') && !config.geminiModel.includes('2.5'))
      ? config.geminiModel
      : 'gemini-3.5-flash-lite';

    const base64Data = buffer.toString('base64');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const body = {
      contents: [{
        parts: [
          {
            text: "Hãy đọc ảnh này và tìm tất cả số điện thoại (SĐT di động, hotline, đặt hàng, liên hệ) xuất hiện trên ảnh (biển hiệu, xe đẩy, bảng giá, menu, card visit, xe bán hàng). Chỉ trả về các số điện thoại tìm thấy (10 chữ số bắt đầu bằng 03, 05, 07, 08, 09 hoặc hotline), mỗi số trên 1 dòng. Nếu không có số điện thoại nào thì trả về 'KHONG_CO'."
          },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Data
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0.1
      }
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      clearTimeout(timer);

      if (!res.ok) return null;

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!text || text.includes('KHONG_CO')) return [];

      const phones = extractPhonesFromText(text, { isOCR: true });
      return phones;
    } catch (err) {
      logger.debug({ err: err.message }, 'Gemini Vision OCR error');
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * High-accuracy AI Vision OCR using OpenAI GPT-4o-mini
   */
  async _extractPhonesWithOpenAIVision(buffer, mimeType = 'image/jpeg') {
    const config = configManager.get();
    const apiKey = (config.apiKey || '').trim();
    if (!apiKey) return null;

    const base64Data = buffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64Data}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: "Trích xuất tất cả số điện thoại trên ảnh biển hiệu, xe bán hàng, menu này. Chỉ in danh sách các số điện thoại, mỗi số 1 dòng. Nếu không có in KHONG_CO." },
              { type: 'image_url', image_url: { url: dataUrl } }
            ]
          }],
          temperature: 0.1
        })
      });
      clearTimeout(timer);

      if (!res.ok) return null;
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      if (!text || text.includes('KHONG_CO')) return [];

      return extractPhonesFromText(text, { isOCR: true });
    } catch (err) {
      logger.debug({ err: err.message }, 'OpenAI Vision OCR error');
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async extractPhonesFromImageUrl(imageUrl) {
    if (!imageUrl || typeof imageUrl !== 'string') return [];
    
    // Ignore icons, avatars, emoji, tracking pixels, thumbnails
    if (imageUrl.includes('emoji') || imageUrl.includes('rsrc.php') || imageUrl.includes('/static.xx/') || imageUrl.includes('p50x50') || imageUrl.includes('s150x150')) {
      return [];
    }

    if (this.cache.has(imageUrl)) {
      return this.cache.get(imageUrl);
    }

    try {
      // Download image with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(imageUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
        }
      });
      clearTimeout(timeoutId);

      if (!res.ok) return [];

      const contentType = res.headers.get('content-type') || 'image/jpeg';
      const mimeType = contentType.split(';')[0].trim();
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Skip tiny images (< 4KB - likely avatars or spacers)
      if (buffer.length < 4000) return [];

      // 1. TẦNG 1: Ưu tiên AI Vision OCR (Gemini Vision / OpenAI Vision) - Độ chính xác vượt trội trên biển hiệu & xe bán hàng
      const config = configManager.get();
      if (config.aiEnabled !== false) {
        let aiPhones = null;
        if (config.geminiApiKey || (config.aiProvider === 'gemini' && config.aiApiKey)) {
          aiPhones = await this._extractPhonesWithGeminiVision(buffer, mimeType);
        } else if (config.apiKey || config.aiProvider === 'openai') {
          aiPhones = await this._extractPhonesWithOpenAIVision(buffer, mimeType);
        }

        if (Array.isArray(aiPhones) && aiPhones.length > 0) {
          logger.info(`📸 [AI VISION OCR CHÍNH XÁC] Nhận diện SĐT từ ảnh: [${aiPhones.join(', ')}]`);
          this.cache.set(imageUrl, aiPhones);
          return aiPhones;
        }
      }

      // 2. TẦNG 2: Fallback Tesseract.js cục bộ khi không có AI Vision
      const worker = await this.initWorker();
      if (!worker) return [];

      let ocrTimer = null;
      const timeoutPromise = new Promise((_, reject) => {
        ocrTimer = setTimeout(() => reject(new Error('OCR Timeout')), 7000);
      });
      
      let ocrResult = null;
      try {
        ocrResult = await Promise.race([worker.recognize(buffer), timeoutPromise]);
      } finally {
        if (ocrTimer) clearTimeout(ocrTimer);
      }

      const data = ocrResult && ocrResult.data ? ocrResult.data : null;
      const confidence = (data && typeof data.confidence === 'number') ? data.confidence : 0;
      const rawText = (data && data.text) ? data.text : '';
      const recognizedText = cleanOCRDigits(rawText);

      if (confidence >= 15 && recognizedText && recognizedText.trim().length > 3) {
        const phones = extractPhonesFromText(recognizedText, { isOCR: true });
        if (phones.length > 0) {
          logger.info(`📸 [TESSERACT OCR] Nhận diện SĐT từ ảnh: [${phones.join(', ')}] (Độ tin cậy: ${Math.round(confidence)}%)`);
          this.cache.set(imageUrl, phones);
          return phones;
        }
      }
    } catch (err) {
      logger.debug({ err: err.message }, 'OCR extraction skipped or timed out for image');
    }

    this.cache.set(imageUrl, []);
    return [];
  }

  async extractPhonesFromImageUrls(imageUrls = []) {
    if (!Array.isArray(imageUrls) || imageUrls.length === 0) return [];

    const allPhones = new Set();
    const targets = imageUrls.slice(0, 3);
    
    // Run parallel OCR across all candidate images
    const results = await Promise.allSettled(
      targets.map(url => this.extractPhonesFromImageUrl(url))
    );

    for (const res of results) {
      if (res.status === 'fulfilled' && Array.isArray(res.value)) {
        res.value.forEach(p => allPhones.add(p));
      }
    }

    return Array.from(allPhones);
  }

  async terminate() {
    if (this.worker) {
      try {
        await this.worker.terminate();
      } catch (e) {}
      this.worker = null;
      this.initPromise = null;
    }
  }
}

const ocrManager = new OCRManager();
export default ocrManager;
