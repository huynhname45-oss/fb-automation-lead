import express from 'express';
import GroupManager from '../core/group-manager.js';
import sessionManager, { parseCookieInput } from '../core/session-manager.js';
import logger from '../core/logger.js';

const router = express.Router();

/**
 * POST /api/groups/fetch
 * Fetches all Facebook groups joined by user via Graph API, Cookie, or Playwright
 */
router.post('/fetch', async (req, res) => {
  try {
    const { token, cookie, method = 'auto', clientId = 'default' } = req.body || {};

    let effectiveCookie = cookie;
    if (!effectiveCookie && clientId && sessionManager.clientSessions?.has(clientId)) {
      effectiveCookie = sessionManager.clientSessions.get(clientId)?.cookie || '';
    }

    logger.info({ method, hasToken: !!token, hasCookie: !!effectiveCookie, clientId }, '[GROUPS ROUTE] Bắt đầu tải danh sách nhóm...');

    const groups = await GroupManager.fetchAllGroups({
      token: token || '',
      cookie: effectiveCookie || '',
      method,
      clientId
    });

    res.json({
      success: true,
      count: groups.length,
      groups
    });
  } catch (err) {
    logger.error({ err: err.message }, '[GROUPS ROUTE] Lỗi khi tải danh sách nhóm');
    res.status(500).json({
      success: false,
      error: err.message || 'Lỗi không xác định khi tải danh sách nhóm Facebook'
    });
  }
});

/**
 * POST /api/groups/export
 * Exports provided groups list to a styled Excel (.xlsx) file
 */
router.post('/export', async (req, res) => {
  try {
    const { groups = [] } = req.body || {};
    if (!Array.isArray(groups) || groups.length === 0) {
      return res.status(400).json({ error: 'Không có nhóm nào trong danh sách để xuất Excel' });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `fb_joined_groups_${timestamp}.xlsx`;

    const buffer = await GroupManager.exportToExcelBuffer(groups);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('X-Filename', filename);
    res.send(Buffer.from(buffer));
  } catch (err) {
    logger.error({ err: err.message }, '[GROUPS ROUTE] Lỗi khi xuất Excel danh sách nhóm');
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/groups/resolve-slugs
 * Resolves an array of group slugs to numeric IDs
 */
router.post('/resolve-slugs', async (req, res) => {
  try {
    const { slugs = [], cookie = '', clientId = 'default' } = req.body || {};
    let effectiveCookie = cookie;
    if (!effectiveCookie && clientId && sessionManager.clientSessions?.has(clientId)) {
      effectiveCookie = sessionManager.clientSessions.get(clientId)?.cookie || '';
    }

    const cookieHeader = effectiveCookie ? (Array.isArray(effectiveCookie) ? effectiveCookie : parseCookieInput(effectiveCookie)).map(c => `${c.name}=${c.value}`).join('; ') : '';

    const results = {};
    for (const slug of slugs) {
      if (/^\d+$/.test(slug)) {
        results[slug] = slug;
      } else {
        const numId = await GroupManager.resolveNumericGroupId(slug, cookieHeader);
        results[slug] = numId || slug;
      }
    }

    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
