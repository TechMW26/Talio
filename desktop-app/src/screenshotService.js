const { desktopCapturer, screen, systemPreferences } = require('electron');
const Store = require('electron-store');

const store = new Store();

/**
 * Screenshot Service
 * Captures full screen every minute and uploads when user is clocked in
 */
class ScreenshotService {
  constructor(options = {}) {
    this.apiUrl = options.apiUrl;
    this.clockStatusUrl = options.clockStatusUrl;
    this.getAuthToken = options.getAuthToken || (() => store.get('authToken'));
    this.interval = options.interval || 60000; // Default 1 minute
    this.intervalId = null;
    this.isRunning = false;
    this.isClockedIn = false;
    this.wasClockedIn = false; // Track previous clock status for immediate capture
    this.lastClockCheck = 0;
    this.clockCheckInterval = 30000; // Check clock status every 30 seconds
    this.retryQueue = []; // Queue for failed uploads
    this.maxRetries = 3;
    this.retryDelay = 5000; // 5 seconds between retries
    this.lastCaptureTime = 0;
    this.captureInProgress = false;
  }

  /**
   * Start the screenshot service
   */
  start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    console.log('[ScreenshotService] Starting...');
    
    // Initial clock status check - triggers immediate capture if clocked in
    this.checkClockStatus().then(() => {
      if (this.isClockedIn) {
        console.log('[ScreenshotService] Already clocked in, taking immediate screenshot');
        this.captureAndUpload();
      }
    });
    
    // Start interval for screenshots
    this.intervalId = setInterval(() => {
      this.captureAndUpload();
    }, this.interval);

    // Start clock status check interval
    this.clockCheckIntervalId = setInterval(() => {
      this.checkClockStatus();
    }, this.clockCheckInterval);

