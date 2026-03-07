'use client'

import { useEffect } from 'react'
import { FaExclamationTriangle, FaHome, FaRedo } from 'react-icons/fa'

export default function DashboardError({ error, reset }) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error('Dashboard Error:', error)
  }, [error])

  return (
    <div className="min-h-screen bg-red-50 dark:bg-[#0F172A] flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Error Icon */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-24 h-24 bg-red-100 rounded-full mb-4 animate-pulse">
            <FaExclamationTriangle className="w-12 h-12 text-red-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Dashboard Error
          </h1>
          <p className="text-gray-600">
            We encountered an error loading the dashboard. Please try again.
          </p>
        </div>

        {/* Error Details */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">
            Error Details
          </h2>
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-sm text-red-800 font-mono break-words">
              {error?.message || 'An unknown error occurred'}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3">
          <button
            onClick={() => reset()}
            className="w-full flex items-center justify-center space-x-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-all duration-200 shadow-md hover:shadow-lg"
          >
            <FaRedo className="w-4 h-4" />
            <span>Try Again</span>
          </button>

          <button
            onClick={() => window.location.href = '/login'}
            className="w-full flex items-center justify-center space-x-2 px-6 py-3 bg-white hover:bg-gray-50 text-gray-700 font-medium rounded-lg transition-all duration-200 border border-gray-300 shadow-sm hover:shadow-md"
          >
            <FaHome className="w-4 h-4" />
            <span>Back to Login</span>
          </button>
        </div>

        {/* Help Text */}
        <div className="mt-8 text-center">
          <p className="text-sm text-gray-500">
            If this problem persists, please contact your system administrator
          </p>
        </div>
      </div>
    </div>
  )
}

