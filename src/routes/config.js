import express from 'express';
import { z } from 'zod';
import configManager from '../core/config-manager.js';

const router = express.Router();

const configSchema = z.object({
  headless: z.boolean().optional(),
  crawlDelay: z.number().int().min(500).optional(),
  maxPosts: z.number().int().min(1).optional(),
  excludeEnterpriseChains: z.boolean().optional(),
  excludePosCompetitors: z.boolean().optional(),
  excludeUnsupportedIndustries: z.boolean().optional(),
  requireMobilePhoneOnly: z.boolean().optional(),
  requirePhoneOnly: z.boolean().optional(),
  excludeKeywords: z.string().optional(),
  aiEnabled: z.boolean().optional(),
  aiProvider: z.enum(['free_hybrid', 'gemini', 'openai', 'deepseek', 'groq']).optional(),
  aiApiKey: z.string().optional(),
  geminiApiKey: z.string().optional(),
  geminiModel: z.string().optional(),
  groqApiKey: z.string().optional(),
  groqModel: z.string().optional(),
  minLeadScore: z.number().int().min(0).max(100).optional(),
  acceptedLeadScore: z.number().int().min(0).max(100).optional(),
  reviewLeadScore: z.number().int().min(0).max(100).optional(),
  aiPromptContext: z.string().optional(),
  exportConfig: z.object({
    provinceCode: z.string().optional(),
    productGroup: z.string().optional(),
    salesRep: z.string().optional()
  }).optional(),
  defaultFilters: z.object({
    recentPosts: z.boolean().optional(),
    datePosted: z.string().optional()
  }).optional()
});

router.get('/', (req, res) => {
  try {
    const config = configManager.get();
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/', async (req, res) => {
  try {
    const parsed = configSchema.parse(req.body);
    const updatedConfig = await configManager.update(parsed);
    res.json({ message: 'Config updated successfully', config: updatedConfig });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

/**
 * Live AI Test & Model Discovery Endpoint
 */
router.post('/test-ai', async (req, res) => {
  try {
    const { apiKey, provider = 'gemini', context = '' } = req.body;
    if (!apiKey || !apiKey.trim()) {
      return res.status(400).json({ success: false, error: 'Vui lòng dán API Key trước khi bấm Kiểm tra kết nối!' });
    }

    const { default: aiLeadEvaluator } = await import('../core/ai-lead-evaluator.js');

    if (provider === 'gemini') {
      const discovery = await aiLeadEvaluator.discoverAndVerifyGeminiModels(apiKey.trim(), context);
      return res.json({
        success: true,
        selectedModel: discovery.selectedModel,
        supportedModels: discovery.supportedModels,
        latencyMs: discovery.latencyMs,
        result: discovery.result,
        message: discovery.message
      });
    }

    if (provider === 'groq') {
      const discovery = await aiLeadEvaluator.discoverAndVerifyGroqModels(apiKey.trim(), context);
      return res.json({
        success: true,
        selectedModel: discovery.selectedModel,
        supportedModels: discovery.supportedModels,
        latencyMs: discovery.latencyMs,
        result: discovery.result,
        message: discovery.message
      });
    }

    // Other providers
    const testPost = {
      authorName: 'Trà Sữa Cây Si - Chi Nhánh 2',
      content: 'TƯNG BỪNG KHAI TRƯƠNG chi nhánh 2 tại 45 Nguyễn Huệ vào ngày mai! Giảm 50% toàn bộ menu trà sữa và trà trái cây. Kính mời quý khách ghé trải nghiệm!',
      phones: ['0912345678']
    };

    const startTime = Date.now();
    const result = await aiLeadEvaluator.evaluateWithCustomPrompt(testPost, apiKey.trim(), provider, context);
    const latencyMs = Date.now() - startTime;
    const modelName = provider === 'deepseek' ? 'deepseek-chat' : provider;

    return res.json({
      success: true,
      latencyMs,
      selectedModel: modelName,
      supportedModels: [modelName],
      result,
      message: `Kết nối thành công tới ${provider.toUpperCase()} (${latencyMs}ms)`
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message || 'Lỗi khi gọi API AI'
    });
  }
});

export default router;
