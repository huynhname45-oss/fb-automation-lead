import test from 'node:test';
import assert from 'node:assert/strict';
import configManager from '../../src/core/config-manager.js';
import aiLeadEvaluator from '../../src/core/ai-lead-evaluator.js';
import ocrManager from '../../src/core/ocr-manager.js';

test('Groq Provider Config: supports groq provider, model and apiKey in default config', () => {
  const cfg = configManager.get();
  assert.equal(cfg.aiProvider, 'groq');
  assert.equal(cfg.groqModel, 'llama-3.3-70b-versatile');
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
    const result = await aiLeadEvaluator._callGroqAPI('gsk_test_key_12345', 'Kiểm tra quán mới khai trương');
    
    assert.equal(interceptedUrl, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(interceptedHeaders['Authorization'], 'Bearer gsk_test_key_12345');
    assert.equal(interceptedBody.model, 'llama-3.3-70b-versatile');
    assert.equal(interceptedBody.response_format?.type, 'json_object');
    
    assert.equal(result.score, 92);
    assert.equal(result.businessType, 'F&B - Quán Ăn');
    assert.ok(result.salesPitch.includes('Sapo'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Groq Lead Evaluator: evaluateWithCustomPrompt dispatches to Groq when provider is groq', async () => {
  const originalFetch = globalThis.fetch;
  let interceptedModel = '';

  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    interceptedModel = body.model;

    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                score: 88,
                businessType: 'Trà Sữa',
                reason: 'Khai trương quán trà sữa',
                salesPitch: 'Chào quán mới khai trương'
              })
            }
          }
        ]
      })
    };
  };

  try {
    const post = {
      authorName: 'Trà Sữa Nhà Làm',
      content: 'Mai em chính thức khai trương quán trà sữa, mời cả nhà ghé ủng hộ!',
      phones: ['0901234567']
    };

    const res = await aiLeadEvaluator.evaluateWithCustomPrompt(post, 'gsk_sample_key', 'groq', 'Ngữ cảnh thẩm định');
    assert.equal(interceptedModel, 'llama-3.3-70b-versatile');
    assert.equal(res.score, 88);
    assert.equal(res.businessType, 'Trà Sữa');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Groq Vision OCR: _extractPhonesWithGroqVision extracts phone numbers from image data', async () => {
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
    assert.equal(capturedModel, 'llama-3.2-11b-vision-preview');
    assert.ok(phones.some(p => p.includes('0796666428') || p.includes('079.6666.428')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
