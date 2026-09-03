import pino from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logDir = path.join(__dirname, '../../../logs');

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const transport = process.env.NODE_ENV !== 'production'
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname'
      }
    }
  : {
      target: 'pino/file',
      options: { destination: path.join(logDir, 'app.log') }
    };

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
}, pino.transport(transport));

export default logger;
