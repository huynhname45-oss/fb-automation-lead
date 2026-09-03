import express from 'express';
import { z } from 'zod';
import searchEngine from '../core/search-engine.js';
import sessionManager from '../core/session-manager.js';
import historyManager from '../core/history-manager.js';
import logger from '../core/logger.js';

const router = express.Router();

const searchRequestSchema = z.object({
  keyword: z.string().min(1, 'Keyword is required'),
  maxPosts: z.number().int().positive().optional(),
  filters: z.object({
    recentPosts: z.boolean().default(false),
    datePosted: z.string().default('any'),
    excludeKeywords: z.union([z.array(z.string()), z.string()]).optional().default([]),
    requirePhoneOnly: z.boolean().optional().default(false)
  }).default({})
});

router.post('/start', async (req, res) => {
  try {
    const sessionStatus = sessionManager.getStatus();
    if (sessionStatus.status !== 'active') {
      return res.status(401).json({
        error: 'Chưa đăng nhập Facebook! Vui lòng vào mục "Session Manager" để đăng nhập hoặc dán Cookie trước khi tìm kiếm.',
        requireLogin: true
      });
    }

    const parsed = searchRequestSchema.parse(req.body);
    
    // Start search asynchronously so we can return response immediately
    searchEngine.search(parsed.keyword, parsed.filters, parsed.maxPosts)
      .catch(err => logger.error({ err }, 'Background search failed'));
      
    res.json({ message: 'Search started', status: searchEngine.getProgress() });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});


router.get('/status', (req, res) => {
  res.json(searchEngine.getProgress());
});

router.get('/results', async (req, res) => {
  try {
    const history = await historyManager.getHistory();

    // During active search, merge live results (in-RAM) with persisted history
    // so newly found posts appear immediately in the UI table
    if (searchEngine.status === 'searching' && searchEngine.results.length > 0) {
      const { getCanonicalPostKey } = await import('../core/history-manager.js');
      const existingKeys = new Set(history.map(getCanonicalPostKey));
      const liveResults = [];

      for (const post of searchEngine.results) {
        const key = getCanonicalPostKey(post);
        if (!existingKeys.has(key)) {
          existingKeys.add(key);
          liveResults.push({
            ...post,
            status: post.status || 'Mới tạo',
            createdAt: post.createdAt || new Date().toISOString(),
            _live: true  // Mark as live (not yet persisted)
          });
        }
      }

      const merged = [...liveResults, ...history];
      return res.json({ count: merged.length, results: merged });
    }

    res.json({ 
      count: history.length,
      results: history 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/clear-history', async (req, res) => {
  await historyManager.clearHistory();
  searchEngine.results = [];
  res.json({ message: 'History cleared', count: 0, results: [] });
});

router.post('/delete-selected', async (req, res) => {
  try {
    const { keys } = req.body || {};
    const keyList = Array.isArray(keys) ? keys : (keys ? [keys] : []);
    const keySet = new Set(keyList.map(k => String(k).toLowerCase().trim()));

    // Filter in-memory searchEngine results
    if (searchEngine.results && searchEngine.results.length > 0) {
      searchEngine.results = searchEngine.results.filter(post => {
        const k = getCanonicalPostKey(post);
        return !keySet.has(k);
      });
    }

    const updatedHistory = await historyManager.deletePostsByKeys(keyList);
    res.json({ message: 'Deleted selected items from history', count: updatedHistory.length, results: updatedHistory });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/update-status', async (req, res) => {
  try {
    const { key, status } = req.body || {};
    if (!key || !status) {
      return res.status(400).json({ error: 'Missing key or status parameter' });
    }
    const updatedHistory = await historyManager.updatePostStatus(key, status);
    res.json({ message: 'Status updated', results: updatedHistory });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/stop', async (req, res) => {
  // Save any results found so far before stopping
  if (searchEngine.results.length > 0) {
    try {
      const { processResults } = await import('../core/data-processor.js');
      const processed = processResults(searchEngine.results);
      await historyManager.addPosts(processed);
    } catch (e) {
      logger.warn({ err: e.message }, 'Failed to save results on stop');
    }
  }
  await searchEngine.stop();
  res.json({ message: 'Search stopped', status: searchEngine.getProgress() });
});

export default router;
