// Bounded navigation controls only. Business mutations use authenticated server actions.
export function validateMiraUiAction(action) {
  if (action?.type !== 'ui_action') return null
  const operation = action.fields?.operation
  if (['scroll_up', 'scroll_down'].includes(operation)) return { type: 'ui_action', fields: { operation } }
  const target = action.fields?.target
  if (operation === 'click' && typeof target === 'string' && target.trim().length > 0 && target.length <= 100) return { type: 'ui_action', fields: { operation, target: target.trim() } }
  return null
}

const normalize = text => String(text || '').trim().replace(/\s+/g, ' ').toLowerCase()
const label = el => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 150)
const controlIds = new WeakMap()
let nextControlId = 0
function controlId(element) {
  if (!controlIds.has(element)) controlIds.set(element, `ui-${++nextControlId}`)
  return controlIds.get(element)
}
function visibleControl(el) {
  if (!el?.isConnected || el.closest('[aria-hidden="true"], [inert], .mira-workspace, [data-mira-private], [data-testid="mira-page-glow"]') || !el.getClientRects().length) return false
  const style = getComputedStyle(el)
  return style.visibility !== 'hidden' && style.display !== 'none'
}

// Inventory all visible UI affordances, but distinguish executable navigation
// from form submission/business mutations. Never include input values.
export function getMiraUiContext() {
  const dialog = [...document.querySelectorAll('[role="dialog"],dialog[open]')].find(visibleControl)
  const root = dialog || document
  const controls = [...root.querySelectorAll('a[href],button,[role="tab"],[data-mira-control="navigation"],input:not([type="password"]),select,textarea')].filter(visibleControl).map(el => {
    const name = label(el) || el.getAttribute('placeholder') || el.getAttribute('name') || ''
    if (!name || el.closest('[data-sensitive], [autocomplete="current-password"], [autocomplete="new-password"]')) return null
    const rect = el.getBoundingClientRect()
    return { id: controlId(el), label: name.slice(0, 100), role: el.getAttribute('role') || el.tagName.toLowerCase(), executable: isMiraNavigationControl(el), disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true', region: el.closest('header') ? 'header' : el.closest('nav,aside') ? 'sidebar' : dialog ? 'dialog' : 'page', inViewport: rect.bottom > 0 && rect.top < innerHeight, ...(el.tagName === 'A' && isMiraNavigationControl(el) ? { href: new URL(el.href).pathname } : {}) }
  }).filter(Boolean).sort((a, b) => Number(b.inViewport) - Number(a.inViewport)).slice(0, 70)
  return { dialog: Boolean(dialog), controls }
}

export function isMiraNavigationControl(el) {
  if (!visibleControl(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') return false
  const style = getComputedStyle(el)
  if (style.visibility === 'hidden' || style.display === 'none') return false
  if (el.tagName === 'A') {
    const url = new URL(el.href, location.href)
    return url.origin === location.origin && /^\/dashboard(?:\/|$)/.test(url.pathname) && !el.hasAttribute('download') && (!el.target || el.target === '_self')
  }
  // Never let model-generated coordinates bypass this navigation-only boundary.
  return el.getAttribute('data-mira-control') === 'navigation' || el.getAttribute('role') === 'tab' || /^(view|open|details|next|previous|back|close|cancel|list|pipeline|pending|completed|all)(\b|$)/i.test(label(el))
}

export async function executeMiraUiAction(action, { resolveSnapshot, searchNavigation, signal } = {}) {
  const valid = validateMiraUiAction(action)
  if (!valid) return { success: false, message: 'That page interaction is not supported.' }
  const root = document.querySelector('main') || document.body
  const { operation, target } = valid.fields
  if (operation.startsWith('scroll_')) {
    const scroller = [...root.querySelectorAll('*'), root].find(el => el.scrollHeight > el.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(el).overflowY)) || document.scrollingElement
    scroller.scrollBy({ top: (operation === 'scroll_down' ? 1 : -1) * Math.max(200, scroller.clientHeight * 0.7), behavior: 'smooth' })
    window.dispatchEvent(new CustomEvent('mira:activity', { detail: { label: operation === 'scroll_down' ? 'Scrolling down' : 'Scrolling up', phase: 'done', target: scroller } }))
    return { success: true, message: operation === 'scroll_down' ? 'Scrolled down.' : 'Scrolled up.' }
  }
  const page = location.href
  const dialog = [...document.querySelectorAll('[role="dialog"],dialog[open]')].find(visibleControl)
  const candidates = [...(dialog || document).querySelectorAll('a[href],button,[role="tab"],[data-mira-control="navigation"]')].filter(isMiraNavigationControl)
  const matches = candidates.filter(el => controlId(el) === target || normalize(label(el)) === normalize(target))
  let element = matches.length === 1 ? matches[0] : null
  let snapshotLabel
  let snapshotHref
  if (!element && resolveSnapshot && !signal?.aborted) {
    // A fresh, bounded DOM snapshot keeps the model grounded to actual controls.
    const visible = candidates.filter(el => {
      const rect = el.getBoundingClientRect()
      return rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth
    }).slice(0, 80)
    const hrefs = visible.map(el => el.getAttribute('href'))
    const controls = visible.map((el, index) => {
      const r = el.getBoundingClientRect()
      return { id: String(index), label: label(el), role: el.getAttribute('role') || el.tagName.toLowerCase(), bounds: { x: r.x, y: r.y, width: r.width, height: r.height } }
    })
    if (controls.length) {
      window.dispatchEvent(new CustomEvent('mira:activity', { detail: { label: 'Inspecting page navigation', phase: 'working' } }))
      try {
        const id = await resolveSnapshot({ target, page: location.pathname, controls })
        const index = controls.findIndex(control => control.id === id)
        if (index >= 0) { element = visible[index]; snapshotLabel = controls[index].label; snapshotHref = hrefs[index] }
      } catch { /* Leave the current page untouched when inspection fails. */ }
      if (!element) window.dispatchEvent(new CustomEvent('mira:activity', { detail: { label: 'Navigation not found', phase: 'done' } }))
    }
  }
  if (!element && !matches.length && !dialog && searchNavigation && !signal?.aborted && location.href === page) {
    window.dispatchEvent(new CustomEvent('mira:activity', { detail: { label: 'Searching Talio navigation', phase: 'working' } }))
    try {
      const pages = await searchNavigation(target)
      if (!signal?.aborted && location.href === page && pages?.length) {
        return { success: false, navigationRecovery: true, message: 'The control is not on this page. AI Search found accessible pages.', pages }
      }
    } catch { /* Do not claim navigation succeeded when search is unavailable. */ }
    finally { window.dispatchEvent(new CustomEvent('mira:activity', { detail: { label: 'Navigation search finished', phase: 'done' } })) }
  }
  if (!element) return { success: false, message: matches.length ? 'More than one control matches. Please specify which one.' : 'I could not find a matching navigation control or accessible page. Which page should I open?' }
  const selectedLabel = snapshotLabel || label(element)
  const href = snapshotLabel !== undefined ? snapshotHref : element.getAttribute('href')
  element.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  window.dispatchEvent(new CustomEvent('mira:activity', { detail: { label: `Opening ${selectedLabel}`, phase: 'working', target: element } }))
  await new Promise(resolve => setTimeout(resolve, 320))
  if (signal?.aborted || location.href !== page || !isMiraNavigationControl(element) || label(element) !== selectedLabel || element.getAttribute('href') !== href) {
    window.dispatchEvent(new CustomEvent('mira:activity', { detail: { label: 'Page changed', phase: 'done' } }))
    return { success: false, message: 'The page changed or the request was cancelled. Please try again.' }
  }
  element.click()
  window.dispatchEvent(new CustomEvent('mira:activity', { detail: { label: `Selected ${selectedLabel}`, phase: 'click', target: element } }))
  return { success: true, message: `Selected ${selectedLabel}.` }
}

export async function waitForMiraPage(path, signal) {
  const expected = new URL(path, location.origin)
  const deadline = Date.now() + 5000
  while (Date.now() < deadline && !signal?.aborted) {
    if (location.pathname === expected.pathname && (!expected.search || location.search === expected.search)) {
      await new Promise(resolve => setTimeout(resolve, 180))
      return !signal?.aborted
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return false
}
