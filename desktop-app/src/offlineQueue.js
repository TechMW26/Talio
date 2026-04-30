/**
 * Offline Queue v5.1.0
 * Manages screenshot uploads when offline, syncs when back online
 * Uses async file I/O to avoid blocking the main thread
 */

const Store = require('electron-store');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const logger = require('./logger');

const store = new Store({ name: 'offline-queue' });

// Queue configuration
const MAX_QUEUE_SIZE = 100;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

class OfflineQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.isOnline = true;
    this.uploadFunction = null;
    this.tempDir = null;
  }

  initialize(uploadFn) {
    this.uploadFunction = uploadFn;
    this.tempDir = path.join(app.getPath('userData'), 'temp-screenshots');
    
    // Ensure temp directory exists
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    
    // Load persisted queue
    this.loadQueue();
    logger.log('info', 'OfflineQueue', 'Initialized. Queue size: ' + this.queue.length);
  }

  loadQueue() {
    try {
      this.queue = store.get('queue', []);
      // Clean up items older than 24 hours
      const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
      const before = this.queue.length;
      this.queue = this.queue.filter(function(item) {
        return item.timestamp > dayAgo;
      });
      if (before !== this.queue.length) {
        logger.log('info', 'OfflineQueue', 'Cleaned ' + (before - this.queue.length) + ' expired items');
        this.saveQueue();
      }
    } catch (error) {
      logger.log('error', 'OfflineQueue', 'Load failed: ' + error.message);
      this.queue = [];
    }
  }

  saveQueue() {
    try {
      store.set('queue', this.queue);
    } catch (error) {
      logger.log('error', 'OfflineQueue', 'Save failed: ' + error.message);
    }
  }

  setOnlineStatus(online) {
    const wasOffline = !this.isOnline;
    this.isOnline = online;
    
    logger.log('info', 'OfflineQueue', 'Online status: ' + online);
    
    if (online && wasOffline && this.queue.length > 0) {
      logger.log('info', 'OfflineQueue', 'Back online, processing queue...');
      this.processQueue();
    }
  }

  async add(screenshotData) {
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      // Remove oldest item
      const removed = this.queue.shift();
      this.cleanupTempFile(removed.tempPath);
      logger.log('warn', 'OfflineQueue', 'Queue full, removed oldest item');
    }

    // Save screenshot to temp file
    const tempFileName = 'screenshot_' + Date.now() + '.webp';
    const tempPath = path.join(this.tempDir, tempFileName);
    
    try {
      // screenshotData.buffer should be a Buffer — write asynchronously
      await new Promise(function(resolve, reject) {
        fs.writeFile(tempPath, screenshotData.buffer, function(err) {
          if (err) reject(err); else resolve();
        });
      });
      
      const queueItem = {
        id: 'queue_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        tempPath: tempPath,
        timestamp: Date.now(),
        retries: 0,
        metadata: {
          userId: screenshotData.userId,
          employeeId: screenshotData.employeeId,
          captureType: screenshotData.captureType || 'automatic',
          originalTimestamp: screenshotData.timestamp || new Date().toISOString()
        }
      };
      
      this.queue.push(queueItem);
      this.saveQueue();
      
      logger.log('info', 'OfflineQueue', 'Added to queue. Size: ' + this.queue.length);
      
      return {
        success: true,
        queued: true,
        queueId: queueItem.id,
        queueSize: this.queue.length
      };
    } catch (error) {
      logger.log('error', 'OfflineQueue', 'Failed to save temp file: ' + error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async processQueue() {
    if (this.isProcessing || !this.isOnline || this.queue.length === 0) {
      return;
    }
    
    if (!this.uploadFunction) {
      logger.log('error', 'OfflineQueue', 'No upload function configured');
      return;
    }
    
    this.isProcessing = true;
    logger.log('info', 'OfflineQueue', 'Processing ' + this.queue.length + ' queued items');
    
    const successfulUploads = [];
    const failedItems = [];
    
    for (let i = 0; i < this.queue.length; i++) {
      const item = this.queue[i];
      
      // Check if temp file exists
      if (!fs.existsSync(item.tempPath)) {
        logger.log('warn', 'OfflineQueue', 'Temp file missing: ' + item.tempPath);
        successfulUploads.push(item.id);
        continue;
      }
      
      try {
        // Read the temp file asynchronously
        const buffer = await new Promise(function(resolve, reject) {
          fs.readFile(item.tempPath, function(err, data) {
            if (err) reject(err); else resolve(data);
          });
        });
        
        // Try to upload
        const result = await this.uploadFunction({
          buffer: buffer,
          userId: item.metadata.userId,
          employeeId: item.metadata.employeeId,
          captureType: item.metadata.captureType,
          timestamp: item.metadata.originalTimestamp,
          isRetry: true
        });
        
        if (result.success) {
          successfulUploads.push(item.id);
          this.cleanupTempFile(item.tempPath);
          logger.log('info', 'OfflineQueue', 'Uploaded queued item ' + (i + 1) + '/' + this.queue.length);
        } else {
          throw new Error(result.error || 'Upload failed');
        }
      } catch (error) {
        item.retries++;
        
        if (item.retries >= MAX_RETRIES) {
          logger.log('error', 'OfflineQueue', 'Max retries reached for ' + item.id);
          successfulUploads.push(item.id); // Remove from queue
          this.cleanupTempFile(item.tempPath);
        } else {
          failedItems.push(item);
          logger.log('warn', 'OfflineQueue', 'Retry ' + item.retries + '/' + MAX_RETRIES + ' for ' + item.id);
        }
      }
      
      // Small delay between uploads
      await new Promise(function(resolve) { setTimeout(resolve, 500); });
    }
    
    // Update queue
    const self = this;
    this.queue = this.queue.filter(function(item) {
      return successfulUploads.indexOf(item.id) === -1;
    });
    this.saveQueue();
    
    this.isProcessing = false;
    
    logger.log('info', 'OfflineQueue', 
      'Queue processing complete. Uploaded: ' + successfulUploads.length + 
      ', Remaining: ' + this.queue.length);
    
    // Schedule retry for failed items
    if (failedItems.length > 0 && this.isOnline) {
      setTimeout(function() { self.processQueue(); }, RETRY_DELAY_MS);
    }
  }

  cleanupTempFile(filePath) {
    try {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      logger.log('warn', 'OfflineQueue', 'Failed to cleanup: ' + error.message);
    }
  }

  getStatus() {
    return {
      queueSize: this.queue.length,
      isProcessing: this.isProcessing,
      isOnline: this.isOnline,
      oldestItem: this.queue.length > 0 ? this.queue[0].timestamp : null
    };
  }

  clearQueue() {
    // Clean up all temp files
    var self = this;
    this.queue.forEach(function(item) {
      self.cleanupTempFile(item.tempPath);
    });
    
    this.queue = [];
    this.saveQueue();
    logger.log('info', 'OfflineQueue', 'Queue cleared');
  }

  reset() {
    this.clearQueue();
    this.isProcessing = false;
    logger.log('info', 'OfflineQueue', 'Reset complete');
  }
}

module.exports = new OfflineQueue();
