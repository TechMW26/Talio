import {
  HiOutlineAdjustmentsHorizontal,
  HiOutlineArrowRightOnRectangle,
  HiOutlineBanknotes,
  HiOutlineBriefcase,
  HiOutlineChatBubbleOvalLeftEllipsis,
  HiOutlineChatBubbleLeftRight,
  HiOutlineClock,
  HiOutlineEllipsisHorizontalCircle,
  HiOutlineFolderOpen,
  HiOutlineInformationCircle,
  HiOutlineShieldCheck,
  HiOutlineSquares2X2,
  HiOutlineUsers,
} from 'react-icons/hi2'

export const SIDEBAR_ACTION_ICONS = Object.freeze({
  chat: HiOutlineChatBubbleOvalLeftEllipsis,
  settings: HiOutlineAdjustmentsHorizontal,
  appInfo: HiOutlineInformationCircle,
  logout: HiOutlineArrowRightOnRectangle,
})

const CATEGORY_DEFINITIONS = [
  {
    id: 'work',
    name: 'Work',
    description: 'Tasks, projects, boards and productivity',
    icon: HiOutlineBriefcase,
    members: ["To-Do's", 'TalioBoard', 'Projects', 'Productivity'],
  },
  {
    id: 'time',
    name: 'Time & leave',
    description: 'Attendance, leave, holidays and calendars',
    icon: HiOutlineClock,
    members: ['Attendance & Leaves', 'Holidays', 'General Calendar'],
  },
  {
    id: 'people',
    name: 'People',
    description: 'Employees, teams, hiring and growth',
    icon: HiOutlineUsers,
    members: ['Employees', 'Team', 'My Teams', 'Live Users', 'Performance', 'Recruitment', 'Learning', 'Learning (LMS)'],
  },
  {
    id: 'communication',
    name: 'Communication',
    description: 'Chat, mail, meetings and announcements',
    icon: HiOutlineChatBubbleLeftRight,
    members: ['Chat', 'Mail', 'Meetings', 'Announcements'],
  },
  {
    id: 'finance',
    name: 'Finance',
    description: 'Payroll, payslips and expenses',
    icon: HiOutlineBanknotes,
    members: ['Payroll', 'Payslips', 'Expenses'],
  },
  {
    id: 'resources',
    name: 'Resources',
    description: 'Documents, assets, support and knowledge',
    icon: HiOutlineFolderOpen,
    members: ['Documents', 'Assets', 'Helpdesk', 'Policies', 'Ideas'],
  },
  {
    id: 'admin',
    name: 'Administration',
    description: 'Access and organisation controls',
    icon: HiOutlineShieldCheck,
    members: ['Role Management'],
  },
]

function flattenMenuItem(item) {
  const submenu = item.submenu || []
  const includesOverview = submenu.some((child) => child.path === item.path)
  const children = submenu.length
    ? [
        ...(!includesOverview && item.path
          ? [{ name: `${item.name} overview`, path: item.path, isNew: item.isNew }]
          : []),
        ...submenu,
      ]
    : [{ name: item.name, path: item.path, isNew: item.isNew }]

  return children.map((child) => ({
    ...child,
    section: item.name,
    sourceName: item.name,
    icon: child.icon || item.icon,
    isNew: child.isNew || item.isNew || false,
  }))
}

/**
 * Turn a long permission-filtered route list into a small, task-oriented shell.
 * The function only reorganises items it receives, so RBAC and feature filtering
 * remain the source of truth and no hidden route can be reintroduced here.
 */
export function buildNavigationSections(menuItems = []) {
  const dashboard = menuItems.find((item) => item.name === 'Dashboard')
  const assigned = new Set(dashboard ? ['Dashboard'] : [])
  const sections = []

  if (dashboard) {
    sections.push({
      ...dashboard,
      name: 'Home',
      icon: HiOutlineSquares2X2,
      description: 'Your personal workspace',
      sourceItems: [dashboard],
    })
  }

  CATEGORY_DEFINITIONS.forEach((category) => {
    const sourceItems = menuItems.filter((item) => category.members.includes(item.name))
    if (!sourceItems.length) return

    sourceItems.forEach((item) => assigned.add(item.name))
    const submenu = sourceItems.flatMap(flattenMenuItem)

    sections.push({
      ...category,
      path: submenu[0]?.path || sourceItems[0]?.path,
      group: 'Workspace',
      submenu,
      sourceItems,
      isNew: sourceItems.some((item) => item.isNew || item.submenu?.some((child) => child.isNew)),
    })
  })

  // Preserve future or tenant-specific modules even before they are assigned to
  // a curated category. They appear in a single "More" section, never disappear.
  const unassigned = menuItems.filter((item) => !assigned.has(item.name))
  if (unassigned.length) {
    const submenu = unassigned.flatMap(flattenMenuItem)
    sections.push({
      id: 'more',
      name: 'More',
      description: 'Additional tools enabled for your organisation',
      icon: HiOutlineEllipsisHorizontalCircle,
      path: submenu[0]?.path,
      group: 'Workspace',
      submenu,
      sourceItems: unassigned,
      isNew: unassigned.some((item) => item.isNew || item.submenu?.some((child) => child.isNew)),
    })
  }

  return sections
}

export function filterNavigationSections(items = [], query = '') {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return items

  return items.reduce((results, item) => {
    const categoryMatches = [item.name, item.description]
      .filter(Boolean)
      .some((value) => value.toLocaleLowerCase().includes(normalizedQuery))

    if (categoryMatches || !item.submenu) {
      if (categoryMatches) results.push(item)
      return results
    }

    const submenu = item.submenu.filter((child) =>
      [child.name, child.section]
        .filter(Boolean)
        .some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
    )

    if (submenu.length) results.push({ ...item, submenu })
    return results
  }, [])
}

export function isNavigationPathActive(item, pathname) {
  if (!item || !pathname) return false
  const paths = [item.path, ...(item.submenu || []).map((child) => child.path)].filter(Boolean)

  return paths.some((path) => {
    if (path === '/dashboard') return pathname === path
    return pathname === path || pathname.startsWith(`${path}/`)
  })
}

export function getNavigationBadgeCount(item, getCount) {
  const names = item.sourceItems?.map((source) => source.name) || [item.name]
  return names.reduce((total, name) => total + (Number(getCount(name)) || 0), 0)
}

export function groupNavigationChildren(children = []) {
  return children.reduce((groups, child) => {
    const section = child.section || 'Other'
    const current = groups[groups.length - 1]
    if (current?.name === section) {
      current.items.push(child)
    } else {
      groups.push({ name: section, items: [child] })
    }
    return groups
  }, [])
}
