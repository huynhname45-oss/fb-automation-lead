import test from 'node:test';
import assert from 'node:assert/strict';
import aiLeadEvaluator from '../../src/core/ai-lead-evaluator.js';

test('Gemini Model Discovery & Ranking: Correctly ranks newest and most powerful models', () => {
  const models = [
    'gemini-1.0-pro',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
    'gemini-2.0-flash-exp',
    'gemini-2.0-flash',
    'gemini-2.5-flash'
  ];

  const sorted = [...models].sort((a, b) => aiLeadEvaluator._scoreGeminiModel(b) - aiLeadEvaluator._scoreGeminiModel(a));

  // Top model must be gemini-2.5-flash or gemini-2.0-flash
  assert.equal(sorted[0], 'gemini-2.5-flash', 'gemini-2.5-flash should be top-ranked');
  assert.equal(sorted[1], 'gemini-2.0-flash', 'gemini-2.0-flash should be second');
  assert.ok(sorted.indexOf('gemini-2.0-flash') < sorted.indexOf('gemini-1.5-flash'), '2.0 should rank higher than 1.5');
  assert.ok(sorted.indexOf('gemini-1.5-flash') < sorted.indexOf('gemini-1.0-pro'), '1.5 should rank higher than 1.0');
});

test('Gemini Model Discovery: Rejects empty or invalid API key gracefully', async () => {
  await assert.rejects(
    async () => {
      await aiLeadEvaluator.discoverAndVerifyGeminiModels('');
    },
    /Vui lòng cung cấp Google Gemini API Key/
  );
});
