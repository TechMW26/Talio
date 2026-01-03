/**
 * Logger v4.0.0
 * Simple file-based logging for Talio Desktop
 */

const fs = require('fs');
const path = require('path');

let logDir = null;
let logFile = null;
let initialized = false;

/**
 * Get app data path
 */
function getAppDataPath() {
  const { app } = require('electron');
  return app.getPath('userData');
}

/**
 * Initialize logger
 */
function init() {
  if (initialized) return;
  
  try {
    logDir = path.join(getAppDataPath(), 'logs');
    
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    const date = new Date().toISOString().split('T')[0];
    logFile = path.join(logDir, `talio-${date}.log`);
    
    initialized = true;
    
    log('info', 'Logger', '═'.repeat(60));
    log('info', 'Logger', 'Talio Desktop v4.0.0 - Logger initialized');
    log('info', 'Logger', `Platform: ${process.platform} | Arch: ${process.arch}`);
    log('info', 'Logger', `Log file: ${logFile}`);
    log('info', 'Logger', '═'.repeat(60));
    
  } catch (error) {
    console.error('Logger init failed:', error);
  }
}

/**
 * Write log entry
 */
function log(level, category, message) {
  if (!initialized) {
    try {
      init();
    } catch {
      console.log(`[${level.toUpperCase()}] [${category}] ${message}`);
      return;
    }
  }
  
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] [${level.toUpperCase().padEnd(5)}] [${category.padEnd(15)}] ${message}`;
  
  // Console output with colors
  const colors = {
    debug: '\x1b[90m',
    info: '\x1b[36m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
    reset: '\x1b[0m'
  };
  
  const color = colors[level] || colors.info;
  console.log(`${color}${logEntry}${colors.reset}`);
  
  // File output
  try {
    fs.appendFileSync(logFile, logEntry + '\n');
  } catch (error) {
    // Silently fail file logging
  }
}

/**
 * Get log directory path
 */
function getLogPath() {
  if (!initialized) init();
  return logDir || '';
}

/**
 * Get recent logs
 */
function getRecentLogs(lines = 100) {
  if (!logFile || !fs.existsSync(logFile)) {
    return 'No logs available';
  }
  
  try {
    const content = fs.readFileSync(logFile, 'utf8');
    const allLines = content.split('\n');
    return allLines.slice(-lines).join('\n');
  } catch {
    return 'Failed to read logs';
  }
}

/**
 * Clear old logs (keep last 7 days)
 */
function cleanOldLogs() {
  if (!logDir || !fs.existsSync(logDir)) return;
  
  try {
    const files = fs.readdirSync(logDir);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 7);
    
    files.forEach(file => {
      const match = file.match(/talio-(\d{4}-\d{2}-\d{2})\.log/);
      if (match) {
        const fileDate = new Date(match[1]);
        if (fileDate < cutoffDate) {
          fs.unlinkSync(path.join(logDir, file));
          log('info', 'Logger', `Cleaned old log: ${file}`);
        }
      }
    });
  } catch (error) {
    log('warn', 'Logger', `Failed to clean old logs: ${error.message}`);
  }
}

module.exports = {
  log,
  getLogPath,
  getRecentLogs,
  cleanOldLogs,
  init
};
