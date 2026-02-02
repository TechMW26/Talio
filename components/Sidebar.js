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
import { useUnreadMessages } from '@/contexts/UnreadMessagesContext'
import { useChatWidget } from '@/contexts/ChatWidgetContext'
import { usePageTransition } from '@/contexts/PageTransitionContext'
import UnreadBadge from './UnreadBadge'
import { Button, Chip, ScrollShadow, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Tooltip } from '@heroui/react'

import ModalPortal from '@/components/ui/ModalPortal'

// Badge component for sidebar counts - positioned on top-right corner of the icon box
function SidebarBadge({ count }) {
  if (!count || count <= 0) return null
  return (
    <Chip size="sm" color="danger" variant="flat" className="absolute -top-4 -right-4 min-w-5 h-5 text-[10px] z-10">
      {count > 99 ? '99+' : count}
    </Chip>
  )
}

// Inline badge component for expanded menu items
function InlineBadge({ count }) {
  if (!count || count <= 0) return null
  return (
    <Chip size="sm" color="danger" variant="flat" className="min-w-5 h-5 text-[10px]">
      {count > 99 ? '99+' : count}
    </Chip>
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
  const [tooltipContent, setTooltipContent] = useState(null)
  const tooltipY = useRef(0)
  const tooltipRef = useRef(null)

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

  // Auto-collapse timer ref
  const autoCollapseTimerRef = useRef(null)
  const sidebarRef = useRef(null)

  // Clear the auto-collapse timer
  const clearAutoCollapseTimer = useCallback(() => {
    if (autoCollapseTimerRef.current) {
      clearTimeout(autoCollapseTimerRef.current)
      autoCollapseTimerRef.current = null
    }
  }, [])

  // Start the auto-collapse timer (2 seconds)
  const startAutoCollapseTimer = useCallback(() => {
    // Only auto-collapse on desktop when sidebar is expanded
    if (!isDesktop || isCollapsed) return

    clearAutoCollapseTimer()
    autoCollapseTimerRef.current = setTimeout(() => {
      setIsCollapsed(true)
    }, 2000)
  }, [isDesktop, isCollapsed, setIsCollapsed, clearAutoCollapseTimer])

  // Handle mouse enter on sidebar - cancel auto-collapse
  const handleSidebarMouseEnter = useCallback(() => {
    clearAutoCollapseTimer()
  }, [clearAutoCollapseTimer])

  // Handle mouse leave from sidebar - start auto-collapse timer
  const handleSidebarMouseLeave = useCallback(() => {
    startAutoCollapseTimer()
  }, [startAutoCollapseTimer])

  // Auto-collapse when clicking outside sidebar (on desktop)
  useEffect(() => {
    if (!isDesktop) return

    const handleClickOutside = (event) => {
      if (sidebarRef.current && !sidebarRef.current.contains(event.target) && !isCollapsed) {
        startAutoCollapseTimer()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      clearAutoCollapseTimer()
    }
  }, [isDesktop, isCollapsed, startAutoCollapseTimer, clearAutoCollapseTimer])

  // Clean up timer on unmount
  useEffect(() => {
    return () => clearAutoCollapseTimer()
  }, [clearAutoCollapseTimer])

  // Check if desktop/tablet (matches Tailwind md: breakpoint at 768px)
  useEffect(() => {
    const checkDesktop = () => {
      setIsDesktop(window.innerWidth >= 768)
    }
    checkDesktop()
    window.addEventListener('resize', checkDesktop)
    return () => window.removeEventListener('resize', checkDesktop)
  }, [])

  // Collapse all submenus when sidebar is collapsed
  useEffect(() => {
    if (isCollapsed) {
      setExpandedMenus({})
    }
  }, [isCollapsed])

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
  // NOTE: MIRA AI Assistant has been removed from web - only available in desktop apps
  const menuItems = useMemo(() => {
    if (!user) return []

    // If user is detected as department head, use department_head menu
    const effectiveRole = isDepartmentHead ? 'department_head' : user.role
    let baseMenuItems = getMenuItemsForRole(effectiveRole)

    // Add Team menu item if user is a department head
    if (isDepartmentHead) {
      // Insert Team menu after Dashboard - includes Performance options
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

      // Override Attendance & Leaves menu for department heads with Team Attendance and Regularisation
      const attendanceMenuIndex = baseMenuItems.findIndex(item => item.name === 'Attendance & Leaves')
      if (attendanceMenuIndex !== -1) {
        baseMenuItems = [...baseMenuItems]
        baseMenuItems[attendanceMenuIndex] = {
          ...baseMenuItems[attendanceMenuIndex],
          submenu: [
            { name: 'My Attendance', path: '/dashboard/attendance' },
            { name: 'Team Attendance', path: '/dashboard/attendance/team' },
            { name: 'Attendance Regularisation', path: '/dashboard/team/regularisation' },
            { name: 'Apply Leave', path: '/dashboard/leave/apply' },
            { name: 'My Leave Balance', path: '/dashboard/leave/balance' },
            { name: 'My Leave Requests', path: '/dashboard/leave/requests' },
            { name: 'Leave Approvals', path: '/dashboard/leave/approvals' },
          ]
        }
      }

      return [
        baseMenuItems[0], // Dashboard
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
    // Close mobile sidebar when link is clicked
    setIsOpen(false)
    // Show page transition loading if navigating to a different page
    if (path && path !== pathname) {
      startNavigation(path)
    }
  }

  const handleLogout = () => {
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
      case 'Approvals': // Expense approvals
        return sidebarCounts.expenses
      default:
        return 0
    }
  }

  // Don't render until mounted to avoid hydration mismatch
  if (!mounted) {
    return null
  }

  return (
    <>
      {/* Mobile overlay with tinted background - smooth fade animation */}
      {isOpen && (
        <div
          className="fixed inset-0 z-[60] md:!hidden animate-fade-in bg-black/60"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar - smooth slide animation */}
      <aside
        ref={sidebarRef}
        onMouseEnter={handleSidebarMouseEnter}
        onMouseLeave={handleSidebarMouseLeave}
        className={`
          fixed lg:static inset-y-0 left-0 z-[60] lg:z-[7]
          text-gray-800
          flex flex-col lg:h-full h-screen shadow-lg
          ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          w-full lg:w-[17rem]
          ${isDesktop && isCollapsed ? 'lg:!w-[4.5rem]' : ''}
          transition-transform duration-300 ease-in-out lg:transition-[width] lg:duration-300
        `}
        style={{
          backgroundColor: 'var(--color-bg-sidebar)',
        }}
      >
        {/* Sticky Logo Section - Height matched with header */}
        <div className="h-[60.5px] lg:h-[60.5px] px-3 sm:px-4 flex-shrink-0 flex items-center" style={{ borderBottom: '1px solid var(--color-primary-200)' }}>
          <div className={`flex items-center w-full ${isDesktop && isCollapsed ? 'justify-between px-1' : 'justify-between px-3 sm:px-4'}`}>
            {/* Logo - show favicon icon when collapsed, full logo when expanded */}
            {isDesktop && isCollapsed ? (
              <>
                <img
                  src="/assets/lanyard-card-logo.webp"
                  alt="Talio"
                  className="h-10 w-auto object-contain"
                />
                <button
                  onClick={() => setIsCollapsed(false)}
                  className="p-1 rounded-lg transition-colors mr-[-4px]"
                  title="Expand sidebar"
                >
                  <HiOutlineChevronRight className="w-5 h-5 text-gray-600" />
                </button>
              </>
            ) : (
              <>
                <img
                  src="/assets/logo.png"
                  alt="Talio Logo"
                  className="h-10 w-auto object-contain"
                />
                {/* Desktop collapse button */}
                <button
                  onClick={() => setIsCollapsed(true)}
                  className="hidden lg:block p-2 rounded-lg transition-colors"
                  title="Collapse sidebar"
                >
                  <HiOutlineChevronRight className="w-4 h-4 text-gray-600 rotate-180" />
                </button>
                {/* Mobile close button */}
                <button
                  onClick={() => setIsOpen(false)}
                  className="md:!hidden hover:opacity-70 focus:outline-none"
                  style={{ color: '#374151' }}
                >
                  <HiOutlineXMark className="w-5 h-5" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Scrollable Menu Section */}
        <ScrollShadow className={`pt-4 pb-8 flex-1 scrollbar-hide ${isDesktop && isCollapsed ? 'px-2 space-y-3' : 'px-3 sm:px-4 space-y-2'}`}>
          {menuItems.map((item) => {
            const isActive = isMenuItemActive(item)
            return (
              <div key={item.name} className="w-full">
                {item.submenu ? (
                  <div className="w-full">
                    <button
                      type="button"
                      onClick={() => {
                        if (isDesktop && isCollapsed) {
                          setIsCollapsed(false)
                          setTimeout(() => toggleSubmenu(item.name), 100)
                        } else {
                          toggleSubmenu(item.name)
                        }
                      }}
                      onMouseEnter={(e) => {
                        if (isDesktop && isCollapsed) {
                          tooltipY.current = e.clientY
                          setTooltipContent(item.name)
                        }
                      }}
                      onMouseMove={(e) => {
                        if (isDesktop && isCollapsed) {
                          tooltipY.current = e.clientY
                          if (tooltipRef.current) {
                            tooltipRef.current.style.top = `${e.clientY}px`
                          }
                        }
                      }}
                      onMouseLeave={() => setTooltipContent(null)}
                      className={`w-full flex items-center text-left rounded-xl transition-all duration-200 group relative ${isDesktop && isCollapsed ? 'justify-center p-2.5 bg-[var(--color-primary-100)] hover:!bg-gray-800' : 'justify-between px-3 sm:px-4 py-3'}`}
                      style={{
                        backgroundColor: isDesktop && isCollapsed
                          ? (isActive ? 'var(--color-primary-500)' : undefined)
                          : (expandedMenus[item.name] ? 'var(--color-bg-hover)' : 'transparent'),
                        color: '#111827'
                      }}
                    >
                      <div className={`flex items-center ${isDesktop && isCollapsed ? '' : 'gap-3 flex-1'}`}>
                        <div
                          className={`transition-colors relative flex-shrink-0 ${isDesktop && isCollapsed ? '' : 'p-2 rounded-lg'}`}
                          style={{
                            backgroundColor: isDesktop && isCollapsed ? 'transparent' : (expandedMenus[item.name] ? 'var(--color-primary-500)' : 'var(--color-primary-100)'),
                            color: isDesktop && isCollapsed
                              ? (isActive ? 'white' : 'var(--color-primary-600)')
                              : (expandedMenus[item.name] ? 'white' : 'var(--color-primary-700)')
                          }}
                        >
                          <item.icon className={isDesktop && isCollapsed ? 'w-6 h-6 group-hover:text-white' : 'w-5 h-5'} />
                          {/* Only show badge on icon when collapsed */}
                          {(isDesktop && isCollapsed) && <SidebarBadge count={getBadgeCount(item.name)} />}
                        </div>
                        {!(isDesktop && isCollapsed) && (
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
                        )}
                      </div>
                      {!(isDesktop && isCollapsed) && (
                        <div className={`transition-transform duration-200 flex-shrink-0 ${expandedMenus[item.name] ? 'rotate-90' : ''}`}>
                          <HiOutlineChevronRight className="w-4 h-4" />
                        </div>
                      )}
                    </button>
                    {expandedMenus[item.name] && !(isDesktop && isCollapsed) && (
                      <div className="mt-2 space-y-1 ml-8 pl-3" style={{ borderLeft: '2px solid var(--color-primary-200)' }}>
                        {item.submenu.map((subItem) => (
                          <Link
                            key={subItem.path}
                            href={subItem.path}
                            onClick={() => handleLinkClick(subItem.path)}
                            className="w-full text-left flex items-center justify-between px-3 py-2 text-sm rounded-lg transition-all duration-200 cursor-pointer"
                            style={{
                              backgroundColor: pathname === subItem.path ? 'var(--color-primary-500)' : 'transparent',
                              color: pathname === subItem.path ? 'white' : '#6B7280'
                            }}
                          >
                            <span>{subItem.name}</span>
                            <InlineBadge count={getSubmenuBadgeCount(subItem.name)} />
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                ) : item.name === 'Chat' && isDesktop ? (
                  // Desktop: Open floating chat widget instead of navigating
                  <button
                    onClick={() => {
                      toggleWidget('sidebar')
                      handleLinkClick(null) // null path - no navigation needed
                    }}
                    onMouseEnter={(e) => {
                      if (isDesktop && isCollapsed) {
                        tooltipY.current = e.clientY
                        setTooltipContent(item.name)
                      }
                    }}
                    onMouseMove={(e) => {
                      if (isDesktop && isCollapsed) {
                        tooltipY.current = e.clientY
                        if (tooltipRef.current) {
                          tooltipRef.current.style.top = `${e.clientY}px`
                        }
                      }
                    }}
                    onMouseLeave={() => setTooltipContent(null)}
                    className={`w-full flex items-center text-left rounded-xl transition-all duration-200 group cursor-pointer relative ${isDesktop && isCollapsed ? 'justify-center p-2.5 bg-[var(--color-primary-100)] hover:!bg-gray-800' : 'px-3 sm:px-4 py-3'}`}
                    style={{
                      backgroundColor: isDesktop && isCollapsed ? undefined : 'transparent',
                      color: '#111827'
                    }}
                  >
                    <div className={`flex items-center ${isDesktop && isCollapsed ? '' : 'gap-3 flex-1'}`}>
                      <div
                        className={`transition-colors relative flex-shrink-0 ${isDesktop && isCollapsed ? '' : 'p-2 rounded-lg'}`}
                        style={{
                          backgroundColor: isDesktop && isCollapsed ? 'transparent' : 'var(--color-primary-100)',
                          color: 'var(--color-primary-600)'
                        }}
                      >
                        <item.icon className={isDesktop && isCollapsed ? 'w-6 h-6 group-hover:text-white' : 'w-5 h-5'} />
                        {unreadCount > 0 && (
                          <UnreadBadge count={unreadCount} />
                        )}
                      </div>
                      {!(isDesktop && isCollapsed) && (
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="text-sm font-medium truncate">{item.name}</span>
                        </div>
                      )}
                    </div>
                  </button>
                ) : (
                  <Link
                    href={item.path}
                    onClick={() => handleLinkClick(item.path)}
                    onMouseEnter={(e) => {
                      if (isDesktop && isCollapsed) {
                        tooltipY.current = e.clientY
                        setTooltipContent(item.name)
                      }
                    }}
                    onMouseMove={(e) => {
                      if (isDesktop && isCollapsed) {
                        tooltipY.current = e.clientY
                        if (tooltipRef.current) {
                          tooltipRef.current.style.top = `${e.clientY}px`
                        }
                      }
                    }}
                    onMouseLeave={() => setTooltipContent(null)}
                    className={`w-full flex items-center text-left rounded-xl transition-all duration-200 group cursor-pointer relative ${isDesktop && isCollapsed ? 'justify-center p-2.5 bg-[var(--color-primary-100)] hover:!bg-gray-800' : 'px-3 sm:px-4 py-3'}`}
                    style={{
                      backgroundColor: isDesktop && isCollapsed
                        ? (isActive ? 'var(--color-primary-500)' : undefined)
                        : (isActive ? 'var(--color-primary-500)' : 'transparent'),
                      color: isActive ? 'white' : '#111827'
                    }}
                  >
                    <div className={`flex items-center ${isDesktop && isCollapsed ? '' : 'gap-3 flex-1'}`}>
                      <div
                        className={`transition-colors relative flex-shrink-0 ${isDesktop && isCollapsed ? '' : 'p-2 rounded-lg'}`}
                        style={{
                          backgroundColor: isDesktop && isCollapsed ? 'transparent' : (isActive ? 'var(--color-primary-600)' : 'var(--color-primary-100)'),
                          color: isDesktop && isCollapsed
                            ? (isActive ? 'white' : 'var(--color-primary-600)')
                            : (isActive ? 'white' : 'var(--color-primary-700)')
                        }}
                      >
                        <item.icon className={isDesktop && isCollapsed ? 'w-6 h-6 group-hover:text-white' : 'w-5 h-5'} />
                        {/* Chat unread badge - always on icon */}
                        {item.name === 'Chat' && unreadCount > 0 && (
                          <UnreadBadge count={unreadCount} />
                        )}
                        {/* Other badges - only on icon when collapsed */}
                        {item.name !== 'Chat' && (isDesktop && isCollapsed) && <SidebarBadge count={getBadgeCount(item.name)} />}
                      </div>
                      {!(isDesktop && isCollapsed) && (
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="text-sm font-medium truncate">{item.name}</span>
                          {item.name !== 'Chat' && <InlineBadge count={getBadgeCount(item.name)} />}
                        </div>
                      )}
                    </div>
                  </Link>
                )}
              </div>
            )
          })}
        </ScrollShadow>

        {/* Chat, Settings and Logout Section - Fixed at bottom - Mobile only */}
        {!isDesktop && (
          <div
            className="flex-shrink-0 px-3 py-3"
            style={{
              borderTop: '1px solid var(--color-primary-200)',
              backgroundColor: 'var(--color-primary-50)'
            }}
          >
            {/* Mobile: Single row with Chat, Settings, Logout */}
            <div className="flex items-center gap-2">
              {/* Chat Button */}
              <button
                onClick={() => toggleWidget('sidebar')}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl transition-all duration-200 hover:bg-white/50 relative"
                style={{ color: '#111827' }}
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
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl transition-all duration-200 hover:bg-white/50"
                style={{ color: '#111827' }}
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
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl transition-all duration-200 hover:bg-red-50"
                style={{ color: '#111827' }}
              >
                <HiOutlineArrowRightOnRectangle
                  className="w-5 h-5"
                  style={{ color: 'var(--color-primary-500)' }}
                />
                <span className="text-sm font-medium">Logout</span>
              </button>
            </div>
          </div>
        )}

        {/* Desktop: Bottom section removed - icons are in sidebar menu */}
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

      {/* Tooltip */}
      {tooltipContent && (
        <div
          ref={tooltipRef}
          className="fixed left-[4.5rem] ml-2 px-2 py-1 bg-default-900 text-white text-xs rounded pointer-events-none whitespace-nowrap z-[100] shadow-lg"
          style={{ top: tooltipY.current, transform: 'translateY(-50%)' }}
        >
          {tooltipContent}
          {/* Arrow */}
          <div className="absolute top-1/2 -left-1 -translate-y-1/2 border-4 border-transparent border-r-default-900"></div>
        </div>
      )}
    </>
  )
}

