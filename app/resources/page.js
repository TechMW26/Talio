'use client';

import { useState, useEffect } from 'react';
import { Download, Check } from 'lucide-react';

// ============================================
// RELEASE CONFIGURATION - Update for new releases
// ============================================
const RELEASE_VERSION = '1.1.0';

// Direct download URLs from GitHub Releases (exact file names)
const DOWNLOADS = {
  mac: {
    arm64: {
      url: 'https://github.com/avirajsharma-ops/Talio/releases/download/v1.2.0/Talio-macOS-ARM.dmg',
      label: 'Apple Silicon',
      size: '~91 MB'
    },
    x64: {
      url: 'https://github.com/avirajsharma-ops/Talio/releases/download/v1.2.0/Talio-macOS-Intel.dmg',
      label: 'Intel (x64)',
      size: '~95 MB'
    }
  },
  windows: {
    universal: {
      url: 'https://github.com/avirajsharma-ops/Talio/releases/download/v1.2.0/Talio-Windows.exe',
      label: 'Universal (32 & 64-bit)',
      size: '~160 MB'
    }
  }
};

export default function ResourcesPage() {
  const [selectedOS, setSelectedOS] = useState('mac');
  const [macArch, setMacArch] = useState('arm64')

  useEffect(() => {
    const userAgent = navigator.userAgent.toLowerCase();
    const platform = navigator.platform.toLowerCase();

    // Detect OS
    if (platform.includes('win') || userAgent.includes('win')) {
      setSelectedOS('windows');
    } else {
      setSelectedOS('mac');

      // Detect Mac architecture (Apple Silicon vs Intel)
      // Check for Apple GPU which indicates Apple Silicon
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
        // Default to arm64 for newer Macs
        setMacArch('arm64');
      }
    }
  }, []);

  const currentMacDownload = DOWNLOADS.mac[macArch];
  const altMacArch = macArch === 'arm64' ? 'x64' : 'arm64';
  const altMacDownload = DOWNLOADS.mac[altMacArch];

  const windowsDownload = DOWNLOADS.windows.universal;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col items-center justify-center px-6">
      <div className="flex items-center gap-3 mb-10">
        <svg className="w-10 h-10 text-teal-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2L2 7L12 12L22 7L12 2Z" />
          <path d="M2 17L12 22L22 17" />
          <path d="M2 12L12 17L22 12" />
        </svg>
        <span className="text-2xl font-bold text-white">Talio</span>
      </div>

      <div className="max-w-2xl w-full text-center">
        <span className="text-teal-500 text-xs font-semibold tracking-wider">DESKTOP APPLICATION</span>
        <h1 className="mt-6 text-5xl font-bold bg-gradient-to-b from-white to-gray-500 bg-clip-text text-transparent">
          Download Talio
        </h1>
        <p className="mt-5 text-lg text-gray-400 leading-relaxed">
          Get the native desktop experience for attendance tracking, productivity monitoring, and seamless HR management.
        </p>

        <div className="flex justify-center gap-4 mt-10">
          <button
            onClick={() => setSelectedOS('mac')}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl border transition ${
              selectedOS === 'mac'
                ? 'bg-[#1a1a1a] border-blue-600 text-white'
                : 'bg-[#161616] border-[#262626] text-gray-400 hover:border-[#333]'
            }`}
          >
            <img 
              src="https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/Apple_logo_white.svg/1724px-Apple_logo_white.svg.png" 
              alt="Apple" 
              className="w-5 h-5 object-contain"
            />
            <span>macOS</span>
          </button>
          <button
            onClick={() => setSelectedOS('windows')}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl border transition ${
              selectedOS === 'windows'
                ? 'bg-[#1a1a1a] border-blue-600 text-white'
                : 'bg-[#161616] border-[#262626] text-gray-400 hover:border-[#333]'
            }`}
          >
            <img 
              src="https://upload.wikimedia.org/wikipedia/commons/c/c1/Windows_icon_logo.png" 
              alt="Windows" 
              className="w-5 h-5 object-contain"
            />
            <span>Windows</span>
          </button>
        </div>

        <div className="mt-8 bg-[#161616] border border-[#262626] rounded-2xl p-7 text-left">
          {selectedOS === 'mac' ? (
            <div>
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="font-semibold text-lg">macOS</h3>
                  <p className="text-gray-500 text-sm">Version {RELEASE_VERSION}</p>
                </div>
                <span className="bg-blue-600/15 text-blue-500 px-3 py-1.5 rounded-full text-xs font-medium">
                  {currentMacDownload.label}
                </span>
              </div>
              <a
                href={currentMacDownload.url}
                className="flex items-center justify-center gap-3 w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-xl font-semibold transition"
              >
                <Download className="w-5 h-5" />
                Download for macOS ({currentMacDownload.label})
              </a>
              <p className="text-center text-gray-500 text-sm mt-3">DMG installer • {currentMacDownload.size}</p>
              <div className="mt-4 text-center">
                <span className="text-gray-600 text-xs">Other version: </span>
                <a href={altMacDownload.url} className="text-blue-500 text-xs hover:underline">
                  {altMacDownload.label}
                </a>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="font-semibold text-lg">Windows</h3>
                  <p className="text-gray-500 text-sm">Version {RELEASE_VERSION}</p>
                </div>
                <span className="bg-blue-600/15 text-blue-500 px-3 py-1.5 rounded-full text-xs font-medium">
                  {windowsDownload.label}
                </span>
              </div>
              <a
                href={windowsDownload.url}
                className="flex items-center justify-center gap-3 w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-xl font-semibold transition"
              >
                <Download className="w-5 h-5" />
                Download for Windows
              </a>
              <p className="text-center text-gray-500 text-sm mt-3">
                Universal Installer • {windowsDownload.size} • Works on all Windows
              </p>
            </div>
          )}
        </div>

        <div className="mt-6 bg-[#111] rounded-xl p-6 text-left">
          <h3 className="text-gray-400 text-sm font-semibold mb-4">System Requirements</h3>
          {selectedOS === 'mac' ? (
            <ul className="space-y-2">
              <li className="flex items-center gap-2 text-gray-500 text-sm">
                <Check className="w-4 h-4 text-teal-500" />
                macOS 10.15 or later
              </li>
              <li className="flex items-center gap-2 text-gray-500 text-sm">
                <Check className="w-4 h-4 text-teal-500" />
                Apple Silicon or Intel processor
              </li>
              <li className="flex items-center gap-2 text-gray-500 text-sm">
                <Check className="w-4 h-4 text-teal-500" />
                200 MB disk space
              </li>
            </ul>
          ) : (
            <ul className="space-y-2">
              <li className="flex items-center gap-2 text-gray-500 text-sm">
                <Check className="w-4 h-4 text-teal-500" />
                Windows 10 or 11
              </li>
              <li className="flex items-center gap-2 text-gray-500 text-sm">
                <Check className="w-4 h-4 text-teal-500" />
                64-bit or 32-bit processor
              </li>
              <li className="flex items-center gap-2 text-gray-500 text-sm">
                <Check className="w-4 h-4 text-teal-500" />
                200 MB disk space
              </li>
            </ul>
          )}
        </div>

        <p className="text-gray-600 text-xs mt-10">© 2025 Talio</p>
      </div>
    </div>
  );
}

