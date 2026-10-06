import { populateEmployeeRoster } from './employees.server'

const publicFields = ['bio', 'skills', 'qualifications', 'experience', 'workLocation']
export async function readEmployeeDetails(database, actor, id) {
  let employee = await database.get('employees', id)
  if (!employee) {
    const account = await database.get('users', id)
    if (account?.employeeId) employee = await database.get('employees', String(account.employeeId))
  }
  if (!employee) return null
  const joins = (await populateEmployeeRoster(database, [employee], { includeLifecycle: true }))[0]
  const canViewPrivate = ['admin', 'hr', 'super_admin'].includes(actor.role) || String(actor.employeeId?._id || actor.employeeId) === String(employee._id)
  const result = canViewPrivate ? { ...employee, ...joins } : { ...joins, ...Object.fromEntries(publicFields.filter(key => employee[key] !== undefined).map(key => [key, employee[key]])) }
  if (!canViewPrivate) for (const key of ['salary', 'pfEnrollment', 'esiEnrollment', 'professionalTax', 'healthInsurance', 'basicSalary', 'lifecycle']) delete result[key]
  if (employee.company) {
    const company = await database.get('companies', String(employee.company))
    result.company = company ? { _id: company._id, name: company.name, timezone: company.timezone } : null
  }
  delete result.searchGrams
  return result
}
