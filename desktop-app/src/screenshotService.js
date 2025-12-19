const { desktopCapturer, screen, systemPreferences } = require('electron');
const Store = require('electron-store');

const store = new Store();

/**
 * Screenshot Service
 * Captures full screen every minute and uploads when user is clocked in
 * Enforces role-based capture restrictions
 */
class ScreenshotService {
  constructor(options = {}) {
    this.apiUrl = options.apiUrl;
    this.clockStatusUrl = options.clockStatusUrl;
    this.userInfoUrl = options.userInfoUrl;
    this.getAuthToken = options.getAuthToken || (() => store.get('authToken'));
    this.getUserRole = options.getUserRole || (() => store.get('userRole'));
    this.getUserId = options.getUserId || (() => store.get('userId'));
    this.interval = options.interval || 60000; // Default 1 minute
    this.sessionManager = options.sessionManager;
    this.offlineManager = options.offlineManager;
    this.onCaptureComplete = options.onCaptureComplete;
    
    this.intervalId = null;
    this.isRunning = false;
    this.isClockedIn = false;
    this.lastClockCheck = 0;
    this.clockCheckInterval = 30000; // Check clock status every 30 seconds
    this.lastCaptureTime = 0;
    this.captureInProgress = false;
    this.totalCaptures = 0;

    // Role-based restrictions - CRITICAL
    this.restrictedRoles = ['admin', 'god_admin'];
  }

  /**
   * Check if current user's role allows capture
   */
  isRoleAllowed() {
    const role = this.getUserRole();
    const isRestricted = this.restrictedRoles.includes(role);
    
    if (isRestricted) {
      console.log(`[ScreenshotService] Role '${role}' is restricted - capture disabled`);
    }
    
    return !isRestricted;
  }

  /**
   * Start the screenshot service
   */
  start() {
    if (this.isRunning) return;
    
    // CRITICAL: Check role restriction before starting
    if (!this.isRoleAllowed()) {
      console.log('[ScreenshotService] Cannot start - user role is restricted');
      return;
    }
    
    this.isRunning = true;
    console.log('[ScreenshotService] Starting...');
    
    // Initial clock status check
    this.checkClockStatus().then(() => {
      if (this.isClockedIn) {
        console.log('[ScreenshotService] Already clocked in, taking immediate screenshot');
        this.captureAndUpload();
      }
    });
    
    // Start interval for screenshots (every 1 minute)
    this.intervalId = setInterval(() => {
      this.captureAndUpload();
    }, this.interval);

    // Start clock status check interval
    this.clockCheckIntervalId = setInterval(() => {
      this.checkClockStatus();
    }, this.clockCheckInterval);
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
    // CRITICAL: Re-check role restriction on every capture
    if (!this.isRoleAllowed()) {
      console.log('[ScreenshotService] Capture blocked - role is restricted');
      return;
    }

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
    const captureStartTime = Date.now();

    try {
      console.log('[ScreenshotService] Capturing screenshot...');
      
      // Get all displays for multi-monitor support
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

      // Capture primary screen (or first available)
      const primarySource = sources.find(s => s.display_id === primaryDisplay.id.toString()) || sources[0];
      const thumbnail = primarySource.thumbnail;
      
      if (!thumbnail || thumbnail.isEmpty()) {
        console.error('[ScreenshotService] Empty thumbnail - screen recording permission may be denied');
        this.captureInProgress = false;
        return;
      }
      
      // Convert to WebP with compression
      let imageBuffer;
      let mimeType = 'image/webp';
      
      try {
        const sharp = require('sharp');
        const pngBuffer = thumbnail.toPNG();
        
        imageBuffer = await sharp(pngBuffer)
          .webp({ quality: 70, effort: 4 })
          .toBuffer();
        
        console.log(`[ScreenshotService] Compressed to WebP: ${(imageBuffer.length / 1024).toFixed(1)}KB`);
      } catch (sharpError) {
        // Fallback to PNG if sharp is not available
        console.log('[ScreenshotService] Sharp not available, using PNG:', sharpError.message);
        imageBuffer = thumbnail.toPNG();
        mimeType = 'image/png';
        console.log(`[ScreenshotService] Using PNG: ${(imageBuffer.length / 1024).toFixed(1)}KB`);
      }

      // Get session info
      const userId = this.getUserId();
      const sessionInfo = this.sessionManager?.getCurrentSessionInfo() || {};

      // Upload to server
      const uploadResult = await this.uploadScreenshot(imageBuffer, mimeType, token, userId, sessionInfo);
      
      // Record in session manager
      if (uploadResult.success && this.sessionManager) {
        const sessionResult = this.sessionManager.recordCapture({
          path: uploadResult.path,
          size: imageBuffer.length,
          userId
        });
        console.log(`[ScreenshotService] Session #${sessionResult.sessionNumber}, Capture #${sessionResult.captureNumber}`);
      }

      this.lastCaptureTime = Date.now();
      this.totalCaptures++;
      
      // Notify callback
      if (this.onCaptureComplete) {
        this.onCaptureComplete({
          success: true,
          path: uploadResult.path,
          timestamp: new Date().toISOString(),
          captureTime: Date.now() - captureStartTime,
          size: imageBuffer.length,
          totalCaptures: this.totalCaptures
        });
      }
      
    } catch (error) {
      console.error('[ScreenshotService] Capture failed:', error.message);
      
      // If upload failed due to network, queue for later
      if (this.offlineManager && error.message.includes('fetch')) {
        try {
          const userId = this.getUserId();
          const sessionInfo = this.sessionManager?.getCurrentSessionInfo() || {};
          
          await this.offlineManager.addToQueue({
            imageBuffer,
            timestamp: Date.now().toString(),
            userId,
            sessionId: sessionInfo.sessionId
          });
        } catch (queueError) {
          console.error('[ScreenshotService] Failed to queue capture:', queueError.message);
        }
      }
    } finally {
      this.captureInProgress = false;
    }
  }

