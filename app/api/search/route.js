import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { APPLICATION_SEARCH_OPTIONS, searchApplicationRecords } from '@/lib/applicationSearch.server'
import Fuse from 'fuse.js'
import { getMenuItemsForRole } from '@/utils/roleBasedMenus'
import { getMenuTemplateRole } from '@/utils/rbacMenu'
import { resolveUserPermissions } from '@/lib/permissions'
import { checkPermission, getPageSlugForPath } from '@/lib/permissions.shared'
import { getTenantCompanyFeaturePayload } from '@/lib/companyFeatures.server'
import { filterMenuItemsByFeatures, isPathEnabledForFeatures } from '@/lib/planFeatures'
import { filterMenuByPermissions } from '@/utils/permissionFilters'

export const dynamic = 'force-dynamic'

// Synonym dictionary for better word matching
const synonyms = {
  'leave': ['vacation', 'holiday', 'time off', 'pto', 'absence', 'off', 'break'],
  'vacation': ['leave', 'holiday', 'time off', 'pto', 'break'],
  'holiday': ['leave', 'vacation', 'time off', 'festival', 'day off'],
  'attendance': ['presence', 'check in', 'check out', 'clock in', 'clock out', 'punch', 'timesheet'],
  'salary': ['pay', 'payroll', 'compensation', 'wage', 'payment', 'payslip', 'earnings'],
  'pay': ['salary', 'payroll', 'compensation', 'wage', 'payment'],
  'payroll': ['salary', 'pay', 'compensation', 'wage', 'payslip'],
  'work': ['assignment', 'job', 'activity'],
  'employee': ['staff', 'worker', 'team member', 'colleague', 'personnel'],
  'staff': ['employee', 'worker', 'team member', 'personnel'],
  'department': ['division', 'team', 'unit', 'section', 'group'],
  'profile': ['account', 'settings', 'personal', 'my profile', 'user'],
  'document': ['file', 'paper', 'form', 'record', 'certificate'],
  'announcement': ['news', 'notice', 'update', 'information', 'alert', 'notification'],
  'policy': ['rule', 'guideline', 'regulation', 'procedure', 'protocol'],
  'performance': ['review', 'appraisal', 'evaluation', 'assessment', 'rating', 'kpi'],
  'asset': ['equipment', 'device', 'resource', 'inventory', 'property'],
  'expense': ['claim', 'reimbursement', 'bill', 'receipt', 'cost'],
  'travel': ['trip', 'journey', 'business travel', 'tour'],
  'help': ['support', 'helpdesk', 'assistance', 'ticket', 'issue'],
  'recruitment': ['hiring', 'job', 'career', 'opening', 'position', 'vacancy'],
  'chat': ['message', 'messaging', 'communication', 'talk', 'conversation'],
  'home': ['dashboard', 'main', 'overview', 'home page'],
  'dashboard': ['home', 'main', 'overview']
}

// Function to expand search query with synonyms
function expandQueryWithSynonyms(query) {
  const words = query.toLowerCase().split(' ')
  const expandedWords = new Set(words)

  words.forEach(word => {
    if (synonyms[word]) {
      synonyms[word].forEach(synonym => expandedWords.add(synonym))
    }
  })

  return Array.from(expandedWords)
}

// Function to build searchable pages from menu items
function buildSearchablePagesFromMenu(menuItems) {
  const pages = []

  const processMenuItem = (item) => {
    // Add main menu item
    if (item.path) {
      pages.push({
        title: item.name,
        description: `View ${item.name.toLowerCase()}`,
        link: item.path,
        type: 'page',
        keywords: [item.name.toLowerCase(), ...item.name.toLowerCase().split(' ')]
      })
    }

    // Add submenu items
    if (item.submenu && item.submenu.length > 0) {
      item.submenu.forEach(subItem => {
        pages.push({
          title: subItem.name,
          description: `${subItem.name} - ${item.name}`,
          link: subItem.path,
          type: 'page',
          keywords: [
            subItem.name.toLowerCase(),
            ...subItem.name.toLowerCase().split(' '),
            item.name.toLowerCase()
          ]
        })
      })
    }
  }

  menuItems.forEach(processMenuItem)
  return pages
}

