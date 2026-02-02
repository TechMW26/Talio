/**
 * Talio Desktop App v4.0.0
 * Main Electron process
 */

const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, shell, nativeImage, session, systemPreferences, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store');
const AutoLaunch = require('auto-launch');
const logger = require('./logger');
const screenshotService = require('./screenshotService');
const socketHandler = require('./socketHandler');

// CRITICAL: Disable GPU hardware acceleration to prevent renderer crashes
// This helps with SIGSEGV (exit code 11) issues
app.disableHardwareAcceleration();

// Stability flags for Electron
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-features', 'VizDisplayCompositor');

// Note: The actual fix for the "Checking session" crash loop requires
// deploying the Providers.js fix to production (app.talio.in)
// which disables AudioContext initialization for desktop apps

// Configuration
const APP_URL = 'https://app.talio.in';
const LOADER_TIMEOUT_MS = 30000; // 30 seconds max loading time
const RETRY_DELAY_MS = 5000;
const MAX_LOAD_RETRIES = 3;
const MAX_CRASH_RECOVERY = 3; // Max crash recovery attempts

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

// Persistent store
const store = new Store({ name: 'app-data' });

// Auto-launch configuration
const autoLauncher = new AutoLaunch({
  name: 'Talio',
  isHidden: true
});

/**
 * Request macOS permissions for camera, microphone, and screen recording
 */