  /**
   * Upload screenshot to server
   */
  async uploadScreenshot(imageBuffer, mimeType, token, userId, sessionInfo) {
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
          timestamp: timestamp.toString(),
          sessionId: sessionInfo.sessionId,
          sessionNumber: sessionInfo.sessionNumber,
          captureType: 'automatic'
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log(`[ScreenshotService] ✓ Uploaded successfully: ${data.path}`);
      
      return { success: true, ...data };
    } catch (error) {
      console.error(`[ScreenshotService] Upload failed:`, error.message);
      throw error;
    }
  }

  /**
   * Force capture now (for debugging/testing)
   */
  async forceCapture() {
    // CRITICAL: Check role restriction
    if (!this.isRoleAllowed()) {
      console.log('[ScreenshotService] Force capture blocked - role is restricted');
      return { success: false, error: 'Role is restricted from screen capture' };
    }

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
   * Capture for multi-monitor support
   */
  async captureAllDisplays() {
    // CRITICAL: Check role restriction
    if (!this.isRoleAllowed()) {
      return { success: false, error: 'Role is restricted' };
    }

    const displays = screen.getAllDisplays();
    const captures = [];

    for (const display of displays) {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: {
            width: Math.floor(display.size.width * display.scaleFactor),
            height: Math.floor(display.size.height * display.scaleFactor)
          }
        });

        const source = sources.find(s => s.display_id === display.id.toString());
        if (source && source.thumbnail && !source.thumbnail.isEmpty()) {
          captures.push({
            displayId: display.id,
            thumbnail: source.thumbnail,
            bounds: display.bounds,
            scaleFactor: display.scaleFactor
          });
        }
      } catch (error) {
        console.error(`[ScreenshotService] Failed to capture display ${display.id}:`, error.message);
      }
    }

    return captures;
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
      restrictedRoles: this.restrictedRoles,
      lastClockCheck: this.lastClockCheck,
      lastCaptureTime: this.lastCaptureTime,
      captureInProgress: this.captureInProgress,
      interval: this.interval,
      totalCaptures: this.totalCaptures,
      offlineQueueLength: this.offlineManager?.getStatus()?.queueLength || 0
    };
  }
}

module.exports = { ScreenshotService };
