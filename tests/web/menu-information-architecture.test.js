import {
  buildNavigationSections,
  filterNavigationSections,
  groupNavigationChildren,
  isNavigationPathActive,
  SIDEBAR_ACTION_ICONS,
} from '@/utils/menuInformationArchitecture'
import { roleBasedMenus } from '@/utils/roleBasedMenus'

const icon = () => null

describe('menu information architecture', () => {
  const menuItems = [
    { name: 'Dashboard', path: '/dashboard', icon },
    {
      name: 'Employees',
      path: '/dashboard/employees',
      icon,
      submenu: [
        { name: 'All Employees', path: '/dashboard/employees' },
        { name: 'Add Employee', path: '/dashboard/employees/add' },
      ],
    },
    { name: 'Meetings', path: '/dashboard/meetings', icon },
    { name: 'Tenant Tool', path: '/dashboard/tenant-tool', icon },
  ]

  test('groups visible routes without adding routes that were not permitted', () => {
    const sections = buildNavigationSections(menuItems)
    const paths = sections.flatMap((section) => section.submenu?.map((item) => item.path) || [section.path])

    expect(sections.map((section) => section.name)).toEqual(['Home', 'People', 'Communication', 'More'])
    expect(paths).toEqual(expect.arrayContaining([
      '/dashboard',
      '/dashboard/employees',
      '/dashboard/employees/add',
      '/dashboard/meetings',
      '/dashboard/tenant-tool',
    ]))
    expect(paths).not.toContain('/dashboard/payroll')
  })

  test('preserves section context and future tenant-specific modules', () => {
    const sections = buildNavigationSections(menuItems)
    const people = sections.find((section) => section.name === 'People')
    const more = sections.find((section) => section.name === 'More')

    expect(people.submenu[0]).toMatchObject({ name: 'All Employees', section: 'Employees' })
    expect(more.submenu).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Tenant Tool', path: '/dashboard/tenant-tool' }),
    ]))
  })

  test('uses a unique icon for every top-level destination and sidebar action', () => {
    const completeMenu = [
      { name: 'Dashboard', path: '/dashboard', icon },
      { name: "To-Do's", path: '/dashboard/todo', icon },
      { name: 'Attendance & Leaves', path: '/dashboard/attendance', icon },
      { name: 'Employees', path: '/dashboard/employees', icon },
      { name: 'Meetings', path: '/dashboard/meetings', icon },
      { name: 'Payroll', path: '/dashboard/payroll', icon },
      { name: 'Documents', path: '/dashboard/documents', icon },
      { name: 'Role Management', path: '/dashboard/roles', icon },
      { name: 'Tenant Tool', path: '/dashboard/tenant-tool', icon },
    ]
    const navigationIcons = buildNavigationSections(completeMenu).map((section) => section.icon)
    const allIcons = [...navigationIcons, ...Object.values(SIDEBAR_ACTION_ICONS)]

    expect(new Set(allIcons).size).toBe(allIcons.length)
  })

  test('searches category labels, actions, and source sections', () => {
    const sections = buildNavigationSections(menuItems)

    expect(filterNavigationSections(sections, 'hiring').map((item) => item.name)).toEqual(['People'])
    expect(filterNavigationSections(sections, 'add employee')[0].submenu).toEqual([
      expect.objectContaining({ name: 'Add Employee' }),
    ])
    expect(filterNavigationSections(sections, 'missing')).toEqual([])
  })

  test('uses prefix matching for detail routes without activating Home globally', () => {
    const sections = buildNavigationSections(menuItems)
    const home = sections.find((section) => section.name === 'Home')
    const people = sections.find((section) => section.name === 'People')

    expect(isNavigationPathActive(home, '/dashboard/employees/123')).toBe(false)
    expect(isNavigationPathActive(people, '/dashboard/employees/123')).toBe(true)
  })

  test('separates single destinations from multi-route dropdown groups', () => {
    const groups = groupNavigationChildren([
      { name: "To-Do's", path: '/dashboard/todo', section: "To-Do's" },
      { name: 'TalioBoard', path: '/dashboard/talioboard', section: 'TalioBoard' },
      { name: 'All Projects', path: '/dashboard/projects', section: 'Projects' },
      { name: 'My Tasks', path: '/dashboard/projects/my-tasks', section: 'Projects' },
    ])

    expect(groups).toEqual([
      expect.objectContaining({ name: "To-Do's", items: [expect.objectContaining({ name: "To-Do's" })] }),
      expect.objectContaining({ name: 'TalioBoard', items: [expect.objectContaining({ name: 'TalioBoard' })] }),
      expect.objectContaining({
        name: 'Projects',
        items: [
          expect.objectContaining({ name: 'All Projects' }),
          expect.objectContaining({ name: 'My Tasks' }),
        ],
      }),
    ])
  })

  test.each(Object.keys(roleBasedMenus))('preserves every %s role route', (role) => {
    const originalPaths = new Set(roleBasedMenus[role].flatMap((item) => [
      item.path,
      ...(item.submenu || []).map((child) => child.path),
    ]).filter(Boolean))
    const reorganizedPaths = new Set(buildNavigationSections(roleBasedMenus[role]).flatMap((item) => [
      item.path,
      ...(item.submenu || []).map((child) => child.path),
    ]).filter(Boolean))

    expect([...originalPaths].filter((path) => !reorganizedPaths.has(path))).toEqual([])
  })
})
