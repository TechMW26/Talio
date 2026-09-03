import {
  EMPLOYEE_LIST_DEFAULT_LIMIT,
  EMPLOYEE_LIST_MAX_LIMIT,
  clampEmployeeListLimit,
} from '@/lib/employeeListQuery'

describe('employee list pagination contract', () => {
  test.each([
    [undefined, EMPLOYEE_LIST_DEFAULT_LIMIT],
    ['invalid', EMPLOYEE_LIST_DEFAULT_LIMIT],
    ['0', 1],
    ['48', 48],
    ['1000', 1000],
    ['5000', EMPLOYEE_LIST_MAX_LIMIT],
  ])('clamps %p to %p', (input, expected) => {
    expect(clampEmployeeListLimit(input)).toBe(expected)
  })
})
