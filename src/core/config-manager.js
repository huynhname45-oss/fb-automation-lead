import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

const configPath = path.join(process.cwd(), 'config.json');

export const DEFAULT_AI_PROMPT_CONTEXT = `Bạn là chuyên gia thẩm định khách hàng tiềm năng cho phần mềm Quản lý Bán hàng (POS) như Sapo, KiotViet, Haravan, MISA.
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
   - Chuỗi lớn / Franchise quy mô lớn (Phúc Long, Highlands, WinMart, KFC, Lotte, XanhSM...).
   - Nhà thuốc / Tiệm thuốc tây / Quầy thuốc.
   - Khách sạn / Hotel / Resort / Homestay / Nhà nghỉ.
   - Bất động sản / Căn hộ / Phòng trọ / Cho thuê nhà đất.
   - Dịch vụ Sinh đẻ / Gói thai sản / Khám sản phụ khoa / Bệnh viện phụ sản / Chăm sóc mẹ và bé sau sinh / Tắm bé / Thông tắc tia sữa.
   - Dịch vụ Hoa khai trương / Kệ hoa / Giỏ hoa chúc mừng.
   - Dịch vụ Múa Lân khai trương / Đoàn lân / Lân sư rồng.
   - Nhà xe / Xe khách / Tuyến xe / Vé xe limousine.
   - Bài tuyển dụng đa cấp, việc làm online, bài viết đời sống cá nhân không kinh doanh.`;

const DEFAULT_CONFIG = {
  headless: false,
  crawlDelay: 2000,
  maxPosts: 50,
  excludeEnterpriseChains: true,
  excludePosCompetitors: false,
  excludeUnsupportedIndustries: true,
  requireMobilePhoneOnly: true,
  requirePhoneOnly: false,
  excludeKeywords: '',
  aiEnabled: true,
  aiProvider: 'groq',
  aiApiKey: '',
  geminiApiKey: '',
  groqApiKey: '',
  groqModel: 'qwen/qwen3.8-27b',
  // `minLeadScore` is retained for backward compatibility with old UI/configs.
  // New decisions use the explicit accepted/review thresholds below.
  minLeadScore: 75,
  acceptedLeadScore: 75,
  reviewLeadScore: 45,
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
