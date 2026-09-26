import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { exec } from 'child_process';
import logger from './src/core/logger.js';
import browserManager from './src/core/browser-manager.js';

// Routes
import sessionRoutes from './src/routes/session.js';
import searchRoutes from './src/routes/search.js';
import exportRoutes from './src/routes/export.js';
import configRoutes from './src/routes/config.js';
import groupsRoutes from './src/routes/groups.js';
import membersRoutes from './src/routes/members.js';
import systemRoutes from './src/routes/system.js';

import fsSync from 'fs';

const currentFilename = typeof __filename !== 'undefined' ? __filename : (typeof import.meta !== 'undefined' && import.meta.url ? fileURLToPath(import.meta.url) : '');
const currentDirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(currentFilename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static public directory (bundled inside pkg or local in dev)
const candidatePublicDirs = [
  path.join(currentDirname, 'public'),
  path.join(currentDirname, '..', 'public'),
  path.join(process.cwd(), 'public')
];
const publicDir = candidatePublicDirs.find(d => {
  try { return fsSync.existsSync(path.join(d, 'index.html')); } catch (_) { return false; }
}) || path.join(process.cwd(), 'public');

app.use(express.static(publicDir));

// Fallback serve index.html for root or client routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  const indexPath = path.join(publicDir, 'index.html');
  if (fsSync.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  next();
});

// Create required runtime data directories in user's working directory
const requiredDirs = ['session', 'exports', 'logs', 'data'].map(dir => path.join(process.cwd(), dir));

async function initDirs() {
  for (const dir of requiredDirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (err) {
      logger.error({ err }, `Failed to create directory: ${dir}`);
    }
  }
}

// API Routes
app.use('/api/session', sessionRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/config', configRoutes);
app.use('/api/groups', groupsRoutes);
app.use('/api/members', membersRoutes);
app.use('/api/system', systemRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

// Server Initialization
let server;
async function startServer() {
  await initDirs();
  
  let currentPort = PORT;
  
  function tryListen(p) {
    server = app.listen(p, async () => {
      logger.info(`Server is running on port ${p}`);
      console.log(`\n==================================================`);
      console.log(`🚀 RỜI BÀN PHÍM & BẮT ĐẦU SỬ DỤNG TOOL TẠI:`);
      console.log(`👉 http://localhost:${p}`);
      console.log(`==================================================\n`);
      
      try {
        const startCmd = process.platform === 'win32' ? `start http://localhost:${p}` : `open http://localhost:${p}`;
        exec(startCmd, () => {});
      } catch (e) {}
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.warn(`Port ${p} is in use. Trying port ${p + 1}...`);
        tryListen(p + 1);
      } else {
        logger.error({ err }, 'Server listen error');
      }
    });
  }

  tryListen(currentPort);
}

// Graceful Shutdown
async function shutdown() {
  logger.info('Shutting down gracefully...');
  
  try {
    await browserManager.closeBrowser();
  } catch (err) {
    logger.error({ err }, 'Error closing browser during shutdown');
  }

  if (server) {
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
    
    // Force close after 5s
    setTimeout(() => {
      logger.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 5000);
  } else {
    process.exit(0);
  }
}

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'FATAL UNCAUGHT EXCEPTION');
});

process.on('unhandledRejection', (reason) => {
  logger.warn({ err: reason, reason: reason instanceof Error ? reason.stack : reason }, 'UNHANDLED PROMISE REJECTION');
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM');
  shutdown();
});
process.on('SIGINT', () => {
  logger.info('Received SIGINT');
  shutdown();
});

// Start
startServer().catch(err => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});
