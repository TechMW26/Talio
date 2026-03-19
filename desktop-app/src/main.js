/**
 * Talio Desktop App v4.8.0
 * Main Electron process
 * 
 * Performance optimized for smooth rendering
 * With whitescreen recovery and network change handling
 * Force-persistent mode: app cannot be closed by users, auto-restarts if killed
 */

const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, shell, nativeImage, session, systemPreferences, dialog, desktopCapturer, screen, powerMonitor } = require('electron');
const path = require('path');
const Store = require('electron-store');
const AutoLaunch = require('auto-launch');
const { autoUpdater } = require('electron-updater');
const logger = require('./logger');
const screenshotService = require('./screenshotService');
const socketHandler = require('./socketHandler');

// PERFORMANCE: Balanced GPU settings for smooth rendering without flickering
const forceDisableGPU = process.env.TALIO_DISABLE_GPU === '1';

if (forceDisableGPU) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  logger.log('warn', 'Main', 'GPU acceleration disabled via environment flag');
} else {
  // Enable hardware acceleration with BALANCED settings to prevent flickering
  // DO NOT use disable-frame-rate-limit as it causes screen tearing/flickering

  // Basic GPU acceleration (safe defaults)
  app.commandLine.appendSwitch('enable-gpu-rasterization');

  // Smooth scrolling
  app.commandLine.appendSwitch('enable-smooth-scrolling');

  // Use hardware acceleration for animations
  app.commandLine.appendSwitch('enable-accelerated-2d-canvas');

  // Force enable VSYNC to prevent tearing and flickering
  app.commandLine.appendSwitch('disable-gpu-vsync', 'false');

  // Platform-specific optimizations
  if (process.platform === 'win32') {
    // Use D3D11 on Windows for best compatibility
    app.commandLine.appendSwitch('use-angle', 'd3d11');
    // DO NOT disable direct composition - it breaks input handling on modern Windows
  } else if (process.platform === 'darwin') {
    // macOS-specific: use Metal for best performance
    app.commandLine.appendSwitch('enable-features', 'Metal');
  } else if (process.platform === 'linux') {
    // Linux-specific: use GL for best compatibility
    app.commandLine.appendSwitch('use-gl', 'desktop');
    app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder');
  }

  // Prevent GPU process crashes from affecting the main process
  app.commandLine.appendSwitch('disable-gpu-process-crash-limit');
}

// Note: The actual fix for the "Checking session" crash loop requires
// deploying the Providers.js fix to production (app.talio.in)
// which disables AudioContext initialization for desktop apps

// Set Windows App User Model ID for proper notification grouping & taskbar identity
if (process.platform === 'win32') {
  app.setAppUserModelId('in.talio.desktop');
}

// Configuration
const APP_URL = 'https://app.talio.in';
const LOADER_TIMEOUT_MS = 30000; // 30 seconds max loading time
const RETRY_DELAY_MS = 5000;
const MAX_LOAD_RETRIES = 3;
const MAX_CRASH_RECOVERY = 10; // Max crash recovery attempts (generous to survive network flaps)
const MIN_VERSION_CHECK_URL = APP_URL + '/api/desktop/min-version';
const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000; // Check for updates every hour

// Global references
let mainWindow = null;
let tray = null;
let isQuitting = false;
let loadRetries = 0;
let loadTimeout = null;
let isAuthenticated = false;
let userData = null;
let crashCount = 0;
let lastCrashTime = 0;
let forceCloseAttempts = 0;
let windowRecreateTimer = null;
let isUpdating = false;
let updateCheckTimer = null;
let updateCheckDialog = null;
let inAppUpdateMode = false; // When true, don't navigate to update.html - send IPC status instead
let isLoadingApp = false; // Prevents concurrent loadApp() calls

// Persistent store
const store = new Store({ name: 'app-data' });

// Auto-launch configuration
const autoLauncher = new AutoLaunch({
  name: 'Talio',
  isHidden: true
});

/**
 * Request all required permissions (notifications on all platforms, media on macOS)
 */
async function requestPermissions() {
  logger.log('info', 'Main', 'Checking permissions...');

  // ── Notification permissions (all platforms) ──
  if (Notification.isSupported()) {
    logger.log('info', 'Main', 'Notifications supported');
  } else {
    logger.log('warn', 'Main', 'Notifications not supported on this platform');
  }

  // Windows: Set up toast notifications via AppUserModelId
  if (process.platform === 'win32') {
    logger.log('info', 'Main', 'Windows notification setup - AppUserModelId: in.talio.desktop');
    // Show initial notification to verify the permission pipeline
    try {
      var testNotif = new Notification({
        title: 'Talio',
        body: 'Talio is running in the background and monitoring your activity.',
        icon: getAppIcon(),
        silent: true
      });
      testNotif.show();
      setTimeout(function () { testNotif.close(); }, 4000);
      logger.log('info', 'Main', 'Windows notification test OK');
    } catch (e) {
      logger.log('warn', 'Main', 'Windows notification test failed: ' + e.message);
    }
  }

  // Linux: notifications via libnotify
  if (process.platform === 'linux') {
    logger.log('info', 'Main', 'Linux notifications via libnotify');
    try {
      var testNotif = new Notification({
        title: 'Talio',
        body: 'Talio is running. You will receive work notifications here.',
        icon: getAppIcon(),
        silent: true
      });
      testNotif.show();
      setTimeout(function () { testNotif.close(); }, 4000);
    } catch (e) {
      logger.log('warn', 'Main', 'Linux notification test failed: ' + e.message);
    }
  }

  // macOS: Request media + notification permissions
  if (process.platform === 'darwin') {
    logger.log('info', 'Main', 'Checking macOS permissions...');

    // Camera permission
    var cameraStatus = systemPreferences.getMediaAccessStatus('camera');
    if (cameraStatus !== 'granted') {
      logger.log('info', 'Main', 'Requesting camera permission...');
      var granted = await systemPreferences.askForMediaAccess('camera');
      logger.log('info', 'Main', 'Camera permission: ' + (granted ? 'granted' : 'denied'));
    }

    // Microphone permission
    var micStatus = systemPreferences.getMediaAccessStatus('microphone');
    if (micStatus !== 'granted') {
      logger.log('info', 'Main', 'Requesting microphone permission...');
      var granted = await systemPreferences.askForMediaAccess('microphone');
      logger.log('info', 'Main', 'Microphone permission: ' + (granted ? 'granted' : 'denied'));
    }

    // Screen recording permission (can only check, not request programmatically)
    var screenStatus = systemPreferences.getMediaAccessStatus('screen');
    if (screenStatus !== 'granted') {
      logger.log('info', 'Main', 'Screen recording permission not granted, showing dialog...');
      var result = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Screen Recording Permission Required',
        message: 'Talio needs screen recording permission for productivity monitoring and screen sharing in meetings.',
        detail: 'Please grant Screen Recording permission in System Preferences → Privacy & Security → Screen Recording, then restart the app.',
        buttons: ['Open System Preferences', 'Later'],
        defaultId: 0,
        cancelId: 1
      });

      if (result.response === 0) {
        shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
      }
    } else {
      logger.log('info', 'Main', 'Screen recording permission already granted');
    }

    // macOS notification permission - trigger via test notification
    // macOS shows a system permission dialog on the first Notification()
    try {
      var testNotif = new Notification({
        title: 'Talio',
        body: 'Talio is running. You will receive work notifications here.',
        icon: getAppIcon(),
        silent: true
      });
      testNotif.show();
      setTimeout(function () { testNotif.close(); }, 4000);
      logger.log('info', 'Main', 'macOS notification permission triggered');
    } catch (e) {
      logger.log('warn', 'Main', 'macOS notification test failed: ' + e.message);
    }
  }

  // Clear macOS dock badge on startup
  if (process.platform === 'darwin') {
    app.setBadgeCount(0);
  }
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', function () {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

/**
 * Create the main application window
 */
function createWindow() {
  const windowBounds = store.get('windowBounds', { width: 1280, height: 800 });

  mainWindow = new BrowserWindow({
    width: windowBounds.width,
    height: windowBounds.height,
    x: windowBounds.x,
    y: windowBounds.y,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged,
      // PERFORMANCE: Disable background throttling for smooth animations
      backgroundThrottling: false,
      // PERFORMANCE: Enable hardware acceleration in renderer
      enablePreferredSizeMode: false,
      // Media features for screen sharing
      mediaStreamShareSecurityOrigin: true,
      // Spellcheck can cause jank - disable if not needed
      spellcheck: false,
      // Enable WebGL for smooth rendering
      webgl: true,
      // V8 code caching for faster JS execution
      v8CacheOptions: 'bypassHeatCheck'
    },
    icon: getAppIcon(),
    show: false,
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'win32' ? {
      color: '#00000000',
      symbolColor: '#64748B',
      height: 32
    } : {
      color: '#ffffff',
      symbolColor: '#64748B',
      height: 40
    },
    trafficLightPosition: { x: 16, y: 13 },
    hasShadow: true
  });

  // Show window when ready to prevent white flash
  mainWindow.once('ready-to-show', function () {
    mainWindow.show();
    logger.log('info', 'Main', 'Window ready-to-show triggered');
  });

  // ── Seamless Title Bar: inject CSS/JS after page loads ──────────────
  mainWindow.webContents.on('did-finish-load', function () {
    injectTitleBarAdaptations();
  });

  // Block DevTools shortcuts in production
  if (app.isPackaged) {
    mainWindow.webContents.on('before-input-event', function (event, input) {
      // Block F12, Ctrl+Shift+I, Ctrl+Shift+J, Cmd+Option+I, Cmd+Option+J
      if (input.key === 'F12') { event.preventDefault(); return; }
      if ((input.control || input.meta) && input.shift && (input.key === 'I' || input.key === 'i' || input.key === 'J' || input.key === 'j')) { event.preventDefault(); return; }
      if (input.meta && input.alt && (input.key === 'I' || input.key === 'i')) { event.preventDefault(); return; }
    });
  }

  // Clear macOS dock badge when window receives focus
  mainWindow.on('focus', function () {
    if (process.platform === 'darwin') {
      app.setBadgeCount(0);
    }
  });

  // Log renderer console messages for debugging
  mainWindow.webContents.on('console-message', function (event, level, message, line, sourceId) {
    if (level >= 2) { // warnings and errors
      logger.log('warn', 'Renderer', message);
    }
  });

  // Handle render process crashes - with recovery limit to prevent infinite loop
  mainWindow.webContents.on('render-process-gone', function (event, details) {
    // Don't attempt recovery during update installation
    if (isUpdating) {
      logger.log('info', 'Main', 'Renderer crash during update - not recovering (update in progress)');
      return;
    }

    const now = Date.now();
    logger.log('error', 'Main', 'Render process gone: ' + details.reason + ' (exitCode: ' + details.exitCode + ')');

    // Reset crash count if more than 30 seconds since last crash
    if (now - lastCrashTime > 30000) {
      crashCount = 0;
    }
    lastCrashTime = now;
    crashCount++;

    if (crashCount <= MAX_CRASH_RECOVERY && mainWindow && !mainWindow.isDestroyed()) {
      logger.log('warn', 'Main', 'Attempting crash recovery (' + crashCount + '/' + MAX_CRASH_RECOVERY + ')');
      // Wait a bit before showing offline page to let things settle
      // Show offline page instead of loading APP_URL directly — prevents cascade when offline
      setTimeout(function () {
        if (mainWindow && !mainWindow.isDestroyed()) {
          showOfflinePage('crash', null, 'Renderer crashed: ' + details.reason);
        }
      }, 2000);
    } else {
      logger.log('error', 'Main', 'Max crash recovery attempts reached, showing error page');
      showCrashPage();
    }
  });

  // Handle unresponsive page
  mainWindow.webContents.on('unresponsive', function () {
    logger.log('warn', 'Main', 'Page became unresponsive');
  });

  mainWindow.webContents.on('responsive', function () {
    logger.log('info', 'Main', 'Page became responsive');
  });

  // Setup window events
  setupWindowEvents();

  // Setup IPC handlers
  setupIPCHandlers();

  // Show welcome screen on first launch, otherwise show loader
  var hasSeenWelcome = store.get('hasSeenWelcome', false);
  if (!hasSeenWelcome) {
    showWelcomeScreen();
  } else {
    showLoader();
  }

  logger.log('info', 'Main', 'Window created');
}

