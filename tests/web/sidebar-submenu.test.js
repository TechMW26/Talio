import { fireEvent, render, screen } from '@testing-library/react'
import SidebarSubmenu from '@/components/sidebar/SidebarSubmenu'

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
})
