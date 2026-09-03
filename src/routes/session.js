import express from 'express';
import sessionManager from '../core/session-manager.js';

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const result = await sessionManager.startLoginProcess();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/login-cookie', async (req, res) => {
  try {
    const { cookie } = req.body || {};
    if (!cookie || typeof cookie !== 'string') {
      return res.status(400).json({ error: 'Vui lòng dán chuỗi Cookie hợp lệ!' });
    }
    const result = await sessionManager.loginWithCookie(cookie);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/status', (req, res) => {
  try {
    const status = sessionManager.getStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/verify', async (req, res) => {
  try {
    const result = await sessionManager.checkSession();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/logout', async (req, res) => {
  try {
    await sessionManager.logout();
    res.json({ message: 'Đã đóng trình duyệt và xóa session' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
