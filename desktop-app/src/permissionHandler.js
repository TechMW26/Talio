const { systemPreferences, dialog, desktopCapturer, Notification, shell } = require('electron');
const Store = require('electron-store');

const store = new Store();

// Talio brand color
const TALIO_BLUE = '#1C2C46';

/**
 * Permission Handler
 * 
 * Required permissions (blocks app until granted):
 * - Screen Recording
 * - Camera  
 * - Microphone
 * 
 * Optional permissions:
 * - Location (not available for unsigned apps on macOS)
 */
class PermissionHandler {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.permissions = {
      screen: false,
      camera: false,
      microphone: false,
      location: false
    };
    
    // Only these are required - location is optional
    this.requiredPermissions = ['screen', 'camera', 'microphone'];
    
    this.isBlocked = false;
    this.permissionCheckInterval = null;
    this.isFirstLaunch = !store.get('permissionsGrantedOnce', false);
    this.onPermissionsGranted = null;
  }

  /**
   * Get short description for permission
   */
  getPermissionInfo(key) {
    const info = {
      screen: { name: 'Screen Recording', desc: 'Productivity monitoring' },
      camera: { name: 'Camera', desc: 'Video calls' },
      microphone: { name: 'Microphone', desc: 'Audio calls' },
      location: { name: 'Location', desc: 'Attendance (optional)' }
    };
    return info[key] || { name: key, desc: '' };
  }

  /**
   * Main entry point
   */
  async requestAllPermissions() {
    console.log('[PermissionHandler] Starting permission request...');
    console.log('[PermissionHandler] Platform:', process.platform);
    
    // Windows and Linux handle permissions automatically via OS prompts
    // Skip the permission setup screen for these platforms
    if (process.platform === 'win32' || process.platform === 'linux') {
      console.log('[PermissionHandler] Skipping permission screen for Windows/Linux');
      // Mark permissions as granted - OS will prompt when needed
      this.permissions.screen = true;
      this.permissions.camera = true;
      this.permissions.microphone = true;
      this.permissions.location = true;
      store.set('permissionsGrantedOnce', true);
      return true;
    }
    
    // macOS requires explicit permission handling
    await this.checkAllPermissions();
    
    if (this.areAllPermissionsGranted()) {
      console.log('[PermissionHandler] All required permissions granted!');
      store.set('permissionsGrantedOnce', true);
      return true;
    }
    
    await this.showPermissionSetupScreen();
    return false;
  }

  /**
   * Check if all required permissions are granted
   */
  areAllPermissionsGranted() {
    return this.requiredPermissions.every(p => this.permissions[p]);
  }

  /**
   * Check all permissions status
   */
  async checkAllPermissions() {
    const platform = process.platform;
    
    if (platform === 'darwin') {
      this.permissions.screen = systemPreferences.getMediaAccessStatus('screen') === 'granted';
      this.permissions.camera = systemPreferences.getMediaAccessStatus('camera') === 'granted';
      this.permissions.microphone = systemPreferences.getMediaAccessStatus('microphone') === 'granted';
      // Location is optional and may not work for unsigned apps
      this.permissions.location = store.get('locationPermissionGranted', false);
    } else if (platform === 'win32') {
      this.permissions.screen = await this.testScreenCapture();
      this.permissions.camera = store.get('cameraPermissionGranted', false);
      this.permissions.microphone = store.get('microphonePermissionGranted', false);
      this.permissions.location = store.get('locationPermissionGranted', false);
    } else {
      this.permissions.screen = await this.testScreenCapture();
      this.permissions.camera = true;
      this.permissions.microphone = true;
      this.permissions.location = store.get('locationPermissionGranted', false);
    }
    
    console.log('[PermissionHandler] Status:', this.permissions);
    return this.permissions;
  }

  /**
   * Test screen capture
   */
  async testScreenCapture() {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 100, height: 100 }
      });
      
      if (sources.length > 0 && sources[0].thumbnail && !sources[0].thumbnail.isEmpty()) {
        const size = sources[0].thumbnail.getSize();
        if (size.width > 0 && size.height > 0) {
          const bitmap = sources[0].thumbnail.toBitmap();
          return bitmap.some((v, i) => i < 1000 && v !== 0) || bitmap.length > 0;
        }
      }
      return false;
    } catch (error) {
      console.error('[PermissionHandler] Screen test failed:', error);
      return false;
    }
  }

  /**
   * Show permission setup screen with clean white UI
   */
  async showPermissionSetupScreen() {
    this.isBlocked = true;
    const platform = process.platform;
    
    // Build permission list - required first, then optional
    const allPermissions = [...this.requiredPermissions, 'location'];
    
    const permissionListHTML = allPermissions.map(p => {
      const granted = this.permissions[p];
      const info = this.getPermissionInfo(p);
      const isOptional = !this.requiredPermissions.includes(p);
      
      return `
        <div class="permission-row ${granted ? 'granted' : ''}" id="perm-${p}">
          <div class="permission-check">
            <svg class="check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              ${granted ? '<path d="M20 6L9 17l-5-5"/>' : '<circle cx="12" cy="12" r="10"/>'}
            </svg>
          </div>
          <div class="permission-text">
            <span class="permission-name">${info.name}</span>
            <span class="permission-desc">${info.desc}</span>
          </div>
          <div class="permission-badge ${granted ? 'badge-granted' : isOptional ? 'badge-optional' : 'badge-required'}">
            ${granted ? 'Granted' : isOptional ? 'Optional' : 'Required'}
          </div>
        </div>
      `;
    }).join('');

    const setupHTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #ffffff;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 40px;
      color: #1C2C46;
    }
    
    .container {
      max-width: 480px;
      width: 100%;
    }
    
    .header {
      text-align: center;
      margin-bottom: 40px;
    }
    
    .logo-text {
      font-size: 32px;
      font-weight: 700;
      color: #1C2C46;
      letter-spacing: -0.5px;
    }
    
    .title {
      font-size: 20px;
      font-weight: 600;
      color: #1C2C46;
      margin-top: 24px;
    }
    
    .subtitle {
      font-size: 14px;
      color: #64748b;
      margin-top: 8px;
    }
    
    .permission-list {
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 32px;
    }
    
    .permission-row {
      display: flex;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid #e2e8f0;
      transition: background 0.2s;
    }
    
    .permission-row:last-child {
      border-bottom: none;
    }
    
    .permission-row.granted {
      background: #f0fdf4;
    }
    
    .permission-check {
      width: 24px;
      height: 24px;
      margin-right: 16px;
      flex-shrink: 0;
    }
    
    .check-icon {
      width: 24px;
      height: 24px;
    }
    
    .permission-row.granted .check-icon {
      color: #22c55e;
    }
    
    .permission-row:not(.granted) .check-icon {
      color: #cbd5e1;
    }
    
    .permission-text {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    
    .permission-name {
      font-size: 15px;
      font-weight: 600;
      color: #1C2C46;
    }
    
    .permission-desc {
      font-size: 13px;
      color: #64748b;
    }
    
    .permission-badge {
      font-size: 11px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 12px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    
    .badge-required {
      background: #fef3c7;
      color: #b45309;
    }
    
    .badge-optional {
      background: #f1f5f9;
      color: #64748b;
    }
    
    .badge-granted {
      background: #dcfce7;
      color: #16a34a;
    }
    
    .buttons {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    
    button {
      width: 100%;
      padding: 14px 24px;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    
    .btn-primary {
      background: #1C2C46;
      color: white;
    }
    
    .btn-primary:hover {
      background: #2a3f5f;
    }
    
    .btn-primary:disabled {
      background: #94a3b8;
      cursor: not-allowed;
    }
    
    .btn-secondary {
      background: #f1f5f9;
      color: #1C2C46;
    }
    
    .btn-secondary:hover {
      background: #e2e8f0;
    }
    
    .spinner {
      width: 18px;
      height: 18px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      display: none;
    }
    
    .loading .spinner {
      display: block;
    }
    
    .loading .btn-label {
      display: none;
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    .progress-bar {
      height: 3px;
      background: #e2e8f0;
      border-radius: 2px;
      margin-bottom: 32px;
      overflow: hidden;
    }
    
    .progress-fill {
      height: 100%;
      background: #1C2C46;
      border-radius: 2px;
      transition: width 0.4s ease;
    }
    
    .footer {
      text-align: center;
      margin-top: 24px;
      font-size: 12px;
      color: #94a3b8;
    }
    
    ${platform === 'darwin' ? `
    .macos-note {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 24px;
      font-size: 13px;
      color: #64748b;
      line-height: 1.5;
    }
    ` : ''}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo-text">Talio</div>
      <div class="title">Permissions Required</div>
      <div class="subtitle">Grant access to enable core features</div>
    </div>
    
    <div class="progress-bar">
      <div class="progress-fill" id="progress" style="width: ${(allPermissions.filter(p => this.permissions[p]).length / allPermissions.length) * 100}%"></div>
    </div>
    
    ${platform === 'darwin' ? `
    <div class="macos-note">
      Click <strong>Grant Access</strong> and allow each permission when prompted. You may need to open System Settings for some permissions.
    </div>
    ` : ''}
    
    <div class="permission-list">
      ${permissionListHTML}
    </div>
    
    <div class="buttons">
      <button class="btn-primary" id="grantBtn" onclick="grantPermissions()">
        <span class="btn-label">Grant Access</span>
        <span class="spinner"></span>
      </button>
      ${platform === 'darwin' ? `
      <button class="btn-secondary" onclick="openSettings()">
        Open System Settings
      </button>
      ` : ''}
    </div>
    
    <div class="footer">
      Your privacy is protected. Data is only captured during work hours.
    </div>
  </div>
  
  <script>
    let isGranting = false;
    
    async function grantPermissions() {
      if (isGranting) return;
      isGranting = true;
      
      const btn = document.getElementById('grantBtn');
      btn.classList.add('loading');
      btn.disabled = true;
      
      try {
        if (window.talioAPI && window.talioAPI.grantAllPermissions) {
          await window.talioAPI.grantAllPermissions();
        }
      } catch (e) {
        console.error('Grant error:', e);
      }
      
      setTimeout(() => {
        isGranting = false;
        btn.classList.remove('loading');
        btn.disabled = false;
        checkPermissions();
      }, 2000);
    }
    
    async function checkPermissions() {
      if (window.talioAPI && window.talioAPI.checkPermissions) {
        try {
          const status = await window.talioAPI.checkPermissions();
          updateUI(status);
        } catch (e) {
          console.error('Check error:', e);
        }
      }
    }
    
    async function openSettings() {
      if (window.talioAPI && window.talioAPI.openSystemPreferences) {
        await window.talioAPI.openSystemPreferences();
      }
    }
    
    function updateUI(status) {
      if (!status || !status.permissions) return;
      
      const perms = status.permissions;
      const allKeys = Object.keys(perms);
      const granted = Object.values(perms).filter(v => v).length;
      
      // Update progress
      const progress = document.getElementById('progress');
      if (progress) {
        progress.style.width = (granted / allKeys.length * 100) + '%';
      }
      
      // Update each row
      Object.entries(perms).forEach(([key, value]) => {
        const row = document.getElementById('perm-' + key);
        if (!row) return;
        
        const isOptional = key === 'location';
        
        if (value) {
          row.classList.add('granted');
          row.querySelector('.check-icon').innerHTML = '<path d="M20 6L9 17l-5-5"/>';
          row.querySelector('.permission-badge').className = 'permission-badge badge-granted';
          row.querySelector('.permission-badge').textContent = 'Granted';
        } else {
          row.classList.remove('granted');
          row.querySelector('.check-icon').innerHTML = '<circle cx="12" cy="12" r="10"/>';
          row.querySelector('.permission-badge').className = 'permission-badge ' + (isOptional ? 'badge-optional' : 'badge-required');
          row.querySelector('.permission-badge').textContent = isOptional ? 'Optional' : 'Required';
        }
      });
    }
    
    // Poll for permission changes
    setInterval(checkPermissions, 2000);
    setTimeout(checkPermissions, 500);
  </script>
</body>
</html>
    `;
    
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(setupHTML)}`);
    }
    
    this.startPermissionMonitoring();
  }

  /**
   * Grant all permissions
   */
  async grantAllPermissions() {
    console.log('[PermissionHandler] Granting permissions...');
    
    const platform = process.platform;
    
    if (platform === 'darwin') {
      await this.requestMacPermissions();
    } else if (platform === 'win32') {
      await this.requestWindowsPermissions();
    } else {
      await this.requestLinuxPermissions();
    }
    
    await this.checkAllPermissions();
    return this.permissions;
  }

  /**
   * Request macOS permissions
   */
  async requestMacPermissions() {
    // Screen Recording
    if (!this.permissions.screen) {
      await this.triggerScreenPermissionPrompt();
      const status = systemPreferences.getMediaAccessStatus('screen');
      if (status !== 'granted') {
        await this.showPermissionDialog('Screen Recording', 'Privacy_ScreenCapture');
      }
    }
    
    // Camera
    if (!this.permissions.camera) {
      const status = systemPreferences.getMediaAccessStatus('camera');
      if (status === 'not-determined') {
        try {
          this.permissions.camera = await systemPreferences.askForMediaAccess('camera');
        } catch (e) {
          console.error('[PermissionHandler] Camera error:', e);
        }
      } else if (status === 'denied') {
        await this.showPermissionDialog('Camera', 'Privacy_Camera');
      }
    }
    
    // Microphone
    if (!this.permissions.microphone) {
      const status = systemPreferences.getMediaAccessStatus('microphone');
      if (status === 'not-determined') {
        try {
          this.permissions.microphone = await systemPreferences.askForMediaAccess('microphone');
        } catch (e) {
          console.error('[PermissionHandler] Microphone error:', e);
        }
      } else if (status === 'denied') {
        await this.showPermissionDialog('Microphone', 'Privacy_Microphone');
      }
    }
    
    // Location - optional, try via renderer
    if (!this.permissions.location) {
      await this.requestLocationViaRenderer();
    }
  }

  /**
   * Request Windows permissions
   */
  async requestWindowsPermissions() {
    if (!this.permissions.screen) {
      this.permissions.screen = await this.testScreenCapture();
    }
    
    if (!this.permissions.camera || !this.permissions.microphone) {
      await this.requestMediaViaRenderer();
    }
    
    if (!this.permissions.location) {
      await this.requestLocationViaRenderer();
    }
  }

  /**
   * Request Linux permissions
   */
  async requestLinuxPermissions() {
    if (!this.permissions.screen) {
      this.permissions.screen = await this.testScreenCapture();
    }
    
    if (!this.permissions.camera || !this.permissions.microphone) {
      await this.requestMediaViaRenderer();
    }
    
    if (!this.permissions.location) {
      await this.requestLocationViaRenderer();
    }
  }

  /**
   * Trigger screen permission prompt
   */
  async triggerScreenPermissionPrompt() {
    try {
      await desktopCapturer.getSources({ 
        types: ['screen'],
        thumbnailSize: { width: 1, height: 1 }
      });
    } catch (e) {
      console.error('[PermissionHandler] Screen trigger failed:', e);
    }
  }

  /**
   * Show dialog to open system settings
   */
  async showPermissionDialog(name, prefKey) {
    const result = await dialog.showMessageBox(this.mainWindow, {
      type: 'info',
      title: `${name} Permission`,
      message: `Please enable ${name} access`,
      detail: `Open System Settings and enable ${name} for Talio.`,
      buttons: ['Open Settings', 'Later'],
      defaultId: 0
    });

    if (result.response === 0) {
      shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${prefKey}`);
    }
  }

  /**
   * Request media via renderer
   */
  async requestMediaViaRenderer() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    
    try {
      const result = await this.mainWindow.webContents.executeJavaScript(`
        (async function() {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            stream.getTracks().forEach(track => track.stop());
            return { camera: true, microphone: true };
          } catch (error) {
            let camera = false, microphone = false;
            try {
              const v = await navigator.mediaDevices.getUserMedia({ video: true });
              v.getTracks().forEach(t => t.stop());
              camera = true;
            } catch {}
            try {
              const a = await navigator.mediaDevices.getUserMedia({ audio: true });
              a.getTracks().forEach(t => t.stop());
              microphone = true;
            } catch {}
            return { camera, microphone };
          }
        })();
      `);
      
      if (result.camera) {
        this.permissions.camera = true;
        store.set('cameraPermissionGranted', true);
      }
      if (result.microphone) {
        this.permissions.microphone = true;
        store.set('microphonePermissionGranted', true);
      }
    } catch (e) {
      console.error('[PermissionHandler] Media request failed:', e);
    }
  }

  /**
   * Request location via renderer
   */
  async requestLocationViaRenderer() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    
    try {
      const result = await this.mainWindow.webContents.executeJavaScript(`
        new Promise((resolve) => {
          if (!navigator.geolocation) {
            resolve({ granted: false });
            return;
          }
          navigator.geolocation.getCurrentPosition(
            () => resolve({ granted: true }),
            () => resolve({ granted: false }),
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
          );
        });
      `);
      
      if (result.granted) {
        this.permissions.location = true;
        store.set('locationPermissionGranted', true);
      }
    } catch (e) {
      console.error('[PermissionHandler] Location request failed:', e);
    }
  }

  /**
   * Start monitoring for permission changes
   */
  startPermissionMonitoring() {
    if (this.permissionCheckInterval) return;
    
    this.permissionCheckInterval = setInterval(async () => {
      await this.checkAllPermissions();
      
      if (this.areAllPermissionsGranted() && this.isBlocked) {
        console.log('[PermissionHandler] All required permissions granted!');
        store.set('permissionsGrantedOnce', true);
        this.hideBlockedScreen();
      }
    }, 2000);
  }

  /**
   * Stop monitoring
   */
  stopPermissionMonitoring() {
    if (this.permissionCheckInterval) {
      clearInterval(this.permissionCheckInterval);
      this.permissionCheckInterval = null;
    }
  }

  /**
   * Hide blocked screen and load app
   */
  hideBlockedScreen() {
    this.isBlocked = false;
    this.stopPermissionMonitoring();
    
    if (Notification.isSupported()) {
      new Notification({
        title: 'Talio',
        body: 'Permissions granted. Loading workspace...'
      }).show();
    }
    
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('permissions-granted', { allGranted: true });
      this.mainWindow.loadURL('https://app.talio.in');
    }
    
    if (this.onPermissionsGranted) {
      this.onPermissionsGranted();
    }
  }

  /**
   * Set callback for permissions granted
   */
  setOnPermissionsGranted(callback) {
    this.onPermissionsGranted = callback;
  }

  /**
   * Open system preferences
   */
  openSystemPreferences(section = 'screen') {
    const platform = process.platform;
    
    if (platform === 'darwin') {
      const prefs = {
        screen: 'Privacy_ScreenCapture',
        camera: 'Privacy_Camera',
        microphone: 'Privacy_Microphone',
        location: 'Privacy_LocationServices'
      };
      shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${prefs[section] || 'Privacy'}`);
    } else if (platform === 'win32') {
      const settings = {
        camera: 'ms-settings:privacy-webcam',
        microphone: 'ms-settings:privacy-microphone',
        location: 'ms-settings:privacy-location'
      };
      shell.openExternal(settings[section] || 'ms-settings:privacy');
    }
  }

  /**
   * Get status
   */
  getStatus() {
    return {
      permissions: this.permissions,
      isBlocked: this.isBlocked,
      requiredPermissions: this.requiredPermissions,
      allGranted: this.areAllPermissionsGranted(),
      isFirstLaunch: this.isFirstLaunch
    };
  }
}

module.exports = { PermissionHandler };
