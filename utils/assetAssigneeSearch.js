export function getAssetAssigneeLabel(employee = {}) {
  const fullName = [employee.firstName, employee.lastName]
    .filter(Boolean)
    .join(' ')
    .trim()
  const employeeCode = String(employee.employeeCode || '').trim()

  if (fullName && employeeCode) return `${fullName} (${employeeCode})`
  return fullName || employeeCode || 'Unnamed employee'
}

export function matchesAssetAssignee(textValue, inputValue) {
  const query = String(inputValue || '').trim().toLocaleLowerCase()
  if (!query) return true

  return String(textValue || '').toLocaleLowerCase().includes(query)
}
