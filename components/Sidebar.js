'use client'

import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  HiOutlineChevronRight,
  HiOutlineXMark,
  HiOutlineCog6Tooth,
  HiOutlineArrowRightOnRectangle,
  HiOutlineChatBubbleLeftRight,
  HiOutlineUsers
} from 'react-icons/hi2'
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { getMenuItemsForRole } from '@/utils/roleBasedMenus'
import toast from '@/utils/toast'
import { handleSessionExpired } from '@/utils/userHelper'
import { useUnreadMessages } from '@/contexts/UnreadMessagesContext'
import { useChatWidget } from '@/contexts/ChatWidgetContext'
import { usePageTransition } from '@/contexts/PageTransitionContext'
import UnreadBadge from './UnreadBadge'
import { Button, Chip, ScrollShadow, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react'

import IconStrip from './sidebar/IconStrip'
import SlidingSidebar from './sidebar/SlidingSidebar'

// Inline badge component for expanded menu items
function InlineBadge({ count }) {
  if (!count || count <= 0) return null
  const isLargeNumber = count > 9
  return (
    <span
      className="flex items-center justify-center text-white font-bold rounded-full shadow-md"
      style={{
        backgroundColor: '#ef4444',
        minWidth: isLargeNumber ? '22px' : '20px',
        height: isLargeNumber ? '22px' : '20px',
        fontSize: isLargeNumber ? '10px' : '11px',
        paddingLeft: isLargeNumber ? '5px' : '0',
        paddingRight: isLargeNumber ? '5px' : '0',
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

export default function Sidebar({ isOpen, setIsOpen, isCollapsed, setIsCollapsed }) {
  const pathname = usePathname()
  const router = useRouter()
  const [expandedMenus, setExpandedMenus] = useState({})
  const [user, setUser] = useState(null)
  const [mounted, setMounted] = useState(false)
  const [isDepartmentHead, setIsDepartmentHead] = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [isDesktop, setIsDesktop] = useState(false)
  const { unreadCount } = useUnreadMessages()
  const { toggleWidget } = useChatWidget()
  const { startNavigation } = usePageTransition()

  // Sliding sidebar state for desktop
  const [slidingSidebarOpen, setSlidingSidebarOpen] = useState(false)
  const [activeSubmenu, setActiveSubmenu] = useState(null)
  const [activeMenuIndex, setActiveMenuIndex] = useState(null)

  // Sidebar pending counts
  const [sidebarCounts, setSidebarCounts] = useState({
    projects: 0,
    tasks: 0,
    leaves: 0,
    attendance: 0,
    expenses: 0,
    helpdesk: 0,
    notifications: 0
  })

  // Check if desktop/tablet (matches Tailwind lg: breakpoint at 1024px)
  useEffect(() => {
    const checkDesktop = () => {
      setIsDesktop(window.innerWidth >= 1024)
    }
    checkDesktop()
    window.addEventListener('resize', checkDesktop)
    return () => window.removeEventListener('resize', checkDesktop)
  }, [])

  // Load user only once on mount
  useEffect(() => {
    setMounted(true)
    const userData = localStorage.getItem('user')
    if (userData) {
      const parsedUser = JSON.parse(userData)
      setUser(parsedUser)
      checkDepartmentHead()
    }
  }, [])

  // Check if user is a department head
  const checkDepartmentHead = async () => {
    try {
      const token = localStorage.getItem('token')
      if (!token) return

      const response = await fetch('/api/team/check-head', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      // Handle 401 - session expired
      if (response.status === 401) {
        handleSessionExpired()
        return
      }

      const data = await response.json()
      if (data.success && data.isDepartmentHead) {
        setIsDepartmentHead(true)
      }
    } catch (error) {
      console.error('Error checking department head:', error)
    }
  }

  // Fetch sidebar pending counts
  const fetchSidebarCounts = useCallback(async () => {
    try {
      const token = localStorage.getItem('token')
      if (!token) return

      const response = await fetch('/api/sidebar/counts', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      // Handle 401 - session expired
      if (response.status === 401) {
        handleSessionExpired()
        return
      }

      const data = await response.json()
      if (data.success) {
        setSidebarCounts(data.data)
      }
    } catch (error) {
      console.error('Error fetching sidebar counts:', error)
    }
  }, [])

  // Fetch counts on mount and periodically
  useEffect(() => {
    if (mounted && user) {
      fetchSidebarCounts()

      // Refresh counts every 60 seconds
      const interval = setInterval(fetchSidebarCounts, 60000)
      return () => {
        clearInterval(interval)
      }
    }
  }, [mounted, user, fetchSidebarCounts])

  // Get menu items based on user role (memoized)
  const menuItems = useMemo(() => {
    if (!user) return []

    // For admin users, keep admin role even if they're department heads (they should see both Employees and Team)
    // For other users, switch to department_head role if they're a department head
    const effectiveRole = (isDepartmentHead && user.role !== 'admin') ? 'department_head' : user.role
    let baseMenuItems = getMenuItemsForRole(effectiveRole)

    if (isDepartmentHead) {
      const teamMenuItem = {
        name: 'Team',
        icon: HiOutlineUsers,
        path: '/dashboard/team/members',
        submenu: [
          { name: 'Team Members', path: '/dashboard/team/members' },
          { name: 'Team Ratings', path: '/dashboard/performance/ratings' },
          { name: 'Team Goals', path: '/dashboard/performance/goals' },
          { name: 'Performance Reports', path: '/dashboard/performance/reports' },
          { name: 'Geofencing', path: '/dashboard/team/geofencing' }
        ]
      }

      const attendanceMenuIndex = baseMenuItems.findIndex(item => item.name === 'Attendance & Leaves')
      if (attendanceMenuIndex !== -1) {
        baseMenuItems = [...baseMenuItems]
        // For admin with dept head, merge admin's attendance submenu with team attendance
        const currentSubmenu = baseMenuItems[attendanceMenuIndex].submenu || []
        const hasTeamAttendance = currentSubmenu.some(item => item.path === '/dashboard/attendance/team')

        if (!hasTeamAttendance) {
          // Add Team Attendance after My Attendance
          const myAttendanceIndex = currentSubmenu.findIndex(item => item.path === '/dashboard/attendance')
          const newSubmenu = [...currentSubmenu]
          newSubmenu.splice(myAttendanceIndex + 1, 0, { name: 'Team Attendance', path: '/dashboard/attendance/team' })
          baseMenuItems[attendanceMenuIndex] = {
            ...baseMenuItems[attendanceMenuIndex],
            submenu: newSubmenu
          }
        }
      }

      return [
        baseMenuItems[0],
        teamMenuItem,
        ...baseMenuItems.slice(1)
      ]
    }

    return baseMenuItems
  }, [user, isDepartmentHead])

  const toggleSubmenu = (menuName) => {
    setExpandedMenus(prev => ({
      ...prev,
      [menuName]: !prev[menuName]
    }))
  }

  const handleLinkClick = (path) => {
    setIsOpen(false)
    if (path && path !== pathname) {
      startNavigation(path)
    }
  }

  const handleLogout = () => {
    // Fire-and-forget: trigger server-side logout (enqueues productivity analysis)
    const token = localStorage.getItem('token')
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      }).catch(() => { }) // Non-blocking
    }
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    localStorage.removeItem('userId')
    toast.success('Logged out successfully')
    router.push('/login')
  }

  // Helper to check if a menu item is active
  const isMenuItemActive = (item) => {
    if (item.path === pathname) return true
    if (item.submenu) {
      return item.submenu.some(subItem => subItem.path === pathname)
    }
    return false
  }

  // Helper to get badge count for a menu item
  const getBadgeCount = (itemName) => {
    switch (itemName) {
      case 'Projects':
        return sidebarCounts.projects + sidebarCounts.tasks
      case 'Attendance & Leaves':
        return sidebarCounts.leaves + sidebarCounts.attendance
      case 'Expenses':
        return sidebarCounts.expenses
      case 'Helpdesk':
        return sidebarCounts.helpdesk
      case 'Notifications':
        return sidebarCounts.notifications
      default:
        return 0
    }
  }

  // Helper to get badge count for submenu items
  const getSubmenuBadgeCount = (subItemName) => {
    switch (subItemName) {
      case 'Attendance Regularisation':
        return sidebarCounts.attendance
      case 'Leave Approvals':
        return sidebarCounts.leaves
      case 'My Projects':
      case 'Project Invitations':
        return sidebarCounts.projects
      case "To-Do's":
        return sidebarCounts.tasks
      case 'Approvals':
        return sidebarCounts.expenses
      default:
        return 0
    }
  }

  // Handle expand click from icon strip
  const handleIconStripExpand = (submenuName, menuIndex) => {
    setSlidingSidebarOpen(true)
    setActiveSubmenu(submenuName)
    // Pass the menu index so SlidingSidebar can scroll to it
    setActiveMenuIndex(menuIndex)
  }

  if (!mounted) {
    return null
  }

  return (
    <>
      {/* Desktop: Icon Strip + Sliding Sidebar */}
      {isDesktop && (
        <>
          <IconStrip
            onExpandClick={handleIconStripExpand}
            sidebarCounts={sidebarCounts}
            isDepartmentHead={isDepartmentHead}
          />
          <SlidingSidebar
            isOpen={slidingSidebarOpen}
            setIsOpen={setSlidingSidebarOpen}
            activeSubmenu={activeSubmenu}
            setActiveSubmenu={setActiveSubmenu}
            activeMenuIndex={activeMenuIndex}
            sidebarCounts={sidebarCounts}
            isDepartmentHead={isDepartmentHead}
          />
          {/* Spacer for icon strip width */}
          <div className="hidden lg:block w-[4.5rem] flex-shrink-0" />
        </>
      )}

      {/* Mobile: Traditional sidebar with overlay */}
      {!isDesktop && (
        <>
          {/* Mobile overlay with tinted background */}
          {isOpen && (
            <div
              className="fixed inset-0 z-[60] animate-fade-in bg-black/60"
              onClick={() => setIsOpen(false)}
            />
          )}

          {/* Mobile Sidebar */}
          <aside
            className={`
              fixed inset-y-0 left-0 z-[60]
              flex flex-col h-screen shadow-[0_6px_24px_rgba(15,23,42,0.08)]
              ${isOpen ? 'translate-x-0' : '-translate-x-full'}
              w-full max-w-[280px]
              transition-transform duration-300 ease-in-out
            `}
            style={{
              backgroundColor: 'var(--color-bg-sidebar)',
            }}
          >
            {/* Logo Section */}
            <div className="h-[60.5px] px-4 flex-shrink-0 flex items-center">
              <div className="flex items-center w-full justify-between">
                <img
                  src="/assets/logo.png"
                  alt="Talio Logo"
                  className="h-10 w-auto object-contain"
                />
                <button
                  onClick={() => setIsOpen(false)}
                  className="hover:opacity-70 focus:outline-none"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  <HiOutlineXMark className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Scrollable Menu Section */}
            <ScrollShadow className="pt-4 pb-8 flex-1 scrollbar-hide px-3 space-y-2">
              {menuItems.map((item) => {
                const isActive = isMenuItemActive(item)
                return (
                  <div key={item.name} className="w-full">
                    {item.submenu ? (
                      <div className="w-full">
                        <button
                          type="button"
                          onClick={() => toggleSubmenu(item.name)}
                          className="w-full flex items-center text-left rounded-xl transition-all duration-200 group relative justify-between px-4 py-3"
                          style={{
                            backgroundColor: expandedMenus[item.name] ? 'var(--color-bg-hover)' : 'transparent',
                            color: 'var(--color-text-primary)'
                          }}
                        >
                          <div className="flex items-center gap-3 flex-1">
                            <div
                              className="transition-colors p-2 rounded-lg"
                              style={{
                                backgroundColor: expandedMenus[item.name] ? 'var(--color-primary-500)' : 'var(--color-primary-100)',
                                color: expandedMenus[item.name] ? 'white' : 'var(--color-primary-700)'
                              }}
                            >
                              <item.icon className="w-5 h-5" />
                            </div>
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              {item.name === 'Attendance & Leaves' ? (
                                <span className="text-sm font-medium leading-tight text-left">
                                  Attendance &<br />Leaves
                                </span>
                              ) : (
                                <span className="text-sm font-medium truncate">{item.name}</span>
                              )}
                              <InlineBadge count={getBadgeCount(item.name)} />
                            </div>
                          </div>
                          <div className={`transition-transform duration-200 flex-shrink-0 ${expandedMenus[item.name] ? 'rotate-90' : ''}`}>
                            <HiOutlineChevronRight className="w-4 h-4" />
                          </div>
                        </button>
                        {expandedMenus[item.name] && (
                          <div className="mt-2 space-y-1 ml-8 pl-3" style={{ borderLeft: '2px solid var(--color-primary-200)' }}>
                            {item.submenu.map((subItem) => (
                              <Link
                                key={subItem.path}
                                href={subItem.path}
                                onClick={() => handleLinkClick(subItem.path)}
                                className="w-full text-left flex items-center justify-between px-3 py-2 text-sm rounded-lg transition-all duration-200 cursor-pointer"
                                style={{
                                  backgroundColor: pathname === subItem.path ? 'var(--color-primary-500)' : 'transparent',
                                  color: pathname === subItem.path ? 'white' : 'var(--color-text-secondary)'
                                }}
                              >
                                <span>{subItem.name}</span>
                                <InlineBadge count={getSubmenuBadgeCount(subItem.name)} />
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : item.name === 'Chat' ? (
                      <button
                        onClick={() => {
                          toggleWidget('sidebar')
                          handleLinkClick(null)
                        }}
                        className="w-full flex items-center text-left rounded-xl transition-all duration-200 group cursor-pointer relative px-4 py-3"
                        style={{
                          backgroundColor: 'transparent',
                          color: 'var(--color-text-primary)'
                        }}
                      >
                        <div className="flex items-center gap-3 flex-1">
                          <div
                            className="transition-colors relative p-2 rounded-lg"
                            style={{
                              backgroundColor: 'var(--color-primary-100)',
                              color: 'var(--color-primary-600)'
                            }}
                          >
                            <item.icon className="w-5 h-5" />
                            {unreadCount > 0 && <UnreadBadge count={unreadCount} />}
                          </div>
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="text-sm font-medium truncate">{item.name}</span>
                          </div>
                        </div>
                      </button>
                    ) : (
                      <Link
                        href={item.path}
                        onClick={() => handleLinkClick(item.path)}
                        className="w-full flex items-center text-left rounded-xl transition-all duration-200 group cursor-pointer relative px-4 py-3"
                        style={{
                          backgroundColor: isActive ? 'var(--color-primary-500)' : 'transparent',
                          color: isActive ? 'white' : 'var(--color-text-primary)'
                        }}
                      >
                        <div className="flex items-center gap-3 flex-1">
                          <div
                            className="transition-colors p-2 rounded-lg"
                            style={{
                              backgroundColor: isActive ? 'var(--color-primary-600)' : 'var(--color-primary-100)',
                              color: isActive ? 'white' : 'var(--color-primary-700)'
                            }}
                          >
                            <item.icon className="w-5 h-5" />
                          </div>
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="text-sm font-medium truncate">{item.name}</span>
                            {item.name !== 'Chat' && <InlineBadge count={getBadgeCount(item.name)} />}
                          </div>
                        </div>
                      </Link>
                    )}
                  </div>
                )
              })}
            </ScrollShadow>

            {/* Mobile Bottom Section */}
            <div
              className="flex-shrink-0 px-3 py-3"
              style={{
                borderTop: '1px solid var(--color-primary-200)',
                backgroundColor: 'var(--color-primary-50)'
              }}
            >
              <div className="flex items-center gap-2">
                {/* Chat Button */}
                <button
                  onClick={() => toggleWidget('sidebar')}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl transition-all duration-200 hover:bg-white/50 dark:hover:bg-white/10 relative"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  <HiOutlineChatBubbleLeftRight
                    className="w-5 h-5"
                    style={{ color: 'var(--color-primary-600)' }}
                  />
                  <span className="text-sm font-medium">Chat</span>
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 right-1 bg-red-500 text-white text-[10px] rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">{unreadCount > 99 ? '99+' : unreadCount}</span>
                  )}
                </button>

                {/* Settings Button */}
                <Link
                  href="/dashboard/settings"
                  onClick={() => handleLinkClick('/dashboard/settings')}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl transition-all duration-200 hover:bg-white/50 dark:hover:bg-white/10"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  <HiOutlineCog6Tooth
                    className="w-5 h-5"
                    style={{ color: pathname === '/dashboard/settings' ? 'var(--color-primary-600)' : 'var(--color-primary-500)' }}
                  />
                  <span className="text-sm font-medium">Settings</span>
                </Link>

                {/* Logout Button */}
                <button
                  onClick={() => setShowLogoutConfirm(true)}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl transition-all duration-200 hover:bg-red-50 dark:hover:bg-red-900/20"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  <HiOutlineArrowRightOnRectangle
                    className="w-5 h-5"
                    style={{ color: 'var(--color-primary-500)' }}
                  />
                  <span className="text-sm font-medium">Logout</span>
                </button>
              </div>
            </div>
          </aside>

          {/* Logout Confirmation Modal */}
          <Modal isOpen={showLogoutConfirm} onOpenChange={setShowLogoutConfirm}>
            <ModalContent>
              {(onClose) => (
                <>
                  <ModalHeader className="bg-danger-500 text-white">Confirm Logout</ModalHeader>
                  <ModalBody className="py-6">
                    <p className="text-center text-default-700">
                      Are you sure you want to logout?
                    </p>
                  </ModalBody>
                  <ModalFooter>
                    <Button variant="light" onPress={onClose}>
                      Cancel
                    </Button>
                    <Button color="danger" onPress={handleLogout}>
                      Logout
                    </Button>
                  </ModalFooter>
                </>
              )}
            </ModalContent>
          </Modal>
        </>
      )}
    </>
  )
}
