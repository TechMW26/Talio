'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { FaBars, FaBell, FaUser, FaSignOutAlt, FaCog, FaSearch, FaComments, FaTimes, FaSyncAlt } from 'react-icons/fa'
import Loader from '@/components/ui/Loader'
import MiraSphere from '@/components/ui/MiraSphere'
import toast from '@/utils/toast'
import { handleSessionExpired } from '@/utils/userHelper'
import { useTheme } from '@/contexts/ThemeContext'
import { useUnreadMessages } from '@/contexts/UnreadMessagesContext'
import { useChatWidget } from '@/contexts/ChatWidgetContext'
import UnreadBadge from '@/components/UnreadBadge'
import { formatDesignation as formatDesignationLib, formatDepartments, getLevelNameFromNumber } from '@/lib/formatters'
import { getCachedEmployeeData, setCachedEmployeeData } from '@/utils/sessionCache'
import { Button, Input, Avatar, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, DropdownSection, Skeleton, ScrollShadow, Modal, ModalContent, ModalBody, Divider } from '@heroui/react'

export default function Header({ toggleSidebar, sidebarCollapsed }) {
  const { theme, isDarkMode } = useTheme()
  const router = useRouter()
  const pathname = usePathname()
  const { unreadCount } = useUnreadMessages()
  const { openWidget } = useChatWidget()

  // Fallback theme colors if theme is not loaded yet
  const primaryColor = theme?.primary?.[600] || '#2563EB'
  const primaryLight = theme?.primary?.[50] || '#EFF6FF'
  const primaryMedium = theme?.primary?.[500] || '#3B82F6'

  const [user, setUser] = useState(null)
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [showSearchResults, setShowSearchResults] = useState(false)
  const [showMobileSearch, setShowMobileSearch] = useState(false)
  const [searching, setSearching] = useState(false)
  const [pageTitle, setPageTitle] = useState('HOME')
  const [employeeData, setEmployeeData] = useState(null)
  const [timezone, setTimezone] = useState('Asia/Kolkata')
  const [isDesktop, setIsDesktop] = useState(false)
  const [showMiraModal, setShowMiraModal] = useState(false)
  const [miraModalClosing, setMiraModalClosing] = useState(false)
  const [isMiraHovered, setIsMiraHovered] = useState(false)
  const notifRef = useRef(null)
  const profileRef = useRef(null)
  const searchRef = useRef(null)
  const searchTimeoutRef = useRef(null)

  // Check if desktop for header left positioning
  useEffect(() => {
    const checkDesktop = () => {
      setIsDesktop(window.innerWidth >= 1024)
    }
    checkDesktop()
    window.addEventListener('resize', checkDesktop)
    return () => window.removeEventListener('resize', checkDesktop)
  }, [])

  // Handle Escape key to close MIRA modal
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && showMiraModal && !miraModalClosing) {
        setMiraModalClosing(true)
      }
    }

    if (showMiraModal) {
      window.addEventListener('keydown', handleEscape)
      return () => window.removeEventListener('keydown', handleEscape)
    }
  }, [showMiraModal, miraModalClosing])

  // Get user initials for avatar fallback
  const getUserInitials = () => {
    const firstName = employeeData?.firstName || user?.firstName || ''
    const lastName = employeeData?.lastName || user?.lastName || ''
    if (firstName || lastName) {
      return `${firstName[0] || ''}${lastName[0] || ''}`.toUpperCase()
    }
    // Fallback to email first letter
    const email = user?.email || ''
    return email[0]?.toUpperCase() || 'U'
  }

  useEffect(() => {
    setMounted(true)
    const userData = localStorage.getItem('user')
    if (userData) {
      const parsedUser = JSON.parse(userData)
      setUser(parsedUser)

      // If user already has complete employee data from login, use it
      if (parsedUser.firstName && parsedUser.designation) {
        setEmployeeData({
          firstName: parsedUser.firstName,
          lastName: parsedUser.lastName,
          profilePicture: parsedUser.profilePicture,
          designation: parsedUser.designation,
          department: parsedUser.department,
          employeeNumber: parsedUser.employeeNumber,
        })
      }

      // OPTIMIZED: Check sessionCache first to avoid duplicate /api/employees/:id call
      // (dashboard/layout.js already fetches and caches this data)
      // Handle both string ID and object with _id
      const empId = parsedUser.employeeId
        ? (typeof parsedUser.employeeId === 'object'
          ? (parsedUser.employeeId._id || parsedUser.employeeId)
          : parsedUser.employeeId)
        : null

      if (empId) {
        const cached = getCachedEmployeeData(empId)
        if (cached) {
          console.log('[Header] Using cached employee data, skipping API call')
          setEmployeeData(cached)
          if (cached.company?.timezone) {
            setTimezone(cached.company.timezone)
          }
        } else {
          fetchEmployeeData(empId)
        }
      }
    }
  }, [])

  // Helper function to format designation with level name
  // Uses employee data if available for accurate level info
  const formatDesignation = (designation, employee = null) => {
    return formatDesignationLib(designation, employee)
  }

  // Get level name from level number (kept for backward compatibility)
  const getLevelNameFromNumber2 = getLevelNameFromNumber

  const fetchEmployeeData = async (employeeId) => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/employees/${employeeId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      // Handle 401 - session expired
      if (response.status === 401) {
        handleSessionExpired()
        return
      }

      const result = await response.json()
      if (result.success) {
        console.log('Employee Data Fetched:', result.data)
        console.log('Designation Object:', result.data.designation)
        console.log('Designation Title:', result.data.designation?.title)
        console.log('Designation Level Name:', result.data.designation?.levelName)
        console.log('Employee Designation Level:', result.data.designationLevel)
        console.log('Employee Designation Level Name:', result.data.designationLevelName)
        setEmployeeData(result.data)

        // Cache the employee data so other components don't re-fetch
        setCachedEmployeeData(result.data)

        if (result.data.company && result.data.company.timezone) {
          setTimezone(result.data.company.timezone)
        }

        // Sync user data in localStorage with employee data (including new fields)
        const currentUser = JSON.parse(localStorage.getItem('user') || '{}')
        const syncedUser = {
          ...currentUser,
          firstName: result.data.firstName,
          lastName: result.data.lastName,
          profilePicture: result.data.profilePicture,
          designation: result.data.designation,
          designationLevel: result.data.designationLevel,
          designationLevelName: result.data.designationLevelName,
          department: result.data.department,
          departments: result.data.departments,
          employeeNumber: result.data.employeeNumber,
        }
        console.log('Synced User Data:', syncedUser)
        console.log('Formatted Designation:', formatDesignation(result.data.designation, result.data))
        localStorage.setItem('user', JSON.stringify(syncedUser))
        setUser(syncedUser)
      }
    } catch (error) {
      console.error('Error fetching employee data:', error)
    }
  }

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (notifRef.current && !notifRef.current.contains(event.target)) {
        setShowNotifications(false)
      }
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        setShowProfileMenu(false)
      }
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setShowSearchResults(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [])

  // Update page title based on pathname
  useEffect(() => {
    const getPageTitle = (path) => {
      if (!path) return 'Home'

      // Remove /dashboard prefix
      const cleanPath = path.replace('/dashboard', '')

      if (cleanPath === '' || cleanPath === '/') return 'Home'

      // Map routes to titles
      const titleMap = {
        '/tasks': 'Projects',
        '/tasks/my-tasks': 'My Projects',
        '/tasks/team-tasks': 'Team Projects',
        '/tasks/create': 'Create Project',
        '/tasks/assign': 'Assign Projects',
        '/tasks/history': 'Project History',
        '/projects': 'Projects',
        '/projects/my-tasks': 'My Tasks',
        '/projects/create': 'Create Project',
        '/chat': 'Chat',
        '/leave': 'Leave',
        '/leave/apply': 'Apply Leave',
        '/leave/my-leaves': 'My Leaves',
        '/attendance': 'Attendance',
        '/profile': 'Profile',
        '/settings': 'Settings',
        '/team': 'Team',
        '/departments': 'Departments',
        '/designations': 'Designations',
        '/employees': 'Employees',
        '/recruitment': 'Recruitment',
        '/payroll': 'Payroll',
        '/announcements': 'Announcements',
        '/policies': 'Policies',
        '/assets': 'Assets',
        '/reports': 'Reports',
        '/sandbox': 'Ideas',
      }

      // Check for exact match
      if (titleMap[cleanPath]) return titleMap[cleanPath]

      // Check for project detail or edit pages (dynamic routes like /projects/[id] or /projects/[id]/edit)
      if (cleanPath.match(/^\/projects\/[a-f0-9]{24}(\/edit)?$/i)) {
        return cleanPath.endsWith('/edit') ? 'Edit Project' : 'Project Details'
      }

      // Check for partial match (for dynamic routes)
      for (const [route, title] of Object.entries(titleMap)) {
        if (cleanPath.startsWith(route)) return title
      }

      // Default: capitalize the last segment (Title Case)
      const segments = cleanPath.split('/').filter(Boolean)
      if (segments.length > 0) {
        const lastSegment = segments[segments.length - 1]
        return lastSegment
          .replace(/-/g, ' ')
          .split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ')
      }

      return 'Home'
    }

    setPageTitle(getPageTitle(pathname))
  }, [pathname])

  // Search functionality
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    if (searchQuery.trim().length < 2) {
      setSearchResults(null)
      setShowSearchResults(false)
      return
    }

    setSearching(true)
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const token = localStorage.getItem('token')
        const response = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })

        // Handle 401 - session expired
        if (response.status === 401) {
          handleSessionExpired()
          return
        }

        const result = await response.json()
        if (result.success) {
          setSearchResults(result.data)
          setShowSearchResults(true)
        }
      } catch (error) {
        console.error('Search error:', error)
      } finally {
        setSearching(false)
      }
    }, 300)

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [searchQuery])

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
    // Clear cookie
    document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
    toast.success('Logged out successfully')
    router.push('/login')
  }

  const handleSearchResultClick = (link) => {
    setShowSearchResults(false)
    setShowMobileSearch(false)
    setSearchQuery('')

    // On desktop, open chat popup instead of navigating to chat page
    if (link === '/dashboard/chat' && isDesktop) {
      openWidget('button')
      return
    }

    router.push(link)
  }

  const closeMobileSearch = () => {
    setShowMobileSearch(false)
    setSearchQuery('')
    setSearchResults(null)
    setShowSearchResults(false)
  }

  const getCategoryLabel = (category) => {
    const labels = {
      pages: 'Pages & Navigation',
      tasks: 'Tasks',
      leaves: 'Leaves',
      announcements: 'Announcements',
      policies: 'Policies'
    }
    return labels[category] || category.charAt(0).toUpperCase() + category.slice(1)
  }

  // Don't render user-specific content until mounted to avoid hydration mismatch
  if (!mounted) {
    return (
      <header
        className="h-[60.5px] bg-content1 w-full z-[50] shadow-[0_2px_6px_rgba(15,23,42,0.08)] transition-all duration-300 flex-shrink-0"
      >
        <div className="flex items-center justify-between px-1 sm:px-4 lg:px-0 h-[45px] lg:h-[60px]">
          <div className="flex items-center space-x-2 sm:space-x-4">
            <Button
              isIconOnly
              variant="light"
              onPress={toggleSidebar}
              className="md:!hidden"
            >
              <img
                src="/hamburger.png"
                alt="Menu"
                className="w-5 h-5"
                style={{ filter: 'brightness(0) saturate(100%) invert(44%) sepia(8%) saturate(400%) hue-rotate(180deg)' }}
              />
            </Button>
          </div>
          <div className="flex items-center space-x-2 sm:space-x-4">
            <Skeleton className="w-8 h-8 rounded-full" />
          </div>
        </div>
      </header>
    )
  }

  return (
    <header
      className="h-[60.5px] bg-content1 w-full z-[50] shadow-[0_2px_6px_rgba(15,23,42,0.08)] dark:shadow-[0_2px_6px_rgba(0,0,0,0.3)] transition-all duration-300 flex-shrink-0"
    >
      <div className="flex items-center justify-between px-1 sm:px-4 lg:px-6 h-[60.5px] lg:h-[60px]">
        {/* Left side */}
        <div className="flex items-center space-x-2 sm:space-x-4 flex-1">
          <Button
            isIconOnly
            variant="light"
            onPress={toggleSidebar}
            className="md:!hidden"
          >
            <img
              src="/hamburger.png"
              alt="Menu"
              className="w-5 h-5"
              style={{ filter: isDarkMode ? 'brightness(0) saturate(100%) invert(70%) sepia(8%) saturate(400%) hue-rotate(180deg)' : 'brightness(0) saturate(100%) invert(44%) sepia(8%) saturate(400%) hue-rotate(180deg)' }}
            />
          </Button>

          {/* Search bar - Desktop */}
          <div ref={searchRef} className="hidden lg:block relative w-64 lg:w-96">
            {/* Backdrop overlay when search is active */}
            {(showSearchResults || searchQuery.length >= 2) && (
              <div
                className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-[10px]"
                onClick={() => {
                  setSearchQuery('')
                  setShowSearchResults(false)
                }}
              />
            )}

            {/* Unified Search Container */}
            <div className={`z-[101] ${(showSearchResults || searchQuery.length >= 2) ? 'fixed left-1/2 -translate-x-1/2 top-4 w-[90%] max-w-xl bg-content1 rounded-xl shadow-2xl border border-divider overflow-hidden' : 'relative'}`}>
              <div className="relative flex items-center">
                <Input
                  value={searchQuery}
                  onValueChange={setSearchQuery}
                  placeholder="Search everything..."
                  startContent={<FaSearch className="text-default-400 w-4 h-4" />}
                  endContent={
                    searching ? <Loader size="xs" /> :
                      searchQuery ? (
                        <Button
                          isIconOnly
                          size="sm"
                          variant="light"
                          onPress={() => {
                            setSearchQuery('')
                            setShowSearchResults(false)
                          }}
                        >
                          <FaTimes className="w-4 h-4" />
                        </Button>
                      ) : null
                  }
                  classNames={{
                    inputWrapper: (showSearchResults || searchQuery.length >= 2) ? 'bg-transparent border-b border-divider rounded-none' : 'bg-default-100'
                  }}
                />
              </div>

              {/* Search Results - Integrated */}
              {showSearchResults && searchResults && (
                <ScrollShadow className="max-h-[60vh]">
                  {Object.entries(searchResults).map(([category, items]) => {
                    if (items.length === 0) return null
                    return (
                      <div key={category} className="border-b border-divider last:border-b-0">
                        <div className="px-4 py-2 bg-default-50 font-semibold text-xs text-default-600 uppercase sticky top-0">
                          {getCategoryLabel(category)} <span className="text-default-400">({items.length})</span>
                        </div>
                        {items.map((item, index) => (
                          <div
                            key={item._id || index}
                            onClick={() => handleSearchResultClick(item.link)}
                            className="px-4 py-3 cursor-pointer transition-colors hover:bg-default-100"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <h4 className="font-medium text-sm text-default-900 truncate">{item.title}</h4>
                                {item.meta && item.type !== 'page' && (
                                  <span className="text-xs text-default-500 bg-default-100 px-2 py-0.5 rounded">{item.meta}</span>
                                )}
                              </div>
                              {item.subtitle && (
                                <p className="text-xs text-default-500">{item.subtitle}</p>
                              )}
                              {item.description && (
                                <p className="text-xs text-default-400 line-clamp-1 mt-0.5">{item.description}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                  {Object.values(searchResults).every(arr => arr.length === 0) && (
                    <div className="px-4 py-8 text-center text-default-500">
                      <p className="text-sm font-medium">No results found for "{searchQuery}"</p>
                      <p className="text-xs text-default-400 mt-1">Try different keywords</p>
                    </div>
                  )}
                </ScrollShadow>
              )}
            </div>
          </div>
        </div>

        {/* Center - Page Title */}
        <div className="absolute left-1/2 transform -translate-x-1/2">
          <h1 className="text-lg font-semibold" style={{ color: window.innerWidth >= 768 ? primaryColor : 'var(--color-text-primary)' }}>{pageTitle}</h1>
        </div>

        {/* Right side */}
        <div className="flex items-center space-x-2 sm:space-x-4 flex-1 justify-end">
          {/* MIRA Cloud Button - Desktop Only */}
          <div
            className="hidden md:flex items-center justify-center cursor-pointer relative group"
            data-mira-sphere="true"
            onClick={() => setShowMiraModal(true)}
            onMouseEnter={() => setIsMiraHovered(true)}
            onMouseLeave={() => setIsMiraHovered(false)}
          >
            <MiraSphere size={55} isHovered={isMiraHovered} />
            <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1 px-2 py-1 text-xs font-medium text-white bg-gray-900 dark:bg-gray-800 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
              MIRA Cloud
            </span>
          </div>

          {/* Real-time Clock - Desktop Only */}
          <div className="hidden md:flex items-center gap-2 px-4 py-2.5 text-default-600">
            <RealTimeClock timezone={timezone} />
          </div>

          {/* Refresh Button - Desktop Only */}
          <Button
            isIconOnly
            variant="light"
            className="hidden md:flex group"
            onPress={() => window.location.reload()}
          >
            <FaSyncAlt className="w-4 h-4 group-hover:rotate-180 transition-transform duration-500" />
          </Button>

          {/* PWA Status - Hidden */}
          {/* <PWAStatus /> */}

          {/* Notifications */}
          {/* <div ref={notifRef} className="relative mt-3 md:mt-0">
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative p-1.5 sm:p-2  text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <FaBell className="w-[25px] h-[25px] sm:w-5 sm:h-5 mt-[-5px] md:mt-0 md:mr-0 mr-[-5px]" />
              <div className="absolute top-0.5 right-0.5 sm:top-1 sm:right-1 w-[1px] h-[1px] p-[5px]  bg-red-600 rounded-full"></div>
            </button>

            {showNotifications && (
              <div className="absolute right-0 mt-2 w-72 sm:w-80 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50">
                <div className="px-4 py-2 border-b border-gray-200">
                  <h3 className="font-semibold text-gray-900">Notifications</h3>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  <div className="px-4 py-3 hover:bg-gray-50 cursor-pointer">
                    <p className="text-sm text-gray-900">New leave request from John Doe</p>
                    <p className="text-xs text-gray-500 mt-1">2 hours ago</p>
                  </div>
                  <div className="px-4 py-3 hover:bg-gray-50 cursor-pointer">
                    <p className="text-sm text-gray-900">Payroll processed for December</p>
                    <p className="text-xs text-gray-500 mt-1">5 hours ago</p>
                  </div>
                  <div className="px-4 py-3 hover:bg-gray-50 cursor-pointer">
                    <p className="text-sm text-gray-900">New announcement posted</p>
                    <p className="text-xs text-gray-500 mt-1">1 day ago</p>
                  </div>
                </div>
                <div className="px-4 py-2 border-t border-gray-200 text-center">
                  <a href="/dashboard/notifications" className="text-sm text-primary-600 hover:text-primary-700">
                    View all notifications
                  </a>
                </div>
              </div>
            )}
          </div> */}

          {/* Ideas Button - Desktop Only */}
          <div className="hidden md:block relative group">
            <Button
              isIconOnly
              variant="light"
              onPress={() => router.push('/dashboard/sandbox')}
              className="group-hover:bg-gradient-to-br group-hover:from-warning-50 group-hover:to-warning-100"
            >
              {/* Animated lightbulb container */}
              <div className="relative">
                {/* Main lightbulb icon */}
                <svg
                  className="w-5 h-5 transition-all duration-300 group-hover:text-warning-500 group-hover:scale-110"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7zm2.85 11.1l-.85.6V16h-4v-2.3l-.85-.6A4.997 4.997 0 0 1 7 9c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.63-.8 3.16-2.15 4.1z" />
                </svg>

                {/* Sparkle effects on hover */}
                <span className="absolute -top-1 -right-1 w-2 h-2 bg-warning-400 rounded-full opacity-0 group-hover:opacity-100 group-hover:animate-ping transition-opacity" />
                <span className="absolute -bottom-0.5 -left-0.5 w-1.5 h-1.5 bg-warning-500 rounded-full opacity-0 group-hover:opacity-100 group-hover:animate-ping transition-opacity" style={{ animationDelay: '0.2s' }} />
              </div>
            </Button>
          </div>

          {/* Profile menu */}
          <div ref={profileRef} className="relative mt-1 md:mt-0">
            <Dropdown isOpen={showProfileMenu && window.innerWidth >= 768} onOpenChange={(open) => {
              if (window.innerWidth >= 768) setShowProfileMenu(open)
            }}>
              <DropdownTrigger>
                <Button
                  isIconOnly
                  variant="light"
                  onPress={() => {
                    if (window.innerWidth < 768) {
                      router.push('/dashboard/profile')
                    } else {
                      setShowProfileMenu(!showProfileMenu)
                    }
                  }}
                  className="p-0 min-w-0 bg-transparent hover:bg-transparent data-[hover=true]:bg-transparent"
                >
                  <Avatar
                    size="sm"
                    src={employeeData?.profilePicture}
                    name={getUserInitials()}
                    className="bg-primary-500 text-white"
                  />
                </Button>
              </DropdownTrigger>
              <DropdownMenu aria-label="Profile Actions">
                <DropdownSection showDivider>
                  <DropdownItem key="profile-info" className="h-auto gap-2" textValue="Profile Info">
                    <div className="flex items-center gap-3 py-2">
                      <Avatar
                        src={employeeData?.profilePicture || user?.profilePicture}
                        name={getUserInitials()}
                        className="bg-primary-500 text-white"
                      />
                      <div className="flex flex-col">
                        <p className="text-sm font-semibold">
                          {employeeData ? `${employeeData.firstName} ${employeeData.lastName}` :
                            user?.firstName ? `${user.firstName} ${user.lastName}` :
                              user?.email || 'User'}
                        </p>
                        <p className="text-xs text-default-500">
                          {formatDesignation(employeeData?.designation || user?.designation, employeeData) || user?.role || 'Employee'}
                        </p>
                      </div>
                    </div>
                  </DropdownItem>
                </DropdownSection>
                <DropdownSection showDivider>
                  <DropdownItem
                    key="my-profile"
                    startContent={<FaUser className="w-4 h-4" />}
                    href="/dashboard/profile"
                  >
                    My Profile
                  </DropdownItem>
                  <DropdownItem
                    key="settings"
                    startContent={<FaCog className="w-4 h-4" />}
                    href="/dashboard/settings"
                  >
                    Settings
                  </DropdownItem>
                </DropdownSection>
                <DropdownSection>
                  <DropdownItem
                    key="logout"
                    color="danger"
                    startContent={<FaSignOutAlt className="w-4 h-4" />}
                    onPress={handleLogout}
                  >
                    Logout
                  </DropdownItem>
                </DropdownSection>
              </DropdownMenu>
            </Dropdown>
          </div>
        </div>
      </div>

      {/* Mobile Search Fullscreen Modal */}
      {showMobileSearch && (
        <div className="fixed inset-0 bg-content1 z-[100] md:!hidden">
          <div className="flex flex-col h-full">
            {/* Search Header - Match header height */}
            <div className="flex items-center gap-3 px-3 h-16 border-b border-divider bg-content1">
              <Button
                isIconOnly
                variant="light"
                onPress={closeMobileSearch}
              >
                <FaTimes className="w-5 h-5" />
              </Button>
              <div className="flex-1">
                <Input
                  value={searchQuery}
                  onValueChange={setSearchQuery}
                  placeholder="Search everything..."
                  startContent={<FaSearch className="text-default-400 w-4 h-4" />}
                  endContent={
                    searching ? <Loader size="xs" /> :
                      searchQuery ? (
                        <Button
                          isIconOnly
                          size="sm"
                          variant="light"
                          onPress={() => {
                            setSearchQuery('')
                            setSearchResults(null)
                          }}
                        >
                          <FaTimes className="w-4 h-4" />
                        </Button>
                      ) : null
                  }
                  autoFocus
                />
              </div>
            </div>

            {/* Search Results */}
            <ScrollShadow className="flex-1">
              {searchQuery.length < 2 ? (
                <div className="flex flex-col items-center justify-center h-full text-default-400 px-4">
                  <FaSearch className="w-16 h-16 mb-4 text-default-300" />
                  <p className="text-lg font-medium">Search Everything</p>
                  <p className="text-sm text-center mt-2">
                    Find pages, tasks, leaves, announcements, and more...
                  </p>
                </div>
              ) : searching ? (
                <div className="flex items-center justify-center h-full">
                  <Loader size="md" />
                </div>
              ) : searchResults ? (
                <div>
                  {Object.entries(searchResults).map(([category, items]) => {
                    if (items.length === 0) return null
                    return (
                      <div key={category} className="border-b border-divider">
                        <div className="px-4 py-3 bg-gradient-to-r from-default-50 to-default-100 font-semibold text-sm text-default-700 uppercase sticky top-0 z-10">
                          {getCategoryLabel(category)} <span className="text-default-500">({items.length})</span>
                        </div>
                        {items.map((item, index) => (
                          <div
                            key={item._id || index}
                            onClick={() => handleSearchResultClick(item.link)}
                            className="px-4 py-4 cursor-pointer border-b border-default-50 transition-colors hover:bg-default-100"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <h4 className="font-semibold text-base text-default-900">{item.title}</h4>
                              </div>
                              {item.subtitle && (
                                <p className="text-sm mb-1 text-primary-600">{item.subtitle}</p>
                              )}
                              {item.description && (
                                <p className="text-sm text-default-500 line-clamp-2">{item.description}</p>
                              )}
                              {item.meta && item.type !== 'page' && (
                                <span className="inline-block text-xs text-default-500 bg-default-100 px-2 py-1 rounded mt-2">
                                  {item.meta}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                  {Object.values(searchResults).every(arr => arr.length === 0) && (
                    <div className="flex flex-col items-center justify-center h-full text-default-400 px-4 py-12">
                      <FaSearch className="w-16 h-16 mb-4 text-default-300" />
                      <p className="text-lg font-medium">No results found</p>
                      <p className="text-sm text-center mt-2 text-default-500">
                        Try different keywords or check spelling
                      </p>
                    </div>
                  )}
                </div>
              ) : null}
            </ScrollShadow>
          </div>
        </div>
      )}

      {/* MIRA Cloud Fullscreen Modal */}
      {/* Backdrop overlay with blur animation - renders below iframe */}
      {(showMiraModal || miraModalClosing) && (
        <div
          className={`fixed inset-0 bg-black/60 backdrop-blur-[10px] ${miraModalClosing ? 'animate-mira-backdrop-out' : 'animate-mira-backdrop-in'}`}
          style={{ zIndex: 99998, pointerEvents: 'none' }}
          onAnimationEnd={() => {
            if (miraModalClosing) {
              setMiraModalClosing(false)
              setShowMiraModal(false)
            }
          }}
        />
      )}

      {/* Iframe container - only mounted when modal is open */}
      {(showMiraModal || miraModalClosing) && (
        <div
          className={`fixed inset-0 ${miraModalClosing ? 'animate-mira-iframe-out' : 'animate-mira-iframe-in'}`}
          style={{
            zIndex: 99999,
            pointerEvents: 'auto'
          }}
        >
          <iframe
            src="https://itsmira.cloud"
            className="w-full h-full border-0"
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
            allow="microphone; camera; clipboard-read; clipboard-write"
            title="MIRA Cloud"
          />
        </div>
      )}

      {/* Close button - separate from backdrop for proper click handling */}
      {(showMiraModal || miraModalClosing) && (
        <Button
          isIconOnly
          variant="solid"
          className="fixed top-4 right-4 bg-default-900/80 hover:bg-default-900"
          style={{ zIndex: 100000 }}
          onPress={() => setMiraModalClosing(true)}
        >
          <FaTimes className="w-6 h-6 text-white" />
        </Button>
      )}
    </header>
  )
}

// Real-time Clock Component
function RealTimeClock({ timezone = 'Asia/Kolkata' }) {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date())
    }, 1000)

    return () => clearInterval(timer)
  }, [])

  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZone: timezone
    })
  }

  const formatDate = (date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: timezone
    })
  }

  return (
    <div className="flex flex-col items-center">
      <div className="text-sm font-semibold text-default-900">
        {formatTime(time)}
      </div>
      <div className="text-xs text-default-500">
        {formatDate(time)}
      </div>
    </div>
  )
}
