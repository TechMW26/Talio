/**
 * Debug Logger v3.0.0
 * Simple file-based logging for debugging
 */

const fs = require('fs');
const path = require('path');

// Get app data path
function getAppDataPath() {
  const { app } = require('electron');
  return app.getPath('userData');
}

// Log directory and file
let logDir = null;
let logFile = null;
let initialized = false;

/**
 * Initialize logger
 */
function init() {
  if (initialized) return;
  
  try {
    logDir = path.join(getAppDataPath(), 'logs');
    
    // Create logs directory
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    // Create log file with date
    const date = new Date().toISOString().split('T')[0];
    logFile = path.join(logDir, `talio-${date}.log`);
    
    initialized = true;
    
    // Log startup
    log('info', 'Logger', '='.repeat(50));
    log('info', 'Logger', `Talio Desktop v3.0.0 started`);
    log('info', 'Logger', `Platform: ${process.platform}`);
    log('info', 'Logger', `Log file: ${logFile}`);
    log('info', 'Logger', '='.repeat(50));
    
  } catch (error) {
    console.error('Failed to initialize logger:', error);
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
      // Fall back to console only
      console.log(`[${level.toUpperCase()}] [${category}] ${message}`);
      return;
    }
  }
  
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] [${level.toUpperCase()}] [${category}] ${message}`;
  
  // Console output
  console.log(logEntry);
  
  // File output
  try {
    fs.appendFileSync(logFile, logEntry + '\n');
  } catch (error) {
    console.error('Failed to write log:', error);
  }
}

/**
 * Get log file path
 */
function getLogPath() {
  if (!initialized) {
    init();
  }
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
  } catch (error) {
    return `Error reading logs: ${error.message}`;
  }
}

// Export simple API
module.exports = {
  log,
  getLogPath,
  getRecentLogs,
  init
};
