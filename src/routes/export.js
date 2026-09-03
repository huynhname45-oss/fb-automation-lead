import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { exportToExcel } from '../core/excel-exporter.js';
import searchEngine from '../core/search-engine.js';
import logger from '../core/logger.js';
import fs from 'fs/promises';

import historyManager from '../core/history-manager.js';

const EXPORTS_DIR = path.join(process.cwd(), 'exports');

const router = express.Router();

router.post('/excel', async (req, res) => {
  try {
    const sourcePosts = (Array.isArray(req.body?.results) && req.body.results.length > 0)
      ? req.body.results
      : (searchEngine.results && searchEngine.results.length > 0 ? searchEngine.results : await historyManager.getHistory());
    const includeReview = req.body?.includeReview === true;
    const posts = sourcePosts.filter(post =>
      post?.decision !== 'REJECTED' &&
      (includeReview || (post?.decision !== 'REVIEW' && post?.status !== 'Cần kiểm tra'))
    );

    if (!posts || posts.length === 0) {
      return res.status(400).json({ error: 'Không có lead đã duyệt để xuất Excel' });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `fb_leads_import_${timestamp}.xlsx`;
    
    await exportToExcel(posts, filename, req.body?.exportConfig || {});
    
    res.json({ 
      message: 'Export successful', 
      filename,
      downloadUrl: `/api/export/download/${filename}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/download/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    // Basic security to prevent directory traversal
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      return res.status(400).send('Invalid filename');
    }
    
    const filePath = path.join(EXPORTS_DIR, filename);
    
    // Check if file exists
    try {
      await fs.access(filePath);
    } catch (e) {
      return res.status(404).send('File not found');
    }
    
    res.download(filePath, filename, (err) => {
      if (err) {
        logger.error({ err }, 'Error downloading file');
        if (!res.headersSent) {
          res.status(500).send('Error downloading file');
        }
      }
    });
  } catch (error) {
    res.status(500).send(error.message);
  }
});

export default router;