/**
 * Inject CSS and JS into the loaded page for seamless title bar integration.
 * - Makes the header draggable (window move).
 * - Adds platform-specific padding so traffic lights (macOS) or 
 *   window controls (Windows) don't overlap interactive elements.
 * - Detects theme/dark mode changes and updates the title bar overlay color.
 */
function injectTitleBarAdaptations() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  var platformCSS = '';
  if (process.platform === 'darwin') {
    // macOS: push sidebar content below traffic lights
    platformCSS = '\n' +
      'aside[style*="--color-bg-sidebar"] { padding-top: 38px !important; }\n' +
      'aside.fixed.inset-y-0 { padding-top: 38px !important; }\n';
  } else {
    // Windows / Linux: push header right side left of window controls
    platformCSS = '\n' +
      'header { padding-right: 140px !important; }\n';
  }

  var css =
    '/* Electron: Seamless title bar */\n' +
    '*, *::before, *::after { -webkit-app-region: no-drag; }\n' +
    'header { -webkit-app-region: drag; }\n' +
    'header button, header input, header a, header [role="button"],\n' +
    'header [data-slot], header .cursor-pointer, header .relative,\n' +
    'header > div > div > * { -webkit-app-region: no-drag; }\n' +
    platformCSS;

  mainWindow.webContents.insertCSS(css).catch(function () { });

  // Inject theme color detection - watches for dark mode / theme changes and syncs title bar
  var themeScript =
    '(function() {\n' +
    '  function syncTitleBar() {\n' +
    '    var header = document.querySelector("header");\n' +
    '    var bgColor = "#ffffff";\n' +
    '    if (header) {\n' +
    '      bgColor = getComputedStyle(header).backgroundColor;\n' +
    '    } else {\n' +
    '      bgColor = getComputedStyle(document.body).backgroundColor || "#ffffff";\n' +
    '    }\n' +
    '    if (window.electronAPI && window.electronAPI.setTitleBarColor) {\n' +
    '      window.electronAPI.setTitleBarColor(bgColor);\n' +
    '    }\n' +
    '  }\n' +
    '  var obs = new MutationObserver(function() { setTimeout(syncTitleBar, 200); });\n' +
    '  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });\n' +
    '  setTimeout(syncTitleBar, 800);\n' +
    '  setTimeout(syncTitleBar, 2500);\n' +
    '  setInterval(syncTitleBar, 5000);\n' +
    '})()';

  mainWindow.webContents.executeJavaScript(themeScript).catch(function () { });
}

/**
 * Show welcome/onboarding screen on first launch
 */
function showWelcomeScreen() {
  var welcomePath = path.join(__dirname, 'welcome.html');
  mainWindow.loadFile(welcomePath);

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }

  logger.log('info', 'Main', 'Showing welcome screen (first launch)');
}

/**
 * Show loading screen while app loads
 */
function showLoader() {
  const loaderHTML = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Talio</title><style>' +
    'body{margin:0;padding:0;background:#ffffff;display:flex;align-items:center;justify-content:center;height:100vh;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;overflow:hidden}' +
    '.loader-container{width:128px;height:128px;position:relative;animation:pulse 2.5s ease-in-out infinite}' +
    'svg{width:100%;height:100%;position:absolute;top:0;left:0;filter:drop-shadow(0 0 15px rgba(125,188,175,0.3))}' +
    '.loader-stroke{stroke:#7DBCAF;stroke-width:8;stroke-linecap:round;stroke-linejoin:round;fill:none;animation:strokeLoop 2.5s ease-in-out infinite}' +
    '.loader-fill{fill:#7DBCAF;opacity:0;animation:fillLoop 2.5s linear infinite}' +
    '@keyframes strokeLoop{0%{stroke-dashoffset:var(--path-length)}40%{stroke-dashoffset:0}60%{stroke-dashoffset:0}100%{stroke-dashoffset:var(--path-length)}}' +
    '@keyframes fillLoop{0%,40%{opacity:0}50%{opacity:1}90%,100%{opacity:0}}' +
    '@keyframes pulse{0%{transform:scale(0.95)}40%,60%{transform:scale(1)}100%{transform:scale(0.95)}}' +
    '.status{color:rgba(0,0,0,0.5);font-size:14px;margin-top:180px;text-align:center;position:absolute;width:100%}' +
    '</style></head><body>' +
    '<div class="loader-container">' +
    '<svg viewBox="0 0 385.322 416.819" xmlns="http://www.w3.org/2000/svg">' +
    '<path id="loaderPath" class="loader-stroke" d="M218.185 401.899C213.175 405.409 205.665 410.209 201.505 412.549L193.935 416.819L189.125 414.309C160.555 399.389 135.805 375.379 112.155 339.649L106.765 331.509L110.285 328.509C112.225 326.859 113.805 325.139 113.805 324.689C113.805 322.859 101.875 311.469 95.305 307.029C83.255 298.879 72.455 294.379 59.375 292.059C52.495 290.839 35.495 290.769 28.465 291.919C24.655 292.549 23.515 292.419 23.075 291.279C22.235 289.079 24.635 267.739 26.945 257.059C31.605 235.419 41.995 208.849 51.455 194.429C52.745 192.449 52.255 191.349 44.945 179.899C27.095 151.939 14.145 121.479 6.915 90.5085C0.754998 64.0785 -1.615 31.4185 1.135 10.6085C1.975 4.23853 2.785 1.40853 4.005 0.64853C9.065 -2.52147 39.985 6.51853 62.255 17.6785C96.355 34.7685 124.205 56.0885 158.125 91.0885L176.465 110.009H193.385L210.305 109.999L221.305 98.0185C243.725 73.5985 270.475 50.6185 296.315 33.5885C303.725 28.6985 308.245 26.0985 322.805 18.3585C332.255 13.3285 353.105 4.88853 360.805 2.98853C376.165 -0.81147 380.135 -0.93147 382.265 2.30853C384.815 6.19853 386.105 27.2385 384.815 44.0085C381.675 84.8885 371.875 119.939 353.105 157.399C347.505 168.569 346.875 169.669 337.885 183.689L332.645 191.859L336.055 197.189C349.295 217.879 360.175 252.099 362.705 281.009C363.735 292.799 363.335 293.439 355.875 292.019C343.145 289.609 323.715 291.709 310.075 296.969C297.415 301.849 282.845 312.119 275.595 321.269L272.465 325.229L276.225 328.379L279.975 331.529L273.795 340.949C257.305 366.049 235.945 389.469 218.185 401.899ZM67.095 162.839L71.135 169.159L75.225 164.359C81.485 156.999 95.305 143.529 104.325 135.999C113.865 128.029 133.585 113.029 135.485 112.299C136.215 112.019 136.805 111.429 136.805 110.979C136.805 108.299 114.365 87.1485 95.305 71.8585C79.025 58.7985 49.815 41.4285 35.925 36.5485C35.665 36.4485 35.405 36.3585 35.155 36.2685C32.345 35.2785 30.705 34.6985 29.805 35.2785C28.535 36.0685 28.685 39.0985 29.035 46.3285C29.065 46.7885 29.085 47.2685 29.105 47.7585C30.865 84.3585 45.725 129.349 67.095 162.839ZM311.415 164.889L314.195 168.259L316.245 165.679C319.605 161.459 329.665 142.809 334.825 131.259C341.895 115.409 346.765 101.229 350.355 86.0085C351.205 82.4385 352.325 77.7085 352.845 75.5085C353.375 73.3085 354.015 70.1585 354.275 68.5085C356.185 56.2785 356.765 50.4385 356.785 43.1485L356.805 34.7885L354.055 35.4685C349.035 36.7085 334.085 43.7585 323.425 49.8985C309.895 57.6885 298.105 66.0185 284.055 77.7185C271.155 88.4585 249.535 109.769 250.295 110.999C250.575 111.449 255.395 115.099 261.005 119.099C277.805 131.089 300.715 151.909 311.415 164.889ZM133.395 304.289L141.305 312.679L154.965 302.299C162.485 296.589 169.175 291.269 169.835 290.469C170.805 289.299 170.225 287.719 166.805 282.269C148.655 253.309 123.965 230.579 96.805 217.809C92.685 215.869 86.165 213.039 82.335 211.529L75.365 208.769L72.695 211.979C64.785 221.449 50.405 265.279 55.535 264.269C57.955 263.789 78.115 268.159 85.145 270.699C101.125 276.459 118.685 288.679 133.395 304.289ZM238.005 307.059L245.035 312.599L256.675 301.009C269.605 288.119 283.235 278.369 296.305 272.679C304.535 269.089 321.045 265.009 327.315 265.009C331.755 265.009 332.365 263.579 330.815 256.769C327.495 242.159 315.305 211.669 311.955 209.599C309.355 207.999 284.825 219.279 270.805 228.539C257.485 237.329 247.035 246.559 237.645 257.829C230.125 266.859 215.805 287.399 215.805 289.159C215.805 289.589 219.215 292.539 223.395 295.719C227.565 298.909 234.145 304.009 238.005 307.059ZM184.085 373.029L193.035 378.929L197.175 376.829C202.805 373.959 214.415 365.089 219.415 359.829C224.665 354.299 233.805 342.059 233.805 340.549C233.805 339.429 231.465 337.619 217.805 328.119C196.395 313.249 193.945 311.869 191.475 313.229C188.405 314.909 159.105 335.289 155.525 338.229L152.755 340.509L156.175 345.569C162.345 354.679 174.735 366.869 184.085 373.029Z"/>' +
    '<path class="loader-fill" d="M218.185 401.899C213.175 405.409 205.665 410.209 201.505 412.549L193.935 416.819L189.125 414.309C160.555 399.389 135.805 375.379 112.155 339.649L106.765 331.509L110.285 328.509C112.225 326.859 113.805 325.139 113.805 324.689C113.805 322.859 101.875 311.469 95.305 307.029C83.255 298.879 72.455 294.379 59.375 292.059C52.495 290.839 35.495 290.769 28.465 291.919C24.655 292.549 23.515 292.419 23.075 291.279C22.235 289.079 24.635 267.739 26.945 257.059C31.605 235.419 41.995 208.849 51.455 194.429C52.745 192.449 52.255 191.349 44.945 179.899C27.095 151.939 14.145 121.479 6.915 90.5085C0.754998 64.0785 -1.615 31.4185 1.135 10.6085C1.975 4.23853 2.785 1.40853 4.005 0.64853C9.065 -2.52147 39.985 6.51853 62.255 17.6785C96.355 34.7685 124.205 56.0885 158.125 91.0885L176.465 110.009H193.385L210.305 109.999L221.305 98.0185C243.725 73.5985 270.475 50.6185 296.315 33.5885C303.725 28.6985 308.245 26.0985 322.805 18.3585C332.255 13.3285 353.105 4.88853 360.805 2.98853C376.165 -0.81147 380.135 -0.93147 382.265 2.30853C384.815 6.19853 386.105 27.2385 384.815 44.0085C381.675 84.8885 371.875 119.939 353.105 157.399C347.505 168.569 346.875 169.669 337.885 183.689L332.645 191.859L336.055 197.189C349.295 217.879 360.175 252.099 362.705 281.009C363.735 292.799 363.335 293.439 355.875 292.019C343.145 289.609 323.715 291.709 310.075 296.969C297.415 301.849 282.845 312.119 275.595 321.269L272.465 325.229L276.225 328.379L279.975 331.529L273.795 340.949C257.305 366.049 235.945 389.469 218.185 401.899ZM67.095 162.839L71.135 169.159L75.225 164.359C81.485 156.999 95.305 143.529 104.325 135.999C113.865 128.029 133.585 113.029 135.485 112.299C136.215 112.019 136.805 111.429 136.805 110.979C136.805 108.299 114.365 87.1485 95.305 71.8585C79.025 58.7985 49.815 41.4285 35.925 36.5485C35.665 36.4485 35.405 36.3585 35.155 36.2685C32.345 35.2785 30.705 34.6985 29.805 35.2785C28.535 36.0685 28.685 39.0985 29.035 46.3285C29.065 46.7885 29.085 47.2685 29.105 47.7585C30.865 84.3585 45.725 129.349 67.095 162.839ZM311.415 164.889L314.195 168.259L316.245 165.679C319.605 161.459 329.665 142.809 334.825 131.259C341.895 115.409 346.765 101.229 350.355 86.0085C351.205 82.4385 352.325 77.7085 352.845 75.5085C353.375 73.3085 354.015 70.1585 354.275 68.5085C356.185 56.2785 356.765 50.4385 356.785 43.1485L356.805 34.7885L354.055 35.4685C349.035 36.7085 334.085 43.7585 323.425 49.8985C309.895 57.6885 298.105 66.0185 284.055 77.7185C271.155 88.4585 249.535 109.769 250.295 110.999C250.575 111.449 255.395 115.099 261.005 119.099C277.805 131.089 300.715 151.909 311.415 164.889ZM133.395 304.289L141.305 312.679L154.965 302.299C162.485 296.589 169.175 291.269 169.835 290.469C170.805 289.299 170.225 287.719 166.805 282.269C148.655 253.309 123.965 230.579 96.805 217.809C92.685 215.869 86.165 213.039 82.335 211.529L75.365 208.769L72.695 211.979C64.785 221.449 50.405 265.279 55.535 264.269C57.955 263.789 78.115 268.159 85.145 270.699C101.125 276.459 118.685 288.679 133.395 304.289ZM238.005 307.059L245.035 312.599L256.675 301.009C269.605 288.119 283.235 278.369 296.305 272.679C304.535 269.089 321.045 265.009 327.315 265.009C331.755 265.009 332.365 263.579 330.815 256.769C327.495 242.159 315.305 211.669 311.955 209.599C309.355 207.999 284.825 219.279 270.805 228.539C257.485 237.329 247.035 246.559 237.645 257.829C230.125 266.859 215.805 287.399 215.805 289.159C215.805 289.589 219.215 292.539 223.395 295.719C227.565 298.909 234.145 304.009 238.005 307.059ZM184.085 373.029L193.035 378.929L197.175 376.829C202.805 373.959 214.415 365.089 219.415 359.829C224.665 354.299 233.805 342.059 233.805 340.549C233.805 339.429 231.465 337.619 217.805 328.119C196.395 313.249 193.945 311.869 191.475 313.229C188.405 314.909 159.105 335.289 155.525 338.229L152.755 340.509L156.175 345.569C162.345 354.679 174.735 366.869 184.085 373.029Z"/>' +
    '</svg></div>' +
    '<p class="status">Connecting...</p>' +
    '<script>var p=document.getElementById("loaderPath");var l=p.getTotalLength();p.style.setProperty("--path-length",l);p.style.strokeDasharray=l;</script>' +
    '</body></html>';

  mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(loaderHTML));

  // Show window immediately for loader (bypass ready-to-show for data URL)
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }

  // Start loading app after a short delay
  setTimeout(loadApp, 1000);
}

