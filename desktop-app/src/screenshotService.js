/**
 * Screenshot Service v6.0.0
 * Handles automatic screen capture with ImageKit uploads
 * Uses main-process desktopCapturer via IPC (Electron 35+ compatibility)
 */

const { screen } = require('electron');
const fetch = require('node-fetch');
const FormData = require('form-data');
const logger = require('./logger');
const sessionManager = require('./sessionManager');
const offlineQueue = require('./offlineQueue');

// Configuration
const CAPTURE_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes
const API_BASE_URL = 'https://app.talio.in';
const JPEG_QUALITY = 80;

class ScreenshotService {
  constructor() {
    this.isCapturing = false;
    this.captureTimer = null;
    this.userId = null;
    this.employeeId = null;
    this.userRole = null;
    this.token = null;
    this.isOnline = true;
    this.mainWindow = null;
    this.captureCount = 0;
    this.lastCaptureTime = null;
    this.onPermissionError = null; // Callback for permission errors
    this.permissionErrorShown = false; // Only show once per session
    this.getDesktopSources = null; // IPC function to get desktop sources from renderer
    this.checkPermission = null; // Function to check screen recording permission
    this.consecutiveFailures = 0; // Track consecutive capture failures
    this.lastStartTime = 0; // Debounce start() calls
    this.isClockedIn = false; // Whether user has clocked in to attendance
  }

  initialize(config) {
    // Stop any existing capture session before re-initializing
    // This fixes the bug where isCapturing stays true after window recreation/crash
    if (this.isCapturing || this.captureTimer) {
      logger.log('info', 'ScreenshotService', 'Stopping existing capture before re-initialization');
      if (this.captureTimer) {
        clearInterval(this.captureTimer);
        this.captureTimer = null;
      }
      this.isCapturing = false;
    }

    this.userId = config.userId;
    this.employeeId = config.employeeId;
    this.userRole = config.role;
    this.token = config.token;
    this.mainWindow = config.mainWindow;
    this.getDesktopSources = config.getDesktopSources || null;
    this.checkPermission = config.checkPermission || null;
    this.onPermissionError = config.onPermissionError || null;
    this.permissionErrorShown = false;
    this.consecutiveFailures = 0;
    
    // Initialize offline queue with upload function
    var self = this;
    offlineQueue.initialize(function(data) {
      return self.uploadScreenshot(data.buffer, data);
    });
    
    // Initialize session manager
    sessionManager.initialize(this.userId);
    
    logger.log('info', 'ScreenshotService', 'Initialized for user ' + this.userId + ' (role: ' + this.userRole + ')');
  }

  /**
   * Reset permission error flag so the error dialog can be shown again.
   * Called when screen recording permission is newly granted.
   */
  resetPermissionError() {
    this.permissionErrorShown = false;
    this.consecutiveFailures = 0;
    logger.log('info', 'ScreenshotService', 'Permission error state reset — captures will retry');
  }

  // Show permission error notification (only once per session until reset)
  showPermissionError(message) {
    if (!this.permissionErrorShown && this.onPermissionError) {
      this.onPermissionError(message);
      this.permissionErrorShown = true;
    }
  }

  /**
   * Check if screen recording permission is available before attempting capture.
   * Returns true if capture should proceed, false if permission is missing.
   */
  hasScreenPermission() {
    if (!this.checkPermission) return true; // No checker = assume OK
    var status = this.checkPermission();
    return status === 'granted';
  }

  shouldCapture() {
    // CRITICAL: Admin users should NEVER be captured
    if (this.userRole === 'admin') {
      logger.log('info', 'ScreenshotService', 'Admin user - capture disabled');
      return false;
    }
    return true;
  }

  /**
   * Set clock-in status. Screenshots only captured while clocked in.
   */
  setClockedIn(status) {
    var wasClockedIn = this.isClockedIn;
    this.isClockedIn = !!status;
    logger.log('info', 'ScreenshotService', 'Clock-in status changed: ' + wasClockedIn + ' -> ' + this.isClockedIn);

    if (this.isClockedIn && !wasClockedIn) {
      // User just clocked in — start capturing
      this.start();
    } else if (!this.isClockedIn && wasClockedIn) {
      // User just clocked out — stop capturing
      this.stop();
      logger.log('info', 'ScreenshotService', 'Capture stopped: user clocked out');
    }
  }

  getClockedIn() {
    return this.isClockedIn;
  }

