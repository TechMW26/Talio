import fs from 'node:fs'
import path from 'node:path'
import {
  filterDepartmentGroupEmployees,
  hasActiveGroupSearch,
  isDepartmentGroupExpanded,
} from '@/lib/departmentGroupSearch'

describe('department-grouped employee search', () => {
  test('opens matching department groups whenever search text is active', () => {
    expect(isDepartmentGroupExpanded({
      searchQuery: 'aviraj',
      expandedDepartments: { engineering: false },
      departmentId: 'engineering',
    })).toBe(true)
  })

  test('restores manual and default expansion behavior after search is cleared', () => {
    expect(hasActiveGroupSearch('   ')).toBe(false)
    expect(isDepartmentGroupExpanded({
      searchQuery: '', expandedDepartments: { engineering: true }, departmentId: 'engineering',
    })).toBe(true)
    expect(isDepartmentGroupExpanded({
      searchQuery: '', expandedDepartments: { engineering: false }, departmentId: 'engineering', defaultExpanded: true,
    })).toBe(false)
    expect(isDepartmentGroupExpanded({
      searchQuery: '', expandedDepartments: {}, departmentId: 'engineering', defaultExpanded: true,
    })).toBe(true)
  })

  test('a department-name search returns every employee in the matching department', () => {
    const employees = [
      { name: 'Aviraj Sharma' },
      { name: 'Sahil Sahu' },
    ]
    const result = filterDepartmentGroupEmployees({
      departmentName: 'Tech Team',
      employees,
      searchQuery: '  tech team ',
      matchesEmployee: (employee, query) => employee.name.toLocaleLowerCase().includes(query),
    })

    expect(result).toEqual(employees)
  })

  test('an employee search only returns matching employees when the department does not match', () => {
    const result = filterDepartmentGroupEmployees({
      departmentName: 'Tech Team',
      employees: [{ name: 'Aviraj Sharma' }, { name: 'Sahil Sahu' }],
      searchQuery: 'aviraj',
      matchesEmployee: (employee, query) => employee.name.toLocaleLowerCase().includes(query),
    })

    expect(result).toEqual([{ name: 'Aviraj Sharma' }])
  })

  test('all department-grouped people selectors use search-driven expansion', () => {
    const selectors = [
      'app/dashboard/meetings/components/CreateMeetingModal.js',
      'components/CallAlertButton.js',
      'app/dashboard/payroll/generate/page.js',
      'app/dashboard/admin/live-users/page.js',
    ]

    for (const selector of selectors) {
      const source = fs.readFileSync(path.join(process.cwd(), selector), 'utf8')
      expect(source).toContain('isDepartmentGroupExpanded({')
      expect(source).toContain('hasActiveGroupSearch(searchQuery)')
    }
    for (const selector of selectors.slice(0, 2)) {
      const source = fs.readFileSync(path.join(process.cwd(), selector), 'utf8')
      expect(source).toContain('filterDepartmentGroupEmployees({')
      expect(source).toContain('departmentName: group.department?.name')
    }
  })
})
