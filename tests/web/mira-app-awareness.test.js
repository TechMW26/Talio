import { act, renderHook } from '@testing-library/react'
import { FocusTimerProvider, useFocusTimer } from '@/contexts/FocusTimerContext'
import { executeMiraFocusTimer, matchMiraFocusTimer } from '@/lib/miraLocalActions'
import { getMiraUiContext, executeMiraUiAction } from '@/lib/miraUiAction'
import { miraAppKnowledge, miraAppPath } from '@/lib/miraAppMap'
import { miraNavigationPath } from '@/lib/miraNavigation'
jest.mock('@/utils/audio', () => ({ startTimerAlarm: jest.fn(), stopTimerAlarm: jest.fn() }))

test('focus timer command controls actual shared timer state and does not toggle on retries', () => {
  const { result, unmount } = renderHook(useFocusTimer, { wrapper: FocusTimerProvider })
  const start = matchMiraFocusTimer('Please start the focus timer for 15 minutes')
  let outcome
  act(() => { outcome = executeMiraFocusTimer(start) })
  expect(outcome.success).toBe(true)
  expect(result.current.running).toBe(true)
  expect(result.current.left).toBe(900)
  act(() => { executeMiraFocusTimer(start) })
  expect(result.current.running).toBe(true)
  act(() => { executeMiraFocusTimer({ type: 'focus_timer', fields: { operation: 'pause' } }) })
  expect(result.current.running).toBe(false)
  unmount()
  expect(executeMiraFocusTimer(start).success).toBe(false)
})

test('timer matching avoids explanations, negation, bad ranges and mixed commands', () => {
  for (const text of ['How do I start the focus timer?', 'Do not start the focus timer', 'Start focus timer for 999 minutes', 'Start focus timer and send a message']) expect(matchMiraFocusTimer(text)).toBeNull()
})

test('map locates timer on Dashboard and supports nested routes without arbitrary URLs', () => {
  expect(miraAppKnowledge('Where is the focus timer?', { page: '/dashboard/settings' })).toContain('Dashboard → Quick Tools → Focus Timer')
  expect(miraNavigationPath('/dashboard/team/regularisation')).toBe('/dashboard/team/regularisation')
  expect(miraNavigationPath('/dashboard/expenses/approvals')).toBe('/dashboard/expenses/approvals')
  expect(miraAppPath('/dashboard/settings?tab=payroll')).toBe('/dashboard/settings?tab=payroll')
  for (const path of ['https://evil.test', '/dashboard/unknown', '/dashboard/employees/user-passwords', '/dashboard/../admin', '/dashboard/settings?tab=bad']) expect(miraAppPath(path)).toBeNull()
})

test('live inventory understands icon titles, excludes password values, and executes real header controls', async () => {
  document.body.innerHTML = '<header><button title="Open notifications"></button></header><main><input type="password" value="secret"><input aria-label="Search tasks" value="private draft"><button>Delete employee</button></main>'
  document.querySelectorAll('button,input').forEach(el => { el.getClientRects = () => [{ width: 20, height: 20 }]; el.scrollIntoView = jest.fn() })
  const ui = getMiraUiContext()
  expect(JSON.stringify(ui)).not.toMatch(/secret|private draft/)
  const control = ui.controls.find(c => c.label === 'Open notifications')
  expect(control).toMatchObject({ region: 'header', executable: true })
  expect(ui.controls.find(c => c.label === 'Delete employee').executable).toBe(false)
  const click = jest.fn(); document.querySelector('button').addEventListener('click', click)
  expect((await executeMiraUiAction({ type: 'ui_action', fields: { operation: 'click', target: control.id } })).success).toBe(true)
  expect(click).toHaveBeenCalledTimes(1)
  document.body.innerHTML = ''
})
