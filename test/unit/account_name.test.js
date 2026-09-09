import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanCandidate, extractNameFromHtml } from '../../src/core/session-manager.js';

test('ACCOUNT-NAME-001: cleanCandidate strictly rejects error pages and invalid names', () => {
  assert.equal(cleanCandidate('Lỗi'), '');
  assert.equal(cleanCandidate('Lỗi | Facebook'), '');
  assert.equal(cleanCandidate('Error'), '');
  assert.equal(cleanCandidate('Error | Facebook'), '');
  assert.equal(cleanCandidate('Trình duyệt này không hỗ trợ Facebook'), '');
  assert.equal(cleanCandidate('bạn'), '');
  assert.equal(cleanCandidate('Trang cá nhân'), '');
  assert.equal(cleanCandidate('Tài khoản (61591024160997)'), '');
  assert.equal(cleanCandidate('Đăng nhập'), '');
  assert.equal(cleanCandidate('Facebook'), '');
  assert.equal(cleanCandidate('Not Found'), '');
});

test('ACCOUNT-NAME-002: cleanCandidate accepts and normalizes legitimate human names', () => {
  assert.equal(cleanCandidate('Huỳnh Văn Nam'), 'Huỳnh Văn Nam');
  assert.equal(cleanCandidate('Đặng Diễm | Facebook'), 'Đặng Diễm');
  assert.equal(cleanCandidate('(2) Nguyễn Thị Mai | Facebook'), 'Nguyễn Thị Mai');
  assert.equal(cleanCandidate('Trần Đức Bo'), 'Trần Đức Bo');
});

test('ACCOUNT-NAME-003: extractNameFromHtml extracts from meta og:title', () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Facebook</title>
        <meta property="og:title" content="Huỳnh Văn Nam" />
      </head>
      <body></body>
    </html>
  `;
  assert.equal(extractNameFromHtml(html), 'Huỳnh Văn Nam');
});

test('ACCOUNT-NAME-004: extractNameFromHtml extracts from script CurrentUserInitialData / NAME', () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head><title>Facebook</title></head>
      <body>
        <script>
          requireLazy(["CurrentUserInitialData"], function(C) {
            C.setData({"ACCOUNT_ID":"61591024160997","NAME":"Hoàng Luận"});
          });
        </script>
      </body>
    </html>
  `;
  assert.equal(extractNameFromHtml(html), 'Hoàng Luận');
});

test('ACCOUNT-NAME-005: extractNameFromHtml does NOT extract "Lỗi" from mbasic or error page titles', () => {
  const errorHtml = `
    <?xml version="1.0" encoding="utf-8"?>
    <!DOCTYPE html PUBLIC "-//WAPFORUM//DTD XHTML Mobile 1.0//EN">
    <html>
      <head><title>Lỗi</title></head>
      <body><h1>Trình duyệt này không hỗ trợ Facebook</h1></body>
    </html>
  `;
  assert.equal(extractNameFromHtml(errorHtml), '');
});

test('ACCOUNT-NAME-006: cleanCandidate decodes HTML entities into Unicode text', () => {
  assert.equal(cleanCandidate('Tr&#x1ea7;n Hu&#x1ef3;nh'), 'Trần Huỳnh');
  assert.equal(cleanCandidate('&#272;&#7863;ng Di&#7877;m'), 'Đặng Diễm');
  assert.equal(cleanCandidate('Nguy&#7877;n V&#259;n A &amp; B'), 'Nguyễn Văn A & B');
});