/**
 * Load the main application
 */
function loadApp() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    logger.log('warn', 'Main', 'loadApp skipped - window not available');
    isLoadingApp = false;
    return;
  }
  if (isLoadingApp) {
    logger.log('info', 'Main', 'loadApp debounced - already loading');
    return;
  }
  isLoadingApp = true;
  loadRetries++;
  logger.log('info', 'Main', 'Loading app (attempt ' + loadRetries + '/' + MAX_LOAD_RETRIES + ')');

  // Set timeout for loading
  clearTimeout(loadTimeout);
  loadTimeout = setTimeout(function () {
    handleLoadTimeout();
  }, LOADER_TIMEOUT_MS);

  try {
    mainWindow.loadURL(APP_URL).then(function () {
      clearTimeout(loadTimeout);
      loadRetries = 0;
      isLoadingApp = false;
      logger.log('info', 'Main', 'App loaded successfully');
    }).catch(function (error) {
      isLoadingApp = false;
      logger.log('error', 'Main', 'Load failed: ' + error.message);
      handleLoadError(error);
    });
  } catch (e) {
    isLoadingApp = false;
    logger.log('error', 'Main', 'loadApp exception: ' + e.message);
    showOfflinePage('offline', null, e.message);
  }
}

/**
 * Handle load timeout
 */
function handleLoadTimeout() {
  isLoadingApp = false;
  logger.log('warn', 'Main', 'Load timeout reached');
  showOfflinePage('timeout', null, 'Connection timed out');
}

/**
 * Handle load error
 */
function handleLoadError(error) {
  clearTimeout(loadTimeout);
  isLoadingApp = false;
  logger.log('error', 'Main', 'Load error: ' + error.message);

  // Determine error type from error message/code
  var errorType = 'offline';
  var errorCode = null;
  var errorDesc = error.message;

  if (error.message.includes('ERR_INTERNET_DISCONNECTED') ||
    error.message.includes('ERR_NETWORK_CHANGED') ||
    error.message.includes('net::ERR_NETWORK_IO_SUSPENDED')) {
    errorType = 'offline';
  } else if (error.message.includes('ERR_NAME_NOT_RESOLVED') ||
    error.message.includes('ERR_NAME_RESOLUTION_FAILED')) {
    errorType = 'dns';
  } else if (error.message.includes('ERR_CONNECTION_TIMED_OUT') ||
    error.message.includes('ERR_TIMED_OUT')) {
    errorType = 'timeout';
  } else if (error.message.includes('ERR_SSL') ||
    error.message.includes('ERR_CERT')) {
    errorType = 'ssl';
  } else if (error.message.includes('ERR_CONNECTION_REFUSED') ||
    error.message.includes('ERR_CONNECTION_RESET') ||
    error.message.includes('ERR_CONNECTION_CLOSED')) {
    errorType = 'server-error';
  }

  showOfflinePage(errorType, errorCode, errorDesc);
}

/**
 * Show offline/error page
 */
function showOfflinePage(errorType, errorCode, errorDesc) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  isLoadingApp = false;
  clearTimeout(loadTimeout);

  var offlinePath = path.join(__dirname, 'offline.html');
  var query = {};
  if (errorType) query.type = errorType;
  if (errorCode) query.code = String(errorCode);
  if (errorDesc) query.desc = encodeURIComponent(errorDesc);

  logger.log('info', 'Main', 'Showing offline page: type=' + errorType + ', code=' + errorCode);

  // Use loadFile instead of loadURL for local files — more reliable and avoids file:// protocol issues
  mainWindow.loadFile(offlinePath, { query: query }).catch(function (e) {
    logger.log('error', 'Main', 'Failed to load offline page: ' + e.message);
  });
}

/**
 * Show crash page when renderer keeps crashing
 */
function showCrashPage() {
  // Use the offline page with crash error type for consistent UI
  showOfflinePage('crash', null, 'The app encountered a rendering error');
  logger.log('info', 'Main', 'Showing crash page via offline handler');
}

/**
 * Setup window events
 */
