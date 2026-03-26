/**
<<<<<<< Updated upstream
 * Talio Desktop App v5.2.0
=======
 * Talio Desktop App v4.6.0
>>>>>>> Stashed changes
 * Main Electron process
 * 
 * Performance optimized for smooth rendering
 * With whitescreen recovery and network change handling
 * Force-persistent mode: app cannot be closed by users, auto-restarts if killed
 */

const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, shell, nativeImage, session, systemPreferences, dialog, screen, powerMonitor, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');
const Store = require('electron-store');
const AutoLaunch = require('auto-launch');
const logger = require('./logger');
const screenshotService = require('./screenshotService');
const socketHandler = require('./socketHandler');

// PERFORMANCE: Optimized GPU and rendering settings
const forceDisableGPU = process.env.TALIO_DISABLE_GPU === '1';

if (forceDisableGPU) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  logger.log('warn', 'Main', 'GPU acceleration disabled via environment flag');
} else {
  // GPU rasterization — offloads tile rasterization from CPU to GPU
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  // Zero-copy GPU rasterization — avoids extra memcpy from GPU tiles
  app.commandLine.appendSwitch('enable-zero-copy');
  // Smooth scrolling via compositor
  app.commandLine.appendSwitch('enable-smooth-scrolling');
  // Use GPU for 2D canvas operations
  app.commandLine.appendSwitch('enable-accelerated-2d-canvas');
  // Compositing on all pages (even ones without explicit compositing triggers)
  app.commandLine.appendSwitch('force-gpu-rasterization');

  if (process.platform === 'win32') {
    // Use D3D11 on Windows for best GPU interop
    app.commandLine.appendSwitch('use-angle', 'd3d11');
  }

  if (process.platform === 'linux') {
    // Use GL on Linux for wider driver compatibility
    app.commandLine.appendSwitch('use-gl', 'desktop');
  }

  // Prevent GPU process crashes from killing the app
  app.commandLine.appendSwitch('disable-gpu-process-crash-limit');
}

// PERFORMANCE: Reduce IPC serialisation overhead
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');
// Disable background timer throttling — keeps intervals accurate when window is hidden
app.commandLine.appendSwitch('disable-background-timer-throttling');
// Disable renderer backgrounding to keep the UI responsive when minimised
app.commandLine.appendSwitch('disable-renderer-backgrounding');

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
const UPDATE_CHECK_INTERVAL = 2 * 60 * 60 * 1000; // Check for updates every 2 hours
const GITHUB_REPO = 'avirajsharma-ops/Talio';
const GITHUB_RELEASES_URL = 'https://github.com/' + GITHUB_REPO + '/releases/download';

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
let updateCheckTimer = null;
<<<<<<< Updated upstream
let isLoadingApp = false; // Prevents concurrent loadApp() calls
let loaderTimer = null; // Timer for the loader → loadApp() delay (can be cancelled)
let isNavigating = false; // Single lock preventing concurrent page navigations
let navigationSafetyTimer = null; // Fallback to unlock navigation after timeout
let isDownloadingUpdate = false; // Prevents concurrent update downloads
let currentUpdateVersion = null; // Version being downloaded
=======
let inAppUpdateMode = false; // When true, don't navigate to update.html — send IPC status instead
>>>>>>> Stashed changes

// Persistent store
const store = new Store({ name: 'app-data' });

/**
 * Get desktop sources directly from main process desktopCapturer.
 * In Electron 35+, desktopCapturer is only available in the main process.
 * Returns dataURL thumbnails for screen sharing UI.
 */