  start() {
    if (!this.shouldCapture()) {
      logger.log('info', 'ScreenshotService', 'Capture not allowed for this user');
      return false;
    }

    if (!this.isClockedIn) {
      logger.log('info', 'ScreenshotService', 'Not clocked in - capture will not start until clock-in');
      return false;
    }

    // Debounce: if already capturing and start was called recently (within 30s), skip
    var now = Date.now();
    if (this.isCapturing && this.captureTimer && (now - this.lastStartTime) < 30000) {
      logger.log('debug', 'ScreenshotService', 'start() debounced — already capturing (started ' + Math.round((now - this.lastStartTime) / 1000) + 's ago)');
      return true;
    }
    
    if (this.isCapturing) {
      logger.log('warn', 'ScreenshotService', 'Already capturing — stopping old session and restarting');
      this.stop();
    }
    
    this.isCapturing = true;
    this.lastStartTime = now;
    
    // Take first screenshot immediately
    this.captureScreen('session_start');
    
    // Start interval
    var self = this;
    this.captureTimer = setInterval(function() {
      self.captureScreen('automatic');
    }, CAPTURE_INTERVAL_MS);
    
    logger.log('info', 'ScreenshotService', 'Started capturing every ' + (CAPTURE_INTERVAL_MS / 1000) + ' seconds');
    return true;
  }

  stop() {
    if (this.captureTimer) {
      clearInterval(this.captureTimer);
      this.captureTimer = null;
    }
    
    this.isCapturing = false;
    sessionManager.endSession();
    
    logger.log('info', 'ScreenshotService', 'Stopped capturing. Total: ' + this.captureCount);
  }

  setOnlineStatus(online) {
    this.isOnline = online;
    offlineQueue.setOnlineStatus(online);
    logger.log('info', 'ScreenshotService', 'Online status: ' + online);
  }

  async captureScreen(captureType) {
    if (!this.isCapturing && captureType === 'automatic') {
      return null;
    }
    
    // Double check admin restriction
    if (this.userRole === 'admin') {
      logger.log('warn', 'ScreenshotService', 'Blocked capture attempt for admin');
      return null;
    }

    // Block captures if user is not clocked in
    if (!this.isClockedIn) {
      logger.log('info', 'ScreenshotService', 'Capture skipped - user not clocked in');
      this.stop();
      return null;
    }

    // Pre-capture permission check (avoids unnecessary IPC calls when permission is missing)
    if (!this.hasScreenPermission()) {
      logger.log('warn', 'ScreenshotService', 'Screen recording permission not granted — skipping capture');
      this.showPermissionError('Screen Recording permission is required. Please grant permission in System Preferences → Privacy & Security → Screen Recording.');
      return { success: false, error: 'Screen recording permission not granted' };
    }
    
    try {
      logger.log('debug', 'ScreenshotService', 'Capturing screen (' + captureType + ')');
      
      if (!this.getDesktopSources) {
        throw new Error('Desktop sources function not available - window may not be loaded');
      }

      // Get all screens via main process desktopCapturer
      const sources = await this.getDesktopSources({
        types: ['screen'],
        thumbnailSize: this.getOptimalSize()
      });
      
      if (!sources || sources.length === 0) {
        this.consecutiveFailures++;
        logger.log('error', 'ScreenshotService', 'No screen sources available (failure #' + this.consecutiveFailures + ')');
        this.showPermissionError(process.platform === 'darwin'
          ? 'Screen Recording permission may be required. Please check System Preferences → Privacy & Security → Screen Recording.'
          : 'Screen capture is not working. Please check your security software or try running Talio as Administrator.');
        throw new Error('No screen sources available');
      }
      
      // Get primary display
      const primaryDisplay = screen.getPrimaryDisplay();
      var primarySource = sources.find(function(s) { 
        return s.display_id === String(primaryDisplay.id); 
      }) || sources[0];
      
      // Check if thumbnail is empty (permission denied often results in blank thumbnail)
      if (primarySource.isEmpty) {
        this.consecutiveFailures++;
        logger.log('error', 'ScreenshotService', 'Screenshot is empty (failure #' + this.consecutiveFailures + ')');
        this.showPermissionError(process.platform === 'darwin'
          ? 'Screenshots are blank. Please grant Screen Recording permission in System Preferences → Privacy & Security → Screen Recording.'
          : 'Screenshots are blank. Please check your security software or try running Talio as Administrator.');
        throw new Error('Screenshot is empty - Screen Recording permission not granted');
      }
      
      // Convert base64 JPEG data back to a Buffer
      const buffer = Buffer.from(primarySource.thumbnailJPEG, 'base64');
      
      // Additional check for buffer size (very small = likely failed capture)
      if (buffer.length < 1000) {
        this.consecutiveFailures++;
        logger.log('error', 'ScreenshotService', 'Screenshot buffer too small (' + buffer.length + ' bytes, failure #' + this.consecutiveFailures + ')');
        throw new Error('Screenshot capture failed - buffer too small');
      }
      
      logger.log('debug', 'ScreenshotService', 'Screenshot captured successfully (' + buffer.length + ' bytes)');
      
      // Reset failure counter on success
      this.consecutiveFailures = 0;
      this.captureCount++;
      this.lastCaptureTime = new Date().toISOString();
      
      // Record in session
      const sessionData = sessionManager.recordCapture({
        captureType: captureType,
        offline: !this.isOnline
      });
      
      // Upload or queue
      if (this.isOnline) {
        const result = await this.uploadScreenshot(buffer, {
          captureType: captureType,
          sessionId: sessionData.sessionId
        });
        
        // Update session with upload result
        if (result.success) {
          sessionData.capture.imageUrl = result.imageUrl;
          sessionData.capture.imagekitFileId = result.imagekitFileId;
        }
        
        return result;
      } else {
        // Queue for later upload
        return offlineQueue.add({
          buffer: buffer,
          userId: this.userId,
          employeeId: this.employeeId,
          captureType: captureType,
          sessionId: sessionData.sessionId,
          timestamp: this.lastCaptureTime
        });
      }
    } catch (error) {
      logger.log('error', 'ScreenshotService', 'Capture failed: ' + error.message);
      return { success: false, error: error.message };
    }
  }

