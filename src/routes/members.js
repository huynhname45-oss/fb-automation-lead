import express from 'express';
import memberScanner, { MemberScanner } from '../core/member-scanner.js';
import sessionManager, { parseCookieInput } from '../core/session-manager.js';
import logger from '../core/logger.js';

const router = express.Router();

/**
 * POST /api/members/scan
 * Start background group members scan
 */
router.post('/scan', async (req, res) => {
  try {
    const {
      groupUrls = [],
      filters = {},
      excludeSales,
      deepPhoneSearch,
      maxMembersPerGroup,
      cookie = '',
      clientId = 'default'
    } = req.body || {};

    const effectiveFilters = {
      excludeSales: excludeSales !== undefined ? excludeSales : (filters.excludeSales !== undefined ? filters.excludeSales : true),
      deepPhoneSearch: deepPhoneSearch !== undefined ? deepPhoneSearch : (filters.deepPhoneSearch !== undefined ? filters.deepPhoneSearch : true),
      maxMembersPerGroup: maxMembersPerGroup || filters.maxMembersPerGroup || 60,
      ...filters
    };

    if (!Array.isArray(groupUrls) || groupUrls.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Vui lòng chọn hoặc nhập ít nhất 1 đường link hoặc ID nhóm Facebook để quét!'
      });
    }

    // Check session or cookie
    let effectiveCookie = cookie;
    if (!effectiveCookie && clientId && sessionManager.clientSessions?.has(clientId)) {
      effectiveCookie = sessionManager.clientSessions.get(clientId)?.cookie || '';
    }

    const currentProgress = memberScanner.getProgress(clientId);
    if (currentProgress.isScanning) {
      return res.status(400).json({
        success: false,
        error: 'Một tiến trình quét thành viên đang chạy cho thiết bị này. Vui lòng dừng hoặc chờ quét xong!'
      });
    }

    logger.info({ groupsCount: groupUrls.length, clientId }, 'Bắt đầu quét thành viên mới trong nhóm');

    // Run asynchronously
    memberScanner.scanGroups({
      groupUrlsOrIds: groupUrls,
      clientId,
      cookie: effectiveCookie,
      filters: effectiveFilters
    }).catch(err => {
      logger.error({ err: err.message, clientId }, 'Lỗi tiến trình scanGroups');
    });

    res.json({
      success: true,
      message: 'Đã khởi động tiến trình quét thành viên nhóm mới!',
      status: memberScanner.getProgress(clientId)
    });

  } catch (err) {
    logger.error({ err: err.message }, 'Lỗi router /api/members/scan');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/members/status
 * Get real-time scan progress and qualified leads
 */
router.get('/status', (req, res) => {
  try {
    const clientId = (req.query?.clientId && typeof req.query.clientId === 'string')
      ? req.query.clientId.trim()
      : 'default';

    res.json(memberScanner.getProgress(clientId));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/members/stop
 * Stop currently running member scan
 */
router.post('/stop', (req, res) => {
  try {
    const { clientId = 'default' } = req.body || {};
    const result = memberScanner.stopScan(clientId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/members/export
 * Export qualified leads to styled Excel (.xlsx) file
 */
router.post('/export', async (req, res) => {
  try {
    const { leads = [] } = req.body || {};
    if (!Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ error: 'Không có dữ liệu thành viên nào để xuất Excel.' });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `thanh_vien_moi_tiem_nang_${timestamp}.xlsx`;

    const buffer = await MemberScanner.exportToExcelBuffer(leads);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('X-Filename', filename);
    res.send(Buffer.from(buffer));
  } catch (err) {
    logger.error({ err: err.message }, 'Lỗi xuất Excel thành viên nhóm');
    res.status(500).json({ error: err.message });
  }
});

export default router;
