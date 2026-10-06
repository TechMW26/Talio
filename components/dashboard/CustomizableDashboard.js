'use client'

import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { NativeButton, Heading1, Heading2 } from '@/components/ui/fernly/native'
import ActionableInsights from './ActionableInsights'
import { groupDashboardWidgets, isWideDashboardWidget, paginateDashboardWidgets } from '@/lib/dashboardSections'
import { WIDGET_REGISTRY, getWidgetsForRole } from '@/lib/widgetRegistry'
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa'
import styles from './HomeDashboard.module.css'

export default function CustomizableDashboard({ userId, userRole = 'employee', displayName = '', attendanceSummary = null, widgetComponents, className = '' }) {
  const reducedMotion = useReducedMotion()
  const [category, setCategory] = useState('attendance')
  const [pageIndex, setPageIndex] = useState(0)
  // UnifiedDashboard supplies feature/access-gated components. Enable every
  // permitted registered widget, independent of legacy customization storage.
  // Department heads use the full-access dashboard matrix in UnifiedDashboard;
  // its supplied components still enforce feature permissions and data scope.
  const effectiveRole = userRole === 'department_head' ? 'admin' : userRole
  const orderedWidgets = getWidgetsForRole(effectiveRole).filter(widget => widgetComponents[widget.id])
  const sections = groupDashboardWidgets(orderedWidgets)
  const section = sections.find(item => item.id === category) || sections[0]
  const pages = paginateDashboardWidgets(section?.widgets || [])
  const currentPage = Math.min(pageIndex, Math.max(0, pages.length - 1))
  const visibleWidgets = pages[currentPage] || []
  const hour = Number(new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(new Date()))
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const roleLabel = userRole.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())
  const chooseCategory = id => { setCategory(id); setPageIndex(0) }
  function navigateTabs(event, index) {
    const key = event.key
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return
    event.preventDefault()
    const next = key === 'Home' ? 0 : key === 'End' ? sections.length - 1 : (index + (key === 'ArrowRight' ? 1 : -1) + sections.length) % sections.length
    chooseCategory(sections[next].id)
    event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next]?.focus()
  }

  return <div className={`${styles.dashboard} ${className}`}>
    <div className={styles.workspace}>
      <div className={styles.main} data-dashboard-widget-area>
        <header className={styles.header}>
          <div><p className={styles.eyebrow}>{roleLabel} workspace</p><Heading1>{greeting}{displayName ? `, ${displayName}` : ''}</Heading1><div className={styles.attendanceSummary}>{attendanceSummary}</div></div>
        </header>
        {sections.length > 0 && <div className={styles.tabs} role="tablist" aria-label="Dashboard categories">
          {sections.map((item, index) => <NativeButton key={item.id} role="tab" id={`home-tab-${item.id}`} aria-selected={section.id === item.id} aria-controls={`home-panel-${item.id}`} tabIndex={section.id === item.id ? 0 : -1} onKeyDown={event => navigateTabs(event, index)} onClick={() => chooseCategory(item.id)}>
            {section.id === item.id && <motion.span className={styles.pill} layoutId="home-category-pill" transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 38 }} aria-hidden="true" />}
            <span>{item.title}</span>
          </NativeButton>)}
        </div>}
        {!section ? <section className={styles.empty}><Heading2>No widgets available</Heading2><p>Your permitted workspace widgets will appear here when available.</p></section> : <>
          <div className={styles.panelHeader}>
            <div><Heading2>{section.title}</Heading2><p aria-live="polite">{visibleWidgets.map(widget => widget.name).join(' · ')}</p></div>
            {pages.length > 1 && <div className={styles.pagination}>
              <NativeButton type="button" aria-label="Previous widget panel" disabled={currentPage === 0} onClick={() => setPageIndex(currentPage - 1)}><FaChevronLeft /></NativeButton>
              <span aria-live="polite">Page {currentPage + 1} of {pages.length}</span>
              <nav className={styles.pagePills} aria-label="Widget panel pages">
                {pages.map((widgets, index) => <NativeButton
                  key={`${section.id}-page-${index}`} type="button"
                  aria-label={`Go to widget page ${index + 1}: ${widgets.map(widget => widget.name).join(', ')}`}
                  aria-current={currentPage === index ? 'page' : undefined}
                  aria-controls={`home-panel-${section.id}`}
                  title={widgets.map(widget => widget.name).join(' · ')}
                  onClick={() => setPageIndex(index)}
                >{widgets.map(widget => widget.name).join(' + ')}</NativeButton>)}
              </nav>
              <NativeButton type="button" aria-label="Next widget panel" disabled={currentPage === pages.length - 1} onClick={() => setPageIndex(currentPage + 1)}><FaChevronRight /></NativeButton>
            </div>}
          </div>
              <section key={`${section.id}-${currentPage}`} id={`home-panel-${section.id}`} role="tabpanel" aria-labelledby={`home-tab-${section.id}`} tabIndex={0} className={styles.slide} data-cells={visibleWidgets.reduce((sum, widget) => sum + (isWideDashboardWidget(widget.id) ? 2 : 1), 0)}>
                {visibleWidgets.map((widget, index) => <div key={widget.id} style={{ '--widget-enter-delay': `${index * 45}ms` }} className={`dashboard-widget-enter ${styles.widget} ${isWideDashboardWidget(widget.id) ? styles.wide : ''}`}>
                  <div className={styles.widgetContent} data-scrollable-widget={WIDGET_REGISTRY[widget.id]?.scrollableList === true || undefined}>{widgetComponents[widget.id]}</div>
                </div>)}
              </section>
        </>}
      </div>
      <aside aria-label="Quick tools" className={styles.tools}><ActionableInsights vertical /></aside>
    </div>
  </div>
}
