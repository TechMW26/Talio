const { desktopCapturer, screen, systemPreferences } = require('electron');
const Store = require('electron-store');

const store = new Store();

/**
 * Screenshot Service - Robust Version
 * 
 * - Captures every 1 minute after login (NO clock-in requirement)
 * - Saves locally as JPEG first
 * - Uploads in background with retry
 * - Detailed logging for debugging
 */
class ScreenshotService {
  constructor(options = {}) {
    this.apiUrl = options.apiUrl;
    this.healthUrl = options.healthUrl;
    this.getAuthToken = options.getAuthToken || (() => store.get('authToken'));
    this.getUserRole = options.getUserRole || (() => store.get('userRole'));
    this.getUserId = options.getUserId || (() => store.get('userId'));
    this.interval = options.interval || 60000; // 1 minute
    this.requireClockIn = options.requireClockIn ?? false; // DEFAULT: false - always capture
    this.localStorageManager = options.localStorageManager;
    this.sessionManager = options.sessionManager;
    this.logger = options.logger || console;
    
    // Callbacks
    this.onCaptureStart = options.onCaptureStart;
    this.onCaptureComplete = options.onCaptureComplete;
    this.onCaptureFailed = options.onCaptureFailed;
    this.onUploadComplete = options.onUploadComplete;
    this.onUploadFailed = options.onUploadFailed;
    this.onUploadStart = options.onUploadStart;
    
    // State
    this.captureInterval = null;
    this.uploadInterval = null;
    this.isRunning = false;
    this.captureInProgress = false;
    this.uploadInProgress = false;
    
    // Stats
    this.stats = {
      totalCaptures: 0,
      totalUploads: 0,
      failedCaptures: 0,
      failedUploads: 0,
      lastCaptureTime: null,
      lastUploadTime: null,
      lastError: null
    };

    // Restricted roles
    this.restrictedRoles = ['admin', 'god_admin'];
    
    // Upload processor interval
    this.uploadProcessInterval = 10000; // 10 seconds
  }

  /**
   * Check if role allows capture
   */
  isRoleAllowed() {
    const role = this.getUserRole();
    const allowed = !this.restrictedRoles.includes(role);
    this.logger.debug?.(`Role check: ${role} - ${allowed ? 'allowed' : 'restricted'}`);
    return allowed;
  }

  /**
   * Check screen permission (macOS)
   */
  async hasScreenPermission() {
    if (process.platform === 'darwin') {
      const status = systemPreferences.getMediaAccessStatus('screen');
      this.logger.debug?.(`Screen permission: ${status}`);
      return status === 'granted';
    }
    return true;
  }

  /**
   * Start the service
   */
  start() {
    if (this.isRunning) {
      this.logger.info?.('[Screenshot] Already running');
      return;
    }
    
    if (!this.isRoleAllowed()) {
      this.logger.info?.(`[Screenshot] Cannot start - role restricted`);
      return;
    }
    
    this.isRunning = true;
    this.logger.info?.('[Screenshot] Service STARTED');
    this.logger.info?.(`[Screenshot] Interval: ${this.interval}ms, RequireClockIn: ${this.requireClockIn}`);
    
    // Start capture interval
    this.captureInterval = setInterval(() => {
      this.captureScreenshot();
    }, this.interval);
    
    // Start upload processor
    this.startUploadProcessor();
    
    // Start cleanup scheduler
    this.localStorageManager?.startCleanupScheduler();
  }

  /**
   * Stop the service
   */
  stop() {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    this.logger.info?.('[Screenshot] Service STOPPED');
    
    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }
    
    if (this.uploadInterval) {
      clearInterval(this.uploadInterval);
      this.uploadInterval = null;
    }
    
