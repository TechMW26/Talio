import { directoryInternals } from '@/lib/services/directoryService.server'

describe('directory service query hardening', () => {
  test('escapes regular expression metacharacters', () => {
    expect(directoryInternals.escapeRegex('a.*(b)[c]$')).toBe('a\\.\\*\\(b\\)\\[c\\]\\$')
  })

  test.each([
    [undefined, 50],
    ['0', 1],
    ['-20', 1],
    ['25', 25],
    ['1000', 100],
    ['invalid', 50],
  ])('clamps directory limit %p to %p', (input, expected) => {
    expect(directoryInternals.clampLimit(input)).toBe(expected)
  })
})
