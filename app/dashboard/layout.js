'use client'

import { useState, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Spinner } from '@heroui/react'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import BottomNav from '@/components/BottomNav'
import OfflineIndicator from '@/components/OfflineIndicator'
import OutOfPremisesPopup from '@/components/OutOfPremisesPopup'
import ChatWidgetContainer from '@/components/chat/ChatWidgetContainer'
import ProfileCompletionModal from '@/components/ProfileCompletionModal'
import { WebPushPrompt } from '@/components/WebPushNotification'

import useGeofencing from '@/hooks/useGeofencing'
import { SocketProvider } from '@/contexts/SocketContext'
import { UnreadMessagesProvider } from '@/contexts/UnreadMessagesContext'
import { InAppNotificationProvider } from '@/contexts/InAppNotificationContext'
import { ActionableToastProvider } from '@/contexts/ActionableToastContext'
import { ChatWidgetProvider, useChatWidget } from '@/contexts/ChatWidgetContext'
import { PageTransitionProvider, usePageTransition } from '@/contexts/PageTransitionContext'
import { getCurrentUser, getEmployeeId, syncUserData, getToken } from '@/utils/userHelper'
import { 
  getOptimisticAuth, 
  validateAuthBackground, 
  getCachedProfileStatus, 
  setCachedProfileStatus,
  getCachedEmployeeData,
  setCachedEmployeeData,
  clearAllSessionCaches
} from '@/utils/sessionCache'
import WebAccessRestriction, { shouldRestrictWebAccess } from '@/components/WebAccessRestriction'
import CallAlertReceiver from '@/components/CallAlertReceiver'

// Page transition loading overlay
function PageTransitionOverlay() {
  const { isNavigating } = usePageTransition()
  
  if (!isNavigating) return null
  
  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-[9998]">
      <div className="flex flex-col items-center">
        <Spinner size="lg" color="primary" />
      </div>
    </div>
  )
}

// Component to sync sidebar state with chat widget context
function SidebarStateSync({ sidebarCollapsed }) {
  const { updateSidebarCollapsed } = useChatWidget()

  useEffect(() => {
    updateSidebarCollapsed(sidebarCollapsed)
  }, [sidebarCollapsed, updateSidebarCollapsed])

  return null
}

