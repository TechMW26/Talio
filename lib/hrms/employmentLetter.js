import { formatEmployeeAddress } from '@/lib/employeeAddress'

export const LETTER_FIELDS = [
  ['issueDate', 'Issue date', 'date'], ['joiningDate', 'Joining / effective date', 'date'],
  ['companyName', 'Legal company name'], ['companyAddress', 'Company address', 'textarea'],
  ['employeeName', 'Employee full name'], ['employeeCode', 'Employee code'],
  ['employeeAddress', 'Employee address', 'textarea'], ['designation', 'Designation'],
  ['department', 'Department'], ['manager', 'Reporting manager'], ['workLocation', 'Work location'],
  ['employmentType', 'Employment type'], ['salaryAmount', 'Approved compensation amount', 'number'],
  ['currency', 'Currency code'], ['salaryBasis', 'Compensation basis'], ['paymentFrequency', 'Payment frequency'],
  ['workingSchedule', 'Working days and hours', 'textarea'], ['probation', 'Probation and review terms', 'textarea'],
  ['notice', 'Notice and separation terms', 'textarea'], ['benefits', 'Benefits and statutory contributions', 'textarea'],
  ['leavePolicy', 'Leave entitlement / applicable policy', 'textarea'], ['policies', 'Conduct and confidentiality terms', 'textarea'],
  ['signatoryName', 'Authorized signatory name'], ['signatoryTitle', 'Signatory designation'],
]
const OPTIONAL_FIELDS = ['additionalTerms', 'compensationBreakdown']
export const EMPLOYMENT_LETTER_ROLES = ['admin', 'hr', 'super_admin', 'superadmin']
const text = value => String(value ?? '').trim()
const personName = employee => [employee?.firstName, employee?.lastName].filter(Boolean).join(' ')
const dateKey = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : ''

export function employmentLetterDefaults({ employee, company = {}, preferences = {}, settings = {}, signer = {}, policies = [], now = new Date() }) {
  const salary = employee.salary || {}
  const components = ['basic', 'hra', 'conveyance', 'medical', 'special', 'allowances']
  const monthly = Number(salary.grossSalary) || components.reduce((sum, key) => sum + (Number(salary[key]) || 0), 0)
  const annual = Number(salary.ctc) || 0
  const hours = company.workingHours || settings.workingHours || settings
  const workingDays = (hours.workingDays || []).join(', ')
  const probation = employee.lifecycle?.probation
  const companyName = company.name || settings.companyName || (preferences.companyName === 'Your Company' ? '' : preferences.companyName) || ''
  const companyAddress = formatEmployeeAddress(company.address) || formatEmployeeAddress(settings.companyAddress) || formatEmployeeAddress(preferences.companyAddress)
  const componentLabels = { basic: 'Basic', hra: 'HRA', conveyance: 'Conveyance', medical: 'Medical', special: 'Special allowance', allowances: 'Other allowances' }
  const currency = company.payroll?.currency || settings.payroll?.currency || preferences.currency || ''
  return {
    issueDate: dateKey(now), joiningDate: dateKey(employee.dateOfJoining), companyName, companyAddress,
    employeeName: personName(employee), employeeCode: employee.employeeCode || '', employeeAddress: formatEmployeeAddress(employee.address),
    designation: employee.designation?.title || employee.designation?.name || '', department: employee.department?.name || '',
    manager: personName(employee.reportingManager || employee.assignedManager || employee.reportsTo),
    workLocation: employee.workLocation || companyAddress, employmentType: employee.employmentType || '',
    salaryAmount: annual || monthly || '', salaryBasis: annual ? 'annual CTC' : 'monthly gross',
    currency, paymentFrequency: company.payroll?.paymentCycle || settings.payroll?.paymentCycle || '',
    workingSchedule: workingDays && hours.checkInTime && hours.checkOutTime ? `${workingDays}; ${hours.checkInTime} to ${hours.checkOutTime} (${company.timezone || preferences.timezone || 'Asia/Kolkata'}).` : '',
    probation: probation?.applicable === false ? 'Probation is not applicable to this appointment.' : probation?.durationMonths ? `The probation period is ${probation.durationMonths} months from the joining date. Confirmation is subject to completion of the recorded performance review.` : '',
    notice: employee.lifecycle?.noticePeriodDays != null ? `The applicable notice period is ${employee.lifecycle.noticePeriodDays} days. Separation and handover will be processed under the company separation policy and applicable law.` : '',
    benefits: [employee.pfEnrollment?.enrolled ? 'Provident Fund enrollment applies.' : '', employee.esiEnrollment?.enrolled ? 'Employee State Insurance enrollment applies.' : '', employee.healthInsurance?.enrolled ? 'Company health insurance enrollment applies.' : ''].filter(Boolean).join(' '),
    leavePolicy: policies.filter(policy => /leave|holiday/i.test(policy.title || policy.name || '')).map(policy => policy.title || policy.name).join('; '),
    policies: 'You are required to maintain confidentiality of company and client information, follow the company code of conduct and information-security policies, and use company assets for authorized work. Applicable law governs these obligations.',
    signatoryName: personName(signer), signatoryTitle: signer.designation?.title || signer.designation?.name || '',
    additionalTerms: '', compensationBreakdown: components.filter(key => Number(salary[key]) > 0).map(key => `Monthly ${componentLabels[key]}: ${currency} ${Number(salary[key]).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`).join('; '),
  }
}