function setupWindowEvents() {
  mainWindow.on('close', function (event) {
    // CRITICAL: Let the window close during update installation
    if (isUpdating) {
      logger.log('info', 'Main', 'Window close allowed - update installing');
      return; // Don't prevent default
    }

    // FORCE PERSISTENT: Never let the window close
    event.preventDefault();

    if (isQuitting) {
      // Even when quitting, warn the user
      forceCloseAttempts++;
      logger.log('warn', 'Main', 'Close attempt #' + forceCloseAttempts + ' while quitting');

      if (forceCloseAttempts >= 3) {
        // After 3 attempts, allow quit but warn
        showNotification('⚠️ Talio Closing', 'Talio has been force-closed. Your activity will not be monitored. This action has been logged.');
        logger.log('warn', 'Main', 'Force close allowed after ' + forceCloseAttempts + ' attempts - LOGGED');
        // Log the force close event for admin visibility
        logForceCloseEvent();
        // Actually destroy the window
        mainWindow.destroy();
        return;
      }
    }

    // Show warning and minimize to tray instead
    showNotification('⚠️ Talio Cannot Be Closed', 'Talio must remain running on company devices. The app has been minimized to the system tray.');
    mainWindow.hide();
    logger.log('warn', 'Main', 'User attempted to close app - minimized to tray instead');
    return false;
  });

  mainWindow.on('closed', function () {
    logger.log('warn', 'Main', 'Window was closed/destroyed - scheduling recreation');
    mainWindow = null;
    // Auto-recreate window if it was destroyed
    scheduleWindowRecreation();
  });

  mainWindow.on('resize', saveWindowBounds);
  mainWindow.on('move', saveWindowBounds);

  // Handle navigation - did-finish-load fires for successful loads
  mainWindow.webContents.on('did-finish-load', function () {
    const url = mainWindow.webContents.getURL();
    logger.log('info', 'Main', 'Page loaded: ' + url);

    // Only inject auth listener for actual app pages, not data URLs
    if (url.startsWith('https://app.talio.in')) {
      injectAuthListener();
    }
  });

  // Handle page load failures - show offline page for network/server errors
  mainWindow.webContents.on('did-fail-load', function (event, errorCode, errorDescription, validatedURL, isMainFrame) {
    if (isMainFrame) {
      // If loadApp() is handling this failure via its catch handler, skip to avoid double-navigation
      if (isLoadingApp) {
        logger.log('info', 'Main', 'did-fail-load while loadApp active — deferring to loadApp handler');
        return;
      }
      logger.log('error', 'Main', 'Page failed to load: ' + errorDescription + ' (' + errorCode + ') - ' + validatedURL);

      // Map error codes to error types
      var errorType = 'offline';
      var httpCode = null;

      // Network errors
      if (errorCode === -106) { // ERR_INTERNET_DISCONNECTED
        errorType = 'offline';
      } else if (errorCode === -105 || errorCode === -137) { // ERR_NAME_NOT_RESOLVED, ERR_NAME_RESOLUTION_FAILED
        errorType = 'dns';
      } else if (errorCode === -102 || errorCode === -118) { // ERR_CONNECTION_REFUSED, ERR_CONNECTION_TIMED_OUT
        errorType = 'server-error';
      } else if (errorCode === -7) { // ERR_TIMED_OUT
        errorType = 'timeout';
      } else if (errorCode === -200 || errorCode === -201 || errorCode === -202) { // SSL errors
        errorType = 'ssl';
      } else if (errorCode === -21) { // ERR_NETWORK_CHANGED
        // Network changed - don't show offline page, try to reload instead
        logger.log('warn', 'Main', 'Network changed, will retry loading...');
        scheduleReload(2000);
        return;
      } else if (errorCode === -100 || errorCode === -101) { // ERR_CONNECTION_CLOSED, ERR_CONNECTION_RESET
        errorType = 'server-error';
      } else if (errorCode === -3) { // ERR_ABORTED - usually navigation was cancelled
        // Don't show offline page for aborted requests (e.g., navigation change)
        return;
      } else if (errorCode === -6) { // ERR_FILE_NOT_FOUND
        // Might be a whitescreen issue, try to reload
        logger.log('warn', 'Main', 'File not found error, attempting reload...');
        scheduleReload(1000);
        return;
      }

      showOfflinePage(errorType, httpCode, errorDescription);
    }
  });

  // Handle HTTP errors (4xx, 5xx) - intercept responses
  mainWindow.webContents.on('did-navigate', function (event, url, httpResponseCode) {
    if (httpResponseCode >= 500) {
      logger.log('error', 'Main', 'HTTP error ' + httpResponseCode + ' for ' + url);
      showOfflinePage('server-error', httpResponseCode.toString(), 'HTTP ' + httpResponseCode);
    } else if (httpResponseCode >= 400 && httpResponseCode !== 401 && httpResponseCode !== 404) {
      logger.log('warn', 'Main', 'HTTP client error ' + httpResponseCode + ' for ' + url);
    }
  });

  // Also handle in-page HTTP errors via response interception
  mainWindow.webContents.session.webRequest.onCompleted(
    { urls: ['https://app.talio.in/*'] },
    function (details) {
      // Check for server errors on main frame navigation
      if (details.resourceType === 'mainFrame' && details.statusCode >= 500) {
        logger.log('error', 'Main', 'Server error ' + details.statusCode + ' for ' + details.url);
        showOfflinePage('server-error', details.statusCode.toString(), 'Server returned ' + details.statusCode);
      }
    }
  );

  // Handle DOM ready - page is interactive but might still be loading resources
  // CRITICAL: Inject audio disable script here BEFORE React hydration completes
  mainWindow.webContents.on('dom-ready', function () {
    logger.log('info', 'Main', 'DOM ready');

    // Inject AudioContext disable as early as possible
    const url = mainWindow.webContents.getURL();
    if (url.startsWith('https://app.talio.in')) {
      injectAudioDisable();
    }
  });

  // Handle new window requests (open in browser)
  mainWindow.webContents.setWindowOpenHandler(function (details) {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // Handle certificate errors gracefully
  mainWindow.webContents.on('certificate-error', function (event, url, error, cert, callback) {
    logger.log('warn', 'Main', 'Certificate error: ' + error);
    callback(false);
  });
}

/**
 * Schedule window recreation if the window was destroyed
 * Acts as a watchdog to ensure the app stays running
 */
function scheduleWindowRecreation() {
  // CRITICAL: Never recreate while an update is being installed
  if (isUpdating) {
    logger.log('info', 'Main', 'Watchdog: Skipping window recreation - update in progress');
    return;
  }

  if (windowRecreateTimer) {
    clearTimeout(windowRecreateTimer);
  }

  windowRecreateTimer = setTimeout(function () {
    // Double-check: update may have started while timer was pending
    if (isUpdating) {
      logger.log('info', 'Main', 'Watchdog: Aborting recreation - update started during delay');
      return;
    }
    if (!mainWindow || mainWindow.isDestroyed()) {
      logger.log('info', 'Main', 'Watchdog: Recreating destroyed window');
      createWindow();

      // Setup network monitoring for new window
      setupNetworkMonitoring();

      // Re-authenticate if we had saved credentials
      var savedToken = store.get('authToken');
      var savedUser = store.get('userData');
      if (savedToken && savedUser) {
        setTimeout(function () {
          handleAuthentication({ token: savedToken, user: savedUser });
        }, 2000);
      }

      showNotification('\u26a0\ufe0f Talio Restarted', 'Talio window was closed and has been automatically reopened. This action has been logged.');
    }
  }, 2000); // Recreate after 2 seconds
}

/**
 * Log force-close event for admin audit trail
 */
function logForceCloseEvent() {
  try {
    var savedToken = store.get('authToken');
    var savedUser = store.get('userData');
    if (savedToken && savedUser) {
      var https = require('https');
      var postData = JSON.stringify({
        event: 'desktop-app-force-closed',
        userId: savedUser.userId || savedUser._id,
        employeeId: savedUser.employeeId,
        timestamp: new Date().toISOString(),
        platform: process.platform,
        appVersion: app.getVersion(),
        attempts: forceCloseAttempts
      });

      var req = https.request({
        hostname: 'app.talio.in',
        port: 443,
        path: '/api/maya/screen-capture',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + savedToken,
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 5000
      });
      req.on('error', function () { /* ignore */ });
      req.write(postData);
      req.end();
    }
  } catch (e) {
    logger.log('error', 'Main', 'Failed to log force close: ' + e.message);
  }
}

/**
 * Save window bounds for next launch
 */
function saveWindowBounds() {
  if (mainWindow) {
    const bounds = mainWindow.getBounds();
    store.set('windowBounds', bounds);
  }
}

/**
 * Inject AudioContext disable to prevent renderer crashes
 * MUST be called at dom-ready, before React hydration
 */
function injectAudioDisable() {
  const disableAudioScript = '(' + (function () {
    // CRITICAL: Disable AudioContext to prevent renderer crashes in Electron
    // This must run before any audio initialization
    if (window.__TALIO_AUDIO_DISABLED__) return;
    window.__TALIO_AUDIO_DISABLED__ = true;

    try {
      var OriginalAudioContext = window.AudioContext || window.webkitAudioContext;

      window.AudioContext = function () {
        console.log('[Talio Desktop] AudioContext disabled for stability');
        return {
          state: 'suspended',
          sampleRate: 44100,
          destination: { channelCount: 2 },
          resume: function () { return Promise.resolve(); },
          suspend: function () { return Promise.resolve(); },
          close: function () { return Promise.resolve(); },
          createGain: function () {
            var audioParam = {
              value: 0,
              setValueAtTime: function () { return this; },
              linearRampToValueAtTime: function () { return this; },
              exponentialRampToValueAtTime: function () { return this; },
              setTargetAtTime: function () { return this; },
              setValueCurveAtTime: function () { return this; },
              cancelScheduledValues: function () { return this; }
            };
            return {
              connect: function () { return this; },
              disconnect: function () { },
              gain: audioParam
            };
          },
          createBufferSource: function () {
            return {
              connect: function () { return this; },
              disconnect: function () { },
              start: function () { },
              stop: function () { },
              buffer: null
            };
          },
          createOscillator: function () {
            var audioParam = {
              value: 440,
              setValueAtTime: function () { return this; },
              linearRampToValueAtTime: function () { return this; },
              exponentialRampToValueAtTime: function () { return this; },
              setTargetAtTime: function () { return this; },
              setValueCurveAtTime: function () { return this; },
              cancelScheduledValues: function () { return this; }
            };
            return {
              connect: function () { return this; },
              disconnect: function () { },
              start: function () { },
              stop: function () { },
              type: 'sine',
              frequency: audioParam,
              detune: audioParam
            };
          },
          decodeAudioData: function (buffer, success, error) {
            if (error) error(new Error('AudioContext disabled in desktop app'));
            return Promise.reject(new Error('AudioContext disabled in desktop app'));
          }
        };
      };
      window.webkitAudioContext = window.AudioContext;
      console.log('[Talio Desktop] AudioContext patched for stability');
    } catch (e) {
      console.warn('[Talio Desktop] Failed to patch AudioContext:', e);
    }
  }).toString() + ')()';

  mainWindow.webContents.executeJavaScript(disableAudioScript).catch(function (e) {
    logger.log('warn', 'Main', 'Failed to inject audio disable script: ' + e.message);
  });
}

/**
 * Inject authentication listener into the page
 */
function injectAuthListener() {
  const script = '(' + (function () {
    // Check for stored auth data
    function checkAuth() {
      try {
        var token = localStorage.getItem('token');
        var userStr = localStorage.getItem('user');
        if (token && userStr) {
          var user = JSON.parse(userStr);
          window.electronAPI.sendAuthData({ token: token, user: user });
        }
      } catch (e) {
        console.error('[Talio Desktop] Auth check error:', e);
      }
    }

    // Check immediately and on storage changes
    checkAuth();
    window.addEventListener('storage', checkAuth);

    // Also check periodically for initial load
    var checkCount = 0;
    var authInterval = setInterval(function () {
      checkAuth();
      checkCount++;
      if (checkCount > 10) clearInterval(authInterval);
    }, 1000);
  }).toString() + ')()';

  mainWindow.webContents.executeJavaScript(script).catch(function () { });

  // Also inject network status listener
  injectNetworkStatusListener();
}

/**
 * Inject network status listener to detect when connection drops while app is running
 */
function injectNetworkStatusListener() {
  const networkScript = '(' + (function () {
    // Skip if already injected
    if (window.__TALIO_NETWORK_LISTENER_INJECTED__) return;
    window.__TALIO_NETWORK_LISTENER_INJECTED__ = true;

    console.log('[Talio Desktop] Network status listener injected');

    // Listen for offline event
    window.addEventListener('offline', function () {
      console.log('[Talio Desktop] Browser detected offline');
      if (window.electronAPI && window.electronAPI.setOnlineStatus) {
        window.electronAPI.setOnlineStatus(false);
      }
    });

    // Listen for online event  
    window.addEventListener('online', function () {
      console.log('[Talio Desktop] Browser detected online');
      if (window.electronAPI && window.electronAPI.setOnlineStatus) {
        window.electronAPI.setOnlineStatus(true);
      }
    });

    // Also do periodic connectivity checks
    var lastOnlineState = navigator.onLine;
    setInterval(function () {
      var currentState = navigator.onLine;
      if (currentState !== lastOnlineState) {
        lastOnlineState = currentState;
        console.log('[Talio Desktop] Network state changed:', currentState ? 'online' : 'offline');
        if (window.electronAPI && window.electronAPI.setOnlineStatus) {
          window.electronAPI.setOnlineStatus(currentState);
        }
      }
    }, 3000);

    // Report initial state
    if (window.electronAPI && window.electronAPI.setOnlineStatus) {
      window.electronAPI.setOnlineStatus(navigator.onLine);
    }
  }).toString() + ')()';

  mainWindow.webContents.executeJavaScript(networkScript).catch(function (e) {
    logger.log('warn', 'Main', 'Failed to inject network listener: ' + e.message);
  });
}

/**
 * Setup IPC handlers
 */
function setupIPCHandlers() {
  // App version
  ipcMain.handle('get-app-version', function () {
    return app.getVersion();
  });

  // App info (full details for App Info page)
  ipcMain.handle('get-app-info', function () {
    // Detect native architecture - on Apple Silicon running x64 under Rosetta, report arm64
    const nativeArch = (process.platform === 'darwin' && process.arch === 'x64' && app.runningUnderARM64Translation)
      ? 'arm64'
      : process.arch;

    return {
      version: app.getVersion(),
      platform: process.platform,
      arch: nativeArch,
      appPath: app.getAppPath(),
      userDataPath: app.getPath('userData'),
      isPackaged: app.isPackaged,
    };
  });

  // Authentication
  ipcMain.handle('auth-data', function (event, data) {
    handleAuthentication(data);
    return { success: true };
  });

  ipcMain.handle('logout', function () {
    handleLogout();
    return { success: true };
  });

  // Screenshot service
  ipcMain.handle('start-capture', function () {
    return screenshotService.start();
  });

  ipcMain.handle('stop-capture', function () {
    screenshotService.stop();
    return { success: true };
  });

  ipcMain.handle('manual-capture', async function () {
    return await screenshotService.manualCapture();
  });

  ipcMain.handle('get-capture-status', function () {
    return screenshotService.getStatus();
  });

  ipcMain.handle('get-capture-stats', function () {
    return screenshotService.getStats();
  });

  ipcMain.handle('get-session-info', function () {
    var sessionManager = require('./sessionManager');
    return sessionManager.getSessionInfo();
  });

  // Network status - handle online/offline transitions
  ipcMain.handle('set-online-status', function (event, online) {
    screenshotService.setOnlineStatus(online);

    // If network went offline and we're not already on the offline page, show it
    if (!online && mainWindow && !mainWindow.isDestroyed()) {
      const currentUrl = mainWindow.webContents.getURL();
      const isAlreadyOnOfflinePage = currentUrl.includes('offline.html') || currentUrl.startsWith('file://');

      if (!isAlreadyOnOfflinePage) {
        logger.log('info', 'Main', 'Network went offline, showing offline page');
        showOfflinePage('offline', null, 'Network connection lost');
      }
    }

    // If network came back online and we're on the offline page, reload the app
    if (online && mainWindow && !mainWindow.isDestroyed()) {
      const currentUrl = mainWindow.webContents.getURL();
      const isOnOfflinePage = currentUrl.includes('offline.html') || currentUrl.startsWith('file://');

      if (isOnOfflinePage) {
        logger.log('info', 'Main', 'Network restored, reloading app');
        loadRetries = 0;
        loadApp();
      }
    }

    return { success: true };
  });

  // Window controls
  ipcMain.handle('minimize-window', function () {
    if (mainWindow) mainWindow.minimize();
    return { success: true };
  });

  ipcMain.handle('maximize-window', function () {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
    return { success: true };
  });

  ipcMain.handle('close-window', function () {
    if (mainWindow) mainWindow.hide();
    return { success: true };
  });

  // Notifications
  ipcMain.handle('show-notification', function (event, data) {
    showNotification(data.title, data.body);
    return { success: true };
  });

  // Notification permission check
  ipcMain.handle('check-notification-permission', function () {
    var supported = Notification.isSupported();
    var status = 'unknown';

    if (!supported) {
      status = 'unsupported';
    } else if (process.platform === 'darwin') {
      // macOS: check via systemPreferences
      try {
        var notifStatus = systemPreferences.getMediaAccessStatus ? 'granted' : 'unknown';
        // On macOS, notifications are permission-managed by the OS
        // We can only check if Notification is supported and try to send
        status = 'granted'; // Assume granted if supported; macOS blocks silently
      } catch (e) {
        status = 'unknown';
      }
    } else if (process.platform === 'win32') {
      // Windows: notifications work if app model ID is set
      status = 'granted';
    } else {
      status = supported ? 'granted' : 'denied';
    }

    return { supported: supported, status: status, platform: process.platform };
  });

  // Open notification settings (OS-level)
  ipcMain.handle('open-notification-settings', async function () {
    if (process.platform === 'darwin') {
      // macOS: open System Settings > Notifications for this app
      try {
        // macOS Ventura+ uses System Settings
        await shell.openExternal('x-apple.systempreferences:com.apple.Notifications-Settings.extension');
      } catch (e) {
        // Fallback for older macOS
        try {
          await shell.openExternal('x-apple.systempreferences:com.apple.preference.notifications');
        } catch (e2) {
          logger.log('warn', 'Main', 'Could not open notification settings: ' + e2.message);
        }
      }
    } else if (process.platform === 'win32') {
      // Windows: open notification settings
      try {
        await shell.openExternal('ms-settings:notifications');
      } catch (e) {
        logger.log('warn', 'Main', 'Could not open notification settings: ' + e.message);
      }
    }
    return { success: true };
  });

  // Test notification (for verifying permission works)
  ipcMain.handle('test-notification', function () {
    try {
      showNotification('Talio Notifications', 'Notifications are working! You will receive updates for messages, tasks, and more.');
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // Restart app (for crash recovery)
  ipcMain.handle('restart-app', function () {
    logger.log('info', 'Main', 'Restart requested');
    crashCount = 0;
    app.relaunch();
    app.exit(0);
  });

  // Welcome screen completed
  ipcMain.handle('welcome-complete', function () {
    logger.log('info', 'Main', 'Welcome screen completed');
    store.set('hasSeenWelcome', true);
    showLoader();
    return { success: true };
  });

  // Load app (for offline page retry)
  ipcMain.handle('load-app', function () {
    logger.log('info', 'Main', 'Load app requested from offline page');
    loadRetries = 0;
    loadApp();
    return { success: true };
  });

  // Get all connected displays for multi-monitor screen sharing
  ipcMain.handle('get-displays', function () {
    const displays = screen.getAllDisplays();
    const primaryDisplay = screen.getPrimaryDisplay();

    return displays.map(function (display, index) {
      const isPrimary = display.id === primaryDisplay.id;
      return {
        id: display.id,
        label: isPrimary ? 'Primary Display' : ('Display ' + (index + 1)),
        bounds: display.bounds,
        workArea: display.workArea,
        scaleFactor: display.scaleFactor,
        rotation: display.rotation,
        isPrimary: isPrimary
      };
    });
  });

  // Request screen share with source picker (Windows compatibility)
  ipcMain.handle('request-screen-share', async function () {
    try {
      logger.log('info', 'Main', 'Screen share requested');

      // Get all available sources (screens and windows)
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true
      });

      if (sources.length === 0) {
        logger.log('warn', 'Main', 'No screen sources available');
        return { success: false, error: 'No screens or windows available' };
      }

      // On Windows, we need to show our own picker since getDisplayMedia doesn't work well
      if (process.platform === 'win32') {
        // Return sources for the renderer to show a picker UI
        return {
          success: true,
          requiresPicker: true,
          sources: sources.map(function (source) {
            return {
              id: source.id,
              name: source.name,
              thumbnail: source.thumbnail.toDataURL(),
              appIcon: source.appIcon ? source.appIcon.toDataURL() : null,
              display_id: source.display_id,
              isScreen: source.id.startsWith('screen:')
            };
          })
        };
      }

      // On macOS, return the sources and let navigator.mediaDevices.getDisplayMedia handle it
      return {
        success: true,
        requiresPicker: false,
        sources: sources.map(function (source) {
          return {
            id: source.id,
            name: source.name,
            thumbnail: source.thumbnail.toDataURL(),
            appIcon: source.appIcon ? source.appIcon.toDataURL() : null,
            display_id: source.display_id,
            isScreen: source.id.startsWith('screen:')
          };
        })
      };
    } catch (error) {
      logger.log('error', 'Main', 'Screen share request failed: ' + error.message);
      return { success: false, error: error.message };
    }
  });

  // Get screen share stream for a specific source
  ipcMain.handle('get-screen-share-stream', async function (event, sourceId) {
    try {
      logger.log('info', 'Main', 'Getting screen share stream for source: ' + sourceId);
      // Return the source ID to be used with getUserMedia constraints
      return {
        success: true,
        sourceId: sourceId,
        constraints: {
          audio: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId
            }
          },
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId,
              minWidth: 1280,
              maxWidth: 1920,
              minHeight: 720,
              maxHeight: 1080,
              minFrameRate: 15,
              maxFrameRate: 30
            }
          }
        }
      };
    } catch (error) {
      logger.log('error', 'Main', 'Get screen share stream failed: ' + error.message);
      return { success: false, error: error.message };
    }
  });

  // ── Title Bar Color IPC ────────────────────────────────────────────
  ipcMain.handle('set-title-bar-color', function (event, bgColor) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      var parsed = parseRGBColor(bgColor);
      if (!parsed) return;
      // Determine if background is dark (luminance check)
      var lum = parsed.r * 0.299 + parsed.g * 0.587 + parsed.b * 0.114;
      var isDark = lum < 128;
      var hexColor = rgbToHex(parsed.r, parsed.g, parsed.b);
      // On Windows use transparent overlay so controls blend with app
      var overlayColor = process.platform === 'win32' ? '#00000000' : hexColor;
      mainWindow.setTitleBarOverlay({
        color: overlayColor,
        symbolColor: isDark ? '#E2E8F0' : '#64748B',
        height: process.platform === 'win32' ? 32 : 40
      });
      mainWindow.setBackgroundColor(hexColor);
    } catch (e) {
      // Silently ignore color parse failures
    }
  });

  // ── Auto-Update IPC ──────────────────────────────────────────────────
  ipcMain.handle('check-for-update', function (event, options) {
    logger.log('info', 'Updater', 'Manual update check requested');
    var silent = options && options.silent;
    // When called from App Info page (silent), stay in-app - don't navigate to update.html
    inAppUpdateMode = !!silent;
    checkForUpdates(silent);
    return { success: true };
  });

  ipcMain.handle('start-update', function () {
    logger.log('info', 'Updater', 'Start update / download requested');
    autoUpdater.checkForUpdates().then(function (result) {
      if (result && result.updateInfo) {
        autoUpdater.downloadUpdate().catch(function (err) {
          logger.log('error', 'Updater', 'Download failed: ' + err.message);
        });
      }
    }).catch(function (err) {
      logger.log('error', 'Updater', 'Check failed: ' + err.message);
    });
    return { success: true };
  });

  ipcMain.handle('retry-update', function () {
    logger.log('info', 'Updater', 'Retry update download');
    autoUpdater.downloadUpdate().catch(function (err) {
      logger.log('error', 'Updater', 'Retry download failed: ' + err.message);
    });
    return { success: true };
  });

  ipcMain.handle('install-update', function () {
    logger.log('info', 'Updater', 'Install update and restart');
    isQuitting = true;
    isUpdating = true;
    forceCloseAttempts = 999;
    autoUpdater.quitAndInstall(false, true);
  });
}