    // Start retry processing
    this.retryIntervalId = setInterval(() => {
      this.processRetryQueue();
    }, this.retryDelay);
  }

  /**
   * Stop the screenshot service
   */
  stop() {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    console.log('[ScreenshotService] Stopping...');
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    if (this.clockCheckIntervalId) {
      clearInterval(this.clockCheckIntervalId);
      this.clockCheckIntervalId = null;
    }

    if (this.retryIntervalId) {
      clearInterval(this.retryIntervalId);
      this.retryIntervalId = null;
    }
  }

  /**
   * Check if screen recording permission is available (macOS)
   */
  async hasScreenPermission() {
    if (process.platform === 'darwin') {
      const status = systemPreferences.getMediaAccessStatus('screen');
      console.log(`[ScreenshotService] Screen permission status: ${status}`);
      return status === 'granted';
    }
    return true; // Windows doesn't require explicit permission
  }

  /**
   * Check if user is clocked in
   */
  async checkClockStatus() {
    const token = this.getAuthToken();
    
    if (!token) {
      this.isClockedIn = false;
      console.log('[ScreenshotService] No auth token, not clocked in');
      return false;
    }

    try {
      const response = await fetch(this.clockStatusUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        console.log(`[ScreenshotService] Clock status API returned ${response.status}`);
        this.isClockedIn = false;
        return false;
      }

      const data = await response.json();
      const wasClocked = this.isClockedIn;
      this.isClockedIn = data.success && data.isClockedIn;
      this.lastClockCheck = Date.now();
      
      console.log(`[ScreenshotService] Clock status: ${this.isClockedIn ? 'Clocked In' : 'Not Clocked In'}`);
      
      // If just clocked in, capture immediately
      if (!wasClocked && this.isClockedIn) {
        console.log('[ScreenshotService] Just clocked in, capturing immediately');
        setTimeout(() => this.captureAndUpload(), 1000);
      }
      
      return this.isClockedIn;
    } catch (error) {
      console.error('[ScreenshotService] Failed to check clock status:', error.message);
      // Don't change clock status on network error - use last known state
      return this.isClockedIn;
    }
  }

  /**
   * Capture screenshot and upload if clocked in
   */
  async captureAndUpload() {
    // Prevent concurrent captures
    if (this.captureInProgress) {
      console.log('[ScreenshotService] Capture already in progress, skipping');
      return;
    }

    // Check if we have a recent clock status or need to refresh
    if (Date.now() - this.lastClockCheck > this.clockCheckInterval) {
      await this.checkClockStatus();
    }

    // Only capture if clocked in
    if (!this.isClockedIn) {
      console.log('[ScreenshotService] Not clocked in, skipping capture');
      return;
    }

    const token = this.getAuthToken();
    if (!token) {
      console.log('[ScreenshotService] No auth token, skipping capture');
      return;
    }

    // Check screen permission on macOS
    if (process.platform === 'darwin') {
      const hasPermission = await this.hasScreenPermission();
      if (!hasPermission) {
        console.error('[ScreenshotService] Screen recording permission not granted');
        return;
      }
    }

    this.captureInProgress = true;

    try {
      console.log('[ScreenshotService] Capturing screenshot...');
      
      // Get all displays
      const displays = screen.getAllDisplays();
      const primaryDisplay = screen.getPrimaryDisplay();
      
      // Get all screen sources with proper size
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.floor(primaryDisplay.workAreaSize.width * primaryDisplay.scaleFactor),
          height: Math.floor(primaryDisplay.workAreaSize.height * primaryDisplay.scaleFactor)
        }
      });

      if (sources.length === 0) {
        console.error('[ScreenshotService] No screen sources available - check permissions');
        this.captureInProgress = false;
        return;
      }

      // Capture primary screen
      const primarySource = sources.find(s => s.display_id === primaryDisplay.id.toString()) || sources[0];
      const thumbnail = primarySource.thumbnail;
      
      if (!thumbnail || thumbnail.isEmpty()) {
        console.error('[ScreenshotService] Empty thumbnail - screen recording permission may be denied');
        this.captureInProgress = false;
        return;
      }
      
      // Convert to WebP with compression using sharp (if available) or PNG
      let imageBuffer;
      let mimeType = 'image/webp';
      
      try {
        // Try to use sharp for WebP compression
        const sharp = require('sharp');
        const pngBuffer = thumbnail.toPNG();
        
        imageBuffer = await sharp(pngBuffer)
          .webp({ quality: 70, effort: 4 }) // Good balance of quality and compression
          .toBuffer();
        
        console.log(`[ScreenshotService] Compressed to WebP: ${(imageBuffer.length / 1024).toFixed(1)}KB`);
      } catch (sharpError) {
        // Fallback to PNG if sharp is not available
        console.log('[ScreenshotService] Sharp not available, using PNG:', sharpError.message);
        imageBuffer = thumbnail.toPNG();
        mimeType = 'image/png';
        console.log(`[ScreenshotService] Using PNG: ${(imageBuffer.length / 1024).toFixed(1)}KB`);
      }

      // Upload to server
      await this.uploadScreenshot(imageBuffer, mimeType, token);
      this.lastCaptureTime = Date.now();
      
    } catch (error) {
      console.error('[ScreenshotService] Capture failed:', error.message);
    } finally {
      this.captureInProgress = false;
    }
  }

  /**
   * Upload screenshot to server
   */
  async uploadScreenshot(imageBuffer, mimeType, token, retryCount = 0) {
    try {
      const timestamp = Date.now();
      
      // Convert buffer to base64 for JSON upload
      const base64Data = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;

      console.log(`[ScreenshotService] Uploading screenshot (${(imageBuffer.length / 1024).toFixed(1)}KB)...`);

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          screenshot: base64Data,
          timestamp: timestamp.toString()
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log(`[ScreenshotService] ✓ Uploaded successfully: ${data.path}`);
      
      return data;
    } catch (error) {
      console.error(`[ScreenshotService] Upload failed (attempt ${retryCount + 1}):`, error.message);
      
      // Add to retry queue if not exceeded max retries
      if (retryCount < this.maxRetries) {
        this.retryQueue.push({
          imageBuffer,
          mimeType,
          token,
          retryCount: retryCount + 1,
          timestamp: Date.now()
        });
        console.log(`[ScreenshotService] Added to retry queue (${this.retryQueue.length} pending)`);
      } else {
        console.error('[ScreenshotService] Max retries exceeded, discarding screenshot');
        // Store failed uploads info for debugging
        const failedUploads = store.get('failedUploads', []);
        failedUploads.push({
          timestamp: Date.now(),
          error: error.message
        });
        // Keep only last 10 failed uploads
        store.set('failedUploads', failedUploads.slice(-10));
      }
      
      throw error;
    }
  }

  /**
   * Process retry queue for failed uploads
   */
  async processRetryQueue() {
    if (this.retryQueue.length === 0) return;

    const item = this.retryQueue.shift();
    if (!item) return;

    // Check if item is too old (more than 5 minutes)
    if (Date.now() - item.timestamp > 5 * 60 * 1000) {
      console.log('[ScreenshotService] Retry item too old, discarding');
      return;
    }

    console.log(`[ScreenshotService] Processing retry queue (${this.retryQueue.length + 1} items)`);

    try {
      await this.uploadScreenshot(item.imageBuffer, item.mimeType, item.token, item.retryCount);
    } catch (error) {
      // Error already logged in uploadScreenshot
    }
  }

  /**
   * Force capture now (for debugging/testing)
   */
  async forceCapture() {
    console.log('[ScreenshotService] Force capture requested');
    const token = this.getAuthToken();
    if (!token) {
      console.error('[ScreenshotService] No auth token for force capture');
      return { success: false, error: 'No auth token' };
    }

    // Temporarily set clocked in to true for force capture
    const wasClockedIn = this.isClockedIn;
    this.isClockedIn = true;
    
    try {
      await this.captureAndUpload();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    } finally {
      this.isClockedIn = wasClockedIn;
    }
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      isClockedIn: this.isClockedIn,
      lastClockCheck: this.lastClockCheck,
      lastCaptureTime: this.lastCaptureTime,
      captureInProgress: this.captureInProgress,
      retryQueueLength: this.retryQueue.length,
      interval: this.interval,
      failedUploads: store.get('failedUploads', [])
    };
  }
}

module.exports = { ScreenshotService };
