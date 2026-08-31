import { fireEvent, render, screen, within } from '@testing-library/react'
import SidebarSubmenu from '@/components/sidebar/SidebarSubmenu'
import fs from 'node:fs'
import path from 'node:path'

jest.mock('next/link', () => function MockLink({ href, children, ...props }) {
  return <a href={href} {...props}>{children}</a>
})

const workMenu = {
  id: 'work',
  name: 'Work',
  submenu: [
    { name: "To-Do's", path: '/dashboard/todo', section: "To-Do's" },
    { name: 'TalioBoard', path: '/dashboard/talioboard', section: 'TalioBoard' },
    { name: 'All Projects', path: '/dashboard/projects', section: 'Projects' },
    { name: 'My Tasks', path: '/dashboard/projects/my-tasks', section: 'Projects' },
    { name: 'Assigned Tasks', path: '/dashboard/projects/assigned-tasks', section: 'Projects' },
  ],
}

describe('SidebarSubmenu', () => {
  test('renders singular modules as direct links without duplicate headings', () => {
    render(
      <SidebarSubmenu
        item={workMenu}
        effectivePath="/dashboard"
        onNavigate={() => {}}
      />
    )

    expect(screen.getByRole('link', { name: /to-do's/i })).toHaveAttribute('href', '/dashboard/todo')
    expect(screen.getByRole('link', { name: /talioboard/i })).toHaveAttribute('href', '/dashboard/talioboard')
    expect(screen.queryByRole('button', { name: /to-do's/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /talioboard/i })).not.toBeInTheDocument()
  })

  test('keeps multi-route modules collapsed until their dropdown is opened', () => {
    const { rerender } = render(
      <SidebarSubmenu
        item={workMenu}
        effectivePath="/dashboard"
        onNavigate={() => {}}
      />
    )

    const projects = screen.getByRole('button', { name: /projects/i })
    expect(projects).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('link', { name: 'All Projects' })).not.toBeInTheDocument()

    fireEvent.click(projects)

    expect(projects).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'All Projects' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'My Tasks' })).toBeInTheDocument()

    rerender(
      <SidebarSubmenu
        item={{ ...workMenu, submenu: workMenu.submenu.map((child) => ({ ...child })) }}
        effectivePath="/dashboard"
        onNavigate={() => {}}
      />
    )

    expect(screen.getByRole('button', { name: /projects/i })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'All Projects' })).toBeInTheDocument()
  })

  test('moves aggregate bubbles down to the deepest visible menu level', () => {
    render(
      <SidebarSubmenu
        item={workMenu}
        effectivePath="/dashboard"
        onNavigate={() => {}}
        getBadgeCount={(child) => child.path === '/dashboard/projects/my-tasks' ? 3 : 0}
      />
    )

    const projects = screen.getByRole('button', { name: /projects/i })
    expect(within(projects).getByText('3')).toBeInTheDocument()

    fireEvent.click(projects)

    expect(within(projects).queryByText('3')).not.toBeInTheDocument()
    expect(within(screen.getByRole('link', { name: /my tasks/i })).getByText('3')).toBeInTheDocument()
  })

  test('auto-opens the active group and marks only the most specific route active', () => {
    render(
      <SidebarSubmenu
        item={workMenu}
        effectivePath="/dashboard/projects/my-tasks/42"
        onNavigate={() => {}}
      />
    )

    expect(screen.getByRole('button', { name: /projects/i })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'My Tasks' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'All Projects' })).not.toHaveAttribute('aria-current')
  })

  test('passes the click event to navigation handlers so overlay actions can cancel routing', () => {
    const onNavigate = jest.fn((path, event) => event.preventDefault())

    render(
      <SidebarSubmenu
        item={{
          id: 'communication',
          name: 'Communication',
          submenu: [{ name: 'Chat', path: '/dashboard/chat', section: 'Chat' }],
        }}
        effectivePath="/dashboard/projects"
        onNavigate={onNavigate}
      />
    )

    const chatLink = screen.getByRole('link', { name: 'Chat' })
    const clickResult = fireEvent.click(chatLink)

    expect(onNavigate).toHaveBeenCalledWith('/dashboard/chat', expect.any(Object))
    expect(clickResult).toBe(false)
  })

  test('keeps ordinary and mobile-style link navigation enabled', () => {
    const onNavigate = jest.fn()

    render(
      <SidebarSubmenu
        item={workMenu}
        effectivePath="/dashboard"
        onNavigate={onNavigate}
      />
    )

    const clickResult = fireEvent.click(screen.getByRole('link', { name: /to-do's/i }))

    expect(onNavigate).toHaveBeenCalledWith('/dashboard/todo', expect.any(Object))
    expect(clickResult).toBe(true)
  })

  test('desktop chat launch preserves the current route instead of forcing the homepage', () => {
    const chatPageSource = fs.readFileSync(path.join(process.cwd(), 'app/dashboard/chat/page.js'), 'utf8')
    const desktopSidebarSource = fs.readFileSync(path.join(process.cwd(), 'components/sidebar/SlidingSidebar.js'), 'utf8')

    expect(chatPageSource).not.toContain("router.push('/dashboard')")
    expect(chatPageSource).toContain("openWidget('route')")
    expect(desktopSidebarSource).toContain("path === '/dashboard/chat'")
    expect(desktopSidebarSource).toContain('event?.preventDefault()')
    expect(desktopSidebarSource).toContain("openWidget('sidebar')")
  })
})
