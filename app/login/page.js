'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from '@/utils/toast'
import { FaEnvelope, FaLock, FaEye, FaEyeSlash } from 'react-icons/fa'
import { resetRedirectFlag } from '@/utils/userHelper'
import { resetAuthRedirectFlag } from '@/hooks/useAuthedSWR'
import { 
  Card, 
  CardBody, 
  CardFooter,
  Input, 
  Button, 
  Checkbox,
  Spinner,
  Divider,
  Link as HeroLink
} from '@heroui/react'

export default function LoginPage() {
  const router = useRouter()
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  })
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [isRedirecting, setIsRedirecting] = useState(false)

  // Check if running in Electron/desktop app
  const isDesktopApp = () => {
    if (typeof window === 'undefined') return false
    if (window.talioDesktop?.isDesktopApp) return true
    if (navigator.userAgent.toLowerCase().includes('electron')) return true
    return false
  }

  // Check if user is already logged in
  useEffect(() => {
    // Reset any stale redirect flags when landing on login page
    resetRedirectFlag()
    resetAuthRedirectFlag()
    
    // Check if we're already in the process of redirecting (prevents loop)
    if (sessionStorage.getItem('__login_redirecting')) {
      console.log('[Login Page] Already redirecting, skipping check...')
      return
    }

    // Prevent multiple executions during redirect
    if (isRedirecting) return

    let hasStarted = false

    const checkSession = async () => {
      // Prevent double execution
      if (hasStarted) return
      hasStarted = true

      console.log('[Login Page] Checking session...')
      console.log('[Login Page] Is Desktop App:', isDesktopApp())

      // Multi-tenant: No setup check needed - admin accounts are created by superadmin
      // Login uses dynamic tenant detection based on user email

      const token = localStorage.getItem('token')
      const user = localStorage.getItem('user')

      console.log('[Login Page] Token exists:', !!token)
      console.log('[Login Page] User exists:', !!user)

      if (token && user) {
        // For desktop app, add timeout to validation to prevent hanging
        const controller = new AbortController()
        const timeoutId = setTimeout(() => {
          controller.abort(new DOMException('Request timeout', 'TimeoutError'))
        }, 5000) // 5 second timeout

        // Validate the token before redirecting
        try {
          const response = await fetch('/api/auth/validate', {
            headers: {
              'Authorization': `Bearer ${token}`
            },
            signal: controller.signal
          })
          clearTimeout(timeoutId)

          if (response.ok) {
            const data = await response.json()

            // CRITICAL: Ensure cookie is set before redirecting
            document.cookie = `token=${token}; path=/; max-age=${7 * 24 * 60 * 60}; SameSite=Lax` // 7 days

            // Set redirecting flag to prevent re-execution
            setIsRedirecting(true)
            // Also set sessionStorage flag to survive page reloads
            sessionStorage.setItem('__login_redirecting', 'true')

            // Check if user needs to change password
            if (data.forcePasswordChange) {
              console.log('[Login Page] User needs to change password, redirecting...')
              window.location.href = '/auth/change-password'
              return
            }

            // Token is valid, redirect to dashboard
            console.log('[Login Page] Token valid, redirecting to dashboard...')
            // Use _auth=local to bypass middleware cookie check (for environments where cookies don't work)
            window.location.href = '/dashboard?_auth=local'
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
          clearTimeout(timeoutId)
          console.error('[Login Page] Token validation error:', error)

          // For desktop app, if validation times out, show login form (don't clear storage)
          // The user may be offline and we don't want to lock them out
          if (isDesktopApp() && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
            console.log('[Login Page] Desktop app validation timeout, showing login form...')
            setChecking(false)
            return
          }

          // Network error - clear invalid session and show login form
          console.log('[Login Page] Network error during validation, clearing session...')
          localStorage.removeItem('token')
          localStorage.removeItem('user')
          localStorage.removeItem('userId')
          document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
          setChecking(false)
        }
      } else {
        // Clear redirect flag since there's no session
        sessionStorage.removeItem('__login_redirecting')

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
    // Reduced timeout for desktop app
    const timeoutMs = isDesktopApp() ? 3000 : 5000
    const safetyTimeout = setTimeout(() => {
      console.log('[Login Page] Safety timeout triggered, showing login form...')
      sessionStorage.removeItem('__login_redirecting')
      setChecking(false)
    }, timeoutMs)

    checkSession().finally(() => {
      clearTimeout(safetyTimeout)
    })

    return () => clearTimeout(safetyTimeout)
  }, [isRedirecting]) // Re-run if redirect state changes

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
        // Reset redirect flags from any previous session expiry
        resetRedirectFlag()
        resetAuthRedirectFlag()
        
        // Set flag for dashboard to play login success sound
        sessionStorage.setItem('playLoginSound', 'true')

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
      <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 dark:bg-[#0F172A] dark:from-transparent dark:to-transparent">
        <div className="text-center flex flex-col items-center justify-center">
          <Spinner size="lg" color="primary" />
          <p className="mt-4 text-default-600 text-center font-medium">Checking session...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:bg-[#0F172A] dark:from-transparent dark:via-transparent dark:to-transparent">
      {/* Decorative background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary-200 dark:bg-primary-500/10 rounded-full blur-3xl opacity-30" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-secondary-200 dark:bg-secondary-500/10 rounded-full blur-3xl opacity-30" />
      </div>

      {/* Login Form - Centered */}
      <div className="min-h-screen flex items-center justify-center px-4 py-8 relative z-10">
        <div className="w-full max-w-md">
          <Card 
            className="shadow-2xl border border-default-100 dark:border-slate-700/50 bg-white/80 dark:bg-[#1E293B]/90 backdrop-blur-xl"
            radius="lg"
          >
            <CardBody className="p-8 md:p-10">
              {/* Logo and Title */}
              <div className="text-center mb-8">
                <div className="flex justify-center mb-5">
                  <img
                    src="/logo.png"
                    alt="Talio Logo"
                    className="h-12 w-auto object-contain"
                  />
                </div>
                <h1 className="text-2xl font-bold text-default-900 mb-1">Welcome Back</h1>
                <p className="text-default-500 text-sm">Sign in to continue to Talio</p>
              </div>

              <form className="space-y-5" onSubmit={handleSubmit}>
                {/* Email Field */}
                <div>
                  <Input
                    label="Email Address"
                    labelPlacement="outside"
                    type="email"
                    name="email"
                    placeholder="name@company.com"
                    value={formData.email}
                    onChange={handleChange}
                    autoComplete="email"
                    isRequired
                    variant="bordered"
                    radius="lg"
                    size="lg"
                    startContent={
                      <FaEnvelope className="text-default-400 pointer-events-none flex-shrink-0" />
                    }
                    classNames={{
                      label: "text-default-700 font-semibold",
                      input: "text-default-900",
                      inputWrapper: "bg-default-50 hover:bg-default-100 border-default-200 hover:border-primary-300 transition-colors",
                    }}
                  />
                </div>

                {/* Password Field */}
                <div className="pt-2">
                  <Input
                    label="Password"
                    labelPlacement="outside"
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    placeholder="Enter your password"
                    value={formData.password}
                    onChange={handleChange}
                    autoComplete="current-password"
                    isRequired
                    variant="bordered"
                    radius="lg"
                    size="lg"
                    startContent={
                      <FaLock className="text-default-400 pointer-events-none flex-shrink-0" />
                    }
                    endContent={
                      <button
                        type="button"
                        className="focus:outline-none"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? (
                          <FaEyeSlash className="text-default-400 hover:text-default-600 transition-colors" />
                        ) : (
                          <FaEye className="text-default-400 hover:text-default-600 transition-colors" />
                        )}
                      </button>
                    }
                    classNames={{
                      label: "text-default-700 font-semibold",
                      input: "text-default-900",
                      inputWrapper: "bg-default-50 hover:bg-default-100 border-default-200 hover:border-primary-300 transition-colors",
                    }}
                  />
                </div>

                {/* Remember & Forgot */}
                <div className="flex items-center justify-between">
                  <Checkbox 
                    size="sm"
                    classNames={{
                      label: "text-default-600 text-sm",
                    }}
                  >
                    Remember me
                  </Checkbox>
                  <Link 
                    href="/auth/forgot-password" 
                    className="text-primary-600 hover:text-primary-700 text-sm font-medium transition-colors"
                  >
                    Forgot password?
                  </Link>
                </div>

                {/* Sign In Button */}
                <Button
                  type="submit"
                  color="primary"
                  size="lg"
                  radius="lg"
                  isLoading={loading}
                  isDisabled={loading}
                  className="w-full font-semibold shadow-lg shadow-primary-500/30 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700"
                  spinner={<Spinner size="sm" color="white" />}
                >
                  {loading ? 'Signing in...' : 'Sign in'}
                </Button>
              </form>
            </CardBody>

            <Divider />

            {/* Footer */}
            <CardFooter className="justify-center py-4 bg-default-50/50 dark:bg-slate-800/50">
              <p className="text-default-500 text-xs">
                Powered by <span className="text-primary-600 dark:text-primary-400 font-semibold">Talio</span>
              </p>
            </CardFooter>
          </Card>

          {/* Optional: Link to sign up or help */}
          <p className="text-center mt-6 text-default-500 text-sm">
            Need help? Contact your{' '}
            <span className="text-primary-600 font-medium">administrator</span>
          </p>
        </div>
      </div>
    </div>
  )
}

