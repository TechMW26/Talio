/**
 * Logger v5.1.0
 * Async buffered file logging for Talio Desktop
 * - Non-blocking: writes are queued and flushed in batches
 * - Log rotation: files capped at 5 MB, max 3 per day
 * - Production filtering: debug logs suppressed in packaged builds
 */

const fs = require('fs');
const path = require('path');

let logDir = null;
let logFile = null;
let initialized = false;
let isPackaged = false;

// Async write buffer
const LOG_BUFFER = [];
const FLUSH_INTERVAL_MS = 1000; // Flush every 1 second
const MAX_BUFFER_SIZE = 50;     // Or when 50 entries accumulate
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB per file
let flushTimer = null;
let isFlushing = false;
let writeStream = null;

/**
 * Get app data path
 */
function getAppDataPath() {
  const { app } = require('electron');
  isPackaged = app.isPackaged;
  return app.getPath('userData');
}

/**
 * Open (or reopen) the write stream for the current log file
 */
function openWriteStream() {
  if (writeStream) {
    try { writeStream.end(); } catch (e) { /* ignore */ }
  }
  writeStream = fs.createWriteStream(logFile, { flags: 'a' });
  writeStream.on('error', function () { /* ignore write errors */ });
}

/**
 * Rotate log file if it exceeds MAX_LOG_SIZE
 */
function rotateIfNeeded() {
  try {
    if (!logFile || !fs.existsSync(logFile)) return;
    var stats = fs.statSync(logFile);
    if (stats.size < MAX_LOG_SIZE) return;

    var date = new Date().toISOString().split('T')[0];
    // Find next available rotation index
    for (var i = 1; i <= 3; i++) {
      var rotated = path.join(logDir, 'talio-' + date + '.' + i + '.log');
      if (!fs.existsSync(rotated)) {
        if (writeStream) { try { writeStream.end(); } catch (e) { /* ignore */ } }
        fs.renameSync(logFile, rotated);
        openWriteStream();
        return;
      }
    }
    // All slots used — truncate current file
    if (writeStream) { try { writeStream.end(); } catch (e) { /* ignore */ } }
    fs.writeFileSync(logFile, '');
    openWriteStream();
  } catch (e) {
    // Silently fail rotation
  }
}

/**
 * Flush buffered log entries to disk asynchronously
 */
function flushBuffer() {
  if (isFlushing || LOG_BUFFER.length === 0 || !writeStream) return;
  isFlushing = true;

  var batch = LOG_BUFFER.splice(0, LOG_BUFFER.length);
  var chunk = batch.join('\n') + '\n';

  writeStream.write(chunk, function () {
    isFlushing = false;
    // Check rotation after write
    rotateIfNeeded();
    // If more entries accumulated during write, flush again
    if (LOG_BUFFER.length >= MAX_BUFFER_SIZE) {
      flushBuffer();
    }
  });
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
    
    var date = new Date().toISOString().split('T')[0];
    logFile = path.join(logDir, 'talio-' + date + '.log');
    
    openWriteStream();

    // Start periodic flush timer
    flushTimer = setInterval(flushBuffer, FLUSH_INTERVAL_MS);
    // Don't let the timer prevent Node from exiting
    if (flushTimer.unref) flushTimer.unref();

    initialized = true;
    
    log('info', 'Logger', '\u2550'.repeat(60));
    log('info', 'Logger', 'Talio Desktop v5.1.0 - Async logger initialized');
    log('info', 'Logger', 'Platform: ' + process.platform + ' | Arch: ' + process.arch);
    log('info', 'Logger', 'Log file: ' + logFile);
    log('info', 'Logger', '\u2550'.repeat(60));
    
  } catch (error) {
    console.error('Logger init failed:', error);
  }
}

/**
 * Write log entry (non-blocking)
 */
function log(level, category, message) {
  // Skip debug logs in production
  if (level === 'debug' && isPackaged) return;

  if (!initialized) {
    try {
      init();
    } catch (e) {
      console.log('[' + level.toUpperCase() + '] [' + category + '] ' + message);
      return;
    }
  }
  
  var timestamp = new Date().toISOString();
  var logEntry = '[' + timestamp + '] [' + level.toUpperCase().padEnd(5) + '] [' + category.padEnd(15) + '] ' + message;
  
  // Console output with colors (only in development)
  if (!isPackaged) {
    var colors = {
      debug: '\x1b[90m',
      info: '\x1b[36m',
      warn: '\x1b[33m',
      error: '\x1b[31m',
      reset: '\x1b[0m'
    };
    var color = colors[level] || colors.info;
    console.log(color + logEntry + colors.reset);
  }
  
  // Queue for async file write
  LOG_BUFFER.push(logEntry);
  if (LOG_BUFFER.length >= MAX_BUFFER_SIZE) {
    flushBuffer();
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
 * Get recent logs (reads only the tail of the file)
 */
function getRecentLogs(lines) {
  lines = lines || 100;
  if (!logFile || !fs.existsSync(logFile)) {
    return 'No logs available';
  }
  
  try {
    // Read only the last ~50KB instead of the entire file
    var stats = fs.statSync(logFile);
    var readSize = Math.min(stats.size, 50 * 1024);
    var fd = fs.openSync(logFile, 'r');
    var buffer = Buffer.alloc(readSize);
    fs.readSync(fd, buffer, 0, readSize, Math.max(0, stats.size - readSize));
    fs.closeSync(fd);
    var content = buffer.toString('utf8');
    var allLines = content.split('\n');
    return allLines.slice(-lines).join('\n');
  } catch (e) {
    return 'Failed to read logs';
  }
}

/**
 * Clear old logs (keep last 7 days)
 */
function cleanOldLogs() {
  if (!logDir || !fs.existsSync(logDir)) return;
  
  try {
    var files = fs.readdirSync(logDir);
    var cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 7);
    
    files.forEach(function (file) {
      var match = file.match(/talio-(\d{4}-\d{2}-\d{2})/);
      if (match) {
        var fileDate = new Date(match[1]);
        if (fileDate < cutoffDate) {
          fs.unlinkSync(path.join(logDir, file));
        }
      }
    });
  } catch (error) {
    // Silently fail cleanup
  }
}

/**
 * Flush remaining buffer and close stream (call before app quit)
 */
function shutdown() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  // Synchronous final flush so nothing is lost
  if (LOG_BUFFER.length > 0 && logFile) {
    try {
      var chunk = LOG_BUFFER.splice(0, LOG_BUFFER.length).join('\n') + '\n';
      fs.appendFileSync(logFile, chunk);
    } catch (e) { /* ignore */ }
  }
  if (writeStream) {
    try { writeStream.end(); } catch (e) { /* ignore */ }
    writeStream = null;
  }
}

module.exports = {
  log,
  getLogPath,
  getRecentLogs,
  cleanOldLogs,
  shutdown,
  init
};