/**
 * Handle authentication
 */
function handleAuthentication(data) {
  if (!data || !data.token || !data.user) {
    logger.log('warn', 'Main', 'Invalid auth data');
    return;
  }

  // Store auth data
  userData = data.user;
  store.set('userData', userData);
  store.set('authToken', data.token);
  isAuthenticated = true;

  logger.log('info', 'Main', 'Authenticated as ' + userData.email + ' (role: ' + userData.role + ')');

  // Initialize services
  screenshotService.initialize({
    userId: userData.userId || userData._id,
    employeeId: userData.employeeId,
    role: userData.role,
    token: data.token,
    mainWindow: mainWindow,
    onPermissionError: function (message) {
      showNotification('Screen Recording Permission Required', message);
      // Also open system preferences on macOS
      if (process.platform === 'darwin') {
        shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
      }
    }
  });

  // Initialize socket
  socketHandler.initialize(userData.userId || userData._id, data.token);

  // Setup socket callbacks
  socketHandler.on('screenshotRequest', function () {
    screenshotService.manualCapture();
  });

  socketHandler.on('notification', function (notif) {
    showNotification(notif.title, notif.message || notif.body, { url: notif.url });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('notification', notif);
    }
  });

  socketHandler.on('gameInvite', function (data) {
    showNotification('🎮 Game Invite!', (data.fromName || 'Someone') + ' wants to play Tic-Tac-Toe', { urgency: 'critical' });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('game-invite', data);
    }
  });

  socketHandler.on('callAlert', function (data) {
    showNotification('📞 Incoming Call', (data.callerName || 'Someone') + ' is calling you', { urgency: 'critical', url: data.url });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('call-alert', data);
    }
  });

  socketHandler.on('forceRefresh', function () {
    if (mainWindow && !mainWindow.isDestroyed()) {
      logger.log('info', 'Main', 'Force refresh - reloading app');
      setTimeout(function () {
        loadRetries = 0;
        loadApp();
      }, 2000);
    }
  });

  socketHandler.on('triggerUpdateCheck', function () {
    logger.log('info', 'Main', 'Server requested update check');
    checkForUpdates(false);
  });

  socketHandler.on('connect', function () {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('socket-status', { connected: true });
    }
  });

  socketHandler.on('disconnect', function () {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('socket-status', { connected: false });
    }
  });

  // Start capture (only for non-admin users)
  if (userData.role !== 'admin') {
    screenshotService.start();
  } else {
    logger.log('info', 'Main', 'Admin user - screen capture disabled');
  }

  // Update tray menu
  updateTrayMenu();
}

/**
 * Handle logout
 */
function handleLogout() {
  logger.log('info', 'Main', 'User logged out');

  screenshotService.reset();
  socketHandler.reset();

  store.delete('userData');
  store.delete('authToken');

  isAuthenticated = false;
  userData = null;

  updateTrayMenu();
}

/**
 * Create system tray
 */
