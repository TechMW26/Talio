/**
 * Screenshot Service v3.0.0
 * 
 * Simple, direct upload to MongoDB GridFS
 * - Captures at 1080p resolution
 * - Native format (PNG)
 * - Direct upload, no local storage
 * - Skips capture if offline
 */

const { desktopCapturer, screen } = require('electron');
const debugLogger = require('./debugLogger');

class ScreenshotService {
  constructor() {
    this.isCapturing = false;
    this.captureInterval = null;
    this.intervalMs = 60000; // 1 minute
    this.serverUrl = null;
    this.authToken = null;
    this.sessionId = null;
    this.captureCount = 0;
    this.lastCaptureTime = null;
    this.onCaptureCallback = null;
    this.onErrorCallback = null;
    
    // Activity tracking
    this.activityData = {
      keystrokes: 0,
      mouseClicks: 0,
      mouseMovements: 0,
      activeWindow: '',
      activeApp: '',
      isIdle: false
    };
  }

  /**
   * Initialize the service with server details
   */
  initialize(serverUrl, authToken) {
    this.serverUrl = serverUrl.replace(/\/$/, ''); // Remove trailing slash
    this.authToken = authToken;
    this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    debugLogger.log('info', 'ScreenshotService', `Initialized with server: ${this.serverUrl}`);
  }

  /**
   * Check if online by making a simple fetch
   */
  async isOnline() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`${this.serverUrl}/api/health`, {
        method: 'HEAD',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Capture screenshot at 1080p resolution
   */
  async captureScreen() {
    try {
      // Get all sources
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 }
      });

      if (!sources || sources.length === 0) {
        throw new Error('No screen sources available');
      }

      // Get primary display or first available
      const primaryDisplay = screen.getPrimaryDisplay();
      let source = sources[0];

      // Try to find the primary display source
      for (const s of sources) {
        if (s.display_id === primaryDisplay.id.toString()) {
          source = s;
          break;
        }
      }

      // Get thumbnail as PNG buffer
      const thumbnail = source.thumbnail;
      
      if (!thumbnail || thumbnail.isEmpty()) {
        throw new Error('Failed to capture screen thumbnail');
      }

      // Convert to PNG buffer at 1080p
      const resized = thumbnail.resize({ width: 1920, height: 1080, quality: 'best' });
      const pngBuffer = resized.toPNG();

      debugLogger.log('debug', 'ScreenshotService', `Captured screen: ${pngBuffer.length} bytes`);

