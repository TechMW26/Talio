const Store = require('electron-store');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const store = new Store();

/**
 * Offline Manager
 * Handles queuing and retrying failed screenshot uploads
 * Stores captures locally when offline and uploads when connection is restored
 */
class OfflineManager {
  constructor(options = {}) {
    this.apiUrl = options.apiUrl;
    this.getAuthToken = options.getAuthToken;
    this.maxQueueSize = options.maxQueueSize || 100;
    this.retryInterval = options.retryInterval || 30000; // 30 seconds
    this.maxRetries = options.maxRetries || 5;
    
    this.queue = store.get('offlineQueue', []);
    this.isProcessing = false;
    this.retryIntervalId = null;
    
    // Local storage path for offline captures
    this.localStoragePath = path.join(app.getPath('userData'), 'offline-captures');
    this.ensureStorageDirectory();
    
    // Start retry processor
    this.startRetryProcessor();
  }

  /**
   * Ensure local storage directory exists
   */
  ensureStorageDirectory() {
    try {
      if (!fs.existsSync(this.localStoragePath)) {
        fs.mkdirSync(this.localStoragePath, { recursive: true });
        console.log('[OfflineManager] Created local storage directory');
      }
    } catch (error) {
      console.error('[OfflineManager] Failed to create storage directory:', error.message);
    }
  }

  /**
   * Add a capture to the offline queue
   */
  async addToQueue(captureData) {
    // Check queue size limit
    if (this.queue.length >= this.maxQueueSize) {
      // Remove oldest items
      const toRemove = this.queue.slice(0, 10);
      for (const item of toRemove) {
        this.removeLocalFile(item.localPath);
      }
      this.queue = this.queue.slice(10);
      console.log('[OfflineManager] Queue full, removed oldest 10 items');
    }

    // Save image buffer to local file
    const filename = `capture_${Date.now()}.webp`;
    const localPath = path.join(this.localStoragePath, filename);
    
    try {
      fs.writeFileSync(localPath, captureData.imageBuffer);
      
      const queueItem = {
        id: Date.now().toString(),
        localPath,
        timestamp: captureData.timestamp,
        userId: captureData.userId,
        sessionId: captureData.sessionId,
        retryCount: 0,
        addedAt: new Date().toISOString(),
        size: captureData.imageBuffer.length
      };

      this.queue.push(queueItem);
      this.saveQueue();
      
      console.log(`[OfflineManager] Added capture to queue (${this.queue.length} items)`);
      return queueItem;
    } catch (error) {
      console.error('[OfflineManager] Failed to save capture locally:', error.message);
      return null;
    }
  }

  /**
   * Process the queue - upload pending captures
   */
  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;
    
    this.isProcessing = true;
    console.log(`[OfflineManager] Processing queue (${this.queue.length} items)`);

    const token = this.getAuthToken();
    if (!token) {
      console.log('[OfflineManager] No auth token, skipping queue processing');
      this.isProcessing = false;
      return;
    }

    // Process items one at a time
    const itemsToProcess = [...this.queue];
    const successfulIds = [];
    const failedItems = [];

    for (const item of itemsToProcess) {
      try {
        // Check if local file exists
        if (!fs.existsSync(item.localPath)) {
          console.log(`[OfflineManager] Local file missing: ${item.localPath}`);
          successfulIds.push(item.id);
          continue;
        }

        // Read the file
        const imageBuffer = fs.readFileSync(item.localPath);
        const base64Data = `data:image/webp;base64,${imageBuffer.toString('base64')}`;

        // Upload to server
        const response = await fetch(this.apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            screenshot: base64Data,
            timestamp: item.timestamp,
            sessionId: item.sessionId,
            isOfflineCapture: true
          })
        });

        if (response.ok) {
          console.log(`[OfflineManager] Successfully uploaded queued capture ${item.id}`);
          successfulIds.push(item.id);
          this.removeLocalFile(item.localPath);
        } else {
          throw new Error(`HTTP ${response.status}`);
        }
      } catch (error) {
        console.log(`[OfflineManager] Failed to upload ${item.id}: ${error.message}`);
        item.retryCount++;
        
        if (item.retryCount >= this.maxRetries) {
          console.log(`[OfflineManager] Max retries exceeded for ${item.id}, removing`);
          successfulIds.push(item.id);
          this.removeLocalFile(item.localPath);
        } else {
          failedItems.push(item);
        }
      }
    }

    // Update queue - remove successful and over-retried items
    this.queue = this.queue.filter(item => !successfulIds.includes(item.id));
    
    // Update retry counts for failed items
    for (const failed of failedItems) {
      const idx = this.queue.findIndex(i => i.id === failed.id);
      if (idx !== -1) {
        this.queue[idx].retryCount = failed.retryCount;
        this.queue[idx].lastRetry = new Date().toISOString();
      }
    }
    
    this.saveQueue();
    this.isProcessing = false;

    console.log(`[OfflineManager] Queue processing complete. ${this.queue.length} items remaining`);
  }

  /**
   * Remove local file
   */
  removeLocalFile(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.error(`[OfflineManager] Failed to remove local file: ${error.message}`);
    }
  }

  /**
   * Save queue to store
   */
  saveQueue() {
    store.set('offlineQueue', this.queue);
  }

  /**
   * Start the retry processor
   */
  startRetryProcessor() {
    if (this.retryIntervalId) return;
    
    this.retryIntervalId = setInterval(() => {
      this.processQueue();
    }, this.retryInterval);

    // Also try immediately
    setTimeout(() => this.processQueue(), 5000);
  }

  /**
   * Stop the retry processor
   */
  stopRetryProcessor() {
    if (this.retryIntervalId) {
      clearInterval(this.retryIntervalId);
      this.retryIntervalId = null;
    }
  }

  /**
   * Get queue status
   */
  getStatus() {
    return {
      queueLength: this.queue.length,
      isProcessing: this.isProcessing,
      oldestItem: this.queue[0]?.addedAt || null,
      newestItem: this.queue[this.queue.length - 1]?.addedAt || null,
      totalSize: this.queue.reduce((sum, item) => sum + (item.size || 0), 0)
    };
  }

  /**
   * Flush queue - try to upload all remaining items
   */
  async flush() {
    console.log('[OfflineManager] Flushing queue...');
    await this.processQueue();
  }

  /**
   * Clear the queue
   */
  clear() {
    for (const item of this.queue) {
      this.removeLocalFile(item.localPath);
    }
    this.queue = [];
    this.saveQueue();
    console.log('[OfflineManager] Queue cleared');
  }
}

module.exports = { OfflineManager };
