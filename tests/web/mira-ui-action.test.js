import { executeMiraUiAction } from '@/lib/miraUiAction'
beforeEach(() => {
  document.body.innerHTML = '<main><button>Pending</button><button>Delete task</button></main>'
  document.querySelectorAll('button').forEach(button => {
    button.getClientRects = () => [{ width: 100, height: 30 }]
    button.scrollIntoView = jest.fn()
  })
})
test('clicks a visible navigation control and announces its real target', async () => {
  const button = document.querySelector('button'), click = jest.fn(), activity = jest.fn()
  button.addEventListener('click', click)
  window.addEventListener('mira:activity', activity)
  expect(await executeMiraUiAction({ type: 'ui_action', fields: { operation: 'click', target: 'Pending' } })).toMatchObject({ success: true })
  expect(click).toHaveBeenCalledTimes(1)
  expect(activity.mock.calls[0][0].detail.target).toBe(button)
  expect(activity.mock.calls.map(([event]) => event.detail.phase)).toEqual(['working', 'click'])
  window.removeEventListener('mira:activity', activity)
})
test('does not turn arbitrary destructive labels into clicks', async () => {
  const click = jest.fn()
  document.querySelectorAll('button')[1].addEventListener('click', click)
  expect(await executeMiraUiAction({ type: 'ui_action', fields: { operation: 'click', target: 'Delete task' } })).toMatchObject({ success: false })
  expect(click).not.toHaveBeenCalled()
})

function addTab(text = 'Tasks') {
  const tab = document.createElement('button')
  tab.textContent = text; tab.setAttribute('role', 'tab')
  tab.getClientRects = () => [{ width: 100, height: 30 }]
  tab.getBoundingClientRect = () => ({ x: 10, y: 10, width: 100, height: 30, top: 10, left: 10, bottom: 40, right: 110 })
  tab.scrollIntoView = jest.fn()
  document.querySelector('main').append(tab)
  return tab
}
test('snapshot resolves a translated local navigation request to a real tab', async () => {
  const tab = addTab(), click = jest.fn(); tab.addEventListener('click', click)
  const resolveSnapshot = jest.fn(async snapshot => snapshot.controls.find(c => c.label === 'Tasks').id)
  expect(await executeMiraUiAction({ type: 'ui_action', fields: { operation: 'click', target: 'टास्क' } }, { resolveSnapshot })).toMatchObject({ success: true, message: 'Selected Tasks.' })
  expect(resolveSnapshot.mock.calls[0][0].controls.some(c => c.label === 'Delete task')).toBe(false)
  expect(click).toHaveBeenCalledTimes(1)
})
test('rejects a snapshot decision after the selected control changes', async () => {
  const tab = addTab(), click = jest.fn(); tab.addEventListener('click', click)
  const resolveSnapshot = async snapshot => { tab.textContent = 'Other tab'; return snapshot.controls.find(c => c.label === 'Tasks').id }
  expect(await executeMiraUiAction({ type: 'ui_action', fields: { operation: 'click', target: 'टास्क' } }, { resolveSnapshot })).toMatchObject({ success: false })
  expect(click).not.toHaveBeenCalled()
})
test('rejects invented snapshot IDs and cancelled clicks', async () => {
  const tab = addTab(), click = jest.fn(); tab.addEventListener('click', click)
  const controller = new AbortController()
  const action = { type: 'ui_action', fields: { operation: 'click', target: 'टास्क' } }
  expect((await executeMiraUiAction(action, { resolveSnapshot: async () => '999' })).success).toBe(false)
  expect((await executeMiraUiAction(action, { signal: controller.signal, resolveSnapshot: async () => { controller.abort(); return '0' } })).success).toBe(false)
  expect(click).not.toHaveBeenCalled()
})