function createTray() {
  const icon = getTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('Talio');

  updateTrayMenu();

  tray.on('click', function () {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  logger.log('info', 'Main', 'Tray created');
}

/**
 * Update tray context menu
 */
function updateTrayMenu() {
  var menuItems = [
    { label: 'Open Talio', click: function () { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { type: 'separator' }
  ];

  if (isAuthenticated && userData) {
    menuItems.push({ label: 'Logged in as: ' + (userData.email || 'Unknown'), enabled: false });

    if (userData.role !== 'admin') {
      var status = screenshotService.getStatus();
      menuItems.push({
        label: status.isCapturing ? 'Pause Capture' : 'Resume Capture',
        click: function () {
          if (status.isCapturing) {
            screenshotService.stop();
          } else {
            screenshotService.start();
          }
          updateTrayMenu();
        }
      });
    }

    menuItems.push({ type: 'separator' });
  }

  menuItems.push(
    { label: 'Start at Login', type: 'checkbox', checked: store.get('autoLaunch', true), click: toggleAutoLaunch },
    { type: 'separator' },
    { label: 'Talio v' + app.getVersion(), enabled: false }
  );

  var contextMenu = Menu.buildFromTemplate(menuItems);
  tray.setContextMenu(contextMenu);
}

/**
 * Toggle auto-launch setting
 */
async function toggleAutoLaunch(menuItem) {
  try {
    if (menuItem.checked) {
      await autoLauncher.enable();
      store.set('autoLaunch', true);
      logger.log('info', 'Main', 'Auto-launch enabled');
    } else {
      await autoLauncher.disable();
      store.set('autoLaunch', false);
      logger.log('info', 'Main', 'Auto-launch disabled');
    }
  } catch (error) {
    logger.log('error', 'Main', 'Auto-launch toggle failed: ' + error.message);
  }
}

/**
 * Show desktop notification with click-to-navigate support
 * @param {string} title - Notification title
 * @param {string} body - Notification body text
 * @param {Object} options - Options: silent, urgency, url
 */
function showNotification(title, body, options) {
  if (!Notification.isSupported()) return;

  try {
    // Use 256px icon for notifications (better rendering on all platforms)
    var notifIconPath = path.join(__dirname, '..', 'build', 'icon-256.png');
    var notifIcon;
    try { notifIcon = nativeImage.createFromPath(notifIconPath); } catch (e) { notifIcon = getAppIcon(); }

    var notification = new Notification({
      title: title || 'Talio',
      body: body || '',
      icon: notifIcon,
      silent: options?.silent || false,
      urgency: options?.urgency || 'normal',
      timeoutType: 'default'
    });

    // Click notification → focus window and navigate to URL if provided
    notification.on('click', function () {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();

        // Navigate to specific page if URL is provided
        if (options?.url) {
          var targetUrl = options.url.startsWith('http') ? options.url : APP_URL + options.url;
          mainWindow.webContents.loadURL(targetUrl).catch(function (err) {
            logger.log('warn', 'Main', 'Notification navigate failed: ' + err.message);
          });
        }
      }
    });

    notification.show();

    // Update macOS dock badge count
    if (process.platform === 'darwin' && !options?.silent) {
      var currentBadge = app.getBadgeCount() || 0;
      app.setBadgeCount(currentBadge + 1);
    }
  } catch (e) {
    logger.log('warn', 'Main', 'Failed to show notification: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-UPDATER SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Setup electron-updater with GitHub Releases
 */
function setupAutoUpdater() {
  // Configure updater
  autoUpdater.autoDownload = false; // We control download manually
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.forceCodeSigning = false; // Allow updates from unsigned builds

  // Skip code signature verification on Windows (fixes update failures for unsigned builds)
  // This overrides the app-update.yml setting at runtime, ensuring even older installed
  // versions that lack verifyUpdateCodeSignature: false in their yml can still update.
  if (process.platform === 'win32') {
    autoUpdater.verifyUpdateCodeSignature = function () {
      return Promise.resolve(null);
    };
  }

  // Detailed provider config logging
  logger.log('info', 'Updater', 'Auto-updater configured - provider: GitHub Releases, version: ' + app.getVersion() + ', platform: ' + process.platform + ', arch: ' + process.arch);

  autoUpdater.on('checking-for-update', function () {
    logger.log('info', 'Updater', '[LIFECYCLE] Checking for update...');
    sendUpdateStatus('checking');
  });

  autoUpdater.on('update-available', function (info) {
    logger.log('info', 'Updater', '[LIFECYCLE] Update available: v' + info.version + ' (releaseDate: ' + (info.releaseDate || 'unknown') + ', files: ' + JSON.stringify((info.files || []).map(function (f) { return f.url; })) + ')');
    // Dismiss the "checking" dialog - update screen will take over
    dismissUpdateCheckDialog();
    sendUpdateStatus('available', { version: info.version });

    if (inAppUpdateMode) {
      // In-app mode: don't navigate away, just download in background
      isUpdating = true;
      sendUpdateStatus('downloading', { version: info.version, percent: 0 });
      autoUpdater.downloadUpdate().catch(function (error) {
        logger.log('error', 'Updater', 'Download failed: ' + error.message);
        sendUpdateStatus('error', { message: error.message });
      });
    } else {
      handleUpdateAvailable(info);
    }
  });

  autoUpdater.on('update-not-available', function (info) {
    logger.log('info', 'Updater', '[LIFECYCLE] No update available. Current: v' + app.getVersion() + ', Latest: v' + info.version);
    sendUpdateStatus('up-to-date', { version: info.version });
    // If a "checking for updates" dialog was shown, replace it with "up to date"
    if (updateCheckDialog && !updateCheckDialog.isDestroyed()) {
      dismissUpdateCheckDialog();
      if (mainWindow && !mainWindow.isDestroyed()) {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Talio Update',
          message: 'You\'re up to date!',
          detail: 'Talio Desktop v' + info.version + ' is the latest version.',
          buttons: ['OK']
        }).catch(function () { });
      }
    }
  });

  autoUpdater.on('download-progress', function (progress) {
    var pct = Math.round(progress.percent || 0);
    if (pct % 25 === 0 || pct === 100) {
      logger.log('info', 'Updater', '[LIFECYCLE] Download progress: ' + pct + '% (' + Math.round((progress.transferred || 0) / 1048576) + '/' + Math.round((progress.total || 0) / 1048576) + ' MB)');
    }
    sendUpdateStatus('downloading', {
      percent: pct,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total
    });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript(
        'window.postMessage(' + JSON.stringify({
          type: 'update-progress',
          percent: progress.percent,
          bytesPerSecond: progress.bytesPerSecond,
          transferred: progress.transferred,
          total: progress.total
        }) + ', "*")'
      ).catch(function () { });
    }
    // Update taskbar progress (Windows) / dock progress (macOS)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(progress.percent / 100);
    }
  });

  autoUpdater.on('update-downloaded', function (info) {
    logger.log('info', 'Updater', '[LIFECYCLE] Update downloaded. Preparing to install v' + info.version + '...');
    sendUpdateStatus('downloaded', { version: info.version });

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(-1); // Clear progress bar
      mainWindow.webContents.executeJavaScript(
        'window.postMessage({ type: "update-downloaded" }, "*")'
      ).catch(function () { });
    }

    // Clear old cache before installing
    clearAppCache();

    // In-app mode: let the user click "Restart to Update" from the App Info page
    if (inAppUpdateMode) {
      inAppUpdateMode = false;
      return;
    }

    // Non-in-app mode: auto-install after showing completion animation
    setTimeout(function () {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.executeJavaScript(
          'window.postMessage({ type: "update-complete" }, "*")'
        ).catch(function () { });
      }

      // Quit and install after showing completion screen
      setTimeout(function () {
        logger.log('info', 'Updater', '[LIFECYCLE] quitAndInstall() called (isSilent=false, isForceRunAfter=true)');
        // Track this install attempt so we can detect failed installs on next startup
        store.set('updateInstallAttempt', { version: info.version, timestamp: Date.now() });
        // CRITICAL: Set flags BEFORE quitAndInstall so before-quit/close handlers allow it
        isQuitting = true;
        isUpdating = true; // Tells window-all-closed & scheduleWindowRecreation to stand down
        forceCloseAttempts = 999; // Bypass force-close protection for update
        autoUpdater.quitAndInstall(false, true); // isSilent=false, isForceRunAfter=true
      }, 2500);
    }, 1500);
  });

  autoUpdater.on('error', function (error) {
    logger.log('error', 'Updater', '[LIFECYCLE] Update error: ' + error.message + (error.stack ? '\n' + error.stack : ''));
    dismissUpdateCheckDialog();

    // CRITICAL: Reset isUpdating so future update checks are not blocked
    isUpdating = false;

    sendUpdateStatus('error', { message: error.message });

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(-1);
      mainWindow.webContents.executeJavaScript(
        'window.postMessage(' + JSON.stringify({
          type: 'update-error',
          message: error.message
        }) + ', "*")'
      ).catch(function () { });
    }
  });

  // Schedule periodic update checks (silent)
  updateCheckTimer = setInterval(function () {
    checkForUpdates(true);
  }, UPDATE_CHECK_INTERVAL);
}

/**
 * Send update status to the renderer via IPC
 */
function sendUpdateStatus(status, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status: status, ...data });
  }
}

/**
 * Check for updates (called on startup and periodically)
 * @param {boolean} silent - If true, don't show UI for "no update" case
 */
function checkForUpdates(silent) {
  if (isUpdating) {
    logger.log('info', 'Updater', 'checkForUpdates skipped - update already in progress');
    return;
  }

  logger.log('info', 'Updater', 'checkForUpdates called (silent=' + silent + ')');

  // Show a "Checking for updates" dialog on non-silent checks
  if (!silent && mainWindow && !mainWindow.isDestroyed()) {
    showUpdateCheckDialog();
  }

  autoUpdater.checkForUpdates().catch(function (error) {
    logger.log('warn', 'Updater', 'Update check failed: ' + error.message);
    dismissUpdateCheckDialog();
    sendUpdateStatus('error', { message: error.message });
  });
}

/**
 * Show a small dialog window indicating we're checking for updates
 */
function showUpdateCheckDialog() {
  if (updateCheckDialog && !updateCheckDialog.isDestroyed()) return;

  updateCheckDialog = new BrowserWindow({
    width: 360,
    height: 160,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    parent: mainWindow,
    modal: true,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });

  var html = '<!DOCTYPE html><html><head><style>'
    + 'body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:transparent;}'
    + '.card{background:#fff;border-radius:16px;padding:28px 32px;box-shadow:0 8px 32px rgba(0,0,0,0.18);text-align:center;min-width:280px;}'
    + '@media(prefers-color-scheme:dark){.card{background:#1e1e2e;color:#e0e0e0}}'
    + '.spinner{width:32px;height:32px;border:3px solid #e0e0e0;border-top:3px solid #6366f1;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 14px;}'
    + '@keyframes spin{to{transform:rotate(360deg)}}'
    + 'h3{margin:0 0 4px;font-size:15px;font-weight:600}'
    + 'p{margin:0;font-size:12px;color:#888}'
    + '</style></head><body><div class="card">'
    + '<div class="spinner"></div>'
    + '<h3>Checking for updates</h3>'
    + '<p>Please wait...</p>'
    + '</div></body></html>';

  updateCheckDialog.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  updateCheckDialog.once('ready-to-show', function () {
    if (updateCheckDialog && !updateCheckDialog.isDestroyed()) {
      updateCheckDialog.show();
    }
  });
}

/**
 * Dismiss the "Checking for updates" dialog if open
 */
function dismissUpdateCheckDialog() {
  if (updateCheckDialog && !updateCheckDialog.isDestroyed()) {
    updateCheckDialog.close();
  }
  updateCheckDialog = null;
}

/**
 * Handle update available - show update screen and start download
 */
function handleUpdateAvailable(info) {
  isUpdating = true;
  logger.log('info', 'Updater', 'handleUpdateAvailable - loading update screen for v' + info.version);

  // Show update page
  if (mainWindow && !mainWindow.isDestroyed()) {
    var updatePath = path.join(__dirname, 'update.html');
    mainWindow.loadFile(updatePath).then(function () {
      // Send version info to the update page
      mainWindow.webContents.executeJavaScript(
        'window.postMessage(' + JSON.stringify({
          type: 'update-versions',
          current: app.getVersion(),
          latest: info.version
        }) + ', "*")'
      ).catch(function () { });

      mainWindow.show();
      mainWindow.focus();
    }).catch(function (err) {
      logger.log('error', 'Updater', 'Failed to load update page: ' + err.message);
    });

    // Start downloading the update
    autoUpdater.downloadUpdate().catch(function (error) {
      logger.log('error', 'Updater', 'Download failed: ' + error.message);
    });
  }
}

/**
 * Clear app cache to ensure clean update
 */
function clearAppCache() {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.session.clearCache();
      mainWindow.webContents.session.clearStorageData({
        storages: ['cachestorage', 'serviceworkers']
      });
      logger.log('info', 'Updater', 'App cache cleared for clean update');
    }
  } catch (e) {
    logger.log('warn', 'Updater', 'Cache clear failed: ' + e.message);
  }
}

/**
 * Check if the current version is below the minimum required version.
 * If so, block the app and force an update.
 */
async function checkForceUpdate() {
  try {
    var response = await fetch(MIN_VERSION_CHECK_URL, {
      headers: { 'x-app-version': app.getVersion() }
    });

    if (!response.ok) {
      logger.log('warn', 'Updater', 'Min version check failed: HTTP ' + response.status);
      return false;
    }

    var data = await response.json();
    var minVersion = data.minVersion;
    var currentVersion = app.getVersion();

    if (!minVersion) {
      logger.log('info', 'Updater', 'No minimum version enforced');
      return false;
    }

    logger.log('info', 'Updater', 'Min version: ' + minVersion + ', Current: ' + currentVersion);

    if (compareVersions(currentVersion, minVersion) < 0) {
      logger.log('warn', 'Updater', 'App version is below minimum! Triggering auto-update before blocking UI.');

      // Try to start the auto-update FIRST - only block the UI if we can't update silently
      try {
        var result = await autoUpdater.checkForUpdates();
        if (result && result.updateInfo && compareVersions(result.updateInfo.version, currentVersion) > 0) {
          logger.log('info', 'Updater', 'Update available (v' + result.updateInfo.version + ') - update screen will take over');
          // handleUpdateAvailable is triggered by the 'update-available' event
          // Don't show the blocking screen since the update UI handles it
          return true;
        }
      } catch (updateErr) {
        logger.log('warn', 'Updater', 'Auto-update check failed during force-update: ' + updateErr.message);
      }

      // Only show the blocking screen if auto-update couldn't start
      logger.log('warn', 'Updater', 'No update found or update check failed - showing blocking screen');
      showUpdateRequiredScreen(currentVersion, minVersion, data.message);
      return true;
    }

    return false;
  } catch (error) {
    logger.log('warn', 'Updater', 'Force update check failed: ' + error.message);
    return false; // Don't block on network errors
  }
}

/**
 * Compare two semver version strings.
 * Returns -1 if a < b, 0 if equal, 1 if a > b.
 */
