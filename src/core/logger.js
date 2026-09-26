import pino from 'pino';
import path from 'path';
import fs from 'fs';

const logDir = path.join(process.cwd(), 'logs');

try {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
} catch (e) {}

const isPkg = typeof process.pkg !== 'undefined';
let logger;

if (isPkg || process.env.NODE_ENV === 'production') {
  try {
    const logFile = path.join(logDir, 'app.log');
    const fileStream = fs.createWriteStream(logFile, { flags: 'a' });
    const multistream = pino.multistream([
      { stream: process.stdout },
      { stream: fileStream }
    ]);
    logger = pino({
      level: process.env.LOG_LEVEL || 'info',
      timestamp: pino.stdTimeFunctions.isoTime
    }, multistream);
  } catch (e) {
    logger = pino({ level: process.env.LOG_LEVEL || 'info' });
  }
} else {
  try {
    const transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname'
      }
    };
    logger = pino({
      level: process.env.LOG_LEVEL || 'info',
    }, pino.transport(transport));
  } catch (err) {
    logger = pino({ level: process.env.LOG_LEVEL || 'info' });
  }
}

export default logger;
