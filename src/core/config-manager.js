import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

const configPath = path.join(process.cwd(), 'config.json');

export const DEFAULT_AI_PROMPT_CONTEXT = `Bạn là chuyên gia thẩm định khách hàng tiềm năng cho phần mềm Quản lý Bán hàng (POS) như Sapo, KiotViet, Haravan, MISA.
Mục tiêu của bạn là phân tích bài viết Facebook để xác định xem người đăng có phải là CHỦ CỬA HÀNG / QUÁN ĐỘC LẬP (SMB) đang chuẩn bị khai trương hoặc đang kinh doanh cần phần mềm bán hàng hay không.

QUY TẮC PHÂN LOẠI & CHẤM ĐIỂM (Score từ 0 đến 100):
1. ĐIỂM CAO (70 - 100 điểm) - KHÁCH TIỀM NĂNG RÕ RÀNG:
   - Các quán F&B (quán cafe, trà sữa, quán ăn, quán cơm, bún phở, lẩu nướng, quán nhậu, tiệm bánh, bida, sinh tố, chè...).
   - Các cửa hàng bán lẻ & dịch vụ độc lập SMB (shop thời trang, mỹ phẩm, tiệm tạp hóa, siêu thị mini, phụ kiện, mẹ & bé, pet shop, tiệm hoa, tiệm nail, spa, salon tóc, phòng tập, sửa xe...).
   - THÔNG BÁO KHAI TRƯƠNG, SẮP MỞ CỬA, MỞ CHI NHÁNH MỚI, ĐANG BÁN HÀNG (Rất cần máy in bill, phần mềm bán hàng, quản lý bàn/kho/doanh thu).

2. ĐIỂM VỪA (35 - 69 điểm) - CẦN XEM LẠI (TIỀM NĂNG HOẶC CẦN XÁC MINH):
   - Cửa hàng/quán độc lập đang TUYỂN THU NGÂN, nhân viên bán hàng, quản lý kho, hoặc SANG NHƯỢNG quán.
   - Bài viết nhắc đến phần mềm POS (KiotViet, Sapo, MISA, Haravan, iPOS...), hỏi mua máy tính tiền, thanh lý máy in bill, hoặc hỏi tư vấn phần mềm bán hàng.
   - Bài viết dịch vụ hoặc kinh doanh nhỏ lẻ cần kiểm tra thêm nhu cầu thực tế.

3. ĐIỂM THẤP (0 - 34 điểm) - BẮT BUỘC LOẠI BỎ (SPAM / KHÔNG KINH DOANH):
   - Các bên cung cấp dịch vụ phụ trợ sự kiện khai trương (bán hoa sáp, hoa tiền, lẵng hoa/kệ hoa khai trương, giỏ quà, giỏ trái cây, mâm quả, múa lân, in ấn thiệp/backdrop) quảng cáo sản phẩm của họ -> BẮT BUỘC LOẠI BỎ (REJECTED), không phải chủ cơ sở mở mới.
   - Bài tuyển dụng lừa đảo, đa cấp, việc làm online tại nhà.
   - Bài viết rác, ảnh gia đình, meme, đời sống cá nhân không kinh doanh.
   - Bài viết hoàn toàn ở nước ngoài (không có số điện thoại hay địa chỉ tại Việt Nam).
   - Nhà máy, xí nghiệp, khu công nghiệp (KCN), xuất khẩu hàng loạt.`;

const DEFAULT_CONFIG = {
  headless: false,
  crawlDelay: 2000,
  maxPosts: 50,
  excludeEnterpriseChains: true,
  excludePosCompetitors: false,
  excludeUnsupportedIndustries: false,
  excludeRealEstate: false,
  excludeHotels: false,
  excludeBeautySpa: false,
  excludeEventGifts: true,
  requireMobilePhoneOnly: true,
  requirePhoneOnly: false,
  excludeKeywords: '',
  aiEnabled: true,
  aiProvider: 'groq',
  aiApiKey: '',
  geminiApiKey: '',
  geminiModel: 'gemini-3.5-flash-lite',
  groqApiKey: '',
  groqModel: 'qwen/qwen3.8-27b',
  // `minLeadScore` is retained for backward compatibility with old UI/configs.
  minLeadScore: 60,
  acceptedLeadScore: 60,
  reviewLeadScore: 35,
  aiPromptContext: DEFAULT_AI_PROMPT_CONTEXT,
  defaultFilters: {
    recentPosts: true,
    datePosted: 'any'
  }
};

class ConfigManager {
  constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.initSync();
  }

  initSync() {
    if (!fsSync.existsSync(configPath)) {
      fsSync.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
      logger.info('Created default config.json');
    } else {
      try {
        const data = fsSync.readFileSync(configPath, 'utf-8');
        this.config = { ...DEFAULT_CONFIG, ...JSON.parse(data) };
      } catch (error) {
        logger.error({ err: error }, 'Failed to parse config.json, using defaults');
      }
    }
  }

  async load() {
    try {
      const data = await fs.readFile(configPath, 'utf-8');
      this.config = { ...DEFAULT_CONFIG, ...JSON.parse(data) };
      return this.config;
    } catch (error) {
      logger.error({ err: error }, 'Error loading config');
      return this.config;
    }
  }

  async save() {
    try {
      await fs.writeFile(configPath, JSON.stringify(this.config, null, 2), 'utf-8');
      logger.info('Config saved successfully');
    } catch (error) {
      logger.error({ err: error }, 'Error saving config');
      throw error;
    }
  }

  get(key) {
    if (!key) return this.config;
    return this.config[key];
  }

  set(key, value) {
    this.config[key] = value;
    return this.save();
  }
  
  async update(newConfig) {
      this.config = { ...this.config, ...newConfig };
      await this.save();
      return this.config;
  }
}

const configManager = new ConfigManager();
export default configManager;