function compareVersions(a, b) {
  var pa = a.split('.').map(Number);
  var pb = b.split('.').map(Number);
  for (var i = 0; i < 3; i++) {
    var na = pa[i] || 0;
    var nb = pb[i] || 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

/**
 * Show the "Update Required" blocking screen
 */
function showUpdateRequiredScreen(currentVersion, minVersion, serverMessage) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  var msg = serverMessage || 'A critical update is available. You must update to continue using Talio.';

  // Use webContents.on('console-message') as a communication channel from data URL
  // The page will console.log('TALIO_START_UPDATE') which we intercept
  // (data URLs don't get preload.js, so electronAPI won't be available)
  var updateListener = function (event, level, message) {
    if (message === 'TALIO_START_UPDATE') {
      logger.log('info', 'Updater', 'Update triggered from required-update screen');
      mainWindow.webContents.removeListener('console-message', updateListener);
      checkForUpdates(false);
    }
  };
  // Remove any previous listener to prevent duplicates if called multiple times
  if (mainWindow._updateRequiredListener) {
    mainWindow.webContents.removeListener('console-message', mainWindow._updateRequiredListener);
  }
  mainWindow._updateRequiredListener = updateListener;
  mainWindow.webContents.on('console-message', updateListener);

  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Update Required - Talio</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Raleway:wght@400;500;600;700;800&display=swap" rel="stylesheet">' +
    '<style>' +
    '*{margin:0;padding:0;box-sizing:border-box}' +
    'body{font-family:Raleway,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:linear-gradient(145deg,#FEF2F2 0%,#FFF7ED 50%,#FFFBEB 100%);height:100vh;display:flex;align-items:center;justify-content:center;-webkit-app-region:drag;user-select:none}' +
    '.c{text-align:center;max-width:440px;padding:40px;animation:fadeIn .5s ease-out}' +
    '@keyframes fadeIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}' +
    '.shield{width:80px;height:80px;margin:0 auto 28px;background:linear-gradient(135deg,#FEE2E2,#FECACA);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:36px;animation:pulse 2s ease-in-out infinite}' +
    '@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}' +
    'h1{font-size:24px;font-weight:700;color:#991B1B;margin-bottom:10px}' +
    'p{font-size:14px;color:#78716C;line-height:1.6;margin-bottom:24px}' +
    '.vr{display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:28px}' +
    '.vb{padding:6px 16px;border-radius:20px;font-size:13px;font-weight:600}' +
    '.vo{background:#FEE2E2;color:#DC2626;text-decoration:line-through}' +
    '.va{color:#94A3B8;font-size:18px}' +
    '.vn{background:#D1FAE5;color:#059669}' +
    '.blocked{padding:14px 20px;background:#FEF3C7;border:1px solid #FDE68A;border-radius:12px;color:#92400E;font-size:13px;font-weight:500;margin-bottom:28px;display:flex;align-items:center;gap:8px}' +
    '.btn{-webkit-app-region:no-drag;padding:14px 36px;border-radius:12px;background:linear-gradient(135deg,#2563EB,#3B82F6);color:white;border:none;font-size:15px;font-weight:700;font-family:inherit;cursor:pointer;box-shadow:0 4px 14px rgba(59,130,246,0.35);transition:all .2s}' +
    '.btn:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(59,130,246,0.45)}' +
    '.btn:active{transform:translateY(0)}' +
    '.note{margin-top:20px;font-size:12px;color:#94A3B8}' +
    '</style></head><body><div class="c">' +
    '<div class="shield">\u26a0\ufe0f</div>' +
    '<h1>Update Required</h1>' +
    '<p>' + escapeHtml(msg) + '</p>' +
    '<div class="vr"><span class="vb vo">v' + escapeHtml(currentVersion) + '</span><span class="va">\u2192</span><span class="vb vn">v' + escapeHtml(minVersion) + '+</span></div>' +
    '<div class="blocked">\ud83d\udeab App access is blocked until you update to the latest version.</div>' +
    '<button class="btn" onclick="doUpdate()">Update Now</button>' +
    '<p class="note">The update will download and install automatically.</p>' +
    '</div>' +
    '<script>' +
    'function doUpdate(){' +
    'console.log("TALIO_START_UPDATE");' +
    'document.querySelector(".btn").textContent="Checking for updates...";' +
    'document.querySelector(".btn").disabled=true;' +
    '}' +
    '</script></body></html>';

  mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  mainWindow.show();
  mainWindow.focus();
}

/**
 * Escape HTML to prevent injection
 */
function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Parse CSS rgb/rgba color string into { r, g, b }
 */
function parseRGBColor(str) {
  if (!str) return null;
  // Handle hex
  var hexMatch = String(str).match(/^#([0-9a-f]{6})$/i);
  if (hexMatch) {
    return {
      r: parseInt(hexMatch[1].substr(0, 2), 16),
      g: parseInt(hexMatch[1].substr(2, 2), 16),
      b: parseInt(hexMatch[1].substr(4, 2), 16)
    };
  }
  // Handle rgb(r, g, b) / rgba(r, g, b, a)
  var rgbMatch = String(str).match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    return { r: parseInt(rgbMatch[1]), g: parseInt(rgbMatch[2]), b: parseInt(rgbMatch[3]) };
  }
  return null;
}

/**
 * Convert r, g, b values to hex color string
 */
function rgbToHex(r, g, b) {
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

/**
 * Get app icon based on platform
 */
function getAppIcon() {
  var iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  var iconPath = path.join(__dirname, '..', 'build', iconName);
  try {
    return nativeImage.createFromPath(iconPath);
  } catch (e) {
    return null;
  }
}

/**
 * Get tray icon (smaller, template for macOS)
 */
function getTrayIcon() {
  if (process.platform === 'darwin') {
    // Use template icon for macOS menu bar (automatically handles dark/light mode)
    var trayIconPath = path.join(__dirname, '..', 'build', 'trayIconTemplate.png');
    try {
      var icon = nativeImage.createFromPath(trayIconPath);
      icon.setTemplateImage(true);
      return icon;
    } catch (e) {
      return getAppIcon();
    }
  } else if (process.platform === 'linux') {
    // Linux uses regular PNG icon (tray/appindicator)
    var linuxIconPath = path.join(__dirname, '..', 'build', 'icon.png');
    try {
      var icon = nativeImage.createFromPath(linuxIconPath);
      return icon.resize({ width: 22, height: 22 });
    } catch (e) {
      return getAppIcon();
    }
  } else {
    // Windows uses regular icon
    return getAppIcon();
  }
}

/**
 * Initialize auto-launch (always enabled for company devices)
 */
async function initAutoLaunch() {
  try {
    var isEnabled = await autoLauncher.isEnabled();

    if (!isEnabled) {
      await autoLauncher.enable();
      store.set('autoLaunch', true);
      logger.log('info', 'Main', 'Auto-launch enabled (company device policy)');
    }
  } catch (error) {
    logger.log('error', 'Main', 'Auto-launch init failed: ' + error.message);
  }
}

/**
 * Setup session permissions for screen sharing and media access
 */
function setupSessionPermissions() {
  // Handle permission requests from the renderer
  session.defaultSession.setPermissionRequestHandler(function (webContents, permission, callback, details) {
    const allowedPermissions = [
      'media',
      'mediaKeySystem',
      'geolocation',
      'notifications',
      'fullscreen',
      'pointerLock',
      'display-capture',  // Screen sharing
      'window-management'
    ];

    // For media permissions, check the specific type
    if (permission === 'media') {
      const mediaTypes = details.mediaTypes || [];
      logger.log('info', 'Main', 'Media permission requested: ' + mediaTypes.join(', '));

      // Allow audio and video
      if (mediaTypes.includes('audio') || mediaTypes.includes('video')) {
        callback(true);
        return;
      }
    }

    // Allow display-capture for screen sharing
    if (permission === 'display-capture') {
      logger.log('info', 'Main', 'Display capture permission requested');
      callback(true);
      return;
    }

    if (allowedPermissions.includes(permission)) {
      logger.log('info', 'Main', 'Permission granted: ' + permission);
      callback(true);
    } else {
      logger.log('warn', 'Main', 'Permission denied: ' + permission);
      callback(false);
    }
  });

  // Handle permission check requests
  session.defaultSession.setPermissionCheckHandler(function (webContents, permission, requestingOrigin, details) {
    // Allow all permission checks from our app
    if (requestingOrigin.startsWith('https://app.talio.in') || requestingOrigin.startsWith('file://')) {
      return true;
    }

    // Allow media and display-capture
    if (permission === 'media' || permission === 'display-capture') {
      return true;
    }

    return false;
  });

  // Handle desktop capturer permission for screen sharing
  // IMPROVED: Better handling for Windows multi-display and proper source selection
  session.defaultSession.setDisplayMediaRequestHandler(async function (request, callback) {
    logger.log('info', 'Main', 'Display media request from: ' + request.frame.url);

    try {
      // Get all available sources
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 }
      });

      if (sources.length === 0) {
        logger.log('warn', 'Main', 'No display sources available');
        callback({});
        return;
      }

      // On Windows, we need special handling because getDisplayMedia doesn't work properly
      if (process.platform === 'win32') {
        // Get all screens first
        const screens = sources.filter(function (s) { return s.id.startsWith('screen:'); });
        const displays = screen.getAllDisplays();

        if (screens.length > 1) {
          // Multiple displays - show picker dialog
          logger.log('info', 'Main', 'Multiple displays detected: ' + screens.length);

          // Build options for dialog
          const displayOptions = screens.map(function (s, index) {
            const displayInfo = displays[index];
            const label = displayInfo ?
              (displayInfo.id === screen.getPrimaryDisplay().id ? 'Primary Display' : 'Display ' + (index + 1)) +
              ' (' + displayInfo.bounds.width + 'x' + displayInfo.bounds.height + ')' :
              s.name;
            return label;
          });

          // Show display picker dialog
          const result = await dialog.showMessageBox(mainWindow, {
            type: 'question',
            title: 'Select Display to Share',
            message: 'Which display would you like to share?',
            buttons: [...displayOptions, 'Cancel'],
            defaultId: 0,
            cancelId: displayOptions.length
          });

          if (result.response < screens.length) {
            const selectedSource = screens[result.response];
            logger.log('info', 'Main', 'Selected screen: ' + selectedSource.name);
            callback({ video: selectedSource, audio: 'loopback' });
          } else {
            logger.log('info', 'Main', 'Screen share cancelled by user');
            callback({});
          }
          return;
        } else if (screens.length === 1) {
          // Single display - use it directly
          logger.log('info', 'Main', 'Single display, using: ' + screens[0].name);
          callback({ video: screens[0], audio: 'loopback' });
          return;
        }
      }

      // For macOS or fallback: Return the first screen source
      // macOS will show its own system picker
      const screenSources = sources.filter(function (s) { return s.id.startsWith('screen:'); });
      if (screenSources.length > 0) {
        callback({ video: screenSources[0], audio: 'loopback' });
      } else {
        callback({ video: sources[0], audio: 'loopback' });
      }
    } catch (error) {
      logger.log('error', 'Main', 'Failed to get display sources: ' + error.message);
      callback({});
    }
  });

  logger.log('info', 'Main', 'Session permissions configured');
}

/**
 * Schedule a reload with debouncing to prevent multiple rapid reloads
 */
let pendingReloadTimeout = null;
let lastReloadAttempt = 0;
const MIN_RELOAD_INTERVAL = 3000; // Minimum 3 seconds between reload attempts

function scheduleReload(delayMs) {
  const now = Date.now();

  // Debounce - don't reload too frequently
  if (now - lastReloadAttempt < MIN_RELOAD_INTERVAL) {
    logger.log('info', 'Main', 'Skipping reload - too soon since last attempt');
    return;
  }

  // Clear any pending reload
  if (pendingReloadTimeout) {
    clearTimeout(pendingReloadTimeout);
  }

  pendingReloadTimeout = setTimeout(function () {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    lastReloadAttempt = Date.now();
    logger.log('info', 'Main', 'Executing scheduled reload');
    loadRetries = 0;
    loadApp();
  }, delayMs || 1000);
}

/**
 * Check if the page is showing a whitescreen (blank page)
 */
async function checkForWhitescreen() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;

  try {
    const result = await mainWindow.webContents.executeJavaScript(`
      (function() {
        // Check if body has any visible content
        var body = document.body;
        if (!body) return { isBlank: true, reason: 'no-body' };
        
        // Check if the page has meaningful content
        var text = body.innerText || '';
        var hasText = text.trim().length > 10;
        
        // Check for React root
        var root = document.getElementById('__next') || document.getElementById('root');
        var hasRoot = !!root;
        var rootHasContent = hasRoot && root.innerHTML.trim().length > 50;
        
        // Check background color (whitescreen often has default white)
        var bgColor = window.getComputedStyle(body).backgroundColor;
        var isDefaultBg = bgColor === 'rgb(255, 255, 255)' || bgColor === 'rgba(0, 0, 0, 0)';
        
        // Check if page appears to be loading
        var isLoading = document.querySelector('.loader, .loading, [class*="spinner"]') !== null;
        
        // Determine if whitescreen
        var isBlank = !hasText && !rootHasContent && isDefaultBg && !isLoading;
        
        return {
          isBlank: isBlank,
          hasText: hasText,
          hasRoot: hasRoot,
          rootHasContent: rootHasContent,
          isLoading: isLoading
        };
      })()
    `);

    return result.isBlank;
  } catch (e) {
    // If we can't execute JS, page might be broken
    logger.log('warn', 'Main', 'Could not check for whitescreen: ' + e.message);
    return false;
  }
}

