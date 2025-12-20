/**
 * Talio Download Page Script
 * Handles dynamic device detection and auto-selection of best download
 * Downloads are served from GitHub Releases
 */

// ============================================
// RELEASE CONFIGURATION - Update for new releases
// ============================================
const RELEASE_VERSION = '3.1.0';

// GitHub Release Download URLs
const DOWNLOADS = {
  mac: {
    arm64: {
      url: 'https://github.com/avirajsharma-ops/Talio/releases/download/v3.1.0/Talio-3.1.0-arm64.dmg',
      filename: 'Talio-3.1.0-arm64.dmg',
      label: 'Apple Silicon (M1/M2/M3/M4)',
      size: '~83 MB'
    },
    x64: {
      url: 'https://github.com/avirajsharma-ops/Talio/releases/download/v3.1.0/Talio-3.1.0.dmg',
      filename: 'Talio-3.1.0.dmg',
      label: 'Intel (x64)',
      size: '~87 MB'
    }
  },
  windows: {
    x64: {
      url: 'https://github.com/avirajsharma-ops/Talio/releases/download/v3.1.0/Talio.Setup.3.1.0.exe',
      filename: 'Talio Setup 3.1.0.exe',
      label: 'Windows 10/11 (64-bit)',
      size: '~147 MB'
    }
  },
  android: {
    apk: {
      url: 'https://github.com/avirajsharma-ops/Talio/releases/download/v3.1.0/talio-hrms.apk',
      filename: 'talio-hrms.apk',
      label: 'Android APK',
      size: '~7 MB'
    }
  },
  ios: {
    // Coming soon
    appStore: null
  }
};

// Platform icons as SVG strings
const ICONS = {
  mac: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5C17.88 20.74 17 21.95 15.66 21.97C14.32 22 13.89 21.18 12.37 21.18C10.84 21.18 10.37 21.95 9.1 22C7.79 22.05 6.8 20.68 5.96 19.47C4.25 17 2.94 12.45 4.7 9.39C5.57 7.87 7.13 6.91 8.82 6.88C10.1 6.86 11.32 7.75 12.11 7.75C12.89 7.75 14.37 6.68 15.92 6.84C16.57 6.87 18.39 7.1 19.56 8.82C19.47 8.88 17.39 10.1 17.41 12.63C17.44 15.65 20.06 16.66 20.09 16.67C20.06 16.74 19.67 18.11 18.71 19.5ZM13 3.5C13.73 2.67 14.94 2.04 15.94 2C16.07 3.17 15.6 4.35 14.9 5.19C14.21 6.04 13.07 6.7 11.95 6.61C11.8 5.46 12.36 4.26 13 3.5Z"/></svg>`,
  windows: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 12V6.75L9 5.43V11.91L3 12ZM20 3V11.75L10 11.9V5.21L20 3ZM3 13L9 13.09V19.9L3 18.75V13ZM10 13.25L20 13.5V22L10 20.09V13.25Z"/></svg>`,
  android: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.6 9.48L19.44 6.3C19.54 6.12 19.48 5.88 19.3 5.78C19.12 5.68 18.88 5.74 18.78 5.92L16.92 9.14C15.42 8.44 13.76 8.06 12 8.06C10.24 8.06 8.58 8.44 7.08 9.14L5.22 5.92C5.12 5.74 4.88 5.68 4.7 5.78C4.52 5.88 4.46 6.12 4.56 6.3L6.4 9.48C3.06 11.38 0.84 14.84 0.5 18.78H23.5C23.16 14.84 20.94 11.38 17.6 9.48ZM7 15.25C6.31 15.25 5.75 14.69 5.75 14C5.75 13.31 6.31 12.75 7 12.75C7.69 12.75 8.25 13.31 8.25 14C8.25 14.69 7.69 15.25 7 15.25ZM17 15.25C16.31 15.25 15.75 14.69 15.75 14C15.75 13.31 16.31 12.75 17 12.75C17.69 12.75 18.25 13.31 18.25 14C18.25 14.69 17.69 15.25 17 15.25Z"/></svg>`,
  ios: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5C17.88 20.74 17 21.95 15.66 21.97C14.32 22 13.89 21.18 12.37 21.18C10.84 21.18 10.37 21.95 9.1 22C7.79 22.05 6.8 20.68 5.96 19.47C4.25 17 2.94 12.45 4.7 9.39C5.57 7.87 7.13 6.91 8.82 6.88C10.1 6.86 11.32 7.75 12.11 7.75C12.89 7.75 14.37 6.68 15.92 6.84C16.57 6.87 18.39 7.1 19.56 8.82C19.47 8.88 17.39 10.1 17.41 12.63C17.44 15.65 20.06 16.66 20.09 16.67C20.06 16.74 19.67 18.11 18.71 19.5ZM13 3.5C13.73 2.67 14.94 2.04 15.94 2C16.07 3.17 15.6 4.35 14.9 5.19C14.21 6.04 13.07 6.7 11.95 6.61C11.8 5.46 12.36 4.26 13 3.5Z"/></svg>`
};

