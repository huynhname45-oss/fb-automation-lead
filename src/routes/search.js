import express from 'express';
import { z } from 'zod';
import searchEngine from '../core/search-engine.js';
import sessionManager from '../core/session-manager.js';
import { getCanonicalPostKey } from '../core/history-manager.js';
import logger from '../core/logger.js';

const router = express.Router();

const searchRequestSchema = z.object({
  keyword: z.string().min(1, 'Keyword is required'),
  maxPosts: z.number().int().positive().optional(),
  filters: z.object({
    recentPosts: z.boolean().default(true),
    datePosted: z.string().default('any'),
    excludeKeywords: z.union([z.array(z.string()), z.string()]).optional().default([]),
    requirePhoneOnly: z.boolean().optional().default(false)
  }).default({})
});

router.post('/start', async (req, res) => {
  try {
    const sessionStatus = sessionManager.getStatus();
    const hasClientCookie = !!(req.body?.cookie && typeof req.body.cookie === 'string' && req.body.cookie.trim().length > 10);
    if (sessionStatus.status !== 'active' && !hasClientCookie) {
      return res.status(401).json({
        error: 'Chưa đăng nhập Facebook! Vui lòng vào mục "Session Manager" để đăng nhập hoặc dán Cookie trước khi tìm kiếm.',
        requireLogin: true
      });
    }

    const parsed = searchRequestSchema.parse(req.body);
    const clientId = (req.body?.clientId && typeof req.body.clientId === 'string' && req.body.clientId.trim())
      ? req.body.clientId.trim()
      : 'default';

    if (hasClientCookie) parsed.filters.cookie = req.body.cookie.trim();
    if (Array.isArray(req.body.existingKeys)) parsed.filters.existingKeys = req.body.existingKeys;
    parsed.filters.isClientIsolated = clientId !== 'default';

    // Start search asynchronously so we can return response immediately
    searchEngine.search(parsed.keyword, parsed.filters, parsed.maxPosts, clientId)
      .catch(err => {
        if (err.message && (err.message.includes('Target page, context or browser has been closed') || err.message.includes('TargetClosedError') || err.message.includes('Session closed'))) {
          logger.info(`⏹ Phiên tìm kiếm client [${clientId}] kết thúc an toàn.`);
          return;
        }
        logger.error({ err, clientId }, 'Background search failed');
      });
      
    res.json({ message: 'Search started', status: searchEngine.getProgress(clientId) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});


router.get('/status', (req, res) => {
  const clientId = (req.query?.clientId && typeof req.query.clientId === 'string') ? req.query.clientId.trim() : 'default';
  res.json(searchEngine.getProgress(clientId));
});

router.get('/results', async (req, res) => {
  try {
    const clientId = (req.query?.clientId && typeof req.query.clientId === 'string') ? req.query.clientId.trim() : 'default';
    const results = searchEngine.getResults(clientId);
    return res.json({ count: results.length, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/clear-history', async (req, res) => {
  const clientId = (req.body?.clientId && typeof req.body.clientId === 'string') ? req.body.clientId.trim() : null;
  if (clientId && searchEngine.clientTasks.has(clientId)) {
    searchEngine.clientTasks.get(clientId).results = [];
  }
  searchEngine.results = [];
  res.json({ message: 'Cleared in-memory task', count: 0, results: [] });
});

router.post('/delete-selected', async (req, res) => {
  try {
    const { keys, clientId } = req.body || {};
    const keyList = Array.isArray(keys) ? keys : (keys ? [keys] : []);
    const keySet = new Set(keyList.map(k => String(k).toLowerCase().trim()));

    if (clientId && searchEngine.clientTasks.has(clientId)) {
      const task = searchEngine.clientTasks.get(clientId);
      task.results = (task.results || []).filter(post => !keySet.has(getCanonicalPostKey(post)));
    }

    if (searchEngine.results && searchEngine.results.length > 0) {
      searchEngine.results = searchEngine.results.filter(post => !keySet.has(getCanonicalPostKey(post)));
    }

    res.json({ message: 'Deleted from in-memory task', count: 0, results: [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/update-status', async (req, res) => {
  // Server is purely stateless logic worker. Status is persisted in Client IndexedDB.
  res.json({ message: 'Status updated on client' });
});

router.post('/stop', async (req, res) => {
  const clientId = (req.body?.clientId && typeof req.body.clientId === 'string') ? req.body.clientId.trim() : 'default';
  await searchEngine.stop(clientId);
  res.json({ message: 'Search stopped', status: searchEngine.getProgress(clientId) });
});

export default router;