/**
 * Setup network connectivity monitoring
 * Automatically reloads the app when internet connection is restored
 * Also handles system sleep/wake events
 */
let isOnOfflinePage = false;
let networkCheckInterval = null;
let whitescreenCheckInterval = null;
let systemWasAsleep = false;

function setupNetworkMonitoring() {
  // Check network connectivity
  const checkNetworkAndReload = async function () {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const currentUrl = mainWindow.webContents.getURL();
    isOnOfflinePage = currentUrl.includes('offline.html') || currentUrl.startsWith('file://');

    if (isOnOfflinePage) {
      try {
        // Try to reach the app server
        const https = require('https');
        const checkPromise = new Promise(function (resolve) {
          const req = https.request({
            hostname: 'app.talio.in',
            port: 443,
            path: '/api/health',
            method: 'HEAD',
            timeout: 10000
          }, function (res) {
            resolve(res.statusCode < 500);
          });
          req.on('error', function () { resolve(false); });
          req.on('timeout', function () { req.destroy(); resolve(false); });
          req.end();
        });

        const isOnline = await checkPromise;

        if (isOnline && isOnOfflinePage) {
          logger.log('info', 'Main', 'Network restored, reloading app...');
          loadRetries = 0;
          loadApp();
        }
      } catch (e) {
        // Network still down
      }
    }
  };

  // Check for whitescreen and recover
  const checkAndRecoverWhitescreen = async function () {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const currentUrl = mainWindow.webContents.getURL();

    // Only check on app pages, not offline/loader pages
    if (!currentUrl.startsWith('https://app.talio.in')) return;

    const isBlank = await checkForWhitescreen();

    if (isBlank) {
      logger.log('warn', 'Main', 'Whitescreen detected, attempting recovery...');
      scheduleReload(1000);
    }
  };

  // Start periodic network check (every 10 seconds)
  networkCheckInterval = setInterval(checkNetworkAndReload, 10000);

  // Start periodic whitescreen check (every 30 seconds, less aggressive)
  whitescreenCheckInterval = setInterval(checkAndRecoverWhitescreen, 30000);

  // Handle system suspend (sleep)
  powerMonitor.on('suspend', function () {
    logger.log('info', 'Main', 'System going to sleep');
    systemWasAsleep = true;
  });

  // Handle system resume (wake)
  powerMonitor.on('resume', function () {
    logger.log('info', 'Main', 'System waking up from sleep');

    if (systemWasAsleep) {
      systemWasAsleep = false;

      // Wait a bit for network to reconnect, then check and reload if needed
      setTimeout(async function () {
        if (!mainWindow || mainWindow.isDestroyed()) return;

        const currentUrl = mainWindow.webContents.getURL();

        // If on offline page, try to reload
        if (currentUrl.includes('offline.html') || currentUrl.startsWith('file://')) {
          logger.log('info', 'Main', 'On offline page after wake, checking network...');
          checkNetworkAndReload();
          return;
        }

        // Check for whitescreen after resume
        const isBlank = await checkForWhitescreen();
        if (isBlank) {
          logger.log('warn', 'Main', 'Whitescreen detected after system resume, reloading...');
          scheduleReload(500);
          return;
        }

        // Even if not blank, do a soft check by injecting a heartbeat
        try {
          const isAlive = await mainWindow.webContents.executeJavaScript(`
            (function() {
              // Check if the app is responsive
              return typeof window !== 'undefined' && document.readyState === 'complete';
            })()
          `);

          if (!isAlive) {
            logger.log('warn', 'Main', 'Page unresponsive after resume, reloading...');
            scheduleReload(500);
          }
        } catch (e) {
          // Page might be in a bad state
          logger.log('warn', 'Main', 'Could not check page health after resume: ' + e.message);
          scheduleReload(1000);
        }
      }, 3000); // Wait 3 seconds for network to stabilize
    }
  });

  // Handle lock screen (user locked their screen)
  powerMonitor.on('lock-screen', function () {
    logger.log('info', 'Main', 'Screen locked');
  });

  // Handle unlock screen
  powerMonitor.on('unlock-screen', function () {
    logger.log('info', 'Main', 'Screen unlocked');

    // Brief check after unlock - sometimes pages get stuck
    setTimeout(async function () {
      if (!mainWindow || mainWindow.isDestroyed()) return;

      const currentUrl = mainWindow.webContents.getURL();
      if (currentUrl.startsWith('https://app.talio.in')) {
        const isBlank = await checkForWhitescreen();
        if (isBlank) {
          logger.log('warn', 'Main', 'Whitescreen detected after unlock, reloading...');
          scheduleReload(500);
        }
      }
    }, 2000);
  });

  // Handle window focus - check for issues when user returns to app
  if (mainWindow) {
    mainWindow.on('focus', function () {
      const currentUrl = mainWindow.webContents.getURL();

      if (currentUrl.includes('offline.html') || currentUrl.startsWith('file://')) {
        logger.log('info', 'Main', 'Window focused while on offline page, checking network...');
        setTimeout(checkNetworkAndReload, 1000);
      } else if (currentUrl.startsWith('https://app.talio.in')) {
        // Check for whitescreen when window regains focus
        setTimeout(checkAndRecoverWhitescreen, 500);
      }
    });

    // Also handle window show (might be restored from minimized/hidden state)
    mainWindow.on('show', function () {
      setTimeout(async function () {
        if (!mainWindow || mainWindow.isDestroyed()) return;

        const currentUrl = mainWindow.webContents.getURL();
        if (currentUrl.startsWith('https://app.talio.in')) {
          const isBlank = await checkForWhitescreen();
          if (isBlank) {
            logger.log('warn', 'Main', 'Whitescreen detected on window show, reloading...');
            scheduleReload(500);
          }
        }
      }, 1000);
    });
  }

  logger.log('info', 'Main', 'Network and power monitoring setup complete');
}

// App lifecycle events
app.whenReady().then(async function () {
  logger.log('info', 'Main', 'App ready - version ' + app.getVersion());

  // ── Crash-loop detection ──────────────────────────────────────────
  // Track rapid restarts: if the app started 5+ times in the last 60 seconds,
  // skip auto-update and min-version enforcement so the user isn't stuck.
  var startHistory = store.get('startHistory', []);
  var now = Date.now();
  // Keep only starts within the last 60 seconds
  startHistory = startHistory.filter(function (t) { return now - t < 60000; });
  startHistory.push(now);
  store.set('startHistory', startHistory);

  var isCrashLoop = startHistory.length >= 5;
  if (isCrashLoop) {
    logger.log('error', 'Main', 'CRASH LOOP DETECTED - ' + startHistory.length + ' starts in 60s. Entering safe mode: skipping auto-update and min-version enforcement.');
  }

  // Setup session permissions for screen sharing
  setupSessionPermissions();

  createWindow();
  createTray();
  initAutoLaunch();

  // Setup network connectivity monitoring
  setupNetworkMonitoring();

  // Request permissions on macOS (camera, mic, screen recording)
  await requestPermissions();

  // Setup auto-updater (registers event listeners - safe even in crash loop)
  setupAutoUpdater();

  if (!isCrashLoop) {
    // Detect failed update install loops:
    // If we recently tried to quitAndInstall but we're still on the old version,
    // the install failed (e.g. macOS code signature mismatch). Don't auto-check again.
    var updateAttempt = store.get('updateInstallAttempt');
    var skipAutoUpdate = false;
    if (updateAttempt && updateAttempt.version && updateAttempt.timestamp) {
      var attemptAge = Date.now() - updateAttempt.timestamp;
      if (updateAttempt.version === app.getVersion()) {
        // We're now on the version we tried to install - update succeeded!
        logger.log('info', 'Updater', 'Update to v' + updateAttempt.version + ' succeeded');
        store.delete('updateInstallAttempt');
      } else if (attemptAge < 10 * 60 * 1000) {
        // Tried to install a different version within last 10 minutes but still on old version = failed
        logger.log('warn', 'Updater', 'Previous update to v' + updateAttempt.version + ' failed (still on v' + app.getVersion() + '). Skipping auto-update to prevent loop.');
        skipAutoUpdate = true;
        // Show one-time notification about failed update
        setTimeout(function () {
          if (mainWindow && !mainWindow.isDestroyed()) {
            dialog.showMessageBox(mainWindow, {
              type: 'warning',
              title: 'Update Failed',
              message: 'Auto-update to v' + updateAttempt.version + ' could not be installed.',
              detail: 'This is typically caused by a code signature mismatch. Please download the latest version manually from the releases page.',
              buttons: ['OK']
            }).catch(function () { });
          }
        }, 5000);
      } else {
        // Attempt is old (>10 min), clear it and allow retry
        store.delete('updateInstallAttempt');
      }
    }

    // Check for forced updates (min version)
    var isForced = await checkForceUpdate();
    if (!isForced && !skipAutoUpdate) {
      // Check for updates on fresh launch - SILENT so no dialog blocks startup
      setTimeout(function () { checkForUpdates(true); }, 5000);
    }
  } else {
    // In crash-loop safe mode: notify user
    setTimeout(function () {
      if (mainWindow && !mainWindow.isDestroyed()) {
        dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: 'Safe Mode',
          message: 'Talio started in safe mode',
          detail: 'The app detected multiple rapid restarts. Auto-update and minimum version checks have been temporarily disabled. If the problem persists, please reinstall the app or contact support.',
          buttons: ['OK']
        }).catch(function () { });
      }
    }, 3000);
  }

  // Check for saved auth
  var savedToken = store.get('authToken');
  var savedUser = store.get('userData');
  if (savedToken && savedUser) {
    setTimeout(function () {
      handleAuthentication({ token: savedToken, user: savedUser });
    }, 2000);
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('window-all-closed', function () {
  // If an update is installing, let the app quit cleanly
  if (isUpdating) {
    logger.log('info', 'Main', 'All windows closed during update - allowing quit');
    return;
  }
  // FORCE PERSISTENT: Never quit when windows are closed
  // Instead, recreate the window
  logger.log('warn', 'Main', 'All windows closed - recreating (force persistent mode)');
  scheduleWindowRecreation();
});

app.on('before-quit', function (event) {
  // Always allow quit when an update is installing
  if (isUpdating) {
    logger.log('info', 'Main', 'Allowing quit - update is installing');
    isQuitting = true;
    screenshotService.stop();
    socketHandler.disconnect();
    return;
  }

  // Intercept quit attempts - only allow after multiple force-close attempts
  if (forceCloseAttempts < 3) {
    event.preventDefault();
    logger.log('warn', 'Main', 'Quit attempt blocked (force persistent mode)');

    // Show the window again
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      scheduleWindowRecreation();
    }

    showNotification('\u26a0\ufe0f Talio Cannot Be Closed', 'Talio must remain running on company devices. Contact your administrator if you need to stop the application.');
    forceCloseAttempts++;
    return;
  }

  // After 3 attempts, allow quit
  isQuitting = true;
  screenshotService.stop();
  socketHandler.disconnect();
  logger.log('info', 'Main', 'App quitting after ' + forceCloseAttempts + ' force-close attempts');
});

// Handle uncaught exceptions - NEVER let the app crash
process.on('uncaughtException', function (error) {
  logger.log('error', 'Main', 'Uncaught exception: ' + error.message + '\n' + error.stack);
  // Don't exit - try to recover
  if (!mainWindow || mainWindow.isDestroyed()) {
    logger.log('warn', 'Main', 'Recovering from uncaught exception - recreating window');
    scheduleWindowRecreation();
  }
});

process.on('unhandledRejection', function (reason) {
  logger.log('error', 'Main', 'Unhandled rejection: ' + reason);
  // Don't crash - just log
});

// Handle child process crashes (GPU, utility, etc.) — prevents app from dying on GPU crash
app.on('child-process-gone', function (event, details) {
  logger.log('error', 'Main', 'Child process gone: type=' + details.type + ', reason=' + details.reason + ', name=' + (details.name || '') + ', exitCode=' + details.exitCode);
  // If the GPU process crashed, the renderer may follow — don't exit
  if (details.type === 'GPU') {
    logger.log('warn', 'Main', 'GPU process crashed — renderer may recover automatically');
  }
  // Never exit the app because of a child process crash
});
