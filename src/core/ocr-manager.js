import { createWorker } from 'tesseract.js';
import logger from './logger.js';
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
      const worker = await this.initWorker();
      if (!worker) return [];

      // Download image with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(imageUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
        }
      });
      clearTimeout(timeoutId);

      if (!res.ok) return [];

      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Skip tiny images (< 4KB - likely avatars or spacers)
      if (buffer.length < 4000) return [];

      // Run OCR with a clean timeout
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
          logger.info(`📸 [OCR CHÍNH XÁC] Nhận diện SĐT từ ảnh: [${phones.join(', ')}] (Độ tin cậy: ${Math.round(confidence)}%)`);
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
