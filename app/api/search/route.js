import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import Fuse from 'fuse.js'
import { getMenuItemsForRole } from '@/utils/roleBasedMenus'

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

export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User', 'Employee', 'Leave', 'Attendance', 'Department', 'Designation', 'Document', 'Asset', 'Announcement', 'Policy'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user: authUser, models } = auth
    const { User, Employee, Leave, Attendance, Department, Designation, Document, Asset, Announcement, Policy } = models

    const user = await User.findById(authUser._id || authUser.userId).populate('employeeId')
    if (!user || !user.employeeId) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 })
    }

    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q')

    if (!query || query.trim().length < 2) {
      return NextResponse.json({ success: false, message: 'Search query too short' }, { status: 400 })
    }

    const searchRegex = new RegExp(query, 'i')
    const results = {
      pages: [],
      leaves: [],
      announcements: [],
      policies: []
    }

    // Build searchable pages from user's role-based menu items
    const menuItems = getMenuItemsForRole(user.role)
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

    // Search Leaves (only user's leaves)
    const leaves = await Leave.find({
      employee: user.employeeId._id,
      $or: [
        { reason: searchRegex },
        { status: searchRegex },
        { applicationNumber: searchRegex }
      ]
    })
      .select('reason status startDate endDate numberOfDays applicationNumber')
      .populate('leaveType', 'name')
      .limit(10)

    results.leaves = leaves.map(leave => ({
      _id: leave._id,
      type: 'leave',
      title: leave.leaveType?.name || 'Leave',
      subtitle: `${leave.numberOfDays} days`,
      description: leave.reason,
      meta: `${leave.status} • ${new Date(leave.startDate).toLocaleDateString()}`,
      link: `/dashboard/leave`
    }))

    // Search Attendance (only user's attendance)
    const attendance = await Attendance.find({
      employee: user.employeeId._id,
      $or: [
        { status: searchRegex },
        { remarks: searchRegex }
      ]
    })
      .select('date status checkIn checkOut workHours')
      .sort({ date: -1 })
      .limit(10)

    results.attendance = attendance.map(att => ({
      _id: att._id,
      type: 'attendance',
      title: `Attendance - ${new Date(att.date).toLocaleDateString()}`,
      subtitle: att.status,
      description: `Work Hours: ${att.workHours || 0}`,
      meta: att.checkIn ? new Date(att.checkIn).toLocaleTimeString() : 'N/A',
      link: `/dashboard/attendance`
    }))

    // Search Departments (all departments)
    const departments = await Department.find({
      $or: [
        { name: searchRegex },
        { code: searchRegex },
        { description: searchRegex }
      ]
    })
      .select('name code description')
      .limit(10)

    results.departments = departments.map(dept => ({
      _id: dept._id,
      type: 'department',
      title: dept.name,
      subtitle: dept.code,
      description: dept.description,
      link: `/dashboard/organization/departments`
    }))

    // Search Designations (all designations)
    const designations = await Designation.find({
      title: searchRegex
    })
      .select('title level')
      .populate('department', 'name')
      .limit(10)

    results.designations = designations.map(des => ({
      _id: des._id,
      type: 'designation',
      title: des.title,
      subtitle: des.level || 'Designation',
      description: des.department?.name,
      link: `/dashboard/organization/designations`
    }))

    // Search Documents (accessible to user)
    const documents = await Document.find({
      $and: [
        {
          $or: [
            { accessLevel: 'public' },
            { uploadedBy: user.employeeId._id },
            { sharedWith: user.employeeId._id },
            { department: user.employeeId.department }
          ]
        },
        {
          $or: [
            { title: searchRegex },
            { description: searchRegex },
            { fileName: searchRegex },
            { category: searchRegex }
          ]
        }
      ]
    })
      .select('title description category fileName fileType')
      .limit(10)

    results.documents = documents.map(doc => ({
      _id: doc._id,
      type: 'document',
      title: doc.title,
      subtitle: doc.category,
      description: doc.description,
      meta: doc.fileType,
      link: `/dashboard/documents`
    }))

    // Search Assets (assigned to user or available)
    const assets = await Asset.find({
      $and: [
        {
          $or: [
            { assignedTo: user.employeeId._id },
            { status: 'available' }
          ]
        },
        {
          $or: [
            { name: searchRegex },
            { assetCode: searchRegex },
            { category: searchRegex },
            { serialNumber: searchRegex }
          ]
        }
      ]
    })
      .select('name assetCode category status serialNumber')
      .limit(10)

    results.assets = assets.map(asset => ({
      _id: asset._id,
      type: 'asset',
      title: asset.name,
      subtitle: asset.assetCode,
      description: asset.category,
      meta: asset.status,
      link: `/dashboard/assets`
    }))

    // Search Announcements (all active announcements)
    const announcements = await Announcement.find({
      $or: [
        { title: searchRegex },
        { content: searchRegex }
      ]
    })
      .select('title content priority publishedAt')
      .sort({ publishedAt: -1 })
      .limit(10)

    results.announcements = announcements.map(ann => ({
      _id: ann._id,
      type: 'announcement',
      title: ann.title,
      subtitle: 'Announcement',
      description: ann.content?.substring(0, 100),
      meta: ann.priority,
      link: `/dashboard/announcements`
    }))

    // Search Policies (all active policies)
    const policies = await Policy.find({
      $or: [
        { title: searchRegex },
        { description: searchRegex },
        { category: searchRegex }
      ]
    })
      .select('title description category version')
      .limit(10)

    results.policies = policies.map(policy => ({
      _id: policy._id,
      type: 'policy',
      title: policy.title,
      subtitle: `Policy v${policy.version}`,
      description: policy.description,
      meta: policy.category,
      link: `/dashboard/policies`
    }))

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
    return NextResponse.json({ success: false, message: 'Search failed', error: error.message }, { status: 500 })
  }
}