async function requestPermissions() {
  if (process.platform !== 'darwin') return;

  logger.log('info', 'Main', 'Checking macOS permissions...');

  // Check and request camera permission
  const cameraStatus = systemPreferences.getMediaAccessStatus('camera');
  if (cameraStatus !== 'granted') {
    logger.log('info', 'Main', 'Requesting camera permission...');
    const granted = await systemPreferences.askForMediaAccess('camera');
    logger.log('info', 'Main', 'Camera permission: ' + (granted ? 'granted' : 'denied'));
  }

  // Check and request microphone permission
  const micStatus = systemPreferences.getMediaAccessStatus('microphone');
  if (micStatus !== 'granted') {
    logger.log('info', 'Main', 'Requesting microphone permission...');
    const granted = await systemPreferences.askForMediaAccess('microphone');
    logger.log('info', 'Main', 'Microphone permission: ' + (granted ? 'granted' : 'denied'));
  }

  // Check screen recording permission (can't request programmatically, but can check and prompt)
  const screenStatus = systemPreferences.getMediaAccessStatus('screen');
  if (screenStatus !== 'granted') {
    logger.log('info', 'Main', 'Screen recording permission not granted, showing dialog...');
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Screen Recording Permission Required',
      message: 'Talio needs screen recording permission for productivity monitoring and screen sharing in meetings.',
      detail: 'Please grant Screen Recording permission in System Preferences → Privacy & Security → Screen Recording, then restart the app.',
      buttons: ['Open System Preferences', 'Later'],
      defaultId: 0,
      cancelId: 1
    });

    if (result.response === 0) {
      // Open System Preferences to Screen Recording
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    }
  } else {
    logger.log('info', 'Main', 'Screen recording permission already granted');
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
      // Enable DevTools for debugging
      devTools: true,
      // Stability options
      backgroundThrottling: false,
      offscreen: false,
      // Disable experimental features that may cause crashes
      experimentalFeatures: false
    },
    icon: getAppIcon(),
    show: false, // Don't show until ready-to-show
    backgroundColor: '#ffffff', // White background for loader
    autoHideMenuBar: true
    // Removed titleBarStyle and titleBarOverlay - causes blank screen issues
  });

  // Show window when ready to prevent white flash
  mainWindow.once('ready-to-show', function () {
    mainWindow.show();
    logger.log('info', 'Main', 'Window ready-to-show triggered');
  });

  // Log renderer console messages for debugging
  mainWindow.webContents.on('console-message', function (event, level, message, line, sourceId) {
    if (level >= 2) { // warnings and errors
      logger.log('warn', 'Renderer', message);
    }
  });

  // Handle render process crashes - with recovery limit to prevent infinite loop
  mainWindow.webContents.on('render-process-gone', function (event, details) {
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
      // Wait a bit before reloading to let things settle
      setTimeout(function () {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL(APP_URL);
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

  // Show loader first, then load app
  showLoader();

  // Setup window events
  setupWindowEvents();

  // Setup IPC handlers
  setupIPCHandlers();

  logger.log('info', 'Main', 'Window created');
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
  loadRetries++;
  logger.log('info', 'Main', 'Loading app (attempt ' + loadRetries + '/' + MAX_LOAD_RETRIES + ')');

  // Set timeout for loading
  clearTimeout(loadTimeout);
  loadTimeout = setTimeout(function () {
    handleLoadTimeout();
  }, LOADER_TIMEOUT_MS);

  mainWindow.loadURL(APP_URL).then(function () {
    clearTimeout(loadTimeout);
    loadRetries = 0;
    logger.log('info', 'Main', 'App loaded successfully');
  }).catch(function (error) {
    logger.log('error', 'Main', 'Load failed: ' + error.message);
    handleLoadError(error);
  });
}

/**
 * Handle load timeout
 */
function handleLoadTimeout() {
  logger.log('warn', 'Main', 'Load timeout reached');
  showOfflinePage('timeout', null, 'Connection timed out');
}

/**
 * Handle load error
 */
function handleLoadError(error) {
  clearTimeout(loadTimeout);
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

  var offlinePath = path.join(__dirname, 'offline.html');
  var params = new URLSearchParams();

  if (errorType) params.append('type', errorType);
  if (errorCode) params.append('code', errorCode);
  if (errorDesc) params.append('desc', encodeURIComponent(errorDesc));

  var offlineUrl = 'file://' + offlinePath + '?' + params.toString();

  logger.log('info', 'Main', 'Showing offline page: type=' + errorType + ', code=' + errorCode);
  mainWindow.loadURL(offlineUrl);
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
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
  });

  mainWindow.on('closed', function () {
    mainWindow = null;
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
        errorType = 'offline';
      } else if (errorCode === -100 || errorCode === -101) { // ERR_CONNECTION_CLOSED, ERR_CONNECTION_RESET
        errorType = 'server-error';
      } else if (errorCode === -3) { // ERR_ABORTED - usually navigation was cancelled
        // Don't show offline page for aborted requests (e.g., navigation change)
        return;
      }

      showOfflinePage(errorType, httpCode, errorDescription);
    }
  });

  // Handle HTTP errors (4xx, 5xx) - intercept responses
  mainWindow.webContents.on('did-navigate', function (event, url, httpResponseCode) {
    if (httpResponseCode >= 400) {
      logger.log('error', 'Main', 'HTTP error ' + httpResponseCode + ' for ' + url);
      showOfflinePage('server-error', httpResponseCode.toString(), 'HTTP ' + httpResponseCode);
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

  // Restart app (for crash recovery)
  ipcMain.handle('restart-app', function () {
    logger.log('info', 'Main', 'Restart requested');
    crashCount = 0;
    app.relaunch();
    app.exit(0);
  });

  // Load app (for offline page retry)
  ipcMain.handle('load-app', function () {
    logger.log('info', 'Main', 'Load app requested from offline page');
    loadRetries = 0;
    loadApp();
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
    mainWindow: mainWindow
  });

  // Initialize socket
  socketHandler.initialize(userData.userId || userData._id, data.token);

  // Setup socket callbacks
  socketHandler.on('screenshotRequest', function () {
    screenshotService.manualCapture();
  });

  socketHandler.on('notification', function (notif) {
    showNotification(notif.title, notif.message || notif.body);
    if (mainWindow) {
      mainWindow.webContents.send('notification', notif);
    }
  });

  socketHandler.on('connect', function () {
    if (mainWindow) {
      mainWindow.webContents.send('socket-status', { connected: true });
    }
  });

  socketHandler.on('disconnect', function () {
    if (mainWindow) {
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
    { label: 'Quit', click: function () { isQuitting = true; app.quit(); } }
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
 * Show desktop notification
 */
function showNotification(title, body) {
  if (Notification.isSupported()) {
    var notification = new Notification({
      title: title || 'Talio',
      body: body || '',
      icon: getAppIcon()
    });
    notification.show();
  }
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
  } else {
    // Windows uses regular icon
    return getAppIcon();
  }
}

/**
 * Initialize auto-launch
 */
async function initAutoLaunch() {
  try {
    var isEnabled = await autoLauncher.isEnabled();
    var shouldEnable = store.get('autoLaunch', true);

    if (shouldEnable && !isEnabled) {
      await autoLauncher.enable();
    } else if (!shouldEnable && isEnabled) {
      await autoLauncher.disable();
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
  session.defaultSession.setDisplayMediaRequestHandler(function (request, callback) {
    logger.log('info', 'Main', 'Display media request from: ' + request.frame.url);

    // For the main app, automatically allow screen sharing
    // The user will still see the OS-level screen picker
    const { desktopCapturer } = require('electron');

    desktopCapturer.getSources({ types: ['screen', 'window'] }).then(function (sources) {
      if (sources.length > 0) {
        // Return the first screen source - user can pick in the web app
        callback({ video: sources[0], audio: 'loopback' });
      } else {
        callback({});
      }
    }).catch(function (error) {
      logger.log('error', 'Main', 'Failed to get display sources: ' + error.message);
      callback({});
    });
  });

  logger.log('info', 'Main', 'Session permissions configured');
}

/**
 * Setup network connectivity monitoring
 * Automatically reloads the app when internet connection is restored
 */
let isOnOfflinePage = false;
let networkCheckInterval = null;

function setupNetworkMonitoring() {
  // Check network connectivity periodically when on offline page
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

  // Start periodic network check (every 10 seconds)
  networkCheckInterval = setInterval(checkNetworkAndReload, 10000);

  // Also check immediately when the window gains focus (user returns to app)
  if (mainWindow) {
    mainWindow.on('focus', function () {
      if (isOnOfflinePage) {
        logger.log('info', 'Main', 'Window focused while on offline page, checking network...');
        setTimeout(checkNetworkAndReload, 1000);
      }
    });
  }

  logger.log('info', 'Main', 'Network monitoring setup complete');
}

// App lifecycle events
app.whenReady().then(async function () {
  logger.log('info', 'Main', 'App ready - version ' + app.getVersion());

  // Setup session permissions for screen sharing
  setupSessionPermissions();

  createWindow();
  createTray();
  initAutoLaunch();

  // Setup network connectivity monitoring
  setupNetworkMonitoring();

  // Request permissions on macOS (camera, mic, screen recording)
  await requestPermissions();

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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', function () {
  isQuitting = true;
  screenshotService.stop();
  socketHandler.disconnect();
  logger.log('info', 'Main', 'App quitting');
});

// Handle uncaught exceptions
process.on('uncaughtException', function (error) {
  logger.log('error', 'Main', 'Uncaught exception: ' + error.message);
});

process.on('unhandledRejection', function (reason) {
  logger.log('error', 'Main', 'Unhandled rejection: ' + reason);
});
