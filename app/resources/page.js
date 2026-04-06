'use client';

import { useState, useEffect } from 'react';
import { Download, Check, Info } from 'lucide-react';

// ============================================
// RELEASE CONFIGURATION - Update for new releases
// ============================================
const RELEASE_VERSION = '3.1.0';

// GitHub Release Download URLs
const DOWNLOADS = {
  mac: {
    arm64: {
      url: 'https://github.com/avirajsharma-ops/Talio/releases/download/v3.1.0/Talio-3.1.0-arm64.dmg',
      label: 'Apple Silicon (M1/M2/M3/M4)',
      size: '~83 MB'
    },
    x64: {
      url: 'https://github.com/avirajsharma-ops/Talio/releases/download/v3.1.0/Talio-3.1.0.dmg',
      label: 'Intel (x64)',
      size: '~87 MB'
    }
  },
  windows: {
    x64: {
      url: 'https://github.com/avirajsharma-ops/Talio/releases/download/v3.1.0/Talio.Setup.3.1.0.exe',
      label: 'Windows 10/11 (64-bit)',
      size: '~147 MB'
    }
  }
};

// Platform Icons
const AppleIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
    <path d="M18.71 19.5C17.88 20.74 17 21.95 15.66 21.97C14.32 22 13.89 21.18 12.37 21.18C10.84 21.18 10.37 21.95 9.1 22C7.79 22.05 6.8 20.68 5.96 19.47C4.25 17 2.94 12.45 4.7 9.39C5.57 7.87 7.13 6.91 8.82 6.88C10.1 6.86 11.32 7.75 12.11 7.75C12.89 7.75 14.37 6.68 15.92 6.84C16.57 6.87 18.39 7.1 19.56 8.82C19.47 8.88 17.39 10.1 17.41 12.63C17.44 15.65 20.06 16.66 20.09 16.67C20.06 16.74 19.67 18.11 18.71 19.5ZM13 3.5C13.73 2.67 14.94 2.04 15.94 2C16.07 3.17 15.6 4.35 14.9 5.19C14.21 6.04 13.07 6.7 11.95 6.61C11.8 5.46 12.36 4.26 13 3.5Z"/>
  </svg>
);

const WindowsIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
    <path d="M3 12V6.75L9 5.43V11.91L3 12ZM20 3V11.75L10 11.9V5.21L20 3ZM3 13L9 13.09V19.9L3 18.75V13ZM10 13.25L20 13.5V22L10 20.09V13.25Z"/>
  </svg>
);

