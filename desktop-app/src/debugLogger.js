const { app } = require('electron');
const fs = require('fs');
const path = require('path');

/**
 * Debug Logger
 * Writes logs to file for debugging screenshot capture issues
 */
class DebugLogger {
  constructor() {
    // Log file location
    this.logDir = path.join(app.getPath('userData'), 'logs');
    this.logFile = path.join(this.logDir, 'talio-debug.log');
    this.maxLogSize = 5 * 1024 * 1024; // 5MB max
    this.maxLogFiles = 5;
    
    this.ensureLogDir();
    this.rotateLogsIfNeeded();
    
    this.log('='.repeat(60));
    this.log(`Talio Desktop Started - v${app.getVersion()}`);
    this.log(`Platform: ${process.platform}, Arch: ${process.arch}`);
    this.log(`User Data: ${app.getPath('userData')}`);
    this.log('='.repeat(60));
  }

  /**
   * Ensure log directory exists
   */
  ensureLogDir() {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (error) {
      console.error('Failed to create log directory:', error);
    }
  }

  /**
   * Rotate logs if file is too large
   */
  rotateLogsIfNeeded() {
    try {
      if (fs.existsSync(this.logFile)) {
        const stats = fs.statSync(this.logFile);
        if (stats.size > this.maxLogSize) {
          // Rotate existing log files
          for (let i = this.maxLogFiles - 1; i >= 1; i--) {
            const oldFile = `${this.logFile}.${i}`;
            const newFile = `${this.logFile}.${i + 1}`;
            if (fs.existsSync(oldFile)) {
              if (i === this.maxLogFiles - 1) {
                fs.unlinkSync(oldFile);
              } else {
                fs.renameSync(oldFile, newFile);
              }
            }
          }
          fs.renameSync(this.logFile, `${this.logFile}.1`);
        }
      }
    } catch (error) {
      console.error('Failed to rotate logs:', error);
    }
  }

  /**
   * Format timestamp
   */
  getTimestamp() {
    return new Date().toISOString();
  }

  /**
   * Write log entry
   */
  log(message, level = 'INFO') {
    const timestamp = this.getTimestamp();
    const logEntry = `[${timestamp}] [${level}] ${message}\n`;
    
    // Console output
    if (level === 'ERROR') {
      console.error(message);
    } else {
      console.log(message);
    }
    
    // File output
    try {
      fs.appendFileSync(this.logFile, logEntry);
    } catch (error) {
      console.error('Failed to write log:', error);
    }
  }

  info(message) {
    this.log(message, 'INFO');
  }

  error(message) {
    this.log(message, 'ERROR');
  }

  warn(message) {
    this.log(message, 'WARN');
  }

  debug(message) {
    this.log(message, 'DEBUG');
  }

  /**
   * Log capture event
   */
  capture(success, details = {}) {
    if (success) {
      this.log(`CAPTURE SUCCESS: ${JSON.stringify(details)}`, 'CAPTURE');
    } else {
      this.log(`CAPTURE FAILED: ${JSON.stringify(details)}`, 'ERROR');
    }
  }

  /**
   * Log upload event
   */
  upload(success, details = {}) {
    if (success) {
      this.log(`UPLOAD SUCCESS: ${JSON.stringify(details)}`, 'UPLOAD');
    } else {
      this.log(`UPLOAD FAILED: ${JSON.stringify(details)}`, 'ERROR');
    }
  }

  /**
   * Log health check
   */
  health(status, details = {}) {
    this.log(`HEALTH CHECK: ${status} - ${JSON.stringify(details)}`, 'HEALTH');
  }

  /**
   * Get log file path
   */
  getLogPath() {
    return this.logFile;
  }

  /**
   * Get recent logs
   */
  getRecentLogs(lines = 100) {
    try {
      if (!fs.existsSync(this.logFile)) {
        return 'No logs yet';
      }
      const content = fs.readFileSync(this.logFile, 'utf8');
      const allLines = content.split('\n');
      return allLines.slice(-lines).join('\n');
    } catch (error) {
      return `Error reading logs: ${error.message}`;
    }
  }
}

// Singleton instance
let loggerInstance = null;

function getLogger() {
  if (!loggerInstance) {
    loggerInstance = new DebugLogger();
  }
  return loggerInstance;
}

module.exports = { DebugLogger, getLogger };
