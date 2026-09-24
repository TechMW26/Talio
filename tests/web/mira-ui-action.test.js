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
  window.removeEventListener('mira:activity', activity)
})
test('does not turn arbitrary destructive labels into clicks', async () => {
  const click = jest.fn()
  document.querySelectorAll('button')[1].addEventListener('click', click)
  expect(await executeMiraUiAction({ type: 'ui_action', fields: { operation: 'click', target: 'Delete task' } })).toMatchObject({ success: false })
  expect(click).not.toHaveBeenCalled()
})
