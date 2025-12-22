'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { FaEnvelope, FaLock, FaEye, FaEyeSlash } from 'react-icons/fa'

export default function LoginPage() {
  const router = useRouter()
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  })
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)

  // Check if user is already logged in or if setup is needed
  useEffect(() => {
    const checkSession = async () => {
      console.log('[Login Page] Checking session...')
      
      // First, check if initial setup is needed
      try {
        const setupResponse = await fetch('/api/setup/check')
        const setupData = await setupResponse.json()
        
        if (setupData.success && setupData.needsSetup) {
          console.log('[Login Page] Initial setup needed, redirecting to setup...')
          window.location.href = '/setup'
          return
        }
      } catch (setupError) {
        console.error('[Login Page] Setup check error:', setupError)
        // Continue with normal login flow if setup check fails
      }
      
      const token = localStorage.getItem('token')
      const user = localStorage.getItem('user')

      console.log('[Login Page] Token exists:', !!token)
      console.log('[Login Page] User exists:', !!user)

      if (token && user) {
        // Validate the token before redirecting
        try {
          const response = await fetch('/api/auth/validate', {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          })
          
          if (response.ok) {
            const data = await response.json()
            
            // Check if user needs to change password
            if (data.forcePasswordChange) {
              console.log('[Login Page] User needs to change password, redirecting...')
              window.location.href = '/auth/change-password'
              return
            }
            
            // Token is valid, redirect to dashboard
            console.log('[Login Page] Token valid, redirecting to dashboard...')
            window.location.href = '/dashboard'
            return // Keep showing loading while redirecting
          } else {
            // Token is invalid, clear storage and show login
            console.log('[Login Page] Token invalid, clearing session...')
            localStorage.removeItem('token')
            localStorage.removeItem('user')
            localStorage.removeItem('userId')
            document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
            setChecking(false)
          }
        } catch (error) {
          console.error('[Login Page] Token validation error:', error)
          // Network error - still try to redirect if token exists
          console.log('[Login Page] Redirecting to dashboard despite validation error...')
          window.location.href = '/dashboard'
          return
        }
      } else {
        // Check for error in URL params
        const urlParams = new URLSearchParams(window.location.search)
        const error = urlParams.get('error')

        if (error) {
          const errorMessages = {
            account_deactivated: 'Your account has been deactivated. Please contact your administrator.',
            authentication_failed: 'Authentication failed. Please try again.',
          }
          toast.error(errorMessages[error] || 'An error occurred during login.')
        }

        // No session found, show login page
        console.log('[Login Page] Showing login form...')
        setChecking(false)
      }
    }

    // Add a safety timeout to prevent infinite "Checking session..."
    const safetyTimeout = setTimeout(() => {
      console.log('[Login Page] Safety timeout triggered, showing login form...')
      setChecking(false)
    }, 5000) // 5 second timeout

    checkSession().finally(() => {
      clearTimeout(safetyTimeout)
    })

    return () => clearTimeout(safetyTimeout)
  }, [])

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      })

      const data = await response.json()

      if (response.ok) {
        toast.success('Login successful!')
        // Store in localStorage
        localStorage.setItem('token', data.token)
        localStorage.setItem('user', JSON.stringify(data.user))
        const resolvedUserId = data.user?.id || data.user?._id || data.user?.userId
        if (resolvedUserId) {
          localStorage.setItem('userId', resolvedUserId)
        }

        // Also set cookie for middleware
        document.cookie = `token=${data.token}; path=/; max-age=${7 * 24 * 60 * 60}` // 7 days

        // Notify desktop app if running in Electron
        if (window.talioDesktop || window.electronAPI) {
          console.log('[Login] Notifying desktop app of login...')
          const desktopAPI = window.talioDesktop || window.electronAPI
          try {
            // Set auth for activity tracking
            if (desktopAPI.setAuth) {
              await desktopAPI.setAuth(data.token, data.user)
              console.log('[Login] Desktop app auth set')
            }
            // Request permissions after login
            if (desktopAPI.requestAllPermissions) {
              const permissions = await desktopAPI.requestAllPermissions()
              console.log('[Login] Desktop permissions:', permissions)
            }
          } catch (err) {
            console.error('[Login] Desktop app notification error:', err)
          }
        }

        // Check for pending FCM token from Android app
        if (window.checkPendingFCMToken) {
          console.log('[Login] Checking for pending FCM token...')
          window.checkPendingFCMToken()
        }

        // Check if user needs to change password on first login
        if (data.user?.forcePasswordChange) {
          console.log('[Login] First login detected - redirecting to change password...')
          toast.loading('Please change your password to continue')
          window.location.href = '/auth/change-password'
          return
        }

        console.log('[Login] Redirecting to dashboard...')
        // Use window.location.href for reliable redirect
        window.location.href = '/dashboard'
      } else {
        toast.error(data.message || 'Login failed')
      }
    } catch (error) {
      toast.error('An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Show loading screen while checking session
  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#1a0a2e]">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500"></div>
          <p className="mt-4 text-gray-300">Checking session...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#1a0a2e] relative overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#1a0a2e] via-[#2d1b4e] to-[#1a0a2e]">
        {/* Animated gradient orbs */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-600/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      {/* Login Form - Centered */}
      <div className="relative z-20 min-h-screen flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          {/* Glass morphism card with solid white background for readability */}
          <div 
            className="rounded-3xl shadow-2xl overflow-hidden"
            style={{
              background: 'rgba(255, 255, 255, 0.95)',
              backdropFilter: 'blur(20px)',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1)'
            }}
          >
            <div className="p-8 md:p-10">
              {/* Logo and Title */}
              <div className="text-center mb-8">
                <div className="flex justify-center mb-5">
                  <img
                    src="/logo.png"
                    alt="Talio Logo"
                    className="h-12 w-auto object-contain"
                  />
                </div>
                <h1 className="text-2xl font-bold text-gray-900 mb-1">Welcome Back</h1>
                <p className="text-gray-500 text-sm">Sign in to continue to Talio</p>
              </div>

              <form className="space-y-5" onSubmit={handleSubmit}>
                {/* Email Field */}
                <div>
                  <label htmlFor="email" className="block text-sm font-semibold text-gray-700 mb-2">
                    Email Address
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <FaEnvelope className="h-4 w-4 text-gray-400" />
                    </div>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      className="w-full pl-11 pr-4 py-3.5 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-200"
                      placeholder="name@company.com"
                      value={formData.email}
                      onChange={handleChange}
                    />
                  </div>
                </div>

                {/* Password Field */}
                <div>
                  <label htmlFor="password" className="block text-sm font-semibold text-gray-700 mb-2">
                    Password
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <FaLock className="h-4 w-4 text-gray-400" />
                    </div>
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      className="w-full pl-11 pr-12 py-3.5 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-200"
                      placeholder="Enter your password"
                      value={formData.password}
                      onChange={handleChange}
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-gray-600 transition-colors"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? (
                        <FaEyeSlash className="h-4 w-4" />
                      ) : (
                        <FaEye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Remember & Forgot */}
                <div className="flex items-center justify-between text-sm">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                    />
                    <span className="text-gray-600">Remember me</span>
                  </label>
                  <Link href="/auth/forgot-password" className="text-purple-600 hover:text-purple-700 font-medium transition-colors">
                    Forgot password?
                  </Link>
                </div>

                {/* Sign In Button */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 px-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-semibold rounded-xl shadow-lg shadow-purple-500/30 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Signing in...
                    </span>
                  ) : (
                    'Sign in'
                  )}
                </button>
              </form>
            </div>

            {/* Footer */}
            <div className="px-8 py-4 bg-gray-50 border-t border-gray-100">
              <p className="text-center text-gray-500 text-xs">
                Powered by <span className="text-purple-600 font-medium">Talio</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

