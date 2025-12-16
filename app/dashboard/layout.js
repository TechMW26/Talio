'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import BottomNav from '@/components/BottomNav'
import PWAInstaller, { OfflineIndicator } from '@/components/PWAInstaller'
import OutOfPremisesPopup from '@/components/OutOfPremisesPopup'
import OfflineDetector from '@/components/OfflineDetector'
import ChatWidgetContainer from '@/components/chat/ChatWidgetContainer'

import useGeofencing from '@/hooks/useGeofencing'
import { SocketProvider } from '@/contexts/SocketContext'
import { UnreadMessagesProvider } from '@/contexts/UnreadMessagesContext'
import { InAppNotificationProvider } from '@/contexts/InAppNotificationContext'
import { ChatWidgetProvider, useChatWidget } from '@/contexts/ChatWidgetContext'
import { getCurrentUser, getEmployeeId, syncUserData, getToken } from '@/utils/userHelper'

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
  const pathname = usePathname()

  // Sync user data on mount to ensure employee info is complete
  useEffect(() => {
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

  // For meeting room pages, render children directly without any layout chrome
  if (isMeetingRoomPage) {
    return (
      <SocketProvider>
        <UnreadMessagesProvider>
          <InAppNotificationProvider>
            <ChatWidgetProvider>
              {children}
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

              {/* Offline Detector */}
              <OfflineDetector />

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

              {/* PWA Install Prompt */}
              <PWAInstaller />

              {/* Out of Premises Popup */}
              <OutOfPremisesPopup />

              {/* Floating Chat Widget for Desktop */}
              <ChatWidgetContainer />
            </div>
          </ChatWidgetProvider>
        </InAppNotificationProvider>
      </UnreadMessagesProvider>
    </SocketProvider>
  )
}