    this.localStorageManager?.stop();
  }

  /**
   * Capture screenshot
   */
  async captureScreenshot() {
    const captureId = Date.now();
    this.logger.info?.(`[Screenshot] [${captureId}] Starting capture...`);
    
    // Role check
    if (!this.isRoleAllowed()) {
      this.logger.info?.(`[Screenshot] [${captureId}] Blocked - role restricted`);
      return;
    }

    // Prevent concurrent captures
    if (this.captureInProgress) {
      this.logger.info?.(`[Screenshot] [${captureId}] Skipped - capture in progress`);
      return;
    }

    // Permission check (macOS)
    if (process.platform === 'darwin') {
      const hasPermission = await this.hasScreenPermission();
      if (!hasPermission) {
        this.logger.error?.(`[Screenshot] [${captureId}] No screen permission!`);
        this.stats.lastError = 'No screen permission';
        this.onCaptureFailed?.('No screen permission');
        return;
      }
    }

    this.captureInProgress = true;
    this.onCaptureStart?.();
    const startTime = Date.now();

    try {
      // Get display info
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.workAreaSize;
      const scaleFactor = primaryDisplay.scaleFactor;
      
      this.logger.debug?.(`[Screenshot] [${captureId}] Display: ${width}x${height} @${scaleFactor}x`);
      
      // Get screen sources
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.floor(width * scaleFactor),
          height: Math.floor(height * scaleFactor)
        }
      });

      if (sources.length === 0) {
        throw new Error('No screen sources available');
      }

      const source = sources.find(s => s.display_id === primaryDisplay.id.toString()) || sources[0];
      const thumbnail = source.thumbnail;
      
      if (!thumbnail || thumbnail.isEmpty()) {
        throw new Error('Empty thumbnail - permission may be denied');
      }
      
      // Convert to JPEG (85% quality)
      const imageBuffer = thumbnail.toJPEG(85);
      const sizeKB = (imageBuffer.length / 1024).toFixed(1);
      
      this.logger.info?.(`[Screenshot] [${captureId}] Captured: ${sizeKB}KB`);
      
      // Get session info
      const userId = this.getUserId();
      const sessionInfo = this.sessionManager?.getCurrentSessionInfo() || {};
      
      // Save locally
      if (this.localStorageManager) {
        const saveResult = this.localStorageManager.saveScreenshot(imageBuffer, {
          userId,
          timestamp: startTime.toString(),
          sessionId: sessionInfo.sessionId,
          sessionNumber: sessionInfo.sessionNumber
        });
        
        if (saveResult.success) {
          this.stats.totalCaptures++;
          this.stats.lastCaptureTime = startTime;
          
          // Record in session
          this.sessionManager?.recordCapture({
            localPath: saveResult.localPath,
            size: imageBuffer.length,
            userId,
            timestamp: startTime
          });
          
          const elapsed = Date.now() - startTime;
          this.logger.info?.(`[Screenshot] [${captureId}] Saved locally in ${elapsed}ms: ${saveResult.filename}`);
          
          this.onCaptureComplete?.({
            success: true,
            localPath: saveResult.localPath,
            timestamp: new Date(startTime).toISOString(),
            size: imageBuffer.length,
            totalCaptures: this.stats.totalCaptures
          });
        } else {
          throw new Error(`Failed to save: ${saveResult.error}`);
        }
      } else {
        // Direct upload fallback
        await this.uploadDirect(imageBuffer, userId, startTime, sessionInfo);
      }
      
    } catch (error) {
      this.stats.failedCaptures++;
      this.stats.lastError = error.message;
      this.logger.error?.(`[Screenshot] [${captureId}] FAILED: ${error.message}`);
      this.onCaptureFailed?.(error.message);
    } finally {
      this.captureInProgress = false;
    }
  }

  /**
   * Start upload processor
   */
  startUploadProcessor() {
    if (this.uploadInterval) return;
    
    this.uploadInterval = setInterval(() => {
      this.processUploadQueue();
    }, this.uploadProcessInterval);
    
    // Process immediately
    setTimeout(() => this.processUploadQueue(), 1000);
  }

  /**
   * Process pending uploads
   */
  async processUploadQueue() {
    if (!this.localStorageManager) return;
    if (this.uploadInProgress) return;
    
    const pending = this.localStorageManager.getPendingUploads();
    if (pending.length === 0) return;
    
    this.uploadInProgress = true;
    this.onUploadStart?.();
    
    this.logger.info?.(`[Upload] Processing ${pending.length} pending uploads...`);
    
    for (const upload of pending) {
      try {
        const imageBuffer = this.localStorageManager.readScreenshotFile(upload.localPath);
        
        if (!imageBuffer) {
          this.logger.warn?.(`[Upload] File not found: ${upload.filename}`);
          this.localStorageManager.markAsFailed(upload.id, 'File not found');
          continue;
        }
        
        const result = await this.uploadToServer(imageBuffer, upload);
        
        if (result.success) {
          this.localStorageManager.markAsUploaded(upload.id, result.path);
          this.stats.totalUploads++;
          this.stats.lastUploadTime = Date.now();
          this.logger.info?.(`[Upload] ✓ Success: ${upload.filename} -> ${result.path}`);
          this.onUploadComplete?.({ uploadId: upload.id, serverPath: result.path });
        } else {
          this.localStorageManager.markAsFailed(upload.id, result.error);
          this.stats.failedUploads++;
          this.logger.error?.(`[Upload] ✗ Failed: ${upload.filename} - ${result.error}`);
          this.onUploadFailed?.(result.error);
        }
        
        // Delay between uploads
        await this.delay(500);
        
      } catch (error) {
        this.logger.error?.(`[Upload] Error for ${upload.filename}: ${error.message}`);
        this.localStorageManager.markAsFailed(upload.id, error.message);
      }
    }
    
    this.uploadInProgress = false;
  }

  /**
   * Upload to server
   */
  async uploadToServer(imageBuffer, uploadRecord) {
    const token = this.getAuthToken();
    if (!token) {
      return { success: false, error: 'No auth token' };
    }

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
   * Direct upload fallback
   */
  async uploadDirect(imageBuffer, userId, timestamp, sessionInfo) {
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
        this.logger.info?.(`[Screenshot] Direct upload success: ${data.path}`);
        this.stats.totalCaptures++;
        this.stats.totalUploads++;
        this.onCaptureComplete?.({ success: true, path: data.path });
      }
    } catch (error) {
      this.logger.error?.(`[Screenshot] Direct upload failed: ${error.message}`);
    }
  }

  /**
   * Force capture now
   */
  async forceCapture() {
    if (!this.isRoleAllowed()) {
      return { success: false, error: 'Role restricted' };
    }

    this.logger.info?.('[Screenshot] Force capture triggered');
    await this.captureScreenshot();
    return { success: true };
  }

  /**
   * Get status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      requireClockIn: this.requireClockIn,
      isRoleAllowed: this.isRoleAllowed(),
      currentRole: this.getUserRole(),
      stats: this.stats,
      pendingUploads: this.localStorageManager?.getPendingUploads()?.length || 0
    };
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { ScreenshotService };
