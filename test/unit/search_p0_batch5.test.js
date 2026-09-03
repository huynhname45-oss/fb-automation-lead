import test from 'node:test';
import assert from 'node:assert/strict';

import { 
  createPhoneEvidence, 
  mergePhoneEvidence 
} from '../../src/core/phone-validator.js';

// =========================================================================
// SEARCH-P0-005 Tests: Phone Provenance Preservation (PhoneEvidence)
// =========================================================================
test('SEARCH-P0-005: createPhoneEvidence builds complete provenance object with classification', () => {
  const ev = createPhoneEvidence({
    phone: '0912345678',
    rawSnippet: 'Liên hệ hotline: 0912345678',
    source: 'post_text',
    confidence: 0.95,
    verified: true,
    authorMatched: true
  });

  assert.equal(ev.phone, '0912345678');
  assert.equal(ev.source, 'post_text');
  assert.equal(ev.confidence, 0.95);
  assert.equal(ev.type, 'mobile');
  assert.equal(ev.verified, true);
  assert.ok(ev.rawSnippet.includes('0912345678'));
});

test('SEARCH-P0-005: mergePhoneEvidence preserves sources from text, OCR, and profile without dropping metadata', () => {
  let evidenceList = [];

  // Step 1: Found in text
  evidenceList = mergePhoneEvidence(evidenceList, ['0912345678'], 'post_text', 0.95, 'SĐT 0912345678', {
    verified: true,
    authorMatched: true
  });
  assert.equal(evidenceList.length, 1);
  assert.equal(evidenceList[0].phone, '0912345678');
  assert.equal(evidenceList[0].source, 'post_text');

  // Step 2: Found OCR phone on image
  evidenceList = mergePhoneEvidence(evidenceList, ['0988776655'], 'image_ocr', 0.85, 'OCR từ ảnh banner', {
    verified: false,
    authorMatched: true
  });
  assert.equal(evidenceList.length, 2);
  assert.equal(evidenceList[1].phone, '0988776655');
  assert.equal(evidenceList[1].source, 'image_ocr');
  assert.equal(evidenceList[1].confidence, 0.85);

  // Step 3: Re-discovery of existing phone from profile with lower confidence does not overwrite higher confidence
  evidenceList = mergePhoneEvidence(evidenceList, ['0912345678'], 'profile_bio', 0.7, 'Profile bio', {
    verified: false,
    authorMatched: true
  });
  assert.equal(evidenceList.length, 2);
  // Must still retain post_text with confidence 0.95
  const postPhone = evidenceList.find(e => e.phone === '0912345678');
  assert.equal(postPhone.source, 'post_text');
  assert.equal(postPhone.confidence, 0.95);
  assert.deepEqual(new Set(postPhone.sources), new Set(['post_text', 'profile_bio']));
  assert.equal(postPhone.evidence.length, 2);
});

test('SEARCH-P0-005: low-confidence OCR is not presented as a verified owner phone', () => {
  const [ocrPhone] = mergePhoneEvidence([], ['0912345678'], 'image_ocr', 0.1, 'Mờ trên ảnh', {
    verified: true,
    authorMatched: true
  });

  assert.equal(ocrPhone.verified, false);
});
