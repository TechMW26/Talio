import { executeMiraQuickNote, validateMiraQuickNote } from '@/lib/miraLocalActions'
import { cleanMiraDraft } from '@/lib/miraTaskBank'

const action = { type: 'quick_note', fields: { content: 'testing' } }
beforeEach(() => localStorage.clear())
afterEach(() => jest.restoreAllMocks())
test('creates the real dashboard note and broadcasts its update', () => {
  const listener = jest.fn()
  window.addEventListener('talio:quick-note-updated', listener)
  expect(executeMiraQuickNote(action).success).toBe(true)
  expect(localStorage.getItem('talio_sticky_note')).toBe('testing')
  expect(listener).toHaveBeenCalledTimes(1)
  window.removeEventListener('talio:quick-note-updated', listener)
})
test('preserves existing note when adding another', () => {
  localStorage.setItem('talio_sticky_note', 'Existing note')
  executeMiraQuickNote(action)
  expect(localStorage.getItem('talio_sticky_note')).toBe('Existing note\ntesting')
})
test.each(['', '   ', null, {}, 'a'.repeat(5001)])('rejects invalid content %p', content => {
  expect(validateMiraQuickNote({ ...action, fields: { content } })).toBeNull()
  expect(executeMiraQuickNote({ ...action, fields: { content } }).success).toBe(false)
  expect(localStorage.getItem('talio_sticky_note')).toBeNull()
})
test('does not report success on storage failure or cancellation', () => {
  expect(executeMiraQuickNote(action, { signal: { aborted: true } }).success).toBe(false)
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded') })
  expect(executeMiraQuickNote(action).success).toBe(false)
})
test('retains quick notes in multi-action task sequences', () => {
  expect(cleanMiraDraft(action)).toEqual(action)
})