export function validateEmploymentLetter(kind, input) {
  if (!['offer', 'appointment'].includes(kind)) throw new Error('Choose an offer or appointment letter')
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Letter details are required')
  const fields = {}
  for (const [key, label, type] of LETTER_FIELDS) {
    const value = text(input[key])
    if (!value) throw new Error(`Complete ${label.toLowerCase()} before issuing the letter`)
    const limit = key.endsWith('Address') ? 500 : type === 'textarea' ? 2500 : 160
    if (value.length > limit) throw new Error(`${label} is too long (maximum ${limit} characters)`)
    fields[key] = value
  }
  for (const key of OPTIONAL_FIELDS) {
    fields[key] = text(input[key])
    if (fields[key].length > 5000) throw new Error('Additional terms and compensation breakdown must each be under 5,000 characters')
  }
  for (const key of ['issueDate', 'joiningDate']) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fields[key]) || !Number.isFinite(Date.parse(fields[key])) || new Date(fields[key]).toISOString().slice(0, 10) !== fields[key]) throw new Error('Enter valid letter and joining dates')
  }
  if (!Number.isFinite(Number(fields.salaryAmount)) || Number(fields.salaryAmount) <= 0) throw new Error('Approved compensation must be greater than zero')
  fields.salaryAmount = Number(fields.salaryAmount)
  fields.currency = fields.currency.toUpperCase()
  if (!/^[A-Z]{3}$/.test(fields.currency)) throw new Error('Use a three-letter currency code')
  if (!['annual CTC', 'monthly gross'].includes(fields.salaryBasis)) throw new Error('Choose annual CTC or monthly gross compensation')
  if (!['monthly', 'bi-weekly', 'weekly'].includes(fields.paymentFrequency)) throw new Error('Choose the payment frequency')
  if (Object.values(fields).some(value => /\[[^\]]+\]|\{\{.*?\}\}|\b(?:TBD|TODO|your company|insert here|placeholder)\b|_{3,}/i.test(String(value)))) throw new Error('Replace all placeholder text with the agreed details before issuing the letter')
  return fields
}

export function employmentLetterParagraphs(kind, f) {
  const formatDate = value => new Date(`${value}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
  const money = `${f.currency} ${Number(f.salaryAmount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
  return [
    { text: `Dear ${f.employeeName},` },
    { text: `We are pleased to ${kind === 'offer' ? 'offer you employment' : 'confirm your appointment'} with ${f.companyName} as ${f.designation} in the ${f.department} department, effective ${f.joiningDate ? formatDate(f.joiningDate) : ''}. The terms of your ${kind === 'offer' ? 'offer' : 'appointment'} are set out below.` },
    { title: 'Role and reporting', text: `Employment: ${f.employmentType}. Reporting manager: ${f.manager}. Work location: ${f.workLocation}.` },
    { title: 'Compensation', text: `Your approved ${f.salaryBasis} is ${money}, paid ${f.paymentFrequency}, subject to applicable statutory deductions.${f.compensationBreakdown ? `\n${f.compensationBreakdown}` : ''}` },
    { title: 'Benefits', text: f.benefits }, { title: 'Working arrangements', text: f.workingSchedule },
    { title: 'Leave and holidays', text: f.leavePolicy }, { title: 'Probation and review', text: f.probation },
    { title: 'Notice and separation', text: f.notice }, { title: 'Confidentiality and conduct', text: f.policies },
    ...(f.additionalTerms ? [{ title: 'Additional agreed terms', text: f.additionalTerms }] : []),
    { text: 'Please acknowledge your acceptance of the terms in this letter by signing and returning a copy to Human Resources.' },
    { text: `For ${f.companyName}\n${f.signatoryName}\n${f.signatoryTitle}` },
    { title: 'Employee acceptance', text: `I, ${f.employeeName}, have read and accept the terms of this letter.\nSignature:                                      Date:` },
  ]
}
