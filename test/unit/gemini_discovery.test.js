import test from 'node:test';
import assert from 'node:assert/strict';
import aiLeadEvaluator from '../../src/core/ai-lead-evaluator.js';

test('Gemini Model Discovery & Ranking: Correctly ranks newest and most powerful models (Gemini 3.6 Flash priority)', () => {
  const models = [
    'gemini-1.0-pro',
    'gemini-1.5-flash',
    'gemini-2.5-flash',
    'gemini-2.5-flash-preview-image',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.6-flash',
    'gemini-3.7-flash',
    'gemini-3.1-flash-tts-preview'
  ];

  // Preview-image and TTS must be excluded (negative score)
  assert.ok(aiLeadEvaluator._scoreGeminiModel('gemini-2.5-flash-preview-image') < 0, 'Media image model must be excluded');
  assert.ok(aiLeadEvaluator._scoreGeminiModel('gemini-3.1-flash-tts-preview') < 0, 'TTS model must be excluded');

  const valid = models.filter(m => aiLeadEvaluator._scoreGeminiModel(m) > 0);
  const sorted = [...valid].sort((a, b) => aiLeadEvaluator._scoreGeminiModel(b) - aiLeadEvaluator._scoreGeminiModel(a));

  // Top speed models must be gemini-3.5-flash-lite and gemini-3.6-flash
  assert.equal(sorted[0], 'gemini-3.5-flash-lite', 'gemini-3.5-flash-lite should be top-ranked for speed');
  assert.equal(sorted[1], 'gemini-3.6-flash', 'gemini-3.6-flash should be second');
  assert.ok(sorted.indexOf('gemini-3.6-flash') < sorted.indexOf('gemini-3.5-flash'));
  assert.ok(sorted.indexOf('gemini-3.5-flash') < sorted.indexOf('gemini-2.5-flash'));
  assert.ok(sorted.indexOf('gemini-2.5-flash') < sorted.indexOf('gemini-1.5-flash'));
});

test('Gemini Model Discovery: Rejects empty or invalid API key gracefully', async () => {
  await assert.rejects(
    async () => {
      await aiLeadEvaluator.discoverAndVerifyGeminiModels('');
    },
    /Vui lòng cung cấp Google Gemini API Key/
  );
});
