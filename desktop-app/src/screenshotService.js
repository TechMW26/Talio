const { desktopCapturer, screen, systemPreferences } = require('electron');
const Store = require('electron-store');

const store = new Store();

/**
 * Screenshot Service - Simplified Version
 * 
 * Flow:
 * 1. Capture screenshot every 1 minute when clocked in
 * 2. Save locally as JPEG immediately (no compression)
 * 3. Upload to server in background
 * 4. Retry failed uploads automatically
 */
class ScreenshotService {
  constructor(options = {}) {
    // Configuration
    this.apiUrl = options.apiUrl;
    this.clockStatusUrl = options.clockStatusUrl;
    this.getAuthToken = options.getAuthToken || (() => store.get('authToken'));
    this.getUserRole = options.getUserRole || (() => store.get('userRole'));
    this.getUserId = options.getUserId || (() => store.get('userId'));
    this.interval = options.interval || 60000; // 1 minute default
    this.localStorageManager = options.localStorageManager;
    this.sessionManager = options.sessionManager;
    this.onCaptureComplete = options.onCaptureComplete;
    this.onUploadComplete = options.onUploadComplete;
    
    // State
    this.captureInterval = null;
    this.uploadInterval = null;
    this.clockCheckInterval = null;
    this.isRunning = false;
    this.isClockedIn = false;
    this.lastClockCheck = 0;
    this.captureInProgress = false;
    this.uploadInProgress = false;
    
    // Stats
    this.stats = {
      totalCaptures: 0,
      totalUploads: 0,
      failedUploads: 0,
      lastCaptureTime: null,
      lastUploadTime: null
    };

    // Role restrictions - CRITICAL: Admin screens must never be captured
    this.restrictedRoles = ['admin', 'god_admin'];
    
    // Upload queue processor interval (process pending uploads every 10 seconds)
    this.uploadProcessInterval = 10000;
  }

  /**
   * Check if current user's role allows screen capture
   */
  isRoleAllowed() {
    const role = this.getUserRole();
    return !this.restrictedRoles.includes(role);
  }

  /**
   * Start the screenshot service
   */
  start() {
    if (this.isRunning) {
      console.log('[ScreenshotService] Already running');
      return;
    }
    
    // Check role restriction
    if (!this.isRoleAllowed()) {
      console.log(`[ScreenshotService] Cannot start - role '${this.getUserRole()}' is restricted`);
      return;
    }
    
    this.isRunning = true;
    console.log('[ScreenshotService] Starting service...');
    
    // Initial clock status check
    this.checkClockStatus().then(() => {
      if (this.isClockedIn) {
        console.log('[ScreenshotService] User is clocked in, starting capture immediately');
        this.captureScreenshot();
      }
    });
    
    // Start capture interval (every 1 minute)
    this.captureInterval = setInterval(() => {
      this.captureScreenshot();
    }, this.interval);
    
    // Start clock status check (every 30 seconds)
    this.clockCheckInterval = setInterval(() => {
      this.checkClockStatus();
    }, 30000);
    
    // Start upload processor (every 10 seconds)
    this.startUploadProcessor();
    
    // Start local storage cleanup scheduler
    if (this.localStorageManager) {
      this.localStorageManager.startCleanupScheduler();
    }
    
    console.log('[ScreenshotService] Service started');
  }

  /**
   * Stop the screenshot service
   */
  stop() {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    console.log('[ScreenshotService] Stopping service...');
    
    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }
    
    if (this.clockCheckInterval) {
      clearInterval(this.clockCheckInterval);
      this.clockCheckInterval = null;
    }
    
    if (this.uploadInterval) {
      clearInterval(this.uploadInterval);
      this.uploadInterval = null;
    }
    
    if (this.localStorageManager) {
      this.localStorageManager.stop();
    }
    