export default function ResourcesPage() {
  const [detectedPlatform, setDetectedPlatform] = useState('mac');
  const [macArch, setMacArch] = useState('arm64');

  useEffect(() => {
    const userAgent = navigator.userAgent.toLowerCase();
    const platform = navigator.platform?.toLowerCase() || '';

    // Detect Windows
    if (platform.includes('win') || userAgent.includes('win')) {
      setDetectedPlatform('windows');
      return;
    }

    // Detect Mac and architecture
    if (platform.includes('mac') || userAgent.includes('mac')) {
      setDetectedPlatform('mac');
      try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl');
        if (gl) {
          const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
          if (debugInfo) {
            const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
            if (renderer && renderer.includes('Apple')) {
              setMacArch('arm64');
            } else {
              setMacArch('x64');
            }
          }
        }
      } catch (e) {
        setMacArch('arm64');
      }
    }
  }, []);

  const getRecommendedDownload = () => {
    if (detectedPlatform === 'windows') {
      return {
        ...DOWNLOADS.windows.x64,
        platform: 'Windows',
        icon: <WindowsIcon />
      };
    }
    return {
      ...DOWNLOADS.mac[macArch],
      platform: 'macOS',
      icon: <AppleIcon />
    };
  };

  const recommended = getRecommendedDownload();

  // Override global body styles to enable scrolling on this page
  useEffect(() => {
    // Store original styles
    const originalHtmlOverflow = document.documentElement.style.overflow;
    const originalBodyOverflow = document.body.style.overflow;
    const originalBodyPosition = document.body.style.position;
    const originalBodyHeight = document.body.style.height;
    const originalHtmlHeight = document.documentElement.style.height;

    // Enable scrolling
    document.documentElement.style.overflow = 'auto';
    document.documentElement.style.height = 'auto';
    document.body.style.overflow = 'auto';
    document.body.style.position = 'relative';
    document.body.style.height = 'auto';

    // Cleanup on unmount
    return () => {
      document.documentElement.style.overflow = originalHtmlOverflow;
      document.documentElement.style.height = originalHtmlHeight;
      document.body.style.overflow = originalBodyOverflow;
      document.body.style.position = originalBodyPosition;
      document.body.style.height = originalBodyHeight;
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#09090b]">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-md border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-center items-center">
          <div className="flex items-center gap-2">
            <img src="/fox-icon.png" alt="Talio" className="w-9 h-9 rounded-lg" />
            <span className="text-xl font-bold text-gray-900">Talio</span>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="pt-28 pb-16 px-6">
        <div className="max-w-3xl mx-auto">
          {/* Header */}
          <div className="text-center mb-10">
            <span className="text-teal-600 text-xs font-semibold tracking-wider uppercase">Download Apps</span>
            <h1 className="mt-3 text-4xl md:text-5xl font-bold text-gray-900">
              Get Talio for Your Device
            </h1>
            <p className="mt-4 text-lg text-gray-600 leading-relaxed max-w-xl mx-auto">
              Native apps for attendance tracking, productivity monitoring, and seamless HR management.
            </p>
          </div>

          {/* Recommended Download */}
          <div className="mb-12">
            <div className="flex items-center justify-center gap-2 mb-4">
              <svg className="w-4 h-4 text-amber-500" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L14.2 8.4L21 9.2L16 14L17.5 21L12 17.5L6.5 21L8 14L3 9.2L9.8 8.4L12 2Z"/>
              </svg>
              <span className="text-sm font-medium text-gray-600">Recommended for your device</span>
            </div>
            <a
              href={recommended.url}
              className={`flex items-center justify-between gap-4 w-full max-w-md mx-auto p-5 rounded-2xl text-white font-semibold transition transform hover:scale-[1.02] hover:shadow-lg ${
                detectedPlatform === 'windows'
                  ? 'bg-blue-600 hover:bg-blue-700'
                  : 'bg-gray-900 hover:bg-gray-800'
              }`}
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-black">
                  {recommended.icon}
                </div>
                <div className="text-left">
                  <div className="text-base font-semibold">Download for {recommended.platform}</div>
                  <div className="text-sm opacity-80">{recommended.label} • v{RELEASE_VERSION} • {recommended.size}</div>
                </div>
              </div>
              <Download className="w-5 h-5" />
            </a>
          </div>

          {/* All Platforms */}
          <div className="mb-10">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide text-center mb-5">All Platforms</h2>
            <div className="grid md:grid-cols-2 gap-4">
              {/* macOS */}
              <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center text-gray-700">
                    <AppleIcon />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">macOS</h3>
                    <p className="text-xs text-gray-500">v{RELEASE_VERSION}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <a 
                    href={DOWNLOADS.mac.arm64.url}
                    className="flex justify-between items-center p-3 bg-gray-50 hover:bg-gray-100 rounded-xl transition text-sm"
                  >
                    <span className="text-gray-700">Apple Silicon (M1/M2/M3/M4)</span>
                    <span className="text-gray-400">{DOWNLOADS.mac.arm64.size}</span>
                  </a>
                  <a 
                    href={DOWNLOADS.mac.x64.url}
                    className="flex justify-between items-center p-3 bg-gray-50 hover:bg-gray-100 rounded-xl transition text-sm"
                  >
                    <span className="text-gray-700">Intel (x64)</span>
                    <span className="text-gray-400">{DOWNLOADS.mac.x64.size}</span>
                  </a>
                </div>
                <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2">
                  <Info className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800">
                    If you see "damaged" error, <a href="https://github.com/avirajsharma-ops/Talio/blob/main/MAC_INSTALLATION_GUIDE.md" target="_blank" className="underline font-medium">follow this guide</a>.
                  </p>
                </div>
              </div>

              {/* Windows */}
              <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600">
                    <WindowsIcon />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Windows</h3>
                    <p className="text-xs text-gray-500">v{RELEASE_VERSION}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <a 
                    href={DOWNLOADS.windows.x64.url}
                    className="flex justify-between items-center p-3 bg-gray-50 hover:bg-gray-100 rounded-xl transition text-sm"
                  >
                    <span className="text-gray-700">Windows 10/11 (64-bit)</span>
                    <span className="text-gray-400">{DOWNLOADS.windows.x64.size}</span>
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* System Requirements */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide text-center mb-6">System Requirements</h2>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-semibold text-gray-900 mb-3">macOS</h4>
                <ul className="space-y-2">
                  <li className="flex items-center gap-2 text-sm text-gray-600">
                    <Check className="w-4 h-4 text-teal-600" />
                    macOS 10.15 (Catalina) or later
                  </li>
                  <li className="flex items-center gap-2 text-sm text-gray-600">
                    <Check className="w-4 h-4 text-teal-600" />
                    Apple Silicon or Intel processor
                  </li>
                  <li className="flex items-center gap-2 text-sm text-gray-600">
                    <Check className="w-4 h-4 text-teal-600" />
                    200 MB disk space
                  </li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold text-gray-900 mb-3">Windows</h4>
                <ul className="space-y-2">
                  <li className="flex items-center gap-2 text-sm text-gray-600">
                    <Check className="w-4 h-4 text-blue-600" />
                    Windows 10 or Windows 11
                  </li>
                  <li className="flex items-center gap-2 text-sm text-gray-600">
                    <Check className="w-4 h-4 text-blue-600" />
                    64-bit processor
                  </li>
                  <li className="flex items-center gap-2 text-sm text-gray-600">
                    <Check className="w-4 h-4 text-blue-600" />
                    200 MB disk space
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 py-8 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-gray-500 text-sm mb-4">© 2025 Talio. All rights reserved.</p>
          <div className="flex justify-center gap-6">
            <a href="#" className="text-gray-400 hover:text-gray-600 text-sm transition">Privacy Policy</a>
            <a href="#" className="text-gray-400 hover:text-gray-600 text-sm transition">Terms of Service</a>
            <a href="mailto:support@talio.in" className="text-gray-400 hover:text-gray-600 text-sm transition">Support</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

