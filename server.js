import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import logger from './src/core/logger.js';
import browserManager from './src/core/browser-manager.js';

// Routes
import sessionRoutes from './src/routes/session.js';
import searchRoutes from './src/routes/search.js';
import exportRoutes from './src/routes/export.js';
import configRoutes from './src/routes/config.js';
import groupsRoutes from './src/routes/groups.js';
import membersRoutes from './src/routes/members.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Create required directories
const requiredDirs = ['session', 'exports', 'logs', 'public'].map(dir => path.join(__dirname, dir));

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
        const { exec } = await import('child_process');
        const startCmd = process.platform === 'win32' ? `start http://localhost:${p}` : `open http://localhost:${p}`;
        exec(startCmd);
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

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start
startServer().catch(err => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});
