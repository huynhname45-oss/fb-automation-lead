import test from 'node:test';
import assert from 'node:assert/strict';

import aiLeadEvaluator from '../../src/core/ai-lead-evaluator.js';
import { generateExcerpt, generateSummary } from '../../src/core/data-processor.js';

// =========================================================================
// SEARCH-P0-008 Tests: AI Provider selection strictly respects configuration
// =========================================================================
test('SEARCH-P0-008: AI provider selection calls configured provider even if geminiApiKey exists', async () => {
  let calledProvider = null;
  let calledKey = null;

  // Mock internal provider methods on the instance
  const originalCallGemini = aiLeadEvaluator._callGeminiAPI;
  const originalCallOpenAI = aiLeadEvaluator._callOpenAIAPI;
  const originalCallDeepSeek = aiLeadEvaluator._callDeepSeekAPI;

  aiLeadEvaluator._callGeminiAPI = async (key) => { calledProvider = 'gemini'; calledKey = key; return { score: 90, businessType: 'F&B', intent: 'Khai trương' }; };
  aiLeadEvaluator._callOpenAIAPI = async (key) => { calledProvider = 'openai'; calledKey = key; return { score: 90, businessType: 'F&B', intent: 'Khai trương' }; };
  aiLeadEvaluator._callDeepSeekAPI = async (key) => { calledProvider = 'deepseek'; calledKey = key; return { score: 90, businessType: 'F&B', intent: 'Khai trương' }; };

  try {
    // Config specifies OpenAI, but geminiApiKey also exists
    const configOpenAI = {
      aiEnabled: true,
      aiProvider: 'openai',
      aiApiKey: 'sk-openai-key-123',
      geminiApiKey: 'gemini-key-456'
    };

    await aiLeadEvaluator._callAIProvider('Quán Ăn', 'Khai trương quán cơm', ['0912345678'], configOpenAI);
    assert.equal(calledProvider, 'openai', 'Must call OpenAI when configured as openai');
    assert.equal(calledKey, 'sk-openai-key-123');

    // Config specifies DeepSeek, but geminiApiKey also exists
    const configDeepSeek = {
      aiEnabled: true,
      aiProvider: 'deepseek',
      aiApiKey: 'sk-deepseek-key-789',
      geminiApiKey: 'gemini-key-456'
    };

    await aiLeadEvaluator._callAIProvider('Quán Ăn', 'Khai trương quán cơm', ['0912345678'], configDeepSeek);
    assert.equal(calledProvider, 'deepseek', 'Must call DeepSeek when configured as deepseek');
    assert.equal(calledKey, 'sk-deepseek-key-789');

    // Config specifies Gemini
    const configGemini = {
      aiEnabled: true,
      aiProvider: 'gemini',
      geminiApiKey: 'gemini-key-456'
    };

    await aiLeadEvaluator._callAIProvider('Quán Ăn', 'Khai trương quán cơm', ['0912345678'], configGemini);
    assert.equal(calledProvider, 'gemini');
    assert.equal(calledKey, 'gemini-key-456');

  } finally {
    aiLeadEvaluator._callGeminiAPI = originalCallGemini;
    aiLeadEvaluator._callOpenAIAPI = originalCallOpenAI;
    aiLeadEvaluator._callDeepSeekAPI = originalCallDeepSeek;
  }
});

// =========================================================================
// SEARCH-P0-009 Tests: minLeadScore allows thresholds below 60 (no hidden 60)
// =========================================================================
test('SEARCH-P0-009: minLeadScore respects threshold under 60 without hidden Math.max(minScore, 60)', async () => {
  const originalCallAIProvider = aiLeadEvaluator._callAIProvider;
  
  // Mock AI returning score 50 (valid lead, moderate score)
  aiLeadEvaluator._callAIProvider = async () => ({
    score: 50,
    businessType: 'F&B - Quán cơm',
    intent: 'Tuyển thu ngân',
    summary: 'Quán cơm bình dân',
    reason: 'Quán cơm bình dân đang tuyển nhân viên'
  });

  try {
    // When minScore is set to 40, a score of 50 MUST qualify
    const resultWithLowThreshold = await aiLeadEvaluator.evaluateLeadWithAI(
      'Quán Cơm',
      'Tuyển thu ngân quán cơm',
      ['0912345678'],
      40,
      { aiEnabled: true }
    );
    assert.equal(resultWithLowThreshold.isQualified, true, 'Score 50 should be qualified when minScore is 40');
    assert.equal(resultWithLowThreshold.decision, 'ACCEPTED');

    // When minScore is set to 75, a score of 50 MUST NOT qualify
    const resultWithHighThreshold = await aiLeadEvaluator.evaluateLeadWithAI(
      'Quán Cơm',
      'Tuyển thu ngân quán cơm',
      ['0912345678'],
      75,
      { aiEnabled: true }
    );
    assert.equal(resultWithHighThreshold.isQualified, false, 'Score 50 should not qualify when minScore is 75');
    assert.equal(resultWithHighThreshold.decision, 'REVIEW');

  } finally {
    aiLeadEvaluator._callAIProvider = originalCallAIProvider;
  }
});

// =========================================================================
// SEARCH-P0-011 Tests: generateExcerpt does not falsely claim to be AI
// =========================================================================
test('SEARCH-P0-011: generateExcerpt cleanly truncates content and generateSummary aliases it', () => {
  const longContent = 'Tưng bừng khai trương quán trà sữa và cafe tại số 45 Nguyễn Huệ Quận 1 TP. Hồ Chí Minh với rất nhiều ưu đãi hấp dẫn giảm 50% toàn bộ menu nước uống cho khách hàng ghé trải nghiệm trong tuần lễ đầu tiên mở cửa.';
  
  const excerpt = generateExcerpt(longContent, 50);
  assert.ok(excerpt.length <= 53); // 50 + '...'
  assert.ok(excerpt.endsWith('...'));

  const fullSummary = generateSummary(longContent);
  assert.ok(fullSummary.length <= 133);
});

// =========================================================================
// SEARCH-P0-012 Tests: AI Outage / Network Error fails-safe into REVIEW (never ACCEPTED)
// =========================================================================
test('SEARCH-P0-012: AI provider error does NOT fail-open into ACCEPTED (returns REVIEW with AI_UNAVAILABLE)', async () => {
  const originalCallAIProvider = aiLeadEvaluator._callAIProvider;
  
  // Mock AI provider throwing network/timeout error
  aiLeadEvaluator._callAIProvider = async () => {
    throw new Error('ETIMEDOUT: Connection to AI server timed out after 12000ms');
  };

  try {
    const resultOnError = await aiLeadEvaluator.evaluateLeadWithAI(
      'Quán Cafe Mới',
      'TƯNG BỪNG KHAI TRƯƠNG QUÁN CAFE HÔM NAY',
      ['0912345678'],
      75,
      { aiEnabled: true, aiProvider: 'gemini' }
    );

    // Must NEVER be qualified / ACCEPTED
    assert.equal(resultOnError.isQualified, false, 'Must not be qualified when AI call fails');
    assert.equal(resultOnError.decision, 'REVIEW', 'Must be categorized as REVIEW');
    assert.equal(resultOnError.errorCode, 'AI_UNAVAILABLE');
    assert.ok(resultOnError.reason.includes('Lỗi khi gọi AI'));

  } finally {
    aiLeadEvaluator._callAIProvider = originalCallAIProvider;
  }
});
