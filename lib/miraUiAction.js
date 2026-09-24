// Bounded navigation controls only. Business mutations use authenticated server actions.
export function validateMiraUiAction(action) {
  if (action?.type !== 'ui_action') return null
  const operation = action.fields?.operation
  if (['scroll_up', 'scroll_down'].includes(operation)) return { type: 'ui_action', fields: { operation } }
  const target = action.fields?.target
  if (operation === 'click' && typeof target === 'string' && target.trim().length > 0 && target.length <= 100) return { type: 'ui_action', fields: { operation, target: target.trim() } }
  return null
}

export async function executeMiraUiAction(action) {
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
  const normalize = text => String(text || '').trim().replace(/\s+/g, ' ').toLowerCase()
  const matches = [...root.querySelectorAll('a[href],button,[role="tab"]')].filter(el => {
    if (el.disabled || el.closest('[aria-hidden="true"], [inert]') || !el.getClientRects().length) return false
    if (normalize(el.getAttribute('aria-label') || el.textContent) !== normalize(target)) return false
    if (el.tagName === 'A') {
      const url = new URL(el.href, location.href)
      return url.origin === location.origin && url.pathname.startsWith('/dashboard') && !el.hasAttribute('download')
    }
    return el.getAttribute('role') === 'tab' || /^(view|open|details|next|previous|back|close|cancel|list|pipeline|pending|completed|all)(\b|$)/i.test(target)
  })
  if (matches.length !== 1) return { success: false, message: matches.length ? 'More than one control matches. Please specify which one.' : 'I could not find that navigation control on the current page.' }
  const element = matches[0]
  element.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  window.dispatchEvent(new CustomEvent('mira:activity', { detail: { label: `Opening ${target}`, phase: 'working', target: element } }))
  await new Promise(resolve => setTimeout(resolve, 320))
  if (!element.isConnected || element.disabled) {
    window.dispatchEvent(new CustomEvent('mira:activity', { detail: { label: 'Page changed', phase: 'done' } }))
    return { success: false, message: 'The page changed. Please try again.' }
  }
  element.click()
  window.dispatchEvent(new CustomEvent('mira:activity', { detail: { label: `Selected ${target}`, phase: 'click', target: element } }))
  return { success: true, message: `Selected ${target}.` }
}
