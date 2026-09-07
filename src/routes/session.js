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
    const { cookie, clientId } = req.body || {};
    if (!cookie || typeof cookie !== 'string') {
      return res.status(400).json({ error: 'Vui lòng dán chuỗi Cookie hợp lệ!' });
    }
    const result = await sessionManager.loginWithCookie(cookie, clientId || 'default');
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/status', (req, res) => {
  try {
    const clientId = (req.query?.clientId && typeof req.query.clientId === 'string') ? req.query.clientId.trim() : 'default';
    const status = sessionManager.getStatus(clientId);
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/verify', async (req, res) => {
  try {
    const { cookie, clientId } = req.body || {};
    const result = await sessionManager.checkSession(cookie, clientId || 'default');
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const { clientId } = req.body || {};
    const result = await sessionManager.logout(clientId || 'default');
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