  getOptimalSize() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const scaleFactor = primaryDisplay.scaleFactor || 1;
    
    // Capture at reasonable resolution (cap at 1920x1080 for bandwidth)
    return {
      width: Math.min(1920, primaryDisplay.workAreaSize.width * scaleFactor),
      height: Math.min(1080, primaryDisplay.workAreaSize.height * scaleFactor)
    };
  }

  async uploadScreenshot(buffer, metadata) {
    metadata = metadata || {};
    
    try {
      const formData = new FormData();
      formData.append('screenshot', buffer, {
        filename: 'screenshot_' + Date.now() + '.jpg',
        contentType: 'image/jpeg'
      });
      formData.append('captureType', metadata.captureType || 'automatic');
      formData.append('timestamp', metadata.timestamp || new Date().toISOString());
      
      if (metadata.sessionId) {
        formData.append('sessionId', metadata.sessionId);
      }
      
      const response = await fetch(API_BASE_URL + '/api/activity/screenshot', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + this.token
        },
        body: formData
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error('Upload failed: ' + response.status + ' - ' + errorText);
      }
      
      const result = await response.json();
      
      logger.log('info', 'ScreenshotService', 'Uploaded successfully: ' + (result.imagekitUrl || result.imageUrl || 'OK'));
      
      return {
        success: true,
        imageUrl: result.imagekitUrl || result.imageUrl,
        imagekitFileId: result.imagekitFileId,
        screenshotId: result.screenshotId || result._id
      };
    } catch (error) {
      logger.log('error', 'ScreenshotService', 'Upload failed: ' + error.message);
      
      // If network error and we have a buffer, queue it
      if (!metadata.isRetry && buffer) {
        return offlineQueue.add({
          buffer: buffer,
          userId: this.userId,
          employeeId: this.employeeId,
          captureType: metadata.captureType || 'automatic',
          sessionId: metadata.sessionId,
          timestamp: metadata.timestamp || new Date().toISOString()
        });
      }
      
      return { success: false, error: error.message };
    }
  }

  async manualCapture() {
    // Allow manual captures even if auto-capture is paused
    // But still block admins
    if (this.userRole === 'admin') {
      logger.log('warn', 'ScreenshotService', 'Manual capture blocked for admin');
      return { success: false, error: 'Admin users cannot capture screenshots' };
    }
    
    return await this.captureScreen('manual');
  }

  getStatus() {
    return {
      isCapturing: this.isCapturing,
      isClockedIn: this.isClockedIn,
      captureCount: this.captureCount,
      lastCaptureTime: this.lastCaptureTime,
      isOnline: this.isOnline,
      session: sessionManager.getSessionInfo(),
      queue: offlineQueue.getStatus(),
      userRole: this.userRole,
      captureAllowed: this.shouldCapture()
    };
  }

  getStats() {
    return {
      today: sessionManager.getTodayStats(),
      history: sessionManager.getHistory(7),
      queue: offlineQueue.getStatus()
    };
  }

  reset() {
    this.stop();
    this.captureCount = 0;
    this.lastCaptureTime = null;
    sessionManager.reset();
    offlineQueue.reset();
    logger.log('info', 'ScreenshotService', 'Reset complete');
  }
}

module.exports = new ScreenshotService();
