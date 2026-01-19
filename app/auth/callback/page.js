'use client'

import { useEffect, useState, Suspense } from 'react'
import Loader from '@/components/ui/Loader'

function AuthCallbackContent() {
  const [status, setStatus] = useState('Processing...')

  useEffect(() => {
    const processAuth = async () => {
      console.log('🔵 Auth Callback - Start')

      // Check if running in TWA (Android app)
      const isInApp = window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone ||
        document.referrer.includes('android-app://')

      console.log('🔵 Running in app:', isInApp)
      setStatus('Reading authentication data...')

      // Wait a moment for cookies to be set
      await new Promise(resolve => setTimeout(resolve, 200))

      // Get cookies and store in localStorage
      const cookies = document.cookie.split(';').reduce((acc, cookie) => {
        const parts = cookie.trim().split('=')
        if (parts.length >= 2) {
          const key = parts[0]
          const value = parts.slice(1).join('=') // Handle values with = in them
          acc[key] = value
        }
        return acc
      }, {})

      console.log('Cookies found:', Object.keys(cookies))
      console.log('All cookies:', document.cookie)

      if (cookies.token && cookies.user) {
        try {
          setStatus('Decoding user data...')

          // Decode the user cookie (it's URL encoded)
          const userDataString = decodeURIComponent(cookies.user)
          console.log('User data string length:', userDataString.length)

          const userData = JSON.parse(userDataString)

          console.log('✅ User data from cookie:', {
            email: userData.email,
            role: userData.role,
            firstName: userData.firstName,
            lastName: userData.lastName
          })

          setStatus('Storing session data...')

          // Store in localStorage
          localStorage.setItem('token', cookies.token)
          localStorage.setItem('user', JSON.stringify(userData))
          const resolvedUserId = userData?.id || userData?._id || userData?.userId
          if (resolvedUserId) {
            localStorage.setItem('userId', resolvedUserId)
          }

          // Also set cookie for middleware (non-httpOnly)
          document.cookie = `token=${cookies.token}; path=/; max-age=${7 * 24 * 60 * 60}`

          console.log('✅ Stored in localStorage')
          console.log('✅ Token:', localStorage.getItem('token') ? 'Set' : 'Not set')
          console.log('✅ User:', localStorage.getItem('user') ? 'Set' : 'Not set')

          setStatus('Redirecting to dashboard...')
          console.log('🔵 Redirecting to dashboard...')

          // Small delay to ensure localStorage is written
          await new Promise(resolve => setTimeout(resolve, 300))

          // Redirect based on role
          const dashboardUrl = '/dashboard'

          // If in app (TWA), use location.replace to close Chrome Custom Tab
          if (isInApp) {
            console.log('🔵 In app - using location.replace to close Chrome Custom Tab')
            window.location.replace(dashboardUrl)
          } else {
            window.location.href = dashboardUrl
          }
        } catch (error) {
          console.error('❌ Error processing auth callback:', error)
          console.error('Error details:', error.message)
          console.error('Error stack:', error.stack)
          setStatus('Authentication failed')

          await new Promise(resolve => setTimeout(resolve, 1000))
          window.location.href = '/login?error=authentication_failed'
        }
      } else {
        console.error('❌ Missing cookies')
        console.error('Token cookie:', cookies.token ? 'Present' : 'Missing')
        console.error('User cookie:', cookies.user ? 'Present' : 'Missing')
        console.error('All cookies:', document.cookie)

        setStatus('Waiting for authentication data...')

        // Wait a bit longer and try again (sometimes cookies take a moment)
        await new Promise(resolve => setTimeout(resolve, 1000))

        const retryCookies = document.cookie.split(';').reduce((acc, cookie) => {
          const parts = cookie.trim().split('=')
          if (parts.length >= 2) {
            const key = parts[0]
            const value = parts.slice(1).join('=')
            acc[key] = value
          }
          return acc
        }, {})

        if (retryCookies.token && retryCookies.user) {
          console.log('✅ Cookies found on retry')
          processAuth()
        } else {
          console.error('❌ Still no cookies after retry')
          console.error('Retry cookies:', Object.keys(retryCookies))
          setStatus('Authentication failed - no session data')

          await new Promise(resolve => setTimeout(resolve, 1000))
          window.location.href = '/login?error=authentication_failed'
        }
      }
    }

    processAuth()
  }, [])

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-white">
      <style jsx global>{`
        html, body {
          background-color: #FFFFFF !important;
        }
      `}</style>
      <div className="text-center">
        <Loader size="lg" className="mb-4" />
        <p className="text-gray-600 font-medium">Completing sign in...</p>
        <p className="text-gray-400 text-sm mt-2">{status}</p>
      </div>
    </div>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="fixed inset-0 flex items-center justify-center bg-white">
        <style jsx global>{`
          html, body {
            background-color: #FFFFFF !important;
          }
        `}</style>
        <div className="text-center">
          <Loader size="lg" className="mb-4" />
        </div>
      </div>
    }>
      <AuthCallbackContent />
    </Suspense>
  )
}

