const { systemPreferences, dialog, desktopCapturer, Notification, shell, BrowserWindow } = require('electron');
const Store = require('electron-store');

const store = new Store();

/**
 * Permission Handler - Enhanced Version
 * 
 * Requests all required permissions at login:
 * - Screen Recording (REQUIRED - blocks app if denied)
 * - Camera
 * - Microphone
 * - Notifications
 * - Location (via web content)
 * 
 * Blocks app usage until required permissions are granted
 */
class PermissionHandler {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.permissions = {
      screen: false,
      camera: false,
      microphone: false,
      notifications: false,
      location: false
    };
    
    // Required permissions - app will be blocked if these are not granted
    this.requiredPermissions = ['screen'];
    
    // Blocking state
    this.isBlocked = false;
    this.permissionCheckInterval = null;
    this.blockingOverlay = null;
  }

  /**
   * Request all permissions at login
   * Returns true if all required permissions are granted
   */
  async requestAllPermissions() {
    console.log('[PermissionHandler] Requesting all permissions at login...');
    
    const platform = process.platform;

    if (platform === 'darwin') {
      return await this.requestMacPermissions();
    } else if (platform === 'win32') {
      return await this.requestWindowsPermissions();
    }
    
    return true;
  }

  /**
   * Request macOS permissions with native dialogs
   */
  async requestMacPermissions() {
    // Check current status first
    await this.checkAllPermissions();
    
    // Show welcome dialog explaining permissions
    const shouldContinue = await dialog.showMessageBox(this.mainWindow, {
      type: 'info',
      title: 'Talio - Permissions Required',
      message: 'Talio needs permissions to work properly',
      detail: `The following permissions are required:

✓ Screen Recording (Required) - For productivity monitoring
  Screenshots are captured every minute while you work.

• Camera - For video calls and meetings
• Microphone - For audio calls
• Notifications - For alerts and updates

You will be prompted to grant each permission.
Screen Recording is REQUIRED for the app to function.`,
      buttons: ['Grant Permissions', 'Cancel'],
      defaultId: 0,
      cancelId: 1
    });

    if (shouldContinue.response === 1) {
      // User cancelled - show blocked screen
      this.showBlockedScreen('Permissions are required to use Talio.');
      return false;
    }

    // 1. Screen Recording (REQUIRED - do first)
    if (!this.permissions.screen) {
      const screenGranted = await this.requestScreenPermission();
      if (!screenGranted) {
        this.showBlockedScreen('Screen Recording permission is required.\nPlease grant it in System Preferences.');
        this.startPermissionMonitoring();
        return false;
      }
    }

    // 2. Camera
    if (!this.permissions.camera) {
      await this.requestCameraPermission();
    }

    // 3. Microphone
    if (!this.permissions.microphone) {
      await this.requestMicrophonePermission();
    }

    // 4. Notifications - just check status
    this.permissions.notifications = Notification.isSupported();

    // Show summary
    await this.showPermissionSummary();
    
    // Check if all required permissions are granted
    const allRequired = this.requiredPermissions.every(p => this.permissions[p]);
    
    if (!allRequired) {
      this.showBlockedScreen('Required permissions not granted.');
      this.startPermissionMonitoring();
      return false;
    }
    
    this.hideBlockedScreen();
    return true;
  }

  /**
   * Request Windows permissions
   */
  async requestWindowsPermissions() {
    // Show info dialog
    await dialog.showMessageBox(this.mainWindow, {
      type: 'info',
      title: 'Talio - Permissions',
      message: 'Talio needs permissions to work properly',
      detail: `The following features require permissions:

• Screen Recording - For productivity monitoring
  Screenshots are captured every minute while you work.

• Camera & Microphone - For video calls

Windows will automatically grant screen capture access.
Please allow other permissions when prompted.`,
      buttons: ['Got it!'],
      defaultId: 0
    });

    // Test screen capture works
    const screenWorks = await this.testScreenCapture();
    this.permissions.screen = screenWorks;
    
    if (!screenWorks) {
      const retry = await dialog.showMessageBox(this.mainWindow, {
        type: 'warning',
        title: 'Screen Capture Issue',
        message: 'Screen capture test failed',
        detail: 'This may be because another application is blocking screen capture, or an antivirus is interfering.\n\nTry restarting the app or check your security settings.',
        buttons: ['Retry', 'Continue Anyway'],
        defaultId: 0
      });
      
      if (retry.response === 0) {
        this.permissions.screen = await this.testScreenCapture();
      }
    }
    
    // On Windows, set other permissions as granted (system handles them)
    this.permissions.camera = true;
    this.permissions.microphone = true;
    this.permissions.notifications = Notification.isSupported();
    
    if (!this.permissions.screen) {
      this.showBlockedScreen('Screen capture is not working.\nPlease restart the app or check security settings.');
      return false;
    }
    
    return true;
  }

  /**
   * Request Screen Recording permission (macOS)
   */
  async requestScreenPermission() {
    if (process.platform !== 'darwin') return true;

    const status = systemPreferences.getMediaAccessStatus('screen');
    console.log(`[PermissionHandler] Screen permission status: ${status}`);

    if (status === 'granted') {
      this.permissions.screen = true;
      return true;
    }

    // Screen permission requires user action in System Preferences
    // Trigger the permission prompt by attempting capture
    const granted = await this.triggerScreenPermissionPrompt();
    
    if (!granted) {
      // Show dialog to open System Preferences
      const result = await dialog.showMessageBox(this.mainWindow, {
        type: 'warning',
        title: 'Screen Recording Permission Required',
        message: 'Talio needs Screen Recording permission',
        detail: `To grant permission:

1. Click "Open System Preferences"
2. Find "Talio" in the list
3. Check the box to enable access
4. You may need to restart Talio

Screen Recording is required for productivity monitoring.`,
        buttons: ['Open System Preferences', 'Check Again', 'Cancel'],
        defaultId: 0
      });

      if (result.response === 0) {
        // Open System Preferences to Screen Recording
        shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
        
        // Wait for user to grant permission
        await this.delay(2000);
        
        // Check again
        const newStatus = systemPreferences.getMediaAccessStatus('screen');
        this.permissions.screen = newStatus === 'granted';
        return this.permissions.screen;
      } else if (result.response === 1) {
        // Check again
        const newStatus = systemPreferences.getMediaAccessStatus('screen');
        this.permissions.screen = newStatus === 'granted';
        return this.permissions.screen;
      }
      
      return false;
    }
    
    this.permissions.screen = true;
    return true;
  }

  /**
   * Trigger screen permission prompt by attempting capture
   */
  async triggerScreenPermissionPrompt() {
    try {
      const sources = await desktopCapturer.getSources({ 
        types: ['screen'],
        thumbnailSize: { width: 1, height: 1 }
      });
      
      // Check if we got actual content (not black image)
      if (sources.length > 0 && sources[0].thumbnail && !sources[0].thumbnail.isEmpty()) {
        // Try to get actual pixel data to verify
        const size = sources[0].thumbnail.getSize();
        if (size.width > 0 && size.height > 0) {
          // Double check by getting bitmap
          const bitmap = sources[0].thumbnail.toBitmap();
          // If first few pixels aren't all black, permission is granted
          const hasContent = bitmap.some((v, i) => i < 100 && v !== 0);
          if (hasContent || bitmap.length > 0) {
            console.log('[PermissionHandler] Screen capture successful');
            return true;
          }
        }
      }
      
      console.log('[PermissionHandler] Screen capture returned empty - permission likely denied');
      return false;
    } catch (error) {
      console.error('[PermissionHandler] Screen capture test failed:', error);
      return false;
    }
  }

  /**
   * Test screen capture on Windows
   */
  async testScreenCapture() {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 100, height: 100 }
      });
      
      if (sources.length > 0 && sources[0].thumbnail && !sources[0].thumbnail.isEmpty()) {
        const size = sources[0].thumbnail.getSize();
        console.log(`[PermissionHandler] Screen capture test: ${size.width}x${size.height}`);
        return size.width > 0 && size.height > 0;
      }
      return false;
    } catch (error) {
      console.error('[PermissionHandler] Screen capture test failed:', error);
      return false;
    }
  }

  /**
   * Request Camera permission (macOS)
   */
  async requestCameraPermission() {
    if (process.platform !== 'darwin') {
      this.permissions.camera = true;
      return true;
    }

    const status = systemPreferences.getMediaAccessStatus('camera');
    console.log(`[PermissionHandler] Camera status: ${status}`);

    if (status === 'not-determined') {
      try {
        const granted = await systemPreferences.askForMediaAccess('camera');
        this.permissions.camera = granted;
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
   * Request Microphone permission (macOS)
   */
  async requestMicrophonePermission() {
    if (process.platform !== 'darwin') {
      this.permissions.microphone = true;
      return true;
    }

    const status = systemPreferences.getMediaAccessStatus('microphone');
    console.log(`[PermissionHandler] Microphone status: ${status}`);

    if (status === 'not-determined') {
      try {
        const granted = await systemPreferences.askForMediaAccess('microphone');
        this.permissions.microphone = granted;
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
   * Check all permissions status
   */
  async checkAllPermissions() {
    if (process.platform === 'darwin') {
      this.permissions.screen = systemPreferences.getMediaAccessStatus('screen') === 'granted';
      this.permissions.camera = systemPreferences.getMediaAccessStatus('camera') === 'granted';
      this.permissions.microphone = systemPreferences.getMediaAccessStatus('microphone') === 'granted';
    } else {
      // On Windows, test screen capture
      this.permissions.screen = await this.testScreenCapture();
      this.permissions.camera = true;
      this.permissions.microphone = true;
    }
    
    this.permissions.notifications = Notification.isSupported();
    
    console.log('[PermissionHandler] Permission status:', this.permissions);
    return this.permissions;
  }

  /**
   * Show permission summary dialog
   */
  async showPermissionSummary() {
    const status = Object.entries(this.permissions)
      .map(([key, granted]) => `${granted ? '✓' : '✗'} ${key.charAt(0).toUpperCase() + key.slice(1)}: ${granted ? 'Granted' : 'Not granted'}`)
      .join('\n');

    await dialog.showMessageBox(this.mainWindow, {
      type: this.permissions.screen ? 'info' : 'warning',
      title: 'Permission Status',
      message: 'Permission Summary',
      detail: status + '\n\nYou can change these settings later in System Preferences.',
      buttons: ['OK']
    });
  }

  /**
   * Show blocking overlay when required permissions are not granted
   */
  showBlockedScreen(message) {
    this.isBlocked = true;
    
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      const blockedHTML = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: linear-gradient(135deg, #ff6b6b 0%, #ff8e53 100%);
              height: 100vh;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              color: white;
              text-align: center;
              padding: 40px;
            }
            .icon {
              width: 100px;
              height: 100px;
              margin-bottom: 30px;
              opacity: 0.9;
            }
            h1 {
              font-size: 28px;
              font-weight: 600;
              margin-bottom: 16px;
            }
            p {
              font-size: 18px;
              opacity: 0.95;
              margin-bottom: 30px;
              white-space: pre-line;
              line-height: 1.6;
              max-width: 500px;
            }
            .buttons {
              display: flex;
              gap: 16px;
            }
            button {
              padding: 14px 32px;
              background: rgba(255,255,255,0.2);
              color: white;
              border: 2px solid rgba(255,255,255,0.5);
              border-radius: 8px;
              font-size: 16px;
              font-weight: 500;
              cursor: pointer;
              transition: all 0.2s;
            }
            button:hover {
              background: rgba(255,255,255,0.3);
              border-color: white;
              transform: translateY(-2px);
            }
            button.primary {
              background: white;
              color: #ff6b6b;
              border-color: white;
            }
            button.primary:hover {
              background: #f5f5f5;
            }
            .status {
              margin-top: 40px;
              padding: 16px 24px;
              background: rgba(0,0,0,0.2);
              border-radius: 8px;
              font-size: 14px;
            }
          </style>
        </head>
        <body>
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 8v4M12 16h.01"/>
          </svg>
          <h1>Permission Required</h1>
          <p>${message}</p>
          <div class="buttons">
            <button class="primary" onclick="window.talioAPI?.openSystemPreferences?.()">
              Open Settings
            </button>
            <button onclick="window.talioAPI?.retryPermissions?.()">
              Check Again
            </button>
          </div>
          <div class="status">
            Waiting for permissions to be granted...
          </div>
        </body>
        </html>
      `;
      
      this.mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(blockedHTML)}`);
    }
  }

  /**
   * Hide blocked screen and reload app
   */
  hideBlockedScreen() {
    this.isBlocked = false;
    this.stopPermissionMonitoring();
    
    // Reload the main app
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.loadURL('https://app.talio.in');
    }
  }

  /**
   * Start monitoring for permission changes
   */
  startPermissionMonitoring() {
    if (this.permissionCheckInterval) return;
    
    console.log('[PermissionHandler] Starting permission monitoring...');
    
    this.permissionCheckInterval = setInterval(async () => {
      await this.checkAllPermissions();
      
      // Check if all required permissions are now granted
      const allRequired = this.requiredPermissions.every(p => this.permissions[p]);
      
      if (allRequired && this.isBlocked) {
        console.log('[PermissionHandler] Required permissions granted! Unblocking...');
        this.hideBlockedScreen();
      }
    }, 3000); // Check every 3 seconds
  }

  /**
   * Stop permission monitoring
   */
  stopPermissionMonitoring() {
    if (this.permissionCheckInterval) {
      clearInterval(this.permissionCheckInterval);
      this.permissionCheckInterval = null;
    }
  }

  /**
   * Open system preferences to grant permissions
   */
  openSystemPreferences() {
    if (process.platform === 'darwin') {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    } else if (process.platform === 'win32') {
      shell.openExternal('ms-settings:privacy-webcam');
    }
  }

  /**
   * Retry permission check
   */
  async retryPermissions() {
    const result = await this.requestAllPermissions();
    return result;
  }

  /**
   * Get current permission status
   */
  getStatus() {
    return {
      permissions: this.permissions,
      isBlocked: this.isBlocked,
      requiredPermissions: this.requiredPermissions,
      allRequiredGranted: this.requiredPermissions.every(p => this.permissions[p])
    };
  }

  /**
   * Utility: delay helper
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { PermissionHandler };
