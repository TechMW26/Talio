const { systemPreferences, dialog, desktopCapturer, Notification, shell } = require('electron');
const Store = require('electron-store');

const store = new Store();

/**
 * Permission Handler
 * Requests all required permissions through native popups after user login
 */
class PermissionHandler {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.permissions = {
      camera: false,
      microphone: false,
      screen: false,
      notifications: false,
      location: false
    };
    this.permissionCheckInterval = null;
    this.hasRequestedPermissions = false;
    this.lastPermissionCheck = 0;
  }

  /**
   * Called when user successfully logs in - request all permissions
   */
  async onUserLogin() {
    console.log('[PermissionHandler] User logged in - requesting all permissions...');
    
    // Mark that we've requested permissions this session
    this.hasRequestedPermissions = true;
    store.set('lastPermissionRequest', Date.now());
    
    const platform = process.platform;

    if (platform === 'darwin') {
      await this.requestMacPermissionsSequentially();
    } else if (platform === 'win32') {
      await this.requestWindowsPermissions();
    }

    // Start monitoring for permission changes
    this.startPermissionMonitoring();
    
    return this.permissions;
  }

  /**
   * Fallback: Request permissions if not already granted (even without login detection)
   */
  async requestPermissionsIfNeeded() {
    await this.checkAllPermissions();
    
    // If screen permission is not granted and we haven't asked recently
    const lastRequest = store.get('lastPermissionRequest', 0);
    const hoursSinceLastRequest = (Date.now() - lastRequest) / (1000 * 60 * 60);
    
    if (!this.permissions.screen && hoursSinceLastRequest > 1) {
      console.log('[PermissionHandler] Screen permission not granted, requesting...');
      await this.onUserLogin();
    } else if (!this.permissions.screen) {
      // Just show notification without full dialog flow
      this.showPermissionNotification();
    }
  }

  /**
   * Request macOS permissions one by one with native dialogs
   */
  async requestMacPermissionsSequentially() {
    console.log('[PermissionHandler] Requesting macOS permissions sequentially...');

    // Check current status first
    await this.checkAllPermissions();
    
    // If all permissions are already granted, skip
    if (this.permissions.screen && this.permissions.camera && this.permissions.microphone) {
      console.log('[PermissionHandler] All permissions already granted');
      return;
    }

    // Show initial dialog explaining what's about to happen
    await dialog.showMessageBox(this.mainWindow, {
      type: 'info',
      title: 'Welcome to Talio',
      message: 'Talio needs a few permissions to work properly',
      detail: `We'll now ask for the following permissions:

• Screen Recording - For productivity monitoring
• Camera - For video calls and meetings  
• Microphone - For audio calls and meetings

Please grant these permissions when prompted.`,
      buttons: ['Continue'],
      defaultId: 0
    });

    // 1. Screen Recording (MOST IMPORTANT - do first)
    if (!this.permissions.screen) {
      await this.requestScreenRecordingPermission();
      await this.delay(500);
    }

    // 2. Camera
    if (!this.permissions.camera) {
      await this.requestCameraPermission();
      await this.delay(500);
    }

    // 3. Microphone
    if (!this.permissions.microphone) {
      await this.requestMicrophonePermission();
    }

    // 4. Check final status and show summary
    await this.checkAllPermissions();
    await this.showPermissionSummary();
  }

  /**
   * Request Windows permissions - show informational dialog
   */
  async requestWindowsPermissions() {
    console.log('[PermissionHandler] Requesting Windows permissions...');

    await dialog.showMessageBox(this.mainWindow, {
      type: 'info',
      title: 'Welcome to Talio',
      message: 'Talio needs the following permissions to work properly:',
      detail: `• Screen Recording - For productivity monitoring
  Screenshots are captured every minute while you're clocked in.

• Camera & Microphone - For video calls and meetings

• Notifications - For alerts and updates

• Location - For attendance geofencing

Windows will automatically grant screen recording access.
Please allow other permissions when prompted by the system.`,
      buttons: ['Got it!'],
      defaultId: 0
    });

    // Trigger a screen capture to verify it works
    const captureWorks = await this.triggerScreenCapture();
    
    if (!captureWorks) {
      await dialog.showMessageBox(this.mainWindow, {
        type: 'warning',
        title: 'Screen Capture Issue',
        message: 'Screen capture test failed',
        detail: 'Please make sure no other applications are blocking screen capture. You may need to restart the app.',
        buttons: ['OK']
      });
    }
    
    // Set permissions status for Windows
    this.permissions.screen = captureWorks;
    this.permissions.camera = true;
    this.permissions.microphone = true;
    this.permissions.notifications = Notification.isSupported();

    console.log('[PermissionHandler] Windows permissions set:', this.permissions);
  }

  /**
   * Request camera permission (macOS)
   */
  async requestCameraPermission() {
    if (process.platform !== 'darwin') return true;

    const status = systemPreferences.getMediaAccessStatus('camera');
    console.log(`[PermissionHandler] Camera status: ${status}`);

    if (status === 'not-determined') {
      try {
        const granted = await systemPreferences.askForMediaAccess('camera');
        this.permissions.camera = granted;
        console.log(`[PermissionHandler] Camera access ${granted ? 'granted' : 'denied'}`);
        return granted;
      } catch (error) {
        console.error('[PermissionHandler] Camera permission error:', error);
        return false;
      }
    } else if (status === 'granted') {
      this.permissions.camera = true;
      return true;
    } else {
      this.permissions.camera = false;
      return false;
    }
  }

  /**
   * Request microphone permission (macOS)
   */
  async requestMicrophonePermission() {
    if (process.platform !== 'darwin') return true;

    const status = systemPreferences.getMediaAccessStatus('microphone');
    console.log(`[PermissionHandler] Microphone status: ${status}`);

    if (status === 'not-determined') {
      try {
        const granted = await systemPreferences.askForMediaAccess('microphone');
        this.permissions.microphone = granted;
        console.log(`[PermissionHandler] Microphone access ${granted ? 'granted' : 'denied'}`);
        return granted;
      } catch (error) {
        console.error('[PermissionHandler] Microphone permission error:', error);
        return false;
      }
    } else if (status === 'granted') {
      this.permissions.microphone = true;
      return true;
    } else {
      this.permissions.microphone = false;
      return false;
    }
  }

  /**
   * Request screen recording permission (macOS) - Critical for screenshots
   */
  async requestScreenRecordingPermission() {
    if (process.platform !== 'darwin') return true;

    let status = systemPreferences.getMediaAccessStatus('screen');
    console.log(`[PermissionHandler] Screen recording status: ${status}`);

    if (status !== 'granted') {
      // Show dialog explaining why this is critical
      const result = await dialog.showMessageBox(this.mainWindow, {
        type: 'warning',
        title: 'Screen Recording Permission Required',
        message: 'Talio requires Screen Recording access',
        detail: `This permission is essential for:
• Automatic screenshot capture for productivity monitoring
• Screen sharing in meetings

Without this permission, Talio cannot function properly.

Click "Open System Settings" to grant permission, then:
1. Find "Talio" in the list
2. Toggle it ON
3. You may need to restart the app`,
        buttons: ['Open System Settings', 'I\'ll do it later'],
        defaultId: 0,
        cancelId: 1
      });

      if (result.response === 0) {
        // Open System Preferences to Screen Recording
        shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
        
        // Wait for user to potentially grant permission
        await this.delay(3000);
        
        // Show reminder
        await dialog.showMessageBox(this.mainWindow, {
          type: 'info',
          title: 'Enable Screen Recording',
          message: 'Please enable Screen Recording for Talio',
          detail: 'After enabling the permission in System Settings, click OK to continue.\n\nNote: You may need to restart Talio for the change to take effect.',
          buttons: ['OK']
        });
      }

      // Trigger a capture attempt to prompt the system dialog
      await this.triggerScreenCapture();
      
      // Check status again
      status = systemPreferences.getMediaAccessStatus('screen');
    }

    this.permissions.screen = status === 'granted';
    console.log(`[PermissionHandler] Final screen recording status: ${this.permissions.screen}`);
    
    return this.permissions.screen;
  }

  /**
   * Trigger a screen capture to prompt for permission and verify it works
   */
  async triggerScreenCapture() {
    try {
      console.log('[PermissionHandler] Triggering screen capture test...');
      const sources = await desktopCapturer.getSources({ 
        types: ['screen'],
        thumbnailSize: { width: 100, height: 100 }
      });
      
      // Check if we got valid sources with non-empty thumbnails
      let hasValidSources = false;
      for (const source of sources) {
        if (source.thumbnail && !source.thumbnail.isEmpty()) {
          hasValidSources = true;
          break;
        }
      }
      
      this.permissions.screen = hasValidSources;
      console.log(`[PermissionHandler] Screen capture test: ${sources.length} sources, valid: ${hasValidSources}`);
      return hasValidSources;
    } catch (error) {
      console.error('[PermissionHandler] Screen capture test failed:', error.message);
      this.permissions.screen = false;
      return false;
    }
  }

  /**
   * Show permission summary after requesting all permissions
   */
  async showPermissionSummary() {
    const denied = [];
    
    if (!this.permissions.screen) denied.push('Screen Recording');
    if (!this.permissions.camera) denied.push('Camera');
    if (!this.permissions.microphone) denied.push('Microphone');

    if (denied.length > 0) {
      await dialog.showMessageBox(this.mainWindow, {
        type: 'warning',
        title: 'Some Permissions Missing',
        message: 'The following permissions were not granted:',
        detail: `${denied.join('\n')}\n\nTalio may not work correctly without these permissions.\n\nYou can grant them later in System Settings > Privacy & Security.`,
        buttons: ['OK']
      });
    } else {
      console.log('[PermissionHandler] All permissions granted!');
    }
  }

  /**
   * Start monitoring permissions and show persistent notification if denied
   */
  startPermissionMonitoring() {
    // Clear any existing interval
    if (this.permissionCheckInterval) {
      clearInterval(this.permissionCheckInterval);
    }
    
    // Check every 60 seconds
    this.permissionCheckInterval = setInterval(async () => {
      await this.checkAllPermissions();
      
      // If screen recording is not granted, show notification
      if (!this.permissions.screen) {
        this.showPermissionNotification();
      }
    }, 60000);
  }

  /**
   * Show persistent notification for missing permissions
   */
  showPermissionNotification() {
    if (!Notification.isSupported()) return;
    
    // Don't spam notifications - only show once per 5 minutes
    const now = Date.now();
    if (now - this.lastPermissionCheck < 5 * 60 * 1000) {
      return;
    }
    this.lastPermissionCheck = now;

    const notification = new Notification({
      title: 'Talio - Permission Required',
      body: 'Screen Recording permission is required for productivity monitoring. Click to open settings.',
      silent: false
    });

    notification.on('click', () => {
      if (process.platform === 'darwin') {
        shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
      }
      this.mainWindow?.show();
      this.mainWindow?.focus();
    });

    notification.show();
  }

  /**
   * Check all permission statuses
   */
  async checkAllPermissions() {
    if (process.platform === 'darwin') {
      this.permissions.camera = systemPreferences.getMediaAccessStatus('camera') === 'granted';
      this.permissions.microphone = systemPreferences.getMediaAccessStatus('microphone') === 'granted';
      this.permissions.screen = systemPreferences.getMediaAccessStatus('screen') === 'granted';
    } else {
      // On Windows, verify screen capture actually works
      const captureWorks = await this.triggerScreenCapture();
      this.permissions.screen = captureWorks;
      this.permissions.camera = true;
      this.permissions.microphone = true;
    }

    this.permissions.notifications = Notification.isSupported();

    console.log('[PermissionHandler] Current permissions:', this.permissions);
    return this.permissions;
  }

  /**
   * Get current permission statuses
   */
  getPermissions() {
    return this.permissions;
  }

  /**
   * Alias for getPermissions - used by IPC handler
   */
  getStatus() {
    return {
      permissions: this.permissions,
      hasRequestedPermissions: this.hasRequestedPermissions,
      lastRequest: store.get('lastPermissionRequest', 0),
      platform: process.platform
    };
  }

  /**
   * Public method to request all permissions - alias for onUserLogin
   */
  async requestAllPermissions() {
    return await this.onUserLogin();
  }

  /**
   * Check if screen recording permission is granted
   */
  hasScreenPermission() {
    if (process.platform === 'darwin') {
      return systemPreferences.getMediaAccessStatus('screen') === 'granted';
    }
    return this.permissions.screen;
  }

  /**
   * Cleanup
   */
  destroy() {
    if (this.permissionCheckInterval) {
      clearInterval(this.permissionCheckInterval);
      this.permissionCheckInterval = null;
    }
  }

  /**
   * Helper delay function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { PermissionHandler };