function buildMenuItemsForUser(user, permissions) {
  if (!user) return []

  const isDepartmentHead = user.isDepartmentHead === true
  const isTeamLeader = Array.isArray(user.teamLeaderOf) && user.teamLeaderOf.length > 0
  const menuTemplateRole = getMenuTemplateRole(user, { isDepartmentHead, permissions })
  let baseMenuItems = getMenuItemsForRole(menuTemplateRole)

  if (isDepartmentHead) {
    const teamSubmenu = [
      { name: 'Team Members', path: '/dashboard/team/members' },
      { name: 'Performance Reports', path: '/dashboard/performance/reports' },
      { name: 'Geofencing', path: '/dashboard/team/geofencing' }
    ]

    if (isTeamLeader) {
      teamSubmenu.splice(1, 0, { name: 'My Teams', path: '/dashboard/team/my-teams' })
    }

    const teamMenuItem = {
      name: 'Team',
      path: '/dashboard/team/members',
      group: 'Main',
      submenu: teamSubmenu
    }

    const attendanceMenuIndex = baseMenuItems.findIndex((item) => item.name === 'Attendance & Leaves')
    if (attendanceMenuIndex !== -1) {
      baseMenuItems = [...baseMenuItems]
      const currentSubmenu = baseMenuItems[attendanceMenuIndex].submenu || []
      const hasTeamAttendance = currentSubmenu.some((item) => item.path === '/dashboard/attendance/team')

      if (!hasTeamAttendance) {
        const myAttendanceIndex = currentSubmenu.findIndex((item) => item.path === '/dashboard/attendance')
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

  if (isTeamLeader) {
    const teamSubmenu = [
      { name: 'My Teams', path: '/dashboard/team/my-teams' },
      { name: 'Team Members', path: '/dashboard/team/members' },
      { name: 'Performance Reports', path: '/dashboard/performance/reports' },
    ]
    const teamMenuItem = {
      name: 'Team',
      path: '/dashboard/team/my-teams',
      group: 'Main',
      submenu: teamSubmenu
    }

    baseMenuItems = [...baseMenuItems]
    const attendanceMenuIndex = baseMenuItems.findIndex((item) => item.name === 'Attendance & Leaves')
    if (attendanceMenuIndex !== -1) {
      const currentSubmenu = baseMenuItems[attendanceMenuIndex].submenu || []
      const hasTeamAttendance = currentSubmenu.some((item) => item.path === '/dashboard/attendance/team')
      if (!hasTeamAttendance) {
        const myAttendanceIndex = currentSubmenu.findIndex((item) => item.path === '/dashboard/attendance')
        const newSubmenu = [...currentSubmenu]
        newSubmenu.splice(
          myAttendanceIndex + 1,
          0,
          { name: 'Team Attendance', path: '/dashboard/attendance/team' },
          { name: 'Attendance Regularisation', path: '/dashboard/team/regularisation' }
        )
        if (!newSubmenu.some((item) => item.path === '/dashboard/leave/approvals')) {
          newSubmenu.push({ name: 'Leave Approvals', path: '/dashboard/leave/approvals' })
        }
        baseMenuItems[attendanceMenuIndex] = {
          ...baseMenuItems[attendanceMenuIndex],
          submenu: newSubmenu
        }
      }
    }

    const hasProductivity = baseMenuItems.some((item) => item.name === 'Productivity')
    const result = [baseMenuItems[0], teamMenuItem, ...baseMenuItems.slice(1)]
    if (!hasProductivity) {
      result.splice(2, 0, { name: 'Productivity', path: '/dashboard/productivity', group: 'Work' })
    }

    return result
  }

  return baseMenuItems
}

function canAccessPath(path, companyFeatures, permissions, userRole) {
  if (path && !isPathEnabledForFeatures(path, companyFeatures)) {
    return false
  }

  if (!permissions || userRole === 'admin') {
    return true
  }

  const slug = getPageSlugForPath(path)
  if (!slug) {
    return true
  }

  return checkPermission(permissions, slug, 'view')
}

export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request, APPLICATION_SEARCH_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    const { user: authUser, database, tenant } = auth
    const employee = authUser.employeeId ? await database.get('employees', String(authUser.employeeId?._id || authUser.employeeId)) : null
    if (!employee) return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    const user = { ...authUser, employeeId: employee }

    const { searchParams } = new URL(request.url)
    const query = (searchParams.get('q') || '').trim().slice(0, 100)

    if (!query || query.trim().length < 2) {
      return NextResponse.json({ success: false, message: 'Search query too short' }, { status: 400 })
    }

    const permissions = await resolveUserPermissions(user, tenant.databaseName)
    const companyFeatures = (await getTenantCompanyFeaturePayload({ companySlug: tenant.companySlug, databaseName: tenant.databaseName }))?.features || null

    const results = {
      pages: [],
      leaves: [],
      attendance: [],
      departments: [],
      designations: [],
      documents: [],
      assets: [],
      announcements: [],
      policies: []
    }

    // Build searchable pages from the same dynamic menu logic used by the sidebar.
    let menuItems = buildMenuItemsForUser(user, permissions)
    menuItems = filterMenuItemsByFeatures(menuItems, companyFeatures)
    menuItems = filterMenuByPermissions(menuItems, permissions, user.role)
    const appPages = buildSearchablePagesFromMenu(menuItems)

    // Expand query with synonyms
    const expandedTerms = expandQueryWithSynonyms(query)

    // Configure Fuse.js for fuzzy search
    const fuseOptions = {
      keys: [
        { name: 'title', weight: 0.4 },
        { name: 'description', weight: 0.3 },
        { name: 'keywords', weight: 0.3 }
      ],
      threshold: 0.4, // 0.0 = perfect match, 1.0 = match anything
      distance: 100,
      minMatchCharLength: 2,
      includeScore: true,
      ignoreLocation: true
    }

    const fuse = new Fuse(appPages, fuseOptions)

    // Search with original query
    let fuseResults = fuse.search(query)

    // Also search with expanded terms (synonyms)
    expandedTerms.forEach(term => {
      if (term !== query.toLowerCase()) {
        const synonymResults = fuse.search(term)
        fuseResults = [...fuseResults, ...synonymResults]
      }
    })

    // Remove duplicates and sort by score
    const uniqueResults = Array.from(
      new Map(fuseResults.map(item => [item.item.link, item])).values()
    ).sort((a, b) => a.score - b.score).slice(0, 10)

    results.pages = uniqueResults.map(result => ({
      type: 'page',
      title: result.item.title,
      subtitle: 'Navigate to',
      description: result.item.description,
      link: result.item.link,
      score: result.score
    }))

    const found = await searchApplicationRecords(database, user, employee, query, path => canAccessPath(path, companyFeatures, permissions, user.role))
    results.leaves = found.leaves.map(row => ({ _id: row._id, type: 'leave', title: row.leaveType?.name || 'Leave', subtitle: String(row.numberOfDays) + ' days', description: row.reason, meta: row.status + ' • ' + new Date(row.startDate).toLocaleDateString(), link: '/dashboard/leave' }))
    results.attendance = found.attendance.map(row => ({ _id: row._id, type: 'attendance', title: 'Attendance - ' + new Date(row.date).toLocaleDateString(), subtitle: row.status, description: 'Work Hours: ' + (row.workHours || 0), meta: row.checkIn ? new Date(row.checkIn).toLocaleTimeString() : 'N/A', link: '/dashboard/attendance' }))
    results.departments = found.departments.map(row => ({ _id: row._id, type: 'department', title: row.name, subtitle: row.code, description: row.description, link: '/dashboard/departments' }))
    results.designations = found.designations.map(row => ({ _id: row._id, type: 'designation', title: row.title, subtitle: row.level || 'Designation', description: row.department?.name, link: '/dashboard/designations' }))
    results.documents = found.documents.map(row => ({ _id: row._id, type: 'document', title: row.title || row.name || row.fileName, subtitle: row.category, description: row.description, meta: row.fileType, link: '/dashboard/documents' }))
    results.assets = found.assets.map(row => ({ _id: row._id, type: 'asset', title: row.name, subtitle: row.assetCode, description: row.category, meta: row.status, link: '/dashboard/assets' }))
    results.announcements = found.announcements.map(row => ({ _id: row._id, type: 'announcement', title: row.title, subtitle: 'Announcement', description: row.content?.substring(0, 100), meta: row.priority, link: '/dashboard/announcements' }))
    results.policies = found.policies.map(row => ({ _id: row._id, type: 'policy', title: row.title, subtitle: 'Policy v' + row.version, description: row.description, meta: row.category, link: '/dashboard/policies' }))

    // Count total results
    const totalResults = Object.values(results).reduce((sum, arr) => sum + arr.length, 0)

    return NextResponse.json({
      success: true,
      data: results,
      totalResults,
      query
    })

  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json({ success: false, message: 'Search failed', error: error.message }, { status: error.status || 500 })
  }
}

