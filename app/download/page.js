'use client'

import { useState, useEffect } from 'react'
import { Download, Monitor, Apple, CheckCircle, AlertCircle } from 'lucide-react'

export default function DownloadPage() {
  const [platform, setPlatform] = useState('unknown')
  const [downloadStarted, setDownloadStarted] = useState(false)

  useEffect(() => {
    // Detect user platform
    const userAgent = navigator.userAgent.toLowerCase()
    if (userAgent.includes('mac')) {
      setPlatform('mac')
    } else if (userAgent.includes('win')) {
      setPlatform('windows')
    } else {
      setPlatform('other')
    }
  }, [])

  const handleDownload = () => {
    setDownloadStarted(true)
    setTimeout(() => setDownloadStarted(false), 3000)
  }

  // Dynamic download routes — always redirect to the latest GitHub release
  const downloadLinks = {
    macIntel: '/download/mac-intel',
    macArm: '/download/mac-arm64',
    windows: '/download/windows',
  }

  return (
    <div className="min-h-screen bg-blue-50 dark:bg-[#09090b] flex items-center justify-center p-4">
      <div className="max-w-3xl w-full bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-8 text-white text-center">
          <div className="flex justify-center gap-4 mb-4">
            <Monitor className="w-12 h-12" />
          </div>
          <h1 className="text-3xl font-bold mb-2">Talio</h1>
          <p className="text-blue-100">Download for your platform</p>
        </div>

        {/* Content */}
        <div className="p-8">
          {/* Version Info */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-blue-900 mb-1">Download links always point to the latest release</h3>
                <p className="text-sm text-blue-700">Auto-updates are built in — the app stays current automatically</p>
              </div>
            </div>
          </div>

          {/* Download Options */}
          <div className="mb-6">
            {/* Desktop Apps */}
            <div className="border border-gray-200 rounded-lg p-5">
              <div className="flex items-center gap-2 mb-4">
                <Monitor className="w-6 h-6 text-gray-700" />
                <h3 className="font-semibold text-gray-900">Desktop App</h3>
              </div>
              
              {/* macOS */}
              <div className="mb-4">
                <p className="text-sm text-gray-600 mb-2 flex items-center gap-1">
                  <Apple className="w-4 h-4" /> macOS
                </p>
                <div className="space-y-2">
                  <a
                    href={downloadLinks.macArm}
                    onClick={handleDownload}
                    className="block w-full bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium py-2.5 px-4 rounded-lg transition-all text-center"
                  >
                    <Download className="w-4 h-4 inline mr-2" />
                    Apple Silicon (M1/M2/M3)
                  </a>
                  <a
                    href={downloadLinks.macIntel}
                    onClick={handleDownload}
                    className="block w-full bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium py-2.5 px-4 rounded-lg transition-all text-center"
                  >
                    <Download className="w-4 h-4 inline mr-2" />
                    Intel Mac
                  </a>
                </div>
              </div>

              {/* Windows */}
              <div>
                <p className="text-sm text-gray-600 mb-2 flex items-center gap-1">
                  <Monitor className="w-4 h-4" /> Windows
                </p>
                <a
                  href={downloadLinks.windows}
                  onClick={handleDownload}
                  className="block w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2.5 px-4 rounded-lg transition-all text-center"
                >
                  <Download className="w-4 h-4 inline mr-2" />
                  Windows 10/11
                </a>
              </div>
            </div>
          </div>

          {downloadStarted && (
            <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-3 text-center">
              <p className="text-green-700 text-sm">Download started! Check your downloads folder.</p>
            </div>
          )}

          {/* Features */}
          <div className="mb-6">
            <h3 className="font-semibold text-gray-900 mb-3">Features</h3>
            <ul className="grid md:grid-cols-2 gap-2">
              <li className="flex items-start gap-2">
                <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                <span className="text-gray-700 text-sm">Automatic screenshot capture</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                <span className="text-gray-700 text-sm">Location-based attendance</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                <span className="text-gray-700 text-sm">Real-time notifications</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                <span className="text-gray-700 text-sm">Screen sharing for meetings</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                <span className="text-gray-700 text-sm">System tray integration</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                <span className="text-gray-700 text-sm">Auto-start on boot</span>
              </li>
            </ul>
          </div>

          {/* Installation Instructions */}
          <div className="border-t pt-6">
            <h3 className="font-semibold text-gray-900 mb-3">Installation</h3>
            
            {/* Desktop Instructions */}
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">Desktop (macOS/Windows)</h4>
              <ol className="space-y-1 text-sm text-gray-600 list-decimal list-inside">
                <li>Download the installer for your platform</li>
                <li>Open the downloaded file and follow the installation prompts</li>
                <li>Grant screen recording permission when prompted (macOS)</li>
                <li>Login with your Talio credentials</li>
              </ol>
            </div>
          </div>

          {/* Important Notes */}
          <div className="mt-6 bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <h4 className="font-semibold text-amber-900 mb-1">Important</h4>
                <p className="text-sm text-amber-700">
                  Desktop apps require screen recording permission for productivity monitoring.
                </p>
              </div>
            </div>
          </div>

          {/* GitHub Link */}
          <div className="mt-6 text-center">
            <a 
              href="https://github.com/avirajsharma-ops/Talio/releases" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline"
            >
              View all releases on GitHub →
            </a>
          </div>

          {/* Support */}
          <div className="mt-4 text-center text-sm text-gray-500">
            <p>Need help? Contact: <a href="mailto:info@talio.in" className="text-blue-600 hover:underline">info@talio.in</a></p>
          </div>
        </div>
      </div>
    </div>
  )
}

