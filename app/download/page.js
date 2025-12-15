'use client'

import { useState, useEffect } from 'react'
import { Download, Smartphone, CheckCircle, AlertCircle } from 'lucide-react'

export default function DownloadPage() {
  const [isAndroid, setIsAndroid] = useState(false)
  const [downloadStarted, setDownloadStarted] = useState(false)

  useEffect(() => {
    // Detect if user is on Android
    const userAgent = navigator.userAgent.toLowerCase()
    setIsAndroid(userAgent.includes('android'))
  }, [])

  const handleDownload = () => {
    setDownloadStarted(true)
    // Download will start automatically via the link
    setTimeout(() => setDownloadStarted(false), 3000)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-8 text-white text-center">
          <Smartphone className="w-16 h-16 mx-auto mb-4" />
          <h1 className="text-3xl font-bold mb-2">Talio</h1>
          <p className="text-blue-100">Download the Android App</p>
        </div>

        {/* Content */}
        <div className="p-8">
          {/* Version Info */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-blue-900 mb-1">Latest Version</h3>
                <p className="text-sm text-blue-700">Version 1.0.1 (Build 2)</p>
                <p className="text-sm text-blue-700">Package: sbs.zenova.twa</p>
                <p className="text-sm text-blue-700">Domain: app.talio.in</p>
              </div>
            </div>
          </div>

          {/* Features */}
          <div className="mb-6">
            <h3 className="font-semibold text-gray-900 mb-3">What's New</h3>
            <ul className="space-y-2">
              <li className="flex items-start gap-2">
                <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                <span className="text-gray-700">Location-based attendance tracking</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                <span className="text-gray-700">Geofence validation for office check-in</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                <span className="text-gray-700">Real-time notifications</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                <span className="text-gray-700">Improved performance and stability</span>
              </li>
            </ul>
          </div>

          {/* Download Button */}
          <a
            href="/downloads/talio-hrms-app.apk"
            download
            onClick={handleDownload}
            className="block w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold py-4 px-6 rounded-lg transition-all duration-200 transform hover:scale-105 shadow-lg text-center"
          >
            <div className="flex items-center justify-center gap-3">
              <Download className="w-6 h-6" />
              <span>Download APK (Latest)</span>
            </div>
          </a>

          {downloadStarted && (
            <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-3 text-center">
              <p className="text-green-700 text-sm">Download started! Check your notifications.</p>
            </div>
          )}

          {/* Android Warning */}
          {!isAndroid && (
            <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="font-semibold text-yellow-900 mb-1">Not on Android?</h4>
                  <p className="text-sm text-yellow-700">
                    This app is only available for Android devices. Please open this page on your Android phone or tablet.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Installation Instructions */}
          <div className="mt-6 border-t pt-6">
            <h3 className="font-semibold text-gray-900 mb-3">Installation Instructions</h3>
            <ol className="space-y-3 text-sm text-gray-700">
              <li className="flex gap-3">
                <span className="font-semibold text-blue-600 flex-shrink-0">1.</span>
                <span>Download the APK file using the button above</span>
              </li>
              <li className="flex gap-3">
                <span className="font-semibold text-blue-600 flex-shrink-0">2.</span>
                <span>Open your device Settings → Security → Enable "Install from Unknown Sources"</span>
              </li>
              <li className="flex gap-3">
                <span className="font-semibold text-blue-600 flex-shrink-0">3.</span>
                <span>Open the downloaded APK file from your notifications or Downloads folder</span>
              </li>
              <li className="flex gap-3">
                <span className="font-semibold text-blue-600 flex-shrink-0">4.</span>
                <span>Tap "Install" and follow the prompts</span>
              </li>
              <li className="flex gap-3">
                <span className="font-semibold text-blue-600 flex-shrink-0">5.</span>
                <span>Grant all required permissions (Location, Notifications)</span>
              </li>
            </ol>
          </div>

          {/* Important Notes */}
          <div className="mt-6 bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
              <div>
                <h4 className="font-semibold text-red-900 mb-1">Important</h4>
                <p className="text-sm text-red-700 mb-2">
                  Location permission is <strong>required</strong> for attendance tracking. 
                  You will not be able to clock in/out without enabling location services.
                </p>
                <p className="text-sm text-red-700">
                  Make sure to allow location access "All the time" for best experience.
                </p>
              </div>
            </div>
          </div>

          {/* Support */}
          <div className="mt-6 text-center text-sm text-gray-600">
            <p>Need help? Contact: <a href="mailto:aviraj.sharma@mushroomworldgroup.com" className="text-blue-600 hover:underline">aviraj.sharma@mushroomworldgroup.com</a></p>
          </div>
        </div>
      </div>
    </div>
  )
}

