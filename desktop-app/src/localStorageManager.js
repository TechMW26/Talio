const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

const store = new Store();

/**
 * Local Storage Manager
 * Manages local screenshot storage with upload tracking and auto-cleanup
 */
class LocalStorageManager {
  constructor(options = {}) {
    this.retentionDays = options.retentionDays || 7;
    this.uploadRetryInterval = options.uploadRetryInterval || 30000; // 30 seconds
    
    // Storage paths
    this.baseDir = path.join(app.getPath('userData'), 'screenshots');
    this.pendingDir = path.join(this.baseDir, 'pending');
    this.uploadedDir = path.join(this.baseDir, 'uploaded');
    
    // Ensure directories exist
    this.ensureDirectories();
    
    // Track pending uploads
    this.pendingUploads = store.get('pendingUploads', []);
    
    // Stats
    this.stats = {
      totalSaved: 0,
      totalUploaded: 0,
      totalFailed: 0,
      lastCleanup: store.get('lastCleanup', 0)
    };
    
    // Start background processors
    this.uploadProcessorInterval = null;
    this.cleanupInterval = null;
  }

  /**
   * Ensure all required directories exist
   */
  ensureDirectories() {
    try {
      [this.baseDir, this.pendingDir, this.uploadedDir].forEach(dir => {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
          console.log(`[LocalStorage] Created directory: ${dir}`);
        }
      });
    } catch (error) {
      console.error('[LocalStorage] Failed to create directories:', error.message);
    }
  }

  /**
   * Get user-specific directory for pending uploads
   */
  getUserPendingDir(userId) {
    const userDir = path.join(this.pendingDir, userId);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    return userDir;
  }

  /**
   * Save screenshot locally
   * @param {Buffer} imageBuffer - JPEG image buffer
   * @param {Object} metadata - Screenshot metadata (userId, timestamp, sessionId, etc.)
   * @returns {Object} - Save result with local path
   */
  saveScreenshot(imageBuffer, metadata) {
    try {
      const { userId, timestamp, sessionId, sessionNumber } = metadata;
      
      // Generate filename with timestamp
      const date = new Date(parseInt(timestamp));
      const dateStr = date.toISOString().split('T')[0];
      const timeStr = date.toISOString().replace(/[:.]/g, '-');
      const filename = `${timeStr}.jpg`;
      
      // Create user and date directories
      const userDir = this.getUserPendingDir(userId);
      const dateDir = path.join(userDir, dateStr);
      
      if (!fs.existsSync(dateDir)) {
        fs.mkdirSync(dateDir, { recursive: true });
      }
      
      const filePath = path.join(dateDir, filename);
      
      // Save the file
      fs.writeFileSync(filePath, imageBuffer);
      
      // Create upload record
      const uploadRecord = {
        id: `${timestamp}-${Math.random().toString(36).substr(2, 9)}`,
        localPath: filePath,
        filename,
        userId,
        timestamp,
        dateStr,
        sessionId,
        sessionNumber,
        size: imageBuffer.length,
        status: 'pending',
        retries: 0,
        createdAt: Date.now(),
        lastAttempt: null
      };
      
      // Add to pending uploads
      this.pendingUploads.push(uploadRecord);
      this.savePendingUploads();
      
      this.stats.totalSaved++;
      
      console.log(`[LocalStorage] Saved screenshot: ${filename} (${(imageBuffer.length / 1024).toFixed(1)}KB)`);
      
      return {
        success: true,
        localPath: filePath,
        filename,
        uploadRecord
      };
      
    } catch (error) {
      console.error('[LocalStorage] Failed to save screenshot:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Mark a screenshot as uploaded successfully
   */
  markAsUploaded(uploadId, serverPath) {
    const index = this.pendingUploads.findIndex(u => u.id === uploadId);
    
    if (index !== -1) {
      const upload = this.pendingUploads[index];
      upload.status = 'uploaded';
      upload.serverPath = serverPath;
      upload.uploadedAt = Date.now();
      
      // Move file to uploaded folder (for retention period)
      try {
        const uploadedDir = path.join(this.uploadedDir, upload.userId, upload.dateStr);
        if (!fs.existsSync(uploadedDir)) {
          fs.mkdirSync(uploadedDir, { recursive: true });
        }
        
        const newPath = path.join(uploadedDir, upload.filename);
        if (fs.existsSync(upload.localPath)) {
          fs.renameSync(upload.localPath, newPath);
          upload.localPath = newPath;
        }
      } catch (error) {
        // If move fails, just delete the pending file
        this.deleteFile(upload.localPath);
      }
      
      // Remove from pending list
      this.pendingUploads.splice(index, 1);
      this.savePendingUploads();
      
      this.stats.totalUploaded++;
      
      console.log(`[LocalStorage] Marked as uploaded: ${upload.filename}`);
    }
  }

  /**
   * Mark upload as failed (will retry)
   */
  markAsFailed(uploadId, error) {
    const upload = this.pendingUploads.find(u => u.id === uploadId);
    
    if (upload) {
      upload.retries++;
      upload.lastAttempt = Date.now();
      upload.lastError = error;
      
      // If too many retries, mark as permanently failed
      if (upload.retries >= 10) {
        upload.status = 'failed';
        this.stats.totalFailed++;
        console.log(`[LocalStorage] Upload permanently failed after ${upload.retries} retries: ${upload.filename}`);
      } else {
        upload.status = 'retry';
        console.log(`[LocalStorage] Upload failed, retry #${upload.retries}: ${upload.filename} - ${error}`);
      }
      
      this.savePendingUploads();
    }
  }

  /**
   * Get pending uploads for processing
   */
  getPendingUploads() {
    return this.pendingUploads.filter(u => 
      u.status === 'pending' || 
      (u.status === 'retry' && Date.now() - u.lastAttempt > this.uploadRetryInterval)
    );
  }

  /**
   * Get upload by ID
   */
  getUpload(uploadId) {
    return this.pendingUploads.find(u => u.id === uploadId);
  }

  /**
   * Read screenshot file for upload
   */
  readScreenshotFile(localPath) {
    try {
      if (fs.existsSync(localPath)) {
        return fs.readFileSync(localPath);
      }
      return null;
    } catch (error) {
      console.error('[LocalStorage] Failed to read file:', error.message);
      return null;
    }
  }

  /**
   * Save pending uploads to persistent store
   */
  savePendingUploads() {
    store.set('pendingUploads', this.pendingUploads);
  }

  /**
   * Clean up old screenshots (older than retention period)
   */
  cleanup() {
    const now = Date.now();
    const retentionMs = this.retentionDays * 24 * 60 * 60 * 1000;
    let deletedCount = 0;

    console.log(`[LocalStorage] Starting cleanup (retention: ${this.retentionDays} days)...`);

    // Clean uploaded folder
    deletedCount += this.cleanupDirectory(this.uploadedDir, retentionMs);
    
    // Clean pending folder (older failed uploads)
    deletedCount += this.cleanupDirectory(this.pendingDir, retentionMs);
    
    // Clean pending uploads list
    const beforeCount = this.pendingUploads.length;
    this.pendingUploads = this.pendingUploads.filter(u => {
      // Keep if file exists and not too old
      if (!fs.existsSync(u.localPath)) return false;
      if (now - u.createdAt > retentionMs) {
        this.deleteFile(u.localPath);
        return false;
      }
      return true;
    });
    
    if (this.pendingUploads.length !== beforeCount) {
      this.savePendingUploads();
    }
    
    this.stats.lastCleanup = now;
    store.set('lastCleanup', now);
    
    console.log(`[LocalStorage] Cleanup complete. Deleted ${deletedCount} files.`);
  }

  /**
   * Clean up a directory recursively
   */
  cleanupDirectory(dir, retentionMs) {
    let deletedCount = 0;
    
    if (!fs.existsSync(dir)) return 0;
    
    try {
      const items = fs.readdirSync(dir);
      
      for (const item of items) {
        const itemPath = path.join(dir, item);
        const stats = fs.statSync(itemPath);
        
        if (stats.isDirectory()) {
          // Recurse into subdirectory
          deletedCount += this.cleanupDirectory(itemPath, retentionMs);
          
          // Remove empty directories
          const contents = fs.readdirSync(itemPath);
          if (contents.length === 0) {
            fs.rmdirSync(itemPath);
            console.log(`[LocalStorage] Removed empty directory: ${item}`);
          }
        } else if (stats.isFile()) {
          // Check file age
          const age = Date.now() - stats.mtimeMs;
          if (age > retentionMs) {
            fs.unlinkSync(itemPath);
            deletedCount++;
          }
        }
      }
    } catch (error) {
      console.error(`[LocalStorage] Cleanup error in ${dir}:`, error.message);
    }
    
    return deletedCount;
  }

  /**
   * Delete a file safely
   */
  deleteFile(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
      }
    } catch (error) {
      console.error(`[LocalStorage] Failed to delete file:`, error.message);
    }
    return false;
  }

  /**
   * Start background cleanup (runs once per day)
   */
  startCleanupScheduler() {
    // Run cleanup if it hasn't been run in 24 hours
    const hoursSinceLastCleanup = (Date.now() - this.stats.lastCleanup) / (1000 * 60 * 60);
    if (hoursSinceLastCleanup > 24) {
      this.cleanup();
    }
    
    // Schedule daily cleanup
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 24 * 60 * 60 * 1000);
  }

  /**
   * Stop background processors
   */
  stop() {
    if (this.uploadProcessorInterval) {
      clearInterval(this.uploadProcessorInterval);
      this.uploadProcessorInterval = null;
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get storage statistics
   */
  getStats() {
    // Calculate storage usage
    let totalSize = 0;
    let pendingCount = 0;
    let uploadedCount = 0;
    
    const calculateDirSize = (dir) => {
      if (!fs.existsSync(dir)) return 0;
      let size = 0;
      try {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const itemPath = path.join(dir, item);
          const stats = fs.statSync(itemPath);
          if (stats.isDirectory()) {
            size += calculateDirSize(itemPath);
          } else {
            size += stats.size;
          }
        }
      } catch (error) {
        // Ignore errors
      }
      return size;
    };
    
    const pendingSize = calculateDirSize(this.pendingDir);
    const uploadedSize = calculateDirSize(this.uploadedDir);
    
    return {
      ...this.stats,
      pendingCount: this.pendingUploads.filter(u => u.status !== 'uploaded').length,
      pendingSize: pendingSize,
      uploadedSize: uploadedSize,
      totalSize: pendingSize + uploadedSize,
      baseDir: this.baseDir
    };
  }

  /**
   * Get storage paths info
   */
  getPaths() {
    return {
      baseDir: this.baseDir,
      pendingDir: this.pendingDir,
      uploadedDir: this.uploadedDir
    };
  }
}

module.exports = { LocalStorageManager };
