'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { HiOutlineChevronRight } from 'react-icons/hi2'
import { groupNavigationChildren } from '@/utils/menuInformationArchitecture'

export default function SidebarSubmenu({
  item,
  effectivePath,
  onNavigate,
  getBadgeCount = () => 0,
  expandAll = false,
}) {
  const groups = useMemo(() => groupNavigationChildren(item.submenu), [item.submenu])
  const activeChildPath = useMemo(() => {
    const paths = groups.flatMap((group) => group.items.map((child) => child.path)).filter(Boolean)
    const exact = paths.find((path) => path === effectivePath)
    if (exact) return exact
    return paths
      .filter((path) => effectivePath?.startsWith(`${path}/`))
      .sort((left, right) => right.length - left.length)[0] || null
  }, [effectivePath, groups])
  const groupNames = groups.map((group) => group.name).join('\u0000')
  const activeGroupName = groups.find((group) =>
    group.items.some((child) => child.path === activeChildPath)
  )?.name || ''
  const [openSections, setOpenSections] = useState({})

  useEffect(() => {
    if (expandAll) {
      setOpenSections(Object.fromEntries(groupNames.split('\u0000').filter(Boolean).map((name) => [name, true])))
      return
    }

    setOpenSections(activeGroupName ? { [activeGroupName]: true } : {})
  }, [activeGroupName, expandAll, groupNames])

  const toggleSection = (sectionName) => {
    setOpenSections((current) => current[sectionName] ? {} : { [sectionName]: true })
  }

  return (
    <nav aria-label={`${item.name} pages`} className="talio-sidebar-subnav space-y-0.5">
      {groups.map((group) => {
        const isSingleDestination = group.items.length === 1
        const isOpen = Boolean(openSections[group.name])
        const hasActiveChild = group.items.some((child) => child.path === activeChildPath)
        const groupBadge = group.items.reduce((total, child) => total + (Number(getBadgeCount(child)) || 0), 0)

        if (isSingleDestination) {
          const child = group.items[0]
          return (
            <Link
              key={`${group.name}-${child.path}`}
              href={child.path}
              onClick={(event) => onNavigate(child.path, event)}
              aria-current={hasActiveChild ? 'page' : undefined}
              data-active={hasActiveChild}
              className="talio-sidebar-leaf"
            >
              <span className="min-w-0 truncate font-medium">{group.name}</span>
              <span className="flex flex-shrink-0 items-center gap-2">
                {child.isNew && <span className="talio-sidebar-new">New</span>}
                {groupBadge > 0 && <span className="talio-sidebar-badge talio-sidebar-badge--danger">{groupBadge > 99 ? '99+' : groupBadge}</span>}
              </span>
            </Link>
          )
        }

        const regionId = `sidebar-${item.id || item.name}-${group.name}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-')
        return (
          <div key={group.name}>
            <button
              type="button"
              onClick={() => toggleSection(group.name)}
              aria-expanded={isOpen}
              aria-controls={regionId}
              data-active={hasActiveChild}
              data-open={isOpen}
              className="talio-sidebar-module"
            >
              <span className="min-w-0 truncate font-semibold">{group.name}</span>
              <span className="flex flex-shrink-0 items-center gap-2">
                {!isOpen && groupBadge > 0 && <span className="talio-sidebar-badge talio-sidebar-badge--danger">{groupBadge > 99 ? '99+' : groupBadge}</span>}
                <HiOutlineChevronRight className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
              </span>
            </button>

            {isOpen && (
              <div id={regionId} className="talio-sidebar-module-items space-y-0.5">
                {group.items.map((child) => {
                  const active = child.path === activeChildPath
                  const badge = getBadgeCount(child)
                  return (
                    <Link
                      key={`${child.path}-${child.name}`}
                      href={child.path}
                      onClick={(event) => onNavigate(child.path, event)}
                      aria-current={active ? 'page' : undefined}
                      data-active={active}
                      className="talio-sidebar-child"
                    >
                      <span className="min-w-0 truncate">{child.name}</span>
                      <span className="flex flex-shrink-0 items-center gap-2">
                        {child.isNew && <span className="talio-sidebar-new">New</span>}
                        {badge > 0 && <span className="talio-sidebar-badge talio-sidebar-badge--danger">{badge > 99 ? '99+' : badge}</span>}
                      </span>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}
