'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  HiOutlineChevronRight,
  HiOutlineCog6Tooth,
  HiOutlineArrowRightOnRectangle,
  HiOutlineUserCircle,
  HiOutlineInformationCircle,
} from 'react-icons/hi2'
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getMenuItemsForRole, NEW_MENU_PATHS } from '@/utils/roleBasedMenus'
import { getMenuTemplateRole, getUserMenuPermissions } from '@/utils/rbacMenu'
import { filterMenuItemsByFeatures } from '@/lib/planFeatures'
import { filterMenuByPermissions } from '@/utils/permissionFilters'
import { getCurrentUser } from '@/utils/userHelper'
import { useUnreadMessages } from '@/contexts/UnreadMessagesContext'
import { useChatWidget } from '@/contexts/ChatWidgetContext'
import { usePageTransition } from '@/contexts/PageTransitionContext'
import UnreadBadge from '@/components/UnreadBadge'
import toast from '@/utils/toast'
import { Chip, Tooltip, Avatar } from '@heroui/react'

// Badge component for sidebar counts
function SidebarBadge({ count }) {
  if (!count || count <= 0) return null
  return (
    <Chip size="sm" color="danger" variant="flat" className="absolute -top-3 -right-3 min-w-4 h-4 text-[9px] z-10 px-1">
      {count > 99 ? '99+' : count}
    </Chip>
  )
}

