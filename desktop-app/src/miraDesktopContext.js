'use strict';

const PLATFORM_NAMES = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };

function createMiraDesktopContext({ platform, arch, os, screen, appVersion, electronVersion, model = 'Server-configured DeepSeek model (exact ID supplied by Talio API)' }) {
  const displays = (screen?.getAllDisplays?.() || []).slice(0, 8).map(display => ({
    width: Math.round(display.bounds?.width || 0),
    height: Math.round(display.bounds?.height || 0),
    scale: Number.isFinite(display.scaleFactor) ? display.scaleFactor : 1,
    primary: display.id === screen?.getPrimaryDisplay?.()?.id,
  }));
  const processors = os?.cpus?.() || [];
  return {
    operatingSystem: PLATFORM_NAMES[platform] || String(platform || 'Unknown'),
    osVersion: String(os?.release?.() || 'unknown').slice(0, 40),
    architecture: String(arch || 'unknown').slice(0, 20),
    processor: String(processors[0]?.model || 'unknown').replace(/\s+/g, ' ').slice(0, 100),
    logicalCores: processors.length || null,
    memoryGiB: Number.isFinite(os?.totalmem?.()) ? Math.round(os.totalmem() / (1024 ** 3)) : null,
    displays,
    talioVersion: String(appVersion || 'unknown').slice(0, 30),
    electronVersion: String(electronVersion || 'unknown').slice(0, 30),
    desktopPlanner: 'Agent S 3, running locally; model requests use the configured DeepSeek API relay',
    inputBackend: platform === 'darwin'
      ? 'Talio native Swift helper, macOS Accessibility and Quartz/CoreGraphics input.'
      : platform === 'win32'
        ? 'Talio bundled local Agent S helper using Windows foreground-window APIs and SendInput.'
        : platform === 'linux'
          ? 'Talio bundled local Agent S helper using X11; Wayland sessions are not supported by this input backend.'
          : 'No supported desktop input backend was detected.',
    visionModel: String(model || 'Server-configured DeepSeek model (exact ID supplied by Talio API)').slice(0, 120),
    keyboardGuidance: platform === 'darwin'
      ? 'Use macOS Command-based shortcuts and native accessibility labels.'
      : 'Use Ctrl-based shortcuts on Windows/Linux; use the system app switcher/search where appropriate.',
    privacy: 'Hostname, serial number, account name, file paths, and installed-app inventory are intentionally excluded.',
  };
}

module.exports = { createMiraDesktopContext };