export default function DashboardLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true) // Desktop sidebar starts collapsed
  const [userId, setUserId] = useState(null)
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)
  const [isWebRestricted, setIsWebRestricted] = useState(false)
  const [showProfileCompletionModal, setShowProfileCompletionModal] = useState(false)
  const [profileCompletionStatus, setProfileCompletionStatus] = useState(null)
  const pathname = usePathname()
  const router = useRouter()

  // Check if non-admin user is accessing via web browser
  useEffect(() => {
    // Small delay to ensure all app detection globals are set
    const timer = setTimeout(() => {
      const restricted = shouldRestrictWebAccess()
      console.log('[Dashboard] Web access restriction check:', restricted)
      setIsWebRestricted(restricted)
    }, 100)
    return () => clearTimeout(timer)
  }, [])

  // Check if user needs to change password on first login
  // OPTIMIZED: Render immediately with localStorage data, validate in background
  useEffect(() => {
    const checkPasswordChangeRequired = async () => {
      // STEP 1: Check for auth data in localStorage
      const optimisticAuth = getOptimisticAuth()
      
      if (!optimisticAuth) {
        // No auth, redirect to login
        window.location.href = '/login'
        return
      }

      const { token, user } = optimisticAuth

      // Check if localStorage user data indicates password change needed
      if (user.forcePasswordChange) {
        console.log('[Dashboard] Password change required (from localStorage), redirecting...')
        window.location.href = '/auth/change-password'
        return
      }

      // STEP 2: Allow rendering immediately (optimistic)
      setIsCheckingAuth(false)

      // STEP 3: Validate token in background (non-blocking)
      const handleInvalidSession = (message) => {
        console.log('[Dashboard] Session invalid:', message)
        clearAllSessionCaches()
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        localStorage.removeItem('userId')
        document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
        window.location.href = '/login'
      }

      try {
        const validationResult = await validateAuthBackground(token, handleInvalidSession)
        
        if (validationResult.forcePasswordChange) {
          console.log('[Dashboard] Password change required (from server), redirecting...')
          const updatedUser = { ...user, forcePasswordChange: true }
          localStorage.setItem('user', JSON.stringify(updatedUser))
          window.location.href = '/auth/change-password'
          return
        }

        // Check profile completion status (with caching)
        checkProfileCompletionStatus(token)
      } catch (error) {
        console.warn('[Dashboard] Auth validation error (non-blocking):', error.message)
        // On network error, still check profile status later
        setTimeout(() => checkProfileCompletionStatus(token), 2000)
      }
    }

    checkPasswordChangeRequired()
  }, [])

  // Check profile completion status (with caching for performance)
  const checkProfileCompletionStatus = async (token) => {
    // Check cache first
    const cachedStatus = getCachedProfileStatus()
    if (cachedStatus) {
      console.log('[Dashboard] Using cached profile completion status')
      handleProfileCompletionData(cachedStatus)
      return
    }

    try {
      console.log('[Dashboard] Fetching profile completion status...')
      const response = await fetch('/api/profile/completion-status', {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      if (response.ok) {
        const data = await response.json()
        console.log('[Dashboard] Profile completion data:', data)
        if (data.success && data.data) {
          // Cache the result
          setCachedProfileStatus(data.data)
          handleProfileCompletionData(data.data)
        }
      } else {
        console.log('[Dashboard] Profile completion API returned non-ok status:', response.status)
      }
    } catch (error) {
      console.warn('[Dashboard] Profile completion check error (non-blocking):', error.message)
    }
  }

  // Handle profile completion data (shared between cache and fresh fetch)
  const handleProfileCompletionData = (data) => {
    setProfileCompletionStatus(data)

    // Show modal if profile is not complete and not on profile page
    const shouldShowModal = data.showModal
    const isOnProfilePage = pathname?.includes('/profile')

    console.log('[Dashboard] Modal check - showModal:', shouldShowModal, 'isOnProfilePage:', isOnProfilePage)

    if (shouldShowModal && !isOnProfilePage) {
      const dismissedKey = `profileModal_dismissed_${new Date().toDateString()}`
      const dismissed = sessionStorage.getItem(dismissedKey)

      console.log('[Dashboard] Modal dismissed today:', dismissed)

      if (!dismissed) {
        console.log('[Dashboard] *** SHOWING PROFILE COMPLETION MODAL ***')
        setShowProfileCompletionModal(true)
      }
    }

    // If account is suspended, show suspension message
    if (data.status === 'suspended') {
      console.log('[Dashboard] Account suspended due to incomplete profile')
    }
  }

  // Handle modal close
  const handleProfileModalClose = () => {
    setShowProfileCompletionModal(false)
    // Remember that user dismissed modal today (resets daily)
    const dismissedKey = `profileModal_dismissed_${new Date().toDateString()}`
    sessionStorage.setItem(dismissedKey, 'true')
  }

  // Sync user data on mount to ensure employee info is complete (with caching)
  useEffect(() => {
    if (isCheckingAuth) return // Don't sync while checking auth

    const syncEmployeeData = async () => {
      const user = getCurrentUser()
      const token = getToken()

      if (!user || !token) return

      // Check if we need to sync (missing firstName or employeeId structure is incomplete)
      const needsSync = !user.firstName ||
        (user.employeeId && typeof user.employeeId !== 'object') ||
        (user.employeeId && !user.employeeId.firstName)

      if (needsSync) {
        const empId = getEmployeeId(user)
        if (empId) {
          // Check cache first
          const cachedEmployee = getCachedEmployeeData(empId)
          if (cachedEmployee) {
            console.log('[Dashboard] Using cached employee data:', cachedEmployee.firstName)
            syncUserData(cachedEmployee)
            return
          }

          try {
            console.log('[Dashboard] Syncing employee data...')
            const response = await fetch(`/api/employees/${empId}`, {
              headers: { 'Authorization': `Bearer ${token}` }
            })
            const result = await response.json()
            if (result.success && result.data) {
              // Cache the result
              setCachedEmployeeData(result.data)
              syncUserData(result.data)
              console.log('[Dashboard] Employee data synced:', result.data.firstName, result.data.lastName)
            }
          } catch (error) {
            console.warn('[Dashboard] Error syncing employee data (non-blocking):', error.message)
          }
        }
      }
    }

    syncEmployeeData()
  }, [isCheckingAuth])

  // Get user ID from localStorage and initialize desktop app
  useEffect(() => {
    const userData = localStorage.getItem('user')
    const token = localStorage.getItem('token')

    if (userData) {
      try {
        const user = JSON.parse(userData)
        setUserId(user.id || user._id)

        // Initialize desktop app monitoring if running in Electron
        if ((window.talioDesktop || window.electronAPI) && token) {
          const desktopAPI = window.talioDesktop || window.electronAPI
          console.log('[Dashboard] Initializing desktop app monitoring...')

          // Set auth to start monitoring
          if (desktopAPI.setAuth) {
            desktopAPI.setAuth(token, user).catch(err => {
              console.error('[Dashboard] Desktop setAuth error:', err)
            })
          }
        }
      } catch (error) {
        console.error('Error parsing user data:', error)
      }
    }
  }, [])

  // Initialize geofencing
  useGeofencing()

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen)
  }

  // Check if current page is a bottom nav page (excluding chat which doesn't show fade)
  const isBottomNavPage =
    pathname === '/dashboard' ||
    pathname?.startsWith('/dashboard/todo') ||
    pathname?.startsWith('/dashboard/projects') ||
    pathname?.startsWith('/dashboard/leave') ||
    pathname?.startsWith('/dashboard/sandbox')

  // Chat pages don't show the fade
  const isChatPage = pathname?.startsWith('/dashboard/chat')

  // Meeting room pages should have no chrome (sidebar/header)
  const isMeetingRoomPage = pathname?.includes('/meetings/room/')

  // Only show fade on bottom nav pages (not chat)
  const shouldShowFade = isBottomNavPage && !isChatPage

  // Show loading state while checking auth
  if (isCheckingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center flex flex-col items-center gap-3">
          <Spinner size="lg" color="primary" />
          <p className="text-default-500 text-sm font-medium">Loading...</p>
        </div>
      </div>
    )
  }

  // Show download prompt for non-admin users on web browser
  if (isWebRestricted) {
    return <WebAccessRestriction />
  }

  // For meeting room pages, render children directly without any layout chrome
  if (isMeetingRoomPage) {
    return (
      <SocketProvider>
        <UnreadMessagesProvider>
          <ChatWidgetProvider>
            <InAppNotificationProvider>
              <ActionableToastProvider>
                {children}
                <CallAlertReceiver />
              </ActionableToastProvider>
            </InAppNotificationProvider>
          </ChatWidgetProvider>
        </UnreadMessagesProvider>
      </SocketProvider>
    )
  }

  return (
    <SocketProvider>
      <UnreadMessagesProvider>
        <ChatWidgetProvider>
          <PageTransitionProvider>
          <InAppNotificationProvider>
            <ActionableToastProvider>
            {/* Sync sidebar state to chat widget context */}
            <SidebarStateSync sidebarCollapsed={sidebarCollapsed} />
            
            {/* Page transition loading overlay */}
            <PageTransitionOverlay />

            {/* Main Layout Container - Flex Row */}
            <div className="flex h-screen w-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg-main)' }}>

              {/* Sidebar - Static on Desktop, Fixed on Mobile */}
              <Sidebar
                isOpen={sidebarOpen}
                setIsOpen={setSidebarOpen}
                isCollapsed={sidebarCollapsed}
                setIsCollapsed={setSidebarCollapsed}
              />

              {/* Right Side Content - Flex Column */}
              <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden">
                {/* Offline Indicator */}
                <OfflineIndicator />

                {/* Header - Static at top of right column */}
                <Header toggleSidebar={toggleSidebar} sidebarCollapsed={sidebarCollapsed} />

                {/* Main Content Area - Scrollable */}
                <main className={`z-0 flex-1 overflow-y-auto ${isChatPage ? 'bg-white dark:bg-slate-800 md:bg-transparent' : ''}`}>
                  <div className={`min-h-full ${isChatPage ? 'sm:pb-16 px-0 md:px-4 lg:px-8' : 'px-0 sm:px-6 lg:px-8 pt-2 pb-6 sm:py-6'}`}>
                    {children}
                  </div>

                  {/* Bottom padding for mobile nav */}
                  <div className={`w-full flex-shrink-0 md:hidden ${shouldShowFade ? 'h-20' : 'h-16'}`}></div>
                  {/* Bottom padding for desktop */}
                  <div className="w-full flex-shrink-0 hidden md:block h-4"></div>
                </main>

                {/* Gradient above bottom nav - Mobile only */}
                {shouldShowFade && (
                  <div
                    className="md:hidden fixed left-0 right-0 h-[124px] pointer-events-none z-[39]"
                    style={{
                      bottom: '68px',
                      background: `linear-gradient(179.13deg, rgba(249, 250, 251, 0) 0%, var(--color-bg-main) 71.18%)`,
                      opacity: 1,
                      transition: 'opacity 0.6s ease-in-out'
                    }}
                  />
                )}

                {/* Bottom Navigation for Mobile */}
                <BottomNav />
              </div>

              {/* Out of Premises Popup */}
              <OutOfPremisesPopup />

              {/* Floating Chat Widget for Desktop */}
              <ChatWidgetContainer />

              {/* Profile Completion Modal */}
              <ProfileCompletionModal
                isOpen={showProfileCompletionModal}
                onClose={handleProfileModalClose}
                profileStatus={profileCompletionStatus}
              />

              {/* Call Alert Receiver - Global alert listener */}
              <CallAlertReceiver />

              {/* Web Push Notification Prompt */}
              <WebPushPrompt />
            </div>
            </ActionableToastProvider>
          </InAppNotificationProvider>
          </PageTransitionProvider>
        </ChatWidgetProvider>
      </UnreadMessagesProvider>
    </SocketProvider>
  )
}