export default function IconStrip({ onExpandClick, sidebarCounts = {}, isDepartmentHead = false, isTeamLeader = false, companyFeatures = null }) {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [mounted, setMounted] = useState(false)
  const [isDesktopApp, setIsDesktopApp] = useState(false)
  const { unreadCount } = useUnreadMessages()
  const { toggleWidget } = useChatWidget()
  const { startNavigation, isNavigating, targetPath } = usePageTransition()
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
    }

    const handleUserUpdate = (event) => {
      setUser(event?.detail || getCurrentUser())
    }

    window.addEventListener('talio:user-updated', handleUserUpdate)

    const handleStorage = (event) => {
      if (event.key === 'user') {
        setUser(getCurrentUser())
      }
    }

    window.addEventListener('storage', handleStorage)

    setIsDesktopApp(typeof window !== 'undefined' && (window.electronAPI !== undefined || window.isElectron === true))

    return () => {
      window.removeEventListener('talio:user-updated', handleUserUpdate)
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  // Get menu items based on user role (memoized)
  const menuItems = useMemo(() => {
    if (!user) return []

    const rbacPermissions = getUserMenuPermissions(user)
    const menuTemplateRole = getMenuTemplateRole(user, {
      isDepartmentHead,
      permissions: rbacPermissions,
    })
    let baseMenuItems = getMenuItemsForRole(menuTemplateRole)

    if (isDepartmentHead) {
      const teamSubmenu = [
        { name: 'Team Members', path: '/dashboard/team/members' },
        { name: 'Team Ratings', path: '/dashboard/performance/ratings' },
        { name: 'Team Goals', path: '/dashboard/performance/goals' },
        { name: 'Performance Reports', path: '/dashboard/performance/reports' },
        { name: 'Geofencing', path: '/dashboard/team/geofencing' }
      ]
      // If also a team leader, add My Teams
      if (isTeamLeader) {
        teamSubmenu.splice(1, 0, { name: 'My Teams', path: '/dashboard/team/my-teams' })
      }
      const teamMenuItem = {
        name: 'Team',
        icon: require('react-icons/hi2').HiOutlineUsers,
        path: '/dashboard/team/members',
        group: 'Main',
        submenu: teamSubmenu
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

    // Team leader (not dept head) gets a My Teams section
    if (isTeamLeader) {
      const myTeamsMenuItem = {
        name: 'My Teams',
        icon: require('react-icons/hi2').HiOutlineUsers,
        path: '/dashboard/team/my-teams',
        group: 'Main',
      }

      return [
        baseMenuItems[0],
        myTeamsMenuItem,
        ...baseMenuItems.slice(1)
      ]
    }

    return baseMenuItems
  }, [user, isDepartmentHead, isTeamLeader])

  // Filter menu items based on company feature flags
  const featureFilteredMenuItems = useMemo(() => {
    return filterMenuItemsByFeatures(menuItems, companyFeatures)
  }, [menuItems, companyFeatures])

  // Filter menu items by resolved RBAC permissions
  const filteredMenuItems = useMemo(() => {
    if (!user || !featureFilteredMenuItems.length) return featureFilteredMenuItems
    if (user.role === 'admin') return featureFilteredMenuItems
    const rbacPermissions = getUserMenuPermissions(user)
    if (!rbacPermissions) return featureFilteredMenuItems
    return filterMenuByPermissions(featureFilteredMenuItems, rbacPermissions, user.role)
  }, [featureFilteredMenuItems, user])

  const handleLinkClick = (path) => {
    if (path && path !== pathname) {
      startNavigation(path)
    }
  }

  // -------- "New menu item" session highlight --------
  // Show a green pulsing tooltip on the sidebar for items recently introduced.
  // Each path is highlighted until the user dismisses it (click) or 7 days pass,
  // whichever comes first. Persisted in localStorage so it survives reloads.
  const NEW_MENU_DISMISS_KEY = 'talio.newMenuDismissed.v2'
  const NEW_MENU_FIRST_SEEN_KEY = 'talio.newMenuFirstSeen.v2'
  const NEW_MENU_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
  const [openNewPaths, setOpenNewPaths] = useState(() => new Set())

  const readJsonMap = useCallback((key) => {
    if (typeof window === 'undefined') return {}
    try {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  }, [])

  const writeJsonMap = useCallback((key, obj) => {
    if (typeof window === 'undefined') return
    try { localStorage.setItem(key, JSON.stringify(obj)) } catch {}
  }, [])

  // Compute which new items to highlight on mount / role changes.
  useEffect(() => {
    if (!mounted) return
    const now = Date.now()
    const dismissed = readJsonMap(NEW_MENU_DISMISS_KEY) // { path: timestamp }
    const firstSeen = readJsonMap(NEW_MENU_FIRST_SEEN_KEY) // { path: timestamp }
    let firstSeenDirty = false
    const pending = new Set()

    filteredMenuItems.forEach(item => {
      if (!item.isNew || !item.path) return
      if (dismissed[item.path]) return
      if (!firstSeen[item.path]) {
        firstSeen[item.path] = now
        firstSeenDirty = true
      }
      if (now - firstSeen[item.path] <= NEW_MENU_MAX_AGE_MS) {
        pending.add(item.path)
      }
    })

    if (firstSeenDirty) writeJsonMap(NEW_MENU_FIRST_SEEN_KEY, firstSeen)
    if (pending.size === 0) return
    setOpenNewPaths(pending)

    // Auto-hide the pulsing tooltip after 8s per page-load (but keep NEW badge
    // visible in the expanded sidebar until dismissed or 7 days elapse).
    const timer = setTimeout(() => {
      setOpenNewPaths(new Set())
    }, 8000)
    return () => clearTimeout(timer)
  }, [mounted, filteredMenuItems, readJsonMap, writeJsonMap])

  const dismissNewTooltip = useCallback((path) => {
    if (!path) return
    setOpenNewPaths(prev => {
      if (!prev.has(path)) return prev
      const next = new Set(prev)
      next.delete(path)
      return next
    })
    const dismissed = readJsonMap(NEW_MENU_DISMISS_KEY)
    dismissed[path] = Date.now()
    writeJsonMap(NEW_MENU_DISMISS_KEY, dismissed)
  }, [readJsonMap, writeJsonMap])

  // Helper to check if a menu item is active (optimistic highlight during navigation)
  const effectivePath = (isNavigating && targetPath) ? targetPath : pathname
  const isMenuItemActive = (item) => {
    if (item.path === effectivePath) return true
    if (item.submenu) {
      return item.submenu.some(subItem => subItem.path === effectivePath)
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

  const getUserInitials = () => {
    const firstName = user?.firstName || ''
    const lastName = user?.lastName || ''
    if (firstName || lastName) {
      return `${firstName[0] || ''}${lastName[0] || ''}`.toUpperCase()
    }
    return user?.email?.[0]?.toUpperCase() || 'U'
  }

  const handleLogout = () => {
    const token = localStorage.getItem('token')
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      }).catch(() => { })
    }
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    localStorage.removeItem('userId')
    document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
    toast.success('Logged out successfully')
    router.push('/login')
  }

  return (
    <>
      {/* Icon Strip - Always visible on desktop */}
      <aside
        data-vt-sidebar
        className="hidden lg:flex fixed inset-y-0 left-0 z-[8] flex-col h-screen w-[4.5rem] shadow-[0_4px_16px_rgba(15,23,42,0.08)]"
        style={{
          backgroundColor: 'var(--color-bg-sidebar)'
        }}
      >
        {/* Logo Section */}
        <div className="flex flex-col items-center pt-3 pb-1 flex-shrink-0">
          <img
            src="/assets/lanyard-card-logo.webp"
            alt="Talio"
            className="h-9 w-auto object-contain"
          />
        </div>

        {/* Menu Icons */}
        <div ref={menuContainerRef} className="flex-1 overflow-y-auto scrollbar-hide py-4 px-2 space-y-1">
          {/* Expand sidebar - styled like a menu item */}
          <Tooltip content="Expand Menu" placement="right" delay={200} closeDelay={0}>
            <button
              onClick={() => onExpandClick(null)}
              className="w-full flex items-center justify-center p-2.5 rounded-xl transition-all duration-200 hover:bg-black/10 dark:hover:bg-white/10"
              style={{ backgroundColor: 'var(--color-primary-100)' }}
            >
              <HiOutlineChevronRight className="w-6 h-6" style={{ color: 'var(--color-primary-600)' }} />
            </button>
          </Tooltip>

          {/* Profile avatar */}
          <Tooltip content={user?.firstName ? `${user.firstName} ${user.lastName || ''}` : 'Profile'} placement="right" delay={200} closeDelay={0}>
            <Link
              href="/dashboard/profile"
              onClick={() => handleLinkClick('/dashboard/profile')}
              className="w-full flex items-center justify-center p-1.5 rounded-xl transition-all duration-200 group hover:bg-black/10 dark:hover:bg-white/10"
              style={{
                backgroundColor: effectivePath === '/dashboard/profile' ? 'var(--color-primary-500)' : 'transparent',
              }}
            >
              <Avatar
                size="sm"
                src={user?.profilePicture || (typeof user?.employeeId === 'object' ? user?.employeeId?.profilePicture : null) || undefined}
                name={getUserInitials()}
                className="w-8 h-8 text-xs"
                style={{
                  backgroundColor: effectivePath === '/dashboard/profile' ? 'white' : 'var(--color-primary-500)',
                  color: effectivePath === '/dashboard/profile' ? 'var(--color-primary-500)' : 'white',
                }}
              />
            </Link>
          </Tooltip>

          <div className="my-2 mx-2 border-t" style={{ borderColor: 'var(--color-primary-200)' }} />

          {filteredMenuItems.map((item, index) => {
            const isActive = isMenuItemActive(item)
            const badgeCount = getBadgeCount(item.name)
            const showGroupDivider = item.group && index > 0 && filteredMenuItems[index - 1]?.group !== item.group
            const isNewHighlighted = item.isNew && openNewPaths.has(item.path)
            const newRingClass = isNewHighlighted
              ? 'ring-2 ring-success-400 ring-offset-1 ring-offset-transparent animate-pulse'
              : ''

            let iconButton

            // Special handling for Chat on desktop - opens widget instead of navigating
            if (item.name === 'Chat') {
              iconButton = (
                <Tooltip
                  content={item.name}
                  placement="right"
                  delay={200}
                  closeDelay={0}
                >
                  <button
                    onClick={() => toggleWidget('sidebar')}
                    className={`w-full flex items-center justify-center p-2.5 rounded-xl transition-all duration-200 group relative hover:bg-black/10 dark:hover:bg-white/10`}
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
            } else if (item.submenu) {
              // For items with submenu, clicking expands the sliding sidebar
              iconButton = (
                <Tooltip
                  content={isNewHighlighted ? `New · ${item.name}` : item.name}
                  placement="right"
                  delay={200}
                  closeDelay={0}
                  color={isNewHighlighted ? 'success' : 'default'}
                  isOpen={isNewHighlighted ? true : undefined}
                  classNames={isNewHighlighted ? {
                    content: 'bg-success-500 text-white font-semibold shadow-lg shadow-success-500/40',
                  } : undefined}
                >
                  <button
                    onClick={() => {
                      if (isNewHighlighted) dismissNewTooltip(item.path)
                      onExpandClick(item.name, index)
                    }}
                    className={`w-full flex items-center justify-center p-2.5 rounded-xl transition-all duration-200 group relative hover:bg-black/10 dark:hover:bg-white/10 ${newRingClass}`}
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
                      {isNewHighlighted && (
                        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-success-500 ring-2 ring-white dark:ring-black animate-pulse" />
                      )}
                    </div>
                  </button>
                </Tooltip>
              )
            } else {
              // Regular menu items - navigate directly
              iconButton = (
                <Tooltip
                  content={isNewHighlighted ? `New · ${item.name}` : item.name}
                  placement="right"
                  delay={200}
                  closeDelay={0}
                  color={isNewHighlighted ? 'success' : 'default'}
                  isOpen={isNewHighlighted ? true : undefined}
                  classNames={isNewHighlighted ? {
                    content: 'bg-success-500 text-white font-semibold shadow-lg shadow-success-500/40',
                  } : undefined}
                >
                  <Link
                    href={item.path}
                    onClick={() => {
                      if (isNewHighlighted) dismissNewTooltip(item.path)
                      handleLinkClick(item.path)
                    }}
                    className={`w-full flex items-center justify-center p-2.5 rounded-xl transition-all duration-200 group relative hover:bg-black/10 dark:hover:bg-white/10 ${newRingClass}`}
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
                      {isNewHighlighted && (
                        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-success-500 ring-2 ring-white dark:ring-black animate-pulse" />
                      )}
                    </div>
                  </Link>
                </Tooltip>
              )
            }

            return (
              <div key={item.name}>
                {showGroupDivider && (
                  <div className="my-2 mx-2 border-t" style={{ borderColor: 'var(--color-primary-200)' }} />
                )}
                {iconButton}
              </div>
            )
          })}

          {/* Divider + Settings / Logout - bottom of menu */}
          <div className="my-2 mx-2 border-t" style={{ borderColor: 'var(--color-primary-200)' }} />

          <Tooltip content="Settings" placement="right" delay={200} closeDelay={0}>
            <Link
              href="/dashboard/settings"
              onClick={() => handleLinkClick('/dashboard/settings')}
              className="w-full flex items-center justify-center p-2.5 rounded-xl transition-all duration-200 group hover:bg-black/10 dark:hover:bg-white/10"
              style={{
                backgroundColor: effectivePath === '/dashboard/settings' ? 'var(--color-primary-500)' : 'color-mix(in srgb, var(--color-primary-100) 60%, transparent)',
              }}
            >
              <HiOutlineCog6Tooth
                className="w-5 h-5 group-hover:text-white transition-colors"
                style={{ color: effectivePath === '/dashboard/settings' ? 'white' : 'var(--color-primary-600)' }}
              />
            </Link>
          </Tooltip>

          {isDesktopApp && (
            <Tooltip content="App Info" placement="right" delay={200} closeDelay={0}>
              <Link
                href="/dashboard/app-info"
                onClick={() => handleLinkClick('/dashboard/app-info')}
                className="w-full flex items-center justify-center p-2.5 rounded-xl transition-all duration-200 group hover:bg-black/10 dark:hover:bg-white/10"
                style={{
                  backgroundColor: effectivePath === '/dashboard/app-info' ? 'var(--color-primary-500)' : 'color-mix(in srgb, var(--color-primary-100) 60%, transparent)',
                }}
              >
                <HiOutlineInformationCircle
                  className="w-5 h-5 group-hover:text-white transition-colors"
                  style={{ color: effectivePath === '/dashboard/app-info' ? 'white' : 'var(--color-primary-600)' }}
                />
              </Link>
            </Tooltip>
          )}

          <Tooltip content="Logout" placement="right" delay={200} closeDelay={0}>
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center p-2.5 rounded-xl transition-all duration-200 group hover:bg-danger-100 dark:hover:bg-danger-900/30"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-primary-100) 60%, transparent)',
              }}
            >
              <HiOutlineArrowRightOnRectangle className="w-5 h-5 text-danger-500 group-hover:text-danger-600 transition-colors" />
            </button>
          </Tooltip>
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
