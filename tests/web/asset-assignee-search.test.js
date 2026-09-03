import {
  getAssetAssigneeLabel,
  matchesAssetAssignee,
} from '@/utils/assetAssigneeSearch'

describe('asset assignee search', () => {
  const employee = {
    firstName: 'Priyanka',
    lastName: 'Chakraborty',
    employeeCode: 'MG5',
  }

  test('builds the visible employee option from name and employee code', () => {
    expect(getAssetAssigneeLabel(employee)).toBe('Priyanka Chakraborty (MG5)')
  })

  test.each([
    ['priyanka', true],
    ['CHAKRA', true],
    ['mg5', true],
    ['  MG5  ', true],
    ['finance', false],
    ['', true],
  ])('filters assignees with query %p', (query, expected) => {
    expect(matchesAssetAssignee(getAssetAssigneeLabel(employee), query)).toBe(expected)
  })

  test('keeps incomplete employee records searchable without rendering undefined', () => {
    expect(getAssetAssigneeLabel({ firstName: 'Poonam' })).toBe('Poonam')
    expect(getAssetAssigneeLabel({ employeeCode: 'U82' })).toBe('U82')
    expect(getAssetAssigneeLabel({})).toBe('Unnamed employee')
  })
})
