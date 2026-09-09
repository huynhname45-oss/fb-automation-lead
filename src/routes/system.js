import express from 'express';
import {
  checkUpdateStatus,
  executeSelfUpdate,
  getUpdateProgress,
  isSystemBusy,
  stopAllTasks
} from '../core/update-manager.js';
import logger from '../core/logger.js';

const router = express.Router();

/**
 * GET /api/system/version
 * Lấy thông tin phiên bản hiện tại, trạng thái bản cập nhật Git, trạng thái bận
 */
router.get('/version', async (req, res) => {
  try {
    const force = req.query.force === 'true';
    const status = await checkUpdateStatus(force);
    res.json(status);
  } catch (error) {
    logger.error({ err: error }, 'Lỗi khi kiểm tra phiên bản hệ thống');
    res.status(500).json({ error: error.message || 'Không thể kiểm tra phiên bản' });
  }
});

/**
 * POST /api/system/check-update
 * Ép kiểm tra bản cập nhật mới từ Git ngay lập tức
 */
router.post('/check-update', async (req, res) => {
  try {
    const status = await checkUpdateStatus(true);
    res.json(status);
  } catch (error) {
    logger.error({ err: error }, 'Lỗi khi ép kiểm tra bản mới');
    res.status(500).json({ error: error.message || 'Không thể kiểm tra cập nhật' });
  }
});

/**
 * GET /api/system/busy-status
 * Kiểm tra xem hệ thống có tác vụ nào đang chạy ngầm không
 */
router.get('/busy-status', (req, res) => {
  try {
    const busy = isSystemBusy();
    res.json(busy);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/system/stop-tasks
 * Dừng khẩn cấp toàn bộ tác vụ đang chạy
 */
router.post('/stop-tasks', async (req, res) => {
  try {
    await stopAllTasks();
    res.json({ success: true, message: 'Đã gửi lệnh dừng toàn bộ tác vụ.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/system/update-status
 * Lấy tiến độ cập nhật hiện tại
 */
router.get('/update-status', (req, res) => {
  try {
    const progress = getUpdateProgress();
    res.json(progress);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/system/update
 * Kích hoạt tự động cập nhật hệ thống từ Git
 */
router.post('/update', async (req, res) => {
  try {
    const force = req.body?.force === true;
    const port = parseInt(req.socket?.localPort, 10) || parseInt(process.env.PORT, 10) || 3001;
    
    logger.info({ force, port }, 'Nhận yêu cầu cập nhật hệ thống từ giao diện Client');
    const result = await executeSelfUpdate({ force, port });

    if (result.status === 'busy') {
      return res.status(200).json(result);
    }

    res.json(result);
  } catch (error) {
    logger.error({ err: error }, 'Yêu cầu cập nhật hệ thống thất bại');
    const statusCode = error.message.includes('đang trong quá trình cập nhật') ? 409 : 500;
    res.status(statusCode).json({ error: error.message });
  }
});

export default router;
