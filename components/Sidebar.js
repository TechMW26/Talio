'use client'

import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  HiOutlineChevronRight,
  HiOutlineXMark,
  HiOutlineUsers,
  HiOutlineComputerDesktop,
  HiOutlineMagnifyingGlass,
} from 'react-icons/hi2'
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { getMenuItemsForRole } from '@/utils/roleBasedMenus'
import { getMenuTemplateRole, getUserMenuPermissions } from '@/utils/rbacMenu'
import { filterMenuItemsByFeatures } from '@/lib/planFeatures'
import { filterMenuByPermissions } from '@/utils/permissionFilters'
import {
  buildNavigationSections,
  filterNavigationSections,
  getNavigationBadgeCount,
  isNavigationPathActive,
  SIDEBAR_ACTION_ICONS,
} from '@/utils/menuInformationArchitecture'
import toast from '@/utils/toast'
import { handleSessionExpired, getCurrentUser } from '@/utils/userHelper'
import { useUnreadMessages } from '@/contexts/UnreadMessagesContext'
import { useChatWidget } from '@/contexts/ChatWidgetContext'
import { usePageTransition } from '@/contexts/PageTransitionContext'
import { useSocket } from '@/contexts/SocketContext'
import { useCompanyFeatures } from '@/contexts/CompanyFeaturesContext'
import UnreadBadge from './UnreadBadge'
import SidebarSubmenu from './sidebar/SidebarSubmenu'
import { Button, ScrollShadow, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react'

import IconStrip from './sidebar/IconStrip'
import SlidingSidebar from './sidebar/SlidingSidebar'

// Inline badge component for expanded menu items
function InlineBadge({ count }) {
  if (!count || count <= 0) return null
  return (
    <span className="talio-sidebar-badge talio-sidebar-badge--danger">
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
  const [isTeamLeader, setIsTeamLeader] = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [isDesktop, setIsDesktop] = useState(false)
  const [menuQuery, setMenuQuery] = useState('')
  const { unreadCount } = useUnreadMessages()
  const { toggleWidget } = useChatWidget()
  const { startNavigation, isNavigating, targetPath } = usePageTransition()
  const { subscribe, isConnected } = useSocket()
  const { features: companyFeatures } = useCompanyFeatures()
  const sidebarDebounceRef = useRef(null)
  const wasConnectedRef = useRef(null) // null = never connected yet

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

    const handleUserUpdate = (event) => {
      setUser(event?.detail || getCurrentUser())
    }

    window.addEventListener('talio:user-updated', handleUserUpdate)

    return () => {
      window.removeEventListener('talio:user-updated', handleUserUpdate)
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
      if (data.success && data.isTeamLeader) {
        setIsTeamLeader(true)
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

  // Debounced sidebar fetch - prevents rapid-fire API calls
  const debouncedFetchSidebarCounts = useCallback(() => {
    if (sidebarDebounceRef.current) clearTimeout(sidebarDebounceRef.current)
    sidebarDebounceRef.current = setTimeout(() => {
      fetchSidebarCounts()
    }, 500)
  }, [fetchSidebarCounts])

  // Fetch counts on mount and listen for real-time updates (pure event-driven, zero polling)
  useEffect(() => {
    if (mounted && user) {
      fetchSidebarCounts()

      // Listen for server-pushed sidebar count updates instead of polling
      const unsubscribe = subscribe('sidebar.counts.updated', (data) => {
        console.log('[Sidebar] Received sidebar.counts.updated event')
        debouncedFetchSidebarCounts()
      })

      return () => {
        if (unsubscribe) unsubscribe()
        if (sidebarDebounceRef.current) clearTimeout(sidebarDebounceRef.current)
      }
    }
  }, [mounted, user, fetchSidebarCounts, subscribe, debouncedFetchSidebarCounts])

  // Re-fetch on socket reconnect to catch any events missed during disconnect
  // null→true (first connect): skip (mount useEffect already fetches)
  // true→false (disconnect): no-op
  // false→true (reconnect): re-fetch to sync missed events
  useEffect(() => {
    if (mounted && user && isConnected && wasConnectedRef.current === false) {
      console.log('[Sidebar] Socket reconnected - syncing sidebar counts')
      fetchSidebarCounts()
    }
    wasConnectedRef.current = isConnected
  }, [isConnected, mounted, user, fetchSidebarCounts])

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
        icon: HiOutlineUsers,
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

    // Team leader (not dept head) gets full team monitoring menu
    if (isTeamLeader) {
      const teamSubmenu = [
        { name: 'My Teams', path: '/dashboard/team/my-teams' },
        { name: 'Team Members', path: '/dashboard/team/members' },
        { name: 'Team Ratings', path: '/dashboard/performance/ratings' },
        { name: 'Team Goals', path: '/dashboard/performance/goals' },
        { name: 'Performance Reports', path: '/dashboard/performance/reports' },
      ]
      const teamMenuItem = {
        name: 'Team',
        icon: HiOutlineUsers,
        path: '/dashboard/team/my-teams',
        group: 'Main',
        submenu: teamSubmenu
      }

      // Add Team Attendance + Regularisation to attendance menu
      baseMenuItems = [...baseMenuItems]
      const attendanceMenuIndex = baseMenuItems.findIndex(item => item.name === 'Attendance & Leaves')
      if (attendanceMenuIndex !== -1) {
        const currentSubmenu = baseMenuItems[attendanceMenuIndex].submenu || []
        const hasTeamAttendance = currentSubmenu.some(item => item.path === '/dashboard/attendance/team')
        if (!hasTeamAttendance) {
          const myAttendanceIndex = currentSubmenu.findIndex(item => item.path === '/dashboard/attendance')
          const newSubmenu = [...currentSubmenu]
          newSubmenu.splice(myAttendanceIndex + 1, 0,
            { name: 'Team Attendance', path: '/dashboard/attendance/team' },
            { name: 'Attendance Regularisation', path: '/dashboard/team/regularisation' }
          )
          // Add Leave Approvals if not present
          if (!newSubmenu.some(item => item.path === '/dashboard/leave/approvals')) {
            newSubmenu.push({ name: 'Leave Approvals', path: '/dashboard/leave/approvals' })
          }
          baseMenuItems[attendanceMenuIndex] = {
            ...baseMenuItems[attendanceMenuIndex],
            submenu: newSubmenu
          }
        }
      }

      // Add Productivity if not already present
      const hasProductivity = baseMenuItems.some(item => item.name === 'Productivity')
      const productivityItem = hasProductivity ? null : {
        name: 'Productivity',
        icon: HiOutlineComputerDesktop,
        path: '/dashboard/productivity',
        group: 'Work'
      }

      const result = [baseMenuItems[0], teamMenuItem, ...baseMenuItems.slice(1)]
      if (productivityItem) {
        // Insert after Team
        result.splice(2, 0, productivityItem)
      }

      return result
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

  const navigationItems = useMemo(
    () => buildNavigationSections(filteredMenuItems),
    [filteredMenuItems]
  )
  const visibleNavigationItems = useMemo(
    () => filterNavigationSections(navigationItems, menuQuery),
    [navigationItems, menuQuery]
  )

  useEffect(() => {
    if (menuQuery) {
      setExpandedMenus(Object.fromEntries(visibleNavigationItems.map((item) => [item.name, true])))
    }
  }, [menuQuery, visibleNavigationItems])

  const toggleSubmenu = (menuName) => {
    setExpandedMenus((current) => current[menuName] ? {} : { [menuName]: true })
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

  // Helper to check if a menu item is active (uses targetPath for optimistic highlight during navigation)
  const effectivePath = (isNavigating && targetPath) ? targetPath : pathname
  const isMenuItemActive = (item) => {
    return isNavigationPathActive(item, effectivePath)
  }

  useEffect(() => {
    if (menuQuery) return
    const activeItem = navigationItems.find((item) => item.submenu && isNavigationPathActive(item, effectivePath))
    if (activeItem) setExpandedMenus({ [activeItem.name]: true })
  }, [effectivePath, menuQuery, navigationItems])

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
            isTeamLeader={isTeamLeader}
            companyFeatures={companyFeatures}
          />
          <SlidingSidebar
            isOpen={slidingSidebarOpen}
            setIsOpen={setSlidingSidebarOpen}
            activeSubmenu={activeSubmenu}
            setActiveSubmenu={setActiveSubmenu}
            activeMenuIndex={activeMenuIndex}
            sidebarCounts={sidebarCounts}
            isDepartmentHead={isDepartmentHead}
            isTeamLeader={isTeamLeader}
            companyFeatures={companyFeatures}
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
              className="fixed inset-0 z-[60] animate-fade-in bg-black/60 backdrop-blur-[10px]"
              onClick={() => setIsOpen(false)}
            />
          )}

          {/* Mobile Sidebar */}
          <aside
            className={`
              talio-sidebar-shell fixed inset-y-0 left-0 z-[60]
              flex flex-col h-screen shadow-[0_6px_24px_rgba(15,23,42,0.08)]
              ${isOpen ? 'translate-x-0' : '-translate-x-full'}
              w-full max-w-[288px]
              transition-transform duration-300 ease-in-out
            `}
            style={{
              backgroundColor: 'var(--color-bg-sidebar)',
            }}
          >
            {/* Logo Section */}
            <div className="talio-sidebar-header h-16 px-4 flex-shrink-0 flex items-center">
              <div className="flex items-center w-full justify-between">
                <img
                  src="/assets/logo.png"
                  alt="Talio Logo"
                  className="h-9 w-auto object-contain"
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
            <ScrollShadow className="flex-1 space-y-0.5 px-3 pb-6 pt-3 scrollbar-hide">
              <label className="talio-sidebar-search mb-3 flex items-center gap-2 px-3 py-2">
                <HiOutlineMagnifyingGlass className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--color-text-secondary)' }} />
                <input
                  value={menuQuery}
                  onChange={(event) => setMenuQuery(event.target.value)}
                  placeholder="Find a tool"
                  aria-label="Find a tool"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-default-400"
                  style={{ color: 'var(--color-text-primary)' }}
                />
              </label>

              {visibleNavigationItems.map((item, index) => {
                const isActive = isMenuItemActive(item)
                const showGroupHeader = item.group && item.group !== 'Main' && (index === 0 || visibleNavigationItems[index - 1]?.group !== item.group)
                return (
                  <div key={item.name} className="w-full">
                    {showGroupHeader && (
                      <div className={`px-2 ${index === 0 ? 'pb-2 pt-1' : 'pb-2 pt-4'}`}>
                        <p className="talio-sidebar-section-label">
                          {item.group}
                        </p>
                      </div>
                    )}
                    {item.submenu ? (
                      <div className="w-full">
                        <button
                          type="button"
                          onClick={() => toggleSubmenu(item.name)}
                          aria-expanded={Boolean(expandedMenus[item.name])}
                          data-active={isActive}
                          data-expanded={Boolean(expandedMenus[item.name])}
                          className="talio-sidebar-row justify-between text-left"
                        >
                          <div className="flex items-center gap-3 flex-1">
                            <div className="talio-sidebar-icon">
                              <item.icon className="h-[18px] w-[18px]" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-[13px] font-semibold">{item.name}</span>
                                <InlineBadge count={getNavigationBadgeCount(item, getBadgeCount)} />
                              </div>
                            </div>
                          </div>
                          <div className={`transition-transform duration-200 flex-shrink-0 ${expandedMenus[item.name] ? 'rotate-90' : ''}`}>
                            <HiOutlineChevronRight className="w-4 h-4" />
                          </div>
                        </button>
                        {expandedMenus[item.name] && (
                          <SidebarSubmenu
                            item={item}
                            effectivePath={effectivePath}
                            onNavigate={handleLinkClick}
                            getBadgeCount={getSubmenuBadgeCount}
                            expandAll={Boolean(menuQuery)}
                          />
                        )}
                      </div>
                    ) : item.name === 'Chat' ? (
                      <button
                        onClick={() => {
                          toggleWidget('sidebar')
                          handleLinkClick(null)
                        }}
                        className="talio-sidebar-row text-left"
                      >
                        <div className="flex items-center gap-3 flex-1">
                          <div className="talio-sidebar-icon relative">
                            <item.icon className="h-[18px] w-[18px]" />
                            {unreadCount > 0 && <UnreadBadge count={unreadCount} />}
                          </div>
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="truncate text-[13px] font-medium">{item.name}</span>
                          </div>
                        </div>
                      </button>
                    ) : (
                      <Link
                        href={item.path}
                        onClick={() => handleLinkClick(item.path)}
                        aria-current={isActive ? 'page' : undefined}
                        data-active={isActive}
                        className="talio-sidebar-row text-left"
                      >
                        <div className="flex items-center gap-3 flex-1">
                          <div className="talio-sidebar-icon">
                            <item.icon className="h-[18px] w-[18px]" />
                          </div>
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="truncate text-[13px] font-medium">{item.name}</span>
                            {item.name !== 'Chat' && <InlineBadge count={getBadgeCount(item.name)} />}
                          </div>
                        </div>
                      </Link>
                    )}
                  </div>
                )
              })}

              {visibleNavigationItems.length === 0 && (
                <div className="px-4 py-10 text-center">
                  <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>No tools found</p>
                  <p className="mt-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>Try a module, action, or page name.</p>
                </div>
              )}
            </ScrollShadow>

            {/* Mobile Bottom Section */}
            <div
              className="flex-shrink-0 px-3 py-2.5"
              style={{
                borderTop: '1px solid color-mix(in srgb, var(--color-text-secondary) 12%, transparent)',
                backgroundColor: 'var(--color-bg-sidebar)'
              }}
            >
              <div className="flex items-center gap-2">
                {/* Chat Button */}
                <button
                  onClick={() => toggleWidget('sidebar')}
                  className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg transition-colors hover:bg-primary-50 dark:hover:bg-primary-900/20 relative"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  <SIDEBAR_ACTION_ICONS.chat
                    className="h-4 w-4"
                    style={{ color: 'var(--color-primary-600)' }}
                  />
                  <span className="text-xs font-medium">Chat</span>
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 right-1 bg-red-500 text-white text-[10px] rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">{unreadCount > 99 ? '99+' : unreadCount}</span>
                  )}
                </button>

                {/* Settings Button */}
                <Link
                  href="/dashboard/settings"
                  onClick={() => handleLinkClick('/dashboard/settings')}
                  className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg transition-colors hover:bg-primary-50 dark:hover:bg-primary-900/20"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  <SIDEBAR_ACTION_ICONS.settings
                    className="h-4 w-4"
                    style={{ color: effectivePath === '/dashboard/settings' ? 'var(--color-primary-600)' : 'var(--color-primary-500)' }}
                  />
                  <span className="text-xs font-medium">Settings</span>
                </Link>

                {/* Logout Button */}
                <button
                  onClick={() => setShowLogoutConfirm(true)}
                  className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  <SIDEBAR_ACTION_ICONS.logout
                    className="h-4 w-4"
                    style={{ color: '#f43f5e' }}
                  />
                  <span className="text-xs font-medium text-danger-500">Logout</span>
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