document.addEventListener('DOMContentLoaded', function() {
  // DOM Elements
  const platformBadge = document.getElementById('platformBadge');
  const recommendedBtn = document.getElementById('recommendedBtn');
  const recommendedIcon = document.getElementById('recommendedIcon');
  const recommendedTitle = document.getElementById('recommendedTitle');
  const recommendedSubtitle = document.getElementById('recommendedSubtitle');

  // Platform cards for highlighting
  const macCard = document.getElementById('macCard');
  const windowsCard = document.getElementById('windowsCard');
  const androidCard = document.getElementById('androidCard');
  const iosCard = document.getElementById('iosCard');

  /**
   * Detect the user's device/OS
   * Returns: 'mac', 'windows', 'android', 'ios', or 'unknown'
   */
  function detectDevice() {
    const userAgent = navigator.userAgent.toLowerCase();
    const platform = navigator.platform?.toLowerCase() || '';

    // Check for mobile devices first
    if (/android/i.test(userAgent)) {
      return 'android';
    }
    
    if (/iphone|ipad|ipod/i.test(userAgent)) {
      return 'ios';
    }

    // Check for desktop
    if (platform.includes('mac') || userAgent.includes('mac')) {
      return 'mac';
    }
    
    if (platform.includes('win') || userAgent.includes('win')) {
      return 'windows';
    }

    // Linux defaults to showing all options
    if (platform.includes('linux') && !/android/i.test(userAgent)) {
      return 'windows'; // Show Windows as fallback for Linux
    }

    return 'unknown';
  }

  /**
   * Detect Mac architecture (Apple Silicon vs Intel)
   */
  function detectMacArch() {
    // Check for Apple Silicon using WebGL
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl');
      if (gl) {
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
          // Apple GPU indicates Apple Silicon
          if (renderer && renderer.includes('Apple')) {
            return 'arm64';
          }
        }
      }
    } catch (e) {
      // Fallback
    }

    // Default to arm64 for newer Macs (most common now)
    return 'arm64';
  }

  /**
   * Update the recommended download section based on detected device
   */
  function updateRecommendedDownload(device) {
    let download, title, subtitle, icon, badge;

    switch (device) {
      case 'mac':
        const macArch = detectMacArch();
        download = DOWNLOADS.mac[macArch];
        title = 'Download for macOS';
        subtitle = `${download.label} • v${RELEASE_VERSION} • ${download.size}`;
        icon = ICONS.mac;
        badge = '✦ DESKTOP APPLICATION';
        highlightCard(macCard);
        break;

      case 'windows':
        download = DOWNLOADS.windows.x64;
        title = 'Download for Windows';
        subtitle = `${download.label} • v${RELEASE_VERSION} • ${download.size}`;
        icon = ICONS.windows;
        badge = '✦ DESKTOP APPLICATION';
        highlightCard(windowsCard);
        break;

      case 'android':
        download = DOWNLOADS.android.apk;
        title = 'Download for Android';
        subtitle = `${download.label} • v${RELEASE_VERSION} • ${download.size}`;
        icon = ICONS.android;
        badge = '✦ MOBILE APPLICATION';
        highlightCard(androidCard);
        break;

      case 'ios':
        download = null;
        title = 'iOS App Coming Soon';
        subtitle = 'Expected Q1 2025 • App Store';
        icon = ICONS.ios;
        badge = '✦ MOBILE APPLICATION';
        highlightCard(iosCard);
        break;

      default:
        // Unknown - default to showing Mac download
        download = DOWNLOADS.mac.arm64;
        title = 'Download Talio';
        subtitle = 'Select your platform below';
        icon = ICONS.mac;
        badge = '✦ MULTI-PLATFORM';
    }

    // Update UI
    if (platformBadge) platformBadge.textContent = badge;
    if (recommendedIcon) recommendedIcon.innerHTML = icon;
    if (recommendedTitle) recommendedTitle.textContent = title;
    if (recommendedSubtitle) recommendedSubtitle.textContent = subtitle;

    if (recommendedBtn) {
      if (download) {
        recommendedBtn.href = download.url;
        recommendedBtn.setAttribute('download', download.filename);
        recommendedBtn.classList.remove('disabled');
      } else {
        recommendedBtn.href = '#';
        recommendedBtn.removeAttribute('download');
        recommendedBtn.classList.add('disabled');
        recommendedBtn.addEventListener('click', function(e) {
          e.preventDefault();
          alert('iOS app is coming soon! Please check back in Q1 2025.');
        });
      }
    }
  }

  /**
   * Highlight the recommended platform card
   */
  function highlightCard(card) {
    // Remove highlight from all cards
    [macCard, windowsCard, androidCard, iosCard].forEach(c => {
      if (c) c.classList.remove('highlighted');
    });

    // Add highlight to detected card
    if (card) {
      card.classList.add('highlighted');
    }
  }

  /**
   * Track download clicks for analytics
   */
  function trackDownload(href) {
    console.log('Download initiated:', href);

    // Google Analytics tracking
    if (typeof gtag !== 'undefined') {
      gtag('event', 'download', {
        'event_category': 'App Download',
        'event_label': href
      });
    }

    // Custom analytics
    if (typeof analytics !== 'undefined') {
      analytics.track('App Downloaded', { url: href });
    }
  }

  // Initialize
  const detectedDevice = detectDevice();
  console.log('Detected device:', detectedDevice);

  // Update recommended download
  updateRecommendedDownload(detectedDevice);

  // Add click tracking to all download links
  document.querySelectorAll('.download-btn-large, .platform-link').forEach(function(link) {
    link.addEventListener('click', function() {
      const href = this.getAttribute('href');
      if (href && href !== '#') {
        trackDownload(href);
      }
    });
  });

  // Add smooth scroll for platform cards
  document.querySelectorAll('.platform-card').forEach(function(card) {
    card.addEventListener('click', function(e) {
      // If clicking on a link, don't do anything extra
      if (e.target.tagName === 'A' || e.target.closest('a')) {
        return;
      }

      // Otherwise, find the first download link and click it
      const firstLink = card.querySelector('.platform-link');
      if (firstLink) {
        firstLink.click();
      }
    });
  });
});
