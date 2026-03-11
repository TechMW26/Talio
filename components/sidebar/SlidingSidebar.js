'use client'

import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  HiOutlineChevronRight,
  HiOutlineXMark,
  HiOutlineCog6Tooth,
  HiOutlineArrowRightOnRectangle,
  HiOutlineChatBubbleLeftRight,
  HiOutlineUsers,
  HiOutlineUserCircle,
  HiOutlineInformationCircle,
} from 'react-icons/hi2'
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { getMenuItemsForRole } from '@/utils/roleBasedMenus'
import toast from '@/utils/toast'
import { useUnreadMessages } from '@/contexts/UnreadMessagesContext'
import { useChatWidget } from '@/contexts/ChatWidgetContext'
import { usePageTransition } from '@/contexts/PageTransitionContext'
import UnreadBadge from '@/components/UnreadBadge'
import { Button, Chip, ScrollShadow, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Avatar } from '@heroui/react'

// Inline badge component for expanded menu items
function InlineBadge({ count }) {
  if (!count || count <= 0) return null
  return (
    <Chip size="sm" color="danger" variant="flat" className="min-w-5 h-5 text-[10px]">
      {count > 99 ? '99+' : count}
    </Chip>
  )
}

export default function SlidingSidebar({
  isOpen,
  setIsOpen,
  activeSubmenu,
  setActiveSubmenu,
  activeMenuIndex,
  sidebarCounts = {},
  isDepartmentHead = false
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [expandedMenus, setExpandedMenus] = useState({})
  const [user, setUser] = useState(null)
  const [mounted, setMounted] = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [isDesktopApp, setIsDesktopApp] = useState(false)
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
      setExpandedMenus(prev => ({
        ...prev,
        [activeSubmenu]: true
      }))
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
    setIsDesktopApp(typeof window !== 'undefined' && (window.electronAPI !== undefined || window.isElectron === true))
  }, [])

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
        group: 'Main',
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
          hidden lg:flex fixed inset-y-0 left-0 z-[70] flex-col h-screen w-[17rem] shadow-[0_6px_24px_rgba(15,23,42,0.08)]
          transition-transform duration-300 ease-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
        style={{
          backgroundColor: 'var(--color-bg-sidebar)',
        }}
      >
        {/* Header with close button */}
        <div
          className="h-[60.5px] px-4 flex items-center justify-between flex-shrink-0"
        >
          <img
            src="/assets/logo.png"
            alt="Talio Logo"
            className="h-10 w-auto object-contain"
          />
          <button
            onClick={() => {
              setIsOpen(false)
              setActiveSubmenu(null)
            }}
            className="p-2 rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-slate-700"
            title="Close sidebar"
          >
            <HiOutlineChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-400 rotate-180" />
          </button>
        </div>

        {/* Scrollable Menu Section */}
        <ScrollShadow ref={scrollContainerRef} className="pt-4 pb-8 flex-1 scrollbar-hide px-3 space-y-1">
          {/* Profile — top of menu */}
          <Link
            href="/dashboard/profile"
            onClick={() => handleLinkClick('/dashboard/profile')}
            className="w-full flex items-center text-left rounded-xl transition-all duration-200 group cursor-pointer relative px-4 py-3"
            style={{
              backgroundColor: effectivePath === '/dashboard/profile' ? 'var(--color-primary-500)' : 'transparent',
              color: effectivePath === '/dashboard/profile' ? 'white' : 'var(--color-text-primary)'
            }}
          >
            <div className="flex items-center gap-3 flex-1">
              <Avatar
                size="sm"
                src={user?.profilePicture}
                name={(() => {
                  const fn = user?.firstName || '', ln = user?.lastName || ''
                  return (fn || ln) ? `${fn[0] || ''}${ln[0] || ''}`.toUpperCase() : (user?.email?.[0]?.toUpperCase() || 'U')
                })()}
                className="w-9 h-9 text-xs"
                style={{
                  backgroundColor: effectivePath === '/dashboard/profile' ? 'white' : 'var(--color-primary-500)',
                  color: effectivePath === '/dashboard/profile' ? 'var(--color-primary-500)' : 'white',
                }}
              />
              <span className="text-sm font-medium truncate">
                {user?.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : 'My Profile'}
              </span>
            </div>
          </Link>

          <div className="my-2 mx-2 border-t" style={{ borderColor: 'var(--color-primary-200)' }} />

          {menuItems.map((item, index) => {
            const isActive = isMenuItemActive(item)
            const isTargeted = activeSubmenu === item.name
            const showGroupHeader = item.group && (index === 0 || menuItems[index - 1]?.group !== item.group)
            return (
              <div key={item.name} ref={el => menuItemRefs.current[index] = el} className="w-full">
                {showGroupHeader && (
                  <div className={`px-4 ${index === 0 ? 'pt-0 pb-2' : 'pt-4 pb-2'}`}>
                    <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-tertiary, var(--color-text-secondary))' }}>
                      {item.group}
                    </p>
                  </div>
                )}
                <div className="rounded-xl transition-all duration-300" style={{
                  boxShadow: isTargeted ? '0 0 0 2px var(--color-primary-300)' : 'none',
                  backgroundColor: isTargeted ? 'color-mix(in srgb, var(--color-primary-100) 40%, transparent)' : 'transparent',
                  paddingBottom: isTargeted ? '4px' : '0',
                }}>
                {item.submenu ? (
                  <div className="w-full">
                    <button
                      type="button"
                      onClick={() => toggleSubmenu(item.name)}
                      className="w-full flex items-center text-left rounded-xl transition-all duration-200 group relative justify-between px-4 py-3"
                      style={{
                        backgroundColor: expandedMenus[item.name] ? 'var(--color-bg-hover)' : isTargeted ? 'var(--color-primary-50)' : 'transparent',
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
                              backgroundColor: effectivePath === subItem.path ? 'var(--color-primary-500)' : 'transparent',
                              color: effectivePath === subItem.path ? 'white' : 'var(--color-text-secondary)'
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
              </div>
            )
          })}

          {/* Divider + Settings / Logout — bottom of menu */}
          <div className="my-2 mx-2 border-t" style={{ borderColor: 'var(--color-primary-200)' }} />

          <Link
            href="/dashboard/settings"
            onClick={() => handleLinkClick('/dashboard/settings')}
            className="w-full flex items-center text-left rounded-xl transition-all duration-200 group cursor-pointer relative px-4 py-3"
            style={{
              backgroundColor: effectivePath === '/dashboard/settings' ? 'var(--color-primary-500)' : 'transparent',
              color: effectivePath === '/dashboard/settings' ? 'white' : 'var(--color-text-primary)'
            }}
          >
            <div className="flex items-center gap-3 flex-1">
              <div
                className="transition-colors p-2 rounded-lg"
                style={{
                  backgroundColor: effectivePath === '/dashboard/settings' ? 'var(--color-primary-600)' : 'color-mix(in srgb, var(--color-primary-100) 60%, transparent)',
                  color: effectivePath === '/dashboard/settings' ? 'white' : 'var(--color-primary-600)'
                }}
              >
                <HiOutlineCog6Tooth className="w-5 h-5" />
              </div>
              <span className="text-sm font-medium truncate">Settings</span>
            </div>
          </Link>

          {isDesktopApp && (
            <Link
              href="/dashboard/app-info"
              onClick={() => handleLinkClick('/dashboard/app-info')}
              className="w-full flex items-center text-left rounded-xl transition-all duration-200 group cursor-pointer relative px-4 py-3"
              style={{
                backgroundColor: effectivePath === '/dashboard/app-info' ? 'var(--color-primary-500)' : 'transparent',
                color: effectivePath === '/dashboard/app-info' ? 'white' : 'var(--color-text-primary)'
              }}
            >
              <div className="flex items-center gap-3 flex-1">
                <div
                  className="transition-colors p-2 rounded-lg"
                  style={{
                    backgroundColor: effectivePath === '/dashboard/app-info' ? 'var(--color-primary-600)' : 'color-mix(in srgb, var(--color-primary-100) 60%, transparent)',
                    color: effectivePath === '/dashboard/app-info' ? 'white' : 'var(--color-primary-600)'
                  }}
                >
                  <HiOutlineInformationCircle className="w-5 h-5" />
                </div>
                <span className="text-sm font-medium truncate">App Info</span>
              </div>
            </Link>
          )}

          <button
            onClick={() => setShowLogoutConfirm(true)}
            className="w-full flex items-center text-left rounded-xl transition-all duration-200 group cursor-pointer relative px-4 py-3 hover:bg-danger-50 dark:hover:bg-danger-900/20"
            style={{
              color: 'var(--color-text-primary)'
            }}
          >
            <div className="flex items-center gap-3 flex-1">
              <div className="transition-colors p-2 rounded-lg" style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary-100) 60%, transparent)' }}>
                <HiOutlineArrowRightOnRectangle className="w-5 h-5 text-danger-500" />
              </div>
              <span className="text-sm font-medium truncate text-danger-500">Logout</span>
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
