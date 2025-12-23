'use client'

import { useState, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import BottomNav from '@/components/BottomNav'
import { OfflineIndicator } from '@/components/PWAInstaller'
import OutOfPremisesPopup from '@/components/OutOfPremisesPopup'
import ChatWidgetContainer from '@/components/chat/ChatWidgetContainer'
import ProfileCompletionModal from '@/components/ProfileCompletionModal'

import useGeofencing from '@/hooks/useGeofencing'
import { SocketProvider } from '@/contexts/SocketContext'
import { UnreadMessagesProvider } from '@/contexts/UnreadMessagesContext'
import { InAppNotificationProvider } from '@/contexts/InAppNotificationContext'
import { ChatWidgetProvider, useChatWidget } from '@/contexts/ChatWidgetContext'
import { getCurrentUser, getEmployeeId, syncUserData, getToken } from '@/utils/userHelper'
import CallAlertReceiver from '@/components/CallAlertReceiver'

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
  const [showProfileCompletionModal, setShowProfileCompletionModal] = useState(false)
  const [profileCompletionStatus, setProfileCompletionStatus] = useState(null)
  const pathname = usePathname()
  const router = useRouter()

  // Check if user needs to change password on first login
  useEffect(() => {
    const checkPasswordChangeRequired = async () => {
      const token = getToken()
      const user = getCurrentUser()
      
      if (!token || !user) {
        // No auth, redirect to login
        window.location.href = '/login'
        return
      }
      
      // Check if localStorage user data indicates password change needed
      if (user.forcePasswordChange) {
        console.log('[Dashboard] Password change required (from localStorage), redirecting...')
        window.location.href = '/auth/change-password'
        return
      }
      
      // Verify with server
      try {
        const response = await fetch('/api/auth/validate', {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        
        if (!response.ok) {
          // Token invalid, redirect to login
          localStorage.removeItem('token')
          localStorage.removeItem('user')
          localStorage.removeItem('userId')
          document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
          window.location.href = '/login'
          return
        }
        
        const data = await response.json()
        
        if (data.forcePasswordChange) {
          console.log('[Dashboard] Password change required (from server), redirecting...')
          // Update localStorage to reflect this
          const updatedUser = { ...user, forcePasswordChange: true }
          localStorage.setItem('user', JSON.stringify(updatedUser))
          window.location.href = '/auth/change-password'
          return
        }
        
        setIsCheckingAuth(false)
        
        // Check profile completion status after auth is verified
        // Small delay to ensure layout is mounted
        setTimeout(() => {
          checkProfileCompletionStatus(token)
        }, 500)
      } catch (error) {
        console.error('[Dashboard] Auth check error:', error)
        // On network error, allow access but show warning
        setIsCheckingAuth(false)
      }
    }
    
    checkPasswordChangeRequired()
  }, [])

  // Check profile completion status
  const checkProfileCompletionStatus = async (token) => {
    try {
      console.log('[Dashboard] Checking profile completion status...')
      const response = await fetch('/api/profile/completion-status', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      
      if (response.ok) {
        const data = await response.json()
        console.log('[Dashboard] Profile completion data:', data)
        if (data.success && data.data) {
          setProfileCompletionStatus(data.data)
          
          // Show modal if profile is not complete and not on profile page
          const shouldShowModal = data.data.showModal
          const isOnProfilePage = pathname?.includes('/profile')
          
          console.log('[Dashboard] Modal check - showModal:', shouldShowModal, 'isOnProfilePage:', isOnProfilePage)
          
          if (shouldShowModal && !isOnProfilePage) {
            // Check if user has dismissed the modal in this session
            // Use a more specific key that includes user ID to avoid cross-session issues
            const userId = data.data.firstLoginAt ? 'user' : 'unknown'
            const dismissedKey = `profileModal_dismissed_${new Date().toDateString()}`
            const dismissed = sessionStorage.getItem(dismissedKey)
            
            console.log('[Dashboard] Modal dismissed today:', dismissed)
            
            if (!dismissed) {
              console.log('[Dashboard] *** SHOWING PROFILE COMPLETION MODAL ***')
              setShowProfileCompletionModal(true)
            }
          }
          
          // If account is suspended, show suspension message
          if (data.data.status === 'suspended') {
            console.log('[Dashboard] Account suspended due to incomplete profile')
            // Could redirect to a suspension page or show a blocking modal
          }
        }
      } else {
        console.log('[Dashboard] Profile completion API returned non-ok status:', response.status)
      }
    } catch (error) {
      console.error('[Dashboard] Profile completion check error:', error)
    }
  }

  // Handle modal close
  const handleProfileModalClose = () => {
    setShowProfileCompletionModal(false)
    // Remember that user dismissed modal today (resets daily)
    const dismissedKey = `profileModal_dismissed_${new Date().toDateString()}`
    sessionStorage.setItem(dismissedKey, 'true')
  }

  // Sync user data on mount to ensure employee info is complete
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
          try {
            console.log('[Dashboard] Syncing employee data...')
            const response = await fetch(`/api/employees/${empId}`, {
              headers: { 'Authorization': `Bearer ${token}` }
            })
            const result = await response.json()
            if (result.success && result.data) {
              syncUserData(result.data)
              console.log('[Dashboard] Employee data synced:', result.data.firstName, result.data.lastName)
            }
          } catch (error) {
            console.error('[Dashboard] Error syncing employee data:', error)
          }
        }
      }
    }
    
    syncEmployeeData()
  }, [])

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
    pathname?.startsWith('/dashboard/tasks') || 
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
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg-main)' }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-300">Loading...</p>
        </div>
      </div>
    )
  }

  // For meeting room pages, render children directly without any layout chrome
  if (isMeetingRoomPage) {
    return (
      <SocketProvider>
        <UnreadMessagesProvider>
          <InAppNotificationProvider>
            <ChatWidgetProvider>
              {children}
              <CallAlertReceiver />
            </ChatWidgetProvider>
          </InAppNotificationProvider>
        </UnreadMessagesProvider>
      </SocketProvider>
    )
  }

  return (
    <SocketProvider>
      <UnreadMessagesProvider>
        <InAppNotificationProvider>
          <ChatWidgetProvider>
            {/* Sync sidebar state to chat widget context */}
            <SidebarStateSync sidebarCollapsed={sidebarCollapsed} />
            
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
                <main className={`z-0 flex-1 overflow-y-auto ${isChatPage ? 'bg-white md:bg-transparent' : ''}`}>
                  <div className={`min-h-full ${isChatPage ? 'sm:pb-16 px-0 md:px-4 lg:px-8' : 'px-0 sm:px-6 lg:px-8 py-6'}`}>
                    {children}
                  </div>
                  
                  {/* Bottom padding for mobile nav */}
                  <div className={`w-full flex-shrink-0 md:hidden ${shouldShowFade ? 'h-20' : 'h-16'}`}></div>
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
            </div>
          </ChatWidgetProvider>
        </InAppNotificationProvider>
      </UnreadMessagesProvider>
    </SocketProvider>
  )
}
