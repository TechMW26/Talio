'use client'

import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  HiOutlineChevronRight,
  HiOutlineUsers,
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
import { getCurrentUser } from '@/utils/userHelper'
import toast from '@/utils/toast'
import { useUnreadMessages } from '@/contexts/UnreadMessagesContext'
import { useChatWidget } from '@/contexts/ChatWidgetContext'
import { usePageTransition } from '@/contexts/PageTransitionContext'
import UnreadBadge from '@/components/UnreadBadge'
import SidebarSubmenu from '@/components/sidebar/SidebarSubmenu'
import { Button, ScrollShadow, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Avatar } from '@heroui/react'

// Inline badge component for expanded menu items
function InlineBadge({ count }) {
  if (!count || count <= 0) return null
  return (
    <span className="talio-sidebar-badge talio-sidebar-badge--danger">
      {count > 99 ? '99+' : count}
    </span>
  )
}

export default function SlidingSidebar({
  isOpen,
  setIsOpen,
  activeSubmenu,
  setActiveSubmenu,
  activeMenuIndex,
  sidebarCounts = {},
  isDepartmentHead = false,
  isTeamLeader = false,
  companyFeatures = null
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [expandedMenus, setExpandedMenus] = useState({})
  const [user, setUser] = useState(null)
  const [mounted, setMounted] = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [isDesktopApp, setIsDesktopApp] = useState(false)
  const [menuQuery, setMenuQuery] = useState('')
  const { unreadCount } = useUnreadMessages()
  const { toggleWidget } = useChatWidget()
  const { startNavigation, isNavigating, targetPath } = usePageTransition()
  const sidebarRef = useRef(null)
  const menuItemRefs = useRef({})
  const scrollContainerRef = useRef(null)

  // Auto-close timer ref
  const autoCloseTimerRef = useRef(null)

  // Clear the auto-close timer
  const clearAutoCloseTimer = useCallback(() => {
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current)
      autoCloseTimerRef.current = null
    }
  }, [])

  // Start the auto-close timer (3 seconds)
  const startAutoCloseTimer = useCallback(() => {
    if (!isOpen) return

    clearAutoCloseTimer()
    autoCloseTimerRef.current = setTimeout(() => {
      setIsOpen(false)
      setActiveSubmenu(null)
    }, 3000)
  }, [isOpen, setIsOpen, setActiveSubmenu, clearAutoCloseTimer])

  // Handle mouse enter on sidebar - cancel auto-close
  const handleSidebarMouseEnter = useCallback(() => {
    clearAutoCloseTimer()
  }, [clearAutoCloseTimer])

  // Handle mouse leave from sidebar - start auto-close timer
  const handleSidebarMouseLeave = useCallback(() => {
    startAutoCloseTimer()
  }, [startAutoCloseTimer])

  // Clean up timer on unmount
  useEffect(() => {
    return () => clearAutoCloseTimer()
  }, [clearAutoCloseTimer])

  // Auto-expand submenu when activeSubmenu changes
  useEffect(() => {
    if (activeSubmenu) {
      setExpandedMenus({ [activeSubmenu]: true })
    }
  }, [activeSubmenu])

  // Scroll to active menu item when sidebar opens
  useEffect(() => {
    if (isOpen && activeMenuIndex !== null && activeMenuIndex !== undefined) {
      // Small delay to ensure the sidebar has finished animating
      const timer = setTimeout(() => {
        const menuItemElement = menuItemRefs.current[activeMenuIndex]
        if (menuItemElement && scrollContainerRef.current) {
          const container = scrollContainerRef.current
          // Use getBoundingClientRect for reliable offset calculation
          const containerRect = container.getBoundingClientRect()
          const itemRect = menuItemElement.getBoundingClientRect()
          const relativeTop = itemRect.top - containerRect.top + container.scrollTop
          const scrollTop = relativeTop - (container.clientHeight / 2) + (itemRect.height / 2)
          container.scrollTo({
            top: Math.max(0, scrollTop),
            behavior: 'smooth'
          })
        }
      }, 150)
      return () => clearTimeout(timer)
    }
  }, [isOpen, activeMenuIndex])

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

    // Team leader (not dept head) gets a My Teams section
    if (isTeamLeader) {
      const myTeamsMenuItem = {
        name: 'My Teams',
        icon: HiOutlineUsers,
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
    // Close sidebar when link is clicked
    setIsOpen(false)
    setActiveSubmenu(null)
    // Show page transition loading if navigating to a different page
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

  // Helper to check if a menu item is active (optimistic highlight during navigation)
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

  // Helper to get badge count for submenu items
  const getSubmenuBadgeCount = (subItemName) => {
    switch (subItemName) {
      case 'Attendance Regularisation':
        return sidebarCounts.attendance || 0
      case 'Leave Approvals':
        return sidebarCounts.leaves || 0
      case 'My Projects':
      case 'Project Invitations':
        return sidebarCounts.projects || 0
      case "To-Do's":
        return sidebarCounts.tasks || 0
      case 'Approvals':
        return sidebarCounts.expenses || 0
      default:
        return 0
    }
  }

  if (!mounted) {
    return null
  }

  return (
    <>
      {/* Overlay for clicking outside to close */}
      {isOpen && (
        <div
          className="hidden lg:block fixed inset-0 z-[49] bg-black/20 backdrop-blur-[10px]"
          onClick={() => {
            setIsOpen(false)
            setActiveSubmenu(null)
          }}
        />
      )}

      {/* Sliding Sidebar - starts off screen, slides in when open - overlaps icon strip */}
      <aside
        ref={sidebarRef}
        onMouseEnter={handleSidebarMouseEnter}
        onMouseLeave={handleSidebarMouseLeave}
        className={`
          talio-sidebar-shell hidden lg:flex fixed inset-y-0 left-0 z-[70] flex-col h-screen w-[18rem] shadow-[0_12px_32px_rgba(15,23,42,0.12)]
          transition-transform duration-300 ease-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
        style={{
          backgroundColor: 'var(--color-bg-sidebar)',
        }}
      >
        {/* Header with close button */}
        <div
          className="talio-sidebar-header h-16 px-4 flex items-center justify-between flex-shrink-0"
        >
          <img
            src="/assets/logo.png"
            alt="Talio Logo"
            className="h-9 w-auto object-contain"
          />
          <button
            onClick={() => {
              setIsOpen(false)
              setActiveSubmenu(null)
            }}
            className="p-2 rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-zinc-700"
            title="Close sidebar"
          >
            <HiOutlineChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-400 rotate-180" />
          </button>
        </div>

        {/* Scrollable Menu Section */}
        <ScrollShadow ref={scrollContainerRef} className="flex-1 space-y-0.5 px-3 pb-6 pt-3 scrollbar-hide">
          {/* Profile - top of menu */}
          <Link
            href="/dashboard/profile"
            onClick={() => handleLinkClick('/dashboard/profile')}
            data-active={effectivePath === '/dashboard/profile'}
            className="talio-sidebar-row"
          >
            <div className="flex items-center gap-3 flex-1">
              <Avatar
                size="sm"
                src={user?.profilePicture || (typeof user?.employeeId === 'object' ? user?.employeeId?.profilePicture : null) || undefined}
                name={(() => {
                  const fn = user?.firstName || '', ln = user?.lastName || ''
                  return (fn || ln) ? `${fn[0] || ''}${ln[0] || ''}`.toUpperCase() : (user?.email?.[0]?.toUpperCase() || 'U')
                })()}
                className="h-8 w-8 text-xs"
                style={{
                  backgroundColor: 'var(--color-primary-500)',
                  color: 'white',
                }}
              />
              <span className="truncate text-[13px] font-semibold">
                {user?.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : 'My Profile'}
              </span>
            </div>
          </Link>

          <div className="mx-2 my-2 border-t" style={{ borderColor: 'color-mix(in srgb, var(--color-text-secondary) 12%, transparent)' }} />

          <label className="talio-sidebar-search mx-1 mb-5 flex items-center gap-2 px-3 py-2">
            <HiOutlineMagnifyingGlass className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--color-text-secondary)' }} />
            <input
              value={menuQuery}
              onChange={(event) => setMenuQuery(event.target.value)}
              placeholder="Search"
              aria-label="Search"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-default-400"
              style={{ color: 'var(--color-text-primary)' }}
            />
          </label>

          {visibleNavigationItems.map((item, index) => {
            const isActive = isMenuItemActive(item)
            const isTargeted = activeSubmenu === item.name
            const showGroupHeader = item.group && item.group !== 'Main' && (index === 0 || visibleNavigationItems[index - 1]?.group !== item.group)
            return (
              <div key={item.name} ref={el => menuItemRefs.current[index] = el} className="w-full">
                {showGroupHeader && (
                  <div className={`px-2 ${index === 0 ? 'pb-2 pt-1' : 'pb-2 pt-4'}`}>
                    <p className="talio-sidebar-section-label">
                      {item.group}
                    </p>
                  </div>
                )}
                <div>
                  {item.submenu ? (
                    <div className="w-full">
                      <button
                        type="button"
                        onClick={() => toggleSubmenu(item.name)}
                        aria-expanded={Boolean(expandedMenus[item.name])}
                        data-active={isActive || isTargeted}
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
              </div>
            )
          })}

          {visibleNavigationItems.length === 0 && (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>No tools found</p>
              <p className="mt-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>Try a module, action, or page name.</p>
            </div>
          )}

          {/* Divider + Settings / Logout - bottom of menu */}
          <div className="mx-2 my-2 border-t" style={{ borderColor: 'color-mix(in srgb, var(--color-text-secondary) 12%, transparent)' }} />

          <Link
            href="/dashboard/settings"
            onClick={() => handleLinkClick('/dashboard/settings')}
            aria-current={effectivePath === '/dashboard/settings' ? 'page' : undefined}
            data-active={effectivePath === '/dashboard/settings'}
            className="talio-sidebar-row text-left"
          >
            <div className="flex items-center gap-3 flex-1">
              <div className="talio-sidebar-icon">
                <SIDEBAR_ACTION_ICONS.settings className="h-[18px] w-[18px]" />
              </div>
              <span className="truncate text-[13px] font-medium">Settings</span>
            </div>
          </Link>

          {isDesktopApp && (
            <Link
              href="/dashboard/app-info"
              onClick={() => handleLinkClick('/dashboard/app-info')}
              aria-current={effectivePath === '/dashboard/app-info' ? 'page' : undefined}
              data-active={effectivePath === '/dashboard/app-info'}
              className="talio-sidebar-row text-left"
            >
              <div className="flex items-center gap-3 flex-1">
                <div className="talio-sidebar-icon">
                  <SIDEBAR_ACTION_ICONS.appInfo className="h-[18px] w-[18px]" />
                </div>
                <span className="truncate text-[13px] font-medium">App Info</span>
              </div>
            </Link>
          )}

          <button
            onClick={() => setShowLogoutConfirm(true)}
            className="talio-sidebar-row text-left hover:!bg-danger-50 dark:hover:!bg-danger-900/20"
          >
            <div className="flex items-center gap-3 flex-1">
              <div className="talio-sidebar-icon !bg-danger-50 !text-danger-500 dark:!bg-danger-900/20">
                <SIDEBAR_ACTION_ICONS.logout className="h-[18px] w-[18px]" />
              </div>
              <span className="truncate text-[13px] font-medium text-danger-500">Logout</span>
            </div>
          </button>
        </ScrollShadow>
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
  )
}
