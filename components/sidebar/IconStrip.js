'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  HiOutlineChevronRight,
  HiOutlineCog6Tooth,
  HiOutlineArrowRightOnRectangle,
} from 'react-icons/hi2'
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { getMenuItemsForRole } from '@/utils/roleBasedMenus'
import { useUnreadMessages } from '@/contexts/UnreadMessagesContext'
import { useChatWidget } from '@/contexts/ChatWidgetContext'
import { usePageTransition } from '@/contexts/PageTransitionContext'
import UnreadBadge from '@/components/UnreadBadge'
import { Chip, Tooltip } from '@heroui/react'

// Badge component for sidebar counts
function SidebarBadge({ count }) {
  if (!count || count <= 0) return null
  return (
    <Chip size="sm" color="danger" variant="flat" className="absolute -top-3 -right-3 min-w-4 h-4 text-[9px] z-10 px-1">
      {count > 99 ? '99+' : count}
    </Chip>
  )
}

export default function IconStrip({ onExpandClick, sidebarCounts = {} }) {
  const pathname = usePathname()
  const [user, setUser] = useState(null)
  const [mounted, setMounted] = useState(false)
  const [isDepartmentHead, setIsDepartmentHead] = useState(false)
  const { unreadCount } = useUnreadMessages()
  const { toggleWidget } = useChatWidget()
  const { startNavigation } = usePageTransition()
  const [tooltipContent, setTooltipContent] = useState(null)
  const tooltipY = useRef(0)
  const tooltipRef = useRef(null)
  const menuContainerRef = useRef(null)

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
        icon: require('react-icons/hi2').HiOutlineUsers,
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

  const handleLinkClick = (path) => {
    if (path && path !== pathname) {
      startNavigation(path)
    }
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
        return (sidebarCounts.projects || 0) + (sidebarCounts.tasks || 0)
      case 'Attendance & Leaves':
        return (sidebarCounts.leaves || 0) + (sidebarCounts.attendance || 0)
      case 'Expenses':
        return sidebarCounts.expenses || 0
      case 'Helpdesk':
        return sidebarCounts.helpdesk || 0
      case 'Notifications':
        return sidebarCounts.notifications || 0
      default:
        return 0
    }
  }

  if (!mounted) {
    return null
  }

  return (
    <>
      {/* Icon Strip - Always visible on desktop */}
      <aside
        className="hidden lg:flex fixed inset-y-0 left-0 z-[8] flex-col h-screen w-[4.5rem] shadow-[0_4px_16px_rgba(15,23,42,0.08)]"
        style={{
          backgroundColor: 'var(--color-bg-sidebar)'
        }}
      >
        {/* Logo + Expand Button Section */}
        <div
          className="h-[60.5px] flex items-center justify-between px-2 flex-shrink-0"
        >
          <img
            src="/assets/lanyard-card-logo.webp"
            alt="Talio"
            className="h-10 w-auto object-contain"
          />
          <Tooltip content="Expand Menu" placement="right" delay={200} closeDelay={0}>
            <button
              onClick={() => onExpandClick(null)}
              className="p-1.5 rounded-lg transition-colors hover:bg-gray-100"
              title="Expand sidebar"
            >
              <HiOutlineChevronRight className="w-4 h-4 text-gray-600" />
            </button>
          </Tooltip>
        </div>

        {/* Menu Icons */}
        <div ref={menuContainerRef} className="flex-1 overflow-y-auto scrollbar-hide py-4 px-2 space-y-2">
          {menuItems.map((item, index) => {
            const isActive = isMenuItemActive(item)
            const badgeCount = getBadgeCount(item.name)

            // Special handling for Chat on desktop - opens widget instead of navigating
            if (item.name === 'Chat') {
              return (
                <Tooltip
                  key={item.name}
                  content={item.name}
                  placement="right"
                  delay={200}
                  closeDelay={0}
                >
                  <button
                    onClick={() => toggleWidget('sidebar')}
                    className={`w-full flex items-center justify-center p-2.5 rounded-xl transition-all duration-200 group relative hover:bg-gray-800`}
                    style={{
                      backgroundColor: 'var(--color-primary-100)',
                    }}
                  >
                    <div className="relative">
                      <item.icon className="w-6 h-6 group-hover:text-white" style={{ color: 'var(--color-primary-600)' }} />
                      {unreadCount > 0 && <UnreadBadge count={unreadCount} />}
                    </div>
                  </button>
                </Tooltip>
              )
            }

            // For items with submenu, clicking expands the sliding sidebar
            if (item.submenu) {
              return (
                <Tooltip
                  key={item.name}
                  content={item.name}
                  placement="right"
                  delay={200}
                  closeDelay={0}
                >
                  <button
                    onClick={() => onExpandClick(item.name, index)}
                    className={`w-full flex items-center justify-center p-2.5 rounded-xl transition-all duration-200 group relative hover:bg-gray-800`}
                    style={{
                      backgroundColor: isActive ? 'var(--color-primary-500)' : 'var(--color-primary-100)',
                    }}
                  >
                    <div className="relative">
                      <item.icon
                        className="w-6 h-6 group-hover:text-white"
                        style={{ color: isActive ? 'white' : 'var(--color-primary-600)' }}
                      />
                      <SidebarBadge count={badgeCount} />
                    </div>
                  </button>
                </Tooltip>
              )
            }

            // Regular menu items - navigate directly
            return (
              <Tooltip
                key={item.name}
                content={item.name}
                placement="right"
                delay={200}
                closeDelay={0}
              >
                <Link
                  href={item.path}
                  onClick={() => handleLinkClick(item.path)}
                  className={`w-full flex items-center justify-center p-2.5 rounded-xl transition-all duration-200 group relative hover:bg-gray-800`}
                  style={{
                    backgroundColor: isActive ? 'var(--color-primary-500)' : 'var(--color-primary-100)',
                  }}
                >
                  <div className="relative">
                    <item.icon
                      className="w-6 h-6 group-hover:text-white"
                      style={{ color: isActive ? 'white' : 'var(--color-primary-600)' }}
                    />
                    <SidebarBadge count={badgeCount} />
                  </div>
                </Link>
              </Tooltip>
            )
          })}
        </div>


      </aside>

      {/* Tooltip for hover state */}
      {tooltipContent && (
        <div
          ref={tooltipRef}
          className="fixed left-[4.5rem] ml-2 px-2 py-1 bg-default-900 text-white text-xs rounded pointer-events-none whitespace-nowrap z-[100] shadow-lg"
          style={{ top: tooltipY.current, transform: 'translateY(-50%)' }}
        >
          {tooltipContent}
          <div className="absolute top-1/2 -left-1 -translate-y-1/2 border-4 border-transparent border-r-default-900"></div>
        </div>
      )}
    </>
  )
}