    console.log('[ScreenshotService] Service stopped');
  }

  /**
   * Check if screen recording permission is granted (macOS)
   */
  async hasScreenPermission() {
    if (process.platform === 'darwin') {
      const status = systemPreferences.getMediaAccessStatus('screen');
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
        return this.isClockedIn; // Keep previous state
      }

      const data = await response.json();
      const wasClockedIn = this.isClockedIn;
      this.isClockedIn = data.success && data.isClockedIn;
      this.lastClockCheck = Date.now();
      
      // If just clocked in, capture immediately
      if (!wasClockedIn && this.isClockedIn) {
        console.log('[ScreenshotService] Just clocked in - capturing immediately');
        setTimeout(() => this.captureScreenshot(), 1000);
      }
      
      return this.isClockedIn;
    } catch (error) {
      console.error('[ScreenshotService] Clock status check failed:', error.message);
      return this.isClockedIn; // Keep previous state on error
    }
  }

  /**
   * Capture screenshot and save locally
   * Upload happens in background
   */
  async captureScreenshot() {
    // Check role restriction
    if (!this.isRoleAllowed()) {
      console.log('[ScreenshotService] Capture blocked - role restricted');
      return;
    }

    // Prevent concurrent captures
    if (this.captureInProgress) {
      console.log('[ScreenshotService] Capture already in progress');
      return;
    }

    // Refresh clock status if stale
    if (Date.now() - this.lastClockCheck > 30000) {
      await this.checkClockStatus();
    }

    // Only capture when clocked in
    if (!this.isClockedIn) {
      console.log('[ScreenshotService] Not clocked in - skipping capture');
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
    const captureTime = Date.now();

    try {
      console.log('[ScreenshotService] Capturing screenshot...');
      
      // Get primary display info
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.workAreaSize;
      const scaleFactor = primaryDisplay.scaleFactor;
      
      // Get screen sources
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.floor(width * scaleFactor),
          height: Math.floor(height * scaleFactor)
        }
      });

      if (sources.length === 0) {
        console.error('[ScreenshotService] No screen sources available');
        return;
      }

      // Get primary screen or first available
      const primarySource = sources.find(s => s.display_id === primaryDisplay.id.toString()) || sources[0];
      const thumbnail = primarySource.thumbnail;
      
      if (!thumbnail || thumbnail.isEmpty()) {
        console.error('[ScreenshotService] Empty thumbnail - permission may be denied');
        return;
      }
      
      // Convert to JPEG buffer (no WebP, no sharp compression)
      // Using Electron's native toJPEG which provides decent quality
      const imageBuffer = thumbnail.toJPEG(85); // 85% quality - good balance of size and quality
      
      console.log(`[ScreenshotService] Captured: ${(imageBuffer.length / 1024).toFixed(1)}KB`);
      
      // Get session info
      const userId = this.getUserId();
      const sessionInfo = this.sessionManager?.getCurrentSessionInfo() || {};
      
      // Save locally first
      if (this.localStorageManager) {
        const saveResult = this.localStorageManager.saveScreenshot(imageBuffer, {
          userId,
          timestamp: captureTime.toString(),
          sessionId: sessionInfo.sessionId,
          sessionNumber: sessionInfo.sessionNumber
        });
        
        if (saveResult.success) {
          this.stats.totalCaptures++;
          this.stats.lastCaptureTime = captureTime;
          
          // Record in session manager
          if (this.sessionManager) {
            this.sessionManager.recordCapture({
              localPath: saveResult.localPath,
              size: imageBuffer.length,
              userId,
              timestamp: captureTime
            });
          }
          
          // Notify callback
          if (this.onCaptureComplete) {
            this.onCaptureComplete({
              success: true,
              localPath: saveResult.localPath,
              timestamp: new Date(captureTime).toISOString(),
              size: imageBuffer.length,
              totalCaptures: this.stats.totalCaptures,
              uploadPending: true
            });
          }
          
          console.log('[ScreenshotService] Screenshot saved locally, queued for upload');
        }
      } else {
        // No local storage manager - try direct upload (fallback)
        await this.uploadScreenshotDirect(imageBuffer, userId, captureTime, sessionInfo);
      }
      
    } catch (error) {
      console.error('[ScreenshotService] Capture failed:', error.message);
    } finally {
      this.captureInProgress = false;
    }
  }

  /**
   * Start background upload processor
   */
  startUploadProcessor() {
    if (this.uploadInterval) return;
    
    this.uploadInterval = setInterval(() => {
      this.processUploadQueue();
    }, this.uploadProcessInterval);
    
    // Also process immediately
    this.processUploadQueue();
  }

  /**
   * Process pending uploads in background
   */
  async processUploadQueue() {
    if (!this.localStorageManager) return;
    if (this.uploadInProgress) return;
    
    const pendingUploads = this.localStorageManager.getPendingUploads();
    
    if (pendingUploads.length === 0) return;
    
    this.uploadInProgress = true;
    
    console.log(`[ScreenshotService] Processing ${pendingUploads.length} pending uploads...`);
    
    for (const upload of pendingUploads) {
      try {
        // Read file from local storage
        const imageBuffer = this.localStorageManager.readScreenshotFile(upload.localPath);
        
        if (!imageBuffer) {
          console.log(`[ScreenshotService] File not found, removing from queue: ${upload.filename}`);
          this.localStorageManager.markAsFailed(upload.id, 'File not found');
          continue;
        }
        
        // Upload to server
        const result = await this.uploadToServer(imageBuffer, upload);
        
        if (result.success) {
          this.localStorageManager.markAsUploaded(upload.id, result.path);
          this.stats.totalUploads++;
          this.stats.lastUploadTime = Date.now();
          
          if (this.onUploadComplete) {
            this.onUploadComplete({
              success: true,
              uploadId: upload.id,
              serverPath: result.path
            });
          }
          
          console.log(`[ScreenshotService] ✓ Uploaded: ${upload.filename}`);
        } else {
          this.localStorageManager.markAsFailed(upload.id, result.error);
          this.stats.failedUploads++;
        }
        
        // Small delay between uploads to avoid overwhelming server
        await this.delay(500);
        
      } catch (error) {
        console.error(`[ScreenshotService] Upload failed for ${upload.filename}:`, error.message);
        this.localStorageManager.markAsFailed(upload.id, error.message);
      }
    }
    
    this.uploadInProgress = false;
  }

  /**
   * Upload screenshot to server
   */
  async uploadToServer(imageBuffer, uploadRecord) {
    const token = this.getAuthToken();
    
    if (!token) {
      return { success: false, error: 'No auth token' };
    }

    try {
      // Convert to base64 for JSON upload
      const base64Data = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          screenshot: base64Data,
          timestamp: uploadRecord.timestamp,
          sessionId: uploadRecord.sessionId,
          sessionNumber: uploadRecord.sessionNumber,
          captureType: 'automatic',
          originalFilename: uploadRecord.filename
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return { success: false, error: errorData.error || `HTTP ${response.status}` };
      }

      const data = await response.json();
      return { success: true, path: data.path, ...data };
      
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Direct upload fallback (when no local storage manager)
   */
  async uploadScreenshotDirect(imageBuffer, userId, timestamp, sessionInfo) {
    const token = this.getAuthToken();
    if (!token) return;

    try {
      const base64Data = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          screenshot: base64Data,
          timestamp: timestamp.toString(),
          sessionId: sessionInfo.sessionId,
          sessionNumber: sessionInfo.sessionNumber,
          captureType: 'automatic'
        })
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`[ScreenshotService] ✓ Direct upload successful: ${data.path}`);
        this.stats.totalCaptures++;
        this.stats.totalUploads++;
      }
    } catch (error) {
      console.error('[ScreenshotService] Direct upload failed:', error.message);
    }
  }

  /**
   * Force capture now (for testing/manual trigger)
   */
  async forceCapture() {
    if (!this.isRoleAllowed()) {
      return { success: false, error: 'Role restricted from screen capture' };
    }

    // Temporarily enable capture
    const wasClockedIn = this.isClockedIn;
    this.isClockedIn = true;
    
    try {
      await this.captureScreenshot();
      return { success: true };
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
      isRoleAllowed: this.isRoleAllowed(),
      currentRole: this.getUserRole(),
      stats: this.stats,
      localStorageStats: this.localStorageManager?.getStats() || null,
      pendingUploads: this.localStorageManager?.getPendingUploads()?.length || 0
    };
  }

  /**
   * Utility: delay helper
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { ScreenshotService };
