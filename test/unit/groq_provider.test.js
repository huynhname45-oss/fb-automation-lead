import test from 'node:test';
import assert from 'node:assert/strict';
import configManager from '../../src/core/config-manager.js';
import aiLeadEvaluator from '../../src/core/ai-lead-evaluator.js';
import ocrManager from '../../src/core/ocr-manager.js';

test('Groq Provider Config: supports groq provider, model and apiKey in default config', () => {
  const cfg = configManager.get();
  assert.equal(cfg.aiProvider, 'groq');
  assert.ok(['qwen/qwen3.8-27b', 'openai/gpt-oss-120b'].includes(cfg.groqModel));
  assert.ok('groqApiKey' in cfg);
});

test('Groq Lead Evaluator: _callGroqAPI formats request and parses structured output', async () => {
  const originalFetch = globalThis.fetch;
  let interceptedUrl = '';
  let interceptedHeaders = {};
  let interceptedBody = null;

  globalThis.fetch = async (url, options) => {
    interceptedUrl = url;
    interceptedHeaders = options.headers;
    interceptedBody = JSON.parse(options.body);

    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                score: 92,
                businessType: 'F&B - Quán Ăn',
                reason: 'Quán ăn bún bò huế tưng bừng khai trương cần máy in và phần mềm POS',
                salesPitch: 'Chúc mừng quán khai trương hồng phát! Bên em hỗ trợ giải pháp bán hàng Sapo in bill nhanh chóng.'
              })
            }
          }
        ]
      })
    };
  };

  try {
    const result = await aiLeadEvaluator._callGroqAPI('gsk_test_key_12345', 'Kiểm tra quán mới khai trương', 'openai/gpt-oss-120b');
    
    assert.equal(interceptedUrl, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(interceptedHeaders['Authorization'], 'Bearer gsk_test_key_12345');
    assert.equal(interceptedBody.model, 'openai/gpt-oss-120b');
    assert.equal(interceptedBody.response_format?.type, 'json_object');
    
    assert.equal(result.score, 92);
    assert.equal(result.businessType, 'F&B - Quán Ăn');
    assert.ok(result.salesPitch.includes('Sapo'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Groq Lead Evaluator: _scoreGroqModel ranks Qwen 3.8 and GPT-OSS 120B highest while excluding non-text', () => {
  assert.ok(aiLeadEvaluator._scoreGroqModel('whisper-large-v3') < 0);
  assert.ok(aiLeadEvaluator._scoreGroqModel('meta-llama/llama-prompt-guard-2-86m') < 0);
  assert.ok(aiLeadEvaluator._scoreGroqModel('groq/compound') < 0);

  assert.ok(aiLeadEvaluator._scoreGroqModel('qwen/qwen3.8-27b') > aiLeadEvaluator._scoreGroqModel('openai/gpt-oss-120b'));
  assert.ok(aiLeadEvaluator._scoreGroqModel('openai/gpt-oss-120b') > aiLeadEvaluator._scoreGroqModel('openai/gpt-oss-20b'));
  assert.ok(aiLeadEvaluator._scoreGroqModel('qwen/qwen3.8-27b') > aiLeadEvaluator._scoreGroqModel('groq/compound-mini'));
});

test('Groq Lead Evaluator: discoverAndVerifyGroqModels discovers, ranks and verifies strongest model', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/models')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: 'whisper-large-v3' },
            { id: 'openai/gpt-oss-20b' },
            { id: 'openai/gpt-oss-120b' },
            { id: 'qwen/qwen3.8-27b' }
          ]
        })
      };
    }
    // chat completions
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                score: 95,
                businessType: 'F&B',
                summary: 'Khai trương',
                salesPitch: 'Chào mừng'
              })
            }
          }
        ]
      })
    };
  };

  const originalUpdate = configManager.update;
  configManager.update = async () => {};

  try {
    const discovery = await aiLeadEvaluator.discoverAndVerifyGroqModels('gsk_test_mock_key');
    assert.equal(discovery.success, true);
    assert.equal(discovery.selectedModel, 'qwen/qwen3.8-27b');
    assert.ok(discovery.supportedModels.includes('qwen/qwen3.8-27b'));
    assert.ok(discovery.supportedModels.includes('openai/gpt-oss-120b'));
    assert.ok(!discovery.supportedModels.includes('whisper-large-v3'));
  } finally {
    configManager.update = originalUpdate;
    globalThis.fetch = originalFetch;
  }
});

test('Groq Vision OCR: _extractPhonesWithGroqVision extracts phone numbers using available vision model', async () => {
  const originalFetch = globalThis.fetch;
  let visionCalled = false;
  let capturedModel = '';

  globalThis.fetch = async (url, options) => {
    if (url.includes('api.groq.com')) {
      visionCalled = true;
      const body = JSON.parse(options.body);
      capturedModel = body.model;

      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: 'Hotline biển hiệu quán: 079.6666.428 - 0987654321'
              }
            }
          ]
        })
      };
    }
    return originalFetch(url, options);
  };

  try {
    const fakeBuffer = Buffer.from('fake image data');
    const phones = await ocrManager._extractPhonesWithGroqVision(fakeBuffer, 'image/jpeg');
    
    assert.ok(visionCalled);
    assert.equal(capturedModel, 'qwen/qwen3.8-27b');
    assert.ok(phones.some(p => p.includes('0796666428') || p.includes('079.6666.428')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Groq Pipeline: evaluateLeadWithAI calls Groq during data crawling', async () => {
  const originalFetch = globalThis.fetch;
  let groqCalled = false;
  let capturedModel = '';

  globalThis.fetch = async (url, options) => {
    if (url.includes('api.groq.com')) {
      groqCalled = true;
      const body = JSON.parse(options.body);
      capturedModel = body.model;

      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  score: 95,
                  businessType: 'F&B - Trà Sữa',
                  summary: 'Quán trà sữa khai trương',
                  location: 'Đồng Nai',
                  intent: 'Khai trương',
                  salesPitch: 'Chào mừng khai trương quán mới!',
                  recommendedFeatures: 'Quản lý bàn',
                  reason: 'Quán mở mới cần POS'
                })
              }
            }
          ]
        })
      };
    }
    return originalFetch(url, options);
  };

  try {
    const post = {
      authorName: 'Trà Sữa Nhà Bông',
      content: 'Tưng bừng khai trương quán trà sữa tại Biên Hòa Đồng Nai! Kính mời cả nhà ghé chơi.',
      phones: ['0912345678']
    };

    const evalResult = await aiLeadEvaluator.evaluateLeadWithAI(post, {
      aiEnabled: true,
      aiProvider: 'groq',
      groqApiKey: 'gsk_mock_test_key',
      groqModel: 'openai/gpt-oss-120b'
    });

    assert.ok(groqCalled, 'Groq API must be called during crawl evaluation');
    assert.equal(capturedModel, 'openai/gpt-oss-120b');
    assert.equal(evalResult.isQualified, true);
    assert.equal(evalResult.score, 95);
    assert.equal(evalResult.businessType, 'F&B - Trà Sữa');
    assert.equal(evalResult.salesPitch, 'Chào mừng khai trương quán mới!');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