async function getDesktopSources(options) {
  const sources = await desktopCapturer.getSources(options || {
    types: ['window', 'screen'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true
  });
  return sources.map(function(source) {
    return {
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL(),
      appIcon: source.appIcon ? source.appIcon.toDataURL() : null,
      display_id: source.display_id
    };
  });
}

/**
 * Get desktop sources with JPEG buffer data for screenshot service.
 * Calls desktopCapturer.getSources() directly in the main process.
 * Returns base64-encoded JPEG thumbnails for efficient transfer.
 */
async function getDesktopSourcesWithJPEG(options) {
  const sources = await desktopCapturer.getSources(options || {
    types: ['screen'],
    thumbnailSize: { width: 1920, height: 1080 }
  });
  return sources.map(function(source) {
    return {
      id: source.id,
      name: source.name,
      display_id: source.display_id,
      thumbnailJPEG: source.thumbnail.toJPEG(80).toString('base64'),
      isEmpty: source.thumbnail.isEmpty()
    };
  });
}

// Auto-launch configuration
const autoLauncher = new AutoLaunch({
  name: 'Talio',
  isHidden: true
});

// Track screen recording permission state for periodic checks
let screenPermissionGranted = false;
let screenPermissionCheckInterval = null;

/**
 * Check screen recording permission status (macOS only)
 * Returns: 'granted', 'denied', 'restricted', 'not-determined', or 'unsupported'
 */
function checkScreenRecordingPermission() {
  if (process.platform === 'darwin') {
    return systemPreferences.getMediaAccessStatus('screen');
  }
  // Windows/Linux: no system-level screen recording permission
  return 'granted';
}

/**
 * Show the screen recording permission dialog and open System Preferences (macOS)
 */
async function promptScreenRecordingPermission(parentWindow) {
  if (process.platform !== 'darwin') return;

  var win = parentWindow || mainWindow;
  if (!win || win.isDestroyed()) return;

  var result = await dialog.showMessageBox(win, {
    type: 'warning',
    title: 'Screen Recording Permission Required',
    message: 'Talio needs Screen Recording permission to capture work activity and enable AI-powered insights.',
    detail: 'Steps to enable:\n1. Click "Open System Preferences" below\n2. Find "Talio" in the list and check the box\n3. If Talio is already checked, uncheck it, then re-check it\n4. You may need to restart Talio after granting permission',
    buttons: ['Open System Preferences', 'Remind Me Later'],
    defaultId: 0,
    cancelId: 1
  });

  if (result.response === 0) {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  }
}

/**
 * Start periodic screen recording permission checker (macOS only).
 * Checks every 15 seconds until permission is granted, then stops.
 * When permission is newly granted, resets screenshot service error flags.
 */
function startScreenPermissionWatcher() {
  if (process.platform !== 'darwin') return;
  if (screenPermissionCheckInterval) return; // Already watching

  var status = checkScreenRecordingPermission();
  screenPermissionGranted = (status === 'granted');

  if (screenPermissionGranted) {
    logger.log('info', 'Main', 'Screen recording permission already granted — no watcher needed');
    return;
  }

  logger.log('info', 'Main', 'Starting screen permission watcher (currently: ' + status + ')');

  screenPermissionCheckInterval = setInterval(function () {
    var currentStatus = checkScreenRecordingPermission();

    if (currentStatus === 'granted' && !screenPermissionGranted) {
      screenPermissionGranted = true;
      logger.log('info', 'Main', 'Screen recording permission GRANTED — stopping watcher');

      // Reset screenshot service permission error so it can retry captures
      screenshotService.resetPermissionError();

      // Notify user
      showNotification('Permission Granted', 'Screen Recording permission has been enabled. Talio can now capture your work activity.');

      // Stop watching
      clearInterval(screenPermissionCheckInterval);
      screenPermissionCheckInterval = null;
    }
  }, 15000);
}

/**
 * Stop the screen permission watcher
 */
function stopScreenPermissionWatcher() {
  if (screenPermissionCheckInterval) {
    clearInterval(screenPermissionCheckInterval);
    screenPermissionCheckInterval = null;
  }
}

/**
 * Request all required permissions (notifications on all platforms, media on macOS)
 */
async function requestPermissions() {
  logger.log('debug', 'Main', 'Checking permissions...');

  // ── Notification permissions (all platforms) ──
  if (Notification.isSupported()) {
    logger.log('debug', 'Main', 'Notifications supported');
  } else {
    logger.log('warn', 'Main', 'Notifications not supported on this platform');
  }

  // Windows: Set up toast notifications via AppUserModelId
  if (process.platform === 'win32') {
    logger.log('debug', 'Main', 'Windows notification setup - AppUserModelId: in.talio.desktop');
    try {
      var testNotif = new Notification({
        title: 'Talio',
        body: 'Talio is ready to help you stay productive and connected with your team.',
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
    logger.log('debug', 'Main', 'Linux notifications via libnotify');
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
    logger.log('debug', 'Main', 'Checking macOS permissions...');

    // Camera permission
    var cameraStatus = systemPreferences.getMediaAccessStatus('camera');
    if (cameraStatus !== 'granted') {
      logger.log('info', 'Main', 'Requesting camera permission...');
      try {
        var camGranted = await systemPreferences.askForMediaAccess('camera');
        logger.log('info', 'Main', 'Camera permission: ' + (camGranted ? 'granted' : 'denied'));
      } catch (e) {
        logger.log('warn', 'Main', 'Camera permission request failed: ' + e.message);
      }
    }

    // Microphone permission
    var micStatus = systemPreferences.getMediaAccessStatus('microphone');
    if (micStatus !== 'granted') {
      logger.log('info', 'Main', 'Requesting microphone permission...');
      try {
        var micGranted = await systemPreferences.askForMediaAccess('microphone');
        logger.log('info', 'Main', 'Microphone permission: ' + (micGranted ? 'granted' : 'denied'));
      } catch (e) {
        logger.log('warn', 'Main', 'Microphone permission request failed: ' + e.message);
      }
    }

    // Accessibility permission check (needed for some screen capture features)
    var accessibilityTrusted = systemPreferences.isTrustedAccessibilityClient(false);
    if (!accessibilityTrusted) {
      logger.log('info', 'Main', 'Accessibility permission not granted — prompting');
      // Passing true shows the system prompt
      systemPreferences.isTrustedAccessibilityClient(true);
    } else {
      logger.log('debug', 'Main', 'Accessibility permission already granted');
    }

    // Screen recording permission (can only check, not request programmatically)
    var screenStatus = checkScreenRecordingPermission();
    screenPermissionGranted = (screenStatus === 'granted');

    if (!screenPermissionGranted) {
      logger.log('info', 'Main', 'Screen recording permission not granted (status: ' + screenStatus + ')');
      await promptScreenRecordingPermission(mainWindow);
      // Start watching for permission change
      startScreenPermissionWatcher();
    } else {
      logger.log('info', 'Main', 'Screen recording permission already granted');
    }

    // macOS notification permission - trigger via test notification
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
      // PERFORMANCE: Keep timers accurate when window is hidden/minimized
      backgroundThrottling: false,
      // PERFORMANCE: Spellcheck triggers heavy dictionary lookups, disable
      spellcheck: false,
      // PERFORMANCE: WebGL for GPU-accelerated rendering
      webgl: true,
      // PERFORMANCE: V8 compiles JS to bytecode eagerly, eliminating re-parse costs
      v8CacheOptions: 'code',
      // PERFORMANCE: Enable preferred size mode for efficient layout
      enablePreferredSizeMode: true,
      // PERFORMANCE: Smooth font rendering
      defaultFontFamily: { standard: 'system-ui' }
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

  // Log renderer console errors for debugging (skip warnings to reduce overhead)
  mainWindow.webContents.on('console-message', function (event, level, message, line, sourceId) {
    if (level >= 3) { // errors only
      logger.log('error', 'Renderer', message);
    }
  });

  // Handle render process crashes - recreate window to avoid loading into dead renderer
  mainWindow.webContents.on('render-process-gone', function (event, details) {
    const now = Date.now();
    logger.log('error', 'Main', 'Render process gone: ' + details.reason + ' (exitCode: ' + details.exitCode + ')');

    // If an update download was in progress in main process, mark it as failed
    // so it can be retried after window recreation
    var wasDownloading = isDownloadingUpdate;
    if (isDownloadingUpdate) {
      logger.log('warn', 'Main', 'Renderer crashed during update download — will retry after recovery');
      isDownloadingUpdate = false;
    }

    // Cancel any pending load
    clearTimeout(loaderTimer);
    clearTimeout(loadTimeout);
    clearTimeout(navigationSafetyTimer);
    isLoadingApp = false;
    isNavigating = false;

    // Reset crash count if more than 30 seconds since last crash
    if (now - lastCrashTime > 30000) {
      crashCount = 0;
    }
    lastCrashTime = now;
    crashCount++;

    if (crashCount <= MAX_CRASH_RECOVERY) {
      logger.log('warn', 'Main', 'Crash recovery (' + crashCount + '/' + MAX_CRASH_RECOVERY + ') - recreating window');
      // Destroy the broken window and recreate from scratch
      setTimeout(function () {
        try {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.destroy();
          }
        } catch (e) { /* already destroyed */ }
        mainWindow = null;
        createWindow();
        // After window is created, show offline page instead of loading the app
        // (which might crash again immediately)
        setTimeout(function () {
          if (mainWindow && !mainWindow.isDestroyed()) {
            showOfflinePage('crash', null, 'Renderer crashed: ' + details.reason);
          }
        }, 500);
      }, 1000);
    } else {
      logger.log('error', 'Main', 'Max crash recovery attempts reached');
      // Try one last time with a fresh window
      try {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
      } catch (e) { /* ignore */ }
      mainWindow = null;
      createWindow();
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
  // Uses a guard flag to prevent accumulating observers/intervals across navigations
  var themeScript =
    '(function() {\n' +
    '  if (window.__TALIO_TITLEBAR_INJECTED__) return;\n' +
    '  window.__TALIO_TITLEBAR_INJECTED__ = true;\n' +
    '  var _lastColor = "";\n' +
    '  function syncTitleBar() {\n' +
    '    var header = document.querySelector("header");\n' +
    '    var bgColor = "#ffffff";\n' +
    '    if (header) {\n' +
    '      bgColor = getComputedStyle(header).backgroundColor;\n' +
    '    } else {\n' +
    '      bgColor = getComputedStyle(document.body).backgroundColor || "#ffffff";\n' +
    '    }\n' +
    '    if (bgColor !== _lastColor) {\n' +
    '      _lastColor = bgColor;\n' +
    '      if (window.electronAPI && window.electronAPI.setTitleBarColor) {\n' +
    '        window.electronAPI.setTitleBarColor(bgColor);\n' +
    '      }\n' +
    '    }\n' +
    '  }\n' +
    '  var _debounce = null;\n' +
    '  var obs = new MutationObserver(function() {\n' +
    '    clearTimeout(_debounce);\n' +
    '    _debounce = setTimeout(syncTitleBar, 300);\n' +
    '  });\n' +
    '  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });\n' +
    '  setTimeout(syncTitleBar, 800);\n' +
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
    '.loader-container{width:128px;height:140px;position:relative;animation:pulse 2.5s ease-in-out infinite}' +
    'svg{width:100%;height:100%;position:absolute;top:0;left:0;filter:drop-shadow(0 0 15px rgba(125,188,175,0.3));overflow:visible}' +
    '.loader-stroke{stroke:#7DBCAF;stroke-width:8;stroke-linecap:round;stroke-linejoin:round;fill:none;animation:strokeLoop 2.5s ease-in-out infinite}' +
    '.loader-fill{fill:#7DBCAF;opacity:0;animation:fillLoop 2.5s linear infinite}' +
    '@keyframes strokeLoop{0%{stroke-dashoffset:var(--path-length)}40%{stroke-dashoffset:0}60%{stroke-dashoffset:0}100%{stroke-dashoffset:var(--path-length)}}' +
    '@keyframes fillLoop{0%,40%{opacity:0}50%{opacity:1}90%,100%{opacity:0}}' +
    '@keyframes pulse{0%{transform:scale(0.95)}40%,60%{transform:scale(1)}100%{transform:scale(0.95)}}' +
    '.status{color:rgba(0,0,0,0.5);font-size:14px;margin-top:190px;text-align:center;position:absolute;width:100%}' +
    '</style></head><body>' +
    '<div class="loader-container">' +
    '<svg viewBox="-10 -10 405 437" xmlns="http://www.w3.org/2000/svg">' +
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

  // Don't auto-call loadApp() — the startup sequence (app.whenReady) or the
  // caller (welcome-complete IPC) will trigger loadApp() after safety checks.
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
  // If the renderer has crashed, recreate the window first
  if (mainWindow.webContents.isCrashed()) {
    logger.log('warn', 'Main', 'loadApp skipped - renderer is crashed, recreating window');
    isLoadingApp = false;
    scheduleWindowRecreation();
    return;
  }
  if (isLoadingApp || isNavigating) {
    logger.log('info', 'Main', 'loadApp debounced - already ' + (isLoadingApp ? 'loading' : 'navigating'));
    return;
  }
  if (isDownloadingUpdate) {
    logger.log('info', 'Main', 'loadApp skipped — update download in progress');
    return;
  }
  isLoadingApp = true;
  isNavigating = true;
  clearTimeout(navigationSafetyTimer);
  navigationSafetyTimer = setTimeout(function () { isNavigating = false; }, 20000);
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
      clearTimeout(navigationSafetyTimer);
      loadRetries = 0;
      isLoadingApp = false;
      isNavigating = false;
      logger.log('info', 'Main', 'App loaded successfully');
    }).catch(function (error) {
      isLoadingApp = false;
      isNavigating = false;
      clearTimeout(navigationSafetyTimer);
      // Ignore intentionally aborted navigations (e.g. offline page took over)
      if (error.message && error.message.includes('ERR_ABORTED')) {
        logger.log('info', 'Main', 'Load aborted (intentional) — skipping error handler');
        clearTimeout(loadTimeout);
        return;
      }
      logger.log('error', 'Main', 'Load failed: ' + error.message);
      handleLoadError(error);
    });
  } catch (e) {
    isLoadingApp = false;
    isNavigating = false;
    clearTimeout(navigationSafetyTimer);
    logger.log('error', 'Main', 'loadApp exception: ' + e.message);
    showOfflinePage('offline', null, e.message);
  }
}

/**
 * Handle load timeout
 */
function handleLoadTimeout() {
  isLoadingApp = false;
  isNavigating = false;
  clearTimeout(navigationSafetyTimer);
  logger.log('warn', 'Main', 'Load timeout reached');
  showOfflinePage('timeout', null, 'Connection timed out');
}

/**
 * Handle load error
 */
function handleLoadError(error) {
  clearTimeout(loadTimeout);
  clearTimeout(navigationSafetyTimer);
  isLoadingApp = false;
  isNavigating = false;
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
  if (isDownloadingUpdate) {
    logger.log('info', 'Main', 'showOfflinePage skipped — update download in progress');
    return;
  }

  // Stop any in-progress navigation to prevent concurrent loads
  try { mainWindow.webContents.stop(); } catch (e) { /* ignore */ }

  isLoadingApp = false;
  isNavigating = false;
  clearTimeout(navigationSafetyTimer);
  clearTimeout(loadTimeout);
  clearTimeout(loaderTimer);
  clearTimeout(pendingReloadTimeout);

  // If the renderer process is dead, we can't load into it — recreate first
  if (mainWindow.webContents.isCrashed()) {
    logger.log('warn', 'Main', 'showOfflinePage: renderer is crashed, recreating window first');
    try { mainWindow.destroy(); } catch (e) { /* ignore */ }
    mainWindow = null;
    createWindow();
    // After fresh window, try loading offline page
    setTimeout(function () {
      if (mainWindow && !mainWindow.isDestroyed()) {
        var offlinePath = path.join(__dirname, 'offline.html');
        var query = {};
        if (errorType) query.type = errorType;
        if (errorCode) query.code = String(errorCode);
        if (errorDesc) query.desc = encodeURIComponent(errorDesc);
        mainWindow.loadFile(offlinePath, { query: query }).catch(function () { });
      }
    }, 500);
    return;
  }

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
      // If another navigation or loadApp is handling this, skip to avoid double-navigation
      if (isLoadingApp || isNavigating) {
        logger.log('info', 'Main', 'did-fail-load while ' + (isLoadingApp ? 'loadApp' : 'navigation') + ' active — skipping');
        return;
      }
      if (isDownloadingUpdate) {
        logger.log('info', 'Main', 'did-fail-load skipped — update download in progress');
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
        // Network interface changed — treat as offline; auto-retry will reconnect
        errorType = 'offline';
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
      // Skip if loadApp() is already handling this navigation
      if (isLoadingApp || isNavigating) {
        logger.log('info', 'Main', 'did-navigate 500 while loadApp active — letting loadApp handle it');
        return;
      }
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
        // Skip if loadApp() is already handling this navigation
        if (isLoadingApp || isNavigating) {
          logger.log('info', 'Main', 'webRequest 500 while loadApp active — letting loadApp handle it');
          return;
        }
        logger.log('error', 'Main', 'Server error ' + details.statusCode + ' for ' + details.url);
        showOfflinePage('server-error', details.statusCode.toString(), 'Server returned ' + details.statusCode);
      }
    }
  );

  // Inject AudioContext disable as EARLY as possible — at navigation start,
  // before any page scripts execute. dom-ready is too late because React
  // hydration can trigger AudioContext before the patch lands.
  mainWindow.webContents.on('did-start-navigation', function (event, url, isInPlace, isMainFrame) {
    if (isMainFrame && url.startsWith('https://app.talio.in')) {
      injectAudioDisable();
    }
  });

  // Handle DOM ready - page is interactive
  mainWindow.webContents.on('dom-ready', function () {
    logger.log('info', 'Main', 'DOM ready');

    // Re-inject AudioContext disable at dom-ready as a safety net
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
  if (windowRecreateTimer) {
    clearTimeout(windowRecreateTimer);
  }

  windowRecreateTimer = setTimeout(function () {
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

    // Listen for offline event
    window.addEventListener('offline', function () {
      if (window.electronAPI && window.electronAPI.setOnlineStatus) {
        window.electronAPI.setOnlineStatus(false);
      }
    });

    // Listen for online event  
    window.addEventListener('online', function () {
      if (window.electronAPI && window.electronAPI.setOnlineStatus) {
        window.electronAPI.setOnlineStatus(true);
      }
    });

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

  // Permission management
  ipcMain.handle('check-screen-permission', function () {
    return {
      status: checkScreenRecordingPermission(),
      platform: process.platform
    };
  });

  ipcMain.handle('request-screen-permission', async function () {
    if (process.platform === 'darwin') {
      await promptScreenRecordingPermission(mainWindow);
      startScreenPermissionWatcher();
      return { prompted: true, status: checkScreenRecordingPermission() };
    }
    return { prompted: false, status: 'granted', platform: process.platform };
  });

  ipcMain.handle('get-all-permissions', function () {
    var permissions = {
      platform: process.platform,
      screenRecording: checkScreenRecordingPermission(),
      notifications: Notification.isSupported() ? 'granted' : 'unsupported'
    };

    if (process.platform === 'darwin') {
      permissions.camera = systemPreferences.getMediaAccessStatus('camera');
      permissions.microphone = systemPreferences.getMediaAccessStatus('microphone');
      permissions.accessibility = systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied';
    } else {
      permissions.camera = 'granted';
      permissions.microphone = 'granted';
      permissions.accessibility = 'granted';
    }

    return permissions;
  });

  // Screenshot service
  ipcMain.handle('start-capture', function () {
    return screenshotService.start();
  });

  ipcMain.handle('stop-capture', function () {
    screenshotService.stop();
    return { success: true };
  });

  // Attendance clock-in/out gating for screenshot capture
  ipcMain.handle('attendance-clock-in', function () {
    logger.log('info', 'Main', 'IPC: attendance-clock-in received');
    screenshotService.setClockedIn(true);
    return { success: true, capturing: screenshotService.isCapturing };
  });

  ipcMain.handle('attendance-clock-out', function () {
    logger.log('info', 'Main', 'IPC: attendance-clock-out received');
    screenshotService.setClockedIn(false);
    return { success: true, capturing: false };
  });

  ipcMain.handle('get-clock-in-status', function () {
    return { isClockedIn: screenshotService.getClockedIn(), isCapturing: screenshotService.isCapturing };
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

    if (!mainWindow || mainWindow.isDestroyed()) return { success: true };

    var currentUrl = '';
    try { currentUrl = mainWindow.webContents.getURL(); } catch (e) { /* ignore */ }
    var isOnOfflinePage = currentUrl.includes('offline.html') || currentUrl.startsWith('file://');
    var isOnDataUrl = currentUrl.startsWith('data:');

    // If network went offline and we're on the app, show offline page
    if (!online && !isOnOfflinePage && !isOnDataUrl && !isNavigating) {
      logger.log('info', 'Main', 'Network went offline, showing offline page');
      showOfflinePage('offline', null, 'Network connection lost');
    }

    // If network came back online and we're on the offline page, reload the app
    if (online && isOnOfflinePage && !isNavigating && !isLoadingApp) {
      logger.log('info', 'Main', 'Network restored, reloading app');
      loadRetries = 0;
      loadApp();
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
    // After showing loader, start loading the app
    clearTimeout(loaderTimer);
    loaderTimer = setTimeout(loadApp, 1000);
    return { success: true };
  });

  // Load app (for offline page retry)
  ipcMain.handle('load-app', function () {
    logger.log('info', 'Main', 'Load app requested from offline page');
    if (isLoadingApp || isNavigating) {
      logger.log('info', 'Main', 'load-app debounced — already loading/navigating');
      return { success: false, reason: 'debounced' };
    }
    loadRetries = 0;
    loadApp();
    return { success: true };
  });

  // Check connectivity from renderer (avoids CORS issues on file:// pages)
  ipcMain.handle('check-connectivity', async function () {
    try {
      const https = require('https');
      return await new Promise(function (resolve) {
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
    } catch (e) {
      return false;
    }
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

  // Get desktop sources via main process desktopCapturer (for renderer IPC)
  ipcMain.handle('get-desktop-sources', async function (event, options) {
    try {
      return await getDesktopSources(options);
    } catch (error) {
      logger.log('error', 'Main', 'IPC get-desktop-sources failed: ' + error.message);
      return [];
    }
  });

  // Get desktop sources with JPEG data via main process desktopCapturer (for renderer IPC)
  ipcMain.handle('get-desktop-sources-for-capture', async function (event, options) {
    try {
      return await getDesktopSourcesWithJPEG(options);
    } catch (error) {
      logger.log('error', 'Main', 'IPC get-desktop-sources-for-capture failed: ' + error.message);
      return [];
    }
  });

  // Request screen share with source picker (Windows compatibility)
  ipcMain.handle('request-screen-share', async function () {
    try {
      logger.log('info', 'Main', 'Screen share requested');

      // Get all available sources via main process desktopCapturer
      const sources = await getDesktopSources({
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
              thumbnail: source.thumbnail,
              appIcon: source.appIcon || null,
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
            thumbnail: source.thumbnail,
            appIcon: source.appIcon || null,
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

  // ── Update IPC ──────────────────────────────────────────────────────
  var _updateCheckInProgress = false;
  ipcMain.handle('check-for-update', async function (event, options) {
    // Prevent duplicate concurrent calls
    if (_updateCheckInProgress) {
      logger.log('info', 'Updater', 'Update check already in progress — skipping duplicate');
      return { success: false, error: 'Check already in progress' };
    }
    _updateCheckInProgress = true;
    logger.log('info', 'Updater', 'Manual update check requested');
<<<<<<< Updated upstream
    sendUpdateStatus('checking');
    try {
      var response = await fetch(MIN_VERSION_CHECK_URL, {
        headers: { 'x-app-version': app.getVersion() }
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      var data = await response.json();
      var latest = data.latestVersion;
      var current = app.getVersion();
      if (latest && compareVersions(current, latest) < 0) {
        sendUpdateStatus('available', { version: latest, latestVersion: latest });
        return { success: true, updateAvailable: true, latestVersion: latest };
      } else {
        sendUpdateStatus('up-to-date', { version: current, latestVersion: latest || current });
        return { success: true, updateAvailable: false, latestVersion: latest || current };
=======
    var silent = options && options.silent;
    // When called from App Info page (silent), stay in-app — don't navigate to update.html
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
>>>>>>> Stashed changes
      }
    } catch (err) {
      logger.log('warn', 'Updater', 'Version check failed: ' + err.message);
      sendUpdateStatus('error', { message: err.message });
      return { success: false, error: err.message };
    } finally {
      _updateCheckInProgress = false;
    }
  });

  // Start the in-app download and install process
  ipcMain.handle('start-update', async function (event, version) {
    logger.log('info', 'Updater', 'In-app update requested for v' + version);
    if (!version) {
      return { success: false, error: 'No version specified' };
    }
    showUpdateScreenAndDownload(version, false);
    return { success: true };
  });

  // Retry a failed update download
  ipcMain.handle('retry-update', async function () {
    logger.log('info', 'Updater', 'Retry update requested for v' + currentUpdateVersion);
    if (!currentUpdateVersion) {
      return { success: false, error: 'No update version to retry' };
    }
    isDownloadingUpdate = false;
    // Re-show the update screen and start download
    showUpdateScreenAndDownload(currentUpdateVersion, false);
    return { success: true };
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
    getDesktopSources: getDesktopSourcesWithJPEG,
    checkPermission: checkScreenRecordingPermission,
    onPermissionError: function (message) {
      showNotification('Screen Recording Permission Required', message);
      if (process.platform === 'darwin') {
        // Open System Preferences and start the watcher
        promptScreenRecordingPermission(mainWindow);
        startScreenPermissionWatcher();
      } else if (process.platform === 'win32') {
        // On Windows, show guidance dialog for capture failures
        dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: 'Screen Capture Issue',
          message: 'Talio is unable to capture your screen.',
          detail: 'This can happen if:\n• An antivirus or security software is blocking screen capture\n• You are using Remote Desktop — try allowing clipboard/display capture in RDP settings\n• Try running Talio as Administrator (right-click → Run as administrator)\n\nIf the issue persists, please contact your IT administrator.',
          buttons: ['OK'],
          defaultId: 0
        });
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

  // Forward attendance updates to the renderer so the webview refreshes its UI
  socketHandler.on('attendanceUpdate', function (data) {
    logger.log('debug', 'Main', 'Attendance update received, forwarding to renderer');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('attendance-update', data);
    }

    // Gate screenshot capture on clock-in/out status
    if (data && userData && userData.role !== 'admin') {
      var eventType = data.type || data.eventType || '';
      if (eventType === 'check-in' || eventType === 'checkin') {
        logger.log('info', 'Main', 'Attendance check-in detected — starting screenshot capture');
        screenshotService.setClockedIn(true);
      } else if (eventType === 'check-out' || eventType === 'checkout') {
        logger.log('info', 'Main', 'Attendance check-out detected — stopping screenshot capture');
        screenshotService.setClockedIn(false);
      }
    }
  });

  // Dedicated attendance check-in/out socket events for screenshot gating
  socketHandler.on('attendanceCheckIn', function (data) {
    logger.log('info', 'Main', 'Socket: attendance-check-in — starting screenshot capture');
    screenshotService.setClockedIn(true);
  });

  socketHandler.on('attendanceCheckOut', function (data) {
    logger.log('info', 'Main', 'Socket: attendance-check-out — stopping screenshot capture');
    screenshotService.setClockedIn(false);
  });

  socketHandler.on('forceRefresh', function () {
    if (mainWindow && !mainWindow.isDestroyed()) {
      logger.log('info', 'Main', 'Force refresh - soft reload');
      setTimeout(function () {
        try { mainWindow.webContents.reload(); } catch (e) { /* ignore */ }
      }, 1000);
    }
  });

  socketHandler.on('triggerUpdateCheck', function () {
    logger.log('info', 'Main', 'Server requested update check');
    checkForUpdates();
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

  // Start capture only if user is clocked in (non-admin)
  if (userData.role !== 'admin') {
    // Check attendance status via API to determine if user is currently clocked in
    checkAttendanceAndStartCapture(data.token, userData.userId || userData._id);
  } else {
    logger.log('info', 'Main', 'Admin user - screen capture disabled');
  }

  // Update tray menu
  updateTrayMenu();
}

/**
 * Check current attendance status and start capture if clocked in.
 * Called on login/app reopen to determine initial capture state.
 * Retries with increasing delay since attendance data may take time to reflect.
 */
async function checkAttendanceAndStartCapture(token, userId, attempt) {
  attempt = attempt || 1;
  var MAX_ATTEMPTS = 3;
  // Delays: 1st attempt = 2s, 2nd = 8s, 3rd = 20s (gives attendance time to reflect)
  var DELAYS = [2000, 8000, 20000];

  // If a socket event already set clocked-in (e.g., between retries), skip the API check
  if (attempt > 1 && screenshotService.getClockedIn()) {
    logger.log('info', 'Main', 'Already clocked in (set by socket event), skipping retry');
    return;
  }

  try {
    logger.log('info', 'Main', 'Checking attendance status (attempt ' + attempt + '/' + MAX_ATTEMPTS + ')...');
    var today = new Date().toISOString().split('T')[0];
    var response = await require('node-fetch')(APP_URL + '/api/attendance?date=' + today + '&employeeId=' + userId, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      var result = await response.json();
      // The response contains an array of attendance records; check the first one for today
      var records = result.data || result.attendance || [];
      var todayRecord = Array.isArray(records) ? records[0] : records;
      var isClockedIn = !!(todayRecord && todayRecord.checkIn && !todayRecord.checkOut);
      logger.log('info', 'Main', 'Attendance status: clocked in = ' + isClockedIn + ' (attempt ' + attempt + ')');

      if (isClockedIn) {
        screenshotService.setClockedIn(true);
      } else if (attempt < MAX_ATTEMPTS) {
        // Not clocked in yet — retry after delay (state may be propagating)
        logger.log('info', 'Main', 'Not clocked in yet, will retry in ' + (DELAYS[attempt] / 1000) + 's...');
        setTimeout(function () {
          checkAttendanceAndStartCapture(token, userId, attempt + 1);
        }, DELAYS[attempt]);
      } else {
        // All retries exhausted — user is genuinely not clocked in
        logger.log('info', 'Main', 'User not clocked in after ' + MAX_ATTEMPTS + ' checks — screenshots will start on clock-in');
        screenshotService.setClockedIn(false);
      }
    } else if (attempt < MAX_ATTEMPTS) {
      logger.log('warn', 'Main', 'Attendance status check failed (HTTP ' + response.status + '), retrying in ' + (DELAYS[attempt] / 1000) + 's...');
      setTimeout(function () {
        checkAttendanceAndStartCapture(token, userId, attempt + 1);
      }, DELAYS[attempt]);
    } else {
      logger.log('warn', 'Main', 'Attendance status check failed after ' + MAX_ATTEMPTS + ' attempts, defaulting to not clocked in');
      screenshotService.setClockedIn(false);
    }
  } catch (error) {
    if (attempt < MAX_ATTEMPTS) {
      logger.log('warn', 'Main', 'Attendance check error: ' + error.message + ', retrying in ' + (DELAYS[attempt] / 1000) + 's...');
      setTimeout(function () {
        checkAttendanceAndStartCapture(token, userId, attempt + 1);
      }, DELAYS[attempt]);
    } else {
      logger.log('error', 'Main', 'Attendance status check failed after ' + MAX_ATTEMPTS + ' attempts: ' + error.message);
      screenshotService.setClockedIn(false);
    }
  }
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

    menuItems.push({ type: 'separator' });
  }

  menuItems.push(
    { label: 'Talio v' + app.getVersion(), enabled: false }
  );

  var contextMenu = Menu.buildFromTemplate(menuItems);
  tray.setContextMenu(contextMenu);
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
// UPDATE SYSTEM (in-app download & install)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Setup periodic update version checks via the min-version API.
 * When an update is found, sends IPC status + shows a native notification.
 */
function setupAutoUpdater() {
<<<<<<< Updated upstream
  logger.log('info', 'Updater', 'Update checker configured - version: ' + app.getVersion() + ', platform: ' + process.platform + ', arch: ' + process.arch);
=======
  // Configure updater
  autoUpdater.autoDownload = false; // We control download manually
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;

  // Log provider config
  logger.log('info', 'Updater', 'Auto-updater configured for GitHub Releases');

  autoUpdater.on('checking-for-update', function () {
    logger.log('info', 'Updater', 'Checking for updates...');
    sendUpdateStatus('checking');
  });

  autoUpdater.on('update-available', function (info) {
    logger.log('info', 'Updater', 'Update available: v' + info.version);
    // Dismiss the "checking" dialog — update screen will take over
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
    logger.log('info', 'Updater', 'App is up to date: v' + info.version);
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
        }).catch(function () {});
      }
    }
  });

  autoUpdater.on('download-progress', function (progress) {
    sendUpdateStatus('downloading', {
      percent: Math.round(progress.percent),
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
      ).catch(function () {});
    }
    // Update taskbar progress (Windows) / dock progress (macOS)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(progress.percent / 100);
    }
  });

  autoUpdater.on('update-downloaded', function (info) {
    logger.log('info', 'Updater', 'Update downloaded: v' + info.version);
    sendUpdateStatus('downloaded', { version: info.version });

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(-1); // Clear progress bar
      mainWindow.webContents.executeJavaScript(
        'window.postMessage({ type: "update-downloaded" }, "*")'
      ).catch(function () {});
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
        ).catch(function () {});
      }

      // Quit and install after showing completion screen
      setTimeout(function () {
        isQuitting = true;
        forceCloseAttempts = 999; // Bypass force-close protection for update
        autoUpdater.quitAndInstall(false, true); // isSilent=false, isForceRunAfter=true
      }, 2500);
    }, 1500);
  });

  autoUpdater.on('error', function (error) {
    logger.log('error', 'Updater', 'Update error: ' + error.message);
    dismissUpdateCheckDialog();
    sendUpdateStatus('error', { message: error.message });

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(-1);
      mainWindow.webContents.executeJavaScript(
        'window.postMessage(' + JSON.stringify({
          type: 'update-error',
          message: error.message
        }) + ', "*")'
      ).catch(function () {});
    }
  });
>>>>>>> Stashed changes

  // Schedule periodic update checks
  updateCheckTimer = setInterval(function () {
    checkForUpdates();
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
 * Send a postMessage to the update.html page (for progress UI)
 */
function sendUpdatePageMessage(data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.executeJavaScript(
      'window.postMessage(' + JSON.stringify(data) + ', "*");'
    ).catch(function () { /* page may not be ready yet */ });
  }
}

/**
 * Get the platform-appropriate asset filename for the current system.
 */
function getUpdateAssetName(version) {
  if (process.platform === 'darwin') {
    var arch = process.arch === 'x64' ? 'x64' : 'arm64';
    return 'Talio-' + version + '-' + arch + '.zip';
  } else if (process.platform === 'win32') {
    return 'Talio.Setup.' + version + '.exe';
  }
  return null;
}

/**
 * Download a file from a URL with progress tracking.
 * Follows redirects (GitHub release assets redirect to S3).
 * Returns a promise that resolves with the local file path.
 */
function downloadFile(url, destPath, onProgress) {
  return new Promise(function (resolve, reject) {
    var file = fs.createWriteStream(destPath);
    var startTime = Date.now();
    var receivedBytes = 0;

    function doRequest(requestUrl) {
      var urlObj = new URL(requestUrl);
      var options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        headers: { 'User-Agent': 'Talio-Desktop-Updater' }
      };

      https.get(options, function (response) {
        // Follow redirects (301, 302, 303, 307, 308)
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume(); // Consume response to free up memory
          doRequest(response.headers.location);
          return;
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlink(destPath, function () {});
          reject(new Error('Download failed with HTTP ' + response.statusCode));
          return;
        }

        var totalBytes = parseInt(response.headers['content-length'], 10) || 0;

        response.on('data', function (chunk) {
          receivedBytes += chunk.length;
          var elapsed = (Date.now() - startTime) / 1000;
          var bytesPerSecond = elapsed > 0 ? receivedBytes / elapsed : 0;
          var percent = totalBytes > 0 ? (receivedBytes / totalBytes) * 100 : 0;

          if (onProgress) {
            onProgress({
              percent: percent,
              bytesPerSecond: bytesPerSecond,
              transferred: receivedBytes,
              total: totalBytes
            });
          }
        });

        response.pipe(file);

        file.on('finish', function () {
          file.close(function () {
            resolve(destPath);
          });
        });

        response.on('error', function (err) {
          file.close();
          fs.unlink(destPath, function () {});
          reject(err);
        });
      }).on('error', function (err) {
        file.close();
        fs.unlink(destPath, function () {});
        reject(err);
      });
    }

    file.on('error', function (err) {
      fs.unlink(destPath, function () {});
      reject(err);
    });

    doRequest(url);
  });
}

/**
 * Show the update progress screen (update.html) and start downloading.
 */
async function showUpdateScreenAndDownload(latestVersion, isForced) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (isDownloadingUpdate) {
    logger.log('warn', 'Updater', 'Download already in progress, ignoring');
    return;
  }

  isDownloadingUpdate = true;
  currentUpdateVersion = latestVersion;

  // Stop any in-progress navigation and cancel pending timers
  try { mainWindow.webContents.stop(); } catch (e) { /* ignore */ }
  clearTimeout(loaderTimer);
  clearTimeout(loadTimeout);
  clearTimeout(navigationSafetyTimer);
  clearTimeout(pendingReloadTimeout);
  isLoadingApp = false;
  isNavigating = false;

  // Load the update progress page
  var updateHtmlPath = path.join(__dirname, 'update.html');
  logger.log('info', 'Updater', 'Loading update screen for v' + latestVersion);

  try {
    await mainWindow.loadFile(updateHtmlPath);
  } catch (e) {
    logger.log('error', 'Updater', 'Failed to load update.html: ' + e.message);
    isDownloadingUpdate = false;
    return;
  }

  mainWindow.show();
  mainWindow.focus();

  // Brief delay to ensure update.html script has initialized its message listener
  await new Promise(function (resolve) { setTimeout(resolve, 300); });

  // Send version info to the page
  var current = app.getVersion();
  sendUpdatePageMessage({ type: 'update-versions', current: current, latest: latestVersion });

  // Start the download
  await performUpdateDownload(latestVersion);
}

/**
 * Perform the actual download and installation of the update.
 */
async function performUpdateDownload(latestVersion) {
  var assetName = getUpdateAssetName(latestVersion);
  if (!assetName) {
    logger.log('error', 'Updater', 'Unsupported platform for update: ' + process.platform);
    sendUpdatePageMessage({ type: 'update-error', message: 'Unsupported platform: ' + process.platform });
    isDownloadingUpdate = false;
    return;
  }

  var downloadUrl = GITHUB_RELEASES_URL + '/v' + latestVersion + '/' + assetName;
  var tempDir = app.getPath('temp');
  var destPath = path.join(tempDir, assetName);

  logger.log('info', 'Updater', 'Downloading update from: ' + downloadUrl);
  logger.log('info', 'Updater', 'Saving to: ' + destPath);

  try {
    // Clean up any previous partial download
    try { fs.unlinkSync(destPath); } catch (e) { /* file may not exist */ }

    await downloadFile(downloadUrl, destPath, function (progress) {
      sendUpdatePageMessage({
        type: 'update-progress',
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total
      });
    });

    logger.log('info', 'Updater', 'Download complete: ' + destPath);

    // Verify file exists and has content
    sendUpdatePageMessage({ type: 'update-verifying' });
    var stats = fs.statSync(destPath);
    if (stats.size < 1024) {
      throw new Error('Downloaded file is too small (' + stats.size + ' bytes), may be corrupt');
    }
    logger.log('info', 'Updater', 'File verified: ' + stats.size + ' bytes');

    // Signal download complete
    sendUpdatePageMessage({ type: 'update-downloaded' });

    // Brief pause so user sees "Download complete" before install starts
    await new Promise(function (resolve) { setTimeout(resolve, 1500); });

    // Install the update
    sendUpdatePageMessage({ type: 'update-installing' });
    logger.log('info', 'Updater', 'Installing update: ' + destPath);

    if (process.platform === 'darwin') {
      // macOS: Extract ZIP, replace app, and relaunch automatically
      var appPath = app.getPath('exe'); // e.g. /Applications/Talio.app/Contents/MacOS/Talio
      var appBundlePath = path.resolve(appPath, '..', '..', '..'); // /Applications/Talio.app
      var extractDir = path.join(app.getPath('temp'), 'talio-update-extract');

      logger.log('info', 'Updater', 'Current app bundle: ' + appBundlePath);
      logger.log('info', 'Updater', 'Extracting to: ' + extractDir);

      // Clean extract directory
      try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch (e) { /* ok */ }
      fs.mkdirSync(extractDir, { recursive: true });

      // Extract ZIP
      await new Promise(function (resolve, reject) {
        var unzip = spawn('/usr/bin/ditto', ['-xk', destPath, extractDir]);
        unzip.on('close', function (code) {
          if (code === 0) resolve();
          else reject(new Error('ditto extract failed with code ' + code));
        });
        unzip.on('error', reject);
      });

      // Find the .app in the extracted directory
      var extracted = fs.readdirSync(extractDir);
      var newApp = extracted.find(function (f) { return f.endsWith('.app'); });
      if (!newApp) {
        throw new Error('No .app found in extracted ZIP');
      }
      var newAppPath = path.join(extractDir, newApp);
      logger.log('info', 'Updater', 'Extracted app: ' + newAppPath);

      sendUpdatePageMessage({ type: 'update-complete' });

      // Create a shell script that waits for the app to exit, replaces it, and relaunches
      var scriptPath = path.join(app.getPath('temp'), 'talio-update.sh');
      var script = '#!/bin/bash\n' +
        'sleep 2\n' +
        'rm -rf "' + appBundlePath + '"\n' +
        'cp -R "' + newAppPath + '" "' + appBundlePath + '"\n' +
        'open "' + appBundlePath + '"\n' +
        'rm -rf "' + extractDir + '"\n' +
        'rm -f "' + scriptPath + '"\n';

      fs.writeFileSync(scriptPath, script, { mode: 0o755 });
      spawn('/bin/bash', [scriptPath], { detached: true, stdio: 'ignore' }).unref();

      logger.log('info', 'Updater', 'Update script launched, quitting app for replacement...');
      setTimeout(function () {
        isQuitting = true;
        app.quit();
      }, 1000);
    } else if (process.platform === 'win32') {
      // Windows: Launch the installer silently and quit
      spawn(destPath, ['/S'], { detached: true, stdio: 'ignore' }).unref();
      sendUpdatePageMessage({ type: 'update-complete' });
      setTimeout(function () {
        isQuitting = true;
        app.quit();
      }, 2000);
    }
  } catch (error) {
    logger.log('error', 'Updater', 'Update download/install failed: ' + error.message);
    sendUpdatePageMessage({
      type: 'update-error',
      message: error.message || 'Download failed. Please check your connection and try again.'
    });
    isDownloadingUpdate = false;
  }
}

/**
 * Check for updates by querying the min-version API.
 * If outdated, show a notification to the user.
 */
async function checkForUpdates() {
  logger.log('info', 'Updater', 'checkForUpdates called');
  sendUpdateStatus('checking');

  try {
    var response = await fetch(MIN_VERSION_CHECK_URL, {
      headers: { 'x-app-version': app.getVersion() }
    });

    if (!response.ok) throw new Error('HTTP ' + response.status);
    var data = await response.json();
    var latest = data.latestVersion;
    var current = app.getVersion();

    if (latest && compareVersions(current, latest) < 0) {
      logger.log('info', 'Updater', 'Update available: v' + latest + ' (current: v' + current + ')');
      sendUpdateStatus('available', { version: latest, latestVersion: latest });

      // Show native notification
      showNotification(
        '🔄 Update Available',
        'Talio Desktop v' + latest + ' is available. Go to App Info to update.',
        { silent: true }
      );
    } else {
      logger.log('info', 'Updater', 'Up to date (current: v' + current + ', latest: v' + (latest || current) + ')');
      sendUpdateStatus('up-to-date', { version: current, latestVersion: latest || current });
    }
  } catch (error) {
    logger.log('warn', 'Updater', 'Update check failed: ' + error.message);
    sendUpdateStatus('error', { message: error.message });
  }
}

/**
 * Check if the current version is below the minimum required version.
 * If so, block the app and start the in-app update download.
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
    var latestVersion = data.latestVersion;
    var currentVersion = app.getVersion();

    if (!minVersion) {
      logger.log('info', 'Updater', 'No minimum version enforced');
      return false;
    }

    logger.log('info', 'Updater', 'Min version: ' + minVersion + ', Current: ' + currentVersion);

    if (compareVersions(currentVersion, minVersion) < 0) {
      logger.log('warn', 'Updater', 'App version is below minimum! Starting forced update.');
      // Use latestVersion if available, otherwise fall back to minVersion
      var targetVersion = latestVersion || minVersion;
      showUpdateRequiredScreen(currentVersion, targetVersion, data.message);
      return true;
    }

    return false;
  } catch (error) {
    logger.log('warn', 'Updater', 'Force update check failed: ' + error.message);
    return false;
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
 * Show the "Update Required" blocking screen with an "Update Now" button
 * that starts the in-app download.
 */
function showUpdateRequiredScreen(currentVersion, targetVersion, serverMessage) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  // Stop any in-progress navigation and cancel pending timers
  try { mainWindow.webContents.stop(); } catch (e) { /* ignore */ }
  clearTimeout(loaderTimer);
  clearTimeout(loadTimeout);
  clearTimeout(navigationSafetyTimer);
  clearTimeout(pendingReloadTimeout);
  isLoadingApp = false;
  isNavigating = false;

  var msg = serverMessage || 'A critical update is available. You must update to continue using Talio.';

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
    '<div class="vr"><span class="vb vo">v' + escapeHtml(currentVersion) + '</span><span class="va">\u2192</span><span class="vb vn">v' + escapeHtml(targetVersion) + '</span></div>' +
    '<div class="blocked">\ud83d\udeab App access is blocked until you update to the latest version.</div>' +
    '<button class="btn" id="updateBtn" onclick="startUpdate()">Update Now</button>' +
    '<p class="note">The update will download and install automatically.</p>' +
    '</div>' +
    '<script>' +
    'function startUpdate(){' +
    'document.getElementById("updateBtn").disabled=true;' +
    'document.getElementById("updateBtn").textContent="Starting update...";' +
    'if(window.electronAPI&&window.electronAPI.startUpdate){' +
    'window.electronAPI.startUpdate("' + escapeHtml(targetVersion) + '");' +
    '}' +
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
 * Initialize auto-launch (always forced for company devices — re-enables every startup)
 */
async function initAutoLaunch() {
  try {
    var isEnabled = await autoLauncher.isEnabled();

    if (!isEnabled) {
      await autoLauncher.enable();
      logger.log('debug', 'Main', 'Auto-launch enabled (company device policy)');
    }
    store.set('autoLaunch', true);
  } catch (error) {
    logger.log('error', 'Main', 'Auto-launch init failed: ' + error.message);
  }
}

/**
 * Guardian process — a detached watchdog that restarts the app if it's killed.
 * Writes a heartbeat file every 10s; guardian checks it and restarts if stale.
 */
let guardianHeartbeatInterval = null;

function getGuardianPaths() {
  var dataDir = app.getPath('userData');
  return {
    heartbeatFile: path.join(dataDir, 'heartbeat'),
    pidFile: path.join(dataDir, 'pid'),
    guardianPidFile: path.join(dataDir, 'guardian.pid')
  };
}

function startHeartbeat() {
  var paths = getGuardianPaths();
  // Write PID file so guardian can find us after restart
  try { fs.writeFileSync(paths.pidFile, String(process.pid)); } catch (e) { /* ignore */ }
  // Write initial heartbeat
  try { fs.writeFileSync(paths.heartbeatFile, String(Date.now())); } catch (e) { /* ignore */ }
  // Update heartbeat every 10 seconds
  guardianHeartbeatInterval = setInterval(function () {
    try { fs.writeFileSync(paths.heartbeatFile, String(Date.now())); } catch (e) { /* ignore */ }
  }, 10000);
}

function launchGuardian() {
  var paths = getGuardianPaths();
  // Check if guardian is already running
  try {
    var existingPid = parseInt(fs.readFileSync(paths.guardianPidFile, 'utf8').trim(), 10);
    if (!isNaN(existingPid) && existingPid > 0) {
      try {
        process.kill(existingPid, 0); // Check if alive
        logger.log('info', 'Main', 'Guardian already running (PID ' + existingPid + ')');
        return; // Already running
      } catch (e) {
        // Not running, launch new one
      }
    }
  } catch (e) {
    // No pid file, launch new one
  }

  var guardianScript = app.isPackaged
    ? path.join(__dirname, 'guardian.js').replace('app.asar', 'app.asar.unpacked')
    : path.join(__dirname, 'guardian.js');
  var electronExe = process.execPath;
  var appRoot = app.isPackaged
    ? path.join(path.dirname(electronExe), process.platform === 'darwin' ? '../Resources/app.asar' : 'resources/app.asar')
    : path.join(__dirname, '..');

  try {
    var nodePath = process.execPath; // Electron can run Node scripts
    var child = spawn(nodePath, [
      guardianScript,
      paths.heartbeatFile,
      electronExe,
      appRoot,
      String(process.pid)
    ], {
      detached: true,
      stdio: 'ignore',
      env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' })
    });
    child.unref();

    // Save guardian PID
    try { fs.writeFileSync(paths.guardianPidFile, String(child.pid)); } catch (e) { /* ignore */ }
    logger.log('info', 'Main', 'Guardian started with PID ' + child.pid);
  } catch (e) {
    logger.log('error', 'Main', 'Failed to launch guardian: ' + e.message);
  }
}

function stopGuardian() {
  // Stop heartbeat so guardian knows we exited intentionally
  if (guardianHeartbeatInterval) {
    clearInterval(guardianHeartbeatInterval);
    guardianHeartbeatInterval = null;
  }
  // Kill guardian process
  var paths = getGuardianPaths();
  try {
    var guardianPid = parseInt(fs.readFileSync(paths.guardianPidFile, 'utf8').trim(), 10);
    if (!isNaN(guardianPid) && guardianPid > 0) {
      process.kill(guardianPid, 'SIGTERM');
      logger.log('info', 'Main', 'Guardian stopped (PID ' + guardianPid + ')');
    }
  } catch (e) { /* ignore */ }
  // Clean up files
  try { fs.unlinkSync(paths.heartbeatFile); } catch (e) { /* ignore */ }
  try { fs.unlinkSync(paths.pidFile); } catch (e) { /* ignore */ }
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
  // Uses IPC to get sources from renderer (desktopCapturer removed from main in Electron 29+)
  session.defaultSession.setDisplayMediaRequestHandler(async function (request, callback) {
    logger.log('info', 'Main', 'Display media request from: ' + request.frame.url);

    try {
      // Get all available sources via renderer IPC
      const sources = await getDesktopSources({
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

  // PERFORMANCE: Override cache headers for app pages to enable stale-while-revalidate.
  // Next.js sends no-cache on dashboard pages, which forces a full network round-trip
  // before showing anything. By adding stale-while-revalidate, Chromium shows the
  // cached page instantly while revalidating in the background.
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['https://app.talio.in/*'] },
    function (details, callback) {
      var headers = details.responseHeaders;
      if (!headers) { callback({ responseHeaders: headers }); return; }

      // Only modify main frame (HTML page) responses, not subresources or API calls
      if (details.resourceType === 'mainFrame') {
        var url = details.url || '';
        // Don't touch API responses
        if (!url.includes('/api/')) {
          // Replace no-cache with a quick stale-while-revalidate for HTML pages
          headers['Cache-Control'] = ['private, max-age=0, stale-while-revalidate=86400'];
          delete headers['Pragma'];
        }
      }

      callback({ responseHeaders: headers });
    }
  );

  logger.log('info', 'Main', 'Session permissions configured');
}

/**
 * Schedule a reload with debouncing to prevent multiple rapid reloads
 */
let pendingReloadTimeout = null;
let lastReloadAttempt = 0;
const MIN_RELOAD_INTERVAL = 30000; // Minimum 30 seconds between reload attempts

function scheduleReload(delayMs) {
  if (isNavigating || isLoadingApp) {
    logger.log('info', 'Main', 'scheduleReload skipped — navigation in progress');
    return;
  }
  if (isDownloadingUpdate) {
    logger.log('info', 'Main', 'scheduleReload skipped — update download in progress');
    return;
  }

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
    logger.log('info', 'Main', 'Executing scheduled soft reload');
    // Use webContents.reload() to leverage cached resources instead of full navigation
    try {
      mainWindow.webContents.reload();
    } catch (e) {
      logger.log('warn', 'Main', 'Soft reload failed, falling back to loadApp: ' + e.message);
      loadRetries = 0;
      loadApp();
    }
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
 * Clear HTTP cache and service workers if the app version changed.
 * Prevents stale bundles and old data from causing crashes after updates.
 */
async function checkAndClearCacheOnUpdate() {
  try {
    var lastVersion = store.get('lastRunVersion', null);
    var currentVersion = app.getVersion();

    if (lastVersion && lastVersion !== currentVersion) {
      logger.log('info', 'Main', 'Version changed (' + lastVersion + ' \u2192 ' + currentVersion + ') \u2014 clearing cache');
      try {
        await session.defaultSession.clearCache();
      } catch (e) {
        logger.log('warn', 'Main', 'clearCache failed: ' + e.message);
      }
      try {
        await session.defaultSession.clearStorageData({
          storages: ['cachestorage', 'serviceworkers']
        });
      } catch (e) {
        logger.log('warn', 'Main', 'clearStorageData failed: ' + e.message);
      }
      logger.log('info', 'Main', 'Cache cleared after update');
    }

    store.set('lastRunVersion', currentVersion);
  } catch (e) {
    logger.log('warn', 'Main', 'checkAndClearCacheOnUpdate error: ' + e.message);
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
  // Clear any existing intervals to prevent accumulation
  if (networkCheckInterval) { clearInterval(networkCheckInterval); networkCheckInterval = null; }
  if (whitescreenCheckInterval) { clearInterval(whitescreenCheckInterval); whitescreenCheckInterval = null; }

  // Check network connectivity
  const checkNetworkAndReload = async function () {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (isNavigating || isLoadingApp) return; // Another navigation is already handling things

    var currentUrl = '';
    try { currentUrl = mainWindow.webContents.getURL(); } catch (e) { return; }
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
            timeout: 5000
          }, function (res) {
            resolve(res.statusCode < 500);
          });
          req.on('error', function () { resolve(false); });
          req.on('timeout', function () { req.destroy(); resolve(false); });
          req.end();
        });

        const isOnline = await checkPromise;

        // Re-check guards after awaiting — state may have changed
        if (isOnline && isOnOfflinePage && !isNavigating && !isLoadingApp && !isDownloadingUpdate) {
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
    if (isDownloadingUpdate) return; // Don't interfere with update screen

    const currentUrl = mainWindow.webContents.getURL();

    // Only check on app pages, not offline/loader pages
    if (!currentUrl.startsWith('https://app.talio.in')) return;

    const isBlank = await checkForWhitescreen();

    if (isBlank) {
      logger.log('warn', 'Main', 'Whitescreen detected, attempting recovery...');
      scheduleReload(1000);
    }
  };

  // Start periodic network check (every 30 seconds — event-driven online/offline handles fast transitions)
  networkCheckInterval = setInterval(checkNetworkAndReload, 30000);

  // Start periodic whitescreen check (every 5 minutes — only checks app pages)
  whitescreenCheckInterval = setInterval(checkAndRecoverWhitescreen, 300000);

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

      // Wait a bit for network to reconnect
      setTimeout(function () {
        if (!mainWindow || mainWindow.isDestroyed()) return;

        // Restart screenshot service if it died during sleep (only if clocked in)
        if (isAuthenticated && userData && userData.role !== 'admin') {
          if (!screenshotService.isCapturing && screenshotService.getClockedIn()) {
            logger.log('debug', 'Main', 'Restarting screenshot capture after system resume');
            screenshotService.start();
          }
        }

        var currentUrl = '';
        try { currentUrl = mainWindow.webContents.getURL(); } catch (e) { return; }

        // Only reload if on offline page — don't disrupt live app page
        if (currentUrl.includes('offline.html') || currentUrl.startsWith('file://')) {
          logger.log('info', 'Main', 'On offline page after wake, checking network...');
          checkNetworkAndReload();
        }
      }, 3000);
    }
  });

  // Handle lock screen (user locked their screen)
  powerMonitor.on('lock-screen', function () {
    logger.log('debug', 'Main', 'Screen locked');
  });

  // Handle unlock screen
  powerMonitor.on('unlock-screen', function () {
    logger.log('debug', 'Main', 'Screen unlocked');

    // Only restart screenshot service — don't reload the app
    setTimeout(function () {
      if (!mainWindow || mainWindow.isDestroyed()) return;

      if (isAuthenticated && userData && userData.role !== 'admin') {
        if (!screenshotService.isCapturing && screenshotService.getClockedIn()) {
          logger.log('debug', 'Main', 'Restarting screenshot capture after unlock');
          screenshotService.start();
        }
      }
    }, 2000);
  });

  // Handle window focus — only check network if on offline page
  if (mainWindow) {
    mainWindow.on('focus', function () {
      var currentUrl = '';
      try { currentUrl = mainWindow.webContents.getURL(); } catch (e) { return; }

      if (currentUrl.includes('offline.html') || currentUrl.startsWith('file://')) {
        logger.log('info', 'Main', 'Window focused while on offline page, checking network...');
        setTimeout(checkNetworkAndReload, 1000);
      }
    });
  }

  logger.log('debug', 'Main', 'Network and power monitoring setup complete');
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

  // Start guardian watchdog and heartbeat
  startHeartbeat();
  launchGuardian();

  // Setup network connectivity monitoring
  setupNetworkMonitoring();

  // Request permissions on macOS (camera, mic, screen recording)
  await requestPermissions();

  // Setup periodic update version checker
  setupAutoUpdater();

  // Clear old cache/data if the app version changed (prevents stale files after updates)
  await checkAndClearCacheOnUpdate();

  if (!isCrashLoop) {
    // Clean up any legacy updateInstallAttempt data from previous versions
    store.delete('updateInstallAttempt');

    // Check for forced updates (min version)
    var isForced = await checkForceUpdate();
    if (!isForced) {
      // All checks passed — now load the app
      loadApp();
      // Check for updates after app loads
      setTimeout(function () { checkForUpdates(); }, 10000);
    }
  } else {
    // Safe mode — just load the app
    loadApp();
    // In crash-loop safe mode: notify user
    setTimeout(function () {
      if (mainWindow && !mainWindow.isDestroyed()) {
        dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: 'Safe Mode',
          message: 'Talio started in safe mode',
          detail: 'The app detected multiple rapid restarts. Update checks have been temporarily disabled. If the problem persists, please reinstall the app or contact support.',
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
  // FORCE PERSISTENT: Never quit when windows are closed
  // Instead, recreate the window
  logger.log('warn', 'Main', 'All windows closed - recreating (force persistent mode)');
  scheduleWindowRecreation();
});

app.on('before-quit', function (event) {
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

  // After 3 attempts, allow quit — stop guardian so it doesn't restart us
  isQuitting = true;
  stopGuardian();
  screenshotService.stop();
  socketHandler.disconnect();
  // Clean up monitoring intervals
  if (networkCheckInterval) { clearInterval(networkCheckInterval); networkCheckInterval = null; }
  if (whitescreenCheckInterval) { clearInterval(whitescreenCheckInterval); whitescreenCheckInterval = null; }
  stopScreenPermissionWatcher();
  // Flush remaining log buffer to disk
  logger.shutdown();
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