      return {
        buffer: pngBuffer,
        mimeType: 'image/png',
        width: 1920,
        height: 1080,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      debugLogger.log('error', 'ScreenshotService', `Capture error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Upload screenshot to server
   */
  async uploadScreenshot(screenshotData) {
    try {
      const formData = new FormData();
      
      // Create blob from buffer
      const blob = new Blob([screenshotData.buffer], { type: screenshotData.mimeType });
      formData.append('screenshot', blob, `screenshot_${Date.now()}.png`);
      
      // Add activity data
      formData.append('activity', JSON.stringify(this.activityData));
      formData.append('sessionId', this.sessionId);

      const response = await fetch(`${this.serverUrl}/api/activity/screenshot`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.authToken}`
        },
        body: formData
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `Upload failed: ${response.status}`);
      }

      debugLogger.log('info', 'ScreenshotService', `Uploaded screenshot: ${result.screenshotId}`);
      
      return result;

    } catch (error) {
      debugLogger.log('error', 'ScreenshotService', `Upload error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Perform a single capture and upload cycle
   */
  async captureAndUpload() {
    // Check if we should capture
    if (!this.isCapturing) {
      return { skipped: true, reason: 'not_capturing' };
    }

    if (!this.serverUrl || !this.authToken) {
      return { skipped: true, reason: 'not_initialized' };
    }

    // Check if online
    const online = await this.isOnline();
    if (!online) {
      debugLogger.log('warn', 'ScreenshotService', 'Offline - skipping capture');
      if (this.onErrorCallback) {
        this.onErrorCallback({ type: 'offline', message: 'No internet connection' });
      }
      return { skipped: true, reason: 'offline' };
    }

    try {
      // Capture screen
      const screenshotData = await this.captureScreen();

      // Upload to server
      const result = await uploadScreenshot(screenshotData);

      this.captureCount++;
      this.lastCaptureTime = new Date();

      // Reset activity counters after successful capture
      this.activityData.keystrokes = 0;
      this.activityData.mouseClicks = 0;
      this.activityData.mouseMovements = 0;

      // Notify success
      if (this.onCaptureCallback) {
        this.onCaptureCallback({
          success: true,
          screenshotId: result.screenshotId,
          timestamp: this.lastCaptureTime,
          captureCount: this.captureCount
        });
      }

      return {
        success: true,
        screenshotId: result.screenshotId,
        captureCount: this.captureCount
      };

    } catch (error) {
      debugLogger.log('error', 'ScreenshotService', `Capture cycle failed: ${error.message}`);
      
      if (this.onErrorCallback) {
        this.onErrorCallback({ type: 'capture_failed', message: error.message });
      }

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Start automatic capture at 1-minute intervals
   */
  start() {
    if (this.isCapturing) {
      debugLogger.log('warn', 'ScreenshotService', 'Already capturing');
      return;
    }

    if (!this.serverUrl || !this.authToken) {
      debugLogger.log('error', 'ScreenshotService', 'Cannot start - not initialized');
      return;
    }

    this.isCapturing = true;
    debugLogger.log('info', 'ScreenshotService', 'Starting capture service');

    // Capture immediately
    this.captureAndUpload();

    // Set up interval
    this.captureInterval = setInterval(() => {
      this.captureAndUpload();
    }, this.intervalMs);
  }

  /**
   * Stop automatic capture
   */
  stop() {
    if (!this.isCapturing) {
      return;
    }

    this.isCapturing = false;

    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }

    debugLogger.log('info', 'ScreenshotService', `Capture stopped. Total captures: ${this.captureCount}`);
  }

  /**
   * Update activity data (called from main process)
   */
  updateActivity(data) {
    if (data.keystrokes !== undefined) {
      this.activityData.keystrokes += data.keystrokes;
    }
    if (data.mouseClicks !== undefined) {
      this.activityData.mouseClicks += data.mouseClicks;
    }
    if (data.mouseMovements !== undefined) {
      this.activityData.mouseMovements += data.mouseMovements;
    }
    if (data.activeWindow !== undefined) {
      this.activityData.activeWindow = data.activeWindow;
    }
    if (data.activeApp !== undefined) {
      this.activityData.activeApp = data.activeApp;
    }
    if (data.isIdle !== undefined) {
      this.activityData.isIdle = data.isIdle;
    }
  }

  /**
   * Set callback for successful captures
   */
  onCapture(callback) {
    this.onCaptureCallback = callback;
  }

  /**
   * Set callback for errors
   */
  onError(callback) {
    this.onErrorCallback = callback;
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      isCapturing: this.isCapturing,
      captureCount: this.captureCount,
      lastCaptureTime: this.lastCaptureTime,
      sessionId: this.sessionId,
      intervalMs: this.intervalMs,
      serverUrl: this.serverUrl ? '***configured***' : null
    };
  }

  /**
   * Health check
   */
  async healthCheck() {
    const status = this.getStatus();
    const online = await this.isOnline();
    
    return {
      ...status,
      online,
      healthy: this.isCapturing && online
    };
  }
}

// Fix: The uploadScreenshot should call this.uploadScreenshot
// Let's create a properly bound instance
const instance = new ScreenshotService();

// Override captureAndUpload to use bound method
const originalCaptureAndUpload = instance.captureAndUpload.bind(instance);
instance.captureAndUpload = async function() {
  // Check if we should capture
  if (!this.isCapturing) {
    return { skipped: true, reason: 'not_capturing' };
  }

  if (!this.serverUrl || !this.authToken) {
    return { skipped: true, reason: 'not_initialized' };
  }

  // Check if online
  const online = await this.isOnline();
  if (!online) {
    debugLogger.log('warn', 'ScreenshotService', 'Offline - skipping capture');
    if (this.onErrorCallback) {
      this.onErrorCallback({ type: 'offline', message: 'No internet connection' });
    }
    return { skipped: true, reason: 'offline' };
  }

  try {
    // Capture screen
    const screenshotData = await this.captureScreen();

    // Upload to server
    const result = await this.uploadScreenshot(screenshotData);

    this.captureCount++;
    this.lastCaptureTime = new Date();

    // Reset activity counters after successful capture
    this.activityData.keystrokes = 0;
    this.activityData.mouseClicks = 0;
    this.activityData.mouseMovements = 0;

    // Notify success
    if (this.onCaptureCallback) {
      this.onCaptureCallback({
        success: true,
        screenshotId: result.screenshotId,
        timestamp: this.lastCaptureTime,
        captureCount: this.captureCount
      });
    }

    return {
      success: true,
      screenshotId: result.screenshotId,
      captureCount: this.captureCount
    };

  } catch (error) {
    debugLogger.log('error', 'ScreenshotService', `Capture cycle failed: ${error.message}`);
    
    if (this.onErrorCallback) {
      this.onErrorCallback({ type: 'capture_failed', message: error.message });
    }

    return {
      success: false,
      error: error.message
    };
  }
}.bind(instance);

module.exports = instance;
